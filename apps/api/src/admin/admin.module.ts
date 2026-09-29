import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/index.js';
import { AdminController } from './admin.controller.js';
import { AdminSyncService } from './admin-sync.service.js';

/**
 * QueueModule and nothing else. It brings producers only; SyncModule, which
 * holds the providers and processors, stays out, as it does for PricesModule.
 * PrismaModule, RedisModule and AuditModule are global.
 */
@Module({
  imports: [QueueModule],
  controllers: [AdminController],
  providers: [AdminSyncService],
})
export class AdminModule {}
