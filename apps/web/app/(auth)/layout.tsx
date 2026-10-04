import { Logo } from '@/components/shell/logo';

export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <>
      <header className="px-5 py-4 sm:px-14">
        <Logo href="/" className="w-fit" />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-5 pt-6 pb-16">
        {children}
        <p className="mt-4.5 text-center text-caption text-faint">Protected by Better Auth.</p>
      </main>
    </>
  );
}
