import { notFound } from 'next/navigation';
import { connection } from 'next/server';

// The component gallery: on under `next dev`, and under `next start` only with
// COMPONENT_GALLERY=1. Read per request, so a production server opts in at start.
export default async function DevLayout({ children }: LayoutProps<'/'>) {
  await connection();
  if (process.env.NODE_ENV === 'production' && process.env.COMPONENT_GALLERY !== '1') {
    notFound();
  }
  return <main className="mx-auto flex w-full max-w-6xl flex-col gap-12 p-8">{children}</main>;
}
