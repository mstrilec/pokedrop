import Link from 'next/link';
import { HOME } from '@/lib/routes';
import { SessionProvider } from '@/lib/session/context';
import { identityOf } from '@/lib/session/identity';
import { getSession } from '@/lib/session/server';

export default async function PublicLayout({ children }: LayoutProps<'/'>) {
  const session = await getSession();
  const identity = session.profile ? identityOf(session.profile) : null;

  return (
    <SessionProvider identity={identity}>
      <header className="flex items-center justify-between gap-4 p-4">
        <Link href="/">PokéDrop</Link>
        <nav aria-label="Account" className="flex gap-4">
          {identity ? (
            <Link href={HOME}>{identity.displayName}</Link>
          ) : (
            <>
              <Link href="/sign-in">Sign in</Link>
              <Link href="/register">Create account</Link>
            </>
          )}
        </nav>
      </header>
      <main className="flex-1 p-8">{children}</main>
    </SessionProvider>
  );
}
