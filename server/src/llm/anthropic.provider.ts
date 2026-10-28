import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { LlmResponseError, type CallOptions, type ChatTurn, type ImageInput, type LLMProvider, type LlmResult } from './provider';

/** 这些模型支持服务端拒答回退（fallbacks: "default"），被安全分类器拒绝时自动换模型重跑 */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

/** Claude；只能在 Anthropic 支持的地区调用 */
export class AnthropicProvider implements LLMProvider {
  private readonly client: Anthropic;

  constructor(apiKey: string, baseURL?: string) {
    this.client = new Anthropic({ apiKey, baseURL, timeout: 180_000, maxRetries: 2 });
  }

  private async call(
    req: CallOptions,
    system: string | undefined,
    messages: BetaMessageParam[],
    jsonSchema?: Record<string, unknown>,
  ): Promise<LlmResult> {
    const fallback = FALLBACK_MODELS.has(req.model);
    const res: BetaMessage = await this.client.beta.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      ...(system ? { system } : {}),
      messages,
      output_config: {
        ...(req.effort ? { effort: req.effort } : {}),
        ...(jsonSchema ? { format: { type: 'json_schema' as const, schema: jsonSchema } } : {}),
      },
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });
    if (res.stop_reason === 'refusal') {
      throw new LlmResponseError(`Claude 拒绝了该请求（${res.stop_details?.category ?? '未说明类别'}）`);
    }
    if (res.stop_reason === 'max_tokens') throw new LlmResponseError('模型输出被截断（超过 max_tokens）');
    const text = res.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
    return {
      text,
      usage: {
        inputTokens:
          res.usage.input_tokens + (res.usage.cache_creation_input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0),
        outputTokens: res.usage.output_tokens,
      },
    };
  }

  generate(req: CallOptions & { system: string; messages: ChatTurn[] }): Promise<LlmResult> {
    return this.call(req, req.system, req.messages);
  }

  extractJson(req: CallOptions & { system: string; messages: ChatTurn[]; jsonSchema: Record<string, unknown> }): Promise<LlmResult> {
    return this.call(req, req.system, req.messages, req.jsonSchema);
  }

  vision(req: CallOptions & { prompt: string; images: ImageInput[] }): Promise<LlmResult> {
    return this.call(req, undefined, [
      {
        role: 'user',
        content: [
          ...req.images.map((img) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: img.mediaType, data: img.data.toString('base64') },
          })),
          { type: 'text' as const, text: req.prompt },
        ],
      },
    ]);
  }
}
