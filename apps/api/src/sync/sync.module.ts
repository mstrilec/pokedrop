import { Module } from '@nestjs/common';
import { ActiveCardSelector } from './active-card.selector.js';
import { CatalogSyncProcessor } from './catalog-sync.processor.js';
import { CatalogSyncScheduler } from './catalog-sync.scheduler.js';
import { CatalogWriter } from './catalog.writer.js';
import { QueueModule } from '../queue/index.js';
import { PriceActiveProcessor } from './price-active.processor.js';
import { PriceActiveScheduler } from './price-active.scheduler.js';
import { PriceBatchService } from './price-batch.service.js';
import { PriceSweepProcessor } from './price-sweep.processor.js';
import { PriceSweepScheduler } from './price-sweep.scheduler.js';
import { PriceSyncProcessor } from './price-sync.processor.js';
import { PriceWriter } from './price.writer.js';
import { ProvidersModule } from './providers/index.js';
import { SyncRunService } from './sync-run.service.js';

@Module({
  imports: [ProvidersModule, QueueModule],
  providers: [
    ActiveCardSelector,
    CatalogWriter,
    SyncRunService,
    CatalogSyncProcessor,
    CatalogSyncScheduler,
    PriceWriter,
    PriceBatchService,
    PriceSyncProcessor,
    PriceSweepProcessor,
    PriceSweepScheduler,
    PriceActiveProcessor,
    PriceActiveScheduler,
  ],
  exports: [
    ActiveCardSelector,
    ProvidersModule,
    CatalogWriter,
    SyncRunService,
    PriceWriter,
    PriceBatchService,
  ],
})
export class SyncModule {}
