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

    // pino's levels. `silent` exists for the rare case of wanting a process
    // that says nothing at all.
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),

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

    // Required since PD-29. Signs session cookies and verification tokens, so
    // rotating it invalidates every session in existence.
    AUTH_SECRET: z.string().min(32),

    // The public origin the API is reached at. Better Auth builds callback and
    // cookie URLs from it, so a wrong value produces sign-ins that appear to
    // succeed and then have no session.
    AUTH_BASE_URL: z.url().default('http://localhost:4000'),

    // Unset means a host-only cookie: the browser returns it only to the exact
    // host that set it, which is the right default. Set it to a parent domain
    // (".pokedrop.app") when the web app and the API are different subdomains
    // of one site and have to share the session.
    AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),

    // `none` is correct only when the web app and the API are on different
    // registrable domains. It also removes the browser-side CSRF protection
    // that `lax` provides for free — CsrfGuard is what replaces it.
    AUTH_COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),

    // Tri-state on purpose: unset resolves to `NODE_ENV === 'production'` in
    // buildAppConfig. The `Secure` attribute and the `__Secure-` name prefix
    // move together inside Better Auth, so this is the only switch for both.
    AUTH_SECURE_COOKIES: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === 'true')),

    // Optional permanently: pokemontcg.io serves unauthenticated callers at a
    // lower rate limit, so a missing key must not stop the app from booting.
    POKEMONTCG_API_KEY: z.string().min(1).optional(),
    POKEMONTCG_BASE_URL: z.url().default('https://api.pokemontcg.io/v2'),
    TCGDEX_BASE_URL: z.url().default('https://api.tcgdex.net/v2'),

    // Which provider the sync layer reads from. pokemontcg.io is primary per
    // docs/PRD.md section 15, and stays primary despite answering 500 on
    // /v2/cards on 2026-09-18: it is the only one of the two with a bulk path
    // to full card data - up to 250 cards per request against TCGdex's one,
    // which is roughly 80 requests for a full catalog against 20 000.
    //
    // Changing this value is the whole of "changing provider". No code moves.
    CARD_SOURCE_PROVIDER: z.enum(['pokemontcg', 'tcgdex']).default('pokemontcg'),

    QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),

    // How many proxies sit in front of this process. Express uses it to decide
    // which entry of X-Forwarded-For is the real client.
    //
    // 0 is correct for direct exposure and for local development. Behind one
    // load balancer it is 1. Never `true`: trusting every proxy lets a client
    // send its own X-Forwarded-For and therefore choose its own rate-limit key,
    // which both evades its limit and lets it exhaust somebody else's.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

    // Windows are seconds here and milliseconds in buildAppConfig. The
    // throttler wants milliseconds; no .env file should contain 900000.
    THROTTLE_DEFAULT_LIMIT: z.coerce.number().int().min(1).default(100),
    THROTTLE_DEFAULT_WINDOW: z.coerce.number().int().min(1).default(60),

    // Sign-in, sign-up and the reset routes. Ten attempts a quarter of an hour
    // is generous for a person and ruinous for a script walking a list.
    THROTTLE_AUTH_LIMIT: z.coerce.number().int().min(1).default(10),
    THROTTLE_AUTH_WINDOW: z.coerce.number().int().min(1).default(900),

    // Pack opening and trade creation, applied when those routes exist.
    THROTTLE_MODERATE_LIMIT: z.coerce.number().int().min(1).default(30),
    THROTTLE_MODERATE_WINDOW: z.coerce.number().int().min(1).default(60),

    // One URL rather than five variables: nodemailer parses host, port,
    // credentials and TLS mode out of it, so changing vendor — Resend, SES,
    // Postmark, Mailgun — is an environment change and not a code change.
    // `smtp://` is plain or STARTTLS; `smtps://` is implicit TLS on 465.
    //
    // The default points at the Mailpit container, so a fresh clone sends mail
    // successfully with no mail configuration at all.
    MAIL_SMTP_URL: z.string().min(1).default('smtp://localhost:1025'),

    // RFC 5322 display form is accepted: `PokeDrop <no-reply@example.com>`.
    MAIL_FROM: z.string().min(1).default('PokeDrop <no-reply@pokedrop.local>'),

    // Where the web application is served. Verification and reset links bounce
    // through the API and land here, so a wrong value produces a mail whose
    // link verifies the account and then shows an error page.
    WEB_BASE_URL: z.url().default('http://localhost:3000'),

    // How long a verification link is good for. Better Auth's default is an
    // hour; it is explicit here because the ticket asks for expiry to be
    // documented, and because a short value is what makes the expired-token
    // path measurable without forging a token.
    AUTH_VERIFICATION_TTL: z.coerce.number().int().min(1).default(3600),

    // How long a password-reset link is good for. Shorter than the
    // verification link on purpose: a reset token in the wrong hands takes
    // over an account, while a verification token only proves an address.
    AUTH_RESET_TTL: z.coerce.number().int().min(1).default(900),

    // Per-address floor between two verification mails. PD-36's limiter is
    // keyed by the address of the *caller*; this one is keyed by the address
    // of the recipient, which is what stops a distributed flood of somebody
    // else's inbox.
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
