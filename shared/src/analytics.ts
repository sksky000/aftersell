import { z } from 'zod';

/** 统计按北京时间切天 */
export const ANALYTICS_TIMEZONE = 'Asia/Shanghai';
export const ANALYTICS_RANGES = [7, 14, 30, 90] as const;

export const analyticsQuerySchema = z
  .object({
    days: z.coerce
      .number()
      .int()
      .refine((d) => (ANALYTICS_RANGES as readonly number[]).includes(d), '时间范围只能是 7 / 14 / 30 / 90 天')
      .default(30),
  })
  .strict();
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export interface CountItem {
  key: string;
  count: number;
}

export interface AnalyticsDto {
  range: { days: number; from: string; to: string };
  overview: {
    /** 区间内收到的来信 */
    received: number;
    /** 区间内我方发出的回复（系统发送 + 邮箱客户端发送） */
    replied: number;
    /** 当前待审核（不受时间范围影响） */
    pendingNow: number;
    ignored: number;
  };
  /** 每天的来信数与回复数，日期为北京时间 YYYY-MM-DD */
  trend: { day: string; received: number; replied: number }[];
  byCategory: CountItem[];
  byPartType: CountItem[];
  timeliness: {
    /** 区间内来信中已有回复的封数 */
    repliedEmails: number;
    /** 首次回复用时（小时），没有数据时为 null */
    medianHours: number | null;
    p90Hours: number | null;
    /** 24 小时内首次回复的比例 0-1 */
    within24hRate: number | null;
  };
  /** 当前待审核按等待时长分组 */
  backlog: { bucket: '<1d' | '1-3d' | '3-7d' | '>7d'; count: number }[];
  aiQuality: {
    /** 区间内系统发出、带 AI 草稿的回复 */
    sentWithDraft: number;
    /** 其中未改动直接发出 */
    unedited: number;
    byCategory: { category: string; sent: number; edited: number }[];
    /** 区间内生成的草稿版本数，以及各类检查提示出现次数 */
    draftsGenerated: number;
    checks: CountItem[];
  };
  llm: {
    calls: number;
    failed: number;
    inputTokens: number;
    outputTokens: number;
    /** 按设置的单价估算（元）；有模型没配单价时只统计配了的部分 */
    costCny: number;
    /** 区间内用到、但没配置单价的模型 */
    unpricedModels: string[];
    bySlot: { slot: string; model: string; calls: number; failed: number; inputTokens: number; outputTokens: number; avgMs: number; costCny: number | null }[];
    byDay: { day: string; calls: number; costCny: number }[];
  };
}

/** 模型单价（元 / 百万 token），管理员按服务商价目填写 */
export const llmPriceSchema = z
  .object({
    model: z.string().trim().min(1, '模型名不能为空').max(100),
    inputPerMillion: z.number().min(0, '单价不能为负').max(10000),
    outputPerMillion: z.number().min(0, '单价不能为负').max(10000),
  })
  .strict();
export const llmPricingSchema = z
  .object({ prices: z.array(llmPriceSchema).max(50) })
  .strict()
  .refine((p) => new Set(p.prices.map((x) => x.model)).size === p.prices.length, '同一个模型只能填一行');
export type LlmPrice = z.infer<typeof llmPriceSchema>;
export type LlmPricing = z.infer<typeof llmPricingSchema>;
