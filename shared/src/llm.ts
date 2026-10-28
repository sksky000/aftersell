import { z } from 'zod';

/** 任务槽位：每个槽位单独选模型，设置页可改 */
export const LLM_SLOTS = ['classify', 'vision', 'draft', 'subject_tag', 'translate'] as const;
export type LlmSlot = (typeof LLM_SLOTS)[number];

export const LLM_SLOT_LABELS: Record<LlmSlot, { label: string; hint: string }> = {
  classify: { label: '分类', hint: '15 类分类、零件、紧急度、凭证缺失、是否我方产品' },
  vision: { label: '识图', hint: '附件图片识别；需要支持图片输入的模型' },
  draft: { label: '草稿', hint: '英文回复草稿' },
  subject_tag: { label: '主题标签', hint: 'M4 起使用' },
  translate: { label: '翻译', hint: 'M4 起使用' },
};

export const LLM_PROVIDERS = ['deepseek', 'dashscope', 'anthropic'] as const;
export type LlmProviderId = (typeof LLM_PROVIDERS)[number];

export const LLM_PROVIDER_INFO: Record<
  LlmProviderId,
  { label: string; envKey: string; vision: boolean; effort: boolean; note: string; keyUrl: string }
> = {
  deepseek: {
    label: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
    vision: false,
    effort: true,
    note: '国内直连；不支持图片输入；默认开启思考',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  dashscope: {
    label: '阿里云百炼（千问）',
    envKey: 'DASHSCOPE_API_KEY',
    vision: true,
    effort: false,
    note: '国内直连；qwen3.8 系列支持图片与视频',
    keyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
  },
  anthropic: {
    label: 'Claude（Anthropic）',
    envKey: 'ANTHROPIC_API_KEY',
    vision: true,
    effort: true,
    note: '只能在 Anthropic 支持的地区调用',
    keyUrl: 'https://platform.claude.com/settings/keys',
  },
};

/** 思考深度：DeepSeek 与 Claude 支持；不选则用服务默认值 */
export const EFFORTS = ['low', 'medium', 'high'] as const;

export const llmSlotConfigSchema = z
  .object({
    provider: z.enum(LLM_PROVIDERS),
    model: z.string().trim().min(1, '请填写模型名').max(100),
    effort: z.enum(EFFORTS).optional(),
  })
  .strict();
export type LlmSlotConfig = z.infer<typeof llmSlotConfigSchema>;

export const llmSettingsSchema = z
  .object({ slots: z.object(Object.fromEntries(LLM_SLOTS.map((s) => [s, llmSlotConfigSchema])) as Record<LlmSlot, typeof llmSlotConfigSchema>).strict() })
  .strict()
  .superRefine((v, ctx) => {
    if (!LLM_PROVIDER_INFO[v.slots.vision.provider].vision) {
      ctx.addIssue({ code: 'custom', path: ['slots', 'vision', 'provider'], message: `${LLM_PROVIDER_INFO[v.slots.vision.provider].label} 不支持图片输入，识图请选其他服务` });
    }
  });
export type LlmSettings = z.infer<typeof llmSettingsSchema>;

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  slots: {
    classify: { provider: 'deepseek', model: 'deepseek-v4-pro' },
    vision: { provider: 'dashscope', model: 'qwen3.8-max' },
    draft: { provider: 'deepseek', model: 'deepseek-v4-pro' },
    subject_tag: { provider: 'deepseek', model: 'deepseek-v4-pro' },
    translate: { provider: 'deepseek', model: 'deepseek-v4-pro' },
  },
};

export interface LlmProviderStatus {
  id: LlmProviderId;
  configured: boolean;
  /** key 来源：设置页填写，或服务器 .env */
  source: 'settings' | 'env' | null;
  /** key 末 4 位，便于核对是哪一个 */
  keyHint: string | null;
  /** 自定义接口地址；null 表示用默认地址 */
  baseUrl: string | null;
  defaultBaseUrl: string | null;
}

export interface LlmSettingsDto {
  settings: LlmSettings;
  providers: LlmProviderStatus[];
}

/** 设置页保存某个服务的 key / 接口地址；留空的字段不修改 */
export const saveLlmCredentialSchema = z
  .object({
    apiKey: z.string().trim().min(8, 'API key 太短').max(500).optional(),
    baseUrl: z.string().trim().url('接口地址格式不正确').nullable().optional(),
  })
  .strict()
  .refine((v) => v.apiKey !== undefined || v.baseUrl !== undefined, '没有要保存的内容');
export type SaveLlmCredentialRequest = z.infer<typeof saveLlmCredentialSchema>;

export const llmTestSchema = z.object({ slot: z.enum(LLM_SLOTS) }).strict();

export interface LlmTestResult {
  ok: boolean;
  message: string;
  durationMs: number;
}
