import { randomBytes } from 'node:crypto';
import { MAX_SUBJECT_LENGTH } from '@aftersell/shared';
import { extractDepothelpCustomerEmail, isDepothelpSender, parseDepothelpSubject } from '../mail/depothelp';
import { extractForwardedCustomerEmail, isLeaderForward } from '../mail/leader-forward';

/** 发送格式层：引用块、主题、收件人、线程头、内嵌图。迁自妙搭 reply-quote / subject-tagger / inline-images */

export interface QuotedMessage {
  fromName: string | null;
  fromAddress: string | null;
  receivedAt: Date | null;
  subject: string | null;
  bodyText: string;
}

const QUOTE_DIVIDER = '----------- Original Message -------------';

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatQuoteDate(receivedAt: Date | null): string {
  if (!receivedAt || Number.isNaN(receivedAt.getTime())) return '';
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Shanghai' }).format(receivedAt);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Shanghai' }).format(receivedAt);
  return `${day} at ${time}`;
}

function quoteHeader(m: QuotedMessage, accountAddress: string): string {
  const name = (m.fromName ?? '').trim();
  const address = (m.fromAddress ?? '').trim();
  const lines = [QUOTE_DIVIDER, name && address ? `From: "${name}" <${address}>` : `From: ${address || name || 'customer'}`];
  const date = formatQuoteDate(m.receivedAt);
  if (date) lines.push(`Date: ${date}`);
  lines.push(`To: ${accountAddress}`);
  const subject = stripLegacySubjectTags((m.subject ?? '').trim());
  if (subject) lines.push(`Subject: ${subject}`);
  return lines.join('\n');
}

export function buildOutgoingText(content: string, m: QuotedMessage, accountAddress: string): string {
  const body = m.bodyText.trimEnd();
  if (!body) return content;
  return `${content}\n\n${quoteHeader(m, accountAddress)}\n\n${body}`;
}

export function textToHtml(text: string): string {
  return `<div>${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
}

export function buildOutgoingHtml(ownHtml: string, m: QuotedMessage, accountAddress: string): string {
  const body = m.bodyText.trimEnd();
  if (!body) return ownHtml;
  const header = escapeHtml(quoteHeader(m, accountAddress)).replace(/\n/g, '<br>');
  const quoted = escapeHtml(body).replace(/\n/g, '<br>');
  return `${ownHtml}<br><br><div>${header}<br><br><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #cccccc;padding-left:1ex">${quoted}</blockquote></div>`;
}

// ---------- 主题 ----------

const MAX_SUBJECT_WORDS = 15;
const MIN_TAG_WORDS = 2;
const MAX_PREFIX_WORDS = 8;
const TAG_TAIL_SEPARATORS = /^[.,;:\-/–—]+$/;
const BANNED_SUBJECT_TOKEN_RE = /\belgee\b/gi;
const LEGACY_SUBJECT_TAG_RE = /\s*\[[^[\]]*\|[^[\]]*\]\s*$/;
/** 转发进来的信，主题前缀要去掉，否则回给客户的主题会是 “Re: 转发: …” */
const FORWARD_PREFIX_RE = /^(?:(?:fwd?|转发)\s*[:：]\s*)+/i;

export interface SubjectTags {
  progress: string;
  issue: string;
}

const words = (v: string) => v.split(/\s+/).filter(Boolean);

export function stripBannedSubjectTokens(subject: string): string {
  return subject.replace(BANNED_SUBJECT_TOKEN_RE, ' ').replace(/\s{2,}/g, ' ').trim();
}

export function stripLegacySubjectTags(subject: string): string {
  let s = subject.trim();
  while (LEGACY_SUBJECT_TAG_RE.test(s)) s = s.replace(LEGACY_SUBJECT_TAG_RE, '').trim();
  return s;
}

