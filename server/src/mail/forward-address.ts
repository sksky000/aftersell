/**
 * 转发头里的客户地址找回。
 *
 * Foxmail 等客户端转发时，转发头写成 <a href="mailto:客户地址">客户昵称</a>：
 * 邮件的纯文本部分只剩“From: 昵称”，地址只在 HTML 的链接里。
 * 入库时从 HTML 把地址补回纯文本的 From 行，后续的客户识别、案件归组、回复收件人都不用改。
 */

const EMAIL = '[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}';
const EMAIL_RE = new RegExp(`^${EMAIL}$`, 'i');
/** 纯文本里的转发 From 行（行首容忍 > 引用前缀） */
const TEXT_FROM_LINE_RE = /^([ \t>]*(?:from|发件人)[ \t]*[:：][ \t]*)(.*)$/gim;
/** HTML 转成文本后的 From 行：名字 + <地址> */
const HTML_FROM_RE = new RegExp(`(?:^|[\\s>])(?:from|发件人)\\s*[:：]\\s*"?([^"<>\\n]*?)"?\\s*<(${EMAIL})>`, 'gim');

const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#34;': '"' };

function decodeEntities(text: string): string {
  return text.replace(/&(?:nbsp|lt|gt|quot|#39|#34);/g, (m) => ENTITIES[m] ?? m).replace(/&amp;/g, '&');
}

/**
 * HTML → 纯文本，mailto 链接写成“名称 <地址>”，块级标签换行。
 * 也用作没有纯文本部分时的正文。
 */
export function htmlToPlainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<a\b[^>]*?href\s*=\s*["']mailto:([^"'?]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, addr: string, label: string) => {
        const name = decodeEntities(label.replace(/<[^>]*>/g, '')).trim();
        const email = decodeURIComponent(addr).trim();
        return !name || name.toLowerCase() === email.toLowerCase() ? `&lt;${email}&gt;` : `${label} &lt;${email}&gt;`;
      })
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:div|p|li|tr|h[1-6]|blockquote)>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const normName = (s: string) => s.replace(/["'“”;；,，]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** 把纯文本里缺地址的转发 From 行补上 HTML 里的地址；找不到对应关系的保持原样 */
export function restoreForwardedAddresses(text: string, html: string | null): string {
  if (!html || !/mailto:/i.test(html)) return text;
  const lines = [...text.matchAll(TEXT_FROM_LINE_RE)].filter((m) => !m[2].includes('@'));
  if (!lines.length) return text;

  const candidates = [...htmlToPlainText(html).matchAll(HTML_FROM_RE)]
    .map((m) => ({ name: m[1].trim(), email: m[2].toLowerCase() }))
    .filter((c) => EMAIL_RE.test(c.email));
  if (!candidates.length) return text;

  const used = new Set<number>();
  const pick = (name: string, index: number): { name: string; email: string } | null => {
    const n = normName(name);
    // 先按昵称对应；对不上时按出现顺序（第 k 个缺地址的 From 行 ↔ HTML 里第 k 个 From）
    let i = n ? candidates.findIndex((c, k) => !used.has(k) && normName(c.name) === n) : -1;
    if (i < 0 && !used.has(index) && index < candidates.length) i = index;
    if (i < 0) return null;
    used.add(i);
    return candidates[i];
  };

  let k = 0;
  return text.replace(TEXT_FROM_LINE_RE, (line, prefix: string, rest: string) => {
    if (rest.includes('@')) return line;
    const name = rest.replace(/[;；]\s*$/, '').trim();
    const found = pick(name, k++);
    if (!found) return line;
    const display = name.replace(/^"|"$/g, '') || found.name;
    return `${prefix}${display ? `"${display}" ` : ''}<${found.email}>`;
  });
}
