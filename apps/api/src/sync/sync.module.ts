import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import {
  CARD_SOURCE_PROVIDER,
  CARD_SOURCE_REGISTRY,
  type CardSourceName,
  type CardSourceProvider,
  type CardSourceRegistry,
} from './providers/index.js';

@Module({
  providers: [
    {
      provide: CARD_SOURCE_REGISTRY,

      useFactory: (): CardSourceRegistry => new Map<CardSourceName, CardSourceProvider>(),
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
export class SyncModule {}
