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
 * @Public() is on the two reads and not on the class, because the refresh is
 * not public and there is no decorator that undoes one. SessionGuard resolves
 * [handler, class] and a class-level @Public() would cover every handler under
 * it - so a route added later would be public by inheritance rather than by
 * decision, which is the opposite of the polarity PD-33 chose.
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

  /**
   * 200 rather than 202. A 202 describes a response about work that was queued;
   * this body is about the price, which is returned whether or not anything was
   * queued, and the two extra fields say what happened to the request beside it.
   * Splitting the code would make a client branch twice for one call - once on
   * the status and again on a body it has to read anyway.
   *
   * @HttpCode(HttpStatus.OK) because Nest answers 201 for a @Post by default,
   * which would say a resource was created - and none was.
   */
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
