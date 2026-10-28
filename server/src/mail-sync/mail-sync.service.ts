import { Inject, Injectable, Logger } from '@nestjs/common';
import { desc, eq, inArray } from 'drizzle-orm';
import { ImapFlow, type SearchObject } from 'imapflow';
import type { SyncRunDto, SyncRunStatus, SyncTrigger } from '@aftersell/shared';
import { DB, type Database } from '../db/db.module';
import { emailMessage, syncRun, type SyncRunRow } from '../db/schema';
import { MailConfigService, type MailCredentials, type SyncOptions } from '../mail-config/mail-config.service';
import { describeMailError } from '../mail-config/mail-endpoint';
import { parseIncoming } from '../mail/parse-incoming';
import { selectPendingUids } from '../mail/pending-uids';
import { describeFilters, hasActiveFilter, passesHeaderFilter, passesMessageFilter } from '../mail/sync-filters';
import { ProcessQueue } from '../pipeline/process.queue';
import { SettingsService } from '../settings/settings.service';
import { IngestService } from './ingest.service';
import { syncSentFolder } from './sent-sync';

const TIMEOUT_MS = 30_000;
const HEADER_BATCH = 200;

interface Counts {
  fetched: number;
  inserted: number;
  duplicates: number;
  filtered: number;
  failed: number;
}

export function toRunDto(row: SyncRunRow): SyncRunDto {
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    fetched: row.fetched,
    inserted: row.inserted,
    duplicates: row.duplicates,
    filtered: row.filtered,
    failed: row.failed,
    message: row.message,
  };
}

/** IMAP 的 SINCE / BEFORE 只看日期；结束日当天也要包含 */
export function dateWindow(from: string | null, to: string | null): Pick<SearchObject, 'since' | 'before'> {
  const window: Pick<SearchObject, 'since' | 'before'> = {};
  if (from) window.since = new Date(`${from}T00:00:00Z`);
  if (to) {
    const before = new Date(`${to}T00:00:00Z`);
    before.setUTCDate(before.getUTCDate() + 1);
    window.before = before;
  }
  return window;
}

function summarize(c: Counts, options: SyncOptions): string {
  const mode = describeFilters(options.filters);
  const modeLabel = mode ? `（${mode}模式）` : '';
  if (c.fetched === 0 && c.duplicates === 0) {
    return mode ? `没有新的${mode.replace(/\+/g, '或')}，其余邮件保持未读已跳过` : '没有新的未读邮件';
  }
  const parts = [`新增 ${c.inserted} 封`];
  if (c.duplicates) parts.push(`已入库过 ${c.duplicates} 封（未重复写入）`);
  if (c.filtered) parts.push(`不符合拉取开关 ${c.filtered} 封（保持未读）`);
  if (c.failed) parts.push(`解析或入库失败 ${c.failed} 封，下次重试`);
  return `${parts.join('，')}${modeLabel}`;
}

@Injectable()
export class MailSyncService {
  private readonly logger = new Logger(MailSyncService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly mailConfig: MailConfigService,
    private readonly ingest: IngestService,
    private readonly processQueue: ProcessQueue,
    private readonly settings: SettingsService,
  ) {}

  async lastRun(): Promise<SyncRunDto | null> {
    const [row] = await this.db.select().from(syncRun).orderBy(desc(syncRun.startedAt)).limit(1);
    return row ? toRunDto(row) : null;
  }

  /** 进程重启时仍标记为 running 的记录已不会完成 */
  async closeInterruptedRuns(): Promise<void> {
    await this.db
      .update(syncRun)
      .set({ status: 'failed', finishedAt: new Date(), message: '服务重启，本次同步被中断' })
      .where(eq(syncRun.status, 'running'));
  }

  /** 由队列 worker 串行调用 */
  async run(trigger: SyncTrigger, userId?: string): Promise<SyncRunDto> {
    const [run] = await this.db.insert(syncRun).values({ trigger, triggeredBy: userId ?? null }).returning();
    const finish = async (status: SyncRunStatus, message: string, counts?: Counts): Promise<SyncRunDto> => {
      const [row] = await this.db
        .update(syncRun)
        .set({ status, message, finishedAt: new Date(), ...counts })
        .where(eq(syncRun.id, run.id))
        .returning();
      return toRunDto(row);
    };

    try {
      const options = await this.mailConfig.syncOptions();
      if (!options) return await finish('skipped', '尚未配置邮箱账号，请先在设置页配置');
      if (trigger === 'schedule' && !options.syncEnabled) return await finish('skipped', '定时拉取已关闭');
      const creds = await this.mailConfig.credentials();
      if (!creds) return await finish('skipped', '尚未配置邮箱账号，请先在设置页配置');

      const { counts, sent } = await this.pull(creds, options);
      await this.mailConfig.markSynced(new Date());
      this.logger.log(`邮件同步完成 trigger=${trigger} ${JSON.stringify({ ...counts, sent })}`);
      const message = summarize(counts, options) + (sent ? `；同步我方已发回复 ${sent} 封` : '');
      return await finish('succeeded', message, counts);
    } catch (error) {
      const message = describeMailError(error);
      this.logger.error(`邮件同步失败 trigger=${trigger}: ${message}`);
      return finish('failed', `同步失败：${message}`);
    }
  }

