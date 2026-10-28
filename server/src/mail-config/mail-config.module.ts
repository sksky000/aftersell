import { Module } from '@nestjs/common';
import { MailConfigController } from './mail-config.controller';
import { MailConfigService } from './mail-config.service';

@Module({
  controllers: [MailConfigController],
  providers: [MailConfigService],
  exports: [MailConfigService],
})
export class MailConfigModule {}
