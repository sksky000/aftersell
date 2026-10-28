import type { DraftCheck, PaymentSettings } from '@aftersell/shared';
import type { KnownCustomerInfo } from './customer-info';
import type { CaseEvidence } from './evidence-state';

export const CLOSING_LINES = ['Thank you!', 'Best regards,', 'PhoenixUS-support team'];

const CLOSING_LINE_RE =
  /^(?:thank you[!.]?|thanks[!.]?|best regards,?|kind regards,?|regards,?|sincerely,?|best,?|phoenixus[- ]support[- ]team\.?|phoenix ?us support team\.?)$/i;

/** 妙搭 cleanGeneratedDraft：去掉模型自作主张复述的客户资料块 */
function stripProfileBlocks(lines: string[], info: KnownCustomerInfo | null): string[] {
  const out: string[] = [];
  let profile = false;
  for (const line of lines) {
    if (/\b(?:we have (?:your )?details on file|your details on file|we have on file)\b/i.test(line)) {
      profile = true;
      continue;
    }
    if (profile && !line.trim()) {
      profile = false;
      continue;
    }
    if (profile && /^(?:[-*]\s*)?(?:name|phone|address|email)\s*:/i.test(line.trim())) continue;
    profile = false;
    const normalized = line.trim().replace(/^(?:name|phone|address)\s*:\s*/i, '').toLowerCase();
    if (normalized && Object.values(info ?? {}).some((v) => v && normalized === v.toLowerCase())) continue;
    out.push(line);
  }
  return out;
}

export interface FinalizeOptions {
  info: KnownCustomerInfo | null;
  /** 购买电池且型号已知时，确保索要缺的自行车 / 电池照片 */
  batteryPhotos?: { bicycle: boolean; battery: boolean } | null;
}

/**
 * 只作用于新生成的草稿（不碰客服编辑过的终稿）：
 * 去资料复述 → 去模型写的落款 → 补电池照片请求 → “below” 地址确认句下补收件信息 → 固定三行落款。
 */
export function finalizeDraft(raw: string, opts: FinalizeOptions): string {
  if (!raw.trim()) return '';
  let lines = stripProfileBlocks(raw.replace(/\r\n/g, '\n').trim().split('\n'), opts.info);
  while (lines.length && (!lines[lines.length - 1].trim() || CLOSING_LINE_RE.test(lines[lines.length - 1].trim()))) lines.pop();

  let body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  if (opts.batteryPhotos) {
    const missing: string[] = [];
    if (opts.batteryPhotos.bicycle && !/(?:send|provide|share)[^.\n]{0,120}(?:photo|picture)[^.\n]{0,60}(?:bicycle|bike)/i.test(body)) {
      missing.push('a photo of the bicycle');
    }
    if (opts.batteryPhotos.battery && !/(?:send|provide|share)[^.\n]{0,120}(?:photo|picture)[^.\n]{0,60}battery/i.test(body)) {
      missing.push('a photo of the battery');
    }
    if (missing.length) body += `\n\nTo confirm compatibility, please send ${missing.join(' and ')}.`;
  }

  const info = opts.info;
  if (info?.name && info.address && /shipping address below/i.test(body)) {
    const block = [info.name, info.phone, info.address].filter(Boolean).join('\n');
    body = body.replace(/^(.*shipping address below.*)$/im, `$1\n\n${block}`);
  }
  return `${body}\n\n${CLOSING_LINES.join('\n')}`;
}

/** 妙搭 assertNoRepeatedEvidenceRequest：草稿是否又索要了本案已收到的材料；返回命中的句子 */
export function findRepeatedEvidenceRequest(draft: string, evidence: CaseEvidence): string | null {
  const askTrigger = /\b(?:(?:please|could you|can you|would you)\s+(?:(?:also|kindly)\s+)?(?:send|provide|share|upload|resend|confirm)|we (?:still )?(?:need|require)|(?:provide|send) us)\b/i;
  const negation = /\b(?:do not|don't|no need to|need not)\b/i;
  const listItem = /^\s*(?:\d+[.)]|[-•*])\s+/;
  const marker = /^\s*(?:\d+[.)]?|[-•*])\s*$/;
  const segments: string[] = [];
  for (const seg of draft.split(/(?<=[.!?])\s+|\n+/)) {
    if (segments.length && marker.test(segments[segments.length - 1])) segments[segments.length - 1] += ` ${seg}`;
    else segments.push(seg);
  }
  const received = (key: keyof CaseEvidence) => ['provided', 'unverified'].includes(evidence[key].state);
  let inAsk = false;
  for (const sentence of segments) {
    const isAsk = askTrigger.test(sentence);
    const isList = inAsk && listItem.test(sentence);
    if ((isAsk || isList) && !negation.test(sentence)) {
      if (
        (received('receipt') && /\breceipt\b|proof of purchase/i.test(sentence) && !/clearer|unreadable|illegible/i.test(sentence)) ||
        (evidence.address.state === 'provided' &&
          /(?:full|shipping|delivery) address/i.test(sentence) &&
          !/apartment|unit|conflict|which|confirm whether|below/i.test(sentence)) ||
        (received('bicyclePhoto') && /(?:send|provide)[^.\n]{0,50}(?:photo|picture)[^.\n]{0,30}(?:bike|bicycle)/i.test(sentence)) ||
        (received('batteryPhoto') && /(?:send|provide)[^.\n]{0,50}(?:photo|picture)[^.\n]{0,30}battery/i.test(sentence))
      ) {
        return sentence.trim();
      }
    }
    inAsk = isAsk || (inAsk && listItem.test(sentence));
  }
  return null;
}

function amountsIn(text: string): number[] {
  return [...text.matchAll(/\$\s?(\d{1,6}(?:\.\d{1,2})?)/g)].map((m) => Number(m[1]));
}

/** 生成后的确定性检查：不阻止保存，提示客服核对 */
export function checkDraft(
  draft: string,
  ctx: { evidence: CaseEvidence; priceAmounts: number[]; knownText: string; payment: PaymentSettings },
): DraftCheck[] {
  const checks: DraftCheck[] = [];
  if (!draft.trim()) return [{ code: 'empty_draft', message: '模型没有生成内容' }];

  const repeated = findRepeatedEvidenceRequest(draft, ctx.evidence);
  if (repeated) checks.push({ code: 'repeated_evidence_request', message: `可能重复索要了本案已收到的材料：“${repeated.slice(0, 120)}”` });

  const allowed = new Set([...ctx.priceAmounts, ...amountsIn(ctx.knownText)]);
  const unknown = [...new Set(amountsIn(draft).filter((a) => !allowed.has(a)))];
  if (unknown.length) {
    checks.push({ code: 'unknown_price', message: `草稿里的金额不在价格表或往来邮件中：${unknown.map((a) => `$${a}`).join('、')}，请核对` });
  }

  const zelleEmail = ctx.payment.zelleEmail.toLowerCase();
  const emails = [...draft.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)].map((m) => m[0].toLowerCase().replace(/[.,;)]+$/, ''));
  if (/zelle/i.test(draft) && emails.some((e) => e !== zelleEmail && !e.includes('phoenix'))) {
    checks.push({ code: 'payment_mismatch', message: '草稿里的 Zelle 账号与设置页的收款信息不一致，请核对' });
  }
  return checks;
}
