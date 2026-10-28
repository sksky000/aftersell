import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { SyncStatusDto } from '@aftersell/shared';
import { CurrentUser, type AuthUser } from '../auth/decorators';
import { MailSyncQueue } from './mail-sync.queue';

@Controller('mail-sync')
export class MailSyncController {
  constructor(private readonly queue: MailSyncQueue) {}

  @Get('status')
  status(): Promise<SyncStatusDto> {
    return this.queue.status();
  }

  /** 加入队列后立即返回，前端轮询 status 等结果 */
  @Post('run')
  @HttpCode(202)
  run(@CurrentUser() user: AuthUser): Promise<SyncStatusDto> {
    return this.queue.enqueueManual(user.id);
  }
}
