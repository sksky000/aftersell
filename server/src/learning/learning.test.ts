import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/db.module';
import * as schema from '../db/schema';
import { loadPrompt } from '../llm/prompts';
import type { LlmService } from '../llm/llm.service';
import type { SettingsService } from '../settings/settings.service';
import type { HistoryAccount } from './history-account';
import { LearningService, MIN_CLUSTER_SIZE } from './learning.service';

// 内嵌 PostgreSQL + 假模型；数据全部为合成
let db: ReturnType<typeof drizzle<typeof schema>>;
let service: LearningService;
const store = new Map<string, unknown>();

const fakeLlm = {
  isAvailable: async () => true,
  extract: async (_slot: string, req: { system: string; user: string }) => {
    if (req.system === loadPrompt('history_label')) {
      const afterSales = !req.user.includes('internal memo');
      return { data: { isAfterSales: afterSales, category: afterSales ? 'quality_issue' : 'other', partType: afterSales ? 'battery' : 'other', customerSentMedia: true } };
    }
    if (req.system === loadPrompt('card_mining')) {
      return {
        data: {
          skeleton: ['致歉', '索要电池与车身照片', '确认后补发'],
          facts: ['电池保修 1 年', 'The battery costs $225 including shipping'],
          rules: ['未收到照片前不承诺补发', '联系 pay@example.test 付款'],
          drift: '',
        },
      };
    }
    if (req.system === loadPrompt('style_mining')) {
      return { data: { candidates: [{ text: '客户已说明无收据时不再索要收据', category: null, partType: null, evidence: [1, 2, 99] }, { text: 'x', category: null, partType: null, evidence: [1] }] } };
    }
    throw new Error('unexpected prompt');
  },
} as unknown as LlmService;

const fakeSettings = {
  get: async (key: string, _schema: unknown, fallback: unknown) => (store.has(key) ? store.get(key) : fallback),
  set: async (key: string, value: unknown) => void store.set(key, value),
  remove: async (key: string) => void store.delete(key),
} as unknown as SettingsService;

async function waitFor(job: 'label' | 'cards' | 'styles') {
  for (let i = 0; i < 200; i += 1) {
    const s = (await service.status()).jobs[job];
    if (s.state === 'done' || s.state === 'failed') return s;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timeout');
}

beforeAll(async () => {
  const pg = new PGlite();
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../../drizzle') });
  await db.insert(schema.historyReply).values([
    ...Array.from({ length: MIN_CLUSTER_SIZE + 2 }, (_, i) => ({
      messageId: `<h${i}@us>`,
      sentAt: new Date(Date.now() - i * 3600_000),
      replyText: `Hi, please send photos of the battery (${i}).`,
      customerText: i % 2 ? 'My battery does not charge, photo attached.' : '',
    })),
    { messageId: '<memo@us>', replyText: 'internal memo to the warehouse', customerText: '' },
  ]);
  // 同场景已有一张妙搭卡，候选通过后应被停用
  await db.insert(schema.knowledgeCard).values({ clusterKey: 'old', category: 'quality_issue', partType: 'battery', imageFlag: 'with_images', sampleSize: 10, enabled: true });
  service = new LearningService(db as unknown as Database, fakeSettings, fakeLlm, { get: async () => null } as unknown as HistoryAccount);
  await service.onModuleInit();
});

describe('learning flow (real SQL)', () => {
  it('labels history replies and groups them into scenes', async () => {
    service.startLabel();
    expect((await waitFor('label')).state).toBe('done');
    const s = await service.status();
    expect(s.history).toEqual({ total: MIN_CLUSTER_SIZE + 3, labeled: MIN_CLUSTER_SIZE + 3, afterSales: MIN_CLUSTER_SIZE + 2, failed: 0 });
    expect(s.clusters[0]).toMatchObject({ category: 'quality_issue', partType: 'battery', imageFlag: 'with_images', count: MIN_CLUSTER_SIZE + 2, pendingDraft: false });
  });

  it('mines a card candidate without prices or contacts, then approving replaces the old card', async () => {
    service.startCards();
    expect((await waitFor('cards')).message).toContain('生成 1 张');
    const [c] = await service.cardCandidates('draft');
    expect(c.facts).toEqual(['电池保修 1 年']);
    expect(c.rules).toEqual(['未收到照片前不承诺补发']);
    expect(c.current?.sampleSize).toBe(10);
    expect(c.samples.length).toBeGreaterThan(0);
    // 已有待审候选的场景不会重复生成
    service.startCards();
    expect((await waitFor('cards')).message).toContain('没有新的场景');

    await service.reviewCard(c.id, null as unknown as string, { action: 'approve' });
    const live = await db.select().from(schema.knowledgeCard).where(and(eq(schema.knowledgeCard.enabled, true), eq(schema.knowledgeCard.status, 'approved')));
    expect(live.map((r) => r.id)).toEqual([c.id]);
    await expect(service.reviewCard(c.id, null as unknown as string, { action: 'reject' })).rejects.toThrow('已经审核过');
  });

  it('turns corrections into style candidates with evidence', async () => {
    const [email] = await db.insert(schema.emailMessage).values({ messageId: '<e@x>' }).returning();
    await db.insert(schema.replyCorrection).values(
      Array.from({ length: 6 }, (_, i) => ({ emailId: email.id, category: 'quality_issue' as const, partType: 'battery' as const, originalDraft: `Please send the receipt ${i}`, finalContent: `Please send the order number ${i}` })),
    );
    service.startStyles();
    expect((await waitFor('styles')).message).toContain('提出 1 条');
    const [st] = await service.styleCandidates('draft');
    expect(st.text).toBe('客户已说明无收据时不再索要收据');
    expect(st.evidence).toHaveLength(2);
    await service.reviewStyle(st.id, null as unknown as string, { action: 'approve' });
    const [row] = await db.select().from(schema.styleRule).where(eq(schema.styleRule.id, st.id));
    expect(row).toMatchObject({ status: 'approved', enabled: true });
    expect((await service.status()).unminedCorrections).toBe(0);
  });
});
