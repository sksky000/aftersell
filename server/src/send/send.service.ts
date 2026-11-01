import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { ReadStream } from 'node:fs';
import * as nodemailer from 'nodemailer';
import { z } from 'zod/v4';
import {
  isRecipientAllowed,
  MAX_INLINE_IMAGE_BYTES,
  MAX_UPLOAD_BYTES,
  type DraftDto,
  type PreviewSubjectResponse,
  type ReplyTargetDto,
  type ParsedSaveReply,
  type ParsedSendReply,
  type SentReplyDto,
  type UploadDto,
} from '@aftersell/shared';
import { DB, type Database } from '../db/db.module';
import { emailMessage, emailReply, outboundMessage, replyCorrection, sendLog, upload, type EmailMessageRow, type UploadRow } from '../db/schema';
import { describeMailError } from '../mail-config/mail-endpoint';
import { MailConfigService } from '../mail-config/mail-config.service';
import { stripQuotedHistory } from '../mail/quote-strip';
import { loadPrompt } from '../llm/prompts';
import { LlmService } from '../llm/llm.service';
import { neutralize } from '../pipeline/classification';
import { DraftService } from '../reply/draft.service';
import { MailRoutingService } from '../settings/mail-routing.service';
import { STORAGE, type Storage } from '../storage/storage';
import {
  buildFallbackSubject,
  buildOutgoingHtml,
  buildOutgoingText,
  buildReferences,
  cleanTag,
  composeOutgoingSubject,
  generateMessageId,
  resolveReplyTarget,
  rewriteInlineImages,
  sanitizeOutgoingSubject,
  textToHtml,
} from './outgoing';

const SMTP_TIMEOUT_MS = 30_000;
const SUBJECT_TIMEOUT_MS = 15_000;

const subjectTagSchema = z.object({ progress: z.string(), issue: z.string() });

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}


@Injectable()
export class SendService {
  private readonly logger = new Logger(SendService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: Storage,
    private readonly mailConfig: MailConfigService,
    private readonly mailRouting: MailRoutingService,
    private readonly llm: LlmService,
    private readonly drafts: DraftService,
  ) {}

  private async email(emailId: string): Promise<EmailMessageRow> {
    const [row] = await this.db.select().from(emailMessage).where(eq(emailMessage.id, emailId)).limit(1);
    if (!row) throw new NotFoundException('邮件不存在');
    return row;
  }

  async target(emailId: string): Promise<ReplyTargetDto> {
    const row = await this.email(emailId);
    const t = resolveReplyTarget(row);
    if (!t.to) return { to: null, via: t.via, blockedReason: t.reason };
    const routing = await this.mailRouting.get();
    const blockedReason = isRecipientAllowed(routing, t.to)
      ? null
      : `测试模式已开启，${t.to} 不在发信白名单里，发送会被拦截。请在 设置 → 邮箱 → 发件人角色 里把它加入白名单，或关闭测试模式。`;
    return { to: t.to, via: t.via, blockedReason };
  }

  /** 保存编辑（不发送）。还没有草稿的邮件新建一个空草稿版本承载编辑内容 */
  async save(emailId: string, actorId: string, dto: ParsedSaveReply): Promise<DraftDto> {
    await this.email(emailId);
    await this.assertUploads(dto.attachmentIds);
    const latest = await this.drafts.latestRow(emailId);
    if (latest && latest.status !== 'draft') throw new ConflictException(latest.status === 'sending' ? '回复正在发送中' : '这封邮件已经回复过了');
    const values = { finalContent: dto.content, htmlContent: dto.html, attachmentIds: dto.attachmentIds, updatedAt: new Date() };
    const [row] = latest
      ? await this.db.update(emailReply).set(values).where(eq(emailReply.id, latest.id)).returning()
      : await this.db.insert(emailReply).values({ emailId, version: 1, draftContent: '', createdBy: actorId, ...values }).returning();
    return this.drafts.toDto(row);
  }

  async previewSubject(emailId: string, content: string): Promise<PreviewSubjectResponse> {
    const row = await this.email(emailId);
    const base = (row.subject ?? '').trim();
    const tags = await this.subjectTags(row, content);
    return tags ? { subject: composeOutgoingSubject(base, tags), generated: true } : { subject: buildFallbackSubject(base), generated: false };
  }

