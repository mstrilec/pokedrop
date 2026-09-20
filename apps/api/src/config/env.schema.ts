import { z } from 'zod';

export const CARD_SOURCE_NAMES = ['pokemontcg', 'tcgdex'] as const;

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    PORT: z.coerce.number().int().min(1).max(65535).default(4000),

    CORS_ORIGINS: z.string().default('http://localhost:3000'),

    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),

    DATABASE_URL: z.string().min(1),

    DB_QUERY_LOGGING: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    REDIS_URL: z.string().min(1),
    REDIS_CACHE_DB: z.coerce.number().int().min(0).max(15).default(0),
    REDIS_QUEUE_DB: z.coerce.number().int().min(0).max(15).default(1),

    AUTH_SECRET: z.string().min(32),

    AUTH_BASE_URL: z.url().default('http://localhost:4000'),

    AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),

    AUTH_COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),

    AUTH_SECURE_COOKIES: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === 'true')),

    POKEMONTCG_API_KEY: z.string().min(1).optional(),
    POKEMONTCG_BASE_URL: z.url().default('https://api.pokemontcg.io/v2'),
    TCGDEX_BASE_URL: z.url().default('https://api.tcgdex.net/v2'),

    CARD_SOURCE_PROVIDER: z.enum(CARD_SOURCE_NAMES).default('pokemontcg'),

    QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),

    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

    THROTTLE_DEFAULT_LIMIT: z.coerce.number().int().min(1).default(100),
    THROTTLE_DEFAULT_WINDOW: z.coerce.number().int().min(1).default(60),

    THROTTLE_AUTH_LIMIT: z.coerce.number().int().min(1).default(10),
    THROTTLE_AUTH_WINDOW: z.coerce.number().int().min(1).default(900),

    THROTTLE_MODERATE_LIMIT: z.coerce.number().int().min(1).default(30),
    THROTTLE_MODERATE_WINDOW: z.coerce.number().int().min(1).default(60),

    MAIL_SMTP_URL: z.string().min(1).default('smtp://localhost:1025'),

    MAIL_FROM: z.string().min(1).default('PokeDrop <no-reply@pokedrop.local>'),

    WEB_BASE_URL: z.url().default('http://localhost:3000'),

    AUTH_VERIFICATION_TTL: z.coerce.number().int().min(1).default(3600),

    AUTH_RESET_TTL: z.coerce.number().int().min(1).default(900),

    MAIL_RESEND_COOLDOWN: z.coerce.number().int().min(1).default(60),
  })
  .refine((env) => env.REDIS_CACHE_DB !== env.REDIS_QUEUE_DB, {
    message:
      'REDIS_CACHE_DB and REDIS_QUEUE_DB must differ, or flushing the cache drops queued jobs',
    path: ['REDIS_QUEUE_DB'],
  })
  .refine(
    (env) => {
      const secureCookies = env.AUTH_SECURE_COOKIES ?? env.NODE_ENV === 'production';
      return env.AUTH_COOKIE_SAME_SITE !== 'none' || secureCookies;
    },
    {
      message:
        'AUTH_COOKIE_SAME_SITE=none requires secure cookies. Every current browser ' +
        'silently discards a SameSite=None cookie that lacks Secure, so the symptom is ' +
        'a sign-in that returns 200 and leaves the user signed out, with no error in ' +
        'the browser or the server log. Set AUTH_SECURE_COOKIES=true and serve over ' +
        'https, or leave AUTH_COOKIE_SAME_SITE at lax.',
      path: ['AUTH_COOKIE_SAME_SITE'],
    },
  );

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(raw: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);

  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const name = issue.path.join('.') || '(root)';
      return `  · ${name}: ${issue.message}`;
    });
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }

  return result.data;
}
