import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { emailAttachment, emailMessage } from '../db/schema';
import { loadPrompt } from '../llm/prompts';
import { LlmService } from '../llm/llm.service';
import { AdjudicationService, adjudicationKey } from './adjudication.service';
import { buildClassifyInput, classificationSchema, FALLBACK_CLASSIFICATION, finalizeClassification, type ClassifyAttachment } from './classification';
import { RecognitionService } from './recognition.service';

@Injectable()
export class ClassifyService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly llm: LlmService,
    private readonly recognition: RecognitionService,
    private readonly adjudications: AdjudicationService,
  ) {}

  async classify(emailId: string): Promise<void> {
    const [row] = await this.db.select().from(emailMessage).where(eq(emailMessage.id, emailId)).limit(1);
    if (!row) return;
    const files = await this.db
      .select()
      .from(emailAttachment)
      .where(eq(emailAttachment.emailId, emailId))
      .orderBy(asc(emailAttachment.position));
    const recognized = await this.recognition.rowsFor(files.map((f) => f.sha256));
    const attachments: ClassifyAttachment[] = files.map((f) => {
      const r = recognized.get(f.sha256);
      return { filename: f.filename, contentType: f.contentType, recognized: r?.status === 'succeeded' ? r.text : null };
    });

    const { data, config } = await this.llm.extract(
      'classify',
      {
        system: loadPrompt('classify'),
        user: buildClassifyInput({ ...row, attachments }),
        schema: classificationSchema,
        maxTokens: 1200,
      },
      { emailId },
    );
    const final = finalizeClassification(data, {
      attachments,
      bodyText: row.bodyText,
      adjudicatedNotOurs: await this.adjudications.has(adjudicationKey(row), 'non_phoenix_product'),
    });
    const { notOurProductReason, adjudicated, ...fields } = final;
    await this.db
      .update(emailMessage)
      .set({
        ...fields,
        classifyDetail: { notOurProductReason, adjudicated, provider: config.provider, model: config.model },
        pipelineState: 'classified',
        pipelineError: null,
        classifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(emailMessage.id, emailId));
  }

  /** 分类彻底失败：归 other、标记待人工，看板上单独成组 */
  async markFailed(emailId: string, reason: string): Promise<void> {
    await this.db
      .update(emailMessage)
      .set({
        ...FALLBACK_CLASSIFICATION,
        missingEvidence: [],
        summary: null,
        classifyDetail: null,
        pipelineState: 'failed',
        pipelineError: reason.slice(0, 500),
        classifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(emailMessage.id, emailId));
  }

  async noteError(emailId: string, message: string): Promise<void> {
    await this.db.update(emailMessage).set({ pipelineError: message.slice(0, 500) }).where(eq(emailMessage.id, emailId));
  }
}
