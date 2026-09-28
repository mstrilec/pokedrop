import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Trade } from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { MODERATE_THROTTLE } from '../common/throttle.js';
import { CounterTradeDto, ProposeTradeDto } from './trades.dto.js';
import { TradesService } from './trades.service.js';

@ApiTags('trades')
@Controller('trades')
export class TradesController {
  constructor(private readonly trades: TradesService) {}

  @Throttle(MODERATE_THROTTLE)
  @Post()
  propose(@CurrentUser() user: AuthUser, @Body() body: ProposeTradeDto): Promise<Trade> {
    return this.trades.propose(user, body);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/accept')
  accept(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<Trade> {
    return this.trades.accept(user, id);
  }

  @Throttle(MODERATE_THROTTLE)
  @Post(':id/counter')
  counter(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: CounterTradeDto,
  ): Promise<Trade> {
    return this.trades.counter(user, id, body);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/decline')
  decline(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<Trade> {
    return this.trades.decline(user, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<Trade> {
    return this.trades.cancel(user, id);
  }
}
