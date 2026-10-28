import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { AdjudicationFact, CreateAdjudicationRequest, CustomerAdjudicationDto } from '@aftersell/shared';
import { DB, type Database } from '../db/db.module';
import { customerAdjudication, type CustomerAdjudicationRow } from '../db/schema';
import { customerIdentity, type CaseMessage } from '../mail/case-association';

export function toAdjudicationDto(row: CustomerAdjudicationRow): CustomerAdjudicationDto {
  return {
    id: row.id,
    customerEmail: row.customerEmail,
    factType: row.factType,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 能用于裁决的客户邮箱；热线工单只有姓名电话、解析不出邮箱时为 null */
export function adjudicationKey(row: CaseMessage): string | null {
  const id = customerIdentity(row);
  return id && !id.startsWith('hotline:') && id.includes('@') ? id : null;
}

@Injectable()
export class AdjudicationService {
  private readonly logger = new Logger(AdjudicationService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async listFor(customerEmail: string | null): Promise<CustomerAdjudicationDto[]> {
    if (!customerEmail) return [];
    const rows = await this.db
      .select()
      .from(customerAdjudication)
      .where(sql`lower(${customerAdjudication.customerEmail}) = ${customerEmail.toLowerCase()}`)
      .orderBy(desc(customerAdjudication.createdAt));
    return rows.map(toAdjudicationDto);
  }

  async has(customerEmail: string | null, fact: AdjudicationFact): Promise<boolean> {
    if (!customerEmail) return false;
    const [row] = await this.db
      .select({ id: customerAdjudication.id })
      .from(customerAdjudication)
      .where(and(sql`lower(${customerAdjudication.customerEmail}) = ${customerEmail.toLowerCase()}`, eq(customerAdjudication.factType, fact)))
      .limit(1);
    return Boolean(row);
  }

  async create(actorId: string, dto: CreateAdjudicationRequest): Promise<void> {
    await this.db
      .insert(customerAdjudication)
      .values({ customerEmail: dto.customerEmail, factType: dto.factType, note: dto.note || null, createdBy: actorId })
      .onConflictDoNothing();
    this.logger.log(`客户裁决已添加 by=${actorId} fact=${dto.factType}`);
  }

  async remove(actorId: string, id: string): Promise<void> {
    const deleted = await this.db.delete(customerAdjudication).where(eq(customerAdjudication.id, id)).returning({ id: customerAdjudication.id });
    if (!deleted.length) throw new NotFoundException('裁决不存在');
    this.logger.log(`客户裁决已删除 by=${actorId} id=${id}`);
  }
}
