import OpenAI from 'openai';
import type { ChatCompletion, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { LlmResponseError, type CallOptions, type ChatTurn, type ImageInput, type LLMProvider, type LlmResult } from './provider';

/** DeepSeek、阿里云百炼等 OpenAI 兼容接口 */
export class OpenAiCompatibleProvider implements LLMProvider {
  private readonly client: OpenAI;

  constructor(apiKey: string, baseURL: string) {
    this.client = new OpenAI({ apiKey, baseURL, timeout: 90_000, maxRetries: 2 });
  }

  private async complete(
    req: CallOptions,
    messages: ChatCompletionMessageParam[],
    extra: { temperature: number; json?: boolean },
  ): Promise<LlmResult> {
    const res: ChatCompletion = await this.client.chat.completions.create({
      model: req.model,
      max_tokens: req.maxTokens,
      temperature: extra.temperature,
      messages,
      ...(extra.json ? { response_format: { type: 'json_object' as const } } : {}),
    });
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
