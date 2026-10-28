import { Module } from '@nestjs/common';
import { MailConfigModule } from '../mail-config/mail-config.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { SettingsModule } from '../settings/settings.module';
import { IngestService } from './ingest.service';
import { MailSyncController } from './mail-sync.controller';
import { MailSyncQueue } from './mail-sync.queue';
import { MailSyncService } from './mail-sync.service';

@Module({
  // SettingsModule 先初始化，保证发件人角色目录在第一次同步前已载入
  imports: [MailConfigModule, SettingsModule, PipelineModule],
  controllers: [MailSyncController],
  providers: [IngestService, MailSyncService, MailSyncQueue],
})
export class MailSyncModule {}