  private async pull(creds: MailCredentials, options: SyncOptions): Promise<{ counts: Counts; sent: number }> {
    const client = new ImapFlow({
      host: creds.imapHost,
      port: creds.imapPort,
      secure: true,
      auth: { user: creds.emailAddress, pass: creds.authCode },
      logger: false,
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS * 4,
    });
    // imapflow 在连接异常时会额外触发 error 事件，不监听会导致进程崩溃
    client.on('error', (err: unknown) => this.logger.warn(`IMAP 连接错误: ${describeMailError(err)}`));
    await client.connect();
    try {
      const counts = await this.pullInbox(client, options);
      let sent = 0;
      try {
        sent = await syncSentFolder(client, this.db, this.settings, null);
      } catch (error) {
        // 已发送同步失败不影响收信结果
        this.logger.warn(`同步已发送邮件失败: ${describeMailError(error)}`);
      }
      return { counts, sent };
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  private async pullInbox(client: ImapFlow, options: SyncOptions): Promise<Counts> {
    const counts: Counts = { fetched: 0, inserted: 0, duplicates: 0, filtered: 0, failed: 0 };
    const filtering = hasActiveFilter(options.filters);
    const limit = Math.max(1, options.maxPerRun);
    {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const found = await client.search(
          { seen: false, ...dateWindow(options.syncDateFrom, options.syncDateTo) },
          { uid: true },
        );
        const uids = (Array.isArray(found) ? found : []).sort((a, b) => a - b);
        if (!uids.length) return counts;

        // 1. 只取邮件头：按开关筛选、排除已入库的，凑满单次上限再取正文
        const pending: number[] = [];
        const importedUnread: number[] = [];
        for (let offset = 0; offset < uids.length && pending.length < limit; offset += HEADER_BATCH) {
          const batch: { uid: number; messageId: string | null }[] = [];
          for await (const msg of client.fetch(uids.slice(offset, offset + HEADER_BATCH), { uid: true, envelope: true }, { uid: true })) {
            const from = msg.envelope?.from?.[0]?.address ?? null;
            const subject = msg.envelope?.subject ?? null;
            if (filtering && !passesHeaderFilter(options.filters, from, subject)) {
              counts.filtered += 1;
              continue;
            }
            batch.push({ uid: msg.uid, messageId: msg.envelope?.messageId ?? null });
          }
          const ids = batch.flatMap((row) => (row.messageId ? [row.messageId] : []));
          const imported = ids.length
            ? await this.db
                .select({ messageId: emailMessage.messageId })
                .from(emailMessage)
                .where(inArray(emailMessage.messageId, ids))
            : [];
          const importedIds = new Set(imported.map((row) => row.messageId));
          for (const row of batch) {
            if (row.messageId && importedIds.has(row.messageId)) importedUnread.push(row.uid);
          }
          pending.push(...selectPendingUids(batch, importedIds, limit - pending.length));
        }
        counts.duplicates = importedUnread.length;

        // 2. 取正文逐封入库；单封失败不影响其他邮件，保持未读下次重试
        const done: number[] = [];
        if (pending.length) {
          for await (const msg of client.fetch(pending, { uid: true, source: true, internalDate: true }, { uid: true })) {
            counts.fetched += 1;
            try {
              if (!msg.source) throw new Error('邮件内容为空');
              const internalDate = msg.internalDate ? new Date(msg.internalDate) : null;
              const email = await parseIncoming(msg.source, internalDate);
              if (filtering && !passesMessageFilter(options.filters, email.fromAddress, email.subject, email.bodyText)) {
                counts.filtered += 1;
                continue;
              }
              const result = await this.ingest.ingest(email);
              if (result.status === 'inserted') {
                counts.inserted += 1;
                // 排队失败不影响入库结果，服务重启时会补跑待分类邮件
                await this.processQueue
                  .enqueue(result.id)
                  .catch((e: unknown) => this.logger.warn(`分类排队失败 email=${result.id}: ${describeMailError(e)}`));
              } else {
                counts.duplicates += 1;
              }
              done.push(msg.uid);
            } catch (error) {
              counts.failed += 1;
              this.logger.warn(`单封邮件入库失败 uid=${msg.uid}: ${describeMailError(error)}`);
            }
          }
        }

        // 3. 按配置把已入库的邮件标为已读；失败不影响入库结果（已去重）
        const toMark = [...done, ...importedUnread];
        if (!options.keepUnread && toMark.length) {
          try {
            await client.messageFlagsAdd(toMark, ['\\Seen'], { uid: true });
          } catch (error) {
            this.logger.warn(`标记已读失败，邮件保持未读: ${describeMailError(error)}`);
          }
        }
        return counts;
      } finally {
        lock.release();
      }
    }
  }
}
