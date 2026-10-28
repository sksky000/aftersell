import { z } from 'zod';
import { CATEGORIES, PART_TYPES } from './emails';

/**
 * 规则注入的槽位，按此顺序拼进草稿上下文。
 * 同槽多条命中时按 priority 从高到低，遇到 exclusive 的规则即停止（压掉同槽其他规则）。
 */
export const RULE_SLOTS = [
  'channel',
  'language',
  'safety',
  'evidence_policy',
  'evidence_note',
  'action',
  'business_fact',
  'part_knowledge',
  'closing',
] as const;
export type RuleSlot = (typeof RULE_SLOTS)[number];

export const RULE_SLOT_LABELS: Record<RuleSlot, string> = {
  channel: '客户与渠道',
  language: '语言',
  safety: '安全',
  evidence_policy: '索证口径',
  evidence_note: '证据与客户声明',
  action: '处理流程',
  business_fact: '业务事实',
  part_knowledge: '部件知识',
  closing: '落款',
};

export interface RuleDto {
  key: string;
  description: string;
  slot: RuleSlot;
  priority: number;
  exclusive: boolean;
  /** JSON logic 条件；null 表示总是命中 */
  when: unknown;
  text: string;
  source: string | null;
  enabled: boolean;
  updatedAt: string;
}

export const updateRuleSchema = z
  .object({
    text: z.string().trim().min(1).max(5000),
    priority: z.number().int().min(0).max(1000),
    exclusive: z.boolean(),
    enabled: z.boolean(),
    description: z.string().trim().max(200),
  })
  .partial()
  .strict();
export type UpdateRuleRequest = z.infer<typeof updateRuleSchema>;

export interface RuleHitDto {
  ruleKey: string;
  slot: RuleSlot;
  description: string;
}

export const DRAFT_CHECK_CODES = [
  'repeated_evidence_request',
  'unknown_price',
  'payment_mismatch',
  'empty_draft',
] as const;
export type DraftCheckCode = (typeof DRAFT_CHECK_CODES)[number];

export interface DraftCheck {
  code: DraftCheckCode;
  message: string;
}

export interface DraftDto {
  id: string;
  emailId: string;
  version: number;
  content: string;
  status: 'draft' | 'sent' | 'discarded';
  provider: string | null;
  model: string | null;
  createdAt: string;
  /** 生成后的确定性检查发现的问题，需人工核对 */
  checks: DraftCheck[];
  hits: RuleHitDto[];
}

/** 给主管看的完整上下文（模型实际看到的输入，不含 system prompt） */
export interface DraftContextDto {
  context: string;
}

// ---------- 风格条目 ----------

export interface StyleRuleDto {
  id: string;
  text: string;
  category: string | null;
  partType: string | null;
  enabled: boolean;
  source: string | null;
  sortOrder: number;
}

export const saveStyleRuleSchema = z
  .object({
    text: z.string().trim().min(5, '条目太短').max(1000),
    category: z.enum(CATEGORIES).nullable(),
    partType: z.enum(PART_TYPES).nullable(),
    enabled: z.boolean(),
  })
  .strict();
export type SaveStyleRuleRequest = z.infer<typeof saveStyleRuleSchema>;

// ---------- 价格表 ----------

export interface PriceItemDto {
  id: string;
  partType: string;
  /** 适用车型码；null 表示不限车型 */
  modelCode: string | null;
  label: string;
  amount: number;
  includesShipping: boolean;
  note: string | null;
  enabled: boolean;
}

export const savePriceItemSchema = z
  .object({
    partType: z.enum(PART_TYPES),
    modelCode: z
      .string()
      .trim()
      .toUpperCase()
      .max(40)
      .nullable()
      .transform((v) => v || null),
    label: z.string().trim().min(1, '请填写名称').max(200),
    amount: z.number().positive('价格必须大于 0').max(100000),
    includesShipping: z.boolean(),
    note: z
      .string()
      .trim()
      .max(300)
      .nullable()
      .transform((v) => v || null),
    enabled: z.boolean(),
  })
  .strict();
export type SavePriceItemRequest = z.infer<typeof savePriceItemSchema>;

// ---------- 收款信息 ----------

export const paymentSettingsSchema = z
  .object({
    zelleEmail: z.string().trim().max(200),
    zelleName: z.string().trim().max(100),
    zellePhone: z.string().trim().max(50),
    /** 其他收款说明，如“无法使用 Zelle 时可提供 Stripe 支付链接” */
    extraNote: z.string().trim().max(500),
  })
  .strict();
export type PaymentSettings = z.infer<typeof paymentSettingsSchema>;

export const EMPTY_PAYMENT_SETTINGS: PaymentSettings = { zelleEmail: '', zelleName: '', zellePhone: '', extraNote: '' };

// ---------- 知识卡与说明书知识 ----------

export interface KnowledgeCardDto {
  id: string;
  clusterKey: string;
  category: string;
  partType: string;
  imageFlag: string;
  sampleSize: number;
  skeleton: string[];
  facts: string[];
  rules: string[];
  drift: string | null;
  enabled: boolean;
}

export interface ProductKnowledgeDto {
  modelCode: string;
  name: string;
  electric: boolean;
  noToolkit: boolean;
  knowledge: string;
  enabled: boolean;
}

export const updateProductKnowledgeSchema = z
  .object({ knowledge: z.string().trim().min(10).max(20000), enabled: z.boolean() })
  .partial()
  .strict();

export const toggleSchema = z.object({ enabled: z.boolean() }).strict();
