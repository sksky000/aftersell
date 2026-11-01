import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { ANALYTICS_TIMEZONE, llmPricingSchema, type AnalyticsDto, type LlmPricing } from '@aftersell/shared';
import { DB, type Database } from '../db/db.module';
import { SettingsService } from '../settings/settings.service';

const PRICING_KEY = 'llm.pricing';
const TZ = ANALYTICS_TIMEZONE;

type Row = Record<string, unknown>;
const num = (v: unknown) => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

/** 按单价估算费用（元）；没配单价返回 null */
export function costOf(pricing: LlmPricing, model: string, inputTokens: number, outputTokens: number): number | null {
  const p = pricing.prices.find((x) => x.model === model);
  if (!p) return null;
  return (inputTokens * p.inputPerMillion + outputTokens * p.outputPerMillion) / 1_000_000;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  pricing(): Promise<LlmPricing> {
    return this.settings.get(PRICING_KEY, llmPricingSchema, { prices: [] });
  }

  async savePricing(actorId: string, pricing: LlmPricing): Promise<LlmPricing> {
    await this.settings.set(PRICING_KEY, pricing, actorId);
    this.logger.log(`模型单价已更新 by=${actorId}`);
    return pricing;
  }

  private async rows(query: SQL): Promise<Row[]> {
    const result = await this.db.execute(query);
    return result.rows as Row[];
  }

  async summary(days: number): Promise<AnalyticsDto> {
    // 区间：北京时间今天往前 days 天（含今天）的 0 点起
    const [range] = await this.rows(sql`
      select ((date_trunc('day', now() at time zone ${TZ}) - make_interval(days => ${days - 1})) at time zone ${TZ}) as "from", now() as "to"`);
    // 不同驱动下时间列可能是 Date 也可能是字符串
    const from = new Date(range.from as string | Date);
    const to = new Date(range.to as string | Date);
    const received = sql`coalesce(m.received_at, m.created_at)`;
    const sentAt = sql`coalesce(o.sent_at, o.created_at)`;

    const [overview, trend, byCategory, byPartType, timeliness, backlog, quality, qualityByCategory, drafts, checks, llmRows, llmDays, pricing] =
      await Promise.all([
        this.rows(sql`
          select
            (select count(*) from email_message m where ${received} >= ${from}) as received,
            (select count(*) from outbound_message o where ${sentAt} >= ${from}) as replied,
            (select count(*) from email_message where status = 'pending_review') as pending_now,
            (select count(*) from email_message where status = 'ignored') as ignored`),
        this.rows(sql`
          with days as (
            select generate_series(date_trunc('day', ${from} at time zone ${TZ}), date_trunc('day', now() at time zone ${TZ}), interval '1 day')::date as day
          )
          select to_char(d.day, 'YYYY-MM-DD') as day,
            (select count(*) from email_message m where (${received} at time zone ${TZ})::date = d.day) as received,
            (select count(*) from outbound_message o where (${sentAt} at time zone ${TZ})::date = d.day) as replied
          from days d order by d.day`),
        this.rows(sql`select category as key, count(*) as count from email_message m where ${received} >= ${from} and pipeline_state <> 'ingested' group by 1 order by 2 desc`),
        this.rows(sql`select part_type as key, count(*) as count from email_message m where ${received} >= ${from} and pipeline_state <> 'ingested' group by 1 order by 2 desc`),
        // 首次回复用时：来信到我方第一封回复（In-Reply-To 指向它）的小时数
        this.rows(sql`
          with firsts as (
            select extract(epoch from (min(${sentAt}) - ${received})) / 3600.0 as hours
            from email_message m join outbound_message o on o.in_reply_to = m.message_id
            where ${received} >= ${from}
            group by m.id, ${received}
          )
          select count(*) as n,
            percentile_cont(0.5) within group (order by hours) as median,
            percentile_cont(0.9) within group (order by hours) as p90,
            avg(case when hours <= 24 then 1.0 else 0.0 end) as within24
          from firsts where hours >= 0`),
        this.rows(sql`
          select case
              when age < interval '1 day' then '<1d'
              when age < interval '3 days' then '1-3d'
              when age < interval '7 days' then '3-7d'
              else '>7d' end as bucket,
            count(*) as count
          from (select now() - coalesce(received_at, created_at) as age from email_message where status = 'pending_review') t
          group by 1`),
        this.rows(sql`
          select count(*) as sent,
            count(*) filter (where btrim(r.final_content) = btrim(r.draft_content)) as unedited
          from email_reply r
          where r.status = 'sent' and r.sent_at >= ${from} and btrim(r.draft_content) <> ''`),
        this.rows(sql`
          select m.category, count(*) as sent,
            count(*) filter (where btrim(r.final_content) <> btrim(r.draft_content)) as edited
          from email_reply r join email_message m on m.id = r.email_id
          where r.status = 'sent' and r.sent_at >= ${from} and btrim(r.draft_content) <> ''
          group by 1 order by 2 desc`),
        this.rows(sql`select count(*) as n from email_reply where created_at >= ${from} and provider is not null`),
        this.rows(sql`
          select c->>'code' as key, count(*) as count
          from email_reply r, jsonb_array_elements(r.checks) c
          where r.created_at >= ${from} and r.provider is not null
          group by 1 order by 2 desc`),
        this.rows(sql`
          select slot, model, count(*) as calls, count(*) filter (where not ok) as failed,
            coalesce(sum(input_tokens), 0) as input_tokens, coalesce(sum(output_tokens), 0) as output_tokens,
            coalesce(avg(duration_ms), 0) as avg_ms
          from llm_call where created_at >= ${from}
          group by 1, 2 order by 3 desc`),
        this.rows(sql`
          select to_char((created_at at time zone ${TZ})::date, 'YYYY-MM-DD') as day, model, count(*) as calls,
            coalesce(sum(input_tokens), 0) as input_tokens, coalesce(sum(output_tokens), 0) as output_tokens
          from llm_call where created_at >= ${from}
          group by 1, 2`),
        this.pricing(),
      ]);

    const o = overview[0] ?? {};
    const t = timeliness[0] ?? {};
    const q = quality[0] ?? {};
    const bySlot = llmRows.map((r) => {
      const inputTokens = num(r.input_tokens);
      const outputTokens = num(r.output_tokens);
      return {
        slot: String(r.slot),
        model: String(r.model),
        calls: num(r.calls),
        failed: num(r.failed),
        inputTokens,
        outputTokens,
        avgMs: Math.round(num(r.avg_ms)),
        costCny: costOf(pricing, String(r.model), inputTokens, outputTokens),
      };
    });
    const dayCost = new Map<string, { calls: number; costCny: number }>();
    for (const r of llmDays) {
      const d = dayCost.get(String(r.day)) ?? { calls: 0, costCny: 0 };
      d.calls += num(r.calls);
      d.costCny += costOf(pricing, String(r.model), num(r.input_tokens), num(r.output_tokens)) ?? 0;
      dayCost.set(String(r.day), d);
    }
    const BUCKETS = ['<1d', '1-3d', '3-7d', '>7d'] as const;
    const backlogMap = new Map(backlog.map((r) => [String(r.bucket), num(r.count)]));

    return {
      range: { days, from: from.toISOString(), to: to.toISOString() },
      overview: { received: num(o.received), replied: num(o.replied), pendingNow: num(o.pending_now), ignored: num(o.ignored) },
      trend: trend.map((r) => ({ day: String(r.day), received: num(r.received), replied: num(r.replied) })),
      byCategory: byCategory.map((r) => ({ key: String(r.key), count: num(r.count) })),
      byPartType: byPartType.map((r) => ({ key: String(r.key), count: num(r.count) })),
      timeliness: {
        repliedEmails: num(t.n),
        medianHours: numOrNull(t.median),
        p90Hours: numOrNull(t.p90),
        within24hRate: numOrNull(t.within24),
      },
      backlog: BUCKETS.map((bucket) => ({ bucket, count: backlogMap.get(bucket) ?? 0 })),
      aiQuality: {
        sentWithDraft: num(q.sent),
        unedited: num(q.unedited),
        byCategory: qualityByCategory.map((r) => ({ category: String(r.category), sent: num(r.sent), edited: num(r.edited) })),
        draftsGenerated: num(drafts[0]?.n),
        checks: checks.map((r) => ({ key: String(r.key), count: num(r.count) })),
      },
      llm: {
        calls: bySlot.reduce((s, r) => s + r.calls, 0),
        failed: bySlot.reduce((s, r) => s + r.failed, 0),
        inputTokens: bySlot.reduce((s, r) => s + r.inputTokens, 0),
        outputTokens: bySlot.reduce((s, r) => s + r.outputTokens, 0),
        costCny: bySlot.reduce((s, r) => s + (r.costCny ?? 0), 0),
        unpricedModels: [...new Set(bySlot.filter((r) => r.costCny === null).map((r) => r.model))],
        bySlot,
        byDay: [...dayCost.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v })),
      },
    };
  }
}
