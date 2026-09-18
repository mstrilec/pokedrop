import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

const ACCEPTABLE_ID = /^[A-Za-z0-9._-]{1,128}$/;

type RequestWithId = Request & { id?: string };

export function setRequestId(request: Request, id: string): void {
  (request as RequestWithId).id = id;
}

export function getRequestId(request: Request): string | undefined {
  return (request as RequestWithId).id;
}

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
