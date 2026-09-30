import { redirect } from 'next/navigation';
import { HOME } from '@/lib/routes';
import { getSession } from '@/lib/session/server';

export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  const session = await getSession();
  if (session.profile?.role !== 'ADMIN') redirect(HOME);
  return children;
}
