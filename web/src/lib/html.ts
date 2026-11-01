import DOMPurify from 'dompurify';

/** 回复正文允许的标签：够写邮件，不留脚本、样式表、表单、iframe */
const ALLOWED_TAGS = ['a', 'b', 'strong', 'i', 'em', 'u', 'br', 'p', 'div', 'span', 'ul', 'ol', 'li', 'img', 'blockquote'];
const ALLOWED_ATTR = ['href', 'src', 'alt', 'title'];

export function sanitizeReplyHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // 图片只能是本系统上传的文件；外链图片发出去会是裂图，也可能泄露客户打开邮件的行为
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/api\/uploads\/)/i,
  });
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function textToHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

/** 编辑器 HTML → 纯文本（发送时的 text/plain 部分、草稿对比都用它） */
export function htmlToText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = sanitizeReplyHtml(html);
  div.querySelectorAll('br').forEach((el) => el.replaceWith('\n'));
  div.querySelectorAll('li').forEach((el) => el.prepend('- '));
  div.querySelectorAll('div, p, li, blockquote').forEach((el) => el.append('\n'));
  return (div.textContent ?? '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
