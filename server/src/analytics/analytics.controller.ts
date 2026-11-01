import { Controller, Get, Put } from '@nestjs/common';
import { analyticsQuerySchema, llmPricingSchema, type AnalyticsDto, type AnalyticsQuery, type LlmPricing } from '@aftersell/shared';
import { CurrentUser, Roles, type AuthUser } from '../auth/decorators';
import { ZodBody, ZodQuery } from '../common/zod-body';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  summary(@ZodQuery(analyticsQuerySchema) q: AnalyticsQuery): Promise<AnalyticsDto> {
    return this.analytics.summary(q.days);
  }

  @Get('pricing')
  pricing(): Promise<LlmPricing> {
    return this.analytics.pricing();
  }

  @Roles('admin')
  @Put('pricing')
  savePricing(@CurrentUser() user: AuthUser, @ZodBody(llmPricingSchema) dto: LlmPricing): Promise<LlmPricing> {
    return this.analytics.savePricing(user.id, dto);
  }
}
