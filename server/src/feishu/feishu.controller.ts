import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  ledgerShareSchema,
  saveFeishuConfigSchema,
  type FeishuChat,
  type FeishuConfigDto,
  type FeishuTestResult,
  type LedgerShareRequest,
  type LedgerStatusDto,
  type LedgerTableResult,
  type SaveFeishuConfigRequest,
} from '@aftersell/shared';
import { CurrentUser, Roles, type AuthUser } from '../auth/decorators';
import { ZodBody } from '../common/zod-body';
import { FeishuService } from './feishu.service';
import { LedgerService } from './ledger.service';

/** 飞书应用配置与台账同步：主管可看，管理员可改 */
@Controller('feishu')
@Roles('supervisor')
export class FeishuController {
  constructor(
    private readonly feishu: FeishuService,
    private readonly ledger: LedgerService,
  ) {}

  @Get('config')
  config(): Promise<FeishuConfigDto | null> {
    return this.feishu.get();
  }

  @Roles('admin')
  @Put('config')
  save(@CurrentUser() user: AuthUser, @ZodBody(saveFeishuConfigSchema) dto: SaveFeishuConfigRequest): Promise<FeishuConfigDto> {
    return this.feishu.save(user.id, dto);
  }

  @Roles('admin')
  @Post('test')
  @HttpCode(200)
  test(): Promise<FeishuTestResult> {
    return this.ledger.test();
  }

  @Get('ledger')
  status(): Promise<LedgerStatusDto> {
    return this.ledger.status();
  }

  @Roles('admin')
  @Post('ledger/resync')
  @HttpCode(202)
  resync(@CurrentUser() user: AuthUser): Promise<void> {
    return this.ledger.resyncAll(user.id);
  }

  @Roles('admin')
  @Post('ledger/create')
  @HttpCode(200)
  createTable(@CurrentUser() user: AuthUser, @ZodBody(ledgerShareSchema) dto: LedgerShareRequest): Promise<LedgerTableResult> {
    return this.ledger.createTable(user.id, dto.chatId);
  }

  @Roles('admin')
  @Post('ledger/share')
  @HttpCode(200)
  share(@ZodBody(ledgerShareSchema) dto: LedgerShareRequest): Promise<LedgerTableResult> {
    return this.ledger.share(dto.chatId);
  }

  @Roles('admin')
  @Get('chats')
  chats(): Promise<FeishuChat[]> {
    return this.ledger.chats();
  }
}
