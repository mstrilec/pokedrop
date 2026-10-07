'use client';

import type { PackArt } from '@pokedrop/shared';
import Image from 'next/image';
import { type CSSProperties, useState } from 'react';
import { energyStyle } from '@/lib/design/energy';
import { RARITY_STYLES, rarityTier } from '@/lib/design/rarity';
import { isOptimizable } from '@/lib/images';
import { cn } from '@/lib/utils';

type Size = 'sm' | 'md' | 'lg' | 'xl';
type Sheen = 'loop' | 'hover' | 'none';

const SIZES: Record<
  Size,
  {
    box: string;
    pad: string;
    logo: string;
    set: string;
    name: string;
    count: string;
    icon: string;
    px: number;
  }
> = {
  sm: {
    box: 'w-18',
    pad: 'gap-1 px-1.5 py-2.5',
    logo: 'h-4',
    set: 'text-[7px]',
    name: 'hidden',
    count: 'hidden',
    icon: 'size-4',
    px: 72,
  },
  md: {
    box: 'w-37.5',
    pad: 'gap-2 px-3 py-4',
    logo: 'h-9',
    set: 'text-[11px]',
    name: 'text-[12px]',
    count: 'text-[10px]',
    icon: 'size-8',
    px: 150,
  },
  lg: {
    box: 'w-55',
    pad: 'gap-3 px-4 py-5',
    logo: 'h-12',
    set: 'text-small',
    name: 'text-[15px]',
    count: 'text-[12px]',
    icon: 'size-11',
    px: 220,
  },
  xl: {
    box: 'w-75',
    pad: 'gap-4 px-5 py-6',
    logo: 'h-16',
    set: 'text-body',
    name: 'text-h3',
    count: 'text-small',
    icon: 'size-14',
    px: 300,
  },
};

/** A booster wrapper: an admin's photo, or one drawn from the set logo and the featured card. */
export function BoosterPack({
  art,
  name,
  cardCount,
  size,
  sheen = 'none',
  className,
}: {
  art: PackArt | null;
  name: string;
  cardCount?: number;
  size: Size;
  sheen?: Sheen;
  className?: string;
}) {
  const s = SIZES[size];
  const [photoFailed, setPhotoFailed] = useState<string | null>(null);
  const photo = art?.imageUrl && photoFailed !== art.imageUrl ? art.imageUrl : null;

  return (
    <div
      role="img"
      aria-label={`${name} booster pack`}
      className={cn('relative aspect-[5/8] shrink-0', s.box, className)}
    >
      {photo ? (
        <Image
          src={photo}
          alt=""
          fill
          sizes={`${s.px}px`}
          unoptimized={!isOptimizable(photo)}
          onError={() => setPhotoFailed(photo)}
          className="object-contain"
        />
      ) : (
        <DrawnWrapper art={art} name={name} cardCount={cardCount} sheen={sheen} s={s} />
      )}
    </div>
  );
}

function DrawnWrapper({
  art,
  name,
  cardCount,
  sheen,
  s,
}: {
  art: PackArt | null;
  name: string;
  cardCount: number | undefined;
  sheen: Sheen;
  s: (typeof SIZES)[Size];
}) {
  const energy = energyStyle(art?.cover?.type ?? 'Colorless');
  const Icon = energy.icon;
  const rarity = RARITY_STYLES[rarityTier(art?.cover?.rarity ?? null)];
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const fail = (src: string) => setFailed((prev) => new Set(prev).add(src));
  const logo = art?.set.logoUrl && !failed.has(art.set.logoUrl) ? art.set.logoUrl : null;
  const cover = art?.cover && !failed.has(art.cover.image) ? art.cover : null;

  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-tag bg-booster text-booster-ink booster-crimp"
      style={{ '--energy': energy.face, '--rarity': rarity.color } as CSSProperties}
    >
      <div aria-hidden className="absolute inset-x-0 top-0 h-1/16 bg-booster-shade" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/16 bg-booster-shade" />
      {sheen === 'none' ? null : (
        <div
          aria-hidden
          className={cn(
            'absolute inset-y-0 w-1/4 bg-linear-90 from-transparent via-booster-sheen to-transparent',
            sheen === 'loop'
              ? 'animate-sweep'
              : '-translate-x-[140%] -skew-x-18 transition-transform duration-700 group-hover/pack:translate-x-[420%]',
          )}
        />
      )}
      <div className={cn('relative flex h-full flex-col items-center justify-between', s.pad)}>
        <div className={cn('relative flex w-full shrink-0 items-center justify-center', s.logo)}>
          {logo ? (
            <Image
              src={logo}
              alt=""
              fill
              sizes={`${s.px}px`}
              unoptimized={!isOptimizable(logo)}
              onError={() => fail(logo)}
              className="object-contain"
            />
          ) : art ? (
            <span className={cn('truncate font-extrabold tracking-tight uppercase', s.set)}>
              {art.set.name}
            </span>
          ) : null}
        </div>
        <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-tile border-2 border-(--rarity) bg-card-face">
          {cover ? (
            <Image
              src={cover.image}
              alt=""
              fill
              sizes={`${s.px}px`}
              unoptimized={!isOptimizable(cover.image)}
              onError={() => fail(cover.image)}
              className="object-cover object-[50%_15%]"
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center">
              <Icon aria-hidden className={cn('text-booster-ink', s.icon)} />
            </span>
          )}
        </div>
        <div className="flex w-full shrink-0 flex-col items-center text-center">
          <span className={cn('line-clamp-2 leading-tight font-extrabold', s.name)}>{name}</span>
          {cardCount !== undefined ? (
            <span className={cn('font-mono font-semibold opacity-85', s.count)}>
              {cardCount} cards
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
