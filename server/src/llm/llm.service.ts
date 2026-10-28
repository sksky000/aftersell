import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod/v4';
import {
  DEFAULT_LLM_SETTINGS,
  LLM_PROVIDERS,
  llmSettingsSchema,
  type LlmProviderId,
  type LlmSettings,
  type LlmSettingsDto,
  type LlmSlot,
  type LlmSlotConfig,
  type LlmTestResult,
} from '@aftersell/shared';
import { env } from '../config/env';
import { DB, type Database } from '../db/db.module';
import { llmCall } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import { AnthropicProvider } from './anthropic.provider';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';
import type { ChatTurn, ImageInput, LLMProvider, LlmResult } from './provider';

const SETTINGS_KEY = 'llm.settings';

/** 槽位所选服务没有配置 API key */
export class LlmNotConfiguredError extends Error {}
/** 模型输出两次都没通过 schema 校验 */
export class LlmOutputError extends Error {}

export function providerFromEnv(id: LlmProviderId): LLMProvider | null {
  const e = env();
  switch (id) {
    case 'deepseek':
      return e.DEEPSEEK_API_KEY ? new OpenAiCompatibleProvider(e.DEEPSEEK_API_KEY, e.DEEPSEEK_BASE_URL) : null;
    case 'dashscope':
      return e.DASHSCOPE_API_KEY ? new OpenAiCompatibleProvider(e.DASHSCOPE_API_KEY, e.DASHSCOPE_BASE_URL) : null;
    case 'anthropic':
      return e.ANTHROPIC_API_KEY ? new AnthropicProvider(e.ANTHROPIC_API_KEY) : null;
  }
}

/** 去掉模型偶尔包在外面的 ```json 代码块 */
export function stripJsonFence(text: string): string {
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : text.trim();
}

/** Claude 默认开启自适应思考，思考也占 max_tokens，给足余量 */
function budget(config: LlmSlotConfig, maxTokens: number): number {
  return config.provider === 'anthropic' ? Math.max(maxTokens, 8000) : maxTokens;
}

function describeIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

interface CallMeta {
  emailId?: string | null;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly providers = new Map<LlmProviderId, LLMProvider>();
  private readonly listeners: (() => Promise<void>)[] = [];

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settingsStore: SettingsService,
    /** 测试注入用；生产按 .env 创建 */
    @Inject('LLM_PROVIDER_FACTORY') private readonly factory: (id: LlmProviderId) => LLMProvider | null = providerFromEnv,
  ) {
    for (const id of LLM_PROVIDERS) {
      const provider = this.factory(id);
      if (provider) this.providers.set(id, provider);
    }
  }

  async settings(): Promise<LlmSettings> {
    const saved = await this.settingsStore.get(SETTINGS_KEY, llmSettingsSchema, DEFAULT_LLM_SETTINGS);
    return { slots: { ...DEFAULT_LLM_SETTINGS.slots, ...saved.slots } };
  }

  async settingsDto(): Promise<LlmSettingsDto> {
    return {
      settings: await this.settings(),
      providers: LLM_PROVIDERS.map((id) => ({ id, configured: this.providers.has(id) })),
    };
  }

  /** 配置保存后通知（处理队列据此补跑未分类的邮件） */
  onSettingsChanged(listener: () => Promise<void>): void {
    this.listeners.push(listener);
  }

  async saveSettings(actorId: string, settings: LlmSettings): Promise<LlmSettingsDto> {
    await this.settingsStore.set(SETTINGS_KEY, settings, actorId);
    this.logger.log(`模型配置已更新 by=${actorId}`);
    for (const listener of this.listeners) await listener().catch((e: unknown) => this.logger.warn(String(e)));
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
        provider.extractJson({ model: config.model, maxTokens: budget(config, req.maxTokens), effort: config.effort, system: req.system, messages, jsonSchema }),
      );
      let parsed: unknown;
      try {
        parsed = JSON.parse(stripJsonFence(result.text));
      } catch {
        lastProblem = '输出不是合法的 JSON';
        messages.push({ role: 'assistant', content: result.text }, { role: 'user', content: `你的输出不是合法的 JSON。请只输出符合 schema 的 JSON 对象。` });
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
      provider.vision({ model: config.model, maxTokens: budget(config, req.maxTokens), effort: config.effort, prompt: req.prompt, images: req.images }),
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
          maxTokens: budget(config, 20),
          effort: config.effort,
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
