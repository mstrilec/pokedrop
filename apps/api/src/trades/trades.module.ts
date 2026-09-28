import { Module } from '@nestjs/common';
import { AdminTradesController } from './admin-trades.controller.js';
import { TradesController } from './trades.controller.js';
import { TradesCoreModule } from './trades-core.module.js';
import { TradesService } from './trades.service.js';

@Module({
  imports: [TradesCoreModule],
  controllers: [TradesController, AdminTradesController],
  providers: [TradesService],
})
export class TradesModule {}
