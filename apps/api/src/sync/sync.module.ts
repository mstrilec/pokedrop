import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import {
  CARD_SOURCE_PROVIDER,
  CARD_SOURCE_REGISTRY,
  type CardSourceName,
  type CardSourceProvider,
  type CardSourceRegistry,
} from './providers/index.js';

/**
 * The sync layer's wiring.
 *
 * Deliberately not imported into AppModule by PD-38. Nest instantiates
 * providers eagerly, so wiring it while the registry is still empty would make
 * the refusal below fire on every boot and leave `dev` unable to start until
 * PD-39 landed — a guard against misconfiguration becoming the misconfiguration.
 * PD-39 wires it in the same commit that registers the first provider.
 *
 * Not @Global either: the processors in PD-42 and the catalog module in PD-45
 * import it explicitly, which keeps the dependency visible.
 */
@Module({
  providers: [
    {
      provide: CARD_SOURCE_REGISTRY,
      // Empty until PD-39 registers PokemonTcgClient and PD-40 TcgdexClient.
      useFactory: (): CardSourceRegistry => new Map<CardSourceName, CardSourceProvider>(),
    },
    {
      provide: CARD_SOURCE_PROVIDER,
      inject: [CARD_SOURCE_REGISTRY, APP_CONFIG],
      useFactory: (registry: CardSourceRegistry, config: AppConfig): CardSourceProvider => {
        const provider = registry.get(config.providers.active);

        if (!provider) {
          // Named at boot, in the style of parseEnv, rather than surfacing as a
          // null dereference inside a job at three in the morning.
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
export class SyncModule {}
