import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { WalletPage } from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { WalletQueryDto } from './wallet.dto.js';
import { WalletService } from './wallet.service.js';
import { Doc, returns } from '../common/openapi.js';
import { WalletPageSchema } from '@pokedrop/shared';

@ApiTags('wallet')
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Doc(
    "The caller's balance and ledger, with a running balance",
    returns('WalletPage', WalletPageSchema),
  )
  @Get()
  page(@CurrentUser() user: AuthUser, @Query() query: WalletQueryDto): Promise<WalletPage> {
    return this.wallet.page(user.id, query);
  }
}
