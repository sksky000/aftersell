import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { z } from 'zod';
import type { HistoryAccountDto, HistoryTestResult, SaveHistoryAccountRequest } from '@aftersell/shared';
import { SecretBox } from '../common/secret-box';
import { env, mailHostAllowlist } from '../config/env';
import { describeMailError, IMAP_PORTS } from '../mail-config/mail-endpoint';
import { findSentMailbox } from '../mail-sync/sent-sync';
import { SettingsService } from '../settings/settings.service';

const KEY = 'history.account';
const TIMEOUT_MS = 20_000;

const storedSchema = z.object({ emailAddress: z.string(), imapHost: z.string(), imapPort: z.number(), authCodeCipher: z.string() });
type Stored = z.infer<typeof storedSchema>;

/**
 * 历史导入用的生产邮箱账号：只用于只读拉取“已发送”，不经 SMTP，不改任何标记。
 * 授权码 AES-256-GCM 加密存在 setting 表；导入完可在页面删除。
 */
@Injectable()
export class HistoryAccount {
  private readonly logger = new Logger(HistoryAccount.name);
  private readonly box = new SecretBox(env().MAIL_SECRET_KEY);

  constructor(private readonly settings: SettingsService) {}

  private stored(): Promise<Stored | null> {
    return this.settings.get<Stored | null>(KEY, storedSchema.nullable(), null);
  }

  async get(): Promise<HistoryAccountDto | null> {
    const s = await this.stored();
    return s ? { emailAddress: s.emailAddress, imapHost: s.imapHost, imapPort: s.imapPort, hasAuthCode: true } : null;
  }

  private check(host: string, port: number): void {
    if (!mailHostAllowlist().map((h) => h.toLowerCase()).includes(host.toLowerCase())) throw new BadRequestException(`IMAP 服务器 ${host} 不在允许列表中`);
    if (!(IMAP_PORTS as readonly number[]).includes(port)) throw new BadRequestException(`IMAP 端口仅支持 ${IMAP_PORTS.join('/')}（SSL）`);
  }

  async save(actorId: string, dto: SaveHistoryAccountRequest): Promise<HistoryAccountDto> {
    this.check(dto.imapHost, dto.imapPort);
    const existing = await this.stored();
    let cipher = existing?.authCodeCipher;
    if (dto.authCode) cipher = this.box.encrypt(dto.authCode);
    else if (!existing || existing.emailAddress !== dto.emailAddress) throw new BadRequestException('首次填写或更换账号时必须填写客户端专用密码');
    await this.settings.set(KEY, { emailAddress: dto.emailAddress, imapHost: dto.imapHost, imapPort: dto.imapPort, authCodeCipher: cipher! } satisfies Stored, actorId);
    this.logger.log(`历史导入账号已保存 by=${actorId} authCodeChanged=${Boolean(dto.authCode)}`);
    return (await this.get())!;
  }

  async remove(actorId: string): Promise<void> {
    await this.settings.remove(KEY);
    this.logger.log(`历史导入账号已删除 by=${actorId}`);
  }

  /** 已登录、只读打开“已发送”的客户端；调用方负责 logout */
  async connect(): Promise<{ client: ImapFlow; sentPath: string }> {
    const s = await this.stored();
    if (!s) throw new BadRequestException('还没有填写历史导入账号');
    this.check(s.imapHost, s.imapPort);
    const client = new ImapFlow({
      host: s.imapHost,
      port: s.imapPort,
      secure: true,
      auth: { user: s.emailAddress, pass: this.box.decrypt(s.authCodeCipher) },
      logger: false,
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS * 6,
    });
    client.on('error', (err: unknown) => this.logger.warn(`历史导入 IMAP 连接错误: ${describeMailError(err)}`));
    await client.connect();
    const sentPath = await findSentMailbox(client);
    if (!sentPath) {
      await client.logout().catch(() => client.close());
      throw new BadRequestException('没有找到“已发送”文件夹');
    }
    return { client, sentPath };
  }

  async test(): Promise<HistoryTestResult> {
    try {
      const { client, sentPath } = await this.connect();
      try {
        const status = await client.status(sentPath, { messages: true });
        return { ok: true, message: `连接正常，“已发送”共 ${status ? (status.messages ?? 0) : 0} 封` };
      } finally {
        await client.logout().catch(() => client.close());
      }
    } catch (error) {
      return { ok: false, message: error instanceof BadRequestException ? error.message : describeMailError(error) };
    }
  }
}
