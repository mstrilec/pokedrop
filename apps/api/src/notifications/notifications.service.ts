import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/index.js';

export type NotificationEntry = {
  userId: string;
  type: string;
  payload: Prisma.InputJsonObject;
};

/**
 * Called after the triggering transaction commits, never inside it: a
 * notification that failed must not undo the trade it describes.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async notify(entries: NotificationEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    try {
      await this.prisma.notification.createMany({ data: entries });
    } catch (error) {
      const what = entries.map((entry) => `${entry.type} to ${entry.userId}`).join(', ');
      const why = error instanceof Error ? error.message : String(error);
      this.logger.error(`Notification write failed (${what}): ${why}`);
    }
  }
}
