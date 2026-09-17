import { randomUUID } from 'node:crypto';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AUTH_BASE_PATH } from '../auth/index.js';
import { buildErrorEnvelope } from '../common/errors/error-envelope.js';
import { getRequestId } from '../common/request-id.js';
import type { AppConfig } from '../config/index.js';
import type { RedisThrottlerStorage } from './redis-throttler.storage.js';

/**
 * The routes that spend a password, create an account, or mail a link.
 *
 * An explicit list rather than the whole prefix, because GET
 * /api/auth/get-session is called by the frontend on every page load. A strict
 * limit over all of /api/auth/* would throttle that first and hardest, and the
 * application would appear to sign people out at random.
 *
 * send-verification-email was missed when this list was written in PD-36. It
 * is unauthenticated and takes an arbitrary address, so under the default
 * limit it was a mail cannon pointed at anybody at a hundred a minute. The
 * per-recipient cooldown in auth.factory.ts bounds the rest.
 */
const CREDENTIAL_PATHS = new Set([
  `${AUTH_BASE_PATH}/sign-in/email`,
  `${AUTH_BASE_PATH}/sign-up/email`,
  `${AUTH_BASE_PATH}/reset-password`,
  `${AUTH_BASE_PATH}/request-password-reset`,
  `${AUTH_BASE_PATH}/send-verification-email`,
]);

/**
 * The same text ThrottleModule passes as `errorMessage`, so a 429 reads
 * identically whichever half of the API produced it.
 */
const TOO_MANY_REQUESTS_MESSAGE = 'Too many requests';

/**
 * Rate limiting for the Better Auth handler, which `main.ts` mounts on the
 * Express instance outside the Nest router — where no guard can reach it.
 *
 * Keyed by address and path, never by the email in the body. Two reasons, and
 * the second makes the first moot: a limiter that behaved differently for
 * addresses that exist would hand back exactly the oracle the provider avoids
 * by hashing a dummy password (PD-30 measured 81.7 ms against 80.0 ms), and the
 * handler needs the raw body, so this runs before any parser and has no body to
 * read.
 */
export function createAuthThrottleMiddleware(
  storage: RedisThrottlerStorage,
  config: AppConfig,
): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    const isCredentialPath = CREDENTIAL_PATHS.has(request.path);

    const limit = isCredentialPath ? config.throttle.authLimit : config.throttle.defaultLimit;
    const windowMs = isCredentialPath
      ? config.throttle.authWindowMs
      : config.throttle.defaultWindowMs;

    // `auth` rather than a throttler name the guard also uses, so that a
    // credential attempt and a call to a same-named Nest route cannot share a
    // bucket.
    const key = `${request.ip ?? 'unknown'}:${request.path}`;

    void storage
      .increment(key, windowMs, limit, windowMs, 'auth')
      .then((record) => {
        if (!record.isBlocked) {
          response.setHeader('X-RateLimit-Limit', limit);
          response.setHeader('X-RateLimit-Remaining', Math.max(0, limit - record.totalHits));
          response.setHeader('X-RateLimit-Reset', record.timeToExpire);
          next();
          return;
        }

        response.setHeader('Retry-After', record.timeToBlockExpire);

        // The same helper the Nest filter uses, so the two halves cannot drift
        // into two different 429 bodies.
        //
        // It must be given a real HttpException, not a plain object shaped like
        // one: buildErrorEnvelope reads the status via `instanceof
        // HttpException` and falls back to 500 "Internal server error" for
        // anything else. A rate-limited caller being told the server broke is
        // both wrong and alarming.
        const envelope = buildErrorEnvelope(
          new HttpException(TOO_MANY_REQUESTS_MESSAGE, HttpStatus.TOO_MANY_REQUESTS),
          getRequestId(request) ?? randomUUID(),
        );

        response.status(HttpStatus.TOO_MANY_REQUESTS).json(envelope);
      })
      .catch(() => {
        // The storage already fails open and logs; this is the guard against a
        // programming error in the branch above hanging the request forever.
        next();
      });
  };
}
