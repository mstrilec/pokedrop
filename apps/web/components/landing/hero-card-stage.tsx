'use client';

import Image from 'next/image';
import { CardArt } from '@/components/cards/card-art';
import type { CardView } from '@/components/cards/card-data';

const SIDE_CARDS: { card: CardView; place: string; delay: string }[] = [
  {
    card: side('base1-2', 'Blastoise', 'Water', 100),
    place: 'left-[4%] -rotate-12',
    delay: '[animation-delay:0.8s]',
  },
  {
    card: side('base1-58', 'Pikachu', 'Lightning', 40),
    place: 'right-[4%] rotate-12',
    delay: '[animation-delay:1.6s]',
  },
];

function side(id: string, name: string, type: string, hp: number): CardView {
  const number = id.slice(id.indexOf('-') + 1);
  return {
    id,
    name,
    image: `https://images.pokemontcg.io/base1/${number}.png`,
    rarity: 'Rare Holo',
    types: [type],
    hp,
    priceUsd: null,
  };
}

export const HERO_CARD_IMAGE = 'https://images.pokemontcg.io/base1/4_hires.png';

export function HeroCardStage() {
  return (
    <div aria-hidden className="relative h-100 min-w-0 sm:h-120 lg:h-140">
      <div className="absolute top-1/2 left-1/2 aspect-square w-[min(92%,460px)] -translate-1/2 animate-pulse-glow rounded-pill bg-[radial-gradient(circle,color-mix(in_srgb,var(--gold)_42%,transparent),color-mix(in_srgb,var(--e-fire)_22%,transparent)_42%,transparent_70%)] blur-2xl" />
      {SIDE_CARDS.map(({ card, place, delay }) => (
        <div
          key={card.id}
          className={`absolute top-[24%] aspect-[63/88] w-[min(30%,176px)] opacity-70 ${place}`}
        >
          <div
            className={`relative size-full animate-float overflow-hidden rounded-card border border-white/20 shadow-lg ${delay}`}
          >
            <CardArt card={card} sizes="176px" />
          </div>
        </div>
      ))}
      <div className="absolute top-1/2 left-1/2 aspect-[63/88] h-[77%] -translate-1/2">
        <div className="relative size-full animate-float overflow-hidden rounded-[14px] border border-gold/40 shadow-[0_0_60px_color-mix(in_srgb,var(--gold)_28%,transparent),var(--elevation-lg)]">
          <Image
            src={HERO_CARD_IMAGE}
            alt=""
            width={734}
            height={1024}
            preload
            fetchPriority="high"
            sizes="(min-width: 1024px) 330px, (min-width: 640px) 300px, 250px"
            className="size-full object-cover"
          />
          <div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_20%,color-mix(in_srgb,var(--e-lightning)_22%,transparent)_38%,color-mix(in_srgb,var(--e-grass)_16%,transparent)_48%,color-mix(in_srgb,var(--e-water)_22%,transparent)_58%,color-mix(in_srgb,var(--e-psychic)_18%,transparent)_68%,transparent_82%)] mix-blend-color-dodge" />
          <div className="absolute inset-y-0 w-[30%] animate-sweep bg-linear-90 from-transparent via-booster-sheen to-transparent" />
        </div>
      </div>
    </div>
  );
}
