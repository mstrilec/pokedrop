import Link from 'next/link';
import { AppShell } from '@/components/shell/app-shell';
import { Logo } from '@/components/shell/logo';
import { Button } from '@/components/ui/button';
import { SessionProvider } from '@/lib/session/context';
import { getOptionalProfile } from '@/lib/session/server';

export default async function PublicLayout({ children }: LayoutProps<'/'>) {
  const profile = await getOptionalProfile();
  if (profile) return <AppShell profile={profile}>{children}</AppShell>;

  return (
    <SessionProvider identity={null}>
      <header className="flex items-center gap-3 border-b border-bd px-4 py-4 sm:gap-4 sm:px-14">
        <Logo href="/" />
        <nav aria-label="Account" className="ml-auto flex items-center gap-2">
          <Button asChild variant="ghost" className="max-sm:px-2.5">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild className="max-sm:px-3">
            <Link href="/register">Create account</Link>
          </Button>
        </nav>
      </header>
      <main className="flex-1 p-8">{children}</main>
    </SessionProvider>
  );
}
