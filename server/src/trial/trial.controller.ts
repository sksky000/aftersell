import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import {
  rateTrialSchema,
  trialPairsQuerySchema,
  type ParsedRateTrial,
  type TrialPairsQuery,
  type TrialPairsResponse,
  type TrialSummaryDto,
} from '@aftersell/shared';
import { CurrentUser, Roles, type AuthUser } from '../auth/decorators';
import { ZodBody, ZodQuery } from '../common/zod-body';
import { TrialService } from './trial.service';

/** 试跑对比（M9）：主管查看并给 AI 草稿打分 */
@Controller('trial')
@Roles('supervisor')
export class TrialController {
  constructor(private readonly trial: TrialService) {}

  @Get('summary')
  summary(): Promise<TrialSummaryDto> {
    return this.trial.summary();
  }

  @Get('pairs')
  pairs(@ZodQuery(trialPairsQuerySchema) q: TrialPairsQuery): Promise<TrialPairsResponse> {
    return this.trial.pairs(q);
  }

  @Put('pairs/:emailId/rating')
  @HttpCode(204)
  rate(@CurrentUser() user: AuthUser, @Param('emailId', ParseUUIDPipe) emailId: string, @ZodBody(rateTrialSchema) dto: ParsedRateTrial): Promise<void> {
    return this.trial.rate(emailId, user.id, dto);
  }
}
