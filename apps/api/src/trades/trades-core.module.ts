import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/index.js';
import { NotificationsModule } from '../notifications/index.js';

/**
 * No controllers, so the worker (PD-74) can import the trade services without
 * Better Auth or the HTTP guards.
 */
@Module({
  imports: [InventoryModule, NotificationsModule],
  exports: [InventoryModule, NotificationsModule],
})
export class TradesCoreModule {}
