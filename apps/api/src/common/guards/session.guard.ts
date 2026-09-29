import { HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { ERROR_CODES } from '@pokedrop/shared';
import { AUTH_INSTANCE } from '../../auth/index.js';
import type { AuthInstance } from '../../auth/index.js';
import { Public } from '../decorators/public.decorator.js';
import { domainError } from '../errors/domain-error.js';
import { setAuthContext } from '../request-auth.js';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_INSTANCE) private readonly auth: AuthInstance,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    const session = await this.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    // A session can outlive its user's suspension by a moment: one created by
    // a sign-in racing the suspending transaction. It is never honoured.
    const suspended = session !== null && session.user.suspendedAt != null;

    if (session && !suspended) {
      setAuthContext(request, session);
    }

    const isPublic = this.reflector.getAllAndOverride(Public, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic !== undefined) {
      return true;
    }

    if (suspended) {
      throw domainError(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.ACCOUNT_SUSPENDED,
        'This account is suspended',
      );
    }

    if (!session) {
      throw new UnauthorizedException('Authentication required');
    }

    return true;
  }
}
