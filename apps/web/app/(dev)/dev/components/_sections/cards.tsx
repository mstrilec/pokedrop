'use client';

import { useQueries } from '@tanstack/react-query';
import { useState } from 'react';
import { type CardView, cardView } from '@/components/cards/card-data';
import { CardTile } from '@/components/cards/card-tile';
import { RevealCard } from '@/components/cards/reveal-card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/browser';
import { searchCards } from '@/lib/api/endpoints/catalog';
import { keys } from '@/lib/query/keys';
import { Group, Row, Specimen } from './frame';

const TIER_SAMPLES = [
  'Common',
  'Uncommon',
  'Rare Holo',
  'Illustration Rare',
  'Special Illustration Rare',
];

function useCards(rarities: string[]): CardView[] {
  const results = useQueries({
    queries: rarities.map((rarity) => ({
      queryKey: keys.catalog.search({ rarity, pageSize: 1 }),
      queryFn: () => api.call(searchCards({ rarity, pageSize: 1 })),
    })),
  });
  return results.flatMap((r) => (r.data?.items[0] ? [cardView(r.data.items[0])] : []));
}

function useManyCards(enabled: boolean): CardView[] {
  const results = useQueries({
    queries: [1, 2, 3, 4, 5].map((page) => ({
      queryKey: keys.catalog.search({ page, pageSize: 100 }),
      queryFn: () => api.call(searchCards({ page, pageSize: 100 })),
      enabled,
    })),
  });
  return results.flatMap((r) => r.data?.items.map(cardView) ?? []);
}

export function CardsSection() {
  const samples = useCards(TIER_SAMPLES);
  const [selected, setSelected] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [round, setRound] = useState(0);
  const [many, setMany] = useState(false);
  const grid = useManyCards(many);

  const [first] = samples;
  const highest = samples.at(-1);
  const broken = first ? { ...first, image: 'https://images.pokemontcg.io/missing/0.png' } : null;

  return (
    <Group id="cards" title="TCG cards">
      <Specimen name="CardTile">
        <Row label="The five tiers, from real cards (rarity text, tier color, glow on Ultra and Secret)">
          <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3.5">
            {samples.map((card) => (
              <CardTile key={card.id} card={card} />
            ))}
          </div>
        </Row>
        {first && broken ? (
          <Row label="Owned ×3 · not owned · selected (a toggle) · art that fails to load">
            <div className="grid w-full grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3.5">
              <CardTile card={first} owned={3} />
              <CardTile card={first} owned={0} />
              <CardTile card={first} onSelect={() => setSelected((s) => !s)} selected={selected} />
              <CardTile card={broken} owned={1} />
            </div>
          </Row>
        ) : null}
      </Specimen>

      <Specimen name="RevealCard">
        {highest ? (
          <Row label="Large, flipped by the button, with the rare-pull glow">
            <div className="flex items-center gap-8">
              <div className="w-56">
                <RevealCard card={highest} size="large" revealed={revealed} highlight />
              </div>
              <Button variant="secondary" onClick={() => setRevealed((r) => !r)}>
                {revealed ? 'Turn face down' : 'Flip'}
              </Button>
            </div>
          </Row>
        ) : null}
        <Row label="Summary: each card flips in, 80 ms after the one before">
          <div
            key={round}
            className="grid w-full grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3"
          >
            {samples.map((card, index) => (
              <RevealCard key={card.id} card={card} appear index={index} highlight={index >= 2} />
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={() => setRound((n) => n + 1)}>
            Replay
          </Button>
        </Row>
      </Specimen>

      <Specimen name="500 tiles">
        <Row label={many ? `${grid.length} tiles` : 'A grid the size of a big collection'}>
          <Button size="sm" variant="secondary" onClick={() => setMany((m) => !m)}>
            {many ? 'Remove the grid' : 'Render 500 tiles'}
          </Button>
        </Row>
        {many ? (
          <div
            id="tile-grid"
            className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3.5"
          >
            {grid.map((card, index) => (
              <CardTile key={`${card.id}-${index}`} card={card} owned={index % 4} />
            ))}
          </div>
        ) : null}
      </Specimen>
    </Group>
  );
}
