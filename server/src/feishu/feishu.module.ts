import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { FeishuController } from './feishu.controller';
import { FeishuService } from './feishu.service';
import { LedgerService } from './ledger.service';

@Module({
  imports: [SettingsModule],
  controllers: [FeishuController],
  providers: [FeishuService, LedgerService],
  exports: [FeishuService],
})
export class FeishuModule {}
