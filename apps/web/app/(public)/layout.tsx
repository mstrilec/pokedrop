import Link from 'next/link';

export default function PublicLayout({ children }: LayoutProps<'/'>) {
  return (
    <>
      <header className="flex items-center justify-between gap-4 p-4">
        <Link href="/">PokéDrop</Link>
        <nav aria-label="Account" className="flex gap-4">
          <Link href="/sign-in">Sign in</Link>
          <Link href="/register">Create account</Link>
        </nav>
      </header>
      <main className="flex-1 p-8">{children}</main>
    </>
  );
}
