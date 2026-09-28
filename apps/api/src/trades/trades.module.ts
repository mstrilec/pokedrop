import { Module } from '@nestjs/common';
import { TradesController } from './trades.controller.js';
import { TradesCoreModule } from './trades-core.module.js';
import { TradesService } from './trades.service.js';

@Module({
  imports: [TradesCoreModule],
  controllers: [TradesController],
  providers: [TradesService],
})
export class TradesModule {}
