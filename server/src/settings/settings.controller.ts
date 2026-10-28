import { Controller, Get, Put } from '@nestjs/common';
import { mailRoutingSchema, type MailRouting } from '@aftersell/shared';
import { ZodBody } from '../common/zod-body';
import { CurrentUser, Roles, type AuthUser } from '../auth/decorators';
import { MailRoutingService } from './mail-routing.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly mailRouting: MailRoutingService) {}

  @Roles('supervisor')
  @Get('mail-routing')
  getMailRouting(): Promise<MailRouting> {
    return this.mailRouting.get();
  }

  @Roles('admin')
  @Put('mail-routing')
  saveMailRouting(@CurrentUser() user: AuthUser, @ZodBody(mailRoutingSchema) dto: MailRouting): Promise<MailRouting> {
    return this.mailRouting.save(user.id, dto);
  }
}
