import { Module } from '@nestjs/common';
import { MailRoutingService } from './mail-routing.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService, MailRoutingService],
  exports: [SettingsService, MailRoutingService],
})
export class SettingsModule {}
