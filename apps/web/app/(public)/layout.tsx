import Link from 'next/link';
import { ApiError } from '@/lib/api/core';
import { HOME } from '@/lib/routes';
import { SessionProvider } from '@/lib/session/context';
import { identityOf, type SessionIdentity } from '@/lib/session/identity';
import { getSession } from '@/lib/session/server';

// Public pages must render with the API down, so an unreachable or failing API
// reads as signed out here. A contract error still throws: that is a bug.
async function optionalIdentity(): Promise<SessionIdentity | null> {
  try {
    const session = await getSession();
    return session.profile ? identityOf(session.profile) : null;
  } catch (error) {
    if (error instanceof ApiError && (error.kind === 'network' || error.statusCode >= 500)) {
      console.warn(
        `Rendering as signed out: ${error.message} (request ${error.requestId ?? 'n/a'})`,
      );
      return null;
    }
    throw error;
  }
}

export default async function PublicLayout({ children }: LayoutProps<'/'>) {
  const identity = await optionalIdentity();

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
