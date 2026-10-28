const QUOTE_BLOCK_PATTERNS: RegExp[] = [
  /-{3,}\s*original(?:\s+message)?\s*-{3,}/i,
  /^on .+ wrote:\s*$/im,
  /^在 .{1,80}写道[：:]\s*$/m,
  /^gönderen\s*:/im,
];

const FOLLOW_UP_SUBJECT_RE = /^\s*(?:re|ynt)\s*:/i;

export function isFollowUpSubject(subject: string | null): boolean {
  return subject !== null && FOLLOW_UP_SUBJECT_RE.test(subject);
}

export function isFollowUpEmail(subject: string | null, bodyText: string): boolean {
  if (isFollowUpSubject(subject)) return true;
  if (!bodyText) return false;
  return QUOTE_BLOCK_PATTERNS.some((pattern: RegExp) => pattern.test(bodyText));
}
