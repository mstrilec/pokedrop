export const HOME = '/dashboard';
export const SIGN_IN = '/sign-in';

// Paths a visitor may open without a session. The client asks only this; the
// protected list, which names the admin area, stays in route-access.ts for the
// proxy, so it never ships to the browser.
const PUBLIC_EXACT = [
  '/',
  '/register',
  '/verify-email',
  '/sign-in',
  '/forgot-password',
  '/reset-password',
  '/cards',
];
const PUBLIC_DETAIL = /^\/(cards|decks|profile)\/[^/]+\/?$/;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT.includes(pathname) || PUBLIC_DETAIL.test(pathname);
}

const BASE = 'http://next.invalid';

// Resolved by the URL parser, the way a browser would: a backslash, tab or
// second slash that turns the value into another origin is refused.
export function safeNext(value: string | null | undefined): string {
  if (!value?.startsWith('/')) return HOME;
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE || url.pathname === SIGN_IN) return HOME;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return HOME;
  }
}

export function signInUrl(next: string, error?: string): string {
  const params = new URLSearchParams({ next: safeNext(next) });
  if (error) params.set('error', error);
  return `${SIGN_IN}?${params.toString()}`;
}

export function redirectToSignIn(): void {
  window.location.assign(signInUrl(`${window.location.pathname}${window.location.search}`));
}
