import { describe, expect, it } from 'vitest';
import { saveMailAccountSchema } from '@aftersell/shared';
import { checkMailEndpoints, describeMailError } from './mail-endpoint';

const allow = ['imap.exmail.qq.com', 'smtp.exmail.qq.com'];
const ok = { imapHost: 'imap.exmail.qq.com', imapPort: 993, smtpHost: 'smtp.exmail.qq.com', smtpPort: 465 };

describe('checkMailEndpoints', () => {
  it('白名单内主机 + SSL 端口通过', () => {
    expect(checkMailEndpoints(ok, allow)).toBeNull();
    expect(checkMailEndpoints({ ...ok, imapHost: 'IMAP.exmail.qq.com' }, allow)).toBeNull();
  });

  it('拒绝白名单外的主机（防止把授权码发到攻击者服务器）', () => {
    expect(checkMailEndpoints({ ...ok, imapHost: 'evil.example.com' }, allow)).toMatch(/IMAP/);
    expect(checkMailEndpoints({ ...ok, smtpHost: 'smtp.exmail.qq.com.evil.com' }, allow)).toMatch(/SMTP/);
  });

  it('拒绝非 SSL 端口', () => {
    expect(checkMailEndpoints({ ...ok, imapPort: 143 }, allow)).toMatch(/端口/);
    expect(checkMailEndpoints({ ...ok, smtpPort: 25 }, allow)).toMatch(/端口/);
  });
});

describe('describeMailError', () => {
  it('认证失败给出可操作的提示', () => {
    expect(describeMailError({ authenticationFailed: true })).toMatch(/客户端专用密码/);
    expect(describeMailError({ code: 'EAUTH' })).toMatch(/客户端专用密码/);
  });
});

describe('saveMailAccountSchema', () => {
  const base = {
    emailAddress: ' Test@Example.com ',
    ...ok,
    syncEnabled: false,
    keepUnread: true,
    hotlineOnly: false,
    registrationOnly: false,
    firstContactOnly: false,
    maxPerRun: 20,
    syncIntervalMinutes: 5,
    syncDateFrom: null,
    syncDateTo: null,
  };

  it('规范化邮箱地址', () => {
    expect(saveMailAccountSchema.parse(base).emailAddress).toBe('test@example.com');
  });

  it('拒绝未知字段和越界值', () => {
    expect(saveMailAccountSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(saveMailAccountSchema.safeParse({ ...base, maxPerRun: 101 }).success).toBe(false);
  });

  it('拒绝开始日期晚于结束日期', () => {
    const r = saveMailAccountSchema.safeParse({ ...base, syncDateFrom: '2026-10-02', syncDateTo: '2026-10-01' });
    expect(r.success).toBe(false);
  });
});
