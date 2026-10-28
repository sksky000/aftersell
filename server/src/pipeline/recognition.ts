import sharp from 'sharp';
import type { ImageInput } from '../llm/provider';
import type { AttachmentRecognitionRow } from '../db/schema';

export const MAX_IMAGES_PER_EMAIL = 5;
export const MAX_PDFS_PER_EMAIL = 3;
export const MAX_RECOGNITION_ATTEMPTS = 3;
export const RECOGNITION_RETRY_MS = 60_000;
export const MAX_PDF_TEXT_LENGTH = 4000;
const MAX_IMAGE_EDGE = 1568;

/** 失败 / 未识别原因 code → 界面文案 */
export const RECOGNITION_REASON_LABELS: Record<string, string> = {
  interrupted: '识别被中断，稍后自动重试',
  vision_not_configured: '未配置识图模型（设置 → 模型）',
  model_failed: '识图模型调用失败',
  empty_result: '模型没有返回内容',
  unreadable_image: '图片无法解码（如 HEIC 格式），请人工查看',
  no_text_layer: 'PDF 没有页面内容，请人工查看',
  pdf_failed: 'PDF 解析失败，请人工查看',
  video_manual_review: '视频暂不支持识别，请人工查看',
  limit_exceeded: '超出单封识别数量上限，请人工查看',
  unsupported_type: '该类型文件不做识别',
};

export type RecognitionKind = 'image' | 'pdf';
export type RecognitionPlanItem = { kind: RecognitionKind } | { skip: string };

/** 按邮件中的顺序决定每个附件识别与否：图片最多 5 张、PDF 最多 3 份，视频人工看 */
export function planRecognition(attachments: { contentType: string }[]): RecognitionPlanItem[] {
  let images = 0;
  let pdfs = 0;
  return attachments.map((a) => {
    if (a.contentType.startsWith('video/')) return { skip: 'video_manual_review' };
    if (a.contentType === 'application/pdf') return pdfs++ < MAX_PDFS_PER_EMAIL ? { kind: 'pdf' } : { skip: 'limit_exceeded' };
    if (a.contentType.startsWith('image/')) return images++ < MAX_IMAGES_PER_EMAIL ? { kind: 'image' } : { skip: 'limit_exceeded' };
    return { skip: 'unsupported_type' };
  });
}

/** 先记尝试再调用：失败最多 3 次、间隔至少 1 分钟；“未配置识图模型”不计次数，配好后会重试 */
export function canAttempt(row: AttachmentRecognitionRow | undefined, now: number): boolean {
  if (!row) return true;
  if (row.status !== 'failed') return false;
  if (row.reason === 'vision_not_configured') return true;
  return row.attempts < MAX_RECOGNITION_ATTEMPTS && now - row.attemptedAt.getTime() >= RECOGNITION_RETRY_MS;
}

/** 统一转成长边不超过 1568 的 JPEG，控制体积和 token */
export async function prepareImage(content: Buffer): Promise<ImageInput> {
  // 手机照片常带少量损坏数据，浏览器照常显示；只在真正无法解码时失败
  const data = await sharp(content, { animated: false, failOn: 'none' })
    .rotate()
    .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { mediaType: 'image/jpeg', data };
}

export function truncatePdfText(text: string): string {
  const clean = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return clean.length > MAX_PDF_TEXT_LENGTH
    ? `${clean.slice(0, MAX_PDF_TEXT_LENGTH)}\n[Extraction truncated: inspect the original document for missing details.]`
    : clean;
}

const SCANNED_PDF_PAGES = 2;

/**
 * 没有文字层的 PDF（扫描件，或文字被转成曲线的打印件，收据常见）：把前 2 页渲染成图片交给识图。
 * 只取嵌入图片不够——打印件里嵌入的往往只是 logo。
 */
export async function renderPdfPages(content: Buffer): Promise<ImageInput[]> {
  const { getDocumentProxy, renderPageAsImage } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(content));
  const pages: ImageInput[] = [];
  for (let page = 1; page <= Math.min(pdf.numPages, SCANNED_PDF_PAGES); page += 1) {
    const png = await renderPageAsImage(pdf, page, { canvasImport: () => import('@napi-rs/canvas'), width: MAX_IMAGE_EDGE });
    pages.push(await prepareImage(Buffer.from(png)));
  }
  return pages;
}

export function scannedPdfPrompt(base: string, page: number): string {
  return `${base}\n\nThis image is page ${page} of a scanned PDF the customer attached (often a receipt, order details or a form). Transcribe the text that matters for after-sales.`;
}

/** 本地提取 PDF 文字层，不调用模型 */
export async function extractPdfText(content: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(content));
  const { text } = await extractText(pdf, { mergePages: true });
  return truncatePdfText(Array.isArray(text) ? text.join('\n') : text);
}
