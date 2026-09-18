import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { AUTH_INSTANCE } from '../../auth/index.js';
import type { AuthInstance } from '../../auth/index.js';
import { Public } from '../decorators/public.decorator.js';
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
