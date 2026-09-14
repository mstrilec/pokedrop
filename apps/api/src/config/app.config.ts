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
    auth: {
      /** Null until PD-29 makes it required. */
      secret: env.AUTH_SECRET ?? null,
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
  } as const;
}

export type AppConfig = ReturnType<typeof buildAppConfig>;
