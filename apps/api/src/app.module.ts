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
import { EconomyModule } from './economy/index.js';
import { MailModule } from './mail/index.js';
import { PrismaModule } from './prisma/index.js';
import { QueueModule } from './queue/index.js';
import { RedisModule } from './redis/index.js';
import { SyncModule } from './sync/index.js';
import { ThrottleModule } from './throttle/index.js';

@Module({
  imports: [
    AppConfigModule,
    AppLoggingModule,
    PrismaModule,
    RedisModule,
    ThrottleModule,
    MailModule,
    EconomyModule,
    AuthModule,
    HealthModule,
    QueueModule,
    SyncModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,

    // Order is load-bearing. CsrfGuard first, so a forged request is refused
    // before SessionGuard spends a lookup on it. ThrottlerGuard after
    // SessionGuard, because it keys on the authenticated user. RolesGuard last,
    // because it reads the caller SessionGuard resolved - reversed, it sees
    // nobody and rejects everything.
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
