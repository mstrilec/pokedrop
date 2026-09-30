import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/api/core';
import { me } from '@/lib/api/endpoints/users';
import { env } from '@/lib/env';
import { HOME, isAdminPath, isProtected, signInUrl } from '@/lib/routes';
import { hasSessionCookie } from '@/lib/session/cookie';

// Navigation comfort, not access control. Everywhere but /admin this only
// checks that a session cookie exists; the layouts ask the API, and the API
// refuses anything the session does not allow.
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isProtected(pathname) && !hasSessionCookie(request.cookies)) {
    return NextResponse.redirect(new URL(signInUrl(`${pathname}${search}`), request.url));
  }

  // Next renders a page alongside its layout and ships the page's output even
  // with a layout's redirect, so a non-admin never reaches an admin render.
  if (isAdminPath(pathname) && !(await isAdmin(request))) {
    return NextResponse.redirect(new URL(HOME, request.url));
  }

  const headers = new Headers(request.headers);
  headers.set('x-pathname', `${pathname}${search}`);
  return NextResponse.next({ request: { headers } });
}

async function isAdmin(request: NextRequest): Promise<boolean> {
  const forwarded: Record<string, string> = {};
  const cookie = request.headers.get('cookie');
  if (cookie) forwarded.cookie = cookie;
  const address = request.headers.get('x-forwarded-for');
  if (address) forwarded['x-forwarded-for'] = address;

  const client = createClient({
    baseUrl: `${env.API_INTERNAL_URL}/api/v1`,
    headers: () => forwarded,
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
