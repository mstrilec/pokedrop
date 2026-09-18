import { randomUUID } from 'node:crypto';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AUTH_BASE_PATH } from '../auth/index.js';
import { buildErrorEnvelope } from '../common/errors/error-envelope.js';
import { getRequestId } from '../common/request-id.js';
import type { AppConfig } from '../config/index.js';
import type { RedisThrottlerStorage } from './redis-throttler.storage.js';

const CREDENTIAL_PATHS = new Set([
  `${AUTH_BASE_PATH}/sign-in/email`,
  `${AUTH_BASE_PATH}/sign-up/email`,
  `${AUTH_BASE_PATH}/reset-password`,
  `${AUTH_BASE_PATH}/request-password-reset`,
  `${AUTH_BASE_PATH}/send-verification-email`,
]);

const TOO_MANY_REQUESTS_MESSAGE = 'Too many requests';

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

        const envelope = buildErrorEnvelope(
          new HttpException(TOO_MANY_REQUESTS_MESSAGE, HttpStatus.TOO_MANY_REQUESTS),
          getRequestId(request) ?? randomUUID(),
        );

        response.status(HttpStatus.TOO_MANY_REQUESTS).json(envelope);
      })
      .catch(() => {
        next();
      });
  };
}
