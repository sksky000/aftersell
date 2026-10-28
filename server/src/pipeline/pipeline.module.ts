import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { AdjudicationService } from './adjudication.service';
import { ClassifyService } from './classify.service';
import { PipelineController } from './pipeline.controller';
import { ProcessQueue } from './process.queue';
import { RecognitionService } from './recognition.service';

@Module({
  imports: [LlmModule],
  controllers: [PipelineController],
  providers: [RecognitionService, AdjudicationService, ClassifyService, ProcessQueue],
  exports: [ProcessQueue, RecognitionService, AdjudicationService],
})
export class PipelineModule {}
