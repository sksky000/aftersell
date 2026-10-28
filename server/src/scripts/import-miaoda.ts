/**
 * 一次性导入妙搭导出的数据（数据文件含客户信息，不进仓库，只在服务器上运行）：
 *   node dist/scripts/import-miaoda.js --cards <learning_cluster_knowledge.sql> --styles <reply_style_memory.sql> --adjudications <customer_adjudication.sql>
 * 可重复执行：知识卡按 cluster_key 更新，风格条目与裁决已存在的跳过。
 */
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { ADJUDICATION_FACTS, type AdjudicationFact } from '@aftersell/shared';
import * as schema from '../db/schema';
import { customerAdjudication, knowledgeCard, styleRule } from '../db/schema';
import { parseInsert } from './sql-insert';

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] ?? null : null;
}

function jsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function jsonValue(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('缺少 DATABASE_URL');
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  try {
    const cardsFile = arg('cards');
    if (cardsFile) {
      const rows = parseInsert(readFileSync(cardsFile, 'utf8')).filter((r) => r.status === 'approved');
      for (const r of rows) {
        const values = {
          clusterKey: r.cluster_key!,
          category: r.intent ?? 'other',
          partType: r.part_type ?? 'other',
          imageFlag: r.image_flag ?? 'no_images',
          modelCode: r.model_code,
          sampleSize: Number(r.sample_size ?? 0) || 0,
          skeleton: jsonArray(r.skeleton),
          facts: jsonArray(r.facts),
          rules: jsonArray(r.rules),
          pricing: jsonValue(r.pricing),
          drift: r.drift,
        };
        await db
          .insert(knowledgeCard)
          .values(values)
          .onConflictDoUpdate({ target: knowledgeCard.clusterKey, set: { ...values, updatedAt: new Date() } });
      }
      console.log(`知识卡：导入 approved ${rows.length} 张`);
    }

    const stylesFile = arg('styles');
    if (stylesFile) {
      const content = parseInsert(readFileSync(stylesFile, 'utf8'))[0]?.content ?? '';
      const items = content
        .split(/\r?\n/)
        .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
        .filter((l) => l.length > 5);
      const existing = new Set((await db.select({ text: styleRule.text }).from(styleRule)).map((s) => s.text));
      let added = 0;
      for (const [i, text] of items.entries()) {
        if (existing.has(text)) continue;
        await db.insert(styleRule).values({ text, source: '妙搭 reply_style_memory', sortOrder: (i + 1) * 10 });
        added += 1;
      }
      console.log(`风格条目：共 ${items.length} 条，新增 ${added} 条`);
    }

    const adjFile = arg('adjudications');
    if (adjFile) {
      const rows = parseInsert(readFileSync(adjFile, 'utf8'));
      let added = 0;
      for (const r of rows) {
        if (!r.customer_email || !ADJUDICATION_FACTS.includes(r.fact_type as AdjudicationFact)) continue;
        const inserted = await db
          .insert(customerAdjudication)
          .values({ customerEmail: r.customer_email.trim().toLowerCase(), factType: r.fact_type as AdjudicationFact, note: r.note })
          .onConflictDoNothing()
          .returning({ id: customerAdjudication.id });
        added += inserted.length;
      }
      console.log(`客户裁决：共 ${rows.length} 条，新增 ${added} 条`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
