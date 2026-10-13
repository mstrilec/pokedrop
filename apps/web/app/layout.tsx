import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';
import { parseTheme, THEME_COOKIE, themeAttribute } from '@/lib/theme/theme';
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

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="en"
      data-theme={themeAttribute(theme)}
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-dvh flex-col antialiased">
        <Providers theme={theme}>{children}</Providers>
      </body>
    </html>
  );
}
