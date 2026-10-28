import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { Public } from '../auth/decorators';
import { PG_POOL } from '../db/db.module';
import { REDIS } from './redis.module';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Public()
  @Get()
  async check(): Promise<{ db: 'ok'; redis: 'ok' }> {
    try {
      await this.pool.query('select 1');
      if (this.redis.status === 'wait') await this.redis.connect();
      await this.redis.ping();
      return { db: 'ok', redis: 'ok' };
    } catch (error) {
      throw new ServiceUnavailableException(error instanceof Error ? error.message : '依赖服务不可用');
    }
  }
}
