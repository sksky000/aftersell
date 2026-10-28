import { z } from 'zod';

export const SYNC_TRIGGERS = ['manual', 'schedule'] as const;
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number];

export const SYNC_RUN_STATUSES = ['running', 'succeeded', 'failed', 'skipped'] as const;
export type SyncRunStatus = (typeof SYNC_RUN_STATUSES)[number];

export interface SyncRunDto {
  id: string;
  trigger: SyncTrigger;
  status: SyncRunStatus;
  startedAt: string;
  finishedAt: string | null;
  /** 本次从邮箱取回正文的封数 */
  fetched: number;
  inserted: number;
  /** 已入库过、本次未重复写入 */
  duplicates: number;
  /** 不符合拉取开关、保持未读跳过 */
  filtered: number;
  failed: number;
  message: string;
}

export interface SyncStatusDto {
  /** 是否已配置邮箱账号 */
  configured: boolean;
  /** 看板上的三组拉取开关；未配置邮箱时为 null */
  filters: { hotlineOnly: boolean; registrationOnly: boolean; firstContactOnly: boolean } | null;
  /** 有同步任务正在执行 */
  running: boolean;
  /** 有手动同步在排队 */
  queued: boolean;
  lastRun: SyncRunDto | null;
  schedule: {
    enabled: boolean;
    intervalMinutes: number;
    nextRunAt: string | null;
  };
}

/** 看板上的三组拉取开关，单独保存 */
export const updateSyncFiltersSchema = z
  .object({
    hotlineOnly: z.boolean(),
    registrationOnly: z.boolean(),
    firstContactOnly: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, '没有要修改的开关');
export type UpdateSyncFiltersRequest = z.infer<typeof updateSyncFiltersSchema>;
