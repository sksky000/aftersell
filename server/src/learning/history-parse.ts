import { repairDegradedEmailText } from '../mail/quote-strip';

const MAX_TEXT = 4000;

/** 引用历史的起点：英文客户端、Outlook、腾讯企业邮（中英文界面） */
const BOUNDARIES: RegExp[] = [
  /^on .{1,150}(?:\s*\n.{0,150})?\s*wrote:\s*$/im,
  /^[ \t>]*-{2,}[ \t]*(?:原始邮件|转发邮件信息|转发的邮件|original(?:\s+message)?|forwarded message)[ \t]*-{2,}/im,
  /^在 .{1,80}写道[：:]\s*$/m,
  /^[ \t>]*(?:from|发件人)[ \t]*[:：]/im,
];
const HEADER_LINE_RE = /^[ \t>]*(?:发件人|发送时间|收件人|抄送|主题|日期|时间|from|sent|date|to|cc|subject)[ \t]*[:：]/i;

function firstBoundary(text: string): number {
  const found = BOUNDARIES.map((re) => text.search(re)).filter((i) => i >= 0);
  return found.length ? Math.min(...found) : -1;
}

/**
 * 把一封已发送的回复拆成“我方写的部分”和“回复里引用的客户来信”。
 * 客户来信只取最近一封（更早的往来再往下的引用截掉）。没有引用时 customer 为空。
 */
export function splitReply(body: string): { reply: string; customer: string } {
  const text = repairDegradedEmailText(body).replace(/\r\n/g, '\n');
  const start = firstBoundary(text);
  if (start < 0) return { reply: text.trim().slice(0, MAX_TEXT), customer: '' };

  const reply = text.slice(0, start).trim();
  const lines = text.slice(start).split('\n');
  // 跳过引用起点那一行、紧跟的邮件头和空行
  let k = 1;
  while (k < lines.length && (!lines[k].trim() || HEADER_LINE_RE.test(lines[k]))) k += 1;
  const quoted = lines
    .slice(k)
    .join('\n')
    .replace(/^>[ \t]?/gm, '');
  const end = firstBoundary(quoted);
  const customer = (end > 0 ? quoted.slice(0, end) : end === 0 ? '' : quoted).trim();
  return { reply: reply.slice(0, MAX_TEXT), customer: customer.slice(0, MAX_TEXT) };
}
