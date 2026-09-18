import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface MappedError {
  statusCode: number;
  error: string;
  message: string;
}

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

    case 'P2010':
      return fromDriverAdapter(exception);

    default:
      return null;
  }
}

export function isUniqueViolation(exception: unknown): boolean {
  if (!(exception instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (exception.code === 'P2002') {
    return true;
  }

  return exception.code === 'P2010' && driverErrorKind(exception) === 'UniqueConstraintViolation';
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
      return null;
  }
}

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
