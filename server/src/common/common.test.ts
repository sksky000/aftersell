import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LoginThrottle } from './login-throttle';
import { hashPassword, verifyPassword } from './password';
import { SecretBox } from './secret-box';

describe('SecretBox', () => {
  const box = new SecretBox(randomBytes(32).toString('base64'));

  it('加密后能还原，且每次密文不同', () => {
    const a = box.encrypt('client-code-123');
    const b = box.encrypt('client-code-123');
    expect(a).not.toBe(b);
    expect(a).not.toContain('client-code-123');
    expect(box.decrypt(a)).toBe('client-code-123');
  });

  it('密文被篡改时解密失败', () => {
    const parts = box.encrypt('secret').split('.');
    const tampered = Buffer.from(parts[3], 'base64url');
    tampered[0] ^= 0xff;
    parts[3] = tampered.toString('base64url');
    expect(() => box.decrypt(parts.join('.'))).toThrow();
  });

  it('换密钥后无法解密', () => {
    const other = new SecretBox(randomBytes(32).toString('base64'));
    expect(() => other.decrypt(box.encrypt('secret'))).toThrow();
  });

  it('拒绝长度不对的密钥', () => {
    expect(() => new SecretBox(randomBytes(16).toString('base64'))).toThrow();
  });
});

describe('password', () => {
  it('正确密码通过、错误密码不通过', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('wrong password!!', hash)).toBe(false);
  });

  it('格式不对的哈希返回 false 而不是抛错', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
  });
});

describe('LoginThrottle', () => {
  it('窗口内失败超过上限即锁定，窗口过后解锁', () => {
    let t = 0;
    const th = new LoginThrottle(3, 1000, () => t);
    th.recordFailure('k');
    th.recordFailure('k');
    expect(th.lockedFor('k')).toBe(0);
    th.recordFailure('k');
    expect(th.lockedFor('k')).toBe(1);
    t = 1000;
    expect(th.lockedFor('k')).toBe(0);
  });

  it('登录成功后清零', () => {
    const th = new LoginThrottle(2, 1000, () => 0);
    th.recordFailure('k');
    th.reset('k');
    th.recordFailure('k');
    expect(th.lockedFor('k')).toBe(0);
  });
});
