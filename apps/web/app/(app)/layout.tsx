import { ERROR_CODES } from '@pokedrop/shared';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { HOME, signInUrl } from '@/lib/routes';
import { SessionProvider } from '@/lib/session/context';
import { identityOf } from '@/lib/session/identity';
import { SessionKeepAlive } from '@/lib/session/keep-alive';
import { getSession } from '@/lib/session/server';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const session = await getSession();
  if (!session.profile) {
    const next = (await headers()).get('x-pathname') ?? HOME;
    redirect(
      signInUrl(next, session.reason === 'suspended' ? ERROR_CODES.ACCOUNT_SUSPENDED : undefined),
    );
  }

  return (
    <SessionProvider identity={identityOf(session.profile)}>
      <SessionKeepAlive />
      <main className="flex-1 p-8">{children}</main>
    </SessionProvider>
  );
}
