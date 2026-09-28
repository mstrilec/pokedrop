import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { TradeCloseService } from './trade-close.service.js';

/**
 * No controllers, so the worker (PD-74) can import the trade services without
 * Better Auth or the HTTP guards.
 */
@Module({
  imports: [InventoryModule, NotificationsModule],
  providers: [TradeCloseService],
  exports: [TradeCloseService, InventoryModule, NotificationsModule],
})
export class TradesCoreModule {}
