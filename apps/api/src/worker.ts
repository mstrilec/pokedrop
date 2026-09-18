import { Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module.js';

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

  new NestLogger('Worker').log('Worker started');
}

await bootstrap();
