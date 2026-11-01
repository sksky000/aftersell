import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/db.module';
import * as schema from '../db/schema';
import type { SettingsService } from '../settings/settings.service';
import type { Storage } from '../storage/storage';
import { FeishuError, type FeishuService } from './feishu.service';
import { LedgerService } from './ledger.service';

// 内嵌 PostgreSQL + 假飞书接口；数据全部为合成
const calls: { method: string; path: string; body?: { fields: Record<string, unknown> } }[] = [];
let deleteNext = false;
const fakeFeishu = {
  ledgerEnabled: async () => true,
  tenantToken: async () => 't',
  ledgerTable: async () => ({ appToken: 'app', tableId: 'tbl' }),
  call: async (p: string, init: { method?: string; body?: { fields: Record<string, unknown> } } = {}) => {
    const method = init.method ?? (init.body ? 'POST' : 'GET');
    calls.push({ method, path: p, body: init.body });
    if (p.includes('/fields')) return { items: ['Name', 'Email', 'Case Status', 'Concern'].map((field_name) => ({ field_name, type: 1 })) };
    if (method === 'PUT' && deleteNext) {
      deleteNext = false;
      throw new FeishuError(1254043, 'RecordIdNotFound');
    }
    if (method === 'POST') return { record: { record_id: `rec${calls.length}` } };
    return {};
  },
} as unknown as FeishuService;
const store = new Map<string, unknown>();
const fakeSettings = {
  get: async (k: string, _s: unknown, fb: unknown) => (store.has(k) ? store.get(k) : fb),
  set: async (k: string, v: unknown) => void store.set(k, v),
} as unknown as SettingsService;

let db: ReturnType<typeof drizzle<typeof schema>>;
let ledger: LedgerService;
const tick = () => (ledger as unknown as { tick: () => Promise<void> }).tick();

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../../drizzle') });
  ledger = new LedgerService(db as unknown as Database, {} as Storage, fakeFeishu, fakeSettings);
});

describe('ledger sync (real SQL)', () => {
  it('creates one row per customer, then updates it when a reply is sent', async () => {
    const [a] = await db
      .insert(schema.emailMessage)
      .values([
        { messageId: '<1@x>', fromAddress: 'Pat@example.test', fromName: 'Pat Example', bodyText: 'Battery dead', pipelineState: 'drafted', receivedAt: new Date('2026-10-20T00:00:00Z') },
        { messageId: '<2@x>', fromAddress: 'pat@example.test', bodyText: 'Any update?', pipelineState: 'drafted', receivedAt: new Date('2026-10-25T00:00:00Z') },
        { messageId: '<3@x>', fromAddress: 'spam@example.test', bodyText: 'ad', pipelineState: 'classified', isComplaint: false },
      ])
      .returning();
    await tick();
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].body?.fields).toMatchObject({ Name: 'Pat Example', Email: 'pat@example.test', 'Case Status': 'Open' });
    const [row] = await db.select().from(schema.ledgerRow);
    expect(row).toMatchObject({ customerKey: 'pat@example.test', lastError: null });

    calls.length = 0;
    await tick();
    expect(calls).toHaveLength(0); // 没有变化不调接口

    await db.update(schema.emailMessage).set({ status: 'replied', updatedAt: new Date(Date.now() + 1000) }).where(eq(schema.emailMessage.id, a.id));
    await tick();
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.path).toContain(`/records/${row.recordId}`);
    expect(put?.body?.fields).toMatchObject({ 'Case Status': 'Open' }); // 最新一封仍待审核
  });

  it('recreates the row when it was deleted in the ledger', async () => {
    calls.length = 0;
    deleteNext = true;
    await db.update(schema.emailMessage).set({ status: 'replied', updatedAt: new Date(Date.now() + 5000) }).where(eq(schema.emailMessage.messageId, '<2@x>'));
    await tick();
    expect(calls.map((c) => c.method).filter((m) => m !== 'GET')).toEqual(['PUT', 'POST']);
    const [row] = await db.select().from(schema.ledgerRow);
    expect(row.recordId).not.toBeNull();
    expect(calls.find((c) => c.method === 'POST')?.body?.fields).toMatchObject({ 'Case Status': 'Resolved' });
  });
});
