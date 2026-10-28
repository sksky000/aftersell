import { buffer } from 'node:stream/consumers';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { attachmentRecognition, emailAttachment, type AttachmentRecognitionRow } from '../db/schema';
import { loadPrompt } from '../llm/prompts';
import { LlmService } from '../llm/llm.service';
import { STORAGE, type Storage } from '../storage/storage';
import { canAttempt, extractPdfPageImages, extractPdfText, planRecognition, prepareImage, scannedPdfPrompt } from './recognition';

type RecognitionPatch = Omit<typeof attachmentRecognition.$inferInsert, 'sha256'>;

@Injectable()
export class RecognitionService {
  private readonly logger = new Logger(RecognitionService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: Storage,
    private readonly llm: LlmService,
  ) {}

  async rowsFor(hashes: string[]): Promise<Map<string, AttachmentRecognitionRow>> {
    if (!hashes.length) return new Map();
    const rows = await this.db.select().from(attachmentRecognition).where(inArray(attachmentRecognition.sha256, [...new Set(hashes)]));
    return new Map(rows.map((r) => [r.sha256, r]));
  }

  private async save(sha256: string, patch: RecognitionPatch): Promise<void> {
    await this.db
      .insert(attachmentRecognition)
      .values({ sha256, ...patch })
      .onConflictDoUpdate({ target: attachmentRecognition.sha256, set: patch });
  }

  /**
   * 识别一封邮件的图片和 PDF。每个文件先记一次尝试再调用，单个失败不影响其他附件和后续分类。
   * @param force 重新分类时允许重试已用完次数的失败项
   */
  async recognizeEmail(emailId: string, force = false): Promise<void> {
    const attachments = await this.db
      .select()
      .from(emailAttachment)
      .where(eq(emailAttachment.emailId, emailId))
      .orderBy(asc(emailAttachment.position));
    if (!attachments.length) return;
    const plan = planRecognition(attachments);
    const existing = await this.rowsFor(attachments.map((a) => a.sha256));
    const visionReady = await this.llm.isAvailable('vision');
    const done = new Set<string>();

    for (const [i, att] of attachments.entries()) {
      const item = plan[i];
      if ('skip' in item || done.has(att.sha256)) continue;
      done.add(att.sha256);
      const row = existing.get(att.sha256);
      const retryable = force && row?.status === 'failed';
      if (!retryable && !canAttempt(row, Date.now())) continue;

      if (item.kind === 'image' && !visionReady) {
        await this.save(att.sha256, { status: 'failed', reason: 'vision_not_configured', attempts: row?.attempts ?? 0, attemptedAt: new Date() });
        continue;
      }
      const attempts = (row?.reason === 'vision_not_configured' ? row.attempts : row?.attempts ?? 0) + 1;
      await this.save(att.sha256, { status: 'failed', reason: 'interrupted', attempts, attemptedAt: new Date() });

      let content: Buffer;
      try {
        content = await buffer((await this.storage.open(att.storageKey)).stream);
      } catch (error) {
        this.logger.warn(`读取附件失败 ${att.id}: ${String(error)}`);
        await this.save(att.sha256, { status: 'failed', reason: item.kind === 'pdf' ? 'pdf_failed' : 'model_failed', attempts });
        continue;
      }

      if (item.kind === 'pdf') {
        try {
          const text = await extractPdfText(content);
          if (text) {
            await this.save(att.sha256, { status: 'succeeded', text, reason: null, attempts, provider: 'local', model: 'unpdf' });
            continue;
          }
          const pages = await extractPdfPageImages(content);
          if (!pages.length) {
            await this.save(att.sha256, { status: 'unsupported', text: null, reason: 'no_text_layer', attempts });
          } else if (!visionReady) {
            await this.save(att.sha256, { status: 'failed', reason: 'vision_not_configured', attempts: attempts - 1 });
          } else {
            const base = loadPrompt('vision');
            const parts: string[] = [];
            let used = { provider: '', model: '' };
            for (const [p, image] of pages.entries()) {
              const { text: pageText, config } = await this.llm.vision(
                'vision',
                { prompt: scannedPdfPrompt(base, p + 1), images: [image], maxTokens: 800 },
                { emailId },
              );
              used = config;
              if (pageText) parts.push(pages.length > 1 ? `[Page ${p + 1}] ${pageText}` : pageText);
            }
            await this.save(
              att.sha256,
              parts.length
                ? { status: 'succeeded', text: `[Scanned PDF, read by the vision model]\n${parts.join('\n')}`, reason: null, attempts, ...used }
                : { status: 'failed', reason: 'empty_result', attempts },
            );
          }
        } catch (error) {
          this.logger.warn(`PDF 识别失败 ${att.id}: ${error instanceof Error ? error.message : String(error)}`);
          await this.save(att.sha256, { status: 'failed', reason: 'pdf_failed', attempts });
        }
        continue;
      }

      let image;
      try {
        image = await prepareImage(content);
      } catch {
        await this.save(att.sha256, { status: 'unsupported', reason: 'unreadable_image', attempts });
        continue;
      }
      try {
        const { text, config } = await this.llm.vision('vision', { prompt: loadPrompt('vision'), images: [image], maxTokens: 600 }, { emailId });
        await this.save(
          att.sha256,
          text
            ? { status: 'succeeded', text, reason: null, attempts, provider: config.provider, model: config.model }
            : { status: 'failed', reason: 'empty_result', attempts },
        );
      } catch (error) {
        this.logger.warn(`识图失败 ${att.id}: ${error instanceof Error ? error.message : String(error)}`);
        await this.save(att.sha256, { status: 'failed', reason: 'model_failed', attempts });
      }
    }
  }
}
