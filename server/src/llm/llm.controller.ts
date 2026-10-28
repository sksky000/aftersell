import { Controller, Delete, Get, HttpCode, Param, ParseEnumPipe, Post, Put } from '@nestjs/common';
import {
  LLM_PROVIDERS,
  saveLlmCredentialSchema,
  type LlmProviderId,
  type SaveLlmCredentialRequest,
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

  /** 填写或更换某个服务的 API key / 接口地址；明文 key 不会再返回 */
  @Roles('admin')
  @Put('credentials/:provider')
  saveCredential(
    @CurrentUser() user: AuthUser,
    @Param('provider', new ParseEnumPipe(LLM_PROVIDERS)) provider: LlmProviderId,
    @ZodBody(saveLlmCredentialSchema) dto: SaveLlmCredentialRequest,
  ): Promise<LlmSettingsDto> {
    return this.llm.saveCredential(user.id, provider, dto);
  }

  @Roles('admin')
  @Delete('credentials/:provider')
  clearCredential(
    @CurrentUser() user: AuthUser,
    @Param('provider', new ParseEnumPipe(LLM_PROVIDERS)) provider: LlmProviderId,
  ): Promise<LlmSettingsDto> {
    return this.llm.clearCredential(user.id, provider);
  }

  @Roles('admin')
  @Post('test')
  @HttpCode(200)
  test(@ZodBody(llmTestSchema) dto: { slot: LlmSlot }): Promise<LlmTestResult> {
    return this.llm.test(dto.slot);
  }
}
