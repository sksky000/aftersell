export interface KnownCustomerInfo {
  name: string | null;
  phone: string | null;
  address: string | null;
}

const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS',
  'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
  'WI', 'WY', 'DC', 'PR', 'VI', 'GU', 'AA', 'AE', 'AP',
]);

const STREET_WORD = "[A-Za-z0-9.'\\u2011-]+";

// 门牌号/PO Box 开头 + 街道词组(同行) + 跨行分隔 + 城市(1-3词) + 州(2字母) + 5位邮编
const ADDRESS_RE = new RegExp(
  `\\b(\\d{1,5}[A-Za-z]?(?:[ \\t]+${STREET_WORD}){0,5}|P\\.?[ \\t]*O\\.?[ \\t]*Box[ \\t]+\\d+)[\\s,]+` +
    `([A-Za-z][A-Za-z.'\\u2011-]*(?:[ \\t]+[A-Za-z][A-Za-z.'\\u2011-]*){0,2})[\\s,]*` +
    `([A-Za-z]{2})\\b[ \\t]+(\\d{5})(?:-\\d{4})?\\b`,
  'gi',
);

const US_PHONE_RE = /(?<![\d+])\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?!\d)/;
const PHONE_LINE_RE = /^\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})$/;
const NAME_LINE_RE = /^[A-Z][a-z.'-]+(?:\s+[A-Z][A-Za-z.'-]*){0,3}$/;

const PHONE_EXPLICIT_RE =
  /(?:my|our)\s+(?:phone\s+)?number\s+(?:is|:)[^A-Za-z0-9]{0,12}/i;
const PHONE_CALLME_RE = /call\s+(?:me|us)\s+(?:at|on)[^A-Za-z0-9]{0,12}/i;
const PHONE_LABEL_RE = /(?:phone|mobile|cell)\s*(?:number)?\s*[:#]?\s*/i;
const NAME_EXPLICIT_LOCATE_RE = /(?:my|our)\s+name\s+is\s+/i;
const NAME_STRICT_RE = /^([A-Z][a-z.'-]+(?:\s+[A-Z][a-z.'-]+){0,3})/;

const NAME_ON_ADDRESS_LINE_RE =
  /^(?!P\.?\s*O\.?\s*Box\b)([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2})\s+\d{1,5}[A-Za-z]?\b/;

function stripQuotePrefix(line: string): string {
  return line.replace(/^(?:\s*>)+\s*/, '').trim();
}

