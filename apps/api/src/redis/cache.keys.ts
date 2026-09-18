/**
 * The prefix is part of the key, deliberately not ioredis' `keyPrefix` option.
 * `keyPrefix` is not applied to SCAN's MATCH pattern, and the keys SCAN returns
 * come back already prefixed - feeding those to `del` on the same client
 * prefixes them a second time and deletes nothing, without raising an error.
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

export const cachePatterns = {
  allSets: () => key('set*'),
  allCards: () => key('card', '*'),
  allPrices: () => key('price', '*'),
  inventoryOf: (userId: string) => key('inv', 'summary', userId),
  everything: () => key('*'),
} as const;

/**
 * Not cache keys. CacheService treats a Redis failure as a miss and carries on,
 * which is correct for a cache and catastrophic for a lock: take this one with
 * SET NX PX directly.
 */
export const lockKeys = {
  packOpen: (openId: string) => `lock:open:${openId}`,
} as const;

/**
 * Outside the `cache:` namespace on purpose. A rate-limit counter living there
 * would be reset by every routine cache flush, handing an attacker a fresh
 * budget on each catalog sync.
 */
export const THROTTLE_NAMESPACE = 'throttle';

export const throttleKeys = {
  counter: (key: string) => `${THROTTLE_NAMESPACE}:${key}`,

  block: (key: string) => `${THROTTLE_NAMESPACE}:block:${key}`,

  resend: (email: string) => `${THROTTLE_NAMESPACE}:resend:${email.toLowerCase()}`,
} as const;
