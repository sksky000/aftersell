import { Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { updateRuleSchema, type DraftContextDto, type DraftDto, type RuleDto, type UpdateRuleRequest } from '@aftersell/shared';
import { ZodBody } from '../common/zod-body';
import { CurrentUser, Roles, type AuthUser } from '../auth/decorators';
import { DraftService } from './draft.service';
import { RulesService } from './rules.service';

@Controller()
export class ReplyController {
  constructor(
    private readonly drafts: DraftService,
    private readonly rules: RulesService,
  ) {}

  @Get('emails/:id/draft')
  draft(@Param('id', ParseUUIDPipe) id: string): Promise<DraftDto | null> {
    return this.drafts.latest(id);
  }

  /** 模型实际看到的上下文，用于排查草稿为什么这样写 */
  @Roles('supervisor')
  @Get('emails/:id/draft/context')
  async context(@Param('id', ParseUUIDPipe) id: string): Promise<DraftContextDto> {
    return { context: (await this.drafts.latestContext(id)) ?? '' };
  }

  @Roles('supervisor')
  @Get('rules')
  list(): Promise<RuleDto[]> {
    return this.rules.list();
  }

  @Roles('supervisor')
  @Patch('rules/:key')
  update(@CurrentUser() user: AuthUser, @Param('key') key: string, @ZodBody(updateRuleSchema) dto: UpdateRuleRequest): Promise<RuleDto> {
    return this.rules.update(user.id, key, dto);
  }
}
