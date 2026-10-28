import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { LlmController } from './llm.controller';
import { createProvider, LlmService } from './llm.service';

@Module({
  imports: [SettingsModule],
  controllers: [LlmController],
  providers: [LlmService, { provide: 'LLM_PROVIDER_FACTORY', useValue: createProvider }],
  exports: [LlmService],
})
export class LlmModule {}
