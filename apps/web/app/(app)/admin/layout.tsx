import { redirect } from 'next/navigation';
import { NavIcon } from '@/components/shell/nav-icon';
import { NavLink } from '@/components/shell/nav-link';
import { ADMIN_NAV } from '@/lib/nav';
import { HOME } from '@/lib/routes';
import { getSession } from '@/lib/session/server';

export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  const session = await getSession();
  if (session.profile?.role !== 'ADMIN') redirect(HOME);

  return (
    <>
      <nav aria-label="Admin" className="mb-6 flex flex-wrap gap-1 border-b border-bd pb-3">
        {ADMIN_NAV.map((entry) => (
          <NavLink key={entry.href} href={entry.href} exact={entry.exact}>
            <NavIcon name={entry.icon} className="size-4" />
            {entry.label}
          </NavLink>
        ))}
      </nav>
      {children}
    </>
  );
}
