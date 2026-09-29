import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { WalletPage } from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { WalletQueryDto } from './wallet.dto.js';
import { WalletService } from './wallet.service.js';

@ApiTags('wallet')
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  page(@CurrentUser() user: AuthUser, @Query() query: WalletQueryDto): Promise<WalletPage> {
    return this.wallet.page(user.id, query);
  }
}
