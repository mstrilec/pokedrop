import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Roles } from '../decorators/roles.decorator.js';
import { getAuthContext } from '../request-auth.js';

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
      throw new UnauthorizedException('Authentication required');
    }

    if (!required.includes(user.role as (typeof required)[number])) {
      throw new ForbiddenException('Insufficient role');
    }

    return true;
  }
}
