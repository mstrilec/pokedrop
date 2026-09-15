import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service.js';
import { RedisService } from './redis.service.js';

/**
 * Global for the same reason PrismaModule is: caching is cross-cutting, and
 * making every feature module declare the import would be noise.
 */
@Global()
@Module({
  providers: [RedisService, CacheService],
  exports: [RedisService, CacheService],
})
export class RedisModule {}
