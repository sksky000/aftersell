import { Controller, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { translateSchema, type TranslateRequest, type TranslateResponse } from '@aftersell/shared';
import { ZodBody } from '../common/zod-body';
import { TranslateService } from './translate.service';

@Controller()
export class TranslateController {
  constructor(private readonly translate: TranslateService) {}

  /** 来信正文译成中文（有缓存；refresh=1 重新翻译） */
  @Post('emails/:id/translate')
  async email(@Param('id', ParseUUIDPipe) id: string, @Query('refresh') refresh?: string): Promise<TranslateResponse> {
    return { text: await this.translate.email(id, refresh === '1') };
  }

  /** 任意文本译成中文（审核台对照草稿） */
  @Post('translate')
  async text(@ZodBody(translateSchema) dto: TranslateRequest): Promise<TranslateResponse> {
    return { text: await this.translate.toChinese(dto.text) };
  }
}
