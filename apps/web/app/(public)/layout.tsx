import Link from 'next/link';
import { AppShell } from '@/components/shell/app-shell';
import { Logo } from '@/components/shell/logo';
import { SiteFooter } from '@/components/shell/site-footer';
import { Button } from '@/components/ui/button';
import { SessionProvider } from '@/lib/session/context';
import { getOptionalProfile } from '@/lib/session/server';

export default async function PublicLayout({ children }: LayoutProps<'/'>) {
  const profile = await getOptionalProfile();
  if (profile) {
    return (
      <AppShell profile={profile} footer={<SiteFooter signedIn />}>
        {children}
      </AppShell>
    );
  }

  return (
    <SessionProvider identity={null}>
      <a
        href="#main"
        className="focus-ring sr-only z-50 rounded-control bg-pri-strong px-4 py-2 text-on-pri focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="flex items-center gap-3 border-b border-bd px-4 py-4 sm:gap-4 sm:px-14">
        <Logo href="/" />
        <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
          <Button asChild variant="ghost">
            <Link href="/cards">Browse cards</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/sets">Sets</Link>
          </Button>
        </nav>
        <nav aria-label="Account" className="ml-auto flex items-center gap-2">
          <Button asChild variant="ghost" className="max-sm:px-2.5">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild className="max-sm:px-3">
            <Link href="/register">Create account</Link>
          </Button>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="flex-1 p-8 outline-none">
        {children}
      </main>
      <SiteFooter signedIn={false} />
    </SessionProvider>
  );
}
