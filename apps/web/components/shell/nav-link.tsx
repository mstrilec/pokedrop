'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useUi } from '@/lib/stores/ui';
import { cn } from '@/lib/utils';

export function NavLink({
  href,
  exact = false,
  className,
  children,
}: {
  href: string;
  exact?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const setNavOpen = useUi((s) => s.setNavOpen);
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      onClick={() => setNavOpen(false)}
      className={cn(
        'focus-ring flex items-center gap-3 rounded-control px-3 py-2 text-body font-medium transition-colors',
        active ? 'bg-pri-dim text-pri' : 'text-mut hover:bg-surface-2 hover:text-tx',
        className,
      )}
    >
      {children}
    </Link>
  );
}
