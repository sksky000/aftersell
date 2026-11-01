import type { Language } from '@aftersell/shared';
import { isLeaderForward } from './leader-forward';
import { repairDegradedEmailText, stripQuotedHistory } from './quote-strip';

// 转发分隔线：腾讯企业邮「原始邮件」、Outlook / Gmail 英文形态
const FORWARD_MARKER_RE = /^[ \t>]*-{2,}[ \t]*(?:原始邮件|转发邮件信息|转发的邮件|original(?:\s+message)?|forwarded message)[ \t]*-{2,}[ \t]*$/im;
// 转发 / 引用头的字段行（中英文界面）
const HEADER_LINE_RE = /^[ \t>]*(?:发件人|发送时间|收件人|抄送|主题|日期|时间|from|sent|date|to|cc|subject)[ \t]*[:：]/i;
const FROM_HEADER_RE = /^[ \t>]*(?:发件人|from)[ \t]*[:：]/im;
const FORWARD_SUBJECT_RE = /^\s*(?:fwd?|转发)\s*[:：]/i;

const CJK_RE = /[㐀-鿿豈-﫿]/g;
const LATIN_RE = /[a-z]/gi;
const URL_OR_EMAIL_RE = /https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.]+/g;

export interface LanguageInput {
  subject: string | null;
  bodyText: string;
  fromAddress: string | null;
}

function firstIndex(text: string, patterns: RegExp[]): number {
  const found = patterns.map((re) => text.search(re)).filter((i) => i >= 0);
  return found.length ? Math.min(...found) : -1;
}

/** 截掉引用历史：妙搭的引用头之外，再截腾讯「原始邮件」分隔线和 发件人/From 头 */
function cutQuoted(text: string): string {
  const active = stripQuotedHistory(text);
  const cut = firstIndex(active, [FORWARD_MARKER_RE, FROM_HEADER_RE]);
  return cut > 0 ? active.slice(0, cut) : active;
}

/**
 * 客户本人写的那段文字。转发来的信（领导转发地址或主题带 Fw / 转发）：
 * 跳过转发人的附言和转发头，只取被转发的客户原文；否则取正文去掉引用后的部分。
 */
export function customerText(email: LanguageInput): string {
  const text = repairDegradedEmailText(email.bodyText);
  const forwarded = isLeaderForward(email.fromAddress) || FORWARD_SUBJECT_RE.test(email.subject ?? '');
  if (!forwarded) return cutQuoted(text);
  const start = firstIndex(text, [FORWARD_MARKER_RE, FROM_HEADER_RE]);
  if (start < 0) return cutQuoted(text);
  const lines = text.slice(start).split('\n');
  let i = 0;
  while (i < lines.length && (!lines[i].trim() || FORWARD_MARKER_RE.test(lines[i]) || HEADER_LINE_RE.test(lines[i]))) i++;
  return cutQuoted(lines.slice(i).join('\n'));
}

/** 只按字符统计判断是不是中文：一个汉字大致相当于三个英文字母 */
export function isChineseText(text: string): boolean {
  const clean = text.replace(URL_OR_EMAIL_RE, ' ');
  const cjk = clean.match(CJK_RE)?.length ?? 0;
  const latin = clean.match(LATIN_RE)?.length ?? 0;
  return cjk >= 4 && cjk * 3 >= latin;
}

/**
 * 客户语言由代码判定，不信模型：模型会被中文转发头、转发人附言带偏。
 * 中文只看客户原文；不是中文时保留模型给的 other（如西班牙语），其余一律 en。
 */
export function detectCustomerLanguage(email: LanguageInput, modelLanguage: Language): Language {
  if (isChineseText(customerText(email))) return 'zh';
  return modelLanguage === 'other' ? 'other' : 'en';
}
