import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, gt, ilike, inArray, isNotNull, lt, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FeishuTestResult, LedgerStatusDto, LedgerTableResult } from '@aftersell/shared';
import { DB, type Database } from '../db/db.module';
import { emailAttachment, emailMessage, ledgerRow } from '../db/schema';
import { customerIdentity } from '../mail/case-association';
import { senderDirectory } from '../mail/sender-directory';
import { SettingsService } from '../settings/settings.service';
import { STORAGE, type Storage } from '../storage/storage';
import { describeFeishuError, FeishuError, FeishuService } from './feishu.service';
import { adaptToTable, buildLedgerRecord, FIELD_TYPES, LEDGER_FIELDS, type LedgerEmail } from './ledger-record';
import { LEDGER_TABLE_FIELDS } from './ledger-table';

const CURSOR_KEY = 'feishu.ledger_cursor';
const TICK_MS = 60_000;
const BATCH = 200;
const RETRY_LIMIT = 20;
const RETRY_AFTER_MS = 10 * 60_000;
const MEDIA_FIELD = '图片和视频';
/** 飞书素材上传单文件上限 20MB；每个客户最多传 10 个 */
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const MAX_MEDIA = 10;
const RECORD_NOT_FOUND = 1254043;

const cursorSchema = z.object({ at: z.string() });

/**
 * 飞书台账同步：每分钟看一次哪些客诉邮件有变化（入库分类、发出回复都会更新 updated_at），
 * 把对应客户的那一行整体重算后写进多维表格。每个客户一行（同妙搭），附件只传一次。
 */
