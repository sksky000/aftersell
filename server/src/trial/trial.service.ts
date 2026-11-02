import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql, type SQL } from 'drizzle-orm';
import {
  TRIAL_RATINGS,
  type ParsedRateTrial,
  type TrialPairDto,
  type TrialPairsQuery,
  type TrialPairsResponse,
  type TrialRating,
  type TrialSummaryDto,
} from '@aftersell/shared';
import { DB, type Database } from '../db/db.module';
import { emailMessage, trialReview } from '../db/schema';
import { stripQuotedHistory } from '../mail/quote-strip';
import { isTrialMode } from '../mail/trial-mode';

type Row = Record<string, unknown>;
const TEXT_MAX = 4000;

/**
 * 可对比的来信：有 AI 草稿（最新一版），也有客服在邮箱 / 妙搭里实际发出的回复（已发送同步来的第一封）。
 * 客服实际回复是试跑期间判断草稿质量的参照。
 */
const PAIRS = sql`
  from email_message m
  join lateral (
    select draft_content, version from email_reply
    where email_id = m.id and btrim(draft_content) <> ''
    order by version desc limit 1
  ) r on true
  join lateral (
    select body_text, coalesce(sent_at, created_at) as sent_at from outbound_message
    where in_reply_to = m.message_id and source = 'imap_sent'
    order by coalesce(sent_at, created_at) asc limit 1
  ) o on true
  left join trial_review tr on tr.email_id = m.id`;

@Injectable()
export class TrialService {
  constructor(@Inject(DB) private readonly db: Database) {}

  private async rows(query: SQL): Promise<Row[]> {
    return (await this.db.execute(query)).rows as Row[];
  }

  async pairs(q: TrialPairsQuery): Promise<TrialPairsResponse> {
    const where = q.status === 'unrated' ? sql`where tr.email_id is null` : q.status === 'rated' ? sql`where tr.email_id is not null` : sql``;
    const [rows, [{ total }]] = await Promise.all([
      this.rows(sql`
        select m.id, m.subject, m.category, m.part_type, coalesce(m.received_at, m.created_at) as received_at, m.body_text,
          r.draft_content, r.version, o.body_text as actual, o.sent_at, tr.rating, tr.note
        ${PAIRS} ${where}
        order by coalesce(m.received_at, m.created_at) desc
        limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`),
      this.rows(sql`select count(*)::int as total ${PAIRS} ${where}`),
    ]);
    return {
      total: Number(total),
      items: rows.map(
        (r): TrialPairDto => ({
          emailId: String(r.id),
          subject: (r.subject as string | null) ?? null,
          category: String(r.category),
          partType: String(r.part_type),
          receivedAt: new Date(r.received_at as string).toISOString(),
          customer: stripQuotedHistory(String(r.body_text ?? '')).slice(0, TEXT_MAX),
          draft: String(r.draft_content).slice(0, TEXT_MAX),
          draftVersion: Number(r.version),
          actual: stripQuotedHistory(String(r.actual ?? '')).slice(0, TEXT_MAX),
          actualSentAt: new Date(r.sent_at as string).toISOString(),
          rating: (r.rating as TrialRating | null) ?? null,
          note: (r.note as string | null) ?? null,
        }),
      ),
    };
  }

  async summary(): Promise<TrialSummaryDto> {
    const [[totals], ratings, categories] = await Promise.all([
      this.rows(sql`select count(*)::int as pairs, count(tr.email_id)::int as rated ${PAIRS}`),
      this.rows(sql`select rating, count(*)::int as n from trial_review group by rating`),
      this.rows(sql`
        select m.category, count(*)::int as rated, count(*) filter (where tr.rating in ('ready', 'minor'))::int as usable
        from trial_review tr join email_message m on m.id = tr.email_id
        group by m.category order by 2 desc`),
    ]);
    const byRating = Object.fromEntries(TRIAL_RATINGS.map((k) => [k, 0])) as Record<TrialRating, number>;
    for (const r of ratings) byRating[r.rating as TrialRating] = Number(r.n);
    return {
      trialMode: isTrialMode(),
      pairs: Number(totals?.pairs ?? 0),
      rated: Number(totals?.rated ?? 0),
      byRating,
      byCategory: categories.map((c) => ({ category: String(c.category), rated: Number(c.rated), usable: Number(c.usable) })),
    };
  }

  async rate(emailId: string, reviewerId: string, dto: ParsedRateTrial): Promise<void> {
    const [row] = await this.db.select({ id: emailMessage.id }).from(emailMessage).where(eq(emailMessage.id, emailId)).limit(1);
    if (!row) throw new NotFoundException('邮件不存在');
    const values = { rating: dto.rating, note: dto.note, reviewerId, updatedAt: new Date() };
    await this.db.insert(trialReview).values({ emailId, ...values }).onConflictDoUpdate({ target: trialReview.emailId, set: values });
  }
}
