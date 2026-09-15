import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface MappedError {
  statusCode: number;
  error: string;
  message: string;
}

/**
 * Turns a Prisma failure into an HTTP status, or returns null to let it fall
 * through as a 500.
 *
 * Messages here are deliberately generic: a constraint name identifies a table
 * and a column, and the caller of a generic endpoint has no business learning
 * the schema. Services that need "that email is already taken" should catch the
 * failure themselves and throw a ConflictException with a domain message — this
 * mapping is the safety net underneath them, not the source of UI copy.
 */
export function mapPrismaError(exception: unknown): MappedError | null {
  if (!(exception instanceof Prisma.PrismaClientKnownRequestError)) {
    return null;
  }

  switch (exception.code) {
    case 'P2002':
      return conflict('A record with these values already exists');

    case 'P2003':
      return conflict('A related record is missing or still referenced');

    case 'P2025':
      return {
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: 'Resource not found',
      };

    // Raw queries do not go through the query engine's error translation, so a
    // unique violation arrives as "raw query failed" with the real cause buried
    // in meta. Without this branch every raw-path conflict would be a 500.
    case 'P2010':
      return fromDriverAdapter(exception);

    default:
      return null;
  }
}

function conflict(message: string): MappedError {
  return { statusCode: HttpStatus.CONFLICT, error: 'Conflict', message };
}

function fromDriverAdapter(exception: Prisma.PrismaClientKnownRequestError): MappedError | null {
  switch (driverErrorKind(exception)) {
    case 'UniqueConstraintViolation':
      return conflict('A record with these values already exists');

    case 'ForeignKeyConstraintViolation':
      return conflict('A related record is missing or still referenced');

    default:
      // An unrecognised raw failure is genuinely our problem. Let it be a 500
      // rather than inventing a status that hides it.
      return null;
  }
}

/** Reads `meta.driverAdapterError.cause.kind`, which is typed as unknown. */
function driverErrorKind(exception: Prisma.PrismaClientKnownRequestError): string | undefined {
  const meta: unknown = exception.meta;
  const driverAdapterError = propertyOf(meta, 'driverAdapterError');
  const cause = propertyOf(driverAdapterError, 'cause');
  const kind = propertyOf(cause, 'kind');

  return typeof kind === 'string' ? kind : undefined;
}

function propertyOf(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
}
