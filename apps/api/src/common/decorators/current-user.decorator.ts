import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { getAuthContext } from '../request-auth.js';
import type { AuthUser } from '../request-auth.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser | undefined => {
    const request = context.switchToHttp().getRequest<Request>();
    return getAuthContext(request)?.user;
  },
);
