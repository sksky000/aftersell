import { senderDirectory } from './sender-directory';

export interface ForwardedCustomer {
  name: string | null;
  email: string;
}

export function isLeaderForward(fromAddress: string | null | undefined): boolean {
  if (!fromAddress) return false;
  return senderDirectory().leader.has(fromAddress.trim().toLowerCase());
}

// 转发头 From 行，兼容三种形态（行首容忍 > 引用前缀；标签兼容英文 From 与腾讯中文界面「发件人」）：
// From:  "Display Name"<a@b.com>;  /  From: Display Name <a@b.com>  /  From: a@b.com
const FORWARD_FROM_LINE_RE =
  /^[ \t>]*(?:from|发件人)[ \t]*:[ \t]*"?([^"<>]*?)"?[ \t]*(?:<([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>|([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}))/gim;

export function extractForwardedCustomer(
  bodyText: string | null | undefined,
): ForwardedCustomer | null {
  if (!bodyText) return null;
  for (const match of bodyText.matchAll(FORWARD_FROM_LINE_RE)) {
    const email = (match[2] ?? match[3] ?? '').trim().toLowerCase();
    if (!email || senderDirectory().forwardExcluded.has(email)) continue;
    const name = (match[1] ?? '').trim();
    return { name: name.length > 0 ? name : null, email };
  }
  return null;
}

export function extractForwardedCustomerEmail(
  bodyText: string | null | undefined,
): string | null {
  return extractForwardedCustomer(bodyText)?.email ?? null;
}
