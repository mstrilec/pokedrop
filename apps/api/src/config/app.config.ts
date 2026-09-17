import type { Env } from './env.schema.js';

/**
 * Injection token for the typed configuration.
 *
 * Consumers inject this rather than `ConfigService`, whose `get()` returns
 * `T | undefined` — precisely the leak this module exists to prevent.
 */
export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Turns the flat environment into namespaced, already-parsed values: the comma
 * separated origin list becomes an array, NODE_ENV becomes a boolean anyone can
 * branch on, and nothing downstream has to re-interpret a string.
 */
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
      /**
       * Seconds, taken from the table in docs/Architecture.md section 8.
       *
       * Literals rather than environment variables on purpose. The point of
       * the rule is that no service writes 86_400 at a call site; these are
       * already the typed configuration layer, and six variables nobody will
       * ever set in any environment are just surface to keep in sync.
       */
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
      /** Null is valid and is the default: a host-only cookie. */
      cookieDomain: env.AUTH_COOKIE_DOMAIN ?? null,
      cookieSameSite: env.AUTH_COOKIE_SAME_SITE,
      /**
       * The tri-state environment variable collapses here, so nothing
       * downstream has to know that "unset" ever meant anything.
       */
      secureCookies: env.AUTH_SECURE_COOKIES ?? env.NODE_ENV === 'production',
    },
    providers: {
      /** Null is valid: the provider serves anonymous callers at a lower rate limit. */
      pokemonTcgApiKey: env.POKEMONTCG_API_KEY ?? null,
      pokemonTcgBaseUrl: env.POKEMONTCG_BASE_URL,
      tcgdexBaseUrl: env.TCGDEX_BASE_URL,
    },
    queue: {
      concurrency: env.QUEUE_CONCURRENCY,
    },
    throttle: {
      /**
       * Milliseconds, converted here and only here. The throttler takes
       * milliseconds for a window but reports the remainder in seconds, so the
       * asymmetry is worth confining to two files: this one and
       * redis-throttler.storage.ts.
       */
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
    },
  } as const;
}

export type AppConfig = ReturnType<typeof buildAppConfig>;
