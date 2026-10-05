'use client';

import { ArrowDownLeft, ArrowUpRight, Coins, Lock, Minus, Plus, X } from 'lucide-react';
import { useId } from 'react';
import { CardTile } from '@/components/cards/card-tile';
import { type CardView, formatUsd } from '@/components/cards/card-data';
import { CurrencyInput } from '@/components/ui/currency-input';
import { cn } from '@/lib/utils';

export type OfferLine = {
  card: CardView;
  count: number;
  locked?: boolean;
  /** The stepper's ceiling when editable: available copies on the give side. */
  max?: number;
  /** Why this line keeps the offer from being sent, shown under it. */
  problem?: string;
};
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
  onCountChange?: (side: SideKey, cardId: string, count: number) => void;
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
  onCountChange,
  onCoinsChange,
}: {
  side: SideKey;
  data: OfferSide;
} & Pick<
  TradeOfferPanelProps,
  'editable' | 'balance' | 'onAddCard' | 'onRemoveCard' | 'onCountChange' | 'onCoinsChange'
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
              {editable && !line.locked && onCountChange ? (
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`One fewer ${line.card.name}`}
                    disabled={line.count <= 1}
                    onClick={() => onCountChange(side, line.card.id, line.count - 1)}
                    className="focus-ring flex size-6 cursor-pointer items-center justify-center rounded-tag border border-bd-2 text-mut hover:text-tx disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Minus aria-hidden className="size-3" />
                  </button>
                  <span aria-live="polite" className="min-w-6 text-center font-mono text-tx">
                    <span className="sr-only">{line.card.name}: </span>×{line.count}
                  </span>
                  <button
                    type="button"
                    aria-label={`One more ${line.card.name}`}
                    disabled={line.max !== undefined && line.count >= line.max}
                    onClick={() => onCountChange(side, line.card.id, line.count + 1)}
                    className="focus-ring flex size-6 cursor-pointer items-center justify-center rounded-tag border border-bd-2 text-mut hover:text-tx disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus aria-hidden className="size-3" />
                  </button>
                </span>
              ) : (
                <span className="font-mono text-mut">×{line.count}</span>
              )}
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
            {line.problem ? <p className="text-[11px] leading-4 text-red">{line.problem}</p> : null}
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
