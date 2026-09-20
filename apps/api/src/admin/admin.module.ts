import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminSyncService } from './admin-sync.service.js';

/**
 * An empty `imports` is deliberate, the same way CatalogModule's is.
 * PrismaModule and RedisModule are @Global(), so their services inject without
 * one - and SyncModule is not, so this module cannot reach a provider or a
 * queue even by accident. The sync runs in the worker process; this answers in
 * the API process; they share a database and a Redis, not a module.
 */
@Module({
  controllers: [AdminController],
  providers: [AdminSyncService],
})
export class AdminModule {}
