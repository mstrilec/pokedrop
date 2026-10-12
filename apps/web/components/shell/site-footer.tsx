import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from './logo';

const LINK = 'focus-ring w-max rounded-control text-body text-tx hover:text-pri';

const DATA_SOURCES = [
  { href: 'https://pokemontcg.io', label: 'pokemontcg.io' },
  { href: 'https://tcgdex.dev', label: 'TCGdex' },
  { href: 'https://pokeapi.co', label: 'PokéAPI' },
];

function Group({ label, nav, children }: { label: string; nav?: boolean; children: ReactNode }) {
  const heading = <h2 className="text-caption text-faint uppercase">{label}</h2>;
  return nav ? (
    <nav aria-label={label} className="flex flex-col gap-3">
      {heading}
      {children}
    </nav>
  ) : (
    <div className="flex flex-col gap-3">
      {heading}
      {children}
    </div>
  );
}

// Every public page ends with this, signed in (inside AppShell) or not.
export function SiteFooter({ signedIn }: { signedIn: boolean }) {
  return (
    <footer className="border-t border-bd bg-linear-180 from-surface/60 to-bg">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11.25rem),1fr))] gap-x-6 gap-y-8 px-4 pt-12 pb-8 sm:px-14">
        <div className="flex min-w-0 flex-col gap-3">
          <Logo href="/" className="w-max rounded-control" />
          <p className="text-body text-mut">Open. Collect. Build. Trade.</p>
        </div>
        <Group label="Explore" nav>
          <Link href="/cards" className={LINK}>
            Browse cards
          </Link>
          <Link href="/sets" className={LINK}>
            Sets
          </Link>
        </Group>
        <Group label="Account" nav>
          {signedIn ? (
            <Link href="/dashboard" className={LINK}>
              Dashboard
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className={LINK}>
                Sign in
              </Link>
              <Link href="/register" className={LINK}>
                Create account
              </Link>
            </>
          )}
        </Group>
        <Group label="Data">
          {DATA_SOURCES.map((source) => (
            <a key={source.href} href={source.href} rel="noopener noreferrer" className={LINK}>
              {source.label}
            </a>
          ))}
          <span className="text-body text-mut">Prices: TCGplayer / Cardmarket</span>
        </Group>
      </div>
      <div className="mx-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3 border-t border-bd pt-5 pb-8 sm:mx-14">
        <p className="max-w-160 text-small text-mut">
          PokéDrop is a fan project, not affiliated with Nintendo, Creatures, GAME FREAK or The
          Pokémon Company. No real money, no cash-out.
        </p>
        <p className="font-mono text-small text-faint">© {new Date().getFullYear()} PokéDrop</p>
      </div>
    </footer>
  );
}
