import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ImapFlow } from 'imapflow';
import * as nodemailer from 'nodemailer';
import type {
  MailAccountDto,
  MailConfigMeta,
  SaveMailAccountRequest,
  TestConnectionResult,
  UpdateSyncFiltersRequest,
} from '@aftersell/shared';
import { env, mailHostAllowlist } from '../config/env';
import { SecretBox } from '../common/secret-box';
import { DB, type Database } from '../db/db.module';
import { emailAccount, type EmailAccountRow } from '../db/schema';
import type { SyncFilters } from '../mail/sync-filters';
import { checkMailEndpoints, describeMailError } from './mail-endpoint';

const CONNECT_TIMEOUT_MS = 15_000;

export interface MailCredentials {
  emailAddress: string;
  authCode: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

export interface SyncOptions {
  syncEnabled: boolean;
  keepUnread: boolean;
  filters: SyncFilters;
  maxPerRun: number;
  intervalMinutes: number;
  syncDateFrom: string | null;
  syncDateTo: string | null;
}

type ChangeListener = (options: SyncOptions | null) => void | Promise<void>;

function syncOptionsOf(row: EmailAccountRow): SyncOptions {
  return {
    syncEnabled: row.syncEnabled,
    keepUnread: row.keepUnread,
    filters: {
      hotlineOnly: row.hotlineOnly,
      registrationOnly: row.registrationOnly,
      firstContactOnly: row.firstContactOnly,
    },
    maxPerRun: row.maxPerRun,
    intervalMinutes: row.syncIntervalMinutes,
    syncDateFrom: row.syncDateFrom,
    syncDateTo: row.syncDateTo,
  };
}

function toDto(row: EmailAccountRow): MailAccountDto {
  return {
    id: row.id,
    emailAddress: row.emailAddress,
    imapHost: row.imapHost,
    imapPort: row.imapPort,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    syncEnabled: row.syncEnabled,
    keepUnread: row.keepUnread,
    hotlineOnly: row.hotlineOnly,
    registrationOnly: row.registrationOnly,
    firstContactOnly: row.firstContactOnly,
    maxPerRun: row.maxPerRun,
    syncIntervalMinutes: row.syncIntervalMinutes,
    syncDateFrom: row.syncDateFrom,
    syncDateTo: row.syncDateTo,
    lastSyncAt: row.lastSyncAt ? row.lastSyncAt.toISOString() : null,
    hasAuthCode: row.authCodeCipher.length > 0,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class MailConfigService {
  private readonly logger = new Logger(MailConfigService.name);
  private readonly box = new SecretBox(env().MAIL_SECRET_KEY);
  private readonly listeners: ChangeListener[] = [];

  constructor(@Inject(DB) private readonly db: Database) {}

  private async row(): Promise<EmailAccountRow | undefined> {
    const [row] = await this.db.select().from(emailAccount).limit(1);
    return row;
  }

  /** 配置变化时通知（定时拉取据此重排） */
  onChange(listener: ChangeListener): void {
    this.listeners.push(listener);
  }

  private async notify(row: EmailAccountRow): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener(syncOptionsOf(row));
      } catch (error) {
        this.logger.error(`邮箱配置变更通知失败: ${describeMailError(error)}`);
      }
    }
  }

  async syncOptions(): Promise<SyncOptions | null> {
    const row = await this.row();
    return row ? syncOptionsOf(row) : null;
  }

  async updateFilters(actorId: string, patch: UpdateSyncFiltersRequest): Promise<MailAccountDto> {
    const existing = await this.row();
    if (!existing) throw new BadRequestException('尚未配置邮箱账号，请先在设置页配置');
    const [saved] = await this.db
      .update(emailAccount)
      .set({ ...patch, updatedBy: actorId, updatedAt: new Date() })
      .where(eq(emailAccount.id, existing.id))
      .returning();
    this.logger.log(`拉取开关已更新 by=${actorId} ${JSON.stringify(patch)}`);
    await this.notify(saved);
    return toDto(saved);
  }

  async markSynced(at: Date): Promise<void> {
    await this.db.update(emailAccount).set({ lastSyncAt: at });
  }

  meta(): MailConfigMeta {
    return { allowedHosts: mailHostAllowlist() };
  }

  async get(): Promise<MailAccountDto | null> {
    const row = await this.row();
    return row ? toDto(row) : null;
  }

