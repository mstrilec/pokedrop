import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/index.js';
import { utcDayOf } from './utc-day.js';

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);
  private day = '';
  private seen = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  touch(userId: string): void {
    const today = utcDayOf(new Date());
    if (today !== this.day) {
      this.day = today;
      this.seen = new Set();
    }
    if (this.seen.has(userId)) {
      return;
    }
    this.seen.add(userId);

    this.prisma.$executeRaw`
      INSERT INTO user_activity ("userId", day) VALUES (${userId}, ${today}::date)
      ON CONFLICT DO NOTHING`.catch((error: unknown) => {
      this.seen.delete(userId);
      this.logger.warn(
        `Could not record activity for ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
}
