import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { buildLoggerOptions } from './logger.options.js';

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