  /** 供 M1 起的同步 / 发送使用；每次取用都重新校验白名单 */
  async credentials(): Promise<MailCredentials | null> {
    const row = await this.row();
    if (!row) return null;
    const problem = checkMailEndpoints(row, mailHostAllowlist());
    if (problem) throw new BadRequestException(problem);
    return {
      emailAddress: row.emailAddress,
      authCode: this.box.decrypt(row.authCodeCipher),
      imapHost: row.imapHost,
      imapPort: row.imapPort,
      smtpHost: row.smtpHost,
      smtpPort: row.smtpPort,
    };
  }

  async save(actorId: string, dto: SaveMailAccountRequest): Promise<MailAccountDto> {
    const problem = checkMailEndpoints(dto, mailHostAllowlist());
    if (problem) throw new BadRequestException(problem);

    const { authCode, ...fields } = dto;
    const existing = await this.row();
    const cipher = authCode ? this.box.encrypt(authCode) : undefined;

    let saved: EmailAccountRow;
    if (!existing) {
      if (!cipher) throw new BadRequestException('首次配置必须填写客户端专用密码');
      [saved] = await this.db
        .insert(emailAccount)
        .values({ ...fields, authCodeCipher: cipher, updatedBy: actorId })
        .returning();
    } else {
      if (!cipher && fields.emailAddress !== existing.emailAddress) {
        throw new BadRequestException('更换邮箱账号时必须同时填写新的客户端专用密码');
      }
      [saved] = await this.db
        .update(emailAccount)
        .set({ ...fields, ...(cipher ? { authCodeCipher: cipher } : {}), updatedBy: actorId, updatedAt: new Date() })
        .where(eq(emailAccount.id, existing.id))
        .returning();
    }
    this.logger.log(`邮箱配置已更新 by=${actorId} authCodeChanged=${Boolean(cipher)}`);
    await this.notify(saved);
    return toDto(saved);
  }

  async testConnection(): Promise<TestConnectionResult> {
    const creds = await this.credentials();
    if (!creds) throw new BadRequestException('尚未配置邮箱账号，请先保存配置');
    const [imap, smtp] = await Promise.all([this.testImap(creds), this.testSmtp(creds)]);
    return {
      imapOk: imap.ok,
      imapMessage: imap.message,
      smtpOk: smtp.ok,
      smtpMessage: smtp.message,
      testedAt: new Date().toISOString(),
    };
  }

  private async testImap(c: MailCredentials): Promise<{ ok: boolean; message: string }> {
    const client = new ImapFlow({
      host: c.imapHost,
      port: c.imapPort,
      secure: true,
      auth: { user: c.emailAddress, pass: c.authCode },
      logger: false,
      connectionTimeout: CONNECT_TIMEOUT_MS,
      greetingTimeout: CONNECT_TIMEOUT_MS,
      socketTimeout: CONNECT_TIMEOUT_MS * 2,
    });
    // imapflow 在连接异常时会额外触发 error 事件，不监听会导致进程崩溃
    client.on('error', (err: unknown) => this.logger.warn(`IMAP 连接错误: ${describeMailError(err)}`));
    try {
      await client.connect();
      const status = await client.status('INBOX', { messages: true, unseen: true });
      const counts = status ? `，收件箱共 ${status.messages ?? 0} 封，未读 ${status.unseen ?? 0} 封` : '';
      return { ok: true, message: `连接正常${counts}` };
    } catch (error) {
      const message = describeMailError(error);
      this.logger.warn(`IMAP 连接测试失败: ${message}`);
      return { ok: false, message };
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  private async testSmtp(c: MailCredentials): Promise<{ ok: boolean; message: string }> {
    const transporter = nodemailer.createTransport({
      host: c.smtpHost,
      port: c.smtpPort,
      secure: c.smtpPort === 465,
      requireTLS: c.smtpPort !== 465,
      auth: { user: c.emailAddress, pass: c.authCode },
      connectionTimeout: CONNECT_TIMEOUT_MS,
      greetingTimeout: CONNECT_TIMEOUT_MS,
      socketTimeout: CONNECT_TIMEOUT_MS * 2,
    });
    try {
      await transporter.verify();
      return { ok: true, message: '连接正常，可以发信' };
    } catch (error) {
      const message = describeMailError(error);
      this.logger.warn(`SMTP 连接测试失败: ${message}`);
      return { ok: false, message };
    } finally {
      transporter.close();
    }
  }
}
