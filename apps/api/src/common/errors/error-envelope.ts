import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorEnvelope } from '@pokedrop/shared';
import { mapPrismaError } from './prisma-error.js';

export const SERVER_ERROR_FLOOR = 500;

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

  return reasonPhrase(statusCode);
}

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
