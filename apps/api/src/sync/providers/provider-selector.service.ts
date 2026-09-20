import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';
import {
  CARD_SOURCE_REGISTRY,
  type CardSourceName,
  type CardSourceProvider,
  type CardSourceRegistry,
} from './card-source-provider.js';
import { ProviderUnavailableError } from './provider.errors.js';
import { ProviderBreakerService } from './provider-breaker.service.js';

export interface ProviderChoice {
  provider: CardSourceProvider;

  /**
   * True when this is not the configured primary. The processor uses it to
   * apply the two rules that keep a failover from forking the catalog, so it is
   * load-bearing rather than informational.
   */
  isFallback: boolean;

  reason: string;
}

@Injectable()
export class ProviderSelectorService {
  private readonly logger = new Logger(ProviderSelectorService.name);

  private readonly primary: CardSourceName;

  constructor(
    @Inject(CARD_SOURCE_REGISTRY) private readonly registry: CardSourceRegistry,
    private readonly breaker: ProviderBreakerService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.primary = config.providers.active;
  }

  /**
   * Asked once per run and never per page.
   *
   * Switching mid-run would put two id vocabularies inside one SyncRun - pages
   * 1-40 written as sv4-25 and 41-83 as sv04-25 - and the run's `provider`
   * column could then name only one of the two sources that wrote it. That is
   * the fork this whole design exists to prevent, arriving through the door
   * marked resilience.
   */
  async select(): Promise<ProviderChoice> {
    const primary = this.mustResolve(this.primary);

    if (!(await this.breaker.isOpen(this.primary))) {
      return { provider: primary, isFallback: false, reason: 'configured primary' };
    }

    for (const [name, provider] of this.registry) {
      if (name === this.primary) {
        continue;
      }

      if (!(await this.breaker.isOpen(name))) {
        this.logger.warn(
          `Breaker open for ${this.primary}; this run will use ${name} as a fallback`,
        );
        return {
          provider,
          isFallback: true,
          reason: `breaker open for ${this.primary}`,
        };
      }
    }

    // Every registered provider is failing. Running anyway would spend a sweep
    // on a source already known to be down, and the mirror is no less current
    // for being left alone.
    throw new ProviderUnavailableError(
      this.primary,
      'every registered provider has an open breaker',
    );
  }

  /**
   * The provider a resumed run must keep using.
   *
   * Asking select() again would let a BullMQ retry continue a run on a
   * different source than the one its row names. The breaker can flip during a
   * sweep, and the two providers' page numbers are unrelated - a cursor at page
   * 41 means 10 000 cards into one provider's list and something else entirely
   * in the other's, so the resumed half would skip what it was meant to refresh
   * and the run's `provider` column would name a source that did not write it.
   *
   * Returns null when that provider's breaker has opened in the meantime: the
   * caller closes the run rather than continuing against a source known to be
   * down.
   */
  async resume(providerName: string): Promise<ProviderChoice | null> {
    // The column is a free string by design, so a name that is no longer
    // registered reads as a miss here rather than as a type error.
    const name = providerName as CardSourceName;
    const provider = this.registry.get(name);

    if (!provider) {
      throw new Error(
        `A run recorded provider "${providerName}", which is not registered. ` +
          'Registration lives in providers.module.ts, beside the clients themselves.',
      );
    }

    if (await this.breaker.isOpen(name)) {
      return null;
    }

    return {
      provider,
      isFallback: name !== this.primary,
      reason: `resuming a run recorded against ${name}`,
    };
  }

  private mustResolve(name: CardSourceName): CardSourceProvider {
    const provider = this.registry.get(name);

    if (!provider) {
      throw new Error(
        `No card source provider is registered for "${name}". ` +
          'Registration lives in providers.module.ts, beside the clients themselves.',
      );
    }

    return provider;
  }
}
