import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { SessionGuard } from './common/guards/session.guard.js';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe.js';
import { AuthModule } from './auth/index.js';
import { AppConfigModule } from './config/index.js';
import { HealthModule } from './health/health.module.js';
import { AppLoggingModule } from './logging/index.js';
import { PrismaModule } from './prisma/index.js';
import { RedisModule } from './redis/index.js';

/**
 * The pipe and filter are registered through APP_PIPE and APP_FILTER rather
 * than app.useGlobalPipes in main.ts so they participate in dependency
 * injection — PD-18 will want the logger and config inside the filter.
 */
@Module({
  imports: [AppConfigModule, AppLoggingModule, PrismaModule, RedisModule, AuthModule, HealthModule],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
