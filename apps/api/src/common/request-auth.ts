import type { Request } from 'express';
import type { AuthInstance } from '../auth/index.js';

export type AuthContext = NonNullable<Awaited<ReturnType<AuthInstance['api']['getSession']>>>;

export type AuthUser = AuthContext['user'];

type RequestWithAuth = Request & { auth?: AuthContext };

export function setAuthContext(request: Request, context: AuthContext): void {
  (request as RequestWithAuth).auth = context;
}

export function getAuthContext(request: Request): AuthContext | undefined {
  return (request as RequestWithAuth).auth;
}
