import { Module } from '@nestjs/common';
import { CatalogSyncProcessor } from './catalog-sync.processor.js';
import { CatalogSyncScheduler } from './catalog-sync.scheduler.js';
import { CatalogWriter } from './catalog.writer.js';
import { QueueModule } from '../queue/index.js';
import { PriceSyncProcessor } from './price-sync.processor.js';
import { PriceWriter } from './price.writer.js';
import { ProvidersModule } from './providers/index.js';
import { SyncRunService } from './sync-run.service.js';

/**
 * The sync layer. Processors arrive with the tickets that own them: PD-42
 * (catalog sync), PD-74 (trade expiry).
 *
 * The provider registry is not here but in ProvidersModule, because registering
 * one means naming a concrete client and the lint rule sealing that folder
 * refuses that anywhere else.
 */
@Module({
  // QueueModule is here for the scheduler's @InjectQueue. The processor does
  // not need it - BullMQ's explorer discovers @Processor classes globally - but
  // injecting a queue resolves through the importing module's own context.
  imports: [ProvidersModule, QueueModule],
  providers: [
    CatalogWriter,
    SyncRunService,
    CatalogSyncProcessor,
    CatalogSyncScheduler,
    PriceWriter,
    PriceSyncProcessor,
  ],
  exports: [ProvidersModule, CatalogWriter, SyncRunService, PriceWriter],
})
export class SyncModule {}
