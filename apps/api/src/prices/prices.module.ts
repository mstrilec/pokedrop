import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/index.js';
import { ProvidersModule } from '../sync/providers/index.js';
import { PriceRefreshService } from './price-refresh.service.js';
import { PricesController } from './prices.controller.js';
import { PricesService } from './prices.service.js';

@Module({
  imports: [ProvidersModule, QueueModule],
  controllers: [PricesController],
  providers: [PricesService, PriceRefreshService],
  exports: [PricesService],
})
export class PricesModule {}
