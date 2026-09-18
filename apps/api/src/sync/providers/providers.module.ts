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
    {
      provide: CARD_SOURCE_REGISTRY,
      inject: [PokemonTcgClient],
      // PD-40 adds TcgdexClient beside it.
      useFactory: (pokemonTcg: PokemonTcgClient): CardSourceRegistry =>
        new Map<CardSourceName, CardSourceProvider>([[pokemonTcg.name, pokemonTcg]]),
    },
    {
      provide: CARD_SOURCE_PROVIDER,
      inject: [CARD_SOURCE_REGISTRY, APP_CONFIG],
      useFactory: (registry: CardSourceRegistry, config: AppConfig): CardSourceProvider => {
        const provider = registry.get(config.providers.active);

        if (!provider) {
          throw new Error(
            `No card source provider is registered for "${config.providers.active}". ` +
              'Providers are registered by PD-39 (pokemontcg) and PD-40 (tcgdex).',
          );
        }

        return provider;
      },
    },
  ],
  exports: [CARD_SOURCE_PROVIDER, CARD_SOURCE_REGISTRY],
})
export class ProvidersModule {}
