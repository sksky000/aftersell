import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import type { SyncStatusDto, SyncTrigger } from '@aftersell/shared';
import { env } from '../config/env';
import { MailConfigService, type SyncOptions } from '../mail-config/mail-config.service';
import { MailSyncService } from './mail-sync.service';

const QUEUE_NAME = 'mail-sync';
const SCHEDULER_ID = 'mail-sync-schedule';
/** 固定 jobId：排队中再点“手动同步”不会叠加 */
const MANUAL_JOB_ID = 'mail-sync-manual';

interface SyncJobData {
  trigger: SyncTrigger;
  userId?: string;
}

/**
 * 拉信任务队列。worker 并发为 1，定时与手动同步串行执行，不会两路同时消费收件箱。
 * 定时任务用 BullMQ job scheduler，间隔来自邮箱配置，保存配置后立即重排。
 */
@Injectable()
export class MailSyncQueue implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MailSyncQueue.name);
  private readonly connections: Redis[] = [];
  private queue!: Queue<SyncJobData>;
  private worker!: Worker<SyncJobData>;
  private appliedSchedule: string | null = null;

  constructor(
    private readonly mailConfig: MailConfigService,
    private readonly sync: MailSyncService,
  ) {}

  private connection(): Redis {
    // BullMQ 要求 maxRetriesPerRequest 为 null；队列与 worker 各用一条连接
    const conn = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
    this.connections.push(conn);
    return conn;
  }

  async onModuleInit(): Promise<void> {
    await this.sync.closeInterruptedRuns();
    this.queue = new Queue<SyncJobData>(QUEUE_NAME, {
      connection: this.connection(),
      defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
    });
    this.worker = new Worker<SyncJobData>(QUEUE_NAME, (job) => this.sync.run(job.data.trigger, job.data.userId), {
      connection: this.connection(),
      concurrency: 1,
    });
    this.worker.on('failed', (job, err) => this.logger.error(`同步任务异常 job=${job?.id}: ${err.message}`));
    this.worker.on('error', (err) => this.logger.error(`同步队列错误: ${err.message}`));

    this.mailConfig.onChange((options) => this.applySchedule(options));
    await this.applySchedule(await this.mailConfig.syncOptions());
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await Promise.all(this.connections.map((c) => c.quit().catch(() => c.disconnect())));
  }

  private async applySchedule(options: SyncOptions | null): Promise<void> {
    const key = options?.syncEnabled ? `every:${options.intervalMinutes}` : 'off';
    if (key === this.appliedSchedule) return;
    if (options?.syncEnabled) {
      await this.queue.upsertJobScheduler(
        SCHEDULER_ID,
        { every: options.intervalMinutes * 60_000 },
        { name: 'sync', data: { trigger: 'schedule' } },
      );
      this.logger.log(`定时拉取已开启：每 ${options.intervalMinutes} 分钟`);
    } else {
      await this.queue.removeJobScheduler(SCHEDULER_ID);
      if (this.appliedSchedule !== null) this.logger.log('定时拉取已关闭');
    }
    this.appliedSchedule = key;
  }

  async enqueueManual(userId: string): Promise<SyncStatusDto> {
    await this.queue.add('sync', { trigger: 'manual', userId }, { jobId: MANUAL_JOB_ID });
    return this.status();
  }

  async status(): Promise<SyncStatusDto> {
    const [active, manualJob, scheduler, options, lastRun] = await Promise.all([
      this.queue.getActiveCount(),
      this.queue.getJob(MANUAL_JOB_ID),
      this.queue.getJobScheduler(SCHEDULER_ID),
      this.mailConfig.syncOptions(),
      this.sync.lastRun(),
    ]);
    const manualState = manualJob ? await manualJob.getState() : null;
    return {
      configured: options !== null,
      filters: options?.filters ?? null,
      running: active > 0,
      queued: manualState === 'waiting' || manualState === 'prioritized',
      lastRun,
      schedule: {
        enabled: options?.syncEnabled ?? false,
        intervalMinutes: options?.intervalMinutes ?? 0,
        nextRunAt: options?.syncEnabled && scheduler?.next ? new Date(scheduler.next).toISOString() : null,
      },
    };
  }
}
