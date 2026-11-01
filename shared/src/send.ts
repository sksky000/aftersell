import { z } from 'zod';

/** 单封回复最多附件数与单个文件上限（与妙搭版一致） */
export const MAX_REPLY_ATTACHMENTS = 5;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** 正文内嵌图片单张上限 */
export const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_SUBJECT_LENGTH = 200;

/** 客服上传的文件（正文粘贴的图片、回复附件），内容进 Storage，按 id 引用 */
export interface UploadDto {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

/** 正文 HTML 里引用上传图片的地址；发送时替换成 cid: 内嵌 */
export const uploadUrl = (id: string) => `/api/uploads/${id}`;

const content = z.string().trim().min(1, '回复内容不能为空').max(20000, '回复内容过长');
const html = z.string().max(500_000, '回复内容过长').nullable();
const attachmentIds = z.array(z.string().uuid()).max(MAX_REPLY_ATTACHMENTS, `最多 ${MAX_REPLY_ATTACHMENTS} 个附件`).default([]);

/** 保存编辑中的回复（不发送） */
export const saveReplySchema = z.object({ content: z.string().max(20000, '回复内容过长'), html, attachmentIds }).strict();
export type SaveReplyRequest = z.input<typeof saveReplySchema>;

export const previewSubjectSchema = z.object({ content }).strict();
export type PreviewSubjectRequest = z.infer<typeof previewSubjectSchema>;
export interface PreviewSubjectResponse {
  subject: string;
  /** false：主题标签生成失败，用的是 Re: 原主题 */
  generated: boolean;
}

export const sendReplySchema = z
  .object({
    content,
    html,
    subject: z.string().trim().min(1, '主题不能为空').max(MAX_SUBJECT_LENGTH, `主题不超过 ${MAX_SUBJECT_LENGTH} 字`),
    attachmentIds,
    /** 打开发送确认框时生成；同一个 key 重复提交只发一封 */
    idempotencyKey: z.string().uuid(),
  })
  .strict();
export type SendReplyRequest = z.input<typeof sendReplySchema>;

/** 发送前给确认框看的：实际收件人，以及为什么是他 */
export interface ReplyTargetDto {
  to: string | null;
  /** direct / hotline / leader_forward */
  via: 'direct' | 'hotline' | 'leader_forward';
  /** 找不到收件人或被白名单拦下时的说明 */
  blockedReason: string | null;
}

export interface SentReplyDto {
  replyId: string;
  to: string;
  subject: string;
  sentAt: string;
  /** true：这个 idempotencyKey 之前已经发过，本次没有重复发送 */
  duplicate: boolean;
}

/** 经 ZodBody 解析后的请求（默认值已补齐） */
export type ParsedSaveReply = z.output<typeof saveReplySchema>;
export type ParsedSendReply = z.output<typeof sendReplySchema>;
