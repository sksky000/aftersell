export interface PendingAttachment {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
  /** Content-ID without angle brackets, for cid: references in the HTML body. */
  contentId: string | null;
  isInline: boolean;
}
interface ParsedAttachment {
  filename?: string | false | null;
  contentType?: string;
  size?: number;
  content: unknown;
  cid?: string;
  contentDisposition?: string;
  related?: boolean;
}
const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_EMAIL = 10;

/** Keep the display name only: no directories, control characters or unbounded length. */
function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  return base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
}

/** MIME inline images and ordinary attachments share the same bounded import path. */
export function selectIncomingAttachments(parsed: readonly ParsedAttachment[]): PendingAttachment[] {
  const attachments: PendingAttachment[] = [];
  for (const att of parsed) {
    if (attachments.length >= MAX_ATTACHMENTS_PER_EMAIL) break;
    const contentType = (att.contentType ?? '').toLowerCase();
    if (!/^(image|video)\//.test(contentType) && contentType !== 'application/pdf') continue;
    if (!Buffer.isBuffer(att.content)) continue;
    const size = att.size ?? att.content.length;
    if (size <= 0 || size > MAX_ATTACHMENT_SIZE) continue;
    attachments.push({
      filename: (att.filename && safeFilename(att.filename)) || `attachment-${attachments.length + 1}`,
      contentType,
      size,
      content: att.content,
      contentId: att.cid ? att.cid.replace(/^<|>$/g, '').slice(0, 998) : null,
      isInline: att.contentDisposition === 'inline' || att.related === true,
    });
  }
  return attachments;
}
