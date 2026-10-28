import { Module } from '@nestjs/common';
import { PipelineModule } from '../pipeline/pipeline.module';
import { EmailsController } from './emails.controller';
import { EmailsService } from './emails.service';

@Module({
  imports: [PipelineModule],
  controllers: [EmailsController],
  providers: [EmailsService],
})
export class EmailsModule {}
