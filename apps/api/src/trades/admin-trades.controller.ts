import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Trade } from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { VoidTradeDto } from './trades.dto.js';
import { TradesService } from './trades.service.js';

@ApiTags('admin')
@Roles(['ADMIN'])
@Controller('admin/trades')
export class AdminTradesController {
  constructor(private readonly trades: TradesService) {}

  @HttpCode(HttpStatus.OK)
  @Post(':id/void')
  voidTrade(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() body: VoidTradeDto,
  ): Promise<Trade> {
    return this.trades.voidPending(admin, id, body.reason);
  }
}
