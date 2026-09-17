import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import type { AppConfig } from '../config/index.js';
import type { PrismaService } from '../prisma/index.js';
import { AUTH_BASE_PATH } from './auth.constants.js';

const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7;

/** How often an active session's expiry is pushed forward. */
const SESSION_REFRESH_SECONDS = 60 * 60 * 24;

export type AuthInstance = ReturnType<typeof buildAuth>;

/**
 * Builds the Better Auth instance from the application's own dependencies.
 *
 * It takes PrismaService rather than constructing a client, which is what makes
 * "sessions and accounts are written by the same client as domain tables" true
 * by construction instead of by convention: there is no second connection pool
 * for it to use.
 */
export function buildAuth(prisma: PrismaService, config: AppConfig) {
  if (!config.auth.secret) {
    throw new Error('AUTH_SECRET is required. Generate one with: openssl rand -base64 32');
  }

  return betterAuth({
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    secret: config.auth.secret,
    baseURL: config.auth.baseUrl,
    basePath: AUTH_BASE_PATH,

    /**
     * The browser sends credentials from a different port in development and
     * potentially a different host in production, so the allowlist is the same
     * one CORS uses. Better Auth rejects anything else outright.
     */
    trustedOrigins: config.app.corsOrigins,

    emailAndPassword: {
      enabled: true,
      /**
       * Hashing is Better Auth's own scrypt, deliberately not overridden: a
       * hand-rolled password hash is the last thing this project should own.
       * The result lands on accounts.password, never on the user row.
       */
      minPasswordLength: 12,
      /**
       * PD-31 turns this on together with the verification email. Until a mail
       * transport exists, requiring verification would lock out every account
       * the moment it is created.
       */
      requireEmailVerification: false,
    },

    session: {
      expiresIn: SESSION_LIFETIME_SECONDS,
      updateAge: SESSION_REFRESH_SECONDS,
      /**
       * Better Auth defaults this to one day, and in this configuration it
       * gates exactly two endpoints: list-sessions and unlink-account. The
       * second is unreachable — no social provider is configured — so the
       * default's only effect is that the device list stops working a day
       * into a seven-day session.
       *
       * That is the wrong endpoint to close. The three revoke-* calls, which
       * fix a compromise, are behind sensitiveSessionMiddleware and are not
       * age-gated at all; list-sessions is the one that makes a compromise
       * visible in the first place, by showing an IP and a user agent the
       * owner does not recognise. Measured in PD-35: a three-day-old session
       * could revoke every other session but could not list them.
       *
       * Matching the session lifetime keeps the list readable for as long as
       * the session it describes. Deliberately not 0, which disables the check
       * globally and for good, including for the re-authentication PD-32 and a
       * future account deletion will want.
       */
      freshAge: SESSION_LIFETIME_SECONDS,
    },

    advanced: {
      /**
       * Secure cookies in production by default — a Secure cookie over plain
       * http is simply dropped, which would make local development look like a
       * broken login rather than a configuration choice. AUTH_SECURE_COOKIES
       * overrides it for a staging environment that does serve https.
       *
       * This is deliberately the only switch for `secure`. Better Auth ties the
       * attribute to the `__Secure-` name prefix in the same expression
       * (cookies/index.mjs:34), so setting `secure` through
       * defaultCookieAttributes below would let the prefix and the attribute
       * disagree with each other.
       */
      useSecureCookies: config.auth.secureCookies,

      /**
       * Spread into Better Auth's cookie defaults after its own `domain` and
       * before the per-cookie overrides (cookies/index.mjs:38), so these two
       * win while the session cookie's maxAge survives.
       *
       * `path` is deliberately absent and stays at the library's `/`. A cookie
       * path is not a security boundary — any document on the origin reaches a
       * sibling path through the DOM — and both /api/auth/* and /api/v1/* need
       * the cookie, so `/` is the only correct value. A configuration knob with
       * one admissible setting is not configuration.
       */
      defaultCookieAttributes: {
        ...(config.auth.cookieDomain === null ? {} : { domain: config.auth.cookieDomain }),
        sameSite: config.auth.cookieSameSite,
      },
    },

    user: {
      /**
       * Better Auth's core calls these `name` and `image`. The schema uses our
       * own names, and this mapping is what keeps the adapter pointed at
       * columns that exist — remove it and every query fails.
       */
      fields: {
        name: 'displayName',
        image: 'avatarUrl',
      },

      /**
       * `input: false` is the whole of PD-22's third acceptance criterion. With
       * `input: true`, a sign-up body carrying `role: "ADMIN"` creates an
       * administrator — measured, not assumed.
       */
      additionalFields: {
        role: { type: 'string', required: true, defaultValue: 'MEMBER', input: false },
        currency: { type: 'number', required: true, defaultValue: 0, input: false },
      },
    },
  });
}
