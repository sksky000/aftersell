import { Global, Inject, Logger, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import * as path from 'node:path';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { env } from '../config/env';
import * as schema from './schema';

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');
export type Database = NodePgDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => new Pool({ connectionString: env().DATABASE_URL, max: 10 }),
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Database => drizzle(pool, { schema }),
    },
  ],
  exports: [DB, PG_POOL],
})
export class DbModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DbModule.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  async onModuleInit(): Promise<void> {
    // dist/db/db.module.js → server/drizzle
    const migrationsFolder = path.resolve(__dirname, '../../drizzle');
    await migrate(this.db, { migrationsFolder });
    this.logger.log('数据库迁移已完成');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
