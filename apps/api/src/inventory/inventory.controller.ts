import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { InventoryPage, InventorySummary, OwnedCounts } from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { InventoryQueryDto, OwnedQueryDto } from './inventory.dto.js';
import { InventoryService } from './inventory.service.js';
import { Doc, returns } from '../common/openapi.js';
import { InventoryPageSchema, InventorySummarySchema, OwnedCountsSchema } from '@pokedrop/shared';

@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Doc(
    "Page the caller's collection, filtered and sorted",
    returns('InventoryPage', InventoryPageSchema),
  )
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: InventoryQueryDto): Promise<InventoryPage> {
    return this.inventory.list(user.id, query);
  }

  @Doc(
    "Totals, collection value and set completion for the caller's collection",
    returns('InventorySummary', InventorySummarySchema),
  )
  @Get('summary')
  summary(@CurrentUser() user: AuthUser): Promise<InventorySummary> {
    return this.inventory.summary(user.id);
  }

  @Doc(
    'How many of each given card the caller holds; absent ids are not owned',
    returns('OwnedCounts', OwnedCountsSchema),
  )
  @Get('owned')
  owned(@CurrentUser() user: AuthUser, @Query() query: OwnedQueryDto): Promise<OwnedCounts> {
    return this.inventory.owned(user.id, query.cardIds);
  }
}
