import { Global, Module } from '@nestjs/common';
import { ThrottlerModule, normalizeIp } from '@nestjs/throttler';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { RedisService } from '../redis/index.js';
import { getAuthContext } from '../common/request-auth.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

/**
 * Exactly one throttler is registered, and it is named `default`.
 *
 * ThrottlerGuard applies every registered throttler to every route, and
 * `@SkipThrottle()` with no arguments skips only the one called `default`.
 * Registering `strict` and `moderate` here would apply them to all routes,
 * health probes included, and the decorator would not lift them.
 *
 * So the other two policies live elsewhere: `strict` is enforced by the Express
 * middleware in front of the auth handler, and `moderate` is applied per route
 * with `@Throttle({ default: { limit, ttl } })` when pack-open and trade
 * creation are built.
 */
@Global()
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      // Required by ThrottlerAsyncOptions and correctly empty: AppConfigModule
      // and RedisModule are both @Global, so what the factory injects is
      // already in scope.
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
        /**
         * Overridden so both halves of the API answer a 429 identically. The
         * library's default is "ThrottlerException: Too Many Requests", which
         * names its own class and would differ from the Express middleware's
         * body for the very same condition.
         */
        errorMessage: 'Too many requests',
        /**
         * The authenticated caller, falling back to the address.
         *
         * IP alone would punish everyone behind one corporate NAT for one
         * user's behaviour. normalizeIp groups an IPv6 client by subnet rather
         * than by address, so rotating within an allocation does not reset the
         * count.
         */
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
