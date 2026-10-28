import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { ZodType } from 'zod';
import { DB, type Database } from '../db/db.module';
import { setting } from '../db/schema';

/** setting 表的读写；值按 zod schema 校验，库里存了非法值时回退默认值 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async get<T>(key: string, schema: ZodType<T, any, any>, fallback: T): Promise<T> {
    const [row] = await this.db.select({ value: setting.value }).from(setting).where(eq(setting.key, key)).limit(1);
    if (!row) return fallback;
    const parsed = schema.safeParse(row.value);
    if (!parsed.success) {
      this.logger.warn(`配置项 ${key} 的值不合法，使用默认值`);
      return fallback;
    }
    return parsed.data;
  }

  async set(key: string, value: unknown, actorId: string | null): Promise<void> {
    await this.db
      .insert(setting)
      .values({ key, value, updatedBy: actorId })
      .onConflictDoUpdate({ target: setting.key, set: { value, updatedBy: actorId, updatedAt: new Date() } });
  }
}
