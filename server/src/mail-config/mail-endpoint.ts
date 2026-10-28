export const IMAP_PORTS = [993] as const;
export const SMTP_PORTS = [465, 587] as const;

export interface MailEndpoints {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

/**
 * 校验邮件服务器主机与端口。主机必须在白名单内——否则任何能改配置的人都能
 * 把主机指向自己的服务器，再点"连接测试"让服务端把授权码发过去。
 * 返回错误文案，合法时返回 null。
 */
export function checkMailEndpoints(e: MailEndpoints, allowlist: string[]): string | null {
  const allowed = new Set(allowlist.map((h) => h.toLowerCase()));
  if (!allowed.has(e.imapHost.toLowerCase())) return `IMAP 服务器 ${e.imapHost} 不在允许列表中`;
  if (!allowed.has(e.smtpHost.toLowerCase())) return `SMTP 服务器 ${e.smtpHost} 不在允许列表中`;
  if (!(IMAP_PORTS as readonly number[]).includes(e.imapPort)) return `IMAP 端口仅支持 ${IMAP_PORTS.join('/')}（SSL）`;
  if (!(SMTP_PORTS as readonly number[]).includes(e.smtpPort)) return `SMTP 端口仅支持 ${SMTP_PORTS.join('/')}`;
  return null;
}

/** 把 IMAP/SMTP 库的报错转成客服看得懂的话；不回显任何凭据 */
export function describeMailError(error: unknown): string {
  const e = error as { authenticationFailed?: boolean; responseCode?: number; code?: string; message?: string };
  if (e?.authenticationFailed || e?.responseCode === 535 || e?.code === 'EAUTH') {
    return '账号或客户端专用密码错误（请确认已在企业邮箱开启 IMAP/SMTP 并使用客户端专用密码）';
  }
  if (e?.code === 'ETIMEDOUT' || e?.code === 'ETIMEOUT') return '连接超时，请检查服务器网络';
  if (e?.code === 'ENOTFOUND') return '无法解析服务器地址';
  if (e?.code === 'ECONNREFUSED') return '服务器拒绝连接，请检查端口';
  return e?.message ? String(e.message).slice(0, 200) : '未知错误';
}
