'use client';

import { Lock } from 'lucide-react';
import Link from 'next/link';
import { type CSSProperties, memo, type ReactNode } from 'react';
import { isHighRarity, RARITY_STYLES, rarityTier } from '@/lib/design/rarity';
import { cn } from '@/lib/utils';
import { CardArt } from './card-art';
import { type CardView, formatUsd } from './card-data';

type CardTileProps = {
  card: CardView;
  /** Copies owned: omit where ownership is not the question, 0 locks the tile. */
  owned?: number;
  /** Of `owned`, how many are promised to pending trades. */
  locked?: number;
  /** Where the tile leads; defaults to the card's page. Ignored with `onSelect`. */
  href?: string;
  /** Makes the tile a toggle button instead of a link (pickers, the trade composer). */
  onSelect?: () => void;
  selected?: boolean;
  /** How wide the tile renders, for the image optimizer. */
  sizes?: string;
  className?: string;
};

function spokenName(
  card: CardView,
  rarity: string,
  owned: number | undefined,
  locked: number,
): string {
  const parts = [card.name, rarity];
  if (owned === 0) parts.push('not owned');
  else if (owned !== undefined && locked >= owned) {
    parts.push(`${owned} owned, all locked in pending trades`);
  } else if (owned !== undefined && locked > 0) {
    parts.push(`${owned} owned, ${locked} locked in pending trades`);
  } else if (owned !== undefined) parts.push(`${owned} owned`);
  if (card.priceUsd !== null) parts.push(formatUsd(card.priceUsd));
  return parts.join(', ');
}

function CardTileImpl({
  card,
  owned,
  locked = 0,
  href,
  onSelect,
  selected = false,
  sizes = '(min-width: 1024px) 180px, 45vw',
  className,
}: CardTileProps) {
  const tier = rarityTier(card.rarity);
  const style = RARITY_STYLES[tier];
  const rarityLabel = card.rarity ?? tier;
  const unavailable = owned === 0 || (owned !== undefined && locked >= owned);

  const body: ReactNode = (
    <>
      <div className="relative aspect-[5/7] overflow-hidden">
        <div className={cn('absolute inset-0', unavailable && 'grayscale')}>
          <CardArt card={card} sizes={sizes} />
        </div>
        {owned !== undefined && owned > 0 ? (
          <span className="absolute top-2 right-2 rounded-tag bg-black/50 px-1.5 py-0.5 font-mono text-[10px] leading-4 font-semibold text-white">
            ×{owned}
            {locked > 0 && locked < owned ? ` · ${locked} locked` : null}
          </span>
        ) : null}
        {unavailable ? (
          <div className="absolute inset-0 flex items-center justify-center bg-bg/60">
            <Lock className="size-4.5 text-white/55" />
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-1.5 border-t border-bd bg-surface px-2.5 py-2">
        <span
          title={rarityLabel}
          className={cn('flex min-w-0 items-center gap-1.5 text-[11px] font-semibold', style.text)}
        >
          <span className="size-1.75 shrink-0 rounded-pill bg-current" />
          <span className="truncate">{rarityLabel}</span>
        </span>
        <span className="shrink-0 font-mono text-[12px] font-semibold text-tx">
          {formatUsd(card.priceUsd)}
        </span>
      </div>
    </>
  );

  const classes = cn(
    'focus-ring group relative block overflow-hidden rounded-tile border bg-surface text-left transition hover:-translate-y-1 hover:border-(--rarity) hover:shadow-md',
    isHighRarity(tier) ? style.emphasis : 'border-bd',
    selected && 'ring-2 ring-pri ring-offset-2 ring-offset-bg',
    className,
  );
  const rarityVar = { '--rarity': style.color } as CSSProperties;
  const label = spokenName(card, rarityLabel, owned, locked);

  return onSelect ? (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(classes, 'w-full cursor-pointer')}
      style={rarityVar}
    >
      {body}
    </button>
  ) : (
    <Link
      href={href ?? `/cards/${encodeURIComponent(card.id)}`}
      aria-label={label}
      className={classes}
      style={rarityVar}
    >
      {body}
    </Link>
  );
}

// Grids render hundreds of these; a parent re-render must not re-render every tile.
export const CardTile = memo(CardTileImpl);
