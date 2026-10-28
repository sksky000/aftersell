import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { emailAttachment, emailMessage } from '../db/schema';
import { isFollowUpEmail } from '../mail/follow-up-filter';
import type { IncomingEmail } from '../mail/parse-incoming';
import { STORAGE, type Storage, type StoredObject } from '../storage/storage';
import { resolveThreadId } from './thread-resolver';

export type IngestResult = 'inserted' | 'duplicate';

@Injectable()
export class IngestService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: Storage,
  ) {}

  /**
   * 幂等入库：message_id 已存在则不写。附件先按内容落盘（相同内容同一文件），
   * 邮件与附件记录在同一事务里写入，不会出现有信无附件的半条记录。
   */
  async ingest(email: IncomingEmail): Promise<IngestResult> {
    const [existing] = await this.db
      .select({ id: emailMessage.id })
      .from(emailMessage)
      .where(eq(emailMessage.messageId, email.messageId))
      .limit(1);
    if (existing) return 'duplicate';

    const stored: StoredObject[] = [];
    for (const att of email.attachments) stored.push(await this.storage.putContent(att.content));

    return this.db.transaction(async (tx) => {
      const threadId = await resolveThreadId(tx, email);
      const [row] = await tx
        .insert(emailMessage)
        .values({
          messageId: email.messageId,
          subject: email.subject,
          fromAddress: email.fromAddress,
          fromName: email.fromName,
          replyTo: email.replyTo,
          receivedAt: email.receivedAt,
          bodyText: email.bodyText,
          bodyHtml: email.bodyHtml,
          inReplyTo: email.inReplyTo,
          refChain: email.references,
          threadId,
          isFollowUp: threadId !== null || email.inReplyTo !== null || isFollowUpEmail(email.subject, email.bodyText),
        })
        .onConflictDoNothing({ target: emailMessage.messageId })
        .returning({ id: emailMessage.id });
      if (!row) return 'duplicate';

      if (stored.length) {
        await tx.insert(emailAttachment).values(
          email.attachments.map((att, i) => ({
            emailId: row.id,
            position: i,
            filename: att.filename,
            contentType: att.contentType,
            size: stored[i].size,
            sha256: stored[i].sha256,
            storageKey: stored[i].key,
            contentId: att.contentId,
            isInline: att.isInline,
          })),
        );
      }
      return 'inserted';
    });
  }
}
