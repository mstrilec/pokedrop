import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { SyncStatusResponse } from '@pokedrop/shared';
import { Roles } from '../common/decorators/roles.decorator.js';
import { AdminSyncService } from './admin-sync.service.js';

/**
 * Read only. Triggering a sync and clearing a breaker are PD-81's half of this
 * surface, in M10; this exists now because PD-43's third acceptance criterion is
 * a statement about an endpoint, and one that can only be checked with psql is
 * not an acceptance criterion.
 *
 * No @Public() here on purpose: the global SessionGuard answers 401 without a
 * session and RolesGuard answers 403 for a member, which is the polarity PD-33
 * chose so that forgetting a decorator is noisy rather than silent.
 */
@ApiTags('admin')
@Roles(['ADMIN'])
@Controller('admin')
export class AdminController {
  constructor(private readonly sync: AdminSyncService) {}

  @Get('sync/status')
  syncStatus(): Promise<SyncStatusResponse> {
    return this.sync.status();
  }
}
