import { stripQuotedHistory } from '../mail/quote-strip';
import { extractKnownCustomerInfo, type KnownCustomerInfo } from './customer-info';

/** 引擎用的附件：识别成功时 aiDescription 为识别文本 */
export interface EngineAttachment {
  filename: string;
  contentType: string;
  aiDescription?: string | null;
  recognition?: { status: string } | null;
}
export type EvidenceKey = 'receipt' | 'model' | 'address' | 'name' | 'phone' | 'bicyclePhoto' | 'batteryPhoto' | 'video' | 'payment';
export interface EvidenceSource { id: string; bodyText: string | null; attachments?: EngineAttachment[]; }
export interface EvidenceFact { state: 'missing' | 'provided' | 'unverified' | 'conflict'; sources: string[]; }
export type CaseEvidence = Record<EvidenceKey, EvidenceFact>;
const keys: EvidenceKey[] = ['receipt', 'model', 'address', 'name', 'phone', 'bicyclePhoto', 'batteryPhoto', 'video', 'payment'];
const RECEIPT_ATTACHMENT_RE =
  /\breceipt\b|proof of purchase|order (?:confirmation|summary)|\binvoice\b|\border\s*(?:number|\\?#)?\s*:?\s*\d[\d-]*\d/i;
const MEDIA_SHARE_LINK_RE =
  /https?:\/\/\S*(?:drive\.google\.com\/(?:file|open|uc)|photos\.app\.goo\.gl|dropbox\.com\/s|youtu\.be\/|youtube\.com\/watch|icloud\.com\/share)\S*/i;
const MEDIA_CONTEXT_RE = /\b(?:videos?|photos?|pictures?|clips?|footage)\b|\.(?:mp4|mov|jpg|jpeg|png)\b/i;
export function bodySharesMediaLink(bodyText: string | null): boolean {
  const body = stripQuotedHistory(bodyText ?? '');
  return body.length > 0 && MEDIA_SHARE_LINK_RE.test(body) && MEDIA_CONTEXT_RE.test(body);
}
export function collectCaseEvidence(sources: EvidenceSource[]): { evidence: CaseEvidence; info: KnownCustomerInfo | null } {
  const missing = (): EvidenceFact => ({ state: 'missing', sources: [] });
  const evidence: CaseEvidence = { receipt: missing(), model: missing(), address: missing(), name: missing(), phone: missing(), bicyclePhoto: missing(), batteryPhoto: missing(), video: missing(), payment: missing() };
  const values: Record<'name' | 'phone' | 'address', Set<string>> = { name: new Set(), phone: new Set(), address: new Set() };
  const mark = (key: EvidenceKey, id: string, state: 'provided' | 'unverified' = 'provided'): void => {
    const fact = evidence[key];
    if (fact.state !== 'provided' || state === 'provided') fact.state = state;
    if (!fact.sources.includes(id)) fact.sources.push(id);
  };
  for (const source of sources) {
    const body = stripQuotedHistory(source.bodyText);
    const info = extractKnownCustomerInfo(body);
    for (const key of ['name', 'phone', 'address'] as const) {
      const value = info?.[key];
      if (value) { values[key].add(value.replace(/\s+/g, ' ').trim()); mark(key, source.id); }
    }
    if (/\b(?:model|serial)\s*(?:number)?\s*[:#]\s*[a-z0-9-]*\d[a-z0-9-]*|\b\d{2}[a-z]{2}\d{4}[a-z]{2}\b/i.test(body)) mark('model', source.id);
    if (/\b(?:i|we) (?:have )?(?:already )?(?:sent|made) (?:the )?payment|paid via zelle/i.test(body)) mark('payment', source.id);
    if (bodySharesMediaLink(source.bodyText)) mark('video', source.id, 'unverified');
    const attachments = source.attachments ?? [];
    if (/(?:attached|enclosed|sent|here is|here are)[^.\n]{0,40}\breceipt\b|\breceipt\b[^.\n]{0,30}(?:attached|enclosed)/i.test(body) && !/\b(?:no|without|lost|missing) (?:a |the |my )?receipt\b/i.test(body)) mark('receipt', source.id, 'unverified');
    for (const att of attachments) {
      if (att.contentType.startsWith('video/')) mark('video', source.id, 'unverified');
      if (att.contentType.startsWith('image/') && !att.aiDescription?.trim()) { mark('bicyclePhoto', source.id, 'unverified'); mark('batteryPhoto', source.id, 'unverified'); }
      const text = att.aiDescription?.trim() ?? '';
      const recognized = !!text && (!att.recognition || att.recognition.status === 'succeeded');
      if (!recognized) continue;
      const negative = /\b(?:no|not|without|unreadable|cannot (?:see|read))\b/i.test(text);
      if (!negative && RECEIPT_ATTACHMENT_RE.test(text)) mark('receipt', source.id);
      if (!negative && /\b(?:bicycle|bike)\b/i.test(text) && att.contentType.startsWith('image/')) mark('bicyclePhoto', source.id);
      if (!negative && /\bbattery\b/i.test(text) && att.contentType.startsWith('image/')) mark('batteryPhoto', source.id);
      if (!negative && /\b\d{2}[a-z]{2}\d{4}[a-z]{2}\b/i.test(text)) mark('model', source.id);
    }
  }
  const info: KnownCustomerInfo = { name: null, phone: null, address: null };
  for (const key of ['name', 'phone', 'address'] as const) {
    const unique = [...values[key]];
    if (new Set(unique.map(v => v.toLowerCase().replace(/[^a-z0-9]/g, ''))).size > 1) evidence[key].state = 'conflict';
    else info[key] = unique.at(-1) ?? null;
  }
  return { evidence, info: Object.values(info).some(Boolean) ? info : null };
}
export function formatEvidenceState(evidence: CaseEvidence): string {
  return ['CASE EVIDENCE — only customer statements and attachments from the confirmed case; overrides generic checklists and style memory.',
    ...keys.map(key => `- ${key}: ${evidence[key].state}; source message(s): ${evidence[key].sources.join(', ') || 'none'}`),
    'Never request a provided item again. Missing means not established here, not automatically required: ask only what this specific next business step needs. For conflict ask only which conflicting field is correct; do not request the full profile. For unverified acknowledge receipt and request human inspection or a clearer specific item only if unreadable; never claim you understood a video or an unrecognized attachment. For battery purchases confirm BOTH bicycle and battery photos: request only missing photos, and ask a human to inspect existing unverified photos instead of requesting duplicates.',
    'A returned/shipped battery stated by the customer is a completed customer action: do not restart the pre-return evidence flow. Ask only relevant tracking/status details if needed.',
    'Do not recite customer name, phone, address or profile in the reply body or signature. Never write "We have your details on file as:". Sign only with the fixed three-line closing.'].join('\n');
}
