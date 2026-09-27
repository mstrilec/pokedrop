import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  PriceRefreshResultSchema,
  type CardPrice,
  type PriceRefreshResult,
} from '@pokedrop/shared';
import type { Queue } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { QUEUE } from '../queue/index.js';
import { RedisService, throttleKeys } from '../redis/index.js';
import type { PriceSyncJob } from '../sync/index.js';
import { PricesService } from './prices.service.js';

/**
 * The first producer `price-sync` has ever had. PD-48 built the consumer and its
 * docblock has named this ticket since; PD-49 and PD-50 both declined to enqueue
 * here, each coordinating its own batches on its own queue, because a fan-out has
 * no good answer for which of many jobs closes a run. One card at a time has no
 * such question.
 */
@Injectable()
export class PriceRefreshService {
  private readonly logger = new Logger(PriceRefreshService.name);

  constructor(
    private readonly prices: PricesService,
    private readonly redis: RedisService,
    @InjectQueue(QUEUE.priceSync) private readonly queue: Queue<PriceSyncJob>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async refresh(cardId: string): Promise<PriceRefreshResult> {
    // First, and through PricesService rather than a query of its own: an id
    // that is not in the catalog must 404 before anything is spent or locked,
    // and reading the price the same way `GET /cards/:id/price` does is what
    // keeps the two responses from drifting apart in shape or conversion.
    const price = await this.prices.getLatest(cardId);

    const cooldown = this.config.priceRefresh.cooldownSeconds;
    const remaining = await this.takeCooldown(cardId, cooldown);

    if (remaining !== null) {
      return build(price, false, remaining);
    }

    const job = await this.queue.add('price-refresh', { cardIds: [cardId] });
    this.logger.log(`Enqueued a refresh of ${cardId} as job ${job.id}`);

    return build(price, true, cooldown);
  }

  /**
   * `SET NX EX` and, when it loses the race, the TTL of the key that won.
   *
   * Atomic on purpose. "Two requests inside the window enqueue one job" is this
   * ticket's first acceptance criterion, and a read-then-write sequence has a
   * gap between its two steps that both requests fit through - which would make
   * the criterion true most of the time rather than always.
   *
   * Returns null when the cooldown was taken, or the seconds remaining when it
   * was not.
   *
   * A Redis failure throws 503 rather than proceeding. This is a lock, and the
   * cache's failure-is-a-miss rule would let every request through at the moment
   * the system is least able to cope. Answering as though the cooldown were held
   * would be the other mistake: it would tell a caller their card was refreshed
   * recently when in fact nothing could be checked.
   */
  private async takeCooldown(cardId: string, ttlSeconds: number): Promise<number | null> {
    const key = throttleKeys.priceRefresh(cardId);

    try {
      const taken = await this.redis.client.set(key, '1', 'EX', ttlSeconds, 'NX');

      if (taken === 'OK') {
        return null;
      }

      // -2 for a key that expired between the two commands, -1 for one with no
      // expiry. Neither is a wait a client can act on, and the response schema
      // refuses a negative, so both become "ask again now" - which the next
      // request will win.
      const remaining = await this.redis.client.ttl(key);

      return remaining > 0 ? remaining : 0;
    } catch (error) {
      this.logger.warn(
        `Refresh cooldown unavailable for ${cardId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );

      throw new ServiceUnavailableException('Price refresh is unavailable');
    }
  }
}

function build(price: CardPrice, queued: boolean, retryAfterSeconds: number): PriceRefreshResult {
  return PriceRefreshResultSchema.parse({ ...price, queued, retryAfterSeconds });
}
