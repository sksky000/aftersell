import { z } from 'zod';

export const saveFeishuConfigSchema = z
  .object({
    appId: z.string().trim().regex(/^cli_[a-z0-9]+$/i, 'App ID 应以 cli_ 开头').max(64),
    /** 留空表示不修改已保存的 App Secret */
    appSecret: z.string().max(256).optional(),
    ledgerEnabled: z.boolean(),
    /** 台账多维表格链接（含 ?table= 的那种） */
    ledgerUrl: z.string().trim().max(500).nullable(),
  })
  .strict()
  .refine((c) => !c.ledgerEnabled || (c.ledgerUrl && parseBitableUrl(c.ledgerUrl)), {
    message: '开启台账同步需要填写多维表格链接（打开那张表后复制浏览器地址，需包含 table=）',
    path: ['ledgerUrl'],
  });
export type SaveFeishuConfigRequest = z.infer<typeof saveFeishuConfigSchema>;

export interface FeishuConfigDto {
  appId: string;
  hasAppSecret: boolean;
  ledgerEnabled: boolean;
  ledgerUrl: string | null;
}

export interface FeishuTestResult {
  ok: boolean;
  message: string;
  /** 台账表里的字段，以及哪些会被系统写入 */
  fields: { name: string; used: boolean }[];
}

export interface LedgerStatusDto {
  enabled: boolean;
  rows: number;
  failed: { customer: string; error: string }[];
  lastSyncAt: string | null;
  lastMessage: string | null;
  running: boolean;
}

/**
 * 解析多维表格链接：
 * https://xxx.feishu.cn/base/<app_token>?table=<table_id>
 * https://xxx.feishu.cn/wiki/<wiki_token>?table=<table_id>（知识库里的多维表格，需要再换成 app_token）
 */
export function parseBitableUrl(url: string): { token: string; tableId: string; wiki: boolean } | null {
  const m = url.match(/\/(base|wiki)\/([A-Za-z0-9]+)/);
  const table = url.match(/[?&]table=(tbl[A-Za-z0-9]+)/);
  if (!m || !table) return null;
  return { token: m[2], tableId: table[1], wiki: m[1] === 'wiki' };
}
