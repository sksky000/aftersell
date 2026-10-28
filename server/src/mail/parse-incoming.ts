import { createHash } from 'node:crypto';
import { simpleParser } from 'mailparser';
import { isDepothelpSender, normalizeDepothelpTicketText } from './depothelp';
import { selectIncomingAttachments, type PendingAttachment } from './incoming-attachments';
import { repairDegradedEmailText } from './quote-strip';

export interface IncomingEmail {
  messageId: string;
  inReplyTo: string | null;
  references: string | null;
  replyTo: string | null;
  subject: string | null;
  fromName: string | null;
  fromAddress: string | null;
  receivedAt: Date | null;
  bodyText: string;
  bodyHtml: string | null;
  attachments: PendingAttachment[];
}

const MAX_HTML_LENGTH = 2_000_000;

/** PostgreSQL text 不接受 NUL 字符 */
function clean(value: string): string;
function clean(value: string | null | undefined): string | null;
function clean(value: string | null | undefined): string | null {
  return value == null ? null : value.replace(/\u0000/g, '');
}

function validDate(value: Date | undefined | null): Date | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
}

/** 缺 Message-ID 时用内容摘要生成稳定 ID，重复拉取仍能去重 */
function fallbackMessageId(parts: (string | number | null | undefined)[]): string {
  const digest = createHash('sha256').update(parts.map((p) => String(p ?? '')).join('\u0000')).digest('hex');
  return `<no-id-${digest.slice(0, 32)}@aftersell.local>`;
}

/**
 * 把 IMAP 取回的原始邮件解析为入库字段。
 * @param internalDate IMAP 服务器收信时间，邮件头 Date 缺失或非法时使用
 */
export async function parseIncoming(source: Buffer | string, internalDate?: Date | null): Promise<IncomingEmail> {
  const parsed = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
  const from = parsed.from?.value?.[0];
  const fromAddress = from?.address?.trim().slice(0, 320) || null;
  const html = typeof parsed.html === 'string' ? clean(parsed.html) : null;

  let bodyText = repairDegradedEmailText(
    clean(parsed.text ?? '').trim() || (html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
  );
  if (isDepothelpSender(fromAddress)) bodyText = normalizeDepothelpTicketText(bodyText);

  const receivedAt = validDate(parsed.date) ?? validDate(internalDate);
  const references = Array.isArray(parsed.references) ? parsed.references.join(' ') : parsed.references;

  return {
    messageId: (
      parsed.messageId?.trim() ||
      fallbackMessageId([parsed.subject, fromAddress, receivedAt?.getTime(), bodyText.slice(0, 2000)])
    ).slice(0, 998),
    inReplyTo: parsed.inReplyTo?.trim().split(/\s+/)[0]?.slice(0, 998) || null,
    references: references?.trim().slice(0, 5000) || null,
    replyTo: parsed.replyTo?.value?.[0]?.address?.trim().slice(0, 320) || null,
    subject: clean(parsed.subject),
    fromName: clean(from?.name || parsed.from?.text || '').trim().slice(0, 255) || null,
    fromAddress,
    receivedAt,
    bodyText,
    bodyHtml: html ? html.slice(0, MAX_HTML_LENGTH) : null,
    attachments: selectIncomingAttachments(parsed.attachments ?? []),
  };
}
