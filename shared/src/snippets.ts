import { z } from 'zod';
import { CATEGORIES, PART_TYPES, type Category, type PartType } from './emails';

/**
 * quick：快捷话术，审核台点一下插入回复正文（英文）
 * sop：标准处理流程，按类别（或零件）显示在审核台右侧，一行一步（中文，给客服看）
 */
export const SNIPPET_KINDS = ['quick', 'sop'] as const;
export type SnippetKind = (typeof SNIPPET_KINDS)[number];

/** 文案里可用的占位符，取自 设置 → 业务知识 → 收款信息 */
export const SNIPPET_PLACEHOLDERS = ['{zelleEmail}', '{zelleName}', '{zellePhone}'] as const;

export interface SnippetDto {
  id: string;
  kind: SnippetKind;
  label: string;
  /** 设置页返回原文（含占位符）；审核台接口返回已代入收款信息的文本 */
  text: string;
  category: Category | null;
  partType: PartType | null;
  enabled: boolean;
  sortOrder: number;
}

export const saveSnippetSchema = z
  .object({
    kind: z.enum(SNIPPET_KINDS),
    label: z.string().trim().min(1, '名称不能为空').max(60, '名称不超过 60 字'),
    text: z.string().trim().min(1, '内容不能为空').max(3000, '内容不超过 3000 字'),
    category: z.enum(CATEGORIES).nullable(),
    partType: z.enum(PART_TYPES).nullable(),
    enabled: z.boolean(),
    sortOrder: z.number().int().min(0).max(10000).default(1000),
  })
  .strict()
  .refine((s) => s.kind === 'quick' || s.category !== null || s.partType !== null, {
    message: 'SOP 需要指定适用的类别或零件',
    path: ['category'],
  });
export type SaveSnippetRequest = z.input<typeof saveSnippetSchema>;
export type ParsedSaveSnippet = z.output<typeof saveSnippetSchema>;

// ---------- 翻译 ----------

export const translateSchema = z.object({ text: z.string().trim().min(1, '没有要翻译的内容').max(8000, '内容过长') }).strict();
export type TranslateRequest = z.infer<typeof translateSchema>;
export interface TranslateResponse {
  text: string;
}

/** deleted=false：内置条目只停用不删除（删掉会在下次启动时被补回） */
export interface DeleteSnippetResponse {
  deleted: boolean;
}
