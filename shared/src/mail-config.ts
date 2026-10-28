import { z } from 'zod';

export const DEFAULT_IMAP_HOST = 'imap.exmail.qq.com';
export const DEFAULT_SMTP_HOST = 'smtp.exmail.qq.com';
export const DEFAULT_IMAP_PORT = 993;
export const DEFAULT_SMTP_PORT = 465;
export const MAX_PER_RUN_CEILING = 100;
export const DEFAULT_SYNC_INTERVAL_MINUTES = 5;

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
  .nullable();

const port = z.number().int().min(1).max(65535);

export const saveMailAccountSchema = z
  .object({
    emailAddress: z.string().trim().toLowerCase().email('邮箱账号格式不正确'),
    /** 留空表示不修改已保存的授权码 */
    authCode: z.string().max(256).optional(),
    imapHost: z.string().trim().toLowerCase().min(1).max(255),
    imapPort: port,
    smtpHost: z.string().trim().toLowerCase().min(1).max(255),
    smtpPort: port,
    syncEnabled: z.boolean(),
    keepUnread: z.boolean(),
    hotlineOnly: z.boolean(),
    registrationOnly: z.boolean(),
    firstContactOnly: z.boolean(),
    maxPerRun: z.number().int().min(1).max(MAX_PER_RUN_CEILING),
    /** 定时拉取间隔（分钟） */
    syncIntervalMinutes: z.number().int().min(1, '拉取间隔至少 1 分钟').max(1440, '拉取间隔最多 1440 分钟'),
    syncDateFrom: dateString,
    syncDateTo: dateString,
  })
  .strict()
  .refine((d) => !d.syncDateFrom || !d.syncDateTo || d.syncDateFrom <= d.syncDateTo, {
    message: '同步开始日期不能晚于结束日期',
    path: ['syncDateTo'],
  });
export type SaveMailAccountRequest = z.infer<typeof saveMailAccountSchema>;

export interface MailAccountDto {
  id: string;
  emailAddress: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  syncEnabled: boolean;
  keepUnread: boolean;
  hotlineOnly: boolean;
  registrationOnly: boolean;
  firstContactOnly: boolean;
  maxPerRun: number;
  syncIntervalMinutes: number;
  syncDateFrom: string | null;
  syncDateTo: string | null;
  lastSyncAt: string | null;
  hasAuthCode: boolean;
  updatedAt: string;
}

export interface MailConfigMeta {
  /** 服务端允许连接的邮件服务器主机，配置于环境变量 MAIL_HOST_ALLOWLIST */
  allowedHosts: string[];
}

export interface TestConnectionResult {
  imapOk: boolean;
  smtpOk: boolean;
  imapMessage: string;
  smtpMessage: string;
  testedAt: string;
}
