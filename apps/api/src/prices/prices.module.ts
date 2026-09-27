import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/index.js';
import { ProvidersModule } from '../sync/providers/index.js';
import { PriceRefreshService } from './price-refresh.service.js';
import { PricesController } from './prices.controller.js';
import { PricesService } from './prices.service.js';

/**
 * ProvidersModule is imported for RequestBudgetService, and it adds no instance
 * to this process - SyncModule already puts that module in AppModule's graph, and
 * Nest caches modules. AdminSyncService reads breaker state straight from Redis
 * to avoid this import; the duplication that buys is two lines, where duplicating
 * the budget read would be a whole service and a fourth place that has to agree
 * about the UTC day boundary and the fail-open rule.
 *
 * QueueModule is imported for @InjectQueue, which resolves through the importing
 * module's own context - BullMQ's explorer discovers @Processor classes globally,
 * but a queue token does not travel that way.
 *
 * PrismaModule and RedisModule stay unnamed for the reason CatalogModule's empty
 * `imports` gives: both are @Global(), so their services inject without one.
 *
 * PricesService is exported here and was not before. PD-51 left the line out
 * deliberately rather than by oversight - an export with no consumer is a claim
 * about a boundary nobody has crossed. PriceRefreshService reads through it, and
 * although a provider in this same module needs no export to do that, the read
 * is now the module's answer to "what is this card worth" rather than one
 * controller's private helper.
 */
@Module({
  imports: [ProvidersModule, QueueModule],
  controllers: [PricesController],
  providers: [PricesService, PriceRefreshService],
  exports: [PricesService],
})
export class PricesModule {}
