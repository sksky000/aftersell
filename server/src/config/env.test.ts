import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hasRole } from '@aftersell/shared';
import { loadEnv } from './env';

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(32),
  MAIL_SECRET_KEY: randomBytes(32).toString('base64'),
};

describe('loadEnv', () => {
  it('合法配置通过，COOKIE_SECURE 默认 true', () => {
    expect(loadEnv(valid).COOKIE_SECURE).toBe(true);
  });

  it('缺密钥或密钥太短时启动失败', () => {
    expect(() => loadEnv({ ...valid, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(() => loadEnv({ ...valid, MAIL_SECRET_KEY: 'abc' })).toThrow(/MAIL_SECRET_KEY/);
    const { MAIL_SECRET_KEY: _, ...missing } = valid;
    expect(() => loadEnv(missing)).toThrow(/MAIL_SECRET_KEY/);
  });
});

describe('hasRole', () => {
  it('高等级角色满足低等级要求', () => {
    expect(hasRole('admin', 'supervisor')).toBe(true);
    expect(hasRole('supervisor', 'supervisor')).toBe(true);
    expect(hasRole('agent', 'supervisor')).toBe(false);
  });
});
