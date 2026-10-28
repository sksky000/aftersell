export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmResult {
  text: string;
  usage: LlmUsage;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ImageInput {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  data: Buffer;
}

export interface CallOptions {
  model: string;
  maxTokens: number;
  /** 仅 Claude 使用 */
  effort?: 'low' | 'medium' | 'high';
}

/** 模型适配器：DeepSeek / 百炼（OpenAI 兼容）、Claude；测试用 fake */
export interface LLMProvider {
  generate(req: CallOptions & { system: string; messages: ChatTurn[] }): Promise<LlmResult>;
  /** 返回 JSON 文本，由 LlmService 用 zod 校验 */
  extractJson(req: CallOptions & { system: string; messages: ChatTurn[]; jsonSchema: Record<string, unknown> }): Promise<LlmResult>;
  vision(req: CallOptions & { prompt: string; images: ImageInput[] }): Promise<LlmResult>;
}

/** 输出被截断、被拒绝等：重试也不会变好的错误 */
export class LlmResponseError extends Error {}
