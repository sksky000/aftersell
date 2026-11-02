import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, like, lt, ne, or, sql } from 'drizzle-orm';
import type { DraftDto, Language, RuleHitDto } from '@aftersell/shared';
import { DB, type Database } from '../db/db.module';
import {
  attachmentRecognition,
  emailAttachment,
  emailMessage,
  emailReply,
  outboundMessage,
  ruleHit,
  upload,
  type EmailMessageRow,
  type EmailReplyRow,
} from '../db/schema';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { loadPrompt } from '../llm/prompts';
import { LlmService } from '../llm/llm.service';
import { detectCustomerLanguage } from '../mail/language';
import { stripQuotedHistory } from '../mail/quote-strip';
import { isTrialMode } from '../mail/trial-mode';
import { neutralize } from '../pipeline/classification';
import { assembleContext } from './context';
import { checkDraft, finalizeDraft, isLanguageMismatch } from './draft-output';
import { collectCaseEvidence, type EngineAttachment } from './evidence-state';
import { deriveConversationStage, type ConversationEvent } from './history-stage';
import { evaluateRules } from './rule-engine';
import { RulesService } from './rules.service';
import { computeSignals } from './signals';

const MAX_BODY = 8000;
const MAX_OUTBOUND = 30;
const LANGUAGE_RETRY = {
  en: 'IMPORTANT: the customer wrote in English. Write the entire reply in English, with no Chinese characters at all.',
  zh: 'IMPORTANT: the customer wrote in Chinese. Write the reply body in Chinese; keep only the fixed English closing.',
};

/** 非客诉的 other（广告、系统通知等）不生成草稿 */
export function shouldDraft(row: Pick<EmailMessageRow, 'status' | 'isComplaint' | 'category' | 'pipelineState'>): boolean {
  // 试跑时客服可能已在原系统回复：仍生成草稿，供“试跑对比”与实际回复对照
  const open = row.status === 'pending_review' || (isTrialMode() && row.status === 'replied');
  return open && row.pipelineState !== 'ingested' && (row.isComplaint || row.category !== 'other');
}

@Injectable()
export class DraftService {
  private readonly logger = new Logger(DraftService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly llm: LlmService,
    private readonly rules: RulesService,
    private readonly knowledge: KnowledgeService,
  ) {}

  private async attachmentsByEmail(emailIds: string[]): Promise<Map<string, EngineAttachment[]>> {
    const map = new Map<string, EngineAttachment[]>();
    if (!emailIds.length) return map;
    const rows = await this.db
      .select({
        emailId: emailAttachment.emailId,
        filename: emailAttachment.filename,
        contentType: emailAttachment.contentType,
        status: attachmentRecognition.status,
        text: attachmentRecognition.text,
      })
      .from(emailAttachment)
      .leftJoin(attachmentRecognition, eq(attachmentRecognition.sha256, emailAttachment.sha256))
      .where(inArray(emailAttachment.emailId, emailIds))
      .orderBy(asc(emailAttachment.position));
    for (const r of rows) {
      const att: EngineAttachment = {
        filename: r.filename,
        contentType: r.contentType,
        aiDescription: r.status === 'succeeded' ? r.text : null,
        recognition: r.status ? { status: r.status } : null,
      };
      map.set(r.emailId, [...(map.get(r.emailId) ?? []), att]);
    }
    return map;
  }

