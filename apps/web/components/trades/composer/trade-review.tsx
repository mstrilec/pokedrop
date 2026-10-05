'use client';

import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Send } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { formatCoins } from '@/lib/format';
import { cn } from '@/lib/utils';
import { cardCount, type ComposerState, type Line, lineText } from './composer-state';

function SideList({
  heading,
  give,
  lines,
  coins,
  empty,
}: {
  heading: string;
  give: boolean;
  lines: Line[];
  coins: number;
  empty: string;
}) {
  const Arrow = give ? ArrowUpRight : ArrowDownLeft;
  return (
    <section
      aria-label={heading}
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-card border bg-surface p-4 wrap-anywhere',
        give ? 'border-red/25' : 'border-grn/25',
      )}
    >
      <h2 className="flex items-center gap-2 text-h3">
        <Arrow aria-hidden className={cn('size-4 shrink-0', give ? 'text-red' : 'text-grn')} />
        <span className="min-w-0">{heading}</span>
      </h2>
      {lines.length === 0 && coins === 0 ? (
        <p className="text-body text-mut">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-body text-tx">
          {lines.map((line) => (
            <li key={line.card.id}>{lineText(line)}</li>
          ))}
          {coins > 0 ? <li>{formatCoins(coins)} coins</li> : null}
        </ul>
      )}
    </section>
  );
}

export function TradeReview({
  state,
  sending,
  onBack,
  onSend,
}: {
  state: ComposerState;
  sending: boolean;
  onBack: () => void;
  onSend: () => void;
}) {
  const name = state.counterparty?.displayName ?? '';
  const heading = useRef<HTMLHeadingElement>(null);
  // The compose view this replaced held the focus; the review starts at its own heading.
  useEffect(() => heading.current?.focus(), []);
  const given = cardCount(state.give);
  const consequences: ReactNode[] = [];
  if (given > 0) {
    consequences.push(
      `Your ${given} ${given === 1 ? 'card locks' : 'cards lock'} until ${name} answers, you cancel, or the offer expires.`,
    );
  }
  if (state.get.length > 0) {
    consequences.push(
      `${name}’s cards aren’t checked now — the trade can only be accepted if ${name} has them.`,
    );
  }
  if (state.mode === 'counter') {
    consequences.push(`Your counter-offer replaces ${name}’s offer, which closes as Countered.`);
  }

  return (
    <div className="flex flex-col gap-5">
      <h2 ref={heading} tabIndex={-1} className="text-h3 outline-none">
        Check the offer before you send it
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <SideList
          heading={`You give ${name}`}
          give
          lines={state.give}
          coins={state.coinsGive}
          empty="Nothing — a request"
        />
        <SideList
          heading={`${name} gives you`}
          give={false}
          lines={state.get}
          coins={state.coinsGet}
          empty="Nothing in return — a gift"
        />
      </div>
      {consequences.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-small text-mut wrap-anywhere">
          {consequences.map((text, index) => (
            <li key={index}>{text}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" icon={ArrowLeft} disabled={sending} onClick={onBack}>
          Back to edit
        </Button>
        <Button icon={Send} loading={sending} onClick={onSend}>
          {state.mode === 'counter' ? 'Send counter-offer' : 'Send offer'}
        </Button>
      </div>
    </div>
  );
}
