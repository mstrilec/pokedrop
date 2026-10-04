'use client';

import { ArrowDownLeft, ArrowUpRight, Coins, Lock, Plus, X } from 'lucide-react';
import { useId } from 'react';
import { CardTile } from '@/components/cards/card-tile';
import { type CardView, formatUsd } from '@/components/cards/card-data';
import { CurrencyInput } from '@/components/ui/currency-input';
import { cn } from '@/lib/utils';

export type OfferLine = { card: CardView; count: number; locked?: boolean };
export type OfferSide = {
  /** `You give`, `MistyW gives`: whose side, unambiguously. */
  label: string;
  cards: OfferLine[];
  coins: number;
};
type SideKey = 'give' | 'get';

type TradeOfferPanelProps = {
  give: OfferSide;
  get: OfferSide;
  editable?: boolean;
  /** Caps the coins on the give side. */
  balance?: number;
  onAddCard?: (side: SideKey) => void;
  onRemoveCard?: (side: SideKey, cardId: string) => void;
  onCoinsChange?: (side: SideKey, coins: number) => void;
  className?: string;
};

function marketValue(lines: OfferLine[]): number | null {
  const priced = lines.filter((l) => l.card.priceUsd !== null);
  return priced.length === 0
    ? null
    : priced.reduce((sum, l) => sum + (l.card.priceUsd ?? 0) * l.count, 0);
}

function Side({
  side,
  data,
  editable,
  balance,
  onAddCard,
  onRemoveCard,
  onCoinsChange,
}: {
  side: SideKey;
  data: OfferSide;
} & Pick<
  TradeOfferPanelProps,
  'editable' | 'balance' | 'onAddCard' | 'onRemoveCard' | 'onCoinsChange'
>) {
  const headingId = useId();
  const give = side === 'give';
  const Arrow = give ? ArrowUpRight : ArrowDownLeft;
  const value = marketValue(data.cards);
  const count = data.cards.reduce((n, l) => n + l.count, 0);

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'flex flex-col gap-4 rounded-card border bg-surface p-4',
        give ? 'border-red/25' : 'border-grn/25',
      )}
    >
      <h3 id={headingId} className="flex items-center gap-2 text-h3">
        <span
          aria-hidden
          className={cn(
            'flex size-7 items-center justify-center rounded-control',
            give ? 'bg-red-dim text-red' : 'bg-grn/14 text-grn',
          )}
        >
          <Arrow className="size-4" />
        </span>
        {data.label}
      </h3>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
        {data.cards.map((line) => (
          <li key={line.card.id} className="flex flex-col gap-1.5">
            <CardTile card={line.card} sizes="120px" />
            <div className="flex items-center justify-between gap-1 text-[11.5px]">
              <span className="font-mono text-mut">×{line.count}</span>
              {line.locked ? (
                <span className="flex items-center gap-1 text-gold">
                  <Lock aria-hidden className="size-3" />
                  Locked in escrow
                </span>
              ) : null}
              {editable && !line.locked ? (
                <button
                  type="button"
                  aria-label={`Remove ${line.card.name} from ${data.label.toLowerCase()}`}
                  onClick={() => onRemoveCard?.(side, line.card.id)}
                  className="focus-ring flex size-6 cursor-pointer items-center justify-center rounded-tag text-mut hover:bg-surface-2 hover:text-tx"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              ) : null}
            </div>
          </li>
        ))}
        {editable ? (
          <li>
            <button
              type="button"
              onClick={() => onAddCard?.(side)}
              className="focus-ring flex aspect-[5/7] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-tile border border-dashed border-bd-2 text-small text-mut transition hover:border-pri hover:text-pri"
            >
              <Plus aria-hidden className="size-5" />
              {give ? 'Add a card you give' : 'Add a card you get'}
            </button>
          </li>
        ) : null}
      </ul>
      {editable ? (
        <CurrencyInput
          label={give ? 'Coins you give' : 'Coins you get'}
          value={data.coins}
          max={give ? balance : undefined}
          onChange={(coins) => onCoinsChange?.(side, coins)}
        />
      ) : data.coins > 0 ? (
        <p className="flex items-center gap-2 font-mono text-mono text-gold">
          <Coins aria-hidden className="size-4" />
          {data.coins.toLocaleString('en-US')} coins
        </p>
      ) : null}
      <p className="border-t border-bd pt-3 text-small text-mut">
        {count} {count === 1 ? 'card' : 'cards'}
        {value !== null ? <> · market value {formatUsd(value)}</> : null}
        {data.coins > 0 ? <> · {data.coins.toLocaleString('en-US')} coins</> : null}
      </p>
    </section>
  );
}

/** The two sides of a trade, each a labelled region saying whose side it is. */
export function TradeOfferPanel({ give, get, className, ...rest }: TradeOfferPanelProps) {
  return (
    <div className={cn('grid gap-4 md:grid-cols-2', className)}>
      <Side side="give" data={give} {...rest} />
      <Side side="get" data={get} {...rest} />
    </div>
  );
}
