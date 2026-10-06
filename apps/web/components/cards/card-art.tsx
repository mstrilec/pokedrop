'use client';

import Image from 'next/image';
import { type CSSProperties, useState } from 'react';
import { energyStyle } from '@/lib/design/energy';
import { isOptimizable } from '@/lib/images';
import { cn } from '@/lib/utils';
import { type CardView, setNumber } from './card-data';

type Size = 'tile' | 'large';

const SIZES: Record<Size, { name: string; hp: string; icon: string; inset: string }> = {
  tile: {
    name: 'text-caption tracking-normal',
    hp: 'text-[10.5px]',
    icon: 'size-11',
    inset: 'inset-x-2.5 top-2.5',
  },
  large: {
    name: 'text-h2 font-extrabold',
    hp: 'text-body',
    icon: 'size-28',
    inset: 'inset-x-4 top-4',
  },
};

// The design's abstract face: the card's energy as a gradient, its type glyph, name and HP.
// It sits under the art, so it is the placeholder while the art loads and what stays when
// the art fails.
export function CardFace({ card, size = 'tile' }: { card: CardView; size?: Size }) {
  const energy = energyStyle(card.types[0] ?? 'Colorless');
  const Icon = energy.icon;
  const s = SIZES[size];
  return (
    <div
      aria-hidden
      className="absolute inset-0 flex items-center justify-center bg-card-face"
      style={{ '--energy': energy.face } as CSSProperties}
    >
      <div className={cn('absolute flex items-center justify-between gap-2', s.inset)}>
        <span className={cn('truncate font-bold text-white', s.name)}>{card.name}</span>
        {card.hp !== null ? (
          <span className={cn('shrink-0 font-mono font-semibold text-white/90', s.hp)}>
            HP {card.hp}
          </span>
        ) : null}
      </div>
      <Icon className={cn('text-white/90', s.icon)} />
      <span className="absolute bottom-2.5 left-2.5 font-mono text-[9.5px] text-white/75">
        {setNumber(card.id)}
      </span>
    </div>
  );
}

export function CardArt({
  card,
  size = 'tile',
  sizes,
  preload = false,
}: {
  card: CardView;
  size?: Size;
  /** The `sizes` attribute: how wide the art renders, so the optimizer sends no more. */
  sizes: string;
  preload?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <>
      <CardFace card={card} size={size} />
      {failed ? null : (
        <Image
          src={card.image}
          alt=""
          fill
          sizes={sizes}
          unoptimized={!isOptimizable(card.image)}
          preload={preload}
          fetchPriority={preload ? 'high' : undefined}
          onError={() => setFailed(true)}
          className="object-cover"
        />
      )}
    </>
  );
}
