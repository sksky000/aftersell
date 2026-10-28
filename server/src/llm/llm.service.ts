import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { z as z3 } from 'zod';
import { z } from 'zod/v4';
import {
  DEFAULT_LLM_SETTINGS,
  LLM_PROVIDERS,
  llmSettingsSchema,
  type LlmProviderId,
  type LlmProviderStatus,
  type LlmSettings,
  type LlmSettingsDto,
  type LlmSlot,
  type LlmSlotConfig,
  type LlmTestResult,
  type SaveLlmCredentialRequest,
} from '@aftersell/shared';
import { SecretBox } from '../common/secret-box';
import { env } from '../config/env';
import { DB, type Database } from '../db/db.module';
import { llmCall } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import { AnthropicProvider } from './anthropic.provider';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';
import type { ChatTurn, ImageInput, LLMProvider, LlmResult } from './provider';

const SETTINGS_KEY = 'llm.settings';
const CREDENTIALS_KEY = 'llm.credentials';

/** 槽位所选服务没有配置 API key */
export class LlmNotConfiguredError extends Error {}
/** 模型输出两次都没通过 schema 校验 */
export class LlmOutputError extends Error {}

export interface ProviderCredential {
  apiKey: string;
  baseUrl: string | null;
}

/** 设置页保存的 key：AES-256-GCM 密文（密钥 MAIL_SECRET_KEY），不存明文 */
const storedCredentialsSchema = z3.record(
  z3.enum(LLM_PROVIDERS),
  z3.object({ cipher: z3.string().nullable(), baseUrl: z3.string().nullable() }),
);
type StoredCredentials = Partial<Record<LlmProviderId, { cipher: string | null; baseUrl: string | null }>>;

function defaultBaseUrl(id: LlmProviderId): string | null {
  const e = env();
  return id === 'deepseek' ? e.DEEPSEEK_BASE_URL : id === 'dashscope' ? e.DASHSCOPE_BASE_URL : null;
}

function envKey(id: LlmProviderId): string | undefined {
  const e = env();
  return id === 'deepseek' ? e.DEEPSEEK_API_KEY : id === 'dashscope' ? e.DASHSCOPE_API_KEY : e.ANTHROPIC_API_KEY;
}

export function createProvider(id: LlmProviderId, cred: ProviderCredential | null): LLMProvider | null {
  if (!cred) return null;
  switch (id) {
    case 'deepseek':
      return new OpenAiCompatibleProvider(cred.apiKey, cred.baseUrl ?? env().DEEPSEEK_BASE_URL, { reasoningEffort: true });
    case 'dashscope':
      return new OpenAiCompatibleProvider(cred.apiKey, cred.baseUrl ?? env().DASHSCOPE_BASE_URL, { reasoningEffort: false });
    case 'anthropic':
      return new AnthropicProvider(cred.apiKey, cred.baseUrl ?? undefined);
  }
}

/** 去掉模型偶尔包在外面的 ```json 代码块 */
export function stripJsonFence(text: string): string {
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : text.trim();
}

/** 现用模型默认开启思考，思考可能占用 max_tokens，给足余量（按实际用量计费） */
function budget(maxTokens: number): number {
  return Math.max(maxTokens, 8000);
}

function describeIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

