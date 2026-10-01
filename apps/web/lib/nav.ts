import 'server-only';

// Server-only on purpose: the sidebar renders these on the server and hands
// each link to the client one by one, so a member's HTML and JavaScript never
// carry the admin routes.
export type IconName =
  | 'layout-dashboard'
  | 'package-open'
  | 'layers'
  | 'library'
  | 'grid-3x3'
  | 'swords'
  | 'arrow-left-right'
  | 'bell'
  | 'wallet'
  | 'settings'
  | 'gauge'
  | 'package'
  | 'refresh-cw'
  | 'users'
  | 'flag'
  | 'scroll-text';

export interface NavEntry {
  href: string;
  label: string;
  icon: IconName;
  /** Active only on this exact path, not below it. */
  exact?: boolean;
}

export const MAIN_NAV: NavEntry[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'layout-dashboard' },
  { href: '/packs', label: 'Packs', icon: 'package-open' },
  { href: '/inventory', label: 'Inventory', icon: 'layers' },
  { href: '/cards', label: 'Browse', icon: 'library' },
  { href: '/sets', label: 'Sets', icon: 'grid-3x3' },
  { href: '/decks', label: 'Decks', icon: 'swords' },
  { href: '/trades', label: 'Trades', icon: 'arrow-left-right' },
];

export const ACCOUNT_NAV: NavEntry[] = [
  { href: '/notifications', label: 'Notifications', icon: 'bell' },
  { href: '/wallet', label: 'Wallet', icon: 'wallet' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

export const ADMIN_NAV: NavEntry[] = [
  { href: '/admin', label: 'Overview', icon: 'gauge', exact: true },
  { href: '/admin/packs', label: 'Pack templates', icon: 'package' },
  { href: '/admin/sync', label: 'Sync', icon: 'refresh-cw' },
  { href: '/admin/users', label: 'Users', icon: 'users' },
  { href: '/admin/trades', label: 'Trade moderation', icon: 'flag' },
  { href: '/admin/audit', label: 'Audit log', icon: 'scroll-text' },
];
