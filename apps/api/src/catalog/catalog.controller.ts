import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Card, CardSearchResult, CardSet, CatalogFacets, SetDetail } from '@pokedrop/shared';
import { Public } from '../common/decorators/public.decorator.js';
import { CatalogService } from './catalog.service.js';
import { CardSearchQueryDto } from './catalog.dto.js';
import { Doc, returns } from '../common/openapi.js';
import {
  CardSchema,
  CardSearchResultSchema,
  CardSetSchema,
  CatalogFacetsSchema,
  SetDetailSchema,
} from '@pokedrop/shared';
import { z } from 'zod';

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

  @Doc('Search and page the card catalog', returns('CardSearchResult', CardSearchResultSchema))
  @Get('cards')
  searchCards(@Query() query: CardSearchQueryDto): Promise<CardSearchResult> {
    return this.catalog.searchCards(query);
  }

  @Doc('One card, with its set and latest price', returns('Card', CardSchema))
  @Get('cards/:id')
  getCard(@Param('id') id: string): Promise<Card> {
    return this.catalog.getCard(id);
  }

  @Doc('Every set in the catalog', returns('CardSetList', z.array(CardSetSchema)))
  @Get('sets')
  listSets(): Promise<CardSet[]> {
    return this.catalog.listSets();
  }

  @Doc('One set, with its cards', returns('SetDetail', SetDetailSchema))
  @Get('sets/:id')
  getSet(@Param('id') id: string): Promise<SetDetail> {
    return this.catalog.getSet(id);
  }

  /**
   * Not under `cards/`, where it would be shadowed by `cards/:id` - the literal
   * would have to be declared first, and a route whose correctness depends on
   * declaration order is one reorder away from a 404.
   */
  @Doc('Filter values for the catalog search', returns('CatalogFacets', CatalogFacetsSchema))
  @Get('facets')
  getFacets(): Promise<CatalogFacets> {
    return this.catalog.getFacets();
  }
}
