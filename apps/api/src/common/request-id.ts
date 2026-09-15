import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Inbound ids are echoed into log lines and into the response body, so they are
 * accepted only in a shape that cannot do damage in either place: no newline to
 * forge a log record with, and no unbounded length to bloat every record that
 * carries it.
 */
const ACCEPTABLE_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * `id` is the field pino-http reads and writes, so PD-19 can adopt this by
 * returning the existing value from `genReqId` rather than generating its own.
 *
 * Deliberately not a global declaration merge on Express' Request: pino-http
 * declares `id` with a wider type, and two augmentations of the same property
 * would collide the moment that package arrives.
 */
type RequestWithId = Request & { id?: string };

export function setRequestId(request: Request, id: string): void {
  (request as RequestWithId).id = id;
}

export function getRequestId(request: Request): string | undefined {
  return (request as RequestWithId).id;
}

/**
 * Registered with `app.use` in main.ts rather than through a module's
 * MiddlewareConsumer. `setGlobalPrefix('api')` scopes consumer routes, which
 * would leave requests like `/nope` — the ones the not-found handler exists
 * for — without an id.
 */
export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const inbound = request.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;

  const id = candidate !== undefined && ACCEPTABLE_ID.test(candidate) ? candidate : randomUUID();

  setRequestId(request, id);
  response.setHeader('X-Request-Id', id);

  next();
}
