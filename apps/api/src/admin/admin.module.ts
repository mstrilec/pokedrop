import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/index.js';
import { AdminMetricsController } from './admin-metrics.controller.js';
import { AdminMetricsService } from './admin-metrics.service.js';
import { AdminController } from './admin.controller.js';
import { AdminSyncControlService } from './admin-sync-control.service.js';
import { AdminSyncService } from './admin-sync.service.js';

@Module({
  imports: [QueueModule],
  controllers: [AdminController, AdminMetricsController],
  providers: [AdminSyncService, AdminSyncControlService, AdminMetricsService],
})
export class AdminModule {}
