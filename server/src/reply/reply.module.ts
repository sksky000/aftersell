import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { LlmModule } from '../llm/llm.module';
import { DraftService } from './draft.service';
import { ReplyController } from './reply.controller';
import { RulesService } from './rules.service';

@Module({
  imports: [LlmModule, KnowledgeModule],
  controllers: [ReplyController],
  providers: [RulesService, DraftService],
  exports: [DraftService, RulesService],
})
export class ReplyModule {}
