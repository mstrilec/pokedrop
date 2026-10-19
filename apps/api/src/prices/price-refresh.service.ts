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
import { RequestBudgetService } from '../sync/providers/index.js';
import { PricesService } from './prices.service.js';

@Injectable()
export class PriceRefreshService {
  private readonly logger = new Logger(PriceRefreshService.name);

  constructor(
    private readonly prices: PricesService,
    private readonly budget: RequestBudgetService,
    private readonly redis: RedisService,
    @InjectQueue(QUEUE.priceSync) private readonly queue: Queue<PriceSyncJob>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async refresh(cardId: string): Promise<PriceRefreshResult> {
    const price = await this.prices.getLatest(cardId);

    // Before the cooldown, not after it. Taking the lock first and then finding
    // there is no budget would leave a key that has to be compensated with a
    // DEL - and that DEL can fail on exactly the Redis blip worth worrying
    // about, leaving a ten-minute cooldown on a card nothing refreshed.
    const headroom = await this.budget.hasHeadroom(
      this.config.providers.active,
      this.config.priceRefresh.reserve,
    );

    if (!headroom) {
      return build(price, false, secondsUntilUtcMidnight(new Date()));
    }

    const cooldown = this.config.priceRefresh.cooldownSeconds;
    const remaining = await this.takeCooldown(cardId, cooldown);

    if (remaining !== null) {
      return build(price, false, remaining);
    }

    try {
      const job = await this.queue.add('price-refresh', { cardIds: [cardId] });
      this.logger.log(`Enqueued a refresh of ${cardId} as job ${job.id}`);
    } catch (error) {
      await this.redis.client.del(throttleKeys.priceRefresh(cardId)).catch(() => undefined);

      this.logger.warn(
        `Refresh enqueue unavailable for ${cardId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );

      throw new ServiceUnavailableException('Price refresh is unavailable');
    }

    return build(price, true, cooldown);
  }

  /**
   * Atomic `SET NX EX`: a read-then-write would let two requests in the window both enqueue.
   * A Redis failure is a 503, never a pass - this is a lock, not a cache.
   */
  private async takeCooldown(cardId: string, ttlSeconds: number): Promise<number | null> {
    const key = throttleKeys.priceRefresh(cardId);

    try {
      const taken = await this.redis.client.set(key, '1', 'EX', ttlSeconds, 'NX');

      if (taken === 'OK') {
        return null;
      }

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

function secondsUntilUtcMidnight(at: Date): number {
  const nextMidnight = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1);

  return Math.ceil((nextMidnight - at.getTime()) / 1000);
}
