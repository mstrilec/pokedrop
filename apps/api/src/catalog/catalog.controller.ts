import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Card, CardSearchResult, CardSet, SetDetail } from '@pokedrop/shared';
import { Public } from '../common/decorators/public.decorator.js';
import { CatalogService } from './catalog.service.js';
import { CardSearchQueryDto } from './catalog.dto.js';

/**
 * Public because a catalog is, and because the card detail page is SEO-facing.
 * Without @Public() the global SessionGuard answers 401 - the polarity PD-33
 * chose deliberately, so forgetting the decorator is noisy rather than silent.
 */
@ApiTags('catalog')
@Public()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('cards')
  searchCards(@Query() query: CardSearchQueryDto): Promise<CardSearchResult> {
    return this.catalog.searchCards(query);
  }

  @Get('cards/:id')
  getCard(@Param('id') id: string): Promise<Card> {
    return this.catalog.getCard(id);
  }

  @Get('sets')
  listSets(): Promise<CardSet[]> {
    return this.catalog.listSets();
  }

  @Get('sets/:id')
  getSet(@Param('id') id: string): Promise<SetDetail> {
    return this.catalog.getSet(id);
  }
}
