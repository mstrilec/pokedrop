import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { buildLoggerOptions, buildWorkerLoggerOptions } from './logger.options.js';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => buildLoggerOptions(config),
    }),
  ],
  exports: [LoggerModule],
})
export class AppLoggingModule {}

/**
 * The same wrapper for the worker entrypoint, differing only in which options
 * factory it calls. Both read one transport decision.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => buildWorkerLoggerOptions(config),
    }),
  ],
  exports: [LoggerModule],
})
export class WorkerLoggingModule {}
