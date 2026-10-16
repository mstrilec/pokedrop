import { Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Logger } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from './config/index.js';
import { WorkerModule } from './worker.module.js';

// The @Cron names in sync/*.scheduler.ts. Trade expiry is not a sync and stays.
const SYNC_CRONS = ['catalog-sync', 'price-sweep', 'price-active'] as const;

/**
 * createApplicationContext rather than create: this process accepts no
 * requests, so it has no adapter, no port and nothing listening.
 *
 * What keeps it alive with no processors registered is the open Redis and
 * Postgres sockets their modules hold - worth knowing before PD-42 adds the
 * first processor, because "the worker exited immediately" would otherwise look
 * like a bug in the new code.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  // BullMQ closes its workers in onModuleDestroy and its close() waits for the
  // job in flight, so a processor halfway through a transaction finishes.
  //
  // On Windows this is reachable through SIGINT only: Node has no real POSIX
  // signal delivery there and SIGTERM kills the process before the hooks run.
  app.enableShutdownHooks();

  const logger = new NestLogger('Worker');

  // After the context is up, because the scheduler mounts its crons during
  // bootstrap. An unknown name throws, so a renamed cron stops the worker.
  if (!app.get<AppConfig>(APP_CONFIG).queue.syncSchedules) {
    const registry = app.get(SchedulerRegistry);
    for (const name of SYNC_CRONS) {
      registry.deleteCronJob(name);
    }
    logger.log(`Sync schedules off (SYNC_SCHEDULES=false): removed ${SYNC_CRONS.join(', ')}`);
  }

  logger.log('Worker started');
}

await bootstrap();
