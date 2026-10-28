import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
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
      // 迁移放在工厂里：任何拿到 DB 的模块（包括启动即跑的队列）都在迁移完成之后才初始化
      useFactory: async (pool: Pool): Promise<Database> => {
        const db = drizzle(pool, { schema });
        // dist/db/db.module.js → server/drizzle
        await migrate(db, { migrationsFolder: path.resolve(__dirname, '../../drizzle') });
        new Logger('DbModule').log('数据库迁移已完成');
        return db;
      },
    },
  ],
  exports: [DB, PG_POOL],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
