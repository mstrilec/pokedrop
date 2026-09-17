import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { AUTH_INSTANCE } from '../../auth/index.js';
import type { AuthInstance } from '../../auth/index.js';
import { Public } from '../decorators/public.decorator.js';
import { setAuthContext } from '../request-auth.js';

/**
 * Protected by default; `@Public()` is the deliberate exception.
 *
 * That polarity is the whole point. A guard that protects only what it is told
 * to protect leaks every route somebody forgets to annotate, and forgetting is
 * silent. This way forgetting produces a 401, which is noisy and cheap to fix.
 *
 * Routes under /api/auth are mounted on the Express instance, outside the Nest
 * router, so this guard never sees them — which is correct, since sign-in has
 * to be reachable by someone who is not signed in.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_INSTANCE) private readonly auth: AuthInstance,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // Resolved even for public routes, so @CurrentUser() is honest on a page
    // that renders differently when signed in. It costs nothing for an
    // anonymous caller: with no cookie there is no token to look up.
    const session = await this.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    if (session) {
      setAuthContext(request, session);
    }

    const isPublic = this.reflector.getAllAndOverride(Public, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic !== undefined) {
      return true;
    }

    if (!session) {
      throw new UnauthorizedException('Authentication required');
    }

    return true;
  }
}
