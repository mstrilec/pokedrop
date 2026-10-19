import type { CardSourceName } from './env.schema.js';
import type { Env } from './env.schema.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

export function buildAppConfig(env: Env) {
  return {
    app: {
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
      isProduction: env.NODE_ENV === 'production',
      isDevelopment: env.NODE_ENV === 'development',
      corsOrigins: env.CORS_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
      trustProxyHops: env.TRUST_PROXY_HOPS,
      webBaseUrl: env.WEB_BASE_URL,
    },
    logging: {
      level: env.LOG_LEVEL,
    },
    db: {
      url: env.DATABASE_URL,
      queryLogging: env.DB_QUERY_LOGGING,
    },
    redis: {
      url: env.REDIS_URL,
      cacheDb: env.REDIS_CACHE_DB,
      queueDb: env.REDIS_QUEUE_DB,
    },
    cache: {
      ttl: {
        card: 86_400,
        cardPrice: 3_600,
        sets: 86_400,
        facets: 86_400,
        inventorySummary: 300,
      },
    },
    decks: {
      size: env.DECK_SIZE,
    },
    trades: {
      expiryDays: env.TRADE_EXPIRY_DAYS,
    },
    auth: {
      secret: env.AUTH_SECRET,
      baseUrl: env.AUTH_BASE_URL,

      cookieDomain: env.AUTH_COOKIE_DOMAIN ?? null,
      cookieSameSite: env.AUTH_COOKIE_SAME_SITE,

      secureCookies: env.AUTH_SECURE_COOKIES ?? env.NODE_ENV === 'production',
      verificationTtlSeconds: env.AUTH_VERIFICATION_TTL,
      resetTtlSeconds: env.AUTH_RESET_TTL,
    },
    providers: {
      active: env.CARD_SOURCE_PROVIDER,

      pokemonTcgApiKey: env.POKEMONTCG_API_KEY ?? null,
      pokemonTcgBaseUrl: env.POKEMONTCG_BASE_URL,
      tcgdexBaseUrl: env.TCGDEX_BASE_URL,

      dailyRequestBudget: {
        pokemontcg: env.POKEMONTCG_DAILY_REQUEST_BUDGET,
        tcgdex: null,
      } as Record<CardSourceName, number | null>,
    },
    priceSweep: {
      reserve: env.PRICE_SWEEP_RESERVE,

      maxStalls: env.PRICE_SWEEP_MAX_STALLS,
    },
    priceActive: {
      freshnessSeconds: env.PRICE_ACTIVE_FRESHNESS,

      tradeWindowDays: env.PRICE_ACTIVE_TRADE_WINDOW_DAYS,

      maxCards: env.PRICE_ACTIVE_MAX_CARDS,

      reserve: env.PRICE_ACTIVE_RESERVE,
    },
    priceRefresh: {
      cooldownSeconds: env.PRICE_REFRESH_COOLDOWN,

      reserve: env.PRICE_ONDEMAND_RESERVE,
    },
    queue: {
      concurrency: env.QUEUE_CONCURRENCY,
      syncSchedules: env.SYNC_SCHEDULES,
      defaults: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 86_400, count: 1_000 },
        // No dead-letter queue in BullMQ: the `failed` set is the dead letter, so keep it.
        removeOnFail: { age: 604_800 },
      },
    },
    throttle: {
      defaultLimit: env.THROTTLE_DEFAULT_LIMIT,
      defaultWindowMs: env.THROTTLE_DEFAULT_WINDOW * 1000,
      authLimit: env.THROTTLE_AUTH_LIMIT,
      authWindowMs: env.THROTTLE_AUTH_WINDOW * 1000,
      moderateLimit: env.THROTTLE_MODERATE_LIMIT,
      moderateWindowMs: env.THROTTLE_MODERATE_WINDOW * 1000,
    },
    mail: {
      smtpUrl: env.MAIL_SMTP_URL,
      from: env.MAIL_FROM,
      resendCooldownSeconds: env.MAIL_RESEND_COOLDOWN,
    },
  } as const;
}

export type AppConfig = ReturnType<typeof buildAppConfig>;
