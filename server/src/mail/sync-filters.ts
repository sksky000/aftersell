import { isDepothelpSender } from './depothelp';
import { isFollowUpEmail, isFollowUpSubject } from './follow-up-filter';
import { isLeaderForward } from './leader-forward';

/** 看板上的三组拉取开关 */
export interface SyncFilters {
  hotlineOnly: boolean;
  registrationOnly: boolean;
  firstContactOnly: boolean;
}

const REGISTRATION_SUBJECT_RE = /registr/i;

export function isRegistrationSubject(subject: string | null): boolean {
  return subject !== null && REGISTRATION_SUBJECT_RE.test(subject);
}

export function hasActiveFilter(f: SyncFilters): boolean {
  return f.hotlineOnly || f.registrationOnly || f.firstContactOnly;
}

/** 热线工单与注册邮件取并集；两者都未开启时不按发件人 / 主题过滤 */
function senderSubjectAllowed(f: SyncFilters, from: string | null, subject: string | null): boolean {
  if (!f.hotlineOnly && !f.registrationOnly) return true;
  return (
    (f.hotlineOnly && (isDepothelpSender(from) || isLeaderForward(from))) ||
    (f.registrationOnly && isRegistrationSubject(subject))
  );
}

/**
 * 邮件头阶段的轻量筛选：不符合的邮件不占单次拉取名额。
 * 仅首次来信为叠加维度（取交集），跟进主题在此阶段即排除。
 */
export function passesHeaderFilter(f: SyncFilters, from: string | null, subject: string | null): boolean {
  return senderSubjectAllowed(f, from, subject) && (!f.firstContactOnly || !isFollowUpSubject(subject));
}

/** 取回正文后的最终筛选：首次来信模式还要排除正文带引用块的跟进件 */
export function passesMessageFilter(
  f: SyncFilters,
  from: string | null,
  subject: string | null,
  bodyText: string,
): boolean {
  return senderSubjectAllowed(f, from, subject) && (!f.firstContactOnly || !isFollowUpEmail(subject, bodyText));
}

export function describeFilters(f: SyncFilters): string {
  const parts: string[] = [];
  if (f.hotlineOnly) parts.push('热线工单');
  if (f.registrationOnly) parts.push('注册邮件');
  if (f.firstContactOnly) parts.push('首次来信');
  return parts.join('+');
}
