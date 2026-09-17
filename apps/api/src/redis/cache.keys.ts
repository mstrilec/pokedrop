/**
 * Every Redis key the cache touches is built here. Services must not write key
 * strings inline — a typo in a literal produces a silent permanent cache miss,
 * which looks like "the cache is a bit slow" rather than like a bug.
 *
 * Key shapes follow docs/Architecture.md section 8.
 */

/**
 * Prefix on every cache key, so that a pattern invalidation can never reach
 * BullMQ's keys even if the cache and queue databases are misconfigured to the
 * same number.
 *
 * It lives here rather than in ioredis' `keyPrefix` option deliberately.
 * `keyPrefix` is applied to key arguments but not to SCAN's MATCH pattern, and
 * the keys SCAN returns come back already prefixed — feeding those into `del`
 * on the same client prefixes them a second time and deletes nothing, without
 * raising an error. Building the prefix into the key makes it visible instead.
 */
export const CACHE_NAMESPACE = 'cache';

const key = (...parts: (string | number)[]): string => [CACHE_NAMESPACE, ...parts].join(':');

export const cacheKeys = {
  card: (cardId: string) => key('card', cardId),
  cardPrice: (cardId: string) => key('price', 'card', cardId),
  sets: () => key('sets'),
  set: (setId: string) => key('set', setId),
  facets: () => key('facets'),
  inventorySummary: (userId: string) => key('inv', 'summary', userId),
} as const;

/**
 * Glob patterns for `CacheService.invalidate`, named after the event that
 * triggers them rather than after the data, because that is how callers think:
 * a catalog sync finished, so catalog-derived entries must go.
 */
export const cachePatterns = {
  /** Matches both `cache:sets` and `cache:set:{id}` — hence `set*`, not `set:*`. */
  allSets: () => key('set*'),
  allCards: () => key('card', '*'),
  allPrices: () => key('price', '*'),
  inventoryOf: (userId: string) => key('inv', 'summary', userId),
  everything: () => key('*'),
} as const;

/**
 * Not a cache key. The pack-open idempotency lock shares this Redis but none of
 * the cache semantics: CacheService treats a Redis failure as a miss and keeps
 * going, which is correct for a cache and catastrophic for a lock. Whoever
 * implements pack opening must take this lock with SET NX PX directly, not
 * through CacheService.
 */
export const lockKeys = {
  packOpen: (openId: string) => `lock:open:${openId}`,
} as const;

/**
 * Also not a cache key, and for the same reason the lock above is not.
 *
 * CacheService.invalidate deletes by glob under `cache:`. A rate-limit counter
 * living there would be reset by every routine cache flush — a catalog sync
 * would hand an attacker a fresh budget, repeatedly and silently.
 *
 * The storage prepends these itself, so both enforcement points — the Nest
 * guard and the Express middleware in front of the auth handler — land in the
 * same namespace without either of them knowing the prefix.
 */
export const THROTTLE_NAMESPACE = 'throttle';

export const throttleKeys = {
  counter: (key: string) => `${THROTTLE_NAMESPACE}:${key}`,
  /** Separate key, so that clearing a block does not also clear the count. */
  block: (key: string) => `${THROTTLE_NAMESPACE}:block:${key}`,
  /**
   * Per-recipient floor between verification mails, keyed by address rather
   * than by caller — PD-36's limiter is per IP and does nothing against a
   * distributed flood of one person's inbox.
   */
  resend: (email: string) => `${THROTTLE_NAMESPACE}:resend:${email.toLowerCase()}`,
} as const;
