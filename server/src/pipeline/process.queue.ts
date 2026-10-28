import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { and, eq, ne, sql } from 'drizzle-orm';
import Redis from 'ioredis';
import { env } from '../config/env';
import { DB, type Database } from '../db/db.module';
import { attachmentRecognition, emailAttachment, emailMessage } from '../db/schema';
import { LlmNotConfiguredError, LlmOutputError, LlmService } from '../llm/llm.service';
import { LlmResponseError } from '../llm/provider';
import { ClassifyService } from './classify.service';
import { RecognitionService } from './recognition.service';

const QUEUE_NAME = 'mail-process';
const ATTEMPTS = 3;
const BACKFILL_LIMIT = 500;
const NOT_CONFIGURED = '分类模型未配置 API key（设置 → 模型），配置后自动补跑';

interface ProcessJobData {
  emailId: string;
  /** 重新分类：已分类过的也重跑 */
  force: boolean;
}

/**
 * 入库后的处理队列：识别附件 → 分类。jobId 即邮件 id，同一封不会重复排队。
 * 网络类错误按指数退避重试 3 次，最后一次仍失败则归 other 待人工；输出不合格不重试，直接兜底。
 */
@Injectable()
export class ProcessQueue implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ProcessQueue.name);
  private readonly connections: Redis[] = [];
  private queue!: Queue<ProcessJobData>;
  private worker!: Worker<ProcessJobData>;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly llm: LlmService,
    private readonly recognition: RecognitionService,
    private readonly classify: ClassifyService,
  ) {}

  private connection(): Redis {
    const conn = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
    this.connections.push(conn);
    return conn;
  }

  async onModuleInit(): Promise<void> {
    this.queue = new Queue<ProcessJobData>(QUEUE_NAME, {
      connection: this.connection(),
      defaultJobOptions: {
        attempts: ATTEMPTS,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
    this.worker = new Worker<ProcessJobData>(QUEUE_NAME, (job) => this.process(job), {
      connection: this.connection(),
      concurrency: 2,
    });
    this.worker.on('error', (err) => this.logger.error(`处理队列错误: ${err.message}`));
    this.llm.onSettingsChanged(() => this.backfill());
    await this.backfill();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await Promise.all(this.connections.map((c) => c.quit().catch(() => c.disconnect())));
  }

  async enqueue(emailId: string, force = false): Promise<void> {
    const previous = await this.queue.getJob(emailId);
    if (previous) {
      const state = await previous.getState();
      if (state !== 'completed' && state !== 'failed') return;
      await previous.remove();
    }
    await this.queue.add('process', { emailId, force }, { jobId: emailId });
  }

  /** 补跑仍是“待分类”的邮件：启动时、模型配置保存后 */
  async backfill(): Promise<void> {
    const rows = await this.db
      .select({ id: emailMessage.id })
      .from(emailMessage)
      .where(eq(emailMessage.pipelineState, 'ingested'))
      .orderBy(sql`${emailMessage.receivedAt} desc nulls last`)
      .limit(BACKFILL_LIMIT);
    for (const row of rows) await this.enqueue(row.id);
    if (rows.length) this.logger.log(`待分类邮件已排队 ${rows.length} 封`);

    // 分类时识图还没配好的邮件：识图可用后重新识别并重新分类（图片内容会影响凭证判断）
    if (!(await this.llm.isAvailable('vision'))) return;
    const waiting = await this.db
      .selectDistinct({ id: emailAttachment.emailId })
      .from(emailAttachment)
      .innerJoin(attachmentRecognition, eq(attachmentRecognition.sha256, emailAttachment.sha256))
      .innerJoin(emailMessage, eq(emailMessage.id, emailAttachment.emailId))
      .where(and(eq(attachmentRecognition.reason, 'vision_not_configured'), ne(emailMessage.pipelineState, 'ingested')))
      .limit(BACKFILL_LIMIT);
    for (const row of waiting) await this.enqueue(row.id, true);
    if (waiting.length) this.logger.log(`识图可用，补识图并重新分类 ${waiting.length} 封`);
  }

  private async process(job: Job<ProcessJobData>): Promise<void> {
    const { emailId, force } = job.data;
    const [row] = await this.db
      .select({ state: emailMessage.pipelineState })
      .from(emailMessage)
      .where(eq(emailMessage.id, emailId))
      .limit(1);
    if (!row || (!force && row.state !== 'ingested')) return;

    await this.recognition.recognizeEmail(emailId, force);
    if (!(await this.llm.isAvailable('classify'))) {
      await this.classify.noteError(emailId, NOT_CONFIGURED);
      return;
    }
    try {
      await this.classify.classify(emailId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof LlmNotConfiguredError) {
        await this.classify.noteError(emailId, NOT_CONFIGURED);
        return;
      }
      if (error instanceof LlmOutputError || error instanceof LlmResponseError) {
        await this.classify.markFailed(emailId, `${message}；请人工分类或点“重新分类”`);
        return;
      }
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        this.logger.warn(`分类最终失败 email=${emailId}: ${message}`);
        await this.classify.markFailed(emailId, `分类调用失败：${message}`);
        return;
      }
      await this.classify.noteError(emailId, `分类调用失败，稍后自动重试：${message}`);
      throw error;
    }
  }
}
