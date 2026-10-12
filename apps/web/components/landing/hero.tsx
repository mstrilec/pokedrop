import type { CardSet } from '@pokedrop/shared';
import { ArrowRight, Coins, PackageOpen } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { HeroCardStage } from './hero-card-stage';

const count = new Intl.NumberFormat('en-US');

export function Hero({
  signedIn,
  cardCount,
  sets,
}: {
  signedIn: boolean;
  cardCount: number | null;
  sets: CardSet[];
}) {
  const newest = sets.reduce<CardSet | null>(
    (latest, set) => (latest === null || set.releaseDate > latest.releaseDate ? set : latest),
    null,
  );
  const figures = [
    cardCount === null ? null : { label: 'Cards catalogued', value: count.format(cardCount) },
    sets.length === 0 ? null : { label: 'Sets to complete', value: count.format(sets.length) },
    { label: 'Welcome coins', value: '1,000', gold: true },
  ].filter((figure) => figure !== null);

  return (
    <section aria-labelledby="hero-title" className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_420px_at_78%_40%,color-mix(in_srgb,var(--e-fire)_16%,transparent),transparent_70%),radial-gradient(600px_400px_at_10%_0%,color-mix(in_srgb,var(--pri)_10%,transparent),transparent_70%)]"
      />
      <div className="relative mx-auto grid max-w-300 items-center gap-6 px-5 pt-10 pb-12 sm:gap-10 sm:px-14 sm:pt-16 sm:pb-16 lg:gap-14 lg:pt-24 lg:pb-20 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="min-w-0">
          {newest ? (
            <p className="mb-6 inline-flex items-center gap-2 rounded-pill border border-bd bg-surface px-3 py-1.5 text-small text-mut">
              <span
                aria-hidden
                className="size-1.75 rounded-pill bg-grn shadow-[0_0_10px_var(--grn)]"
              />
              Newest set · {newest.name}
            </p>
          ) : null}
          <h1
            id="hero-title"
            className="mb-5 text-[clamp(2.4rem,6vw,4.5rem)] leading-[1.02] font-extrabold tracking-[-0.03em] text-balance"
          >
            Open. Collect.
            <br />
            Build.{' '}
            <span className="bg-linear-120 from-pri via-energy-water to-gold bg-clip-text text-transparent">
              Trade.
            </span>
          </h1>
          <p className="mb-8 max-w-130 text-[1.125rem] leading-relaxed text-pretty text-mut">
            The Pokémon Trading Card Game, collected online. Rip packs, complete every set, engineer
            decks that are legal to play, and trade with collectors without trusting anyone.
          </p>
          <div className="flex flex-wrap gap-3">
            {signedIn ? (
              <>
                <Button asChild size="lg" icon={ArrowRight}>
                  <Link href="/dashboard">Go to your dashboard</Link>
                </Button>
                <Button asChild size="lg" variant="secondary" icon={PackageOpen}>
                  <Link href="/packs">Open a pack</Link>
                </Button>
              </>
            ) : (
              <>
                <Button asChild size="lg" icon={ArrowRight}>
                  <Link href="/register">Start collecting free</Link>
                </Button>
                <Button asChild size="lg" variant="secondary">
                  <Link href="/sign-in">Sign in</Link>
                </Button>
              </>
            )}
          </div>
          <p className="mt-4 flex items-center gap-2 text-small text-mut">
            <Coins aria-hidden className="size-4 text-gold" />
            Free to play. No real money, no cash-out.
          </p>
          <dl className="mt-10 flex flex-wrap gap-8">
            {figures.map((figure) => (
              <div key={figure.label} className="flex flex-col-reverse gap-0.5">
                <dt className="text-small text-faint">{figure.label}</dt>
                <dd
                  className={
                    figure.gold
                      ? 'font-mono text-[1.75rem] font-bold tracking-tight text-gold'
                      : 'font-mono text-[1.75rem] font-bold tracking-tight'
                  }
                >
                  {figure.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <HeroCardStage />
      </div>
    </section>
  );
}
