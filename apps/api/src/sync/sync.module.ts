import { Module } from '@nestjs/common';
import { CatalogWriter } from './catalog.writer.js';
import { ProvidersModule } from './providers/index.js';

/**
 * The sync layer. Processors arrive with the tickets that own them: PD-42
 * (catalog sync), PD-48 (price sync), PD-74 (trade expiry).
 *
 * The provider registry is not here but in ProvidersModule, because registering
 * one means naming a concrete client and the lint rule sealing that folder
 * refuses that anywhere else.
 */
@Module({
  imports: [ProvidersModule],
  providers: [CatalogWriter],
  exports: [ProvidersModule, CatalogWriter],
})
export class SyncModule {}
