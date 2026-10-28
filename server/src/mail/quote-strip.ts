const QUOTE_HEAD_PATTERNS: RegExp[] = [
  /^on .{1,150}(?:\s*\n.{0,150})?\s*wrote:\s*$/im,
  /-{3,}\s*original(?:\s+message)?\s*-{3,}/i,
  /^在 .{1,80}写道[：:]\s*$/m,
  /^gönderen\s*:/im,
  /^-{5,}\s*forwarded message\s*-{5,}\s*$/im,
];

const HTML_ENTITY_MAP: Record<string, string> = {
  '&nbsp;': ' ',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

function decodeHtmlEntities(text: string): string {
  let out = text;
  for (const [entity, char] of Object.entries(HTML_ENTITY_MAP)) {
    out = out.split(entity).join(char);
  }
  return out.split('&amp;').join('&');
}

export function repairDegradedEmailText(text: string | null | undefined): string {
  if (!text) return '';
  let out = decodeHtmlEntities(text);
  out = out.replace(
    /([^\n])[ \t]+(?=on (?:[a-z]{3,9},[ \t]+)?[a-z]{3,9}[ \t]+\d{1,2},[ \t]*\d{4}.{0,150}?wrote:)/gi,
    '$1\n\n',
  );
  out = out.replace(
    /(on (?:[a-z]{3,9},[ \t]+)?[a-z]{3,9}[ \t]+\d{1,2},[ \t]*\d{4}.{0,150}?wrote:)[ \t]+(?=\S)/gi,
    '$1\n',
  );
  out = out.replace(
    /([^\n])[ \t]+(?=(-{3,}[ \t]*(?:original|forwarded)(?:\s+message)?[ \t]*-{3,}))/gi,
    '$1\n\n',
  );
  out = out.replace(/[ \t]*\n[ \t]*\n[ \t]*\n+/g, '\n\n');
  return out;
}

export function stripQuotedHistory(text: string | null | undefined): string {
  if (!text) return '';
  const normalized = repairDegradedEmailText(text);
  let earliest = normalized.length;
  for (const pattern of QUOTE_HEAD_PATTERNS) {
    const match = normalized.match(pattern);
    if (match && match.index !== undefined && match.index < earliest) {
      earliest = match.index;
    }
  }
  if (earliest >= normalized.length) return normalized.trim();
  const stripped = normalized.slice(0, earliest).replace(/\s+$/, '').trim();
  return stripped.length > 0 ? stripped : normalized.trim();
}
