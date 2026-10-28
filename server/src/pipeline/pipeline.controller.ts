import { Controller, Delete, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { createAdjudicationSchema, type CreateAdjudicationRequest } from '@aftersell/shared';
import { ZodBody } from '../common/zod-body';
import { CurrentUser, Roles, type AuthUser } from '../auth/decorators';
import { AdjudicationService } from './adjudication.service';
import { ProcessQueue } from './process.queue';

@Controller()
export class PipelineController {
  constructor(
    private readonly queue: ProcessQueue,
    private readonly adjudications: AdjudicationService,
  ) {}

  /** 重新识别附件并分类；加入队列后立即返回 */
  @Post('emails/:id/reclassify')
  @HttpCode(202)
  async reclassify(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.queue.enqueue(id, true);
  }

  @Roles('supervisor')
  @Post('adjudications')
  @HttpCode(201)
  create(@CurrentUser() user: AuthUser, @ZodBody(createAdjudicationSchema) dto: CreateAdjudicationRequest): Promise<void> {
    return this.adjudications.create(user.id, dto);
  }

  @Roles('supervisor')
  @Delete('adjudications/:id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.adjudications.remove(user.id, id);
  }
}