@Injectable()
export class LedgerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(LedgerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastSyncAt: Date | null = null;
  private lastMessage: string | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: Storage,
    private readonly feishu: FeishuService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async status(): Promise<LedgerStatusDto> {
    const [{ rows }] = await this.db.select({ rows: sql<number>`count(${ledgerRow.recordId})::int` }).from(ledgerRow);
    const failed = await this.db
      .select({ customer: ledgerRow.customerKey, error: ledgerRow.lastError })
      .from(ledgerRow)
      .where(isNotNull(ledgerRow.lastError))
      .limit(20);
    return {
      enabled: await this.feishu.ledgerEnabled(),
      rows,
      failed: failed.map((f) => ({ customer: f.customer, error: f.error ?? '' })),
      lastSyncAt: this.lastSyncAt?.toISOString() ?? null,
      lastMessage: this.lastMessage,
      running: this.running,
    };
  }

  /** 全部重新同步：游标归零，下一轮把所有客诉客户重算一遍 */
  async resyncAll(actorId: string): Promise<void> {
    await this.settings.set(CURSOR_KEY, { at: new Date(0).toISOString() }, actorId);
    void this.tick();
  }

  private async tableFields(appToken: string, tableId: string, token: string): Promise<Map<string, number>> {
    const r = await this.feishu.call<{ items: { field_name: string; type: number }[] }>(`/bitable/v1/apps/${appToken}/tables/${tableId}/fields?page_size=100`, { token });
    return new Map(r.items.map((f) => [f.field_name, f.type]));
  }

  /** 设置页“测试”：凭证、表权限、字段对得上几个 */
  async test(): Promise<FeishuTestResult> {
    try {
      const token = await this.feishu.tenantToken();
      if (!(await this.feishu.ledgerEnabled())) return { ok: true, message: '应用凭证正确（台账同步未开启，没有检查表格）', fields: [] };
      const { appToken, tableId } = await this.feishu.ledgerTable();
      const fields = await this.tableFields(appToken, tableId, token);
      const used = new Set<string>(LEDGER_FIELDS);
      const list = [...fields.keys()].map((name) => ({ name, used: used.has(name) }));
      const matched = list.filter((f) => f.used).length;
      return { ok: matched > 0, message: matched ? `连接正常，表里 ${fields.size} 个字段，系统会写其中 ${matched} 个` : '连接正常，但表里没有系统会写的字段，请确认是复制妙搭台账结构的表', fields: list };
    } catch (error) {
      return { ok: false, message: describeFeishuError(error), fields: [] };
    }
  }

  /**
   * 用应用身份新建一张台账（结构同妙搭台账），共享给指定的飞书邮箱，并把同步指向它。
   * 表建在应用自己的云空间里，只有被共享的人能看到（在飞书“云文档 → 与我共享”里）。
   */
  async createTable(actorId: string, shareEmail: string): Promise<LedgerTableResult> {
    const token = await this.feishu.tenantToken();
    const app = await this.feishu.call<{ app: { app_token: string; url: string; default_table_id?: string } }>('/bitable/v1/apps', {
      token,
      body: { name: `售后台账（测试）${new Date().toISOString().slice(0, 10)}` },
    });
    const appToken = app.app.app_token;
    const table = await this.feishu.call<{ table_id: string }>(`/bitable/v1/apps/${appToken}/tables`, {
      token,
      body: { table: { name: '台账', default_view_name: '全部', fields: LEDGER_TABLE_FIELDS } },
    });
    // 新建的多维表格自带一张空表，删掉免得混淆；失败不影响使用
    if (app.app.default_table_id) {
      await this.feishu.call(`/bitable/v1/apps/${appToken}/tables/${app.app.default_table_id}`, { method: 'DELETE', token }).catch(() => undefined);
    }
    const url = `${app.app.url}?table=${table.table_id}`;
    await this.feishu.setLedger(actorId, url);
    this.logger.log(`已新建飞书台账 by=${actorId}`);
    const shared = await this.share(shareEmail);
    return { url, shared: shared.shared, message: shared.shared ? `已建好并共享给 ${shareEmail}` : `表格已建好，但共享失败：${shared.message}` };
  }

  /** 把当前台账表共享给一个飞书邮箱（可管理权限） */
  async share(email: string): Promise<LedgerTableResult> {
    try {
      const token = await this.feishu.tenantToken();
      const { appToken } = await this.feishu.ledgerTable();
      await this.feishu.call(`/drive/v1/permissions/${appToken}/members?type=bitable&need_notification=true`, {
        token,
        body: { member_type: 'email', member_id: email, perm: 'full_access' },
      });
      return { url: null, shared: true, message: `已共享给 ${email}` };
    } catch (error) {
      return { url: null, shared: false, message: describeFeishuError(error) };
    }
  }

  private async tick(): Promise<void> {
    if (this.running || !(await this.feishu.ledgerEnabled().catch(() => false))) return;
    this.running = true;
    try {
      const cursor = (await this.settings.get(CURSOR_KEY, cursorSchema.nullable(), null))?.at ?? new Date(0).toISOString();
      const changed = await this.db
        .select({ messageId: emailMessage.messageId, fromAddress: emailMessage.fromAddress, subject: emailMessage.subject, bodyText: emailMessage.bodyText, updatedAt: emailMessage.updatedAt })
        .from(emailMessage)
        .where(and(gt(emailMessage.updatedAt, new Date(cursor)), eq(emailMessage.isComplaint, true), ne(emailMessage.pipelineState, 'ingested')))
        .orderBy(asc(emailMessage.updatedAt))
        .limit(BATCH);
      // 失败的客户 10 分钟后再试，避免权限类问题每分钟刷一遍
      const retry = await this.db
        .select({ key: ledgerRow.customerKey })
        .from(ledgerRow)
        .where(and(isNotNull(ledgerRow.lastError), lt(ledgerRow.updatedAt, new Date(Date.now() - RETRY_AFTER_MS))))
        .limit(RETRY_LIMIT);
      const keys = new Set([...changed.map((c) => customerIdentity(c)).filter((k): k is string => Boolean(k)), ...retry.map((r) => r.key)]);
      if (!keys.size && !changed.length) return;

      const token = await this.feishu.tenantToken();
      const { appToken, tableId } = await this.feishu.ledgerTable();
      const fields = await this.tableFields(appToken, tableId, token);
      let ok = 0;
      let failed = 0;
      for (const key of keys) {
        if (await this.syncCustomer(key, { token, appToken, tableId, fields })) ok += 1;
        else failed += 1;
      }
      if (changed.length) await this.settings.set(CURSOR_KEY, { at: changed[changed.length - 1].updatedAt.toISOString() }, null);
      this.lastSyncAt = new Date();
      this.lastMessage = `更新 ${ok} 个客户${failed ? `，失败 ${failed} 个` : ''}`;
      this.logger.log(`飞书台账：${this.lastMessage}`);
    } catch (error) {
      this.lastSyncAt = new Date();
      this.lastMessage = describeFeishuError(error);
      this.logger.warn(`飞书台账同步失败: ${this.lastMessage}`);
    } finally {
      this.running = false;
    }
  }

  /** 这个客户的全部客诉来信（领导转发、热线工单都按客户身份归到一起） */
  private async caseEmails(key: string): Promise<(LedgerEmail & { attachmentIds: string[] })[]> {
    const like = `%${key.replace(/[%_\\]/g, '\\$&')}%`;
    const hotline = [...senderDirectory().hotline];
    const candidates = await this.db
      .select()
      .from(emailMessage)
      .where(
        and(
          eq(emailMessage.isComplaint, true),
          ne(emailMessage.pipelineState, 'ingested'),
          key.startsWith('hotline:')
            ? hotline.length
              ? inArray(sql`lower(${emailMessage.fromAddress})`, hotline)
              : sql`false`
            : or(sql`lower(${emailMessage.fromAddress}) = ${key}`, ilike(emailMessage.bodyText, like)),
        ),
      )
      .limit(500);
    const rows = candidates.filter((r) => customerIdentity(r) === key);
    if (!rows.length) return [];
    const media = await this.db
      .select({ id: emailAttachment.id, emailId: emailAttachment.emailId, contentType: emailAttachment.contentType })
      .from(emailAttachment)
      .where(inArray(emailAttachment.emailId, rows.map((r) => r.id)));
    return rows.map((r) => {
      const mine = media.filter((m) => m.emailId === r.id && /^(image|video)\//.test(m.contentType));
      return {
        id: r.id,
        subject: r.subject,
        fromAddress: r.fromAddress,
        fromName: r.fromName,
        bodyText: r.bodyText,
        receivedAt: r.receivedAt,
        createdAt: r.createdAt,
        category: r.category,
        partType: r.partType,
        urgency: r.urgency,
        status: r.status,
        summary: r.summary,
        hasMedia: mine.length > 0,
        attachmentIds: mine.map((m) => m.id),
      };
    });
  }

  /** 上传还没传过的图片 / 视频，返回该客户全部附件的 file_token */
  private async uploadMedia(attachmentIds: string[], known: Record<string, string>, appToken: string, token: string): Promise<Record<string, string>> {
    const tokens = { ...known };
    const todo = attachmentIds.filter((id) => !tokens[id]).slice(0, Math.max(0, MAX_MEDIA - Object.keys(tokens).length));
    if (!todo.length) return tokens;
    const files = await this.db.select().from(emailAttachment).where(inArray(emailAttachment.id, todo));
    for (const f of files) {
      if (f.size > MAX_MEDIA_BYTES) continue;
      const { stream } = await this.storage.open(f.storageKey);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      const content = Buffer.concat(chunks);
      const form = new FormData();
      form.append('file_name', f.filename.slice(0, 200));
      form.append('parent_type', f.contentType.startsWith('image/') ? 'bitable_image' : 'bitable_file');
      form.append('parent_node', appToken);
      form.append('size', String(content.length));
      form.append('file', new Blob([content], { type: f.contentType }), f.filename.slice(0, 200));
      const r = await this.feishu.call<{ file_token: string }>('/drive/v1/medias/upload_all', { token, form });
      tokens[f.id] = r.file_token;
    }
    return tokens;
  }

  private async syncCustomer(key: string, ctx: { token: string; appToken: string; tableId: string; fields: Map<string, number> }): Promise<boolean> {
    const [existing] = await this.db.select().from(ledgerRow).where(eq(ledgerRow.customerKey, key)).limit(1);
    try {
      const emails = await this.caseEmails(key);
      if (!emails.length) return true;
      const fields = adaptToTable(buildLedgerRecord(key, emails), ctx.fields);
      let fileTokens = existing?.fileTokens ?? {};
      if (ctx.fields.get(MEDIA_FIELD) === FIELD_TYPES.attachment) {
        fileTokens = await this.uploadMedia(emails.flatMap((e) => e.attachmentIds), fileTokens, ctx.appToken, ctx.token);
        const list = Object.values(fileTokens);
        if (list.length) fields[MEDIA_FIELD] = list.map((file_token) => ({ file_token }));
      }
      const base = `/bitable/v1/apps/${ctx.appToken}/tables/${ctx.tableId}/records`;
      let recordId = existing?.recordId ?? null;
      if (recordId) {
        try {
          await this.feishu.call(`${base}/${recordId}`, { method: 'PUT', token: ctx.token, body: { fields } });
        } catch (error) {
          // 台账里这行被人删了：重建
          if (!(error instanceof FeishuError && error.code === RECORD_NOT_FOUND)) throw error;
          recordId = null;
        }
      }
      if (!recordId) {
        const r = await this.feishu.call<{ record: { record_id: string } }>(base, { token: ctx.token, body: { fields } });
        recordId = r.record.record_id;
      }
      const values = { recordId, fileTokens, syncedAt: new Date(), lastError: null, updatedAt: new Date() };
      await this.db.insert(ledgerRow).values({ customerKey: key, ...values }).onConflictDoUpdate({ target: ledgerRow.customerKey, set: values });
      return true;
    } catch (error) {
      const message = describeFeishuError(error).slice(0, 500);
      await this.db
        .insert(ledgerRow)
        .values({ customerKey: key, lastError: message })
        .onConflictDoUpdate({ target: ledgerRow.customerKey, set: { lastError: message, updatedAt: new Date() } });
      return false;
    }
  }
}
