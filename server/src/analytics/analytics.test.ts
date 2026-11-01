import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/db.module';
import * as schema from '../db/schema';
import type { SettingsService } from '../settings/settings.service';
import { AnalyticsService, costOf } from './analytics.service';

// 在内嵌 PostgreSQL（PGlite）上跑真实迁移和统计 SQL；数据全部为合成
const HOUR = 3600_000;
const now = Date.now();
const ago = (h: number) => new Date(now - h * HOUR);

let service: AnalyticsService;

beforeAll(async () => {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../../drizzle') });

  const emails = await db
    .insert(schema.emailMessage)
    .values([
      { messageId: '<a@x>', receivedAt: ago(2), status: 'pending_review', category: 'quality_issue', partType: 'battery', pipelineState: 'drafted' },
      { messageId: '<b@x>', receivedAt: ago(50), status: 'replied', category: 'quality_issue', partType: 'battery', pipelineState: 'drafted' },
      { messageId: '<c@x>', receivedAt: ago(30), status: 'replied', category: 'parts_request', partType: 'key', pipelineState: 'drafted' },
      { messageId: '<d@x>', receivedAt: ago(24 * 10), status: 'pending_review', category: 'refund', partType: 'other', pipelineState: 'classified' },
      { messageId: '<old@x>', receivedAt: ago(24 * 60), status: 'ignored', category: 'other', partType: 'other', pipelineState: 'classified' },
    ])
    .returning({ id: schema.emailMessage.id, messageId: schema.emailMessage.messageId });
  const id = (m: string) => emails.find((e) => e.messageId === m)!.id;

  await db.insert(schema.outboundMessage).values([
    { messageId: '<r1@us>', inReplyTo: '<b@x>', sentAt: ago(40), source: 'system', bodyText: 'Hi' },
    { messageId: '<r2@us>', inReplyTo: '<c@x>', sentAt: ago(28), source: 'imap_sent', bodyText: 'Hi' },
  ]);
  await db.insert(schema.emailReply).values([
    // 改过再发
    { emailId: id('<b@x>'), version: 1, status: 'sent', draftContent: 'Draft A', finalContent: 'Draft A edited', sentAt: ago(40), provider: 'deepseek', checks: [{ code: 'unknown_price', message: 'x' }] },
    // 原样发出
    { emailId: id('<c@x>'), version: 1, status: 'sent', draftContent: 'Draft B', finalContent: ' Draft B ', sentAt: ago(28), provider: 'deepseek' },
    { emailId: id('<a@x>'), version: 1, status: 'draft', draftContent: 'Draft C', provider: 'deepseek', checks: [{ code: 'unknown_price', message: 'y' }] },
  ]);
  await db.insert(schema.llmCall).values([
    { slot: 'draft', provider: 'deepseek', model: 'm-priced', ok: true, inputTokens: 1_000_000, outputTokens: 500_000, durationMs: 40_000, inputHash: 'a'.repeat(64), createdAt: ago(3) },
    { slot: 'draft', provider: 'deepseek', model: 'm-priced', ok: false, inputTokens: 0, outputTokens: 0, durationMs: 1000, inputHash: 'b'.repeat(64), createdAt: ago(3) },
    { slot: 'vision', provider: 'dashscope', model: 'm-unpriced', ok: true, inputTokens: 2000, outputTokens: 300, durationMs: 5000, inputHash: 'c'.repeat(64), createdAt: ago(3) },
  ]);

  const settings = { get: async () => ({ prices: [{ model: 'm-priced', inputPerMillion: 2, outputPerMillion: 8 }] }) } as unknown as SettingsService;
  service = new AnalyticsService(db as unknown as Database, settings);
});

describe('analytics summary (real SQL)', () => {
  it('counts the range, trend and distributions', async () => {
    const s = await service.summary(7);
    expect(s.overview).toEqual({ received: 3, replied: 2, pendingNow: 2, ignored: 1 });
    expect(s.trend).toHaveLength(7);
    expect(s.trend.reduce((n, d) => n + d.received, 0)).toBe(3);
    expect(s.trend.reduce((n, d) => n + d.replied, 0)).toBe(2);
    expect(s.byCategory).toEqual([
      { key: 'quality_issue', count: 2 },
      { key: 'parts_request', count: 1 },
    ]);
    // 90 天范围包含 10 天前那封
    expect((await service.summary(90)).overview.received).toBe(5);
  });

  it('measures first-reply time and the pending backlog', async () => {
    const s = await service.summary(7);
    expect(s.timeliness.repliedEmails).toBe(2);
    expect(s.timeliness.medianHours).toBeCloseTo(6, 1); // 10 小时与 2 小时
    expect(s.timeliness.within24hRate).toBe(1);
    expect(s.backlog).toEqual([
      { bucket: '<1d', count: 1 },
      { bucket: '1-3d', count: 0 },
      { bucket: '3-7d', count: 0 },
      { bucket: '>7d', count: 1 },
    ]);
  });

  it('separates edited from unedited AI drafts and counts checks', async () => {
    const q = (await service.summary(7)).aiQuality;
    expect(q.sentWithDraft).toBe(2);
    expect(q.unedited).toBe(1);
    expect(q.byCategory).toContainEqual({ category: 'quality_issue', sent: 1, edited: 1 });
    expect(q.draftsGenerated).toBe(3);
    expect(q.checks).toEqual([{ key: 'unknown_price', count: 2 }]);
  });

  it('estimates model cost only for priced models', async () => {
    const l = (await service.summary(7)).llm;
    expect(l.calls).toBe(3);
    expect(l.failed).toBe(1);
    expect(l.costCny).toBeCloseTo(2 + 4, 6);
    expect(l.unpricedModels).toEqual(['m-unpriced']);
    expect(l.byDay.reduce((n, d) => n + d.calls, 0)).toBe(3);
    expect(costOf({ prices: [] }, 'x', 1, 1)).toBeNull();
  });
});
