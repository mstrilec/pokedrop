'use client';

import type { PackOpenResult, PackTemplateView } from '@pokedrop/shared';
import { Check, Layers, PackageOpen } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CardTile } from '@/components/cards/card-tile';
import { cardView, formatUsd } from '@/components/cards/card-data';
import { Button } from '@/components/ui/button';
import { rarityTier } from '@/lib/design/rarity';
import { formatCoins } from '@/lib/format';
import { ConfirmOpenDialog } from '../confirm-open-dialog';

export function SummaryStage({
  name,
  result,
  template,
  onOpenAnother,
}: {
  name: string;
  result: PackOpenResult;
  template: PackTemplateView | undefined;
  onOpenAnother: (template: PackTemplateView) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const [confirming, setConfirming] = useState(false);

  const rareOrBetter = result.cards.filter((pull) => {
    const tier = rarityTier(pull.rarity);
    return tier !== 'Common' && tier !== 'Uncommon';
  }).length;
  const priced = result.cards.filter((pull) => pull.card.latestPriceUsd !== null);
  const value = priced.reduce((sum, pull) => sum + (pull.card.latestPriceUsd ?? 0), 0);
  const unpriced = result.cards.length - priced.length;

  const figures = [
    { label: 'Cards', value: String(result.cards.length) },
    { label: 'Rare or better', value: String(rareOrBetter) },
    { label: 'Market value', value: formatUsd(value) },
    { label: 'Balance', value: `${formatCoins(result.balance)} coins` },
  ];

  return (
    <div className="flex w-full max-w-4xl flex-col items-center gap-6">
      <span className="flex size-15 items-center justify-center rounded-pill border border-grn/30 bg-grn/14 text-grn">
        <Check aria-hidden className="size-7.5" />
      </span>
      <h1 ref={heading} tabIndex={-1} className="text-h1 font-bold outline-none">
        {name} opened
      </h1>
      <dl className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
        {figures.map((figure) => (
          <div
            key={figure.label}
            className="flex flex-col-reverse rounded-card border border-bd bg-surface p-4 text-center"
          >
            <dt className="text-caption text-faint uppercase">{figure.label}</dt>
            <dd className="font-mono text-h3 font-bold">{figure.value}</dd>
          </div>
        ))}
      </dl>
      {unpriced > 0 ? (
        <p className="-mt-3 text-caption text-faint">
          {unpriced === 1 ? '1 card has' : `${unpriced} cards have`} no market price yet.
        </p>
      ) : null}
      <h2 className="self-start text-caption text-faint uppercase">Your pulls</h2>
      <ul className="grid w-full grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        {result.cards.map((pull) => (
          <li key={pull.position}>
            <CardTile
              card={cardView({ ...pull.card, rarity: pull.rarity })}
              sizes="(min-width: 1024px) 170px, 30vw"
            />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild variant="secondary" size="lg" icon={Layers}>
          <Link href="/inventory">View in collection</Link>
        </Button>
        {template ? (
          <Button size="lg" icon={PackageOpen} onClick={() => setConfirming(true)}>
            Open another · {formatCoins(template.cost)}
          </Button>
        ) : null}
      </div>
      <ConfirmOpenDialog
        template={confirming && template ? template : null}
        onClose={() => setConfirming(false)}
        onConfirm={onOpenAnother}
      />
    </div>
  );
}
