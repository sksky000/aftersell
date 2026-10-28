import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  saveMailAccountSchema,
  type MailAccountDto,
  type MailConfigMeta,
  type SaveMailAccountRequest,
  type TestConnectionResult,
} from '@aftersell/shared';
import { ZodBody } from '../common/zod-body';
import { CurrentUser, Roles, type AuthUser } from '../auth/decorators';
import { MailConfigService } from './mail-config.service';

@Controller('mail-config')
export class MailConfigController {
  constructor(private readonly mailConfig: MailConfigService) {}

  @Roles('supervisor')
  @Get()
  get(): Promise<MailAccountDto | null> {
    return this.mailConfig.get();
  }

  @Roles('supervisor')
  @Get('meta')
  meta(): MailConfigMeta {
    return this.mailConfig.meta();
  }

  @Roles('admin')
  @Put()
  save(
    @CurrentUser() user: AuthUser,
    @ZodBody(saveMailAccountSchema) dto: SaveMailAccountRequest,
  ): Promise<MailAccountDto> {
    return this.mailConfig.save(user.id, dto);
  }

  @Roles('admin')
  @Post('test')
  @HttpCode(200)
  test(): Promise<TestConnectionResult> {
    return this.mailConfig.testConnection();
  }
}