  private async subjectTags(row: EmailMessageRow, reply: string): Promise<{ progress: string; issue: string } | null> {
    if (!(await this.llm.isAvailable('subject_tag'))) return null;
    const customer = [stripQuotedHistory(row.bodyText).slice(0, 3000), row.summary ? `Summary: ${row.summary}` : ''].filter(Boolean).join('\n\n');
    const user = [
      `<customer_subject>${neutralize((row.subject ?? '').slice(0, 300))}</customer_subject>`,
      `<customer_message>\n${neutralize(customer)}\n</customer_message>`,
      `<reply>\n${neutralize(reply.slice(0, 3000))}\n</reply>`,
    ].join('\n');
    try {
      const { data } = await Promise.race([
        this.llm.extract('subject_tag', { system: loadPrompt('subject_tag'), user, schema: subjectTagSchema, maxTokens: 300 }, { emailId: row.id }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('超时')), SUBJECT_TIMEOUT_MS)),
      ]);
      const progress = cleanTag(data.progress, 8);
      const issue = cleanTag(data.issue, 6);
      return progress && issue ? { progress, issue } : null;
    } catch (error) {
      this.logger.warn(`主题标签生成失败 email=${row.id}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  // ---------- 上传 ----------

  async createUpload(file: UploadedFileLike | undefined, actorId: string): Promise<UploadDto> {
    if (!file?.buffer?.length) throw new BadRequestException('没有收到文件');
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException('文件超过 25MB 上限');
    const stored = await this.storage.putContent(file.buffer);
    // multer 按 latin1 解析文件名，中文名需转回 UTF-8
    const filename = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[\r\n"\\/]/g, '_').slice(0, 255) || 'file';
    const [row] = await this.db
      .insert(upload)
      .values({ storageKey: stored.key, sha256: stored.sha256, filename, contentType: file.mimetype || 'application/octet-stream', size: stored.size, createdBy: actorId })
      .returning();
    return { id: row.id, filename: row.filename, contentType: row.contentType, size: row.size };
  }

  async openUpload(id: string): Promise<{ row: UploadRow; stream: ReadStream; size: number }> {
    const [row] = await this.db.select().from(upload).where(eq(upload.id, id)).limit(1);
    if (!row) throw new NotFoundException('文件不存在');
    const { stream, size } = await this.storage.open(row.storageKey);
    return { row, stream, size };
  }

  private async assertUploads(ids: string[]): Promise<UploadRow[]> {
    if (!ids.length) return [];
    const rows = await this.db.select().from(upload).where(inArray(upload.id, ids));
    if (rows.length !== new Set(ids).size) throw new BadRequestException('有附件不存在，请重新上传');
    return rows;
  }

  private async readUpload(row: UploadRow): Promise<Buffer> {
    const { stream } = await this.storage.open(row.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  // ---------- 发送 ----------

  async send(emailId: string, actorId: string, dto: ParsedSendReply): Promise<SentReplyDto> {
    const key = dto.idempotencyKey;
    // 同一个键已经处理过：不再发送
    const [prior] = await this.db.select().from(emailReply).where(eq(emailReply.sendIdempotencyKey, key)).limit(1);
    if (prior) {
      if (prior.status === 'sent' && prior.sentTo && prior.sentAt) {
        return { replyId: prior.id, to: prior.sentTo, subject: prior.subjectSent ?? '', sentAt: prior.sentAt.toISOString(), duplicate: true };
      }
      throw new ConflictException('这封回复正在发送中，请稍候刷新');
    }

    const row = await this.email(emailId);
    if (row.status === 'replied') throw new ConflictException('这封邮件已经回复过了');
    const target = resolveReplyTarget(row);
    if (!target.to) throw new BadRequestException(target.reason);
    const to = target.to;
    if (!isRecipientAllowed(await this.mailRouting.get(), to)) {
      throw new BadRequestException(`测试模式已开启，${to} 不在发信白名单里，已拦截。请在 设置 → 邮箱 → 发件人角色 里把它加入白名单，或关闭测试模式。`);
    }
    const creds = await this.mailConfig.credentials();
    if (!creds) throw new BadRequestException('还没有配置邮箱账号，请先到 设置 → 邮箱 填写');

    // 先把所有要发的内容准备好，任何一项有问题都不占用发送
    const ownHtml = dto.html?.trim() ? dto.html : textToHtml(dto.content);
    const inline = rewriteInlineImages(ownHtml, creds.emailAddress);
    if (inline.invalid.length) throw new BadRequestException('正文里有不是本系统上传的图片（外部链接或直接粘贴的数据），请删掉后用“粘贴 / 插入图片”重新上传');
    const inlineRows = await this.assertUploads(inline.images.map((i) => i.uploadId));
    const attachmentRows = await this.assertUploads(dto.attachmentIds);
    const inlineById = new Map(inlineRows.map((r) => [r.id, r]));
    const inlineFiles = await Promise.all(
      inline.images.map(async (img) => {
        const r = inlineById.get(img.uploadId)!;
        if (!r.contentType.startsWith('image/')) throw new BadRequestException(`${r.filename} 不是图片，不能放在正文里`);
        if (r.size > MAX_INLINE_IMAGE_BYTES) throw new BadRequestException(`正文图片 ${r.filename} 超过 10MB，请改为附件`);
        return { filename: r.filename, content: await this.readUpload(r), contentType: r.contentType, cid: img.cid };
      }),
    );
    const attachmentById = new Map(attachmentRows.map((r) => [r.id, r]));
    const attachmentFiles = await Promise.all(
      dto.attachmentIds.map(async (id) => {
        const r = attachmentById.get(id)!;
        return { filename: r.filename, content: await this.readUpload(r), contentType: r.contentType };
      }),
    );
    const subject = sanitizeOutgoingSubject(dto.subject);
    if (!subject) throw new BadRequestException('主题不能为空');
    const messageId = generateMessageId(creds.emailAddress);

    // 占用：最新版本从 draft 改为 sending，带上幂等键；并发的第二次提交会在这里失败
    const claimed = await this.claim(emailId, actorId, key, dto);

    const transporter = nodemailer.createTransport({
      host: creds.smtpHost,
      port: creds.smtpPort,
      secure: creds.smtpPort === 465,
      requireTLS: creds.smtpPort !== 465,
      auth: { user: creds.emailAddress, pass: creds.authCode },
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS * 2,
    });
    try {
      await transporter.sendMail({
        from: creds.emailAddress,
        to,
        subject,
        text: buildOutgoingText(dto.content, row, creds.emailAddress),
        html: buildOutgoingHtml(inline.html, row, creds.emailAddress),
        attachments: [...inlineFiles, ...attachmentFiles],
        messageId,
        inReplyTo: row.messageId,
        references: buildReferences(row),
      });
    } catch (error) {
      const detail = describeMailError(error);
      this.logger.warn(`回复发送失败 email=${emailId}: ${detail}`);
      await this.db.update(emailReply).set({ status: 'draft', sendIdempotencyKey: null, updatedAt: new Date() }).where(eq(emailReply.id, claimed));
      await this.db.insert(sendLog).values({ emailId, replyId: claimed, idempotencyKey: key, toAddress: to, subject, messageId, result: 'failed', error: detail.slice(0, 1000), actorId });
      throw new BadRequestException(`邮件发送失败：${detail}`);
    } finally {
      transporter.close();
    }

    const sentAt = new Date();
    try {
      await this.db.transaction(async (tx) => {
        const [reply] = await tx
          .update(emailReply)
          .set({ status: 'sent', replyMessageId: messageId, subjectSent: subject, sentTo: to, sentAt, sentBy: actorId, updatedAt: sentAt })
          .where(eq(emailReply.id, claimed))
          .returning();
        await tx.update(emailMessage).set({ status: 'replied', updatedAt: sentAt }).where(eq(emailMessage.id, emailId));
        // 进入会话历史：阶段引擎据此知道我们说过什么、承诺过什么
        await tx
          .insert(outboundMessage)
          .values({ messageId, inReplyTo: row.messageId, refChain: buildReferences(row), subject, toAddresses: to, sentAt, bodyText: dto.content, source: 'system' })
          .onConflictDoNothing();
        await tx.insert(sendLog).values({ emailId, replyId: claimed, idempotencyKey: key, toAddress: to, subject, messageId, result: 'succeeded', actorId });
        if (reply.draftContent.trim() && reply.draftContent.trim() !== dto.content.trim()) {
          await tx.insert(replyCorrection).values({
            emailId,
            replyId: claimed,
            category: row.category,
            partType: row.partType,
            originalDraft: reply.draftContent,
            finalContent: dto.content,
            createdBy: actorId,
          });
        }
      });
    } catch (error) {
      // 邮件已经发出：只记录，不能让客服以为没发而重发（该版本停在 sending，同键重试会被拦下）
      this.logger.error(`回复已发出但记录失败 email=${emailId} message=${messageId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.logger.log(`回复已发送 email=${emailId} reply=${claimed} by=${actorId}`);
    return { replyId: claimed, to, subject, sentAt: sentAt.toISOString(), duplicate: false };
  }

  private async claim(emailId: string, actorId: string, key: string, dto: ParsedSendReply): Promise<string> {
    try {
      return await this.db.transaction(async (tx) => {
        const [latest] = await tx.select().from(emailReply).where(eq(emailReply.emailId, emailId)).orderBy(desc(emailReply.version)).limit(1);
        const values = { status: 'sending' as const, sendIdempotencyKey: key, finalContent: dto.content, htmlContent: dto.html, attachmentIds: dto.attachmentIds, updatedAt: new Date() };
        if (!latest) {
          const [created] = await tx.insert(emailReply).values({ emailId, version: 1, draftContent: '', createdBy: actorId, ...values }).returning({ id: emailReply.id });
          return created.id;
        }
        const [updated] = await tx
          .update(emailReply)
          .set(values)
          .where(and(eq(emailReply.id, latest.id), eq(emailReply.status, 'draft')))
          .returning({ id: emailReply.id });
        if (!updated) throw new ConflictException(latest.status === 'sent' ? '这封邮件已经回复过了' : '这封回复正在发送中，请稍候刷新');
        return updated.id;
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      // 唯一索引冲突：同一个键的另一次提交抢先占用了
      if (String((error as { code?: string }).code) === '23505') throw new ConflictException('这封回复正在发送中，请稍候刷新');
      throw error;
    }
  }
}
