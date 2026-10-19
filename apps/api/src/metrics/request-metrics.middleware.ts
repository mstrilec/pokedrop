import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { MetricsCounterService } from './metrics-counter.service.js';

const API_PREFIX = '/api/v1/';
const HEALTH_PREFIX = '/api/v1/health';

/**
 * Express middleware, not a Nest interceptor: interceptors run after guards and never see a 401
 * from SessionGuard or a 404 from the not-found handler.
 */
export function createRequestMetricsMiddleware(counters: MetricsCounterService): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (
      request.method !== 'OPTIONS' &&
      request.path.startsWith(API_PREFIX) &&
      !request.path.startsWith(HEALTH_PREFIX)
    ) {
      response.on('finish', () => {
        counters.increment(
          ...(response.statusCode >= 500
            ? (['requests', 'server_errors'] as const)
            : (['requests'] as const)),
        );
      });
    }
    next();
  };
}
