// The proxy's map of what needs a session. Imported by proxy.ts only: it names
// the admin area, which must not reach a member's browser.
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/packs',
  '/inventory',
  '/trades',
  '/settings',
  '/wallet',
  '/notifications',
  '/admin',
];

// /decks/:id is public; only the list needs a session. /cards and /sets are public entirely.
const PROTECTED_EXACT = ['/decks'];

export function isProtected(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return (
    PROTECTED_EXACT.includes(path) ||
    PROTECTED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  );
}

export function isAdminPath(pathWithQuery: string): boolean {
  const path = pathWithQuery.split(/[?#]/)[0] ?? '';
  return path === '/admin' || path.startsWith('/admin/');
}
