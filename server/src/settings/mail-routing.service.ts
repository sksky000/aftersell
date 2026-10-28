import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DEFAULT_MAIL_ROUTING, mailRoutingSchema, type MailRouting } from '@aftersell/shared';
import { configureSenderDirectory } from '../mail/sender-directory';
import { SettingsService } from './settings.service';

const KEY = 'mail.routing';

@Injectable()
export class MailRoutingService implements OnModuleInit {
  private readonly logger = new Logger(MailRoutingService.name);

  constructor(private readonly settings: SettingsService) {}

  async onModuleInit(): Promise<void> {
    configureSenderDirectory(await this.get());
  }

  get(): Promise<MailRouting> {
    return this.settings.get(KEY, mailRoutingSchema, DEFAULT_MAIL_ROUTING);
  }

  async save(actorId: string, routing: MailRouting): Promise<MailRouting> {
    await this.settings.set(KEY, routing, actorId);
    configureSenderDirectory(routing);
    this.logger.log(`发件人角色配置已更新 by=${actorId}`);
    return routing;
  }
}
