import { Module } from '@nestjs/common';
import { NotificationReadsService } from './notification-reads.service.js';
import { NotificationsController } from './notifications.controller.js';

/**
 * The HTTP half, kept apart from NotificationsModule so the worker can import
 * the writer without a controller.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationReadsService],
})
export class NotificationCenterModule {}