interface CallMeta {
  emailId?: string | null;
}

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private readonly box = new SecretBox(env().MAIL_SECRET_KEY);
  private readonly providers = new Map<LlmProviderId, LLMProvider>();
  private readonly status = new Map<LlmProviderId, LlmProviderStatus>();
  private readonly listeners: (() => Promise<void>)[] = [];

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settingsStore: SettingsService,
    /** 测试注入用 */
    @Inject('LLM_PROVIDER_FACTORY')
    private readonly factory: (id: LlmProviderId, cred: ProviderCredential | null) => LLMProvider | null = createProvider,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reloadProviders();
  }

  private async storedCredentials(): Promise<StoredCredentials> {
    return (await this.settingsStore.get(CREDENTIALS_KEY, storedCredentialsSchema, {})) as StoredCredentials;
  }

  /** 设置页填写的 key 优先，其次服务器 .env */
  async reloadProviders(): Promise<void> {
    const stored = await this.storedCredentials();
    for (const id of LLM_PROVIDERS) {
      const saved = stored[id];
      let apiKey: string | null = null;
      let source: LlmProviderStatus['source'] = null;
      if (saved?.cipher) {
        try {
          apiKey = this.box.decrypt(saved.cipher);
          source = 'settings';
        } catch {
          this.logger.error(`${id} 的 API key 无法解密（MAIL_SECRET_KEY 变更过？），请在设置页重新填写`);
        }
      }
      if (!apiKey && envKey(id)) {
        apiKey = envKey(id) ?? null;
        source = 'env';
      }
      const baseUrl = saved?.baseUrl ?? null;
      const provider = this.factory(id, apiKey ? { apiKey, baseUrl } : null);
      if (provider) this.providers.set(id, provider);
      else this.providers.delete(id);
      this.status.set(id, {
        id,
        configured: Boolean(provider),
        source: provider ? source : null,
        keyHint: provider && apiKey ? apiKey.slice(-4) : null,
        baseUrl,
        defaultBaseUrl: defaultBaseUrl(id),
      });
    }
  }

  async settings(): Promise<LlmSettings> {
    const saved = await this.settingsStore.get(SETTINGS_KEY, llmSettingsSchema, DEFAULT_LLM_SETTINGS);
    return { slots: { ...DEFAULT_LLM_SETTINGS.slots, ...saved.slots } };
  }

  async settingsDto(): Promise<LlmSettingsDto> {
    return {
      settings: await this.settings(),
      providers: LLM_PROVIDERS.map(
        (id) =>
          this.status.get(id) ?? {
            id,
            configured: this.providers.has(id),
            source: null,
            keyHint: null,
            baseUrl: null,
            defaultBaseUrl: defaultBaseUrl(id),
          },
      ),
    };
  }

  /** 配置或 key 保存后通知（处理队列据此补跑未分类的邮件） */
  onSettingsChanged(listener: () => Promise<void>): void {
    this.listeners.push(listener);
  }

  private async notify(): Promise<void> {
    for (const listener of this.listeners) await listener().catch((e: unknown) => this.logger.warn(String(e)));
  }

  async saveSettings(actorId: string, settings: LlmSettings): Promise<LlmSettingsDto> {
    await this.settingsStore.set(SETTINGS_KEY, settings, actorId);
    this.logger.log(`模型配置已更新 by=${actorId}`);
    await this.notify();
    return this.settingsDto();
  }

  async saveCredential(actorId: string, id: LlmProviderId, req: SaveLlmCredentialRequest): Promise<LlmSettingsDto> {
    const stored = await this.storedCredentials();
    const prev = stored[id] ?? { cipher: null, baseUrl: null };
    stored[id] = {
      cipher: req.apiKey !== undefined ? this.box.encrypt(req.apiKey) : prev.cipher,
      baseUrl: req.baseUrl !== undefined ? req.baseUrl : prev.baseUrl,
    };
    await this.settingsStore.set(CREDENTIALS_KEY, stored, actorId);
    this.logger.log(`模型服务 ${id} 的凭据已更新 by=${actorId} keyChanged=${req.apiKey !== undefined}`);
    await this.reloadProviders();
    await this.notify();
    return this.settingsDto();
  }

  async clearCredential(actorId: string, id: LlmProviderId): Promise<LlmSettingsDto> {
    const stored = await this.storedCredentials();
    delete stored[id];
    await this.settingsStore.set(CREDENTIALS_KEY, stored, actorId);
    this.logger.log(`模型服务 ${id} 的凭据已删除 by=${actorId}`);
    await this.reloadProviders();
    return this.settingsDto();
  }

  async isAvailable(slot: LlmSlot): Promise<boolean> {
    return this.providers.has((await this.settings()).slots[slot].provider);
  }

  private async resolve(slot: LlmSlot): Promise<{ config: LlmSlotConfig; provider: LLMProvider }> {
    const config = (await this.settings()).slots[slot];
    const provider = this.providers.get(config.provider);
    if (!provider) throw new LlmNotConfiguredError(`${slot} 槽位所选服务未配置 API key`);
    return { config, provider };
  }

  /** 调用并写 llm_call；不记录原文，只记录输入哈希 */
  private async invoke(
    slot: LlmSlot,
    config: LlmSlotConfig,
    meta: CallMeta,
    input: unknown,
    run: () => Promise<LlmResult>,
  ): Promise<LlmResult> {
    const started = Date.now();
    const inputHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    let result: LlmResult | null = null;
    let error: unknown = null;
    try {
      result = await run();
      return result;
    } catch (err) {
      error = err;
      throw err;
    } finally {
      await this.db
        .insert(llmCall)
        .values({
          slot,
          provider: config.provider,
          model: config.model,
          emailId: meta.emailId ?? null,
          ok: result !== null,
          inputTokens: result?.usage.inputTokens ?? 0,
          outputTokens: result?.usage.outputTokens ?? 0,
          durationMs: Date.now() - started,
          inputHash,
          error: error ? String(error instanceof Error ? error.message : error).slice(0, 1000) : null,
        })
        .catch((e: unknown) => this.logger.warn(`llm_call 记录失败: ${String(e)}`));
    }
  }

  /**
   * 强制 JSON 输出并用 zod 校验；不通过时把错误回馈给模型重试一次，
   * 再不通过抛 LlmOutputError，由调用方走兜底。
   */
  async extract<T>(
    slot: LlmSlot,
    req: { system: string; user: string; schema: z.ZodType<T>; maxTokens: number },
    meta: CallMeta = {},
  ): Promise<{ data: T; config: LlmSlotConfig }> {
    const { config, provider } = await this.resolve(slot);
    const jsonSchema = z.toJSONSchema(req.schema, { target: 'draft-7' }) as Record<string, unknown>;
    const messages: ChatTurn[] = [{ role: 'user', content: req.user }];
    let lastProblem = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await this.invoke(slot, config, meta, { system: req.system, messages, model: config.model }, () =>
        provider.extractJson({ model: config.model, maxTokens: budget(req.maxTokens), effort: config.effort, system: req.system, messages, jsonSchema }),
      );
      let parsed: unknown;
      try {
        parsed = JSON.parse(stripJsonFence(result.text));
      } catch {
        lastProblem = result.text.trim() ? '输出不是合法的 JSON' : '输出为空';
        messages.push(
          { role: 'assistant', content: result.text || '(empty)' },
          { role: 'user', content: '你的输出不是合法的 JSON。请只输出符合 schema 的 JSON 对象。' },
        );
        continue;
      }
      const checked = req.schema.safeParse(parsed);
      if (checked.success) return { data: checked.data, config };
      lastProblem = describeIssues(checked.error);
      messages.push(
        { role: 'assistant', content: result.text },
        { role: 'user', content: `你的输出未通过校验：${lastProblem}。请修正后只输出完整的 JSON 对象。` },
      );
    }
    throw new LlmOutputError(`模型输出两次未通过校验：${lastProblem}`);
  }

  async vision(
    slot: LlmSlot,
    req: { prompt: string; images: ImageInput[]; maxTokens: number },
    meta: CallMeta = {},
  ): Promise<{ text: string; config: LlmSlotConfig }> {
    const { config, provider } = await this.resolve(slot);
    const input = { prompt: req.prompt, images: req.images.map((i) => createHash('sha256').update(i.data).digest('hex')) };
    const result = await this.invoke(slot, config, meta, input, () =>
      provider.vision({ model: config.model, maxTokens: budget(req.maxTokens), effort: config.effort, prompt: req.prompt, images: req.images }),
    );
    return { text: result.text.trim(), config };
  }

  /** 设置页“测试”：发一条极短的请求，确认 key、模型名和网络都可用 */
  async test(slot: LlmSlot): Promise<LlmTestResult> {
    const started = Date.now();
    try {
      const { config, provider } = await this.resolve(slot);
      const result = await this.invoke(slot, config, {}, { test: true }, () =>
        provider.generate({
          model: config.model,
          maxTokens: budget(20),
          effort: 'low',
          system: 'Reply with the single word OK.',
          messages: [{ role: 'user', content: 'ping' }],
        }),
      );
      return { ok: true, message: `调用成功：${result.text.trim().slice(0, 40) || '（空回复）'}`, durationMs: Date.now() - started };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started };
    }
  }
}
