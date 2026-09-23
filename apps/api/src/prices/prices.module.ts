import { Module } from '@nestjs/common';
import { PricesController } from './prices.controller.js';
import { PricesService } from './prices.service.js';

/**
 * An empty `imports` for the reason CatalogModule states: PrismaModule and
 * RedisModule are both @Global(), so PrismaService and CacheService inject
 * without one, and naming a non-global module here would put tokens into this
 * context that do not belong to it.
 */
@Module({
  controllers: [PricesController],
  providers: [PricesService],
})
export class PricesModule {}
