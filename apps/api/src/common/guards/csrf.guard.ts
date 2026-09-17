import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH_INSTANCE } from '../../auth/index.js';
import type { AuthInstance } from '../../auth/index.js';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';

/** Methods that cannot change state, and so cannot be worth forging. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The Origin check for this application's own routes.
 *
 * Better Auth applies one to everything under /api/auth/*, but that handler is
 * mounted on the Express instance outside the Nest router, so its protection
 * stops exactly where our routes begin.
 *
 * What stood in until PD-35 was `sameSite: 'lax'`: the browser declines to
 * attach the session cookie to a cross-site POST, so a forged request arrives
 * unauthenticated. That is real, but it lives in the browser rather than in the
 * service, and PD-35 made SameSite configurable — a deployment that needs
 * `none` loses it entirely. This is what replaces it.
 *
 * CORS is not an alternative. It governs whether the browser lets the caller
 * read the response; a forger does not need to read anything, because the write
 * has already happened by then.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  /**
   * Resolved once and reused. `$context` is a promise, so this cannot be a
   * constructor assignment, and doing it here rather than in onModuleInit keeps
   * the guard independent of when Nest decides to instantiate it.
   */
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

    // No ambient credential, nothing to forge. This is what keeps curl, health
    // probes and future server-to-server callers out of a 403 they could never
    // fix, and it is the same condition Better Auth documents for its own
    // check: "Origin header validation when cookies are present".
    //
    // The converse is a real constraint on the frontend: anything that forwards
    // a user's session cookie from a server — a Next.js server component or
    // route handler acting as a BFF — has to send an Origin header too, or it
    // is refused here. That is not a new burden. Better Auth already imposes it
    // on /api/auth/*, where a sign-out without an Origin is answered with
    // MISSING_OR_NULL_ORIGIN (measured in PD-30), so a frontend that can sign a
    // user in already satisfies it.
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

  /**
   * Reads the raw Cookie header rather than `request.cookies`: cookie-parser is
   * not registered, so that property does not exist.
   *
   * The name is taken from Better Auth instead of being written here, so it
   * follows `cookiePrefix` and the `__Secure-` prefix on its own. The prefix
   * match catches the chunked form (`name.0`, `name.1`) Better Auth falls back
   * to for a large cookie.
   */
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
