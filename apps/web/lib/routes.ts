export const HOME = '/dashboard';
export const SIGN_IN = '/sign-in';

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/packs',
  '/inventory',
  '/sets',
  '/trades',
  '/settings',
  '/wallet',
  '/notifications',
  '/admin',
];

// /cards/:id and /decks/:id are public; only the lists need a session.
const PROTECTED_EXACT = ['/cards', '/decks'];

export function isProtected(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return (
    PROTECTED_EXACT.includes(path) ||
    PROTECTED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  );
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

export function isAdminPath(pathWithQuery: string): boolean {
  const path = pathWithQuery.split(/[?#]/)[0] ?? '';
  return path === '/admin' || path.startsWith('/admin/');
}
