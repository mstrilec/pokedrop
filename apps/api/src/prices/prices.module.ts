import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/index.js';
import { PriceRefreshService } from './price-refresh.service.js';
import { PricesController } from './prices.controller.js';
import { PricesService } from './prices.service.js';

/**
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
  imports: [QueueModule],
  controllers: [PricesController],
  providers: [PricesService, PriceRefreshService],
  exports: [PricesService],
})
export class PricesModule {}
