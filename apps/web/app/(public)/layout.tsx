import type { MyProfile } from '@pokedrop/shared';
import Link from 'next/link';
import { AppShell } from '@/components/shell/app-shell';
import { ApiError } from '@/lib/api/core';
import { SessionProvider } from '@/lib/session/context';
import { getSession } from '@/lib/session/server';

// Public pages must render with the API down, so an unreachable or failing API
// reads as signed out here. A contract error still throws: that is a bug.
async function optionalProfile(): Promise<MyProfile | null> {
  try {
    return (await getSession()).profile;
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
  const profile = await optionalProfile();
  if (profile) return <AppShell profile={profile}>{children}</AppShell>;

  return (
    <SessionProvider identity={null}>
      <header className="flex items-center justify-between gap-4 p-4">
        <Link href="/" className="focus-ring">
          PokéDrop
        </Link>
        <nav aria-label="Account" className="flex gap-4">
          <Link href="/sign-in" className="focus-ring">
            Sign in
          </Link>
          <Link href="/register" className="focus-ring">
            Create account
          </Link>
        </nav>
      </header>
      <main className="flex-1 p-8">{children}</main>
    </SessionProvider>
  );
}
