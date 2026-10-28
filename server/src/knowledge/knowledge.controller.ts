import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import {
  paymentSettingsSchema,
  savePriceItemSchema,
  saveStyleRuleSchema,
  toggleSchema,
  updateProductKnowledgeSchema,
  type KnowledgeCardDto,
  type PaymentSettings,
  type PriceItemDto,
  type ProductKnowledgeDto,
  type SavePriceItemRequest,
  type SaveStyleRuleRequest,
  type StyleRuleDto,
} from '@aftersell/shared';
import { ZodBody } from '../common/zod-body';
import { CurrentUser, Roles, type AuthUser } from '../auth/decorators';
import { KnowledgeService } from './knowledge.service';

/** 业务知识：主管可查看与维护，收款信息仅管理员可改 */
@Controller('knowledge')
@Roles('supervisor')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get('products')
  products(): Promise<ProductKnowledgeDto[]> {
    return this.knowledge.listProducts();
  }

  @Patch('products/:modelCode')
  @HttpCode(204)
  updateProduct(
    @Param('modelCode') modelCode: string,
    @ZodBody(updateProductKnowledgeSchema) dto: { knowledge?: string; enabled?: boolean },
  ): Promise<void> {
    return this.knowledge.updateProduct(modelCode, dto);
  }

  @Get('cards')
  cards(): Promise<KnowledgeCardDto[]> {
    return this.knowledge.listCards();
  }

  @Patch('cards/:id')
  @HttpCode(204)
  toggleCard(@Param('id', ParseUUIDPipe) id: string, @ZodBody(toggleSchema) dto: { enabled: boolean }): Promise<void> {
    return this.knowledge.setCardEnabled(id, dto.enabled);
  }

  @Get('styles')
  styles(): Promise<StyleRuleDto[]> {
    return this.knowledge.listStyles();
  }

  @Post('styles')
  createStyle(@ZodBody(saveStyleRuleSchema) dto: SaveStyleRuleRequest): Promise<StyleRuleDto> {
    return this.knowledge.createStyle(dto);
  }

  @Put('styles/:id')
  updateStyle(@Param('id', ParseUUIDPipe) id: string, @ZodBody(saveStyleRuleSchema) dto: SaveStyleRuleRequest): Promise<StyleRuleDto> {
    return this.knowledge.updateStyle(id, dto);
  }

  @Delete('styles/:id')
  @HttpCode(204)
  deleteStyle(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.knowledge.deleteStyle(id);
  }

  @Get('prices')
  prices(): Promise<PriceItemDto[]> {
    return this.knowledge.listPrices();
  }

  @Post('prices')
  createPrice(@ZodBody(savePriceItemSchema) dto: SavePriceItemRequest): Promise<PriceItemDto> {
    return this.knowledge.createPrice(dto);
  }

  @Put('prices/:id')
  updatePrice(@Param('id', ParseUUIDPipe) id: string, @ZodBody(savePriceItemSchema) dto: SavePriceItemRequest): Promise<PriceItemDto> {
    return this.knowledge.updatePrice(id, dto);
  }

  @Delete('prices/:id')
  @HttpCode(204)
  deletePrice(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.knowledge.deletePrice(id);
  }

  @Get('payment')
  payment(): Promise<PaymentSettings> {
    return this.knowledge.payment();
  }

  @Roles('admin')
  @Put('payment')
  savePayment(@CurrentUser() user: AuthUser, @ZodBody(paymentSettingsSchema) dto: PaymentSettings): Promise<PaymentSettings> {
    return this.knowledge.savePayment(user.id, dto);
  }
}
