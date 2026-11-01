import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { TranslateController } from './translate.controller';
import { TranslateService } from './translate.service';

@Module({
  imports: [LlmModule],
  controllers: [TranslateController],
  providers: [TranslateService],
})
export class TranslateModule {}
