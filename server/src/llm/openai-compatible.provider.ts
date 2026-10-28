import OpenAI from 'openai';
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { LlmResponseError, type CallOptions, type ChatTurn, type ImageInput, type LLMProvider, type LlmResult } from './provider';

/** 我们的三档 → DeepSeek 的 reasoning_effort（low / high / max） */
const DEEPSEEK_EFFORT: Record<NonNullable<CallOptions['effort']>, 'low' | 'high'> = { low: 'low', medium: 'high', high: 'high' };

/**
 * DeepSeek、阿里云百炼等 OpenAI 兼容接口。
 * 现用模型默认开启思考：思考过程在 reasoning_content，答案在 content，这里只取 content。
 */
export class OpenAiCompatibleProvider implements LLMProvider {
  private readonly client: OpenAI;
  /** 不接受 response_format 的模型，之后直接靠 prompt 约束 JSON */
  private readonly noJsonMode = new Set<string>();

  constructor(
    apiKey: string,
    baseURL: string,
    private readonly opts: { reasoningEffort: boolean },
  ) {
    this.client = new OpenAI({ apiKey, baseURL, timeout: 180_000, maxRetries: 2 });
  }

  private async complete(
    req: CallOptions,
    messages: ChatCompletionMessageParam[],
    extra: { temperature: number; json?: boolean },
  ): Promise<LlmResult> {
    const params: ChatCompletionCreateParamsNonStreaming = {
      model: req.model,
      max_tokens: req.maxTokens,
      temperature: extra.temperature,
      messages,
    };
    if (this.opts.reasoningEffort && req.effort) params.reasoning_effort = DEEPSEEK_EFFORT[req.effort];
    const json = extra.json && !this.noJsonMode.has(req.model);
    let res: ChatCompletion;
    try {
      res = await this.client.chat.completions.create(
        (json ? { ...params, response_format: { type: 'json_object' } } : params) as ChatCompletionCreateParamsNonStreaming,
      );
    } catch (error) {
      // 部分模型在思考模式下不支持 JSON mode：去掉后重试一次，结构由 prompt + zod 校验保证
      if (!json || !(error instanceof OpenAI.BadRequestError)) throw error;
      this.noJsonMode.add(req.model);
      res = await this.client.chat.completions.create(params);
    }
    const choice = res.choices[0];
    if (choice?.finish_reason === 'length') throw new LlmResponseError('模型输出被截断（超过 max_tokens）');
    if (choice?.finish_reason === 'content_filter') throw new LlmResponseError('模型因内容审核拒绝输出');
    return {
      text: choice?.message?.content ?? '',
      usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 },
    };
  }

  generate(req: CallOptions & { system: string; messages: ChatTurn[] }): Promise<LlmResult> {
    return this.complete(req, [{ role: 'system', content: req.system }, ...req.messages], { temperature: 0.3 });
  }

  extractJson(req: CallOptions & { system: string; messages: ChatTurn[]; jsonSchema: Record<string, unknown> }): Promise<LlmResult> {
    // JSON mode 只保证是合法 JSON，结构靠 schema 说明 + zod 校验
    const system = `${req.system}\n\n## 输出格式\n只输出一个 JSON 对象，不要输出其他文字。JSON 必须符合以下 JSON Schema：\n${JSON.stringify(req.jsonSchema)}`;
    return this.complete(req, [{ role: 'system', content: system }, ...req.messages], { temperature: 0, json: true });
  }

  vision(req: CallOptions & { prompt: string; images: ImageInput[] }): Promise<LlmResult> {
    return this.complete(
      req,
      [
        {
          role: 'user',
          content: [
            ...req.images.map((img) => ({
              type: 'image_url' as const,
              image_url: { url: `data:${img.mediaType};base64,${img.data.toString('base64')}` },
            })),
            { type: 'text' as const, text: req.prompt },
          ],
        },
      ],
      { temperature: 0 },
    );
  }
}
