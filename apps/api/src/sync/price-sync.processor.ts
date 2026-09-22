import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE } from '../queue/index.js';
import { ProviderSelectorService } from './providers/index.js';
import { PriceBatchService } from './price-batch.service.js';

/**
 * The contract the producer speaks. `price-sync` has one producer, PD-52's
 * single-card job. PD-49's nightly sweep and PD-50's active refresh do not
 * enqueue here at all - each coordinates its own batches on its own queue
 * (`price-sweep`, `price-active`) and calls PriceBatchService directly,
 * because a fan-out has no good answer for which of many jobs closes the run.
 * All three producers reach the same write path.
 */
export interface PriceSyncJob {
  cardIds: string[];
}

@Processor(QUEUE.priceSync)
export class PriceSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(PriceSyncProcessor.name);

  constructor(
    private readonly selector: ProviderSelectorService,
    private readonly batch: PriceBatchService,
  ) {
    super();
  }

  async process(job: Job<PriceSyncJob>): Promise<void> {
    const { cardIds } = job.data;

    if (cardIds.length === 0) {
      return;
    }

    const choice = await this.selector.select();
    const result = await this.batch.refreshBatch(cardIds, choice.provider);

    this.logger.log(
      `job ${job.id}: ${result.asked} asked, ${result.priced} priced by ${choice.provider.name}, ` +
        `${result.cards} cards updated, ${result.snapshots} snapshots written`,
    );
  }
}
