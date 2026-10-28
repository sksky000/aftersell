import { Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import {
  EMPTY_PAYMENT_SETTINGS,
  paymentSettingsSchema,
  type KnowledgeCardDto,
  type PaymentSettings,
  type PriceItemDto,
  type ProductKnowledgeDto,
  type SavePriceItemRequest,
  type SaveStyleRuleRequest,
  type StyleRuleDto,
} from '@aftersell/shared';
import { DB, type Database } from '../db/db.module';
import {
  knowledgeCard,
  priceItem,
  productKnowledge,
  styleRule,
  type KnowledgeCardRow,
  type PriceItemRow,
  type StyleRuleRow,
} from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import { compileModels, type CompiledModel } from './product-knowledge';
import { PRODUCT_KNOWLEDGE_SEED } from './product-knowledge.seed';

const PAYMENT_KEY = 'business.payment';

export function toPriceDto(row: PriceItemRow): PriceItemDto {
  return {
    id: row.id,
    partType: row.partType,
    modelCode: row.modelCode,
    label: row.label,
    amount: row.amount / 100,
    includesShipping: row.includesShipping,
    note: row.note,
    enabled: row.enabled,
  };
}

function toStyleDto(row: StyleRuleRow): StyleRuleDto {
  return {
    id: row.id,
    text: row.text,
    category: row.category,
    partType: row.partType,
    enabled: row.enabled,
    source: row.source,
    sortOrder: row.sortOrder,
  };
}

export function toCardDto(row: KnowledgeCardRow): KnowledgeCardDto {
  return {
    id: row.id,
    clusterKey: row.clusterKey,
    category: row.category,
    partType: row.partType,
    imageFlag: row.imageFlag,
    sampleSize: row.sampleSize,
    skeleton: row.skeleton,
    facts: row.facts,
    rules: row.rules,
    drift: row.drift,
    enabled: row.enabled,
  };
}

/** 业务知识：说明书知识、知识卡、风格条目、价格表、收款信息 */
@Injectable()
export class KnowledgeService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeService.name);
  private models: CompiledModel[] = [];

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    // 只补库里没有的车型，不覆盖设置页的修改
    await this.db.insert(productKnowledge).values(PRODUCT_KNOWLEDGE_SEED).onConflictDoNothing();
    await this.reloadModels();
  }

  private async reloadModels(): Promise<void> {
    const rows = await this.db.select().from(productKnowledge);
    this.models = compileModels(rows, (code, error) => this.logger.error(`车型 ${code} 的匹配正则无效，已跳过: ${error}`));
  }

  /** 已启用车型的编译后匹配规则（内存缓存，修改后刷新） */
  compiledModels(): CompiledModel[] {
    return this.models;
  }

  // ---------- 说明书知识 ----------

  async listProducts(): Promise<ProductKnowledgeDto[]> {
    const rows = await this.db.select().from(productKnowledge).orderBy(asc(productKnowledge.sortOrder));
    return rows.map(({ modelCode, name, electric, noToolkit, knowledge, enabled }) => ({
      modelCode,
      name,
      electric,
      noToolkit,
      knowledge,
      enabled,
    }));
  }

  async updateProduct(modelCode: string, patch: { knowledge?: string; enabled?: boolean }): Promise<void> {
    const updated = await this.db
      .update(productKnowledge)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(productKnowledge.modelCode, modelCode))
      .returning({ modelCode: productKnowledge.modelCode });
    if (!updated.length) throw new NotFoundException('车型不存在');
    await this.reloadModels();
  }

  // ---------- 知识卡 ----------

  async listCards(): Promise<KnowledgeCardDto[]> {
    const rows = await this.db.select().from(knowledgeCard).orderBy(asc(knowledgeCard.category), asc(knowledgeCard.partType));
    return rows.map(toCardDto);
  }

  async setCardEnabled(id: string, enabled: boolean): Promise<void> {
    const updated = await this.db
      .update(knowledgeCard)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(knowledgeCard.id, id))
      .returning({ id: knowledgeCard.id });
    if (!updated.length) throw new NotFoundException('知识卡不存在');
  }

  /** 妙搭的匹配：同类别 + 同图片标记，零件精确匹配优先于 multiple，样本多者优先 */
  async matchCard(category: string, partType: string, hasImages: boolean): Promise<KnowledgeCardRow | null> {
    const rows = await this.db
      .select()
      .from(knowledgeCard)
      .where(
        and(
          eq(knowledgeCard.enabled, true),
          eq(knowledgeCard.category, category),
          eq(knowledgeCard.imageFlag, hasImages ? 'with_images' : 'no_images'),
          or(eq(knowledgeCard.partType, partType), eq(knowledgeCard.partType, 'multiple')),
        ),
      );
    rows.sort((a, b) => Number(b.partType === partType) - Number(a.partType === partType) || b.sampleSize - a.sampleSize);
    return rows[0] ?? null;
  }

  // ---------- 风格条目 ----------

  async listStyles(): Promise<StyleRuleDto[]> {
    const rows = await this.db.select().from(styleRule).orderBy(asc(styleRule.sortOrder), asc(styleRule.createdAt));
    return rows.map(toStyleDto);
  }

  /** 适用于该邮件的已启用条目：全局条目 + 类别 / 零件匹配的条目 */
  async stylesFor(category: string, partType: string): Promise<StyleRuleDto[]> {
    const rows = await this.db
      .select()
      .from(styleRule)
      .where(
        and(
          eq(styleRule.enabled, true),
          or(isNull(styleRule.category), eq(styleRule.category, category as StyleRuleRow['category'] & string)),
          or(isNull(styleRule.partType), eq(styleRule.partType, partType as StyleRuleRow['partType'] & string)),
        ),
      )
      .orderBy(asc(styleRule.sortOrder));
    return rows.map(toStyleDto);
  }

  async createStyle(dto: SaveStyleRuleRequest): Promise<StyleRuleDto> {
    const [row] = await this.db.insert(styleRule).values({ ...dto, source: '设置页添加', sortOrder: 1000 }).returning();
    return toStyleDto(row);
  }

  async updateStyle(id: string, dto: SaveStyleRuleRequest): Promise<StyleRuleDto> {
    const [row] = await this.db.update(styleRule).set({ ...dto, updatedAt: new Date() }).where(eq(styleRule.id, id)).returning();
    if (!row) throw new NotFoundException('风格条目不存在');
    return toStyleDto(row);
  }

  async deleteStyle(id: string): Promise<void> {
    const deleted = await this.db.delete(styleRule).where(eq(styleRule.id, id)).returning({ id: styleRule.id });
    if (!deleted.length) throw new NotFoundException('风格条目不存在');
  }

  // ---------- 价格表 ----------

  async listPrices(enabledOnly = false): Promise<PriceItemDto[]> {
    const rows = await this.db
      .select()
      .from(priceItem)
      .where(enabledOnly ? eq(priceItem.enabled, true) : undefined)
      .orderBy(asc(priceItem.partType), asc(priceItem.modelCode), asc(priceItem.label));
    return rows.map(toPriceDto);
  }

  async createPrice(dto: SavePriceItemRequest): Promise<PriceItemDto> {
    const [row] = await this.db
      .insert(priceItem)
      .values({ ...dto, amount: Math.round(dto.amount * 100) })
      .returning();
    return toPriceDto(row);
  }

  async updatePrice(id: string, dto: SavePriceItemRequest): Promise<PriceItemDto> {
    const [row] = await this.db
      .update(priceItem)
      .set({ ...dto, amount: Math.round(dto.amount * 100), updatedAt: new Date() })
      .where(eq(priceItem.id, id))
      .returning();
    if (!row) throw new NotFoundException('价格条目不存在');
    return toPriceDto(row);
  }

  async deletePrice(id: string): Promise<void> {
    const deleted = await this.db.delete(priceItem).where(eq(priceItem.id, id)).returning({ id: priceItem.id });
    if (!deleted.length) throw new NotFoundException('价格条目不存在');
  }

  // ---------- 收款信息 ----------

  payment(): Promise<PaymentSettings> {
    return this.settings.get(PAYMENT_KEY, paymentSettingsSchema, EMPTY_PAYMENT_SETTINGS);
  }

  async savePayment(actorId: string, dto: PaymentSettings): Promise<PaymentSettings> {
    await this.settings.set(PAYMENT_KEY, dto, actorId);
    this.logger.log(`收款信息已更新 by=${actorId}`);
    return dto;
  }
}
