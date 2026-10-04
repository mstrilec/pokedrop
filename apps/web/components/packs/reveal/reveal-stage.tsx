'use client';

import type { PackOpenResult } from '@pokedrop/shared';
import { useEffect, useRef, useState } from 'react';
import { RevealCard } from '@/components/cards/reveal-card';
import { cardView } from '@/components/cards/card-data';
import { Button } from '@/components/ui/button';
import { isHighRarity, RARITY_STYLES, rarityTier } from '@/lib/design/rarity';

export function RevealStage({
  cards,
  index,
  onNext,
  onSkip,
}: {
  cards: PackOpenResult['cards'];
  index: number;
  onNext: () => void;
  onSkip: () => void;
}) {
  const [flippedIndex, setFlippedIndex] = useState(-1);
  const flipped = flippedIndex === index;
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);

  const pull = cards[index];
  if (!pull) return null;
  const card = cardView({ ...pull.card, rarity: pull.rarity });
  const tier = rarityTier(pull.rarity);
  const style = RARITY_STYLES[tier];
  const big = isHighRarity(tier);
  const last = index === cards.length - 1;

  function activate() {
    if (flipped) onNext();
    else setFlippedIndex(index);
  }

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <div className="flex w-full max-w-md items-center justify-between">
        <span className="font-mono text-small text-mut">
          {index + 1} / {cards.length}
        </span>
        <Button variant="secondary" size="sm" onClick={onSkip}>
          Skip all →
        </Button>
      </div>

      <div className="relative flex h-8 items-center">
        {flipped && big ? (
          <span
            className="text-small font-bold tracking-[0.12em] uppercase"
            style={{ color: style.color }}
          >
            {style.label} pull
          </span>
        ) : null}
      </div>

      <div aria-hidden onClick={activate} className="relative cursor-pointer">
        {flipped && big ? (
          <>
            <span
              className="pointer-events-none absolute -inset-75 animate-ray-spin rounded-pill opacity-15"
              style={{
                background: `conic-gradient(from 0deg, transparent 0deg, ${style.color} 12deg, transparent 24deg, transparent 36deg, ${style.color} 48deg, transparent 60deg, transparent 72deg, ${style.color} 84deg, transparent 96deg)`,
              }}
            />
            <span
              className="pointer-events-none absolute -inset-30 animate-burst rounded-pill"
              style={{ background: `radial-gradient(circle, ${style.color}, transparent 66%)` }}
            />
          </>
        ) : null}
        <div key={index} className="w-72.5 animate-card-in">
          <RevealCard
            card={card}
            revealed={flipped}
            highlight={tier !== 'Common' && tier !== 'Uncommon'}
            size="large"
          />
        </div>
      </div>

      <Button ref={button} size="lg" onClick={activate}>
        {!flipped ? 'Reveal card' : last ? 'See all cards' : 'Next card'}
      </Button>
      <p aria-live="polite" className="sr-only">
        {flipped ? `Card ${index + 1} of ${cards.length}: ${card.name}, ${pull.rarity}` : ''}
      </p>
    </div>
  );
}
