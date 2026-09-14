import { z } from 'zod';

/**
 * The raw environment, exactly as the process sees it.
 *
 * Everything arrives as a string, hence `z.coerce` on every number. Unknown
 * variables are deliberately allowed through: the environment always carries
 * PATH, HOME and a hundred others that are none of this application's business.
 */
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // 4000, not 3000: Next.js takes 3000 by default and `pnpm dev` starts both
    // apps at once.
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),

    // Comma-separated. Parsed into a list by buildAppConfig.
    CORS_ORIGINS: z.string().default('http://localhost:3000'),

    DATABASE_URL: z.string().min(1),

    // Off by default. Hunting N+1 queries is something you switch on
    // deliberately; logging every statement all through development just
    // trains you to ignore the output.
    DB_QUERY_LOGGING: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    REDIS_URL: z.string().min(1),
    REDIS_CACHE_DB: z.coerce.number().int().min(0).max(15).default(0),
    REDIS_QUEUE_DB: z.coerce.number().int().min(0).max(15).default(1),

    // Optional until Better Auth lands in PD-29, then required.
    AUTH_SECRET: z.string().min(32).optional(),

    // Optional permanently: pokemontcg.io serves unauthenticated callers at a
    // lower rate limit, so a missing key must not stop the app from booting.
    POKEMONTCG_API_KEY: z.string().min(1).optional(),
    POKEMONTCG_BASE_URL: z.url().default('https://api.pokemontcg.io/v2'),
    TCGDEX_BASE_URL: z.url().default('https://api.tcgdex.net/v2'),

    QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  })
  .refine((env) => env.REDIS_CACHE_DB !== env.REDIS_QUEUE_DB, {
    message:
      'REDIS_CACHE_DB and REDIS_QUEUE_DB must differ, or flushing the cache drops queued jobs',
    path: ['REDIS_QUEUE_DB'],
  });

export type Env = z.infer<typeof EnvSchema>;

/**
 * Parses the environment or aborts the process with a readable list of what is
 * wrong. Naming the offending variables is the whole point: a boot failure
 * should say which variable, not dump a stack trace.
 */
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
