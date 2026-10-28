import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type {
  EmailAttachmentDto,
  EmailDetailDto,
  EmailListItem,
  EmailListQuery,
  EmailListResponse,
  InboxStatsDto,
  ThreadItemDto,
} from '@aftersell/shared';
import { DB, type Database } from '../db/db.module';
import { emailAttachment, emailMessage, type EmailAttachmentRow, type EmailMessageRow } from '../db/schema';
import { stripQuotedHistory } from '../mail/quote-strip';
import { STORAGE, type Storage } from '../storage/storage';

const PREVIEW_SOURCE_CHARS = 4000;
const PREVIEW_CHARS = 200;

/** 列表不取完整正文和 HTML */
const listColumns = {
  id: emailMessage.id,
  subject: emailMessage.subject,
  fromName: emailMessage.fromName,
  fromAddress: emailMessage.fromAddress,
  receivedAt: emailMessage.receivedAt,
  createdAt: emailMessage.createdAt,
  status: emailMessage.status,
  pipelineState: emailMessage.pipelineState,
  urgency: emailMessage.urgency,
  partType: emailMessage.partType,
  category: emailMessage.category,
  evidenceStatus: emailMessage.evidenceStatus,
  missingEvidence: emailMessage.missingEvidence,
  isSafetyHazard: emailMessage.isSafetyHazard,
  summary: emailMessage.summary,
  isFollowUp: emailMessage.isFollowUp,
  threadId: emailMessage.threadId,
  bodyHead: sql<string>`left(${emailMessage.bodyText}, ${PREVIEW_SOURCE_CHARS})`,
};
type ListRow = Pick<EmailMessageRow, Exclude<keyof typeof listColumns, 'bodyHead'>> & { bodyHead: string };

function preview(text: string): string {
  const active = stripQuotedHistory(text).replace(/\s+/g, ' ').trim();
  return active.length > PREVIEW_CHARS ? `${active.slice(0, PREVIEW_CHARS)}…` : active;
}

function toListItem(row: ListRow, threadSize: number, attachmentCount: number): EmailListItem {
  const { bodyHead, threadId: _threadId, ...rest } = row;
  return {
    ...rest,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    preview: preview(bodyHead),
    threadSize,
    attachmentCount,
  };
}

function toAttachmentDto(row: EmailAttachmentRow): EmailAttachmentDto {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    isInline: row.isInline,
    url: `/api/emails/${row.emailId}/attachments/${row.id}`,
  };
}

function escapeLike(value: string): string {
  return value.replace(/([%_\\])/g, '\\$1');
}

