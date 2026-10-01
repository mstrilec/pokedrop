import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/api/core';
import { me } from '@/lib/api/endpoints/users';
import { env } from '@/lib/env';
import { isAdminPath, isProtected } from '@/lib/route-access';
import { HOME, signInUrl } from '@/lib/routes';
import { hasSessionCookie } from '@/lib/session/cookie';

const REFRESH_MARKER = 'pokedrop.session-refreshed';
const REFRESH_EVERY_SECONDS = 12 * 60 * 60;

// Navigation comfort, not access control. Everywhere but /admin this only
// checks that a session cookie exists; the layouts ask the API, and the API
// refuses anything the session does not allow.
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const signedIn = hasSessionCookie(request.cookies);

  if (isProtected(pathname) && !signedIn) {
    return NextResponse.redirect(new URL(signInUrl(`${pathname}${search}`), request.url));
  }

  const refreshed =
    signedIn && !request.cookies.has(REFRESH_MARKER) ? await refreshSession(request) : null;

  // Next renders a page alongside its layout and ships the page's output even
  // with a layout's redirect, so a non-admin never reaches an admin render.
  const response =
    isAdminPath(pathname) && !(await isAdmin(request))
      ? NextResponse.redirect(new URL(HOME, request.url))
      : next(request, `${pathname}${search}`);

  if (refreshed) {
    response.cookies.set(REFRESH_MARKER, '1', {
      maxAge: REFRESH_EVERY_SECONDS,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
    // After cookies.set, which rewrites the whole set-cookie header from its own list.
    for (const cookie of refreshed) response.headers.append('set-cookie', cookie);
  }
  return response;
}

function next(request: NextRequest, pathWithQuery: string): NextResponse {
  const headers = new Headers(request.headers);
  headers.set('x-pathname', pathWithQuery);
  return NextResponse.next({ request: { headers } });
}

function forwardedHeaders(request: NextRequest): Record<string, string> {
  const forwarded: Record<string, string> = {};
  const cookie = request.headers.get('cookie');
  if (cookie) forwarded.cookie = cookie;
  const address = request.headers.get('x-forwarded-for');
  if (address) forwarded['x-forwarded-for'] = address;
  return forwarded;
}

// /api/v1 renews a session in the database but drops the refreshed cookie, and
// the first API call of a render would spend that renewal. Better Auth's own
// route returns the cookie, so it is called here, before anything renders.
async function refreshSession(request: NextRequest): Promise<string[] | null> {
  try {
    const response = await fetch(`${env.API_INTERNAL_URL}/api/auth/get-session`, {
      headers: forwardedHeaders(request),
      cache: 'no-store',
    });
    await response.arrayBuffer();
    return response.ok ? response.headers.getSetCookie() : null;
  } catch {
    return null;
  }
}

async function isAdmin(request: NextRequest): Promise<boolean> {
  const client = createClient({
    baseUrl: `${env.API_INTERNAL_URL}/api/v1`,
    headers: () => forwardedHeaders(request),
    init: { cache: 'no-store' },
  });
  try {
    return (await client.call(me())).role === 'ADMIN';
  } catch {
    return false;
  }
}

export const config = {
  matcher: ['/((?!api/|_next/static|_next/image|favicon\\.ico|.*\\.[a-z0-9]+$).*)'],
};
