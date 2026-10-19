/**
 * The prefix is part of the key, not ioredis' `keyPrefix`: SCAN's MATCH ignores keyPrefix and
 * returns prefixed keys, so `del` would prefix them twice and silently delete nothing.
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
  adminMetrics: (days: number) => key('admin', 'metrics', days),
} as const;

export const cachePatterns = {
  allSets: () => key('set*'),
  allCards: () => key('card', '*'),
  allPrices: () => key('price', '*'),
  inventoryOf: (userId: string) => key('inv', 'summary', userId),
  everything: () => key('*'),
} as const;

/**
 * Not cache keys: CacheService treats a Redis failure as a miss, which is fatal for a lock. Take
 * this one with SET NX PX directly.
 */
export const lockKeys = {
  packOpen: (openId: string) => `lock:open:${openId}`,
} as const;

/** Outside the `cache:` namespace: a cache flush must not reset a rate limit. */
export const THROTTLE_NAMESPACE = 'throttle';

export const throttleKeys = {
  counter: (key: string) => `${THROTTLE_NAMESPACE}:${key}`,

  block: (key: string) => `${THROTTLE_NAMESPACE}:block:${key}`,

  resend: (email: string) => `${THROTTLE_NAMESPACE}:resend:${email.toLowerCase()}`,

  priceRefresh: (cardId: string) => `${THROTTLE_NAMESPACE}:price:refresh:${cardId}`,
} as const;

/**
 * Outside the `cache:` namespace, and read through RedisService, never CacheService: a flush or a
 * failure-as-miss must not reset a breaker.
 */
export const BREAKER_NAMESPACE = 'breaker';

export const breakerKeys = {
  failures: (provider: string) => `${BREAKER_NAMESPACE}:fail:${provider}`,

  open: (provider: string) => `${BREAKER_NAMESPACE}:open:${provider}`,
} as const;

/**
 * Outside the `cache:` namespace, and read through RedisService, never CacheService: a flush or a
 * failure-as-miss must not reset a day's request count.
 */
export const BUDGET_NAMESPACE = 'budget';

export const budgetKeys = {
  spent: (provider: string, day: string) => `${BUDGET_NAMESPACE}:${provider}:${day}`,
} as const;

/**
 * Outside the `cache:` namespace for the reason `breakerKeys` is: a routine
 * cache flush must not reset a day's request count.
 */
export const METRICS_NAMESPACE = 'metrics';

export const METRIC_COUNTERS = [
  'requests',
  'server_errors',
  'pack_fallbacks',
  'pack_unavailable',
] as const;

export type MetricCounter = (typeof METRIC_COUNTERS)[number];

export const metricsKeys = {
  counter: (name: MetricCounter, day: string) => `${METRICS_NAMESPACE}:${name}:${day}`,
} as const;