export function cleanTag(value: unknown, maxWords: number): string {
  const text = String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/["'`]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/[.,;:\-/–—]+$/, '');
  return words(text.slice(0, 60)).slice(0, maxWords).join(' ');
}

export function buildFallbackSubject(baseSubject: string): string {
  if (parseDepothelpSubject(baseSubject)) return 'Update on your request';
  const base = stripBannedSubjectTokens(stripLegacySubjectTags(baseSubject)).replace(FORWARD_PREFIX_RE, '').trim();
  if (!base) return 'Re: Your inquiry';
  return /^re\s*:/i.test(base) ? base : `Re: ${base}`;
}

/** “Re: 原主题 [进展 | 问题]”，总长不超过 15 个词 */
export function composeOutgoingSubject(baseSubject: string, tags: SubjectTags): string {
  const depot = parseDepothelpSubject(baseSubject) !== null;
  let prefixWords = depot ? [] : words(buildFallbackSubject(baseSubject));
  if (prefixWords.length > MAX_PREFIX_WORDS) prefixWords = words(`${prefixWords.slice(0, MAX_PREFIX_WORDS).join(' ')}…`);
  let progress = words(tags.progress);
  let issue = words(tags.issue);
  const trimTail = (list: string[]) => {
    const out = [...list];
    while (out.length && TAG_TAIL_SEPARATORS.test(out[out.length - 1] ?? '')) out.pop();
    return out;
  };
  const total = () => (prefixWords.length === 0 ? progress.length + issue.length + 2 : prefixWords.length + progress.length + issue.length + 1);
  while (total() > MAX_SUBJECT_WORDS) {
    const canProgress = progress.length > MIN_TAG_WORDS;
    const canIssue = issue.length > MIN_TAG_WORDS;
    if (!canProgress && !canIssue) break;
    if (canIssue && (!canProgress || issue.length >= progress.length)) issue = trimTail(issue.slice(0, -1));
    else progress = trimTail(progress.slice(0, -1));
  }
  const tag = `[${progress.join(' ')} | ${issue.join(' ')}]`;
  if (!prefixWords.length) return tag.slice(0, MAX_SUBJECT_LENGTH);
  const tagWords = words(tag).length;
  if (prefixWords.length + tagWords <= MAX_SUBJECT_WORDS) return `${prefixWords.join(' ')} ${tag}`.slice(0, MAX_SUBJECT_LENGTH);
  const budget = Math.max(MAX_SUBJECT_WORDS - tagWords - 1, 1);
  return `${prefixWords.slice(0, budget).join(' ')}… ${tag}`.slice(0, MAX_SUBJECT_LENGTH);
}

export function sanitizeOutgoingSubject(raw: string): string {
  return stripBannedSubjectTokens(raw.replace(/[\r\n\t]+/g, ' ')).slice(0, MAX_SUBJECT_LENGTH);
}

// ---------- 收件人与线程头 ----------

export interface RecipientSource {
  fromAddress: string | null;
  replyTo: string | null;
  bodyText: string;
}

type Via = 'direct' | 'hotline' | 'leader_forward';
export type ReplyTarget = { to: string; via: Via; reason: null } | { to: null; via: Via; reason: string };

/** 热线工单回给工单里的客户邮箱，领导转发回给转发头里的客户，其他回给 Reply-To / 发件人 */
export function resolveReplyTarget(m: RecipientSource): ReplyTarget {
  const pick = (to: string | null, via: Via, reason: string): ReplyTarget => (to ? { to, via, reason: null } : { to: null, via, reason });
  if (isDepothelpSender(m.fromAddress)) {
    return pick(extractDepothelpCustomerEmail(m.bodyText), 'hotline', '这是 800 电话记录，工单里没有客户邮箱（Email Address 为空或 n/a），请电话联系客户');
  }
  if (isLeaderForward(m.fromAddress)) {
    return pick(extractForwardedCustomerEmail(m.bodyText), 'leader_forward', '这是领导转发的客诉，转发内容里找不到客户邮箱（缺少 From 行），请在邮箱里手动回复');
  }
  return pick((m.replyTo || m.fromAddress || '').trim().toLowerCase() || null, 'direct', '来信没有发件人地址，无法回复');
}

function bracketed(id: string): string {
  const inner = id.trim().replace(/^<+/, '').replace(/>+$/, '').trim();
  return inner ? `<${inner}>` : '';
}

/** References：来信的 References 链 + In-Reply-To + 来信自身，去重保序 */
export function buildReferences(m: { messageId: string; inReplyTo: string | null; refChain: string | null }): string {
  const ids = [...(m.refChain ?? '').split(/\s+/), m.inReplyTo ?? '', m.messageId];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const b = bracketed(id);
    if (!b || seen.has(b.toLowerCase())) continue;
    seen.add(b.toLowerCase());
    out.push(b);
  }
  return out.join(' ');
}

export function generateMessageId(fromAddress: string): string {
  const domain = fromAddress.split('@')[1] || 'aftersell.local';
  return `<reply-${Date.now()}-${randomBytes(6).toString('hex')}@${domain}>`;
}

// ---------- 内嵌图片 ----------

const IMG_TAG_RE = /<img\s[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
const UPLOAD_SRC_RE = /^(?:https?:\/\/[^/]+)?\/api\/uploads\/([0-9a-f-]{36})$/i;

export interface InlineImageRef {
  uploadId: string;
  cid: string;
}

/**
 * 把正文里引用上传图片的 <img> 换成 cid:。
 * 不是本系统上传的图片（外链、data:）一律报错，不让客户收到裂图。
 */
export function rewriteInlineImages(html: string, senderAddress: string): { html: string; images: InlineImageRef[]; invalid: string[] } {
  const domain = senderAddress.split('@')[1] || 'aftersell.local';
  const images: InlineImageRef[] = [];
  const invalid: string[] = [];
  const byUpload = new Map<string, string>();
  const out = html.replace(IMG_TAG_RE, (tag: string, rawSrc: string) => {
    const src = rawSrc.replace(/&amp;/g, '&').split(/[?#]/)[0];
    const id = src.match(UPLOAD_SRC_RE)?.[1]?.toLowerCase();
    if (!id) {
      invalid.push(src.slice(0, 80));
      return tag;
    }
    let cid = byUpload.get(id);
    if (!cid) {
      cid = `inline-${images.length + 1}-${id.slice(0, 8)}@${domain}`;
      byUpload.set(id, cid);
      images.push({ uploadId: id, cid });
    }
    return tag.replace(rawSrc, `cid:${cid}`);
  });
  return { html: out, images, invalid };
}
