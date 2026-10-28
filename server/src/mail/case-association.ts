import { stripQuotedHistory } from './quote-strip';
import { isDepothelpSender, extractDepothelpCustomerEmail, parseDepothelpSubject, depothelpContactKey } from './depothelp';
import { isLeaderForward, extractForwardedCustomerEmail } from './leader-forward';

export interface CaseMessage {
  messageId: string; fromAddress: string | null; subject: string | null; bodyText: string | null;
  inReplyTo?: string | null; refChain?: string | null;
  receivedAt?: Date | string | null; createdAt?: Date | string; status?: string; caseClosed?: boolean;
}
const NEW_CASE = /\b(?:new|another|different|separate) (?:issue|problem|complaint|case|bike|bicycle)\b/i;
// Whole affirmative statements only: a keyword inside a question is not closure.
const CLOSED_STATEMENT = /^(?:(?:the|my|your|our|this|that) )?(?:(?:battery|charger|motor|controller|brake|tire|tyre|valve|axle|pedal|display|fork) )?(?:issue|problem|case) (?:is |was |has been )?(?:resolved|closed|fixed)(?: now)?$|^everything (?:works|is working) now$/i;
const FOLLOW_UP = /^(?:re|ynt|回复):|\b(?:following up|follow up|still|replacement|tracking|as requested|you (?:asked|requested)|already (?:sent|shipped)|sent (?:it|the battery) back)\b/i;
const PARTS = /\b(battery|charger|motor|controller|brake|tire|tyre|valve|axle|pedal|display|fork)\b/gi;
export function customerIdentity(row: CaseMessage): string | null {
  if (isDepothelpSender(row.fromAddress)) {
    const email = extractDepothelpCustomerEmail(row.bodyText);
    if (email) return email.toLowerCase();
    const contact = parseDepothelpSubject(row.subject);
    return contact ? `hotline:${depothelpContactKey(contact)}` : null;
  }
  if (isLeaderForward(row.fromAddress)) return extractForwardedCustomerEmail(row.bodyText)?.toLowerCase() ?? null;
  return row.fromAddress?.trim().toLowerCase() || null;
}
function ids(value: string | null | undefined): string[] {
  return (value ?? '').toLowerCase().split(/\s+/).map(v => v.replace(/[<>]/g, '')).filter(Boolean);
}
function subject(row: CaseMessage): string {
  if (isDepothelpSender(row.fromAddress)) return ''; // Hotline identity is not a case identifier.
  return (row.subject ?? '').replace(/^(?:(?:re|fw|fwd|ynt|回复|转发):\s*)+/gi, '').trim().toLowerCase();
}
function parts(row: CaseMessage): Set<string> {
  return new Set((stripQuotedHistory(row.bodyText).match(PARTS) ?? []).map(v => v.toLowerCase().replace('tyre', 'tire')));
}
function caseNumbers(row: CaseMessage): string[] {
  return [...`${row.subject ?? ''}\n${stripQuotedHistory(row.bodyText)}`.matchAll(/\b(?:case|ticket)\s*(?:id|number|no\.?)?\s*[:#-]\s*([a-z0-9-]{4,})/gi)].map(m => m[1].toLowerCase());
}
export function hasClosedCaseText(text: string | null): boolean {
  // The prefix keeps quote-only messages from triggering stripQuotedHistory's
  // general-purpose fallback that retains an otherwise empty quoted message.
  const prefix = 'ACTIVE_MESSAGE\n';
  const active = stripQuotedHistory(prefix + (text ?? '')).slice(prefix.trimEnd().length)
    .split('\n').filter(line => !/^\s*[>]/.test(line)).join('\n')
    .replace(/"[^"]*"|“[^”]*”/g, '').trim();
  // Treat the form's answer as evidence, never the question itself. Require an
  // unqualified "Yes"; missing, negative, conditional or contradictory answers
  // remain unknown. Preserve the separator so adjacent fields cannot join.
  const statements = active.replace(/\bis the (?:issue|problem|case) resolved\?[ \t]*(?:\r?\n[ \t]*)?([^.!?;\n|]*)([.!?;\n|]|$)/gi,
    (_field, answer: string, separator: string) => `${/^yes$/i.test(answer.trim()) ? 'The issue is resolved' : ''}${separator}`);
  return (statements.match(/[^.!?;\n|]+[.!?;\n|]*/g) ?? []).some(statement =>
    !statement.includes('?') && CLOSED_STATEMENT.test(statement.replace(/[.!;\n|]+$/g, '').trim().replace(/[ \t]+/g, ' ')));
}

export type CaseRelation = 'same' | 'different' | 'uncertain';
export function caseRelation(current: CaseMessage, prior: CaseMessage): CaseRelation {
  if (!customerIdentity(current) || customerIdentity(current) !== customerIdentity(prior)) return 'different';
  if (current.messageId === prior.messageId) return 'same';
  const now = stripQuotedHistory(current.bodyText);
  if (NEW_CASE.test(now) || prior.caseClosed || hasClosedCaseText(prior.bodyText)) return 'different';
  const a = parts(current), b = parts(prior);
  if (a.size && b.size && ![...a].some(p => b.has(p))) return 'different';
  const orders = (row: CaseMessage): string[] => [...`${row.subject ?? ''} ${stripQuotedHistory(row.bodyText)}`.matchAll(/\border\s*(?:number|no\.?)?\s*[:#]\s*([a-z0-9-]{5,})/gi)].map(m => m[1].toLowerCase());
  const oa = orders(current), ob = orders(prior);
  if (oa.length && ob.length && !oa.some(id => ob.includes(id))) return 'different';
  const ca = caseNumbers(current), cb = caseNumbers(prior);
  if (ca.length && cb.length && !ca.some(id => cb.includes(id))) return 'different';
  // Exact parsed hotline contact conflicts are never repaired by fuzzy names/phones.
  if (isDepothelpSender(current.fromAddress) && isDepothelpSender(prior.fromAddress)) {
    const ac = parseDepothelpSubject(current.subject), bc = parseDepothelpSubject(prior.subject);
    if (ac && bc && depothelpContactKey(ac) !== depothelpContactKey(bc)) return 'uncertain';
  }
  const refs = ids(`${current.inReplyTo ?? ''} ${current.refChain ?? ''}`);
  const reverse = ids(`${prior.inReplyTo ?? ''} ${prior.refChain ?? ''}`);
  if (refs.includes(ids(prior.messageId)[0]) || reverse.includes(ids(current.messageId)[0])) return 'same';
  if (ca.some(id => cb.includes(id))) return 'same';
  if (oa.some(id => ob.includes(id)) && a.size && [...a].some(p => b.has(p))) return 'same';
  const age = Math.abs(new Date(current.receivedAt ?? current.createdAt ?? 0).getTime() - new Date(prior.receivedAt ?? prior.createdAt ?? 0).getTime());
  if (age > 30 * 86400000) return 'uncertain';
  const topic = subject(current);
  if (topic.length > 8 && topic === subject(prior) && FOLLOW_UP.test(`${current.subject ?? ''} ${now}`) && a.size && [...a].some(p => b.has(p))) return 'same';
  if (a.size && b.size && [...a].some(p => b.has(p)) && FOLLOW_UP.test(`${current.subject ?? ''} ${now}`)) return 'uncertain';
  return 'uncertain';
}
/** Never use legacy threadId as proof: older versions grouped every sender for 30 days. */
export function selectCaseMessages<T extends CaseMessage>(current: CaseMessage, candidates: T[]): { rows: T[]; uncertain: number } {
  const rows: T[] = []; let uncertain = 0;
  for (const row of candidates) {
    const relation = caseRelation(current, row);
    if (relation === 'same') rows.push(row);
    if (relation === 'uncertain') uncertain += 1;
  }
  // Follow explicit references across changing subjects, but do not expand fuzzy subject matches.
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of candidates) {
      if (rows.includes(row) || caseRelation(current, row) === 'different') continue;
      const refs = ids(`${row.inReplyTo ?? ''} ${row.refChain ?? ''}`);
      if (rows.some(anchor => (refs.includes(ids(anchor.messageId)[0]) || ids(`${anchor.inReplyTo ?? ''} ${anchor.refChain ?? ''}`).includes(ids(row.messageId)[0])) && caseRelation(anchor, row) === 'same')) {
        rows.push(row); uncertain -= 1; changed = true;
      }
    }
  }
  return { rows, uncertain };

}