@Injectable()
export class EmailsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: Storage,
  ) {}

  async list(q: EmailListQuery): Promise<EmailListResponse> {
    const conditions: SQL[] = [];
    if (q.status) conditions.push(eq(emailMessage.status, q.status));
    if (q.urgency) conditions.push(eq(emailMessage.urgency, q.urgency));
    if (q.partType) conditions.push(eq(emailMessage.partType, q.partType));
    if (q.category) conditions.push(eq(emailMessage.category, q.category));
    if (q.evidenceStatus) conditions.push(eq(emailMessage.evidenceStatus, q.evidenceStatus));
    if (q.pipelineState) conditions.push(eq(emailMessage.pipelineState, q.pipelineState));
    if (q.safetyHazard) conditions.push(eq(emailMessage.isSafetyHazard, q.safetyHazard === 'true'));
    if (q.contactStage) conditions.push(eq(emailMessage.isFollowUp, q.contactStage === 'follow_up'));
    if (q.search) {
      const term = `%${escapeLike(q.search)}%`;
      const match = or(
        ilike(emailMessage.subject, term),
        ilike(emailMessage.fromName, term),
        ilike(emailMessage.fromAddress, term),
        ilike(emailMessage.bodyText, term),
      );
      if (match) conditions.push(match);
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select(listColumns)
        .from(emailMessage)
        .where(where)
        .orderBy(sql`${emailMessage.receivedAt} desc nulls last`, desc(emailMessage.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(emailMessage).where(where),
    ]);

    const [threadSizes, attachmentCounts] = await Promise.all([
      this.threadSizes(rows.map((r) => r.threadId)),
      this.attachmentCounts(rows.map((r) => r.id)),
    ]);
    return {
      items: rows.map((row) =>
        toListItem(row, row.threadId ? threadSizes.get(row.threadId) ?? 1 : 1, attachmentCounts.get(row.id) ?? 0),
      ),
      total,
    };
  }

  async stats(): Promise<InboxStatsDto> {
    const pending = sql`${emailMessage.status} = 'pending_review'`;
    const n = (condition: SQL) => sql<number>`count(*) filter (where ${condition})::int`;
    const [row] = await this.db
      .select({
        pendingReview: n(pending),
        urgentPending: n(sql`${pending} and ${emailMessage.urgency} in ('urgent', 'high')`),
        replied: n(sql`${emailMessage.status} = 'replied'`),
        ignored: n(sql`${emailMessage.status} = 'ignored'`),
        safetyHazardPending: n(sql`${pending} and ${emailMessage.isSafetyHazard}`),
        evidenceIncompletePending: n(sql`${pending} and ${emailMessage.evidenceStatus} in ('partial', 'missing')`),
        unclassified: n(sql`${emailMessage.pipelineState} = 'ingested'`),
      })
      .from(emailMessage);
    return row;
  }

  private async findRow(id: string): Promise<EmailMessageRow> {
    const [row] = await this.db.select().from(emailMessage).where(eq(emailMessage.id, id)).limit(1);
    if (!row) throw new NotFoundException('邮件不存在');
    return row;
  }

  private async attachmentsOf(emailIds: string[]): Promise<Map<string, EmailAttachmentDto[]>> {
    const map = new Map<string, EmailAttachmentDto[]>();
    if (!emailIds.length) return map;
    const rows = await this.db
      .select()
      .from(emailAttachment)
      .where(inArray(emailAttachment.emailId, emailIds))
      .orderBy(asc(emailAttachment.position));
    for (const row of rows) map.set(row.emailId, [...(map.get(row.emailId) ?? []), toAttachmentDto(row)]);
    return map;
  }

  async detail(id: string): Promise<EmailDetailDto> {
    const row = await this.findRow(id);
    const [threadSizes, attachments] = await Promise.all([
      this.threadSizes([row.threadId]),
      this.attachmentsOf([row.id]),
    ]);
    const files = attachments.get(row.id) ?? [];
    return {
      ...toListItem({ ...row, bodyHead: row.bodyText.slice(0, PREVIEW_SOURCE_CHARS) }, row.threadId ? threadSizes.get(row.threadId) ?? 1 : 1, files.length),
      bodyText: row.bodyText,
      replyTo: row.replyTo,
      inReplyTo: row.inReplyTo,
      threadId: row.threadId,
      messageId: row.messageId,
      attachments: files,
    };
  }

  /** 同一案件的来信，按时间正序；M4 起加入我方已发回复 */
  async thread(id: string): Promise<ThreadItemDto[]> {
    const current = await this.findRow(id);
    const rows = current.threadId
      ? await this.db
          .select()
          .from(emailMessage)
          .where(eq(emailMessage.threadId, current.threadId))
          .orderBy(sql`coalesce(${emailMessage.receivedAt}, ${emailMessage.createdAt})`)
      : [current];
    const attachments = await this.attachmentsOf(rows.map((r) => r.id));
    return rows.map((row) => ({
      id: row.id,
      role: 'customer',
      subject: row.subject,
      fromName: row.fromName ?? row.fromAddress,
      sentAt: (row.receivedAt ?? row.createdAt).toISOString(),
      content: stripQuotedHistory(row.bodyText),
      attachments: attachments.get(row.id) ?? [],
    }));
  }

  async openAttachment(emailId: string, attachmentId: string) {
    const [row] = await this.db
      .select()
      .from(emailAttachment)
      .where(and(eq(emailAttachment.id, attachmentId), eq(emailAttachment.emailId, emailId)))
      .limit(1);
    if (!row) throw new NotFoundException('附件不存在');
    const file = await this.storage.open(row.storageKey).catch(() => {
      throw new NotFoundException('附件文件已丢失');
    });
    return { ...file, filename: row.filename, contentType: row.contentType };
  }

  private async threadSizes(threadIds: (string | null)[]): Promise<Map<string, number>> {
    const ids = [...new Set(threadIds.filter((t): t is string => Boolean(t)))];
    if (!ids.length) return new Map();
    const rows = await this.db
      .select({ threadId: emailMessage.threadId, size: count() })
      .from(emailMessage)
      .where(inArray(emailMessage.threadId, ids))
      .groupBy(emailMessage.threadId);
    return new Map(rows.map((r) => [r.threadId as string, r.size]));
  }

  private async attachmentCounts(emailIds: string[]): Promise<Map<string, number>> {
    if (!emailIds.length) return new Map();
    const rows = await this.db
      .select({ emailId: emailAttachment.emailId, n: count() })
      .from(emailAttachment)
      .where(inArray(emailAttachment.emailId, emailIds))
      .groupBy(emailAttachment.emailId);
    return new Map(rows.map((r) => [r.emailId, r.n]));
  }
}
