'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { CardArt } from '@/components/cards/card-art';
import type { CardView } from '@/components/cards/card-data';
import { cn } from '@/lib/utils';
import type { HeroCardHandle } from './three/hero-card';
import { useThreeMode } from './use-three-mode';

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

// Waits for the page to load and the browser to idle: the 3D card must never
// compete with the poster, which is the LCP.
function whenIdle(run: () => void): () => void {
  const idle = typeof window.requestIdleCallback === 'function';
  let id = 0;
  const schedule = () => {
    id = idle ? window.requestIdleCallback(run, { timeout: 1500 }) : window.setTimeout(run, 600);
  };
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
  return () => {
    window.removeEventListener('load', schedule);
    if (idle) window.cancelIdleCallback(id);
    else window.clearTimeout(id);
  };
}

export function HeroCardStage() {
  const mode = useThreeMode();
  const mountRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (mode !== 'full' || !mount) return;
    let handle: HeroCardHandle | null = null;
    let gone = false;
    const cancel = whenIdle(() => {
      void import('./three/hero-card')
        .then(async ({ init }) => {
          if (gone) return;
          const h = await init(mount, {
            image: HERO_CARD_IMAGE,
            pointerTarget: mount.closest('section') ?? mount,
            onReady: () => setReady(true),
            onFallback: () => setReady(false),
          });
          if (gone) h.dispose();
          else handle = h;
        })
        .catch(() => setReady(false));
    });
    return () => {
      gone = true;
      cancel();
      handle?.dispose();
    };
  }, [mode]);

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
      <div
        className={cn(
          'absolute top-1/2 left-1/2 aspect-[63/88] h-[77%] -translate-1/2 transition-opacity delay-200 duration-400',
          ready && 'opacity-0',
        )}
      >
        <div className="relative size-full animate-float overflow-hidden rounded-[14px] border border-gold/40 shadow-[0_0_60px_color-mix(in_srgb,var(--gold)_28%,transparent),var(--elevation-lg)]">
          <Image
            src={HERO_CARD_IMAGE}
            alt=""
            width={734}
            height={1024}
            sizes="(min-width: 1024px) 330px, (min-width: 640px) 300px, 250px"
            className="size-full object-cover"
          />
          <div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_20%,color-mix(in_srgb,var(--e-lightning)_22%,transparent)_38%,color-mix(in_srgb,var(--e-grass)_16%,transparent)_48%,color-mix(in_srgb,var(--e-water)_22%,transparent)_58%,color-mix(in_srgb,var(--e-psychic)_18%,transparent)_68%,transparent_82%)] mix-blend-color-dodge" />
          <div className="absolute inset-y-0 w-[30%] animate-sweep bg-linear-90 from-transparent via-booster-sheen to-transparent" />
        </div>
      </div>
      <div ref={mountRef} className="absolute inset-0" />
    </div>
  );
}
