import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Trade, TradeDetail } from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { TradeReadsService } from './trade-reads.service.js';
import { VoidTradeDto } from './trades.dto.js';
import { TradesService } from './trades.service.js';
import { Doc, returns } from '../common/openapi.js';
import { TradeDetailSchema, TradeSchema } from '@pokedrop/shared';

@ApiTags('admin')
@Roles(['ADMIN'])
@Controller('admin/trades')
export class AdminTradesController {
  constructor(
    private readonly trades: TradesService,
    private readonly reads: TradeReadsService,
  ) {}

  /** An admin reads any trade here rather than through a bypass on the member route. */
  @Doc('Any trade, with its timeline and counter chain', returns('TradeDetail', TradeDetailSchema))
  @Get(':id')
  detail(@Param('id') id: string): Promise<TradeDetail> {
    return this.reads.detailForAdmin(id);
  }

  @HttpCode(HttpStatus.OK)
  @Doc(
    'Void a trade: release a pending one, reverse an accepted one',
    returns('Trade', TradeSchema),
  )
  @Post(':id/void')
  voidTrade(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() body: VoidTradeDto,
  ): Promise<Trade> {
    return this.trades.voidTrade(admin, id, body.reason);
  }
}
