import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/index.js';
import { TradeExpiryProcessor } from './trade-expiry.processor.js';
import { TradeExpiryScheduler } from './trade-expiry.scheduler.js';
import { TradeExpiryService } from './trade-expiry.service.js';
import { TradesCoreModule } from './trades-core.module.js';

@Module({
  imports: [TradesCoreModule, QueueModule],
  providers: [TradeExpiryService, TradeExpiryProcessor, TradeExpiryScheduler],
})
export class TradeExpiryModule {}
