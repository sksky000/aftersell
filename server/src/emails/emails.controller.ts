import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import {
  emailListQuerySchema,
  repliedListQuerySchema,
  updateEmailStatusSchema,
  type RepliedListQuery,
  type RepliedListResponse,
  type UpdateEmailStatusRequest,
  type EmailDetailDto,
  type EmailListQuery,
  type EmailListResponse,
  type InboxStatsDto,
  type ThreadItemDto,
} from '@aftersell/shared';
import { CurrentUser, Roles, type AuthUser } from '../auth/decorators';
import { ZodBody, ZodQuery } from '../common/zod-body';
import { EmailsService } from './emails.service';

/** 浏览器可安全内联显示的类型；SVG 可携带脚本，一律作为下载 */
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|bmp|heic|heif)|video\/[\w.+-]+|application\/pdf)$/;

@Controller('emails')
export class EmailsController {
  constructor(private readonly emails: EmailsService) {}

  @Get()
  list(@ZodQuery(emailListQuerySchema) query: EmailListQuery): Promise<EmailListResponse> {
    return this.emails.list(query);
  }

  @Get('stats')
  stats(): Promise<InboxStatsDto> {
    return this.emails.stats();
  }

  @Get('replied')
  replied(@ZodQuery(repliedListQuerySchema) query: RepliedListQuery): Promise<RepliedListResponse> {
    return this.emails.replied(query);
  }

  @Patch(':id/status')
  @HttpCode(204)
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @ZodBody(updateEmailStatusSchema) dto: UpdateEmailStatusRequest): Promise<void> {
    return this.emails.updateStatus(id, dto.status);
  }

  @Roles('supervisor')
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.emails.remove(id, user.id);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<EmailDetailDto> {
    return this.emails.detail(id);
  }

  @Get(':id/thread')
  thread(@Param('id', ParseUUIDPipe) id: string): Promise<ThreadItemDto[]> {
    return this.emails.thread(id);
  }

  @Get(':id/attachments/:attachmentId')
  async attachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.emails.openAttachment(id, attachmentId);
    const inline = INLINE_TYPES.test(file.contentType);
    res.set({
      'Content-Type': inline ? file.contentType : 'application/octet-stream',
      'Content-Length': String(file.size),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      // 内容按 sha256 寻址，不会变
      'Cache-Control': 'private, max-age=86400',
      ...(inline ? {} : { 'Content-Security-Policy': 'sandbox' }),
    });
    return new StreamableFile(file.stream);
  }
}
