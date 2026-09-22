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

      // Per provider, because the ceilings are not comparable. pokemontcg.io
      // documents 1 000 a day anonymously and sends no header to check it
      // against; TCGdex documents no limit at all and answered 64 of 64 under
      // concurrency, so null means uncapped rather than unknown.
      dailyRequestBudget: {
        pokemontcg: env.POKEMONTCG_DAILY_REQUEST_BUDGET,
        tcgdex: null,
      } as Record<CardSourceName, number | null>,
    },
    priceSweep: {
      // What the sweep leaves behind for everything else - principally the
      // catalog sync, which spends roughly 250 of the same allowance on its own
      // 83 pages.
      reserve: env.PRICE_SWEEP_RESERVE,

      // Consecutive 429 waits before the run gives up for the night.
      maxStalls: env.PRICE_SWEEP_MAX_STALLS,
    },
    priceActive: {
      // Equal to the cadence. Shorter re-fetches what the previous run just
      // wrote; longer leaves a run with nothing to do.
      freshnessSeconds: env.PRICE_ACTIVE_FRESHNESS,

      // How far back a trade still counts as evidence somebody cares about a
      // card. Nothing measured - the cheapest of these four to change later.
      tradeWindowDays: env.PRICE_ACTIVE_TRADE_WINDOW_DAYS,

      // The bound, and the setting that actually protects the budget. Unbounded
      // at four runs a day, an active set the size of the catalog would cost
      // roughly 960 requests of the 1 000 available.
      maxCards: env.PRICE_ACTIVE_MAX_CARDS,

      // Left unspent for everything else - by the time this job runs, that is
      // PD-52's on-demand traffic rather than the nightly jobs, which took
      // their share hours earlier.
      reserve: env.PRICE_ACTIVE_RESERVE,
    },
    queue: {
      concurrency: env.QUEUE_CONCURRENCY,
      defaults: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 86_400, count: 1_000 },
        // BullMQ has no dead-letter queue: a job that exhausts its attempts
        // stays in the `failed` set, and that set is the dead letter. `true`
        // would delete the evidence at the moment it became interesting;
        // `false` would keep every failure for ever in the same Redis database
        // as the queues.
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
