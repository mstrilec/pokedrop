import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';
import { RedisService, budgetKeys } from '../../redis/index.js';
import type { CardSourceName } from './card-source-provider.js';

const KEY_TTL_SECONDS = 172_800;

export interface BudgetState {
  provider: CardSourceName;
  used: number;
  limit: number | null;
  remaining: number | null;
}

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

  async hasHeadroom(provider: CardSourceName, reserve: number): Promise<boolean> {
    const state = await this.stateOf(provider);
    return state.remaining === null || state.remaining > reserve;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
