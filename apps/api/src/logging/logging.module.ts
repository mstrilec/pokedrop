import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { buildLoggerOptions } from './logger.options.js';

/**
 * Wraps nestjs-pino so the rest of the application imports one local module and
 * the pino options stay in one file.
 */
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
