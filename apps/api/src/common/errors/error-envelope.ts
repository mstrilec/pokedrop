import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorEnvelope } from '@pokedrop/shared';
import { mapPrismaError } from './prisma-error.js';

/** At or above this the failure is ours, not the caller's. */
export const SERVER_ERROR_FLOOR = 500;

/**
 * The single place the docs/API.md envelope is constructed. The global filter
 * and the not-found handler both go through here, so an unmatched route and a
 * thrown exception cannot drift into two different shapes.
 */
export function buildErrorEnvelope(exception: unknown, requestId: string): ErrorEnvelope {
  const mapped = mapPrismaError(exception);

  if (mapped) {
    return { ...mapped, requestId };
  }

  const statusCode: number =
    exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

  return {
    statusCode,
    error: errorNameFor(exception, statusCode),
    message: messageFor(exception, statusCode),
    requestId,
  };
}

export function stackOf(exception: unknown): string | undefined {
  return exception instanceof Error ? exception.stack : undefined;
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
  }

  // Not exception.name: Nest omits `error` from the body of a no-argument
  // HttpException, and answering "NotFoundException" there would both diverge
  // from the reason phrase docs/API.md shows and name the framework class to
  // anyone probing the API.
  return reasonPhrase(statusCode);
}

/** `404` becomes `Not Found`, via the HttpStatus enum's reverse mapping. */
function reasonPhrase(statusCode: number): string {
  const constantName: unknown = (HttpStatus as Record<number, unknown>)[statusCode];

  if (typeof constantName !== 'string') {
    return statusCode >= SERVER_ERROR_FLOOR ? 'Internal Server Error' : 'Error';
  }

  return constantName
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
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