function formatPhone(m: RegExpMatchArray): string {
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function looksLikeNameLine(line: string): boolean {
  const trimmed = line.trim().replace(/,.*$/, '');
  if (trimmed.length < 3 || trimmed.length > 40) return false;
  if (/\d/.test(trimmed)) return false;
  if (/\b(DDS|MD|Jr|Sr|Mr|Mrs|Ms|Dr|PhD|support|team|iphone|sent)\b/i.test(trimmed)) return false;
  return NAME_LINE_RE.test(trimmed);
}

export function extractKnownCustomerInfo(
  text: string,
  fromAddress?: string | null,
): KnownCustomerInfo | null {
  if (!text) return null;
  const strippedLines = text.split('\n').map(stripQuotePrefix);

  let address: string | null = null;
  let addressLineIdx = -1;
  let addressEndLineIdx = -1;
  const joined = strippedLines.join('\n');
  ADDRESS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ADDRESS_RE.exec(joined)) !== null) {
    const state = (m[3] ?? '').toUpperCase();
    if (!US_STATE_CODES.has(state)) continue;
    address = m[0].replace(/\s+/g, ' ').trim();
    addressLineIdx = joined.slice(0, m.index).split('\n').length - 1;
    addressEndLineIdx = joined.slice(0, m.index + m[0].length).split('\n').length - 1;
    break;
  }

  let phone: string | null = null;
  let phoneLineIdx = -1;
  for (let i = 0; i < strippedLines.length; i += 1) {
    const line = strippedLines[i];
    const explicit = line.match(PHONE_EXPLICIT_RE) ?? line.match(PHONE_CALLME_RE) ?? line.match(PHONE_LABEL_RE);
    if (!explicit) continue;
    const rest = line.slice((explicit.index ?? 0) + explicit[0].length);
    const hit = rest.match(US_PHONE_RE);
    if (hit) {
      phone = hit[0].replace(/[^\d]/g, '').replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
      phoneLineIdx = i;
      break;
    }
  }
  if (!phone && addressLineIdx >= 0) {
    for (let i = Math.max(0, addressLineIdx - 3); i < addressLineIdx; i += 1) {
      const hit = strippedLines[i].match(PHONE_LINE_RE);
      if (hit) {
        phone = formatPhone(hit);
        phoneLineIdx = i;
        break;
      }
    }
  }
  if (!phone && addressLineIdx >= 0) {
    for (let i = addressLineIdx + 1; i < Math.min(strippedLines.length, addressLineIdx + 3); i += 1) {
      const hit = strippedLines[i].match(PHONE_LINE_RE);
      if (hit) {
        phone = formatPhone(hit);
        phoneLineIdx = i;
        break;
      }
    }
  }

  let name: string | null = null;
  for (let i = 0; i < strippedLines.length; i += 1) {
    const located = strippedLines[i].match(NAME_EXPLICIT_LOCATE_RE);
    if (!located) continue;
    const rest = strippedLines[i].slice((located.index ?? 0) + located[0].length);
    const hit = rest.match(NAME_STRICT_RE);
    if (hit) {
      let candidate = hit[1];
      if (candidate.includes('. ')) candidate = candidate.slice(0, candidate.indexOf('. '));
      name = candidate.replace(/\.+$/, '').trim();
      break;
    }
  }
  if (!name && addressLineIdx >= 0) {
    const head = strippedLines[addressLineIdx].match(NAME_ON_ADDRESS_LINE_RE);
    if (head && looksLikeNameLine(head[1])) {
      name = head[1].trim();
    }
  }
  if (!name) {
    const nameScanEnd = phoneLineIdx >= 0 ? phoneLineIdx : addressLineIdx;
    if (nameScanEnd >= 0) {
      const emailStem = ((fromAddress ?? '').split('@')[0] ?? '')
        .toLowerCase()
        .split(/[._-]+/)[0];
      for (let pass = 0; pass < 2 && !name; pass += 1) {
        const scanFrom = pass === 0 ? 5 : 3;
        for (let i = nameScanEnd - 1; i >= Math.max(0, nameScanEnd - scanFrom); i -= 1) {
          if (i >= addressLineIdx && i <= addressEndLineIdx) continue;
          const candidate = strippedLines[i].split(/\s{2,}|\t/)[0];
          if (!candidate.trim()) continue;
          const words = candidate.toLowerCase().split(/\s+/);
          const looksLikeSelf =
            emailStem.length >= 5
            && words.some(
              (w: string) =>
                w === emailStem
                || (emailStem.startsWith(w) && w.length >= 5)
                || w.startsWith(emailStem),
            );
          if (pass === 0 && looksLikeSelf) continue;
          if (looksLikeNameLine(candidate)) {
            name = candidate.trim().replace(/,.*$/, '');
            break;
          }
        }
      }
    }
  }

  if (!name && !phone && !address) return null;
  return { name, phone, address };
}

export function formatKnownCustomerInfo(info: KnownCustomerInfo): string {
  const lines: string[] = [
    'Known customer information (already provided in earlier correspondence — do NOT ask the customer to re-send it):',
  ];
  if (info.name) lines.push(`- Name: ${info.name}`);
  if (info.phone) lines.push(`- Phone: ${info.phone}`);
  if (info.address) lines.push(`- Delivery address: ${info.address}`);
  lines.push('Use these details internally. Ask only a missing or conflicting field when shipping actually requires it. Never repeat the customer profile in the reply body or signature; never append customer name, phone or address to the closing. Never use "We have your details on file as:" or similar wording. The only agent signature is the fixed three-line closing. When the next step is shipping and the full delivery information is known, write "Please confirm whether the shipping address below is correct." and do NOT write the details yourself — the system appends them below that sentence.');
  return lines.join('\n');
}
