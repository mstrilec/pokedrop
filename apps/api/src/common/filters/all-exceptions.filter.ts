import { randomUUID } from 'node:crypto';
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { ErrorEnvelope } from '@pokedrop/shared';
import type { Response } from 'express';

/** At or above this the failure is ours, not the caller's. */
const SERVER_ERROR_FLOOR = 500;

/**
 * Turns anything thrown inside the Nest pipeline into the envelope
 * docs/API.md specifies, so a caller never sees a raw Nest error or a stack
 * trace.
 *
 * `requestId` is generated here for now. PD-18 replaces it with a correlation
 * id propagated from the inbound request and shared with the logger; the
 * envelope shape stays the same.
 *
 * Routes that match nothing never enter the pipeline, so Express answers those
 * with its own HTML 404. Shaping those is PD-18's job too.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = randomUUID();

    const statusCode: number =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const envelope: ErrorEnvelope = {
      statusCode,
      error: errorNameFor(exception, statusCode),
      message: messageFor(exception, statusCode),
      requestId,
    };

    if (statusCode >= SERVER_ERROR_FLOOR) {
      // Only unexpected failures deserve a stack trace; a 400 is the caller's
      // problem, not an incident.
      this.logger.error(`${requestId} ${String(exception)}`, stackOf(exception));
    }

    response.status(statusCode).json(envelope);
  }
}

function errorNameFor(exception: unknown, statusCode: number): string {
  if (exception instanceof HttpException) {
    const body = exception.getResponse();

    if (typeof body === 'object' && body !== null && 'error' in body) {
      const { error } = body as { error?: unknown };
      if (typeof error === 'string') {
        return error;
      }
    }

    return exception.name;
  }

  return statusCode >= SERVER_ERROR_FLOOR ? 'Internal Server Error' : 'Error';
}

function messageFor(exception: unknown, statusCode: number): string {
  // An unexpected failure must not leak its internals to the caller.
  if (statusCode >= SERVER_ERROR_FLOOR) {
    return 'Internal server error';
  }

  if (exception instanceof HttpException) {
    const body = exception.getResponse();

    if (typeof body === 'string') {
      return body;
    }

    if (typeof body === 'object' && body !== null && 'message' in body) {
      const { message } = body as { message?: unknown };

      if (typeof message === 'string') {
        return message;
      }

      if (Array.isArray(message)) {
        return message.map(String).join('; ');
      }
    }

    return exception.message;
  }

  return 'Unexpected error';
}

function stackOf(exception: unknown): string | undefined {
  return exception instanceof Error ? exception.stack : undefined;
}
