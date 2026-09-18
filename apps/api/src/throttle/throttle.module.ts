import { Global, Module } from '@nestjs/common';
import { ThrottlerModule, normalizeIp } from '@nestjs/throttler';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { RedisService } from '../redis/index.js';
import { getAuthContext } from '../common/request-auth.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

@Global()
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [],
      inject: [APP_CONFIG, RedisService],
      useFactory: (config: AppConfig, redis: RedisService) => ({
        storage: new RedisThrottlerStorage(redis),
        throttlers: [
          {
            name: 'default',
            limit: config.throttle.defaultLimit,
            ttl: config.throttle.defaultWindowMs,
          },
        ],

        errorMessage: 'Too many requests',

        getTracker: (req: Record<string, unknown>) => {
          const request = req as unknown as Request;
          const user = getAuthContext(request)?.user;
          return user ? `user:${user.id}` : `ip:${normalizeIp(request.ip ?? 'unknown')}`;
        },
      }),
    }),
  ],
  providers: [RedisThrottlerStorage],
  exports: [ThrottlerModule, RedisThrottlerStorage],
})
export class ThrottleModule {}