  /** 本案此前的来信（同 thread_id）与引用了它们的我方回复，按时间排好 */
  private async caseEvents(row: EmailMessageRow): Promise<{ events: ConversationEvent[]; attachments: Map<string, EngineAttachment[]> }> {
    const currentAt = row.receivedAt ?? row.createdAt;
    const prior = row.threadId
      ? await this.db
          .select()
          .from(emailMessage)
          .where(
            and(
              eq(emailMessage.threadId, row.threadId),
              ne(emailMessage.id, row.id),
              sql`coalesce(${emailMessage.receivedAt}, ${emailMessage.createdAt}) <= ${currentAt}`,
            ),
          )
      : [];
    const attachments = await this.attachmentsByEmail([row.id, ...prior.map((p) => p.id)]);

    const ids = [row.messageId, ...prior.map((p) => p.messageId)];
    const outbound = await this.db
      .select()
      .from(outboundMessage)
      .where(
        and(
          or(inArray(outboundMessage.inReplyTo, ids), ...ids.slice(0, 20).map((id) => like(outboundMessage.refChain, `%${id}%`))),
          lt(outboundMessage.sentAt, currentAt),
        ),
      )
      .orderBy(desc(outboundMessage.sentAt))
      .limit(MAX_OUTBOUND);

    const events: ConversationEvent[] = [
      ...prior.map((p) => {
        const files = attachments.get(p.id) ?? [];
        return {
          at: p.receivedAt ?? p.createdAt,
          role: 'customer' as const,
          subject: p.subject,
          bodyText: stripQuotedHistory(p.bodyText),
          fromAddress: p.fromAddress,
          hasMedia: files.some((f) => /^(image|video)\//.test(f.contentType)),
          sourceId: p.messageId,
          attachments: files,
        };
      }),
      ...outbound.map((o) => ({
        at: o.sentAt ?? o.createdAt,
        role: 'agent' as const,
        subject: o.subject,
        bodyText: stripQuotedHistory(o.bodyText),
        fromAddress: null,
        hasMedia: false,
        sourceId: o.messageId,
      })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    return { events, attachments };
  }

  async generate(emailId: string, actorId: string | null = null): Promise<DraftDto> {
    const [row] = await this.db.select().from(emailMessage).where(eq(emailMessage.id, emailId)).limit(1);
    if (!row) throw new NotFoundException('邮件不存在');
    if (row.status === 'replied' && !isTrialMode()) throw new ConflictException('这封邮件已经回复，不再生成草稿');

    const { events, attachments } = await this.caseEvents(row);
    const current = attachments.get(row.id) ?? [];
    const { evidence, info } = collectCaseEvidence([
      ...events
        .filter((ev) => ev.role === 'customer')
        .map((ev, i) => ({ id: ev.sourceId ?? `history-${i}`, bodyText: ev.bodyText, attachments: ev.attachments })),
      { id: row.messageId, bodyText: row.bodyText, attachments: current },
    ]);
    const stage = deriveConversationStage(
      events,
      { messageId: row.messageId, bodyText: row.bodyText, receivedAt: row.receivedAt?.toISOString() ?? null, attachments: current },
      info,
    );

    const [payment, prices, styles, engineRules] = await Promise.all([
      this.knowledge.payment(),
      this.knowledge.listPrices(true),
      this.knowledge.stylesFor(row.category, row.partType),
      this.rules.engineRules(),
    ]);
    const models = this.knowledge.compiledModels();
    // 分类时已判定过；这里再判一次，让修复前入库的错误语言在“重新生成”时也能纠正
    const language = detectCustomerLanguage(row, row.language as Language);
    const signals = computeSignals({
      message: { ...row, language, attachments: current },
      stage,
      models,
      payment,
    });
    const evaluation = evaluateRules(engineRules, signals);
    for (const e of evaluation.errors) this.logger.warn(`规则 ${e.key} 条件求值出错，已跳过: ${e.error}`);
    const card = await this.knowledge.matchCard(row.category, row.partType, current.some((a) => a.contentType.startsWith('image/')));

    const context = assembleContext({
      rules: evaluation,
      prices,
      payment,
      productKnowledge: models.find((m) => m.modelCode === signals.matchedModel)?.knowledge ?? null,
      card,
      styles,
      events,
      stage,
      info,
      evidence,
    });
    const body = row.bodyText.trim() || (current.length ? '[No text. The customer sent attachments only.]' : '[No text content.]');
    const user = [
      '<context>',
      context,
      '</context>',
      '',
      '<email>',
      `<subject>${neutralize(row.subject?.trim() || '(no subject)')}</subject>`,
      `<from>${neutralize([row.fromName, row.fromAddress && `<${row.fromAddress}>`].filter(Boolean).join(' '))}</from>`,
      `<body>\n${neutralize(body.slice(0, MAX_BODY))}\n</body>`,
      '</email>',
      '',
      'Write the reply now.',
    ].join('\n');

    const batteryPurchase = signals.isPurchaseFlow && row.partType === 'battery' && signals.modelKnown;
    const write = async (prompt: string) => {
      const { text, config } = await this.llm.generate('draft', { system: loadPrompt('draft'), user: prompt, maxTokens: 1500 }, { emailId });
      const draft = finalizeDraft(text, {
        info,
        batteryPhotos: batteryPurchase
          ? { bicycle: evidence.bicyclePhoto.state === 'missing', battery: evidence.batteryPhoto.state === 'missing' }
          : null,
      });
      return { draft, config };
    };
    let { draft, config } = await write(user);
    // 语言写错重写一次；仍不对就留给检查项提示客服
    if ((language === 'en' || language === 'zh') && isLanguageMismatch(draft, language)) {
      this.logger.warn(`草稿语言与客户语言(${language})不符，重写一次 email=${emailId}`);
      ({ draft, config } = await write(`${user}\n\n${LANGUAGE_RETRY[language]}`));
    }
    const checks = checkDraft(draft, {
      evidence,
      priceAmounts: prices.map((p) => p.amount),
      knownText: [row.bodyText, ...events.map((e) => e.bodyText ?? '')].join('\n'),
      payment,
      language,
    });

    const saved = await this.db.transaction(async (tx) => {
      const [{ max }] = await tx
        .select({ max: sql<number>`coalesce(max(${emailReply.version}), 0)::int` })
        .from(emailReply)
        .where(eq(emailReply.emailId, emailId));
      const [reply] = await tx
        .insert(emailReply)
        .values({
          emailId,
          version: max + 1,
          draftContent: draft,
          context,
          checks,
          provider: config.provider,
          model: config.model,
          createdBy: actorId,
        })
        .returning();
      if (evaluation.hits.length) {
        await tx.insert(ruleHit).values(evaluation.hits.map((h) => ({ replyId: reply.id, ruleKey: h.key, slot: h.slot })));
      }
      await tx
        .update(emailMessage)
        .set({ pipelineState: 'drafted', pipelineError: null, language, updatedAt: new Date() })
        .where(eq(emailMessage.id, emailId));
      return reply;
    });
    this.logger.log(`草稿已生成 email=${emailId} v${saved.version} 命中规则 ${evaluation.hits.length} 条 检查 ${checks.length} 项`);
    return this.toDto(saved);
  }

  async toDto(reply: EmailReplyRow): Promise<DraftDto> {
    const [hits, descriptions, files] = await Promise.all([
      this.db.select().from(ruleHit).where(eq(ruleHit.replyId, reply.id)),
      this.rules.descriptions(),
      reply.attachmentIds.length ? this.db.select().from(upload).where(inArray(upload.id, reply.attachmentIds)) : Promise.resolve([]),
    ]);
    const hitDtos: RuleHitDto[] = hits.map((h) => ({ ruleKey: h.ruleKey, slot: h.slot, description: descriptions.get(h.ruleKey) ?? h.ruleKey }));
    const fileById = new Map(files.map((f) => [f.id, f]));
    return {
      id: reply.id,
      emailId: reply.emailId,
      version: reply.version,
      content: reply.draftContent,
      status: reply.status,
      finalContent: reply.finalContent,
      html: reply.htmlContent,
      attachments: reply.attachmentIds.flatMap((id) => {
        const f = fileById.get(id);
        return f ? [{ id: f.id, filename: f.filename, contentType: f.contentType, size: f.size }] : [];
      }),
      subjectSent: reply.subjectSent,
      sentTo: reply.sentTo,
      sentAt: reply.sentAt?.toISOString() ?? null,
      provider: reply.provider,
      model: reply.model,
      createdAt: reply.createdAt.toISOString(),
      checks: reply.checks,
      hits: hitDtos,
    };
  }

  async latestRow(emailId: string): Promise<EmailReplyRow | null> {
    const [reply] = await this.db
      .select()
      .from(emailReply)
      .where(eq(emailReply.emailId, emailId))
      .orderBy(desc(emailReply.version))
      .limit(1);
    return reply ?? null;
  }

  async latest(emailId: string): Promise<DraftDto | null> {
    const reply = await this.latestRow(emailId);
    return reply ? this.toDto(reply) : null;
  }

  async latestContext(emailId: string): Promise<string | null> {
    return (await this.latestRow(emailId))?.context ?? null;
  }
}
