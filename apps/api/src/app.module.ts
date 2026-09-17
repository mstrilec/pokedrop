import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { CsrfGuard } from './common/guards/csrf.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { SessionGuard } from './common/guards/session.guard.js';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe.js';
import { AuthModule } from './auth/index.js';
import { AppConfigModule } from './config/index.js';
import { HealthModule } from './health/health.module.js';
import { AppLoggingModule } from './logging/index.js';
import { MailModule } from './mail/index.js';
import { PrismaModule } from './prisma/index.js';
import { RedisModule } from './redis/index.js';
import { ThrottleModule } from './throttle/index.js';

/**
 * The pipe and filter are registered through APP_PIPE and APP_FILTER rather
 * than app.useGlobalPipes in main.ts so they participate in dependency
 * injection — PD-18 will want the logger and config inside the filter.
 */
@Module({
  imports: [
    AppConfigModule,
    AppLoggingModule,
    PrismaModule,
    RedisModule,
    ThrottleModule,
    MailModule,
    AuthModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Order is load-bearing: global guards run in the order they are provided.
    // CsrfGuard is first so a forged request is refused on a header check
    // rather than after SessionGuard has spent a database round-trip resolving
    // the session it was trying to abuse. ThrottlerGuard comes after
    // SessionGuard because it keys on the authenticated user, who is not on the
    // request until SessionGuard puts them there — the cost is one lookup spent
    // on a flood that carries a valid cookie, and SessionGuard does no lookup
    // at all when there is no cookie. RolesGuard is last because it reads the
    // caller SessionGuard resolved; reversed, it sees nobody and rejects
    // everything.
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
