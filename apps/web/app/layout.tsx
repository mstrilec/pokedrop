import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { env } from '@/lib/env';
import './globals.css';
import { Providers } from './providers';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(env.WEB_ORIGIN),
  title: { default: 'PokéDrop', template: '%s · PokéDrop' },
  description: 'Open Pokémon TCG booster packs, build a collection, trade cards',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-dvh flex-col antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
