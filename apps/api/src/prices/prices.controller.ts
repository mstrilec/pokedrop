import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CardPrice, PriceHistory, PriceRefreshResult } from '@pokedrop/shared';
import { Public } from '../common/decorators/public.decorator.js';
import { PriceRefreshService } from './price-refresh.service.js';
import { PriceHistoryQueryDto } from './prices.dto.js';
import { PricesService } from './prices.service.js';
import { Doc, returns } from '../common/openapi.js';
import { CardPriceSchema, PriceHistorySchema, PriceRefreshResultSchema } from '@pokedrop/shared';

/**
 * @Public() on the two reads, not on the class: a class-level one would make every route added
 * here later public by inheritance.
 */
@ApiTags('prices')
@Controller()
export class PricesController {
  constructor(
    private readonly prices: PricesService,
    private readonly refreshes: PriceRefreshService,
  ) {}

  @Public()
  @Doc("A card's latest price", returns('CardPrice', CardPriceSchema))
  @Get('cards/:id/price')
  getLatest(@Param('id') id: string): Promise<CardPrice> {
    return this.prices.getLatest(id);
  }

  @Public()
  @Doc("A card's price history for charting", returns('PriceHistory', PriceHistorySchema))
  @Get('cards/:id/price/history')
  getHistory(@Param('id') id: string, @Query() query: PriceHistoryQueryDto): Promise<PriceHistory> {
    return this.prices.getHistory(id, query.days);
  }

  @HttpCode(HttpStatus.OK)
  @Doc(
    "Ask for a card's price to be refreshed, within a per-card cooldown",
    returns('PriceRefreshResult', PriceRefreshResultSchema),
  )
  @Post('cards/:id/price/refresh')
  refresh(@Param('id') id: string): Promise<PriceRefreshResult> {
    return this.refreshes.refresh(id);
  }
}
