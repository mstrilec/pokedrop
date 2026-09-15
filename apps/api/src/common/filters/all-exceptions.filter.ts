import { randomUUID } from 'node:crypto';
import { Catch, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SERVER_ERROR_FLOOR, buildErrorEnvelope, stackOf } from '../errors/error-envelope.js';
import { getRequestId } from '../request-id.js';

/**
 * Turns anything thrown inside the Nest pipeline into the envelope
 * docs/API.md specifies, so a caller never sees a raw Nest error or a stack
 * trace.
 *
 * Unmatched routes are handled separately by notFoundHandler — they never reach
 * a filter at all.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();

    // The middleware gives every request an id. The fallback covers a failure
    // raised before it ran, so that the envelope is never missing a field.
    const requestId = getRequestId(http.getRequest<Request>()) ?? randomUUID();

    const envelope = buildErrorEnvelope(exception, requestId);

    if (envelope.statusCode >= SERVER_ERROR_FLOOR) {
      // Only unexpected failures deserve a stack trace; a 400 is the caller's
      // problem, not an incident. The id is what ties this line to the response
      // the caller received.
      this.logger.error(`${requestId} ${String(exception)}`, stackOf(exception));
    }

    response.status(envelope.statusCode).json(envelope);
  }
}
