import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';
import { RedisService, budgetKeys } from '../../redis/index.js';
import type { CardSourceName } from './card-source-provider.js';

/**
 * Two days. A run that starts before midnight and finishes after it writes to
 * two keys, and both should still be readable while an operator works out what
 * happened. Anything longer accumulates keys nobody reads.
 */
const KEY_TTL_SECONDS = 172_800;

export interface BudgetState {
  provider: CardSourceName;
  used: number;
  limit: number | null;
  remaining: number | null;
}

/**
 * The UTC day, as the key spells it.
 *
 * UTC for the reason `price.writer.ts` gives about `capturedOn`: two processes
 * that disagree about where a day begins disagree about how much of it has been
 * spent, and they would disagree the first time a server moved timezone.
 */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

@Injectable()
export class RequestBudgetService {
  private readonly logger = new Logger(RequestBudgetService.name);

  private readonly limits: Record<CardSourceName, number | null>;

  constructor(
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.limits = config.providers.dailyRequestBudget;
  }

  /**
   * One request left for this provider. Called immediately before the fetch,
   * from inside the retry loop, so retries are counted - at a 30% success rate
   * they are most of what a sweep spends.
   *
   * Never throws. A request that has already been made cannot be un-made by a
   * counter failing to record it, and turning that into an error would fail the
   * batch over bookkeeping.
   */
  async record(provider: CardSourceName): Promise<void> {
    const key = budgetKeys.spent(provider, utcDay(new Date()));

    try {
      // Pipelined, for the reason ProviderBreakerService gives: a crash between
      // a bare incr and a separate expire leaves a key with no TTL, and the
      // day's count quietly becomes the epoch's count.
      await this.redis.client.multi().incr(key).expire(key, KEY_TTL_SECONDS).exec();
    } catch (error) {
      this.logger.warn(`Could not count a request for ${provider}: ${describe(error)}`);
    }
  }

  async stateOf(provider: CardSourceName): Promise<BudgetState> {
    const limit = this.limits[provider] ?? null;

    try {
      const raw = await this.redis.client.get(budgetKeys.spent(provider, utcDay(new Date())));
      const parsed = raw === null ? 0 : Number(raw);
      const used = Number.isFinite(parsed) ? parsed : 0;

      return {
        provider,
        used,
        limit,
        remaining: limit === null ? null : Math.max(0, limit - used),
      };
    } catch (error) {
      this.logger.warn(`Could not read the budget for ${provider}: ${describe(error)}`);
      return { provider, used: 0, limit, remaining: limit };
    }
  }

  /**
   * Whether more than `reserve` requests remain unspent today.
   *
   * Fails open. With Redis unreachable `stateOf` already reports nothing spent,
   * so this answers true and the sweep proceeds. Failing closed would stop all
   * synchronisation on a Redis blip, while the cost of overshooting a budget is
   * a 429 - which the sweep is obliged to handle anyway, because this counter is
   * our estimate and never the provider's.
   */
  async hasHeadroom(provider: CardSourceName, reserve: number): Promise<boolean> {
    const state = await this.stateOf(provider);
    return state.remaining === null || state.remaining > reserve;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
