import { ERROR_CODES } from '@pokedrop/shared';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/app-shell';
import { HOME, signInUrl } from '@/lib/routes';
import { getSession } from '@/lib/session/server';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const session = await getSession();
  if (!session.profile) {
    const next = (await headers()).get('x-pathname') ?? HOME;
    redirect(
      signInUrl(next, session.reason === 'suspended' ? ERROR_CODES.ACCOUNT_SUSPENDED : undefined),
    );
  }

  return <AppShell profile={session.profile}>{children}</AppShell>;
}
