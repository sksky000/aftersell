import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { MailConfigModule } from '../mail-config/mail-config.module';
import { ReplyModule } from '../reply/reply.module';
import { SettingsModule } from '../settings/settings.module';
import { SendController } from './send.controller';
import { SendService } from './send.service';

@Module({
  imports: [LlmModule, MailConfigModule, ReplyModule, SettingsModule],
  controllers: [SendController],
  providers: [SendService],
})
export class SendModule {}
