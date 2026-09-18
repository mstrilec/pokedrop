import { Logger } from '@nestjs/common';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import type { AppConfig } from '../config/index.js';
import type { WelcomeGrantService } from '../economy/index.js';
import type { MailService, RenderedMail } from '../mail/index.js';
import { passwordResetEmail, verificationEmail } from '../mail/index.js';
import { throttleKeys } from '../redis/index.js';
import type { PrismaService } from '../prisma/index.js';
import type { RedisService } from '../redis/index.js';
import { AUTH_BASE_PATH } from './auth.constants.js';

const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7;

/** How often an active session's expiry is pushed forward. */
const SESSION_REFRESH_SECONDS = 60 * 60 * 24;

/**
 * Everything the factory needs from the application, as one named object.
 *
 * It was two positional parameters in PD-29 and three in PD-132, and this
 * ticket would have made it five. A list that grows by one per ticket is a
 * list that eventually gets its arguments in the wrong order; a field cannot
 * be transposed with its neighbour.
 */
export interface AuthDependencies {
  prisma: PrismaService;
  mail: MailService;
  welcomeGrant: WelcomeGrantService;
  redis: RedisService;
}

export type AuthInstance = ReturnType<typeof buildAuth>;

/**
 * Builds the Better Auth instance from the application's own dependencies.
 *
 * It takes PrismaService rather than constructing a client, which is what makes
 * "sessions and accounts are written by the same client as domain tables" true
 * by construction instead of by convention: there is no second connection pool
 * for it to use.
 */
