import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH_INSTANCE } from '../../auth/index.js';
import type { AuthInstance } from '../../auth/index.js';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  private cookieName: Promise<string> | null = null;

  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: AuthInstance,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    if (SAFE_METHODS.has(request.method)) {
      return true;
    }

    if (!(await this.hasSessionCookie(request))) {
      return true;
    }

    const origin = request.headers.origin;

    if (origin === undefined || origin === 'null' || !this.isTrusted(origin)) {
      throw new ForbiddenException('Cross-origin request rejected');
    }

    return true;
  }

  private isTrusted(origin: string): boolean {
    return this.config.app.corsOrigins.includes(origin);
  }

  private async hasSessionCookie(request: Request): Promise<boolean> {
    const header = request.headers.cookie;

    if (header === undefined) {
      return false;
    }

    this.cookieName ??= this.auth.$context.then((context) => context.authCookies.sessionToken.name);
    const name = await this.cookieName;

    return header.split(';').some((pair) => {
      const separator = pair.indexOf('=');
      const key = (separator === -1 ? pair : pair.slice(0, separator)).trim();
      return key === name || key.startsWith(`${name}.`);
    });
  }
}
