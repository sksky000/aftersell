import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  CANDIDATE_STATUSES,
  reviewSchema,
  saveHistoryAccountSchema,
  startHistoryImportSchema,
  type CandidateStatus,
  type CardCandidateDto,
  type HistoryAccountDto,
  type HistoryTestResult,
  type LearningStatusDto,
  type ReviewRequest,
  type SaveHistoryAccountRequest,
  type StartHistoryImportRequest,
  type StyleCandidateDto,
} from '@aftersell/shared';
import { CurrentUser, Roles, type AuthUser } from '../auth/decorators';
import { ZodBody } from '../common/zod-body';
import { HistoryAccount } from './history-account';
import { LearningService } from './learning.service';

const statusOf = (s?: string): CandidateStatus => ((CANDIDATE_STATUSES as readonly string[]).includes(s ?? '') ? (s as CandidateStatus) : 'draft');

/** 学习与审核：主管查看、生成候选、审核；生产邮箱账号与导入只有管理员能操作 */
@Controller('learning')
@Roles('supervisor')
export class LearningController {
  constructor(
    private readonly learning: LearningService,
    private readonly account: HistoryAccount,
  ) {}

  @Get('status')
  status(): Promise<LearningStatusDto> {
    return this.learning.status();
  }

  @Roles('admin')
  @Put('account')
  saveAccount(@CurrentUser() user: AuthUser, @ZodBody(saveHistoryAccountSchema) dto: SaveHistoryAccountRequest): Promise<HistoryAccountDto> {
    return this.account.save(user.id, dto);
  }

  @Roles('admin')
  @Delete('account')
  @HttpCode(204)
  removeAccount(@CurrentUser() user: AuthUser): Promise<void> {
    return this.account.remove(user.id);
  }

  @Roles('admin')
  @Post('account/test')
  testAccount(): Promise<HistoryTestResult> {
    return this.account.test();
  }

  @Roles('admin')
  @Post('import')
  @HttpCode(202)
  startImport(@ZodBody(startHistoryImportSchema) dto: StartHistoryImportRequest): void {
    this.learning.startImport(dto);
  }

  @Post('label')
  @HttpCode(202)
  startLabel(): void {
    this.learning.startLabel();
  }

  @Post('cards')
  @HttpCode(202)
  startCards(): void {
    this.learning.startCards();
  }

  @Post('styles')
  @HttpCode(202)
  startStyles(): void {
    this.learning.startStyles();
  }

  @Get('candidates/cards')
  cards(@Query('status') status?: string): Promise<CardCandidateDto[]> {
    return this.learning.cardCandidates(statusOf(status));
  }

  @Post('candidates/cards/:id/review')
  @HttpCode(204)
  reviewCard(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZodBody(reviewSchema) dto: ReviewRequest): Promise<void> {
    return this.learning.reviewCard(id, user.id, dto);
  }

  @Get('candidates/styles')
  styles(@Query('status') status?: string): Promise<StyleCandidateDto[]> {
    return this.learning.styleCandidates(statusOf(status));
  }

  @Post('candidates/styles/:id/review')
  @HttpCode(204)
  reviewStyle(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ZodBody(reviewSchema) dto: ReviewRequest): Promise<void> {
    return this.learning.reviewStyle(id, user.id, dto);
  }
}
