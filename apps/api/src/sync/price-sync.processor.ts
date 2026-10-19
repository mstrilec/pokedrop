import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE } from '../queue/index.js';
import { ProviderSelectorService } from './providers/index.js';
import { PriceBatchService } from './price-batch.service.js';

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
