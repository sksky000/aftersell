import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, ilike, isNotNull } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { emailAttachment, emailMessage } from '../db/schema';
import { isFollowUpEmail } from '../mail/follow-up-filter';
import { restoreForwardedAddresses } from '../mail/forward-address';
import type { IncomingEmail } from '../mail/parse-incoming';
import { STORAGE, type Storage, type StoredObject } from '../storage/storage';
import { resolveThreadId } from './thread-resolver';

export type IngestResult = { status: 'inserted'; id: string } | { status: 'duplicate' };

@Injectable()
export class IngestService implements OnModuleInit {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: Storage,
  ) {}

  /** 补回入库规则改进前存下的转发邮件里缺失的客户地址（纯本地计算，已补过的不会再变） */
  async onModuleInit(): Promise<void> {
    const rows = await this.db
      .select({ id: emailMessage.id, bodyText: emailMessage.bodyText, bodyHtml: emailMessage.bodyHtml })
      .from(emailMessage)
      .where(and(isNotNull(emailMessage.bodyHtml), ilike(emailMessage.bodyHtml, '%mailto:%')));
    let fixed = 0;
    for (const row of rows) {
      const restored = restoreForwardedAddresses(row.bodyText, row.bodyHtml);
      if (restored === row.bodyText) continue;
      await this.db.update(emailMessage).set({ bodyText: restored, updatedAt: new Date() }).where(eq(emailMessage.id, row.id));
      fixed += 1;
    }
    if (fixed) this.logger.log(`从 HTML 补回转发邮件里的客户地址 ${fixed} 封`);
  }

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
    if (existing) return { status: 'duplicate' };

    const stored: StoredObject[] = [];
    for (const att of email.attachments) stored.push(await this.storage.putContent(att.content));

    return this.db.transaction(async (tx): Promise<IngestResult> => {
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
      if (!row) return { status: 'duplicate' };

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
      return { status: 'inserted', id: row.id };
    });
  }
}
