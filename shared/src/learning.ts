import { z } from 'zod';

// ---------- 历史导入（生产邮箱“已发送”，只读） ----------

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');

export const saveHistoryAccountSchema = z
  .object({
    emailAddress: z.string().trim().toLowerCase().email('邮箱账号格式不正确'),
    /** 留空表示不修改已保存的授权码 */
    authCode: z.string().max(256).optional(),
    imapHost: z.string().trim().toLowerCase().min(1).max(255),
    imapPort: z.number().int().min(1).max(65535),
  })
  .strict();
export type SaveHistoryAccountRequest = z.infer<typeof saveHistoryAccountSchema>;

export interface HistoryAccountDto {
  emailAddress: string;
  imapHost: string;
  imapPort: number;
  hasAuthCode: boolean;
}

export const startHistoryImportSchema = z
  .object({ dateFrom: dateString, dateTo: dateString.nullable() })
  .strict()
  .refine((d) => !d.dateTo || d.dateFrom <= d.dateTo, { message: '开始日期不能晚于结束日期', path: ['dateTo'] });
export type StartHistoryImportRequest = z.infer<typeof startHistoryImportSchema>;

export const LEARNING_JOBS = ['import', 'label', 'cards', 'styles'] as const;
export type LearningJob = (typeof LEARNING_JOBS)[number];

export interface LearningJobState {
  state: 'idle' | 'running' | 'done' | 'failed';
  message: string | null;
  done: number;
  total: number;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface HistoryCluster {
  category: string;
  partType: string;
  imageFlag: 'with_images' | 'no_images';
  count: number;
  /** 该场景已有待审核的候选卡 */
  pendingDraft: boolean;
}

export interface LearningStatusDto {
  account: HistoryAccountDto | null;
  jobs: Record<LearningJob, LearningJobState>;
  history: { total: number; labeled: number; afterSales: number; failed: number };
  /** 售后回复按场景分组；达到 minClusterSize 的才会生成知识卡候选 */
  clusters: HistoryCluster[];
  minClusterSize: number;
  /** 还没被“改稿学习”归纳过的改稿记录 */
  unminedCorrections: number;
  pending: { cards: number; styles: number };
}

export interface HistoryTestResult {
  ok: boolean;
  message: string;
}

// ---------- 候选审核 ----------

export const reviewSchema = z.object({ action: z.enum(['approve', 'reject']) }).strict();
export type ReviewRequest = z.infer<typeof reviewSchema>;

export const CANDIDATE_STATUSES = ['draft', 'approved', 'rejected'] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export interface CardCandidateDto {
  id: string;
  category: string;
  partType: string;
  imageFlag: string;
  sampleSize: number;
  skeleton: string[];
  facts: string[];
  rules: string[];
  drift: string | null;
  status: CandidateStatus;
  source: string;
  createdAt: string;
  reviewedAt: string | null;
  /** 同场景当前生效的卡（通过后会被它替换） */
  current: { id: string; sampleSize: number; skeleton: string[]; facts: string[]; rules: string[]; drift: string | null; source: string } | null;
  /** 生成时参考的部分样本（我方回复开头），供审核时对照 */
  samples: { sentAt: string | null; customer: string; reply: string }[];
}

export interface StyleCandidateDto {
  id: string;
  text: string;
  category: string | null;
  partType: string | null;
  status: CandidateStatus;
  createdAt: string;
  reviewedAt: string | null;
  /** 依据的改稿：AI 草稿 → 客服发出 */
  evidence: { draft: string; final: string }[];
}
