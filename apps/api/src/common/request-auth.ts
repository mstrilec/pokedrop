import type { Request } from 'express';
import type { AuthInstance } from '../auth/index.js';

/**
 * Whatever Better Auth's getSession returns, minus the null. Derived rather
 * than hand-written so that a provider change surfaces as a type error here
 * instead of as a wrong shape three layers away.
 */
export type AuthContext = NonNullable<Awaited<ReturnType<AuthInstance['api']['getSession']>>>;

export type AuthUser = AuthContext['user'];

/**
 * Not a global declaration merge on Express' Request, for the same reason as
 * request-id.ts: one augmentation per property, and this one would collide with
 * anything else that decides to own `auth`.
 */
type RequestWithAuth = Request & { auth?: AuthContext };

export function setAuthContext(request: Request, context: AuthContext): void {
  (request as RequestWithAuth).auth = context;
}

export function getAuthContext(request: Request): AuthContext | undefined {
  return (request as RequestWithAuth).auth;
}
