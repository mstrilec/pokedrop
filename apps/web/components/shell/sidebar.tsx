import { Shield, Zap } from 'lucide-react';
import Link from 'next/link';
import { ACCOUNT_NAV, ADMIN_NAV, MAIN_NAV, type NavEntry } from '@/lib/nav';
import { NavIcon } from './nav-icon';
import { NavLink } from './nav-link';
import { SidebarFrame } from './sidebar-frame';

function Links({ entries }: { entries: NavEntry[] }) {
  return entries.map((entry) => (
    <NavLink key={entry.href} href={entry.href} exact={entry.exact}>
      <NavIcon name={entry.icon} className="size-4" />
      <span className="flex-1">{entry.label}</span>
    </NavLink>
  ));
}

// Rendered on the server: the admin group is left out of the markup entirely
// for anyone but an admin, not hidden with CSS.
export function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  return (
    <SidebarFrame>
      <Link href="/dashboard" className="focus-ring flex items-center gap-3 px-4 pt-5 pb-4">
        <span className="flex size-8 items-center justify-center rounded-control bg-linear-135 from-pri to-pri-hover shadow-glow">
          <Zap aria-hidden className="size-4 text-on-pri" />
        </span>
        <span className="text-h3 font-bold tracking-tight">
          Poké<span className="text-pri">Drop</span>
        </span>
      </Link>
      <nav aria-label="Main" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
        <Links entries={MAIN_NAV} />
        <div className="mx-2 my-3 h-px bg-bd" />
        <p className="px-3 pt-2 pb-1 text-caption text-faint uppercase">Account</p>
        <Links entries={ACCOUNT_NAV} />
        {isAdmin ? (
          <>
            <div className="mx-2 my-3 h-px bg-bd" />
            <p className="flex items-center gap-2 px-3 pt-2 pb-1 text-caption text-red uppercase">
              <Shield aria-hidden className="size-3" />
              Admin
            </p>
            <Links entries={ADMIN_NAV} />
          </>
        ) : null}
      </nav>
    </SidebarFrame>
  );
}
