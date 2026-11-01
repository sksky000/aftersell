import { isDepothelpSender, parseDepothelpSubject } from '../mail/depothelp';
import { stripQuotedHistory } from '../mail/quote-strip';
import { extractKnownCustomerInfo } from '../reply/customer-info';
import { matchBikeModelByAlias } from './bike-model-aliases';
import { resolveProblemPart } from './problem-part';

/** 台账一行由这个客户的全部来信汇总而来（与妙搭台账的字段一致） */
export interface LedgerEmail {
  id: string;
  subject: string | null;
  fromAddress: string | null;
  fromName: string | null;
  bodyText: string;
  receivedAt: Date | null;
  createdAt: Date;
  category: string;
  partType: string;
  urgency: string;
  status: string;
  summary: string | null;
  hasMedia: boolean;
}

const CONCERN_BLOCK_MAX = 400;
const CONCERN_TOTAL_MAX = 4000;

/** 我方类别 → 台账 Concern Category 选项（同妙搭） */
const CONCERN_CATEGORY: Record<string, string> = {
  warranty: 'Warranty Claim',
  quality_issue: 'Warranty Claim',
  parts_request: 'Pre-sales',
  purchase_inquiry: 'Pre-sales',
  product_question: 'Pre-sales',
  technical_support: 'Tech Support',
  manual_request: 'Tech Support',
  order_inquiry: 'Order Tracking/Follow up',
  refund: 'Return Request',
  registration: 'Warranty Registration',
};

const ORDER_RE = /\border\s*(?:number|no\.?|#|id)?\s*(?:is|:|#)?\s*#?\s*(\d{7,})\b/i;

export type LedgerValue = string | number;

/** 系统会写的字段名；台账里没有的字段会跳过 */
export const LEDGER_FIELDS = [
  'Date',
  'Name',
  'Email',
  'Phone#',
  'Order#',
  'Model#',
  'Concern',
  'Concern Category',
  'Urgent?',
  'Case Status',
  '问题部件',
  '是否有视频或者图片',
  '是否到达时损坏',
  'Concern & Reason Analyse (中文)',
  'Shipping Address',
  '图片和视频',
] as const;

const at = (e: LedgerEmail) => (e.receivedAt ?? e.createdAt).getTime();

/** 由客户的来信（任意顺序）算出台账字段；空值不出现（不覆盖台账里人工填的内容） */
export function buildLedgerRecord(customerKey: string, emails: LedgerEmail[]): Record<string, LedgerValue> {
  const sorted = [...emails].sort((a, b) => at(a) - at(b));
  const first = sorted[0];
  const latest = sorted[sorted.length - 1];
  const texts = sorted.map((e) => stripQuotedHistory(e.bodyText));
  const allText = [...sorted.map((e) => e.subject ?? ''), ...texts].join('\n');

  // 姓名电话地址：从最新一封往前找
  let info: { name: string | null; phone: string | null; address: string | null } = { name: null, phone: null, address: null };
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const found = extractKnownCustomerInfo(sorted[i].bodyText, sorted[i].fromAddress);
    if (found) info = { name: info.name ?? found.name, phone: info.phone ?? found.phone, address: info.address ?? found.address };
  }
  const depot = sorted.map((e) => (isDepothelpSender(e.fromAddress) ? parseDepothelpSubject(e.subject) : null)).find(Boolean) ?? null;

  let concern = '';
  for (let i = 0; i < sorted.length; i += 1) {
    const day = new Date(at(sorted[i])).toISOString().slice(0, 10);
    const block = `[${day}] ${texts[i].replace(/\s+/g, ' ').trim().slice(0, CONCERN_BLOCK_MAX)}`;
    concern = concern ? `${concern}\n${block}` : block;
  }

  const record: Record<string, LedgerValue | null | undefined> = {
    Date: at(first),
    Name: info.name ?? depot?.customerName ?? [...sorted].reverse().find((e) => e.fromName && !isDepothelpSender(e.fromAddress))?.fromName,
    Email: customerKey.includes('@') ? customerKey : null,
    'Phone#': info.phone ?? depot?.phone,
    'Order#': allText.match(ORDER_RE)?.[1],
    'Model#': matchBikeModelByAlias(allText) || null,
    Concern: concern.slice(-CONCERN_TOTAL_MAX),
    'Concern Category': CONCERN_CATEGORY[latest.category] ?? 'Other',
    'Urgent?': sorted.some((e) => e.urgency === 'urgent' || e.urgency === 'high') ? 'Yes' : 'No',
    'Case Status': latest.status === 'replied' ? 'Resolved' : 'Open',
    问题部件: resolveProblemPart(sorted.map((e) => ({ subject: e.subject, bodyText: e.bodyText, partType: e.partType }))) || null,
    是否有视频或者图片: sorted.some((e) => e.hasMedia) ? '是' : '否',
    是否到达时损坏: sorted.some((e) => e.category === 'damaged_shipping') ? '是' : '否',
    'Concern & Reason Analyse (中文)': latest.summary ?? first.summary,
    'Shipping Address': info.address,
  };
  return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, LedgerValue] => entry[1] != null && entry[1] !== ''));
}

/** 飞书多维表格字段类型：可写的几种 */
export const FIELD_TYPES = { text: 1, number: 2, select: 3, multiSelect: 4, date: 5, checkbox: 7, phone: 13, url: 15, attachment: 17 } as const;

/** 按台账里字段的实际类型转换值；台账没有的字段、类型不可写的字段跳过 */
export function adaptToTable(record: Record<string, LedgerValue>, tableFields: Map<string, number>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(record)) {
    const type = tableFields.get(name);
    if (type === undefined) continue;
    switch (type) {
      case FIELD_TYPES.text:
      case FIELD_TYPES.select:
      case FIELD_TYPES.phone:
        out[name] = String(value);
        break;
      case FIELD_TYPES.multiSelect:
        out[name] = [String(value)];
        break;
      case FIELD_TYPES.number:
        if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(value)) out[name] = Number(value);
        break;
      case FIELD_TYPES.date:
        if (typeof value === 'number') out[name] = value;
        break;
      case FIELD_TYPES.checkbox:
        out[name] = value === '是' || value === 'Yes';
        break;
      default:
        break;
    }
  }
  return out;
}
