import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { getAuthContext } from '../request-auth.js';
import type { AuthUser } from '../request-auth.js';

/**
 * The signed-in user, as resolved by the session guard.
 *
 * Undefined only on a `@Public()` route reached anonymously — everywhere else
 * the guard has already rejected the request, so a controller can rely on it.
 *
 * This exists so that no handler ever reads a user id out of a body, a query
 * or a path parameter. An id that arrives from the client is a claim; this one
 * is a fact.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser | undefined => {
    const request = context.switchToHttp().getRequest<Request>();
    return getAuthContext(request)?.user;
  },
);
