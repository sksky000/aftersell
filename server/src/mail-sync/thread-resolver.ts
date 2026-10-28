import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { emailMessage } from '../db/schema';
import { caseRelation, selectCaseMessages, type CaseMessage } from '../mail/case-association';
import { isDepothelpSender } from '../mail/depothelp';
import { isLeaderForward } from '../mail/leader-forward';
import type { IncomingEmail } from '../mail/parse-incoming';

/** 数据库或事务，二者查询接口相同 */
export type DbExecutor = Pick<Database, 'select' | 'update'>;

const LOOKBACK_MS = 30 * 86_400_000;

/**
 * 为新来信找到所属案件的线程锚点（妙搭版 resolveThreadId）。
 * 先按 In-Reply-To / References 精确匹配，再在同一客户 30 天内的来信里按案件规则判断；
 * 有歧义时返回 null，交给人工，绝不按发件人自动合并。
 * M4 发送上线后，还要把“引用了我方已发回复”的来信接到对应案件上。
 */
export async function resolveThreadId(db: DbExecutor, email: IncomingEmail): Promise<string | null> {
  const source: CaseMessage = {
    messageId: email.messageId,
    fromAddress: email.fromAddress,
    subject: email.subject,
    bodyText: email.bodyText,
    inReplyTo: email.inReplyTo,
    refChain: email.references,
    receivedAt: email.receivedAt,
  };

  const referenced = `${email.inReplyTo ?? ''} ${email.references ?? ''}`.split(/\s+/).filter(Boolean);
  if (referenced.length) {
    const existing = await db.select().from(emailMessage).where(inArray(emailMessage.messageId, referenced));
    const match = existing.find((row) => caseRelation(source, row) === 'same');
    if (match) return match.threadId ?? adoptThreadAnchor(db, match);
  }

  if (!email.fromAddress || isDepothelpSender(email.fromAddress) || isLeaderForward(email.fromAddress) || !email.receivedAt) {
    return null;
  }
  const prior = await db
    .select()
    .from(emailMessage)
    .where(
      and(
        sql`lower(${emailMessage.fromAddress}) = ${email.fromAddress.toLowerCase()}`,
        lte(emailMessage.receivedAt, email.receivedAt),
        gte(emailMessage.receivedAt, new Date(email.receivedAt.getTime() - LOOKBACK_MS)),
      ),
    )
    .orderBy(desc(emailMessage.receivedAt))
    .limit(200);
  const selected = selectCaseMessages(source, prior);
  if (selected.uncertain || !selected.rows.length) return null;
  const anchors = new Set(selected.rows.map((row) => row.threadId ?? row.messageId));
  if (anchors.size !== 1) return null;
  return selected.rows[0].threadId ?? adoptThreadAnchor(db, selected.rows[0]);
}

/** 首封来信没有 thread_id，被跟进时以它自己的 message_id 作为锚点 */
async function adoptThreadAnchor(db: DbExecutor, row: { messageId: string }): Promise<string> {
  await db.update(emailMessage).set({ threadId: row.messageId }).where(eq(emailMessage.messageId, row.messageId));
  return row.messageId;
}
