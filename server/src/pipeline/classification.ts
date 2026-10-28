import { z } from 'zod/v4';
import {
  CATEGORIES,
  EVIDENCE_STATUSES,
  LANGUAGES,
  MISSING_EVIDENCE,
  PART_TYPES,
  URGENCIES,
  type Category,
  type EvidenceStatus,
  type MissingEvidence,
  type PartType,
  type Urgency,
} from '@aftersell/shared';
import { stripQuotedHistory } from '../mail/quote-strip';

/** 模型输出的结构；校验失败会回馈给模型重试一次 */
export const classificationSchema = z.strictObject({
  isOurProduct: z.boolean(),
  notOurProductReason: z.string().nullable(),
  category: z.enum(CATEGORIES),
  partType: z.enum(PART_TYPES),
  urgency: z.enum(URGENCIES),
  isSafetyHazard: z.boolean(),
  evidenceStatus: z.enum(EVIDENCE_STATUSES.filter((s) => s !== 'unknown') as ['complete', 'partial', 'missing']),
  missingEvidence: z.array(z.enum(MISSING_EVIDENCE)),
  summary: z.string(),
  isComplaint: z.boolean(),
  language: z.enum(LANGUAGES),
  confidence: z.number(),
});
export type RawClassification = z.infer<typeof classificationSchema>;

export interface ClassifyAttachment {
  filename: string;
  contentType: string;
  /** 识别成功时的文本 */
  recognized: string | null;
}

export interface ClassifyEmail {
  subject: string | null;
  fromName: string | null;
  fromAddress: string | null;
  bodyText: string;
  attachments: ClassifyAttachment[];
}

const MAX_BODY = 6000;
const MAX_QUOTED = 2000;
const MAX_RECOGNIZED = 1500;

/** 客户内容里出现我们的标签名时去掉尖括号，避免伪造结构 */
function neutralize(text: string): string {
  return text.replace(/<(\/?)(email|subject|from|body|quoted_history|attachments|attachment)\b/gi, '‹$1$2');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[…已截断]` : text;
}

export function buildClassifyInput(email: ClassifyEmail): string {
  const body = email.bodyText.trim();
  const active = stripQuotedHistory(body);
  const quoted = active.length < body.length ? body.slice(active.length).trim() : '';
  const files = email.attachments.map((a) => {
    const head = `- ${a.filename} (${a.contentType})`;
    return a.recognized ? `${head}\n  recognized: ${truncate(a.recognized, MAX_RECOGNIZED).replace(/\n/g, '\n  ')}` : `${head}\n  recognized: (not recognized)`;
  });
  const parts = [
    '<email>',
    `<subject>${neutralize(email.subject?.trim() || '(no subject)')}</subject>`,
    `<from>${neutralize([email.fromName, email.fromAddress && `<${email.fromAddress}>`].filter(Boolean).join(' ') || '(unknown)')}</from>`,
    `<body>\n${neutralize(truncate(active || (files.length ? '[No text. The customer sent attachments only.]' : '[No text content.]'), MAX_BODY))}\n</body>`,
  ];
  if (quoted) parts.push(`<quoted_history>\n${neutralize(truncate(quoted, MAX_QUOTED))}\n</quoted_history>`);
  parts.push(files.length ? `<attachments>\n${neutralize(files.join('\n'))}\n</attachments>` : '<attachments>(none)</attachments>');
  parts.push('</email>');
  return parts.join('\n');
}

export interface FinalClassification {
  isOurProduct: boolean;
  notOurProductReason: string | null;
  category: Category;
  partType: PartType;
  urgency: Urgency;
  isSafetyHazard: boolean;
  evidenceStatus: EvidenceStatus;
  missingEvidence: MissingEvidence[];
  summary: string;
  isComplaint: boolean;
  language: string;
  confidence: number;
  adjudicated: boolean;
}

/**
 * 模型输出之后的确定性处理（不依赖模型）：
 * 客户裁决覆盖 → 非我方产品统一处理 → 安全隐患升紧急 → 有图片不再缺照片 → 凭证状态与缺失项一致。
 */
export function finalizeClassification(
  raw: RawClassification,
  ctx: { attachments: ClassifyAttachment[]; bodyText: string; adjudicatedNotOurs: boolean },
): FinalClassification {
  const result: FinalClassification = {
    ...raw,
    summary: raw.summary.trim().slice(0, 300),
    confidence: Math.max(0, Math.min(100, Math.round(raw.confidence))),
    missingEvidence: [...new Set(raw.missingEvidence)],
    adjudicated: false,
  };

  if (ctx.adjudicatedNotOurs) {
    result.isOurProduct = false;
    result.notOurProductReason = '客户裁决：该客户的车不是我方产品';
    result.adjudicated = true;
  }
  if (!result.isOurProduct) {
    return {
      ...result,
      notOurProductReason: result.notOurProductReason || '模型判定为非我方产品',
      category: 'other',
      urgency: 'normal',
      isSafetyHazard: false,
      isComplaint: false,
      evidenceStatus: 'complete',
      missingEvidence: [],
    };
  }
  result.notOurProductReason = null;

  if (result.category === 'safety_hazard') result.isSafetyHazard = true;
  if (result.isSafetyHazard || result.category === 'safety_hazard' || result.category === 'injury_claim') {
    result.urgency = 'urgent';
  }
  // 只发附件不写字的来信一定需要处理
  if (!ctx.bodyText.trim() && ctx.attachments.length) result.isComplaint = true;
  if (ctx.attachments.some((a) => /^(image|video)\//.test(a.contentType))) {
    result.missingEvidence = result.missingEvidence.filter((m) => m !== 'photo_or_video');
  }
  if (result.missingEvidence.length === 0) result.evidenceStatus = 'complete';
  else if (result.evidenceStatus === 'complete') result.evidenceStatus = 'partial';
  return result;
}

/** 模型两次输出都不合格时的兜底：归 other、标记待人工 */
export const FALLBACK_CLASSIFICATION = {
  category: 'other',
  partType: 'other',
  urgency: 'normal',
  evidenceStatus: 'unknown',
  missingEvidence: [],
  isSafetyHazard: false,
  isOurProduct: true,
  isComplaint: true,
  confidence: 0,
} as const;
