import type { Card, CardSet } from '@pokedrop/shared';
import { Gem } from 'lucide-react';
import Link from 'next/link';
import { CardArt } from '@/components/cards/card-art';
import { cardView, formatUsd } from '@/components/cards/card-data';
import { RARITY_STYLES, rarityTier } from '@/lib/design/rarity';
import { cn } from '@/lib/utils';
import { MarqueeMotion } from './marquee-motion';
import { SectionHeading } from './section-heading';

export function ChaseItem({
  card,
  setName,
  copy = false,
}: {
  card: Card;
  setName: string;
  /** The marquee's second, decorative copy: clickable, but out of the tab order. */
  copy?: boolean;
}) {
  const style = RARITY_STYLES[rarityTier(card.rarity)];
  const number = card.id.slice(card.id.lastIndexOf('-') + 1);
  return (
    <li className="w-37.5 flex-none snap-start sm:w-44">
      <Link
        href={`/cards/${encodeURIComponent(card.id)}`}
        tabIndex={copy ? -1 : undefined}
        className="focus-ring flex flex-col gap-2.5 rounded-tile border border-pri/30 bg-surface p-2 text-tx shadow-[0_0_22px_color-mix(in_srgb,var(--pri)_10%,transparent)] transition-[translate,border-color,box-shadow] duration-200 hover:-translate-y-1 hover:border-pri hover:shadow-md"
      >
        <span className="relative block aspect-[63/88] overflow-hidden rounded-control">
          <CardArt card={cardView(card)} sizes="176px" />
        </span>
        <span className="flex flex-col gap-1 px-1 pb-1">
          <span className="truncate text-body font-semibold">{card.name}</span>
          <span
            className={cn(
              'inline-flex min-w-0 items-center gap-1.5 text-caption normal-case',
              style.text,
            )}
          >
            <span
              aria-hidden
              className="size-1.75 shrink-0 rounded-pill"
              style={{ background: style.color }}
            />
            <span className="truncate">{card.rarity ?? style.label}</span>
          </span>
          <span className="font-mono text-body font-semibold text-tx">
            {formatUsd(card.latestPriceUsd)}
          </span>
          <span className="line-clamp-2 font-mono text-caption font-normal tracking-normal text-faint">
            {setName} · {number}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function ChaseMarquee({ cards, sets }: { cards: Card[]; sets: CardSet[] }) {
  if (cards.length === 0) return null;
  const names = new Map(sets.map((set) => [set.id, set.name]));
  const item = (card: Card, copy: boolean) => (
    <ChaseItem
      key={card.id}
      card={card}
      setName={names.get(card.setId) ?? card.setId}
      copy={copy}
    />
  );

  return (
    <section aria-labelledby="chase-title" className="py-14 sm:py-20 lg:py-28">
      <div className="mx-auto mb-8 max-w-300 px-5 sm:px-14">
        <SectionHeading
          id="chase-title"
          eyebrow="Chase cards"
          icon={Gem}
          tone="text-gold"
          title="The cards collectors chase"
          lead="The catalog’s most valuable cards, at their latest market price."
        />
      </div>
      <MarqueeMotion
        items={cards.map((card) => item(card, false))}
        copy={cards.map((card) => item(card, true))}
        label="Most valuable cards"
      />
    </section>
  );
}
