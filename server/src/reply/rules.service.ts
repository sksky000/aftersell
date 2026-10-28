import { Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { RuleDto, UpdateRuleRequest } from '@aftersell/shared';
import { DB, type Database } from '../db/db.module';
import { rule, type RuleRow } from '../db/schema';
import type { EngineRule } from './rule-engine';
import { RULE_SEED } from './rules.seed';

export function toRuleDto(row: RuleRow): RuleDto {
  return {
    key: row.key,
    description: row.description,
    slot: row.slot,
    priority: row.priority,
    exclusive: row.exclusive,
    when: row.when ?? null,
    text: row.text,
    source: row.source,
    enabled: row.enabled,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class RulesService implements OnModuleInit {
  private readonly logger = new Logger(RulesService.name);
  private cache: EngineRule[] | null = null;

  constructor(@Inject(DB) private readonly db: Database) {}

  /** 只插入库里还没有的 key：设置页对已有规则的修改不会被覆盖 */
  async onModuleInit(): Promise<void> {
    const inserted = await this.db
      .insert(rule)
      .values(RULE_SEED.map((r) => ({ ...r, exclusive: r.exclusive ?? false, when: r.when ?? null })))
      .onConflictDoNothing()
      .returning({ key: rule.key });
    if (inserted.length) this.logger.log(`新增规则 ${inserted.length} 条`);
  }

  async engineRules(): Promise<EngineRule[]> {
    if (!this.cache) {
      const rows = await this.db.select().from(rule);
      this.cache = rows.map(({ key, slot, priority, exclusive, when, text, enabled }) => ({ key, slot, priority, exclusive, when, text, enabled }));
    }
    return this.cache;
  }

  async list(): Promise<RuleDto[]> {
    const rows = await this.db.select().from(rule).orderBy(asc(rule.slot), asc(rule.key));
    return rows.map(toRuleDto);
  }

  async update(actorId: string, key: string, patch: UpdateRuleRequest): Promise<RuleDto> {
    const [row] = await this.db
      .update(rule)
      .set({ ...patch, updatedBy: actorId, updatedAt: new Date() })
      .where(eq(rule.key, key))
      .returning();
    if (!row) throw new NotFoundException('规则不存在');
    this.cache = null;
    this.logger.log(`规则 ${key} 已修改 by=${actorId} ${Object.keys(patch).join(',')}`);
    return toRuleDto(row);
  }

  async descriptions(): Promise<Map<string, string>> {
    const rows = await this.db.select({ key: rule.key, description: rule.description }).from(rule);
    return new Map(rows.map((r) => [r.key, r.description]));
  }
}
