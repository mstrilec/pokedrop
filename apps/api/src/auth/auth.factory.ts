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

const SESSION_REFRESH_SECONDS = 60 * 60 * 24;

export interface AuthDependencies {
  prisma: PrismaService;
  mail: MailService;
  welcomeGrant: WelcomeGrantService;
  redis: RedisService;
}

export type AuthInstance = ReturnType<typeof buildAuth>;

export function buildAuth(config: AppConfig, deps: AuthDependencies) {
  if (!config.auth.secret) {
    throw new Error('AUTH_SECRET is required. Generate one with: openssl rand -base64 32');
  }

  const logger = new Logger('AuthMail');

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

    trustedOrigins: config.app.corsOrigins,

    emailAndPassword: {
      enabled: true,

      minPasswordLength: 12,

      requireEmailVerification: true,

      resetPasswordTokenExpiresIn: config.auth.resetTtlSeconds,

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

      sendOnSignUp: true,

      sendOnSignIn: true,

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

      freshAge: SESSION_LIFETIME_SECONDS,
    },

    advanced: {
      backgroundTasks: {
        handler: (promise: Promise<unknown>) => {
          void promise.catch((error: unknown) => {
            logger.error(
              `Background task failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        },
      },

      useSecureCookies: config.auth.secureCookies,

      defaultCookieAttributes: {
        ...(config.auth.cookieDomain === null ? {} : { domain: config.auth.cookieDomain }),
        sameSite: config.auth.cookieSameSite,
      },
    },

    user: {
      fields: {
        name: 'displayName',
        image: 'avatarUrl',
      },

      // `input: false` is the whole distance between a public registration form
      // and a self-granted admin account. Measured with it true, a sign-up body
      // carrying role:"ADMIN" produced an ADMIN user.
      additionalFields: {
        role: { type: 'string', required: true, defaultValue: 'MEMBER', input: false },
        currency: { type: 'number', required: true, defaultValue: 0, input: false },
      },
    },
  });
}
