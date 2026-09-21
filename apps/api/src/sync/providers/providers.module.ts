import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';
import {
  CARD_SOURCE_PROVIDER,
  CARD_SOURCE_REGISTRY,
  type CardSourceName,
  type CardSourceProvider,
  type CardSourceRegistry,
} from './card-source-provider.js';
import { PokemonTcgClient } from './pokemon-tcg/pokemon-tcg.client.js';
import { ProviderBreakerService } from './provider-breaker.service.js';
import { ProviderSelectorService } from './provider-selector.service.js';
import { RequestBudgetService } from './request-budget.service.js';
import { TcgdexClient } from './tcgdex/tcgdex.client.js';

/**
 * Registration lives inside this folder on purpose.
 *
 * Naming a concrete provider is unavoidable somewhere, and the lint rule that
 * seals this folder refuses it anywhere else - correctly. Keeping it here is
 * also what makes PD-38's first acceptance criterion literally true: adding or
 * swapping a provider changes no file outside `sync/providers/`.
 */
@Module({
  providers: [
    PokemonTcgClient,
    ProviderBreakerService,
    ProviderSelectorService,
    RequestBudgetService,
    TcgdexClient,
    {
      provide: CARD_SOURCE_REGISTRY,
      inject: [PokemonTcgClient, TcgdexClient],
      useFactory: (pokemonTcg: PokemonTcgClient, tcgdex: TcgdexClient): CardSourceRegistry =>
        new Map<CardSourceName, CardSourceProvider>([
          [pokemonTcg.name, pokemonTcg],
          [tcgdex.name, tcgdex],
        ]),
    },
    {
      provide: CARD_SOURCE_PROVIDER,
      inject: [CARD_SOURCE_REGISTRY, APP_CONFIG],
      useFactory: (registry: CardSourceRegistry, config: AppConfig): CardSourceProvider => {
        const provider = registry.get(config.providers.active);

        if (!provider) {
          throw new Error(
            `No card source provider is registered for "${config.providers.active}". ` +
              'Registration lives in this module, beside the clients themselves.',
          );
        }

        return provider;
      },
    },
  ],
  exports: [
    CARD_SOURCE_PROVIDER,
    CARD_SOURCE_REGISTRY,
    ProviderBreakerService,
    ProviderSelectorService,
    RequestBudgetService,
  ],
})
export class ProvidersModule {}
