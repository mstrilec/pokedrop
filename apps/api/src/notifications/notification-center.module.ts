import { Module } from '@nestjs/common';
import { NotificationReadsService } from './notification-reads.service.js';
import { NotificationsController } from './notifications.controller.js';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationReadsService],
})
export class NotificationCenterModule {}
