import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { KnowledgeController, SnippetsController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

@Module({
  imports: [SettingsModule],
  controllers: [KnowledgeController, SnippetsController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
