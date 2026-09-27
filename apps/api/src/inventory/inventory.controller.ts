import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { InventoryPage, InventorySummary } from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { InventoryQueryDto } from './inventory.dto.js';
import { InventoryService } from './inventory.service.js';

@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: InventoryQueryDto): Promise<InventoryPage> {
    return this.inventory.list(user.id, query);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser): Promise<InventorySummary> {
    return this.inventory.summary(user.id);
  }
}
