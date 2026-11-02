import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { parseBitableUrl, type FeishuConfigDto, type SaveFeishuConfigRequest } from '@aftersell/shared';
import { SecretBox } from '../common/secret-box';
import { env } from '../config/env';
import { SettingsService } from '../settings/settings.service';

const KEY = 'feishu.config';
const API = 'https://open.feishu.cn/open-apis';
const TIMEOUT_MS = 20_000;

const storedSchema = z.object({
  appId: z.string(),
  secretCipher: z.string().nullable(),
  ledgerEnabled: z.boolean(),
  ledgerUrl: z.string().nullable(),
  /** 知识库链接换算出的 app_token 缓存 */
  resolvedAppToken: z.string().nullable().default(null),
});
type Stored = z.infer<typeof storedSchema>;

export class FeishuError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

/** 飞书报错转成中文提示；不回显任何凭据 */
export function describeFeishuError(error: unknown): string {
  if (error instanceof FeishuError) {
    const hints: Record<number, string> = {
      10003: 'App ID 或 App Secret 不正确',
      10014: 'App Secret 不正确',
      99991663: '应用凭证无效，请检查 App ID / App Secret',
      99991672: '应用没有这个接口的权限，请在飞书开放平台申请对应权限并发布新版本',
      91402: '多维表格不存在，请检查链接',
      91403: '应用没有这张多维表格的权限：请在表格右上角“…→ 添加文档应用”里加上这个应用',
      1254040: '多维表格不存在，请检查链接',
      1254302: '应用没有这张多维表格的权限：请在表格右上角“…→ 添加文档应用”里加上这个应用',
    };
    // 缺权限时飞书原文会列出需要的权限名和申请链接，一并给出
    const detail = error.code === 99991672 && error.message ? `。飞书原文：${error.message}` : '';
    return `${hints[error.code] ?? error.message}${detail}（飞书错误码 ${error.code}）`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** 飞书应用配置（App Secret 加密存 setting 表）与开放平台调用；只用于写台账，不做登录 */
@Injectable()
export class FeishuService {
  private readonly logger = new Logger(FeishuService.name);
  private readonly box = new SecretBox(env().MAIL_SECRET_KEY);
  private tenant: { token: string; expiresAt: number; appId: string } | null = null;

  constructor(private readonly settings: SettingsService) {}

  private stored(): Promise<Stored | null> {
    return this.settings.get<Stored | null>(KEY, storedSchema.nullable(), null);
  }

  async get(): Promise<FeishuConfigDto | null> {
    const s = await this.stored();
    return s ? { appId: s.appId, hasAppSecret: Boolean(s.secretCipher), ledgerEnabled: s.ledgerEnabled, ledgerUrl: s.ledgerUrl } : null;
  }

  async save(actorId: string, dto: SaveFeishuConfigRequest): Promise<FeishuConfigDto> {
    const existing = await this.stored();
    let secretCipher = existing?.secretCipher ?? null;
    if (dto.appSecret) secretCipher = this.box.encrypt(dto.appSecret);
    else if (!existing || existing.appId !== dto.appId) throw new BadRequestException('首次填写或更换应用时必须填写 App Secret');
    const next: Stored = {
      appId: dto.appId,
      secretCipher,
      ledgerEnabled: dto.ledgerEnabled,
      ledgerUrl: dto.ledgerUrl,
      resolvedAppToken: existing?.ledgerUrl === dto.ledgerUrl ? existing.resolvedAppToken : null,
    };
    await this.settings.set(KEY, next, actorId);
    this.tenant = null;
    this.logger.log(`飞书配置已更新 by=${actorId} secretChanged=${Boolean(dto.appSecret)} ledger=${dto.ledgerEnabled}`);
    return (await this.get())!;
  }

  /** 一键建表后把台账指向新表并开启同步 */
  async setLedger(actorId: string, ledgerUrl: string): Promise<void> {
    const s = await this.stored();
    if (!s) throw new BadRequestException('请先保存 App ID / App Secret');
    await this.settings.set(KEY, { ...s, ledgerUrl, ledgerEnabled: true, resolvedAppToken: null } satisfies Stored, actorId);
  }

  async credentials(): Promise<{ appId: string; appSecret: string } | null> {
    const s = await this.stored();
    if (!s?.secretCipher) return null;
    return { appId: s.appId, appSecret: this.box.decrypt(s.secretCipher) };
  }

  async ledgerEnabled(): Promise<boolean> {
    const s = await this.stored();
    return Boolean(s?.ledgerEnabled && s.secretCipher && s.ledgerUrl);
  }

  /** 调开放平台接口；code 非 0 抛 FeishuError */
  async call<T>(path: string, init: { method?: string; token?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method: init.method ?? (init.body || init.form ? 'POST' : 'GET'),
      headers: {
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        ...(init.body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
      },
      body: init.form ?? (init.body ? JSON.stringify(init.body) : undefined),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => null)) as { code?: number; msg?: string; data?: T } & Record<string, unknown> | null;
    if (!data) throw new FeishuError(res.status, `飞书接口返回异常（HTTP ${res.status}）`);
    if (data.code !== 0) throw new FeishuError(data.code ?? res.status, data.msg ?? `HTTP ${res.status}`);
    return (data.data ?? data) as T;
  }

  /** 应用身份 token（2 小时有效，提前 5 分钟刷新） */
  async tenantToken(): Promise<string> {
    const creds = await this.credentials();
    if (!creds) throw new BadRequestException('还没有填写飞书 App ID / App Secret');
    if (this.tenant && this.tenant.appId === creds.appId && this.tenant.expiresAt > Date.now()) return this.tenant.token;
    const r = await this.call<{ tenant_access_token: string; expire: number }>('/auth/v3/tenant_access_token/internal', {
      body: { app_id: creds.appId, app_secret: creds.appSecret },
    });
    this.tenant = { token: r.tenant_access_token, expiresAt: Date.now() + (r.expire - 300) * 1000, appId: creds.appId };
    return this.tenant.token;
  }

  /** 台账表的 app_token / table_id；知识库链接先换成多维表格的 app_token */
  async ledgerTable(): Promise<{ appToken: string; tableId: string }> {
    const s = await this.stored();
    const parsed = s?.ledgerUrl ? parseBitableUrl(s.ledgerUrl) : null;
    if (!s || !parsed) throw new BadRequestException('还没有填写台账多维表格链接');
    if (!parsed.wiki) return { appToken: parsed.token, tableId: parsed.tableId };
    if (s.resolvedAppToken) return { appToken: s.resolvedAppToken, tableId: parsed.tableId };
    const r = await this.call<{ node: { obj_token: string; obj_type: string } }>(`/wiki/v2/spaces/get_node?token=${parsed.token}`, { token: await this.tenantToken() });
    if (r.node.obj_type !== 'bitable') throw new BadRequestException('这个知识库链接不是多维表格');
    await this.settings.set(KEY, { ...s, resolvedAppToken: r.node.obj_token } satisfies Stored, null);
    return { appToken: r.node.obj_token, tableId: parsed.tableId };
  }
}
