import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RedisService, lockKeys } from '../redis/index.js';

export const PACK_OPEN_LOCK_MS = 10_000;

export type LockAttempt =
  { kind: 'acquired'; token: string } | { kind: 'held' } | { kind: 'unavailable' };

// Deletes the key only while it still holds our token: an expired lock taken
// over by another request must not be released by us.
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

/**
 * An optimisation, never the correctness boundary - the unique index on
 * PackOpening.openId is. Every Redis failure degrades to "no lock".
 */
@Injectable()
export class PackOpenLock {
  private readonly logger = new Logger(PackOpenLock.name);

  constructor(private readonly redis: RedisService) {}

  async acquire(openId: string): Promise<LockAttempt> {
    const token = randomUUID();
    try {
      const result = await this.redis.client.set(
        lockKeys.packOpen(openId),
        token,
        'PX',
        PACK_OPEN_LOCK_MS,
        'NX',
      );
      return result === 'OK' ? { kind: 'acquired', token } : { kind: 'held' };
    } catch (error) {
      this.logger.warn(`Pack-open lock unavailable, continuing without it: ${describe(error)}`);
      return { kind: 'unavailable' };
    }
  }

  async release(openId: string, token: string): Promise<void> {
    try {
      await this.redis.client.eval(RELEASE, 1, lockKeys.packOpen(openId), token);
    } catch (error) {
      this.logger.warn(
        `Could not release pack-open lock, leaving it to expire: ${describe(error)}`,
      );
    }
  }

  async isHeld(openId: string): Promise<boolean> {
    try {
      return (await this.redis.client.exists(lockKeys.packOpen(openId))) === 1;
    } catch {
      return false;
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
