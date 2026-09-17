import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Roles } from '../decorators/roles.decorator.js';
import { getAuthContext } from '../request-auth.js';

/**
 * Runs after SessionGuard, which has already put the caller on the request.
 * Registration order in app.module.ts is what guarantees that — reverse it and
 * this guard sees nobody and rejects everything.
 *
 * Routes with no @Roles() pass straight through: authentication is the session
 * guard's job, and every route is already protected by default.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride(Roles, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = getAuthContext(request)?.user;

    if (!user) {
      // Reachable only when a route is both @Public() and @Roles(), which is a
      // contradiction. 401 rather than 403: the caller has no identity at all,
      // so "forbidden" would be describing a decision that was never made.
      throw new UnauthorizedException('Authentication required');
    }

    if (!required.includes(user.role as (typeof required)[number])) {
      throw new ForbiddenException('Insufficient role');
    }

    return true;
  }
}
