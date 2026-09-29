import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/index.js';
import { TradeExpiryProcessor } from './trade-expiry.processor.js';
import { TradeExpiryScheduler } from './trade-expiry.scheduler.js';
import { TradeExpiryService } from './trade-expiry.service.js';
import { TradesCoreModule } from './trades-core.module.js';

/** Imported by the worker only; the API neither schedules nor consumes expiry. */
@Module({
  imports: [TradesCoreModule, QueueModule],
  providers: [TradeExpiryService, TradeExpiryProcessor, TradeExpiryScheduler],
})
export class TradeExpiryModule {}
