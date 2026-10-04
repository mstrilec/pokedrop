'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CompletionMeter } from '@/components/ui/completion-meter';
import { CurrencyPill } from '@/components/ui/currency-pill';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Row, Specimen } from './frame';

export function LoadingEconomySection() {
  const [balance, setBalance] = useState(1250);
  const [owned, setOwned] = useState(42);

  return (
    <>
      <Specimen name="Spinner">
        <Row label="16 inline · 24 · 34 with a visible label">
          <Spinner size={16} />
          <Spinner size={24} />
          <Spinner showLabel label="Opening pack…" />
        </Row>
      </Specimen>

      <Specimen name="Skeleton">
        <Row label="A card tile, a list row and an avatar, each the size of what they replace">
          <div aria-busy className="w-44 overflow-hidden rounded-tile border border-bd bg-surface">
            <Skeleton shape="block" height="150px" className="rounded-none" />
            <div className="flex flex-col gap-2 p-3">
              <Skeleton width="70%" />
              <Skeleton width="40%" />
            </div>
          </div>
          <div
            aria-busy
            className="flex w-72 items-center gap-3 rounded-card border border-bd bg-surface p-4"
          >
            <Skeleton shape="block" width="38px" height="38px" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton width="60%" />
              <Skeleton width="35%" />
            </div>
          </div>
          <Skeleton shape="circle" width="44px" />
        </Row>
      </Specimen>

      <Specimen name="CurrencyPill">
        <Row label="Interactive md · sm · static · unknown · abbreviated">
          <CurrencyPill amount={balance} />
          <CurrencyPill amount={balance} size="sm" />
          <CurrencyPill amount={balance} interactive={false} />
          <CurrencyPill amount={null} />
          <CurrencyPill amount={1_250_000} interactive={false} animate={false} />
        </Row>
        <Row label="Change the balance above">
          <Button size="sm" variant="economy" onClick={() => setBalance((b) => b + 500)}>
            Grant 500
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setBalance((b) => Math.max(0, b - 150))}
          >
            Spend 150
          </Button>
        </Row>
      </Specimen>

      <Specimen name="CompletionMeter">
        <div className="grid max-w-md gap-5">
          <CompletionMeter label="Base Set" value={0} max={102} />
          <CompletionMeter label="Jungle" value={owned} max={64} color="var(--e-grass)" />
          <CompletionMeter label="Fossil" value={62} max={62} color="var(--e-fire)" height={8} />
          <CompletionMeter label="Team Rocket" value={30} max={83} showHeader={false} />
        </div>
        <Row label="Change Jungle">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setOwned((n) => Math.min(64, n + 10))}
          >
            Add 10 cards
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOwned(0)}>
            Reset
          </Button>
        </Row>
      </Specimen>
    </>
  );
}
