import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { simpleParser } from 'mailparser';
import { z } from 'zod/v4';
import {
  CATEGORIES,
  LEARNING_JOBS,
  PART_TYPES,
  type CandidateStatus,
  type CardCandidateDto,
  type HistoryCluster,
  type LearningJob,
  type LearningJobState,
  type LearningStatusDto,
  type ReviewRequest,
  type StartHistoryImportRequest,
  type StyleCandidateDto,
} from '@aftersell/shared';
import { z as z3 } from 'zod';
import { DB, type Database } from '../db/db.module';
import { historyReply, knowledgeCard, replyCorrection, styleRule } from '../db/schema';
import { loadPrompt } from '../llm/prompts';
import { LlmService } from '../llm/llm.service';
import { htmlToPlainText } from '../mail/forward-address';
import { describeMailError } from '../mail-config/mail-endpoint';
import { neutralize } from '../pipeline/classification';
import { SettingsService } from '../settings/settings.service';
import { HistoryAccount } from './history-account';
import { splitReply } from './history-parse';

const JOBS_KEY = 'learning.jobs';
/** 同 妙搭：样本少于 30 封的场景不生成知识卡；每张卡参考最近 15 封 */
export const MIN_CLUSTER_SIZE = 30;
const SAMPLE_LIMIT = 15;
const REPLY_LIMIT = 1200;
const CUSTOMER_LIMIT = 800;
const IMPORT_MAX = 20_000;
const HEADER_BATCH = 200;
const BODY_BATCH = 50;
const LABEL_BATCH = 30;
const LABEL_CONCURRENCY = 3;
const STYLE_BATCH = 40;
const STYLE_MIN = 5;
const ITEM_MAX = 300;
/** 知识卡条目里不留金额和联系方式：价格只用价格表，收款只用设置页 */
const BANNED_ITEM_RE = /\$\s?\d|[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s()-]{7,}\d|zelle/i;

const labelSchema = z.object({
  isAfterSales: z.boolean(),
  category: z.enum(CATEGORIES),
  partType: z.enum(PART_TYPES),
  customerSentMedia: z.boolean(),
});
const cardSchema = z.object({ skeleton: z.array(z.string()), facts: z.array(z.string()), rules: z.array(z.string()), drift: z.string() });
const styleSchema = z.object({
  candidates: z.array(z.object({ text: z.string(), category: z.string().nullable(), partType: z.string().nullable(), evidence: z.array(z.number()) })),
});

const IDLE: LearningJobState = { state: 'idle', message: null, done: 0, total: 0, startedAt: null, finishedAt: null };
const jobStateSchema = z3.object({
  state: z3.enum(['idle', 'running', 'done', 'failed']),
  message: z3.string().nullable(),
  done: z3.number(),
  total: z3.number(),
  startedAt: z3.string().nullable(),
  finishedAt: z3.string().nullable(),
});
const jobsSchema = z3.record(z3.string(), jobStateSchema);

const cleanItems = (items: string[], max: number) =>
  items
    .map((s) => s.replace(/\s+/g, ' ').trim().slice(0, ITEM_MAX))
    .filter((s) => s && !BANNED_ITEM_RE.test(s))
    .slice(0, max);

/** 并发受限地处理一组任务 */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

/**
 * 学习闭环：
 * 1. 只读导入生产邮箱“已发送”→ history_reply（我方回复 + 引用的客户来信）
 * 2. 模型逐封标注场景（类别 / 零件 / 客户是否附图）
 * 3. 样本够多的场景生成知识卡候选；改稿记录归纳风格条目候选
 * 4. 主管审核：通过即生效（同场景旧卡停用），驳回留档
 * 任务在进程内运行，状态存 setting；导入按 Message-ID 去重、标注从未标注处继续，中断后重新点即可。
 */
