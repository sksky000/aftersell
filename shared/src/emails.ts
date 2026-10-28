import { z } from 'zod';

export const URGENCIES = ['urgent', 'high', 'normal', 'low'] as const;
export type Urgency = (typeof URGENCIES)[number];

export const PART_TYPES = [
  'battery',
  'key',
  'charger',
  'wheels',
  'tire',
  'brakes',
  'motor',
  'light',
  'display',
  'frame',
  'drivetrain',
  'controller',
  'accessories',
  'other',
] as const;
export type PartType = (typeof PART_TYPES)[number];

export const CATEGORIES = [
  'quality_issue',
  'parts_request',
  'refund',
  'warranty',
  'technical_support',
  'order_inquiry',
  'manual_request',
  'registration',
  'product_question',
  'safety_hazard',
  'injury_claim',
  'missing_parts',
  'damaged_shipping',
  'purchase_inquiry',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const EMAIL_STATUSES = ['pending_review', 'replied', 'ignored'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const EVIDENCE_STATUSES = ['complete', 'partial', 'missing', 'unknown'] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

/** 入库后的处理进度：ingested → classified → drafted；failed 表示某一步出错待人工 */
export const PIPELINE_STATES = ['ingested', 'classified', 'drafted', 'failed'] as const;
export type PipelineState = (typeof PIPELINE_STATES)[number];

export const URGENCY_LABELS: Record<Urgency, string> = {
  urgent: '紧急',
  high: '高',
  normal: '普通',
  low: '低',
};

export const PART_TYPE_LABELS: Record<PartType, string> = {
  battery: '电池',
  key: '电池锁钥匙',
  charger: '充电器',
  wheels: '轮组轮圈',
  tire: '内外胎',
  brakes: '刹车',
  motor: '电机',
  light: '车灯',
  display: '仪表转把',
  frame: '车架前叉',
  drivetrain: '变速传动',
  controller: '控制器线束',
  accessories: '其他配件',
  other: '其他',
};

/** 看板分组顺序 */
export const PART_TYPE_ORDER: PartType[] = [
  'battery',
  'wheels',
  'key',
  'charger',
  'brakes',
  'motor',
  'light',
  'display',
  'tire',
  'frame',
  'drivetrain',
  'controller',
  'accessories',
  'other',
];

export const CATEGORY_LABELS: Record<Category, string> = {
  quality_issue: '质量问题',
  parts_request: '零件购买/补发',
  refund: '退款',
  warranty: '保修',
  technical_support: '故障排查',
  order_inquiry: '订单物流',
  manual_request: '说明书索取',
  registration: '车辆注册',
  product_question: '产品问询',
  safety_hazard: '安全隐患',
  injury_claim: '受伤索赔',
  missing_parts: '开箱少件',
  damaged_shipping: '运输损坏',
  purchase_inquiry: '购买询价',
  other: '其他',
};

export const STATUS_LABELS: Record<EmailStatus, string> = {
  pending_review: '待审核',
  replied: '已回复',
  ignored: '已忽略',
};

export const EVIDENCE_LABELS: Record<EvidenceStatus, string> = {
  complete: '凭证齐全',
  partial: '凭证不全',
  missing: '凭证缺失',
  unknown: '凭证未知',
};

export const PIPELINE_LABELS: Record<PipelineState, string> = {
  ingested: '待分类',
  classified: '已分类',
  drafted: '草稿已生成',
  failed: '处理失败',
};

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), z.enum(values).optional());

export const emailListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    status: optionalEnum(EMAIL_STATUSES),
    urgency: optionalEnum(URGENCIES),
    partType: optionalEnum(PART_TYPES),
    category: optionalEnum(CATEGORIES),
    evidenceStatus: optionalEnum(EVIDENCE_STATUSES),
    pipelineState: optionalEnum(PIPELINE_STATES),
    safetyHazard: optionalEnum(['true', 'false'] as const),
    contactStage: optionalEnum(['first_contact', 'follow_up'] as const),
    search: z.string().trim().max(200).optional(),
  })
  .strict();
export type EmailListQuery = z.infer<typeof emailListQuerySchema>;

export interface EmailAttachmentDto {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  isInline: boolean;
  /** 需登录的下载地址 */
  url: string;
}

export interface EmailListItem {
  id: string;
  subject: string | null;
  fromName: string | null;
  fromAddress: string | null;
  receivedAt: string | null;
  createdAt: string;
  status: EmailStatus;
  pipelineState: PipelineState;
  urgency: Urgency;
  partType: PartType;
  category: Category;
  evidenceStatus: EvidenceStatus;
  missingEvidence: string[];
  isSafetyHazard: boolean;
  summary: string | null;
  /** 正文前 200 字，分类前用于卡片预览 */
  preview: string;
  isFollowUp: boolean;
  threadSize: number;
  attachmentCount: number;
}

export interface EmailListResponse {
  items: EmailListItem[];
  total: number;
}

export interface EmailDetailDto extends EmailListItem {
  bodyText: string;
  replyTo: string | null;
  inReplyTo: string | null;
  threadId: string | null;
  messageId: string;
  attachments: EmailAttachmentDto[];
}

export interface ThreadItemDto {
  id: string;
  role: 'customer';
  subject: string | null;
  fromName: string | null;
  sentAt: string;
  /** 去掉引用历史后的正文 */
  content: string;
  attachments: EmailAttachmentDto[];
}

export interface InboxStatsDto {
  pendingReview: number;
  urgentPending: number;
  replied: number;
  ignored: number;
  safetyHazardPending: number;
  evidenceIncompletePending: number;
  unclassified: number;
}
