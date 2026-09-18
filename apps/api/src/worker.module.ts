import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/index.js';
import { WorkerLoggingModule } from './logging/index.js';
import { PrismaModule } from './prisma/index.js';
import { QueueModule } from './queue/index.js';
import { RedisModule } from './redis/index.js';

/**
 * Deliberately not AppModule. That one brings controllers, four global guards,
 * Better Auth, mail and the health routes; a process that answers no requests
 * needs none of it, and booting the auth module here would mean a second
 * process holding session-signing capability for no reason.
 *
 * Processors arrive with the tickets that own them: PD-42 (catalog sync),
 * PD-48 (price sync), PD-74 (trade expiry).
 */
@Module({
  imports: [AppConfigModule, WorkerLoggingModule, PrismaModule, RedisModule, QueueModule],
})
export class WorkerModule {}
