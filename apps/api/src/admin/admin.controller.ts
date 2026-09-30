import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  ProviderBreakerStateDto,
  SyncStatusResponse,
  SyncTriggerResult,
} from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { AdminSyncControlService } from './admin-sync-control.service.js';
import { AdminSyncService } from './admin-sync.service.js';
import { Doc, returns } from '../common/openapi.js';
import {
  ProviderBreakerStateSchema,
  SyncStatusResponseSchema,
  SyncTriggerResultSchema,
} from '@pokedrop/shared';

/**
 * No @Public() here on purpose: the global SessionGuard answers 401 without a
 * session and RolesGuard answers 403 for a member, which is the polarity PD-33
 * chose so that forgetting a decorator is noisy rather than silent.
 */
@ApiTags('admin')
@Roles(['ADMIN'])
@Controller('admin/sync')
export class AdminController {
  constructor(
    private readonly sync: AdminSyncService,
    private readonly control: AdminSyncControlService,
  ) {}

  @Doc(
    'Last run per sync kind, queue depth, breakers and the provider the next run would use',
    returns('SyncStatusResponse', SyncStatusResponseSchema),
  )
  @Get('status')
  status(): Promise<SyncStatusResponse> {
    return this.sync.status();
  }

  /** 202: the run is queued, not done. */
  @HttpCode(HttpStatus.ACCEPTED)
  @Doc(
    'Queue a catalog sync; refused while one, or a price sweep, is queued or running',
    returns('SyncTriggerResult', SyncTriggerResultSchema),
  )
  @Post('catalog')
  triggerCatalog(@CurrentUser() admin: AuthUser): Promise<SyncTriggerResult> {
    return this.control.trigger(admin, 'CATALOG');
  }

  @HttpCode(HttpStatus.ACCEPTED)
  @Doc(
    'Queue a full price sweep; refused while one, or a catalog sync, is queued or running',
    returns('SyncTriggerResult', SyncTriggerResultSchema),
  )
  @Post('prices')
  triggerPrices(@CurrentUser() admin: AuthUser): Promise<SyncTriggerResult> {
    return this.control.trigger(admin, 'PRICE');
  }

  @HttpCode(HttpStatus.OK)
  @Doc(
    "Clear a provider's circuit breaker",
    returns('ProviderBreakerState', ProviderBreakerStateSchema),
  )
  @Post('breakers/:provider/reset')
  resetBreaker(
    @CurrentUser() admin: AuthUser,
    @Param('provider') provider: string,
  ): Promise<ProviderBreakerStateDto> {
    return this.control.resetBreaker(admin, provider);
  }
}
