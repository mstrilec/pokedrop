// The proxy's map of what needs a session. Imported by proxy.ts only: it names
// the admin area, which must not reach a member's browser.
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

export function isAdminPath(pathWithQuery: string): boolean {
  const path = pathWithQuery.split(/[?#]/)[0] ?? '';
  return path === '/admin' || path.startsWith('/admin/');
}
