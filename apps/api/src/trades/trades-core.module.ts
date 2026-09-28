import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { TradeCloseService } from './trade-close.service.js';
import { TradeSettlementService } from './trade-settlement.service.js';

/**
 * No controllers, so the worker (PD-74) can import the trade services without
 * Better Auth or the HTTP guards.
 */
@Module({
  imports: [InventoryModule, NotificationsModule],
  providers: [TradeCloseService, TradeSettlementService],
  exports: [TradeCloseService, TradeSettlementService, InventoryModule, NotificationsModule],
})
export class TradesCoreModule {}
