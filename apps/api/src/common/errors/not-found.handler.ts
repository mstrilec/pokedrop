import { randomUUID } from 'node:crypto';
import { HttpStatus, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { getRequestId } from '../request-id.js';
import { buildErrorEnvelope } from './error-envelope.js';

/**
 * Requests that match no route never enter the Nest pipeline, so the global
 * filter never sees them and Express answers with its own HTML. Registering
 * this after `app.init()` puts it behind the Nest router, where it catches
 * exactly what the router did not.
 *
 * The message names no path. Reflecting the requested URL back into the
 * response body buys nothing the caller does not already know, and the request
 * id is enough to find the matching log line.
 */
export function notFoundHandler(request: Request, response: Response): void {
  const requestId = getRequestId(request) ?? randomUUID();
  const envelope = buildErrorEnvelope(new NotFoundException('Route not found'), requestId);

  response.status(HttpStatus.NOT_FOUND).json(envelope);
}
