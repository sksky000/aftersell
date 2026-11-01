import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { SettingsModule } from '../settings/settings.module';
import { HistoryAccount } from './history-account';
import { LearningController } from './learning.controller';
import { LearningService } from './learning.service';

@Module({
  imports: [LlmModule, SettingsModule],
  controllers: [LearningController],
  providers: [LearningService, HistoryAccount],
})
export class LearningModule {}
