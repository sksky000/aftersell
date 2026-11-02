import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/db.module';
import * as schema from '../db/schema';
import { TrialService } from './trial.service';

// 内嵌 PostgreSQL；数据全部为合成
let service: TrialService;
let paired: string;

beforeAll(async () => {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../../drizzle') });
  const emails = await db
    .insert(schema.emailMessage)
    .values([
      { messageId: '<a@x>', bodyText: 'Battery dead\n\nOn Mon, Oct 12, 2026 Support wrote:\n> old', category: 'quality_issue', partType: 'battery', status: 'replied', receivedAt: new Date('2026-10-20T00:00:00Z') },
      { messageId: '<b@x>', bodyText: 'Need a key', category: 'parts_request', partType: 'key' }, // 有草稿，客服还没回
      { messageId: '<c@x>', bodyText: 'Hi', category: 'other', partType: 'other', status: 'replied' }, // 客服回了，没草稿
    ])
    .returning();
  paired = emails[0].id;
  await db.insert(schema.emailReply).values([
    { emailId: emails[0].id, version: 1, draftContent: 'Draft v1' },
    { emailId: emails[0].id, version: 2, draftContent: 'Draft v2' },
    { emailId: emails[1].id, version: 1, draftContent: 'Key draft' },
  ]);
  await db.insert(schema.outboundMessage).values([
    { messageId: '<r2@us>', inReplyTo: '<a@x>', sentAt: new Date('2026-10-21T00:00:00Z'), source: 'imap_sent', bodyText: 'Second reply' },
    { messageId: '<r1@us>', inReplyTo: '<a@x>', sentAt: new Date('2026-10-20T08:00:00Z'), source: 'imap_sent', bodyText: 'We will send a new battery.\n\nOn Mon, Oct 20 Pat wrote:\n> Battery dead' },
    { messageId: '<r3@us>', inReplyTo: '<c@x>', sentAt: new Date('2026-10-20T08:00:00Z'), source: 'imap_sent', bodyText: 'Thanks' },
  ]);
  service = new TrialService(db as unknown as Database);
});

describe('trial comparison (real SQL)', () => {
  it('pairs the latest AI draft with the first actual reply, only where both exist', async () => {
    const r = await service.pairs({ status: 'all', page: 1, pageSize: 20 });
    expect(r.total).toBe(1);
    expect(r.items[0]).toMatchObject({ emailId: paired, draft: 'Draft v2', draftVersion: 2, actual: 'We will send a new battery.', customer: 'Battery dead', rating: null });
  });

  it('records ratings and summarises them', async () => {
    expect((await service.summary()).rated).toBe(0);
    await service.rate(paired, null as unknown as string, { rating: 'minor', note: '落款要改' });
    expect((await service.pairs({ status: 'unrated', page: 1, pageSize: 20 })).total).toBe(0);
    expect((await service.pairs({ status: 'rated', page: 1, pageSize: 20 })).items[0]).toMatchObject({ rating: 'minor', note: '落款要改' });
    const s = await service.summary();
    expect(s).toMatchObject({ pairs: 1, rated: 1, byRating: { ready: 0, minor: 1, major: 0, unusable: 0 } });
    expect(s.byCategory).toEqual([{ category: 'quality_issue', rated: 1, usable: 1 }]);
    // 改分覆盖
    await service.rate(paired, null as unknown as string, { rating: 'major', note: null });
    expect((await service.summary()).byRating).toMatchObject({ minor: 0, major: 1 });
  });
});
