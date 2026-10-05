import {
  ArrowRight,
  Layers,
  type LucideIcon,
  PackageOpen,
  ShieldCheck,
  Swords,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CardArt } from '@/components/cards/card-art';
import type { CardView } from '@/components/cards/card-data';
import { Button } from '@/components/ui/button';
import { searchCards, sets } from '@/lib/api/endpoints/catalog';
import { serverApi } from '@/lib/api/server';
import { getOptionalProfile } from '@/lib/session/server';

const DESCRIPTION =
  'Open Pokémon TCG booster packs, complete every set, build legal decks and trade cards safely with other collectors.';

export const metadata: Metadata = {
  title: { absolute: 'PokéDrop · Open, collect, build and trade Pokémon cards' },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'PokéDrop',
    title: 'PokéDrop · Open, collect, build and trade Pokémon cards',
    description: DESCRIPTION,
    url: '/',
  },
};

const HERO_CARDS: { card: CardView; place: string; delay: string }[] = [
  {
    card: card('base1-4', 'Charizard', 'Fire', 120, 'https://images.pokemontcg.io/base1/4.png'),
    place: '-translate-x-30 -rotate-12',
    delay: '[animation-delay:0s]',
  },
  {
    card: card('base1-2', 'Blastoise', 'Water', 100, 'https://images.pokemontcg.io/base1/2.png'),
    place: 'z-10 scale-108',
    delay: '[animation-delay:0.8s]',
  },
  {
    card: card('base1-58', 'Pikachu', 'Lightning', 40, 'https://images.pokemontcg.io/base1/58.png'),
    place: 'translate-x-30 rotate-12',
    delay: '[animation-delay:1.6s]',
  },
];

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: PackageOpen,
    title: 'Open packs',
    body: 'Every pack lists its odds before you open it, and your pulls land in your collection the moment it opens.',
  },
  {
    icon: Layers,
    title: 'Grow a collection',
    body: 'See every card you own, what it is worth today, and how close you are to completing each set.',
  },
  {
    icon: Swords,
    title: 'Build legal decks',
    body: 'Drag cards into a deck and watch deck size, the four-copy limit and format legality checked as you go.',
  },
  {
    icon: ShieldCheck,
    title: 'Trade safely',
    body: 'Offered cards are held in escrow while a trade is pending, and both sides swap in one transaction.',
  },
];

function card(id: string, name: string, type: string, hp: number, image: string): CardView {
  return { id, name, image, rarity: null, types: [type], hp, priceUsd: null };
}

const count = new Intl.NumberFormat('en-US');

// The page must render with the API down: each figure is dropped on its own when it cannot be read.
async function catalogFacts() {
  const [cards, allSets] = await Promise.allSettled([
    serverApi.call(searchCards({ pageSize: 1 })),
    serverApi.call(sets()),
  ]);
  const setList = allSets.status === 'fulfilled' ? allSets.value : [];
  const latest = setList.reduce<(typeof setList)[number] | null>(
    (newest, set) => (newest === null || set.releaseDate > newest.releaseDate ? set : newest),
    null,
  );
  return {
    cardCount: cards.status === 'fulfilled' ? cards.value.total : null,
    setCount: setList.length > 0 ? setList.length : null,
    latestSet: latest?.name ?? null,
  };
}

export default async function LandingPage() {
  const [profile, facts] = await Promise.all([getOptionalProfile(), catalogFacts()]);
  const stats = [
    facts.cardCount === null
      ? null
      : { value: count.format(facts.cardCount), label: 'Cards catalogued' },
    facts.setCount === null
      ? null
      : { value: count.format(facts.setCount), label: 'Sets to complete' },
    { value: '1,000', label: 'Welcome coins' },
  ].filter((stat) => stat !== null);

  return (
    // The page runs edge to edge: it undoes the padding both shells give their main.
    <div className="-m-8 overflow-hidden">
      <section
        aria-labelledby="hero-title"
        className="mx-auto grid max-w-300 items-center gap-14 px-5 py-14 sm:px-14 lg:grid-cols-[1.05fr_0.95fr] lg:py-24"
      >
        <div>
          {facts.latestSet ? (
            <p className="mb-6 inline-flex items-center gap-2 rounded-pill border border-bd bg-surface px-3 py-1.5 text-small text-mut">
              <span
                aria-hidden
                className="size-1.75 rounded-pill bg-grn shadow-[0_0_10px_var(--grn)]"
              />
              Newest set · {facts.latestSet}
            </p>
          ) : null}
          <h1
            id="hero-title"
            className="mb-5 text-[clamp(2.4rem,5vw,4rem)] leading-[1.02] font-extrabold tracking-[-0.03em]"
          >
            Open. Collect.
            <br />
            Build.{' '}
            <span className="bg-linear-120 from-pri to-energy-water bg-clip-text text-transparent">
              Trade.
            </span>
          </h1>
          <p className="mb-8 max-w-130 text-[1.125rem] leading-relaxed text-mut">
            The Pokémon Trading Card Game, collected online. Rip packs, complete every set, engineer
            decks that are legal to play, and trade with collectors without trusting anyone.
          </p>
          <div className="flex flex-wrap gap-3">
            {profile ? (
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
          <dl className="mt-11 flex flex-wrap gap-8">
            {stats.map((stat) => (
              <div key={stat.label} className="flex flex-col-reverse">
                <dt className="text-small text-faint">{stat.label}</dt>
                <dd className="text-h1 font-bold tracking-tight">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div aria-hidden className="relative flex h-80 items-center justify-center sm:h-110">
          <div className="absolute size-70 animate-pulse-glow rounded-pill bg-pri/35 blur-2xl" />
          <div className="relative flex scale-75 items-center justify-center sm:scale-100">
            {HERO_CARDS.map(({ card, place, delay }, index) => (
              <div key={card.id} className={`absolute ${place}`}>
                <div
                  className={`relative h-65 w-46.5 animate-float overflow-hidden rounded-card border border-white/20 shadow-lg ${delay}`}
                >
                  <CardArt card={card} size="tile" sizes="186px" preload={index === 1} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="features-title" className="mx-auto max-w-300 px-5 pb-24 sm:px-14">
        <h2 id="features-title" className="sr-only">
          What you can do
        </h2>
        <ul className="grid gap-4.5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <li key={title} className="rounded-card border border-bd bg-surface p-6">
              <span className="mb-4 flex size-10.5 items-center justify-center rounded-control bg-pri-dim text-pri">
                <Icon aria-hidden className="size-5" />
              </span>
              <h3 className="mb-2 text-h3 font-semibold">{title}</h3>
              <p className="text-body leading-relaxed text-mut">{body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
