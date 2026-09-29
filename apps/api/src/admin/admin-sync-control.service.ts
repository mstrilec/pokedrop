import { InjectQueue } from '@nestjs/bullmq';
import {
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  type HttpException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  ProviderBreakerStateSchema,
  SyncTriggerResultSchema,
  type ProviderBreakerStateDto,
  type SyncTriggerKind,
  type SyncTriggerResult,
} from '@pokedrop/shared';
import type { Queue } from 'bullmq';
import { AuditService } from '../audit/index.js';
import { domainError } from '../common/errors/domain-error.js';
import type { AuthUser } from '../common/request-auth.js';
import { CARD_SOURCE_NAMES } from '../config/index.js';
import { PrismaService } from '../prisma/index.js';
import { QUEUE, SYNC_DEDUP_ID, syncJobOptions, type DedupedSyncQueue } from '../queue/index.js';
import { RedisService, breakerKeys } from '../redis/index.js';
import { openUntilOf } from './admin-sync.service.js';
import { withTimeout } from './with-timeout.js';

/**
 * A catalog sync and a price sweep share one provider budget and one rate
 * ceiling; the crons keep them an hour apart, and a button would not. So each
 * trigger is refused while the other one holds its key.
 */
const TRIGGERS: Record<SyncTriggerKind, { queue: DedupedSyncQueue; blocker: DedupedSyncQueue }> = {
  CATALOG: { queue: QUEUE.catalogSync, blocker: QUEUE.priceSweep },
  PRICE: { queue: QUEUE.priceSweep, blocker: QUEUE.catalogSync },
};

const LABEL: Record<DedupedSyncQueue, string> = {
  [QUEUE.catalogSync]: 'A catalog sync',
  [QUEUE.priceSweep]: 'A price sweep',
};

@Injectable()
export class AdminSyncControlService {
  private readonly queues: Record<DedupedSyncQueue, Queue>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUE.catalogSync) catalogSync: Queue,
    @InjectQueue(QUEUE.priceSweep) priceSweep: Queue,
  ) {
    this.queues = { [QUEUE.catalogSync]: catalogSync, [QUEUE.priceSweep]: priceSweep };
  }

  /**
   * The audit row goes first and the enqueue second, inside one transaction:
   * Redis cannot join it, so the order decides what a failure leaves behind.
   * A failed or refused enqueue rolls the row back; a job is left unaudited
   * only by a failed COMMIT after the add, or by an add that timed out and
   * reached Redis later.
   */
  async trigger(admin: AuthUser, kind: SyncTriggerKind): Promise<SyncTriggerResult> {
    const { queue, blocker } = TRIGGERS[kind];

    const [own, other] = await this.redisCall(
      Promise.all([this.holderOf(queue), this.holderOf(blocker)]),
      'dedup read',
    );
    if (own !== null) {
      throw inProgress(queue, own);
    }
    if (other !== null) {
      throw inProgress(blocker, other);
    }

    const jobId = randomUUID();

    await this.prisma.withTransaction(async (tx) => {
      await this.audit.record(tx, {
        actorId: admin.id,
        action: 'sync.trigger',
        entity: 'SyncJob',
        entityId: jobId,
        meta: { kind, queue },
      });
      // Another trigger may have taken the key since the read above. A
      // deduplicated add stores nothing and returns the holder's id, from the
      // same atomic script that checked the key.
      const added = await this.redisCall(
        this.queues[queue].add(queue, {}, syncJobOptions(queue, jobId)),
        'enqueue',
      );
      if (added.id !== jobId) {
        throw inProgress(queue, added.id ?? 'unknown');
      }
    });

    return SyncTriggerResultSchema.parse({ jobId, kind });
  }

  async resetBreaker(admin: AuthUser, provider: string): Promise<ProviderBreakerStateDto> {
    if (!(CARD_SOURCE_NAMES as readonly string[]).includes(provider)) {
      throw new NotFoundException('Provider not found');
    }

    const failuresKey = breakerKeys.failures(provider);
    const openKey = breakerKeys.open(provider);
    const [raw, ttl] = await this.redisCall(
      Promise.all([this.redis.client.get(failuresKey), this.redis.client.ttl(openKey)]),
      'breaker read',
    );
    const counted = raw === null ? 0 : Number(raw);
    const failures = Number.isFinite(counted) ? counted : 0;
    const openUntil = openUntilOf(ttl);

    if (raw === null && openUntil === null) {
      return ProviderBreakerStateSchema.parse({ provider, failures: 0, openUntil: null });
    }

    await this.prisma.withTransaction(async (tx) => {
      await this.audit.record(tx, {
        actorId: admin.id,
        action: 'sync.breaker_reset',
        entity: 'Provider',
        entityId: provider,
        meta: { failures, openUntil: openUntil?.toISOString() ?? null },
      });
      await this.redisCall(this.redis.client.del(failuresKey, openKey), 'breaker reset');
    });

    return ProviderBreakerStateSchema.parse({ provider, failures: 0, openUntil: null });
  }

  private holderOf(queue: DedupedSyncQueue): Promise<string | null> {
    return this.queues[queue].getDeduplicationJobId(SYNC_DEDUP_ID[queue]);
  }

  private async redisCall<T>(promise: Promise<T>, label: string): Promise<T> {
    try {
      return await withTimeout(promise, label);
    } catch {
      throw new ServiceUnavailableException('The job queue is unavailable');
    }
  }
}

function inProgress(queue: DedupedSyncQueue, jobId: string): HttpException {
  return domainError(
    HttpStatus.CONFLICT,
    ERROR_CODES.SYNC_IN_PROGRESS,
    `${LABEL[queue]} is already queued or running (job ${jobId})`,
  );
}
