import { ERROR_CODES } from '@pokedrop/shared';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { keys } from '@/lib/query/keys';
import { getServerQueryClient } from '@/lib/query/server';
import { HOME, signInUrl } from '@/lib/routes';
import { SessionProvider } from '@/lib/session/context';
import { identityOf } from '@/lib/session/identity';
import { getSession } from '@/lib/session/server';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const session = await getSession();
  if (!session.profile) {
    const next = (await headers()).get('x-pathname') ?? HOME;
    redirect(
      signInUrl(next, session.reason === 'suspended' ? ERROR_CODES.ACCOUNT_SUSPENDED : undefined),
    );
  }

  // The session's profile is the `me` query: hydrate it rather than fetch it twice.
  const queryClient = getServerQueryClient();
  queryClient.setQueryData(keys.me, session.profile);

  return (
    <SessionProvider identity={identityOf(session.profile)}>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <main className="flex-1 p-8">{children}</main>
      </HydrationBoundary>
    </SessionProvider>
  );
}
