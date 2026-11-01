import { Controller, Get, Param, ParseUUIDPipe, Post, Put, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  MAX_UPLOAD_BYTES,
  previewSubjectSchema,
  saveReplySchema,
  sendReplySchema,
  type DraftDto,
  type ParsedSaveReply,
  type ParsedSendReply,
  type PreviewSubjectRequest,
  type PreviewSubjectResponse,
  type ReplyTargetDto,
  type SentReplyDto,
  type UploadDto,
} from '@aftersell/shared';
import { CurrentUser, type AuthUser } from '../auth/decorators';
import { ZodBody } from '../common/zod-body';
import { SendService, type UploadedFileLike } from './send.service';

/** 只有图片能在浏览器里内联显示；其余一律下载 */
const INLINE_IMAGE = /^image\/(png|jpe?g|gif|webp|bmp)$/;

@Controller()
export class SendController {
  constructor(private readonly send: SendService) {}

  @Get('emails/:id/reply/target')
  target(@Param('id', ParseUUIDPipe) id: string): Promise<ReplyTargetDto> {
    return this.send.target(id);
  }

  @Put('emails/:id/reply')
  save(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZodBody(saveReplySchema) dto: ParsedSaveReply): Promise<DraftDto> {
    return this.send.save(id, user.id, dto);
  }

  @Post('emails/:id/reply/subject')
  subject(@Param('id', ParseUUIDPipe) id: string, @ZodBody(previewSubjectSchema) dto: PreviewSubjectRequest): Promise<PreviewSubjectResponse> {
    return this.send.previewSubject(id, dto.content);
  }

  @Post('emails/:id/reply/send')
  sendReply(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZodBody(sendReplySchema) dto: ParsedSendReply): Promise<SentReplyDto> {
    return this.send.send(id, user.id, dto);
  }

  @Post('uploads')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  createUpload(@CurrentUser() user: AuthUser, @UploadedFile() file: UploadedFileLike | undefined): Promise<UploadDto> {
    return this.send.createUpload(file, user.id);
  }

  @Get('uploads/:id')
  async openUpload(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const { row, stream, size } = await this.send.openUpload(id);
    const inline = INLINE_IMAGE.test(row.contentType);
    res.set({
      'Content-Type': inline ? row.contentType : 'application/octet-stream',
      'Content-Length': String(size),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      'Cache-Control': 'private, max-age=86400',
      ...(inline ? {} : { 'Content-Security-Policy': 'sandbox' }),
    });
    return new StreamableFile(stream);
  }
}