@Injectable()
export class LearningService implements OnModuleInit {
  private readonly logger = new Logger(LearningService.name);
  private jobs: Record<LearningJob, LearningJobState> = Object.fromEntries(LEARNING_JOBS.map((j) => [j, { ...IDLE }])) as Record<LearningJob, LearningJobState>;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly llm: LlmService,
    private readonly account: HistoryAccount,
  ) {}

  async onModuleInit(): Promise<void> {
    const saved = await this.settings.get(JOBS_KEY, jobsSchema, {});
    for (const job of LEARNING_JOBS) {
      const s = saved[job];
      if (!s) continue;
      this.jobs[job] = s.state === 'running' ? { ...s, state: 'failed', message: '服务重启中断，请重新开始（已完成的部分不会重复做）', finishedAt: new Date().toISOString() } : s;
    }
    await this.persist();
  }

  private persist(): Promise<void> {
    return this.settings.set(JOBS_KEY, this.jobs, null);
  }

  private update(job: LearningJob, patch: Partial<LearningJobState>, save = false): void {
    this.jobs[job] = { ...this.jobs[job], ...patch };
    if (save) void this.persist().catch(() => undefined);
  }

  /** 后台执行一个学习任务；同类任务同时只能有一个 */
  private start(job: LearningJob, fn: () => Promise<string>): void {
    if (this.jobs[job].state === 'running') throw new ConflictException('这个任务正在进行中');
    this.update(job, { state: 'running', message: null, done: 0, total: 0, startedAt: new Date().toISOString(), finishedAt: null }, true);
    void fn()
      .then((message) => this.update(job, { state: 'done', message, finishedAt: new Date().toISOString() }, true))
      .catch((error: unknown) => {
        const message = error instanceof BadRequestException ? error.message : describeMailError(error);
        this.logger.warn(`学习任务 ${job} 失败: ${message}`);
        this.update(job, { state: 'failed', message, finishedAt: new Date().toISOString() }, true);
      });
  }

  // ---------- 1. 导入 ----------

  startImport(req: StartHistoryImportRequest): void {
    this.start('import', async () => {
      const message = await this.importSent(req);
      // 导入完自动接着标注
      if (this.jobs.label.state !== 'running') this.startLabel();
      return message;
    });
  }

  private async importSent(req: StartHistoryImportRequest): Promise<string> {
    const since = new Date(`${req.dateFrom}T00:00:00+08:00`);
    const before = req.dateTo ? new Date(new Date(`${req.dateTo}T00:00:00+08:00`).getTime() + 86_400_000) : null;
    const { client, sentPath } = await this.account.connect();
    let inserted = 0;
    let skipped = 0;
    try {
      // 只读打开（EXAMINE）：不会改任何邮件的已读等标记
      const lock = await client.getMailboxLock(sentPath, { readOnly: true });
      try {
        const found = await client.search({ since, ...(before ? { before } : {}) }, { uid: true });
        const all = (Array.isArray(found) ? found : []).sort((a, b) => a - b);
        const uids = all.slice(-IMPORT_MAX);
        this.update('import', { total: uids.length }, true);
        for (let i = 0; i < uids.length; i += HEADER_BATCH) {
          const batch = uids.slice(i, i + HEADER_BATCH);
          const heads: { uid: number; messageId: string | null }[] = [];
          for await (const msg of client.fetch(batch, { uid: true, envelope: true }, { uid: true })) heads.push({ uid: msg.uid, messageId: msg.envelope?.messageId ?? null });
          const ids = heads.flatMap((h) => (h.messageId ? [h.messageId] : []));
          const known = ids.length ? await this.db.select({ id: historyReply.messageId }).from(historyReply).where(inArray(historyReply.messageId, ids)) : [];
          const knownIds = new Set(known.map((k) => k.id));
          const todo = heads.filter((h) => h.messageId && !knownIds.has(h.messageId)).map((h) => h.uid);
          skipped += heads.length - todo.length;
          for (let j = 0; j < todo.length; j += BODY_BATCH) {
            for await (const msg of client.fetch(todo.slice(j, j + BODY_BATCH), { uid: true, source: true }, { uid: true })) {
              if (!msg.source) continue;
              const parsed = await simpleParser(msg.source, { skipImageLinks: true, skipTextToHtml: true });
              const html = typeof parsed.html === 'string' ? parsed.html : '';
              const body = (parsed.text ?? '').trim() || (html ? htmlToPlainText(html) : '');
              const { reply, customer } = splitReply(body.replace(/\u0000/g, ''));
              if (!reply || !parsed.messageId) {
                skipped += 1;
                continue;
              }
              const to = (Array.isArray(parsed.to) ? parsed.to : parsed.to ? [parsed.to] : []).flatMap((a) => a.value.map((v) => v.address)).find(Boolean);
              const rows = await this.db
                .insert(historyReply)
                .values({
                  messageId: parsed.messageId.slice(0, 998),
                  sentAt: parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date : null,
                  subject: parsed.subject?.replace(/\u0000/g, '').slice(0, 1000) ?? null,
                  toAddress: to?.slice(0, 320) ?? null,
                  replyText: reply,
                  customerText: customer,
                })
                .onConflictDoNothing()
                .returning({ id: historyReply.id });
              inserted += rows.length;
            }
          }
          this.update('import', { done: Math.min(i + HEADER_BATCH, uids.length) }, true);
        }
        const capped = all.length > uids.length ? `；范围内共 ${all.length} 封，只取最近的 ${IMPORT_MAX} 封` : '';
        return `新导入 ${inserted} 封，跳过 ${skipped} 封（已导入过或没有正文）${capped}`;
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  // ---------- 2. 标注 ----------

  startLabel(): void {
    this.start('label', () => this.labelAll());
  }

  private async labelAll(): Promise<string> {
    if (!(await this.llm.isAvailable('classify'))) throw new BadRequestException('分类模型还没有配置 API key（设置 → 模型）');
    // 手动重跑时把上次失败的也重新标注
    await this.db.update(historyReply).set({ labelError: null }).where(and(isNull(historyReply.labeledAt), isNotNull(historyReply.labelError)));
    const [{ n }] = await this.db.select({ n: count() }).from(historyReply).where(isNull(historyReply.labeledAt));
    this.update('label', { total: n }, true);
    let done = 0;
    let failed = 0;
    for (;;) {
      const rows = await this.db
        .select({ id: historyReply.id, customerText: historyReply.customerText, replyText: historyReply.replyText })
        .from(historyReply)
        .where(and(isNull(historyReply.labeledAt), isNull(historyReply.labelError)))
        .orderBy(desc(historyReply.sentAt))
        .limit(LABEL_BATCH);
      if (!rows.length) break;
      await mapLimit(rows, LABEL_CONCURRENCY, async (row) => {
        try {
          const user = `<customer>\n${neutralize(row.customerText.slice(0, 2000))}\n</customer>\n<reply>\n${neutralize(row.replyText.slice(0, 2000))}\n</reply>`;
          const { data } = await this.llm.extract('classify', { system: loadPrompt('history_label'), user, schema: labelSchema, maxTokens: 300 });
          await this.db
            .update(historyReply)
            .set({ ...data, labeledAt: new Date(), labelError: null })
            .where(eq(historyReply.id, row.id));
        } catch (error) {
          failed += 1;
          await this.db.update(historyReply).set({ labelError: describeMailError(error).slice(0, 500) }).where(eq(historyReply.id, row.id));
        }
        done += 1;
        if (done % 10 === 0) this.update('label', { done }, done % 50 === 0);
      });
    }
    this.update('label', { done });
    return `标注 ${done - failed} 封${failed ? `，失败 ${failed} 封（可再点一次重试）` : ''}`;
  }

  // ---------- 3a. 知识卡候选 ----------

  private async clusters(): Promise<HistoryCluster[]> {
    const rows = await this.db
      .select({ category: historyReply.category, partType: historyReply.partType, media: historyReply.customerSentMedia, count: count() })
      .from(historyReply)
      .where(eq(historyReply.isAfterSales, true))
      .groupBy(historyReply.category, historyReply.partType, historyReply.customerSentMedia)
      .orderBy(desc(count()));
    const pending = await this.db
      .select({ category: knowledgeCard.category, partType: knowledgeCard.partType, imageFlag: knowledgeCard.imageFlag })
      .from(knowledgeCard)
      .where(eq(knowledgeCard.status, 'draft'));
    const pendingKeys = new Set(pending.map((p) => `${p.category}|${p.partType}|${p.imageFlag}`));
    return rows.map((r) => {
      const imageFlag = r.media ? 'with_images' : 'no_images';
      return {
        category: r.category ?? 'other',
        partType: r.partType ?? 'other',
        imageFlag,
        count: r.count,
        pendingDraft: pendingKeys.has(`${r.category}|${r.partType}|${imageFlag}`),
      };
    });
  }

  startCards(): void {
    this.start('cards', () => this.mineCards());
  }

  private async mineCards(): Promise<string> {
    if (!(await this.llm.isAvailable('classify'))) throw new BadRequestException('分类模型还没有配置 API key（设置 → 模型）');
    const targets = (await this.clusters()).filter((c) => c.count >= MIN_CLUSTER_SIZE && !c.pendingDraft && c.category !== 'other');
    if (!targets.length) return `没有新的场景可生成：需要同一场景至少 ${MIN_CLUSTER_SIZE} 封已标注的售后回复，且没有待审核的候选`;
    this.update('cards', { total: targets.length }, true);
    let created = 0;
    let failed = 0;
    for (const c of targets) {
      try {
        const samples = await this.db
          .select({ id: historyReply.id, sentAt: historyReply.sentAt, customerText: historyReply.customerText, replyText: historyReply.replyText })
          .from(historyReply)
          .where(
            and(
              eq(historyReply.isAfterSales, true),
              eq(historyReply.category, c.category as (typeof CATEGORIES)[number]),
              eq(historyReply.partType, c.partType as (typeof PART_TYPES)[number]),
              eq(historyReply.customerSentMedia, c.imageFlag === 'with_images'),
            ),
          )
          .orderBy(desc(sql`${historyReply.customerText} <> ''`), desc(historyReply.sentAt))
          .limit(SAMPLE_LIMIT);
        const user = [
          `<cluster>category=${c.category}, partType=${c.partType}, customer sent images=${c.imageFlag === 'with_images'}, total samples=${c.count}, showing ${samples.length} most recent</cluster>`,
          ...samples.map(
            (s, i) =>
              `<sample n="${i + 1}" date="${s.sentAt?.toISOString().slice(0, 10) ?? 'unknown'}">\n<customer>\n${neutralize(s.customerText.slice(0, CUSTOMER_LIMIT))}\n</customer>\n<reply>\n${neutralize(s.replyText.slice(0, REPLY_LIMIT))}\n</reply>\n</sample>`,
          ),
        ].join('\n\n');
        const { data } = await this.llm.extract('classify', { system: loadPrompt('card_mining'), user, schema: cardSchema, maxTokens: 3000 });
        await this.db.insert(knowledgeCard).values({
          clusterKey: `history|${c.category}|${c.partType}|${c.imageFlag}|${Date.now()}`,
          category: c.category,
          partType: c.partType,
          imageFlag: c.imageFlag,
          sampleSize: c.count,
          skeleton: cleanItems(data.skeleton, 6),
          facts: cleanItems(data.facts, 8),
          rules: cleanItems(data.rules, 10),
          drift: data.drift.trim().slice(0, 500) || null,
          enabled: false,
          status: 'draft',
          source: 'history',
          sampleIds: samples.map((s) => s.id),
        });
        created += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(`知识卡候选生成失败 ${c.category}/${c.partType}/${c.imageFlag}: ${describeMailError(error)}`);
      }
      this.update('cards', { done: created + failed }, true);
    }
    return `生成 ${created} 张候选卡${failed ? `，失败 ${failed} 个场景（可再点一次重试）` : ''}，请在下方审核`;
  }

  // ---------- 3b. 风格条目候选 ----------

  startStyles(): void {
    this.start('styles', () => this.mineStyles());
  }

  private async mineStyles(): Promise<string> {
    if (!(await this.llm.isAvailable('classify'))) throw new BadRequestException('分类模型还没有配置 API key（设置 → 模型）');
    const [{ n }] = await this.db.select({ n: count() }).from(replyCorrection).where(isNull(replyCorrection.minedAt));
    if (n < STYLE_MIN) return `新的改稿记录只有 ${n} 条，至少 ${STYLE_MIN} 条才归纳（客服改过 AI 草稿再发送才会产生）`;
    this.update('styles', { total: n }, true);
    const existing = await this.db.select({ text: styleRule.text }).from(styleRule).where(eq(styleRule.status, 'approved'));
    let created = 0;
    let done = 0;
    for (;;) {
      const rows = await this.db
        .select()
        .from(replyCorrection)
        .where(isNull(replyCorrection.minedAt))
        .orderBy(asc(replyCorrection.createdAt))
        .limit(STYLE_BATCH);
      if (rows.length < STYLE_MIN) break;
      const user = [
        `<existing>\n${existing.map((e) => `- ${e.text}`).join('\n') || '（无）'}\n</existing>`,
        ...rows.map(
          (r, i) =>
            `<correction n="${i + 1}" category="${r.category}" partType="${r.partType}">\n<draft>\n${neutralize(r.originalDraft.slice(0, 1500))}\n</draft>\n<final>\n${neutralize(r.finalContent.slice(0, 1500))}\n</final>\n</correction>`,
        ),
      ].join('\n\n');
      const { data } = await this.llm.extract('classify', { system: loadPrompt('style_mining'), user, schema: styleSchema, maxTokens: 2000 });
      const date = new Date().toISOString().slice(0, 10);
      const candidates = data.candidates
        .map((c) => ({
          text: c.text.replace(/\s+/g, ' ').trim().slice(0, 1000),
          category: (CATEGORIES as readonly string[]).includes(c.category ?? '') ? (c.category as (typeof CATEGORIES)[number]) : null,
          partType: (PART_TYPES as readonly string[]).includes(c.partType ?? '') ? (c.partType as (typeof PART_TYPES)[number]) : null,
          correctionIds: [...new Set(c.evidence)].filter((k) => k >= 1 && k <= rows.length).map((k) => rows[k - 1].id),
        }))
        .filter((c) => c.text.length >= 5 && c.correctionIds.length >= 1);
      if (candidates.length) {
        await this.db.insert(styleRule).values(
          candidates.map((c) => ({ ...c, enabled: false, status: 'draft', source: `改稿学习 ${date}`, sortOrder: 1000 })),
        );
      }
      await this.db.update(replyCorrection).set({ minedAt: new Date() }).where(inArray(replyCorrection.id, rows.map((r) => r.id)));
      created += candidates.length;
      done += rows.length;
      this.update('styles', { done }, true);
    }
    return `归纳了 ${done} 条改稿，提出 ${created} 条风格候选${created ? '，请在下方审核' : ''}`;
  }

  // ---------- 状态 ----------

  async status(): Promise<LearningStatusDto> {
    const [account, [h], clusters, [{ unmined }], [{ cards }], [{ styles }]] = await Promise.all([
      this.account.get(),
      this.db
        .select({
          total: count(),
          labeled: sql<number>`count(${historyReply.labeledAt})::int`,
          afterSales: sql<number>`count(*) filter (where ${historyReply.isAfterSales})::int`,
          failed: sql<number>`count(*) filter (where ${historyReply.labelError} is not null and ${historyReply.labeledAt} is null)::int`,
        })
        .from(historyReply),
      this.clusters(),
      this.db.select({ unmined: count() }).from(replyCorrection).where(isNull(replyCorrection.minedAt)),
      this.db.select({ cards: count() }).from(knowledgeCard).where(eq(knowledgeCard.status, 'draft')),
      this.db.select({ styles: count() }).from(styleRule).where(eq(styleRule.status, 'draft')),
    ]);
    return {
      account,
      jobs: this.jobs,
      history: { total: h.total, labeled: h.labeled, afterSales: h.afterSales, failed: h.failed },
      clusters: clusters.slice(0, 100),
      minClusterSize: MIN_CLUSTER_SIZE,
      unminedCorrections: unmined,
      pending: { cards, styles },
    };
  }

  // ---------- 4. 审核 ----------

  async cardCandidates(status: CandidateStatus): Promise<CardCandidateDto[]> {
    const rows = await this.db
      .select()
      .from(knowledgeCard)
      .where(and(eq(knowledgeCard.status, status), eq(knowledgeCard.source, 'history')))
      .orderBy(desc(knowledgeCard.sampleSize))
      .limit(100);
    return Promise.all(
      rows.map(async (r) => {
        const [current] = await this.db
          .select()
          .from(knowledgeCard)
          .where(
            and(
              eq(knowledgeCard.status, 'approved'),
              eq(knowledgeCard.enabled, true),
              eq(knowledgeCard.category, r.category),
              eq(knowledgeCard.partType, r.partType),
              eq(knowledgeCard.imageFlag, r.imageFlag),
              ne(knowledgeCard.id, r.id),
            ),
          )
          .orderBy(desc(knowledgeCard.sampleSize))
          .limit(1);
        const samples = r.sampleIds.length
          ? await this.db
              .select({ sentAt: historyReply.sentAt, customer: historyReply.customerText, reply: historyReply.replyText })
              .from(historyReply)
              .where(inArray(historyReply.id, r.sampleIds.slice(0, 5)))
          : [];
        return {
          id: r.id,
          category: r.category,
          partType: r.partType,
          imageFlag: r.imageFlag,
          sampleSize: r.sampleSize,
          skeleton: r.skeleton,
          facts: r.facts,
          rules: r.rules,
          drift: r.drift,
          status: r.status as CandidateStatus,
          source: r.source,
          createdAt: r.createdAt.toISOString(),
          reviewedAt: r.reviewedAt?.toISOString() ?? null,
          current: current
            ? { id: current.id, sampleSize: current.sampleSize, skeleton: current.skeleton, facts: current.facts, rules: current.rules, drift: current.drift, source: current.source }
            : null,
          samples: samples.map((s) => ({ sentAt: s.sentAt?.toISOString() ?? null, customer: s.customer.slice(0, 400), reply: s.reply.slice(0, 600) })),
        };
      }),
    );
  }

  /** 通过：启用这张卡，同场景（类别 + 零件 + 是否附图）原来生效的卡停用；驳回：留档不生效 */
  async reviewCard(id: string, actorId: string, { action }: ReviewRequest): Promise<void> {
    const [row] = await this.db.select().from(knowledgeCard).where(eq(knowledgeCard.id, id)).limit(1);
    if (!row) throw new NotFoundException('候选不存在');
    if (row.status !== 'draft') throw new ConflictException('这张候选已经审核过了');
    const reviewed = { reviewedBy: actorId, reviewedAt: new Date(), updatedAt: new Date() };
    if (action === 'reject') {
      await this.db.update(knowledgeCard).set({ status: 'rejected', enabled: false, ...reviewed }).where(eq(knowledgeCard.id, id));
      return;
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(knowledgeCard)
        .set({ enabled: false, updatedAt: new Date() })
        .where(
          and(
            eq(knowledgeCard.status, 'approved'),
            eq(knowledgeCard.category, row.category),
            eq(knowledgeCard.partType, row.partType),
            eq(knowledgeCard.imageFlag, row.imageFlag),
          ),
        );
      await tx.update(knowledgeCard).set({ status: 'approved', enabled: true, ...reviewed }).where(eq(knowledgeCard.id, id));
    });
    this.logger.log(`知识卡候选已通过 id=${id} by=${actorId}`);
  }

  async styleCandidates(status: CandidateStatus): Promise<StyleCandidateDto[]> {
    const rows = await this.db
      .select()
      .from(styleRule)
      .where(and(eq(styleRule.status, status), sql`jsonb_array_length(${styleRule.correctionIds}) > 0`))
      .orderBy(desc(styleRule.createdAt))
      .limit(100);
    const ids = [...new Set(rows.flatMap((r) => r.correctionIds.slice(0, 3)))];
    const corrections = ids.length
      ? await this.db
          .select({ id: replyCorrection.id, draft: replyCorrection.originalDraft, final: replyCorrection.finalContent })
          .from(replyCorrection)
          .where(inArray(replyCorrection.id, ids))
      : [];
    const byId = new Map(corrections.map((c) => [c.id, c]));
    return rows.map((r) => ({
      id: r.id,
      text: r.text,
      category: r.category,
      partType: r.partType,
      status: r.status as CandidateStatus,
      createdAt: r.createdAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      evidence: r.correctionIds
        .slice(0, 3)
        .flatMap((cid) => {
          const c = byId.get(cid);
          return c ? [{ draft: c.draft.slice(0, 800), final: c.final.slice(0, 800) }] : [];
        }),
    }));
  }

  async reviewStyle(id: string, actorId: string, { action }: ReviewRequest): Promise<void> {
    const [row] = await this.db.select({ status: styleRule.status }).from(styleRule).where(eq(styleRule.id, id)).limit(1);
    if (!row) throw new NotFoundException('候选不存在');
    if (row.status !== 'draft') throw new ConflictException('这条候选已经审核过了');
    await this.db
      .update(styleRule)
      .set({ status: action === 'approve' ? 'approved' : 'rejected', enabled: action === 'approve', reviewedBy: actorId, reviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(styleRule.id, id));
  }
}
