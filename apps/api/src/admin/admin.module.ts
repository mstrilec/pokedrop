import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/index.js';
import { AdminMetricsController } from './admin-metrics.controller.js';
import { AdminMetricsService } from './admin-metrics.service.js';
import { AdminController } from './admin.controller.js';
import { AdminSyncControlService } from './admin-sync-control.service.js';
import { AdminSyncService } from './admin-sync.service.js';

/**
 * QueueModule and nothing else. It brings producers only; SyncModule, which
 * holds the providers and processors, stays out, as it does for PricesModule.
 * PrismaModule, RedisModule, AuditModule and MetricsModule are global.
 */
@Module({
  imports: [QueueModule],
  controllers: [AdminController, AdminMetricsController],
  providers: [AdminSyncService, AdminSyncControlService, AdminMetricsService],
})
export class AdminModule {}
