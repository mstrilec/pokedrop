import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';
import {
  CARD_SOURCE_REGISTRY,
  type CardSourceName,
  type CardSourceProvider,
  type CardSourceRegistry,
} from './card-source-provider.js';
import { chooseProvider } from './provider-choice.js';
import { ProviderUnavailableError } from './provider.errors.js';
import { ProviderBreakerService } from './provider-breaker.service.js';

export interface ProviderChoice {
  provider: CardSourceProvider;

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
   * Once per run, never per page: switching mid-run would mix two id vocabularies in one run and
   * fork the catalog.
   */
  async select(): Promise<ProviderChoice> {
    const names = [...this.registry.keys()];
    const open = new Set<CardSourceName>();
    for (const name of names) {
      if (await this.breaker.isOpen(name)) {
        open.add(name);
      }
    }

    const chosen = chooseProvider(this.primary, names, open);

    if (chosen === null) {
      throw new ProviderUnavailableError(
        this.primary,
        'every registered provider has an open breaker',
      );
    }

    const provider = this.mustResolve(chosen.name);

    if (!chosen.isFallback) {
      return { provider, isFallback: false, reason: 'configured primary' };
    }

    this.logger.warn(
      `Breaker open for ${this.primary}; this run will use ${chosen.name} as a fallback`,
    );
    return { provider, isFallback: true, reason: `breaker open for ${this.primary}` };
  }

  /**
   * A resumed run keeps its row's provider: the providers' page numbers are unrelated, so a retry
   * on another source would skip cards. Null when that breaker has opened since.
   */
  async resume(providerName: string): Promise<ProviderChoice | null> {
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
