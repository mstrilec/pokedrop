import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CardPrice } from '@pokedrop/shared';
import { Public } from '../common/decorators/public.decorator.js';
import { PricesService } from './prices.service.js';

/**
 * Public because the card detail page is, and because it is SEO-facing. Without
 * @Public() the global SessionGuard answers 401 - the polarity PD-33 chose so
 * that forgetting the decorator is noisy rather than silent.
 */
@ApiTags('prices')
@Public()
@Controller()
export class PricesController {
  constructor(private readonly prices: PricesService) {}

  @Get('cards/:id/price')
  getLatest(@Param('id') id: string): Promise<CardPrice> {
    return this.prices.getLatest(id);
  }
}
