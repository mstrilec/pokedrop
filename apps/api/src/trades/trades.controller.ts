import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Trade, TradeDetail, TradePage } from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { MODERATE_THROTTLE } from '../common/throttle.js';
import { TradeReadsService } from './trade-reads.service.js';
import { CounterTradeDto, ProposeTradeDto, TradeInboxQueryDto } from './trades.dto.js';
import { TradesService } from './trades.service.js';
import { Doc, returns } from '../common/openapi.js';
import { TradeDetailSchema, TradePageSchema, TradeSchema } from '@pokedrop/shared';

@ApiTags('trades')
@Controller('trades')
export class TradesController {
  constructor(
    private readonly trades: TradesService,
    private readonly reads: TradeReadsService,
  ) {}

  @Doc("The caller's trade inbox, by tab", returns('TradePage', TradePageSchema))
  @Get()
  inbox(@CurrentUser() user: AuthUser, @Query() query: TradeInboxQueryDto): Promise<TradePage> {
    return this.reads.inbox(user, query);
  }

  @Doc(
    "One of the caller's trades, with its timeline and counter chain",
    returns('TradeDetail', TradeDetailSchema),
  )
  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<TradeDetail> {
    return this.reads.detail(user, id);
  }

  @Throttle(MODERATE_THROTTLE)
  @Doc('Propose a trade, locking the offered cards', returns('Trade', TradeSchema))
  @Post()
  propose(@CurrentUser() user: AuthUser, @Body() body: ProposeTradeDto): Promise<Trade> {
    return this.trades.propose(user, body);
  }

  @HttpCode(HttpStatus.OK)
  @Doc('Accept a trade, settling coins and cards in one transaction', returns('Trade', TradeSchema))
  @Post(':id/accept')
  accept(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<Trade> {
    return this.trades.accept(user, id);
  }

  @Throttle(MODERATE_THROTTLE)
  @Doc('Counter a trade with a new offer, moving its locks', returns('Trade', TradeSchema))
  @Post(':id/counter')
  counter(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: CounterTradeDto,
  ): Promise<Trade> {
    return this.trades.counter(user, id, body);
  }

  @HttpCode(HttpStatus.OK)
  @Doc('Decline a trade addressed to the caller', returns('Trade', TradeSchema))
  @Post(':id/decline')
  decline(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<Trade> {
    return this.trades.decline(user, id);
  }

  @HttpCode(HttpStatus.OK)
  @Doc('Cancel a trade the caller proposed', returns('Trade', TradeSchema))
  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<Trade> {
    return this.trades.cancel(user, id);
  }
}
