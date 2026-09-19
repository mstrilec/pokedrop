import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

/**
 * An empty `imports` is the third acceptance criterion rather than an omission.
 *
 * PrismaModule is @Global(), so PrismaService injects without one. SyncModule is
 * not, so the CARD_SOURCE_PROVIDER token is not in this module's context -
 * injecting a provider here would fail at boot rather than reach the network at
 * runtime.
 */
@Module({
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
