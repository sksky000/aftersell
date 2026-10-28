import type { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/db.module';
import { emailMessage, outboundMessage } from '../db/schema';
import type { SettingsService } from '../settings/settings.service';

const CURSOR_KEY = 'mail.sent_cursor';
const FIRST_SCAN_DAYS = 90;
const HEADER_BATCH = 200;
const MAX_BODIES_PER_RUN = 200;

const cursorSchema = z.object({ path: z.string(), uidValidity: z.string(), lastUid: z.number().int() });
type SentCursor = z.infer<typeof cursorSchema>;

function ids(value: string | null | undefined): string[] {
  return (value ?? '').split(/\s+/).filter((v) => v.startsWith('<'));
}

/** 企业邮箱的“已发送”：优先 \Sent 特殊用途，其次按常见名字 */
async function findSentMailbox(client: ImapFlow): Promise<string | null> {
  const boxes = await client.list();
  const special = boxes.find((b) => b.specialUse === '\\Sent');
  if (special) return special.path;
  return boxes.find((b) => /^(sent( messages| items| mail)?|已发送)$/i.test(b.name))?.path ?? null;
}

/**
 * 只读同步“已发送”里引用了已入库来信的邮件（客服在邮箱里直接回的信也能进历史）。
 * 用 UIDVALIDITY + 最后 UID 做游标，只扫新邮件；首次回看 90 天。不改任何邮件状态。
 * @returns 新增的我方回复封数
 */
export async function syncSentFolder(client: ImapFlow, db: Database, settings: SettingsService, actorId: string | null): Promise<number> {
  const path = await findSentMailbox(client);
  if (!path) return 0;
  const lock = await client.getMailboxLock(path, { readOnly: true });
  try {
    const mailbox = client.mailbox;
    if (!mailbox) return 0;
    const uidValidity = String(mailbox.uidValidity);
    const cursor = await settings.get<SentCursor | null>(CURSOR_KEY, cursorSchema.nullable(), null);
    const resume = cursor && cursor.path === path && cursor.uidValidity === uidValidity ? cursor.lastUid : null;
    const found = await client.search(
      resume !== null ? { uid: `${resume + 1}:*` } : { since: new Date(Date.now() - FIRST_SCAN_DAYS * 86_400_000) },
      { uid: true },
    );
    // “n:*” 在没有新邮件时也会返回最后一封，需再按游标过滤
    const uids = (Array.isArray(found) ? found : []).filter((u) => resume === null || u > resume).sort((a, b) => a - b);
    if (!uids.length) return 0;

    const candidates: { uid: number; messageId: string; refs: string[] }[] = [];
    for (let i = 0; i < uids.length; i += HEADER_BATCH) {
      for await (const msg of client.fetch(uids.slice(i, i + HEADER_BATCH), { uid: true, envelope: true, headers: ['references'] }, { uid: true })) {
        const messageId = msg.envelope?.messageId;
        if (!messageId) continue;
        const references = msg.headers?.toString('utf8').replace(/^references:\s*/i, '').replace(/\r?\n[ \t]+/g, ' ') ?? '';
        const refs = [...new Set([...ids(msg.envelope?.inReplyTo), ...ids(references)])];
        if (refs.length) candidates.push({ uid: msg.uid, messageId, refs });
      }
    }

    const referenced = [...new Set(candidates.flatMap((c) => c.refs))];
    const [known, existing] = await Promise.all([
      referenced.length
        ? db.select({ id: emailMessage.messageId }).from(emailMessage).where(inArray(emailMessage.messageId, referenced))
        : [],
      candidates.length
        ? db.select({ id: outboundMessage.messageId }).from(outboundMessage).where(inArray(outboundMessage.messageId, candidates.map((c) => c.messageId)))
        : [],
    ]);
    const knownIds = new Set(known.map((k) => k.id));
    const existingIds = new Set(existing.map((e) => e.id));
    const targets = candidates
      .filter((c) => !existingIds.has(c.messageId) && c.refs.some((r) => knownIds.has(r)))
      .slice(0, MAX_BODIES_PER_RUN);

    let inserted = 0;
    let lastDone = uids[uids.length - 1];
    if (targets.length) {
      for await (const msg of client.fetch(targets.map((t) => t.uid), { uid: true, source: true }, { uid: true })) {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source, { skipImageLinks: true, skipTextToHtml: true });
        const html = typeof parsed.html === 'string' ? parsed.html : '';
        const body = (parsed.text ?? '').trim() || html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const to = (Array.isArray(parsed.to) ? parsed.to : parsed.to ? [parsed.to] : []).flatMap((a) => a.value.map((v) => v.address)).filter(Boolean);
        const refs = Array.isArray(parsed.references) ? parsed.references.join(' ') : parsed.references;
        const rows = await db
          .insert(outboundMessage)
          .values({
            messageId: (parsed.messageId ?? targets.find((t) => t.uid === msg.uid)!.messageId).slice(0, 998),
            inReplyTo: parsed.inReplyTo?.trim().split(/\s+/)[0]?.slice(0, 998) || null,
            refChain: refs?.slice(0, 5000) || null,
            subject: parsed.subject?.replace(/\u0000/g, '') ?? null,
            toAddresses: to.join(', ').slice(0, 2000) || null,
            sentAt: parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date : null,
            bodyText: body.replace(/\u0000/g, ''),
            source: 'imap_sent',
          })
          .onConflictDoNothing()
          .returning({ id: outboundMessage.id });
        inserted += rows.length;
      }
      // 单次有上限：没处理完的部分下次从最后处理的 UID 之后继续
      if (targets.length === MAX_BODIES_PER_RUN) lastDone = targets[targets.length - 1].uid;
    }
    await settings.set(CURSOR_KEY, { path, uidValidity, lastUid: lastDone } satisfies SentCursor, actorId);
    return inserted;
  } finally {
    lock.release();
  }
}