export function buildAuth(config: AppConfig, deps: AuthDependencies) {
  if (!config.auth.secret) {
    throw new Error('AUTH_SECRET is required. Generate one with: openssl rand -base64 32');
  }

  const logger = new Logger('AuthMail');

  /**
   * The delivery policy for auth mail: log a failure, never rethrow it.
   *
   * Better Auth writes the user row before calling these, so failing the
   * response would report a failed sign-up for one that partly succeeded — and
   * the caller's retry would then hit "that address is already taken", which is
   * the worst of both outcomes. The recovery path is the resend endpoint in
   * PD-31.
   *
   * `error` rather than `warn`: a relay that will not accept mail is a real
   * failure, even though it is not the caller's.
   */
  const deliver = async (to: string, rendered: RenderedMail): Promise<void> => {
    try {
      await deps.mail.send({ to, ...rendered });
    } catch (error) {
      logger.error(
        `Failed to deliver "${rendered.subject}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  /**
   * Whether enough time has passed to mail this address again.
   *
   * PD-36's limiter is keyed by the caller's address, which does nothing
   * against a distributed flood of one person's inbox. This is keyed by the
   * recipient, and it has to live here because it is the first layer where the
   * address is readable — the handler needs the raw body, so the Express
   * middleware runs before any parser.
   *
   * Nothing leaks by suppressing a send. The provider's own constant-time
   * floor sits above this callback and answers `{ status: true }` after the
   * same 500 ms either way.
   *
   * Fails open, like the rate limiter: a mail not sent is worse than a mail
   * sent twice.
   */
  const cooldownAllows = async (email: string): Promise<boolean> => {
    try {
      const result = await deps.redis.client.set(
        throttleKeys.resend(email),
        '1',
        'EX',
        config.mail.resendCooldownSeconds,
        'NX',
      );

      return result === 'OK';
    } catch (error) {
      logger.warn(
        `Resend cooldown check failed, sending anyway: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return true;
    }
  };

  /**
   * Fills in a `callbackURL` when the caller gave none.
   *
   * Better Auth builds the link from AUTH_BASE_URL and redirects to
   * `callbackURL` afterwards; sign-up supplies none, so it defaults to `/` —
   * the API's root, which has no route. Measured in PD-132: the account is
   * verified and the person is looking at a 404.
   *
   * The link is repaired rather than rebuilt. Constructing it here would
   * duplicate the provider's own URL shape and break silently the day it
   * changes, and it would also override a client that had supplied a
   * perfectly good callback of its own.
   */
  const withCallback = (url: string, fallback: string): string => {
    const parsed = new URL(url);
    const current = parsed.searchParams.get('callbackURL');

    if (current === null || current === '/') {
      parsed.searchParams.set('callbackURL', fallback);
    }

    return parsed.toString();
  };

  return betterAuth({
    database: prismaAdapter(deps.prisma, { provider: 'postgresql' }),
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
       * Verification is the gate, as `docs/UserFlows.md` §1 describes. Without
       * it the welcome grant hangs from an event nobody has to reach, and
       * anyone can register against an address they do not own.
       *
       * It does not add an enumeration oracle. The 403 this produces sits
       * after the password check — a wrong password is still 401 — so it is
       * only visible to someone who already holds valid credentials and
       * therefore already knows the account exists. Checked in the provider
       * rather than assumed, because otherwise it would have cost the property
       * PD-30 measured.
       *
       * In production this couples sign-in to deliverability: with no working
       * relay, nobody can sign in at all. SPF, DKIM, DMARC and a sending
       * domain are a release blocker, not a nicety — noted on PD-126.
       */
      requireEmailVerification: true,

      /**
       * Short, and shorter than the verification link. A stolen reset token
       * takes over an account; a stolen verification token only proves an
       * address.
       */
      resetPasswordTokenExpiresIn: config.auth.resetTtlSeconds,

      /**
       * A reset is the response to "someone else may have my password", so
       * every existing session has to go — including the attacker's. Better
       * Auth deletes them itself (password.mjs:171); doing it in
       * `onPasswordReset` instead would duplicate that.
       *
       * PD-35 measured that revocation is not age-gated, so this holds however
       * old the sessions are.
       */
      revokeSessionsOnPasswordReset: true,

      sendResetPassword: async ({ user, url }) => {
        await deliver(
          user.email,
          passwordResetEmail({
            displayName: user.name,
            url: withCallback(url, `${config.app.webBaseUrl}/reset-password`),
          }),
        );
      },
    },

    emailVerification: {
      expiresIn: config.auth.verificationTtlSeconds,

      /**
       * Explicitly true, and this is load-bearing. The default is `undefined`,
       * which means "follow requireEmailVerification" — and that is false, so
       * without this line no verification mail is ever sent and the transport
       * looks broken.
       */
      sendOnSignUp: true,

      /**
       * What makes mandatory verification survivable. When an unverified user
       * tries to sign in, the provider sends a fresh link before refusing —
       * so "my link expired" is solved by trying again, and no separate
       * recovery flow has to exist.
       */
      sendOnSignIn: true,

      /**
       * Runs after `emailVerified` is already written, so an exception escaping
       * here would show an error to someone who is in fact verified — and the
       * link cannot be retried, because the token is spent. Hence catch and
       * log.
       *
       * The residual is real: a user whose grant failed is verified with a
       * zero balance, and nothing retries it. The unique constraint makes any
       * later retry safe, but the trigger for one belongs with the admin
       * tooling in M10.
       */
      afterEmailVerification: async (user) => {
        try {
          await deps.welcomeGrant.grantIfFirstTime(user.id);
        } catch (error) {
          logger.error(
            `Welcome grant failed for ${user.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      },

      sendVerificationEmail: async ({ user, url }) => {
        if (!(await cooldownAllows(user.email))) {
          logger.log('Verification mail suppressed by the resend cooldown');
          return;
        }

        // `user.name`, not `user.displayName`: the user.fields mapping below
        // renames the column, so the provider's model field is `name`.
        await deliver(
          user.email,
          verificationEmail({
            displayName: user.name,
            url: withCallback(url, `${config.app.webBaseUrl}/verify-email`),
          }),
        );
      },
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
       * Stops a mail send from holding the response open, which is what makes
       * `request-password-reset` a timing oracle.
       *
       * Without a handler here, `runInBackgroundOrAwait`
       * (create-context.mjs:215) simply awaits — so the branch that finds a
       * user pays for a full SMTP exchange and the branch that does not pays
       * for one dummy lookup. Measured before this line: 708.8 ms against
       * 1.9 ms over 15 samples each. The bodies were already identical; the
       * clock gave it away anyway.
       *
       * The promise is detached deliberately. Failures are already caught and
       * logged inside `deliver`, so nothing new becomes invisible, and the
       * `catch` here is the guard against a rejection nobody owns crashing the
       * process.
       */
      backgroundTasks: {
        handler: (promise: Promise<unknown>) => {
          void promise.catch((error: unknown) => {
            logger.error(
              `Background task failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        },
      },

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
