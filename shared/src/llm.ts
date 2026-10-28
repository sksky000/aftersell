import { z } from 'zod';

/** 任务槽位：每个槽位单独选模型，设置页可改 */
export const LLM_SLOTS = ['classify', 'vision', 'draft', 'subject_tag', 'translate'] as const;
export type LlmSlot = (typeof LLM_SLOTS)[number];

export const LLM_SLOT_LABELS: Record<LlmSlot, { label: string; hint: string }> = {
  classify: { label: '分类', hint: '15 类分类、零件、紧急度、凭证缺失、是否我方产品' },
  vision: { label: '识图', hint: '附件图片识别；需要支持图片输入的模型' },
  draft: { label: '草稿', hint: 'M3 起使用' },
  subject_tag: { label: '主题标签', hint: 'M4 起使用' },
  translate: { label: '翻译', hint: 'M4 起使用' },
};

export const LLM_PROVIDERS = ['deepseek', 'dashscope', 'anthropic'] as const;
export type LlmProviderId = (typeof LLM_PROVIDERS)[number];

export const LLM_PROVIDER_INFO: Record<LlmProviderId, { label: string; envKey: string; vision: boolean; note: string }> = {
  deepseek: { label: 'DeepSeek', envKey: 'DEEPSEEK_API_KEY', vision: false, note: '国内直连；不支持图片输入' },
  dashscope: { label: '阿里云百炼（通义千问）', envKey: 'DASHSCOPE_API_KEY', vision: true, note: '国内直连；qwen-vl 系列支持图片' },
  anthropic: { label: 'Claude（Anthropic）', envKey: 'ANTHROPIC_API_KEY', vision: true, note: '只能在 Anthropic 支持的地区调用' },
};

export const EFFORTS = ['low', 'medium', 'high'] as const;

export const llmSlotConfigSchema = z
  .object({
    provider: z.enum(LLM_PROVIDERS),
    model: z.string().trim().min(1, '请填写模型名').max(100),
    /** 仅 Claude 使用 */
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
    classify: { provider: 'deepseek', model: 'deepseek-chat' },
    vision: { provider: 'dashscope', model: 'qwen-vl-max' },
    draft: { provider: 'deepseek', model: 'deepseek-chat' },
    subject_tag: { provider: 'deepseek', model: 'deepseek-chat' },
    translate: { provider: 'deepseek', model: 'deepseek-chat' },
  },
};

export interface LlmSettingsDto {
  settings: LlmSettings;
  /** 各服务的 API key 是否已在服务器 .env 配置 */
  providers: { id: LlmProviderId; configured: boolean }[];
}

export const llmTestSchema = z.object({ slot: z.enum(LLM_SLOTS) }).strict();

export interface LlmTestResult {
  ok: boolean;
  message: string;
  durationMs: number;
}
