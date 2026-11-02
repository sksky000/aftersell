import { z } from 'zod';

/** 试跑对比打分：AI 草稿相对客服实际回复 */
export const TRIAL_RATINGS = ['ready', 'minor', 'major', 'unusable'] as const;
export type TrialRating = (typeof TRIAL_RATINGS)[number];
export const TRIAL_RATING_LABELS: Record<TrialRating, string> = {
  ready: '可直接用',
  minor: '小改即可',
  major: '需要大改',
  unusable: '不能用',
};

export const rateTrialSchema = z
  .object({ rating: z.enum(TRIAL_RATINGS), note: z.string().trim().max(1000).nullable().default(null) })
  .strict();
export type RateTrialRequest = z.input<typeof rateTrialSchema>;
export type ParsedRateTrial = z.output<typeof rateTrialSchema>;

export const trialPairsQuerySchema = z
  .object({
    status: z.enum(['unrated', 'rated', 'all']).default('unrated'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type TrialPairsQuery = z.infer<typeof trialPairsQuerySchema>;

export interface TrialPairDto {
  emailId: string;
  subject: string | null;
  category: string;
  partType: string;
  receivedAt: string;
  /** 来信正文（去掉引用） */
  customer: string;
  /** AI 草稿（最新一版） */
  draft: string;
  draftVersion: number;
  /** 客服实际发出的第一封回复（去掉引用） */
  actual: string;
  actualSentAt: string;
  rating: TrialRating | null;
  note: string | null;
}

export interface TrialPairsResponse {
  items: TrialPairDto[];
  total: number;
}

export interface TrialSummaryDto {
  trialMode: boolean;
  /** 有 AI 草稿、也有客服实际回复、可以对比的来信 */
  pairs: number;
  rated: number;
  byRating: Record<TrialRating, number>;
  byCategory: { category: string; rated: number; usable: number }[];
}
