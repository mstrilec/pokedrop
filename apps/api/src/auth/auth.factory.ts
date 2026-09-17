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
    },

    advanced: {
      /**
       * Secure cookies in production only — a Secure cookie over plain http is
       * simply dropped, which would make local development look like a broken
       * login rather than a configuration choice.
       */
      useSecureCookies: config.app.isProduction,
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
