import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  llmSettingsSchema,
  llmTestSchema,
  type LlmSettings,
  type LlmSettingsDto,
  type LlmSlot,
  type LlmTestResult,
} from '@aftersell/shared';
import { ZodBody } from '../common/zod-body';
import { CurrentUser, Roles, type AuthUser } from '../auth/decorators';
import { LlmService } from './llm.service';

@Controller('llm')
export class LlmController {
  constructor(private readonly llm: LlmService) {}

  @Roles('supervisor')
  @Get('settings')
  settings(): Promise<LlmSettingsDto> {
    return this.llm.settingsDto();
  }

  @Roles('admin')
  @Put('settings')
  save(@CurrentUser() user: AuthUser, @ZodBody(llmSettingsSchema) dto: LlmSettings): Promise<LlmSettingsDto> {
    return this.llm.saveSettings(user.id, dto);
  }

  @Roles('admin')
  @Post('test')
  @HttpCode(200)
  test(@ZodBody(llmTestSchema) dto: { slot: LlmSlot }): Promise<LlmTestResult> {
    return this.llm.test(dto.slot);
  }
}
