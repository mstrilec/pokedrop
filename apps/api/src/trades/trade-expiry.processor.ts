import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUE } from '../queue/index.js';
import { TradeExpiryService, type ExpiryResult } from './trade-expiry.service.js';

@Processor(QUEUE.tradeExpiry)
export class TradeExpiryProcessor extends WorkerHost {
  constructor(private readonly expiry: TradeExpiryService) {
    super();
  }

  /**
   * Throws after the whole run when any trade failed, so BullMQ records the
   * failure and retries; a retry is safe because expiry is idempotent.
   */
  async process(job: Job): Promise<ExpiryResult> {
    const result = await this.expiry.run();
    if (result.failed > 0) {
      throw new Error(`job ${job.id}: ${result.failed} trades could not be expired`);
    }
    return result;
  }
}
