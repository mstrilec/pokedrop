import type { TradeDetail } from '@pokedrop/shared';
import {
  Ban,
  CheckCheck,
  Clock,
  type LucideIcon,
  Repeat,
  Send,
  ShieldAlert,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { dateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export type TimelineStep = {
  label: string;
  /** Already formatted, or omitted for a step that has not happened. */
  time?: string;
  state: 'done' | 'active' | 'pending';
  icon?: LucideIcon;
  /** Another trade of the same negotiation, opened from this step. */
  link?: { href: string; label: string };
};

const STATE = {
  done: { spoken: 'Done', dot: 'border-grn bg-grn/15 text-grn', text: 'text-tx' },
  active: { spoken: 'Current step', dot: 'border-gold bg-gold-dim text-gold', text: 'text-tx' },
  pending: { spoken: 'Not yet', dot: 'border-bd-2 bg-bg text-faint', text: 'text-mut' },
} as const;

/** The trade's lifecycle as an ordered list; each step says its state in words. */
export function TradeStatusTimeline({
  steps,
  label = 'Trade status',
  className,
}: {
  steps: TimelineStep[];
  label?: string;
  className?: string;
}) {
  return (
    <ol aria-label={label} className={cn('flex flex-col', className)}>
      {steps.map((step, index) => {
        const s = STATE[step.state];
        const Icon = step.icon ?? Clock;
        const last = index === steps.length - 1;
        return (
          <li
            key={`${index}-${step.label}`}
            aria-current={step.state === 'active' ? 'step' : undefined}
            className="flex gap-3"
          >
            <div aria-hidden className="flex flex-col items-center">
              <span
                className={cn(
                  'flex size-6.5 shrink-0 items-center justify-center rounded-pill border-2',
                  s.dot,
                )}
              >
                <Icon className="size-3.25" />
              </span>
              {last ? null : <span className="my-0.5 min-h-5.5 w-0.5 flex-1 bg-bd" />}
            </div>
            <div className={cn('flex min-w-0 flex-col wrap-anywhere', last ? 'pb-0' : 'pb-3.5')}>
              <span className={cn('text-small font-medium', s.text)}>
                <span className="sr-only">{s.spoken}: </span>
                {step.label}
              </span>
              <span className="font-mono text-[11.5px] text-faint">{step.time ?? '—'}</span>
              {step.link ? (
                <Link
                  href={step.link.href}
                  className="focus-ring mt-1 self-start rounded-tag text-small text-pri hover:underline"
                >
                  {step.link.label}
                </Link>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const ACTIONS: Record<string, { verb: string; icon: LucideIcon }> = {
  'trade.propose': { verb: 'Proposed', icon: Send },
  'trade.counter': { verb: 'Countered', icon: Repeat },
  'trade.accept': { verb: 'Accepted and settled', icon: CheckCheck },
  'trade.decline': { verb: 'Declined', icon: X },
  'trade.cancel': { verb: 'Cancelled', icon: Ban },
  'trade.void': { verb: 'Voided by an admin', icon: ShieldAlert },
  'trade.expire': { verb: 'Expired unanswered', icon: Clock },
};

/** Steps for a trade's detail page: what happened, then, while it is open, what is left. */
export function tradeTimelineSteps(trade: TradeDetail): TimelineStep[] {
  const name = (side: 'initiator' | 'recipient') =>
    trade.role === side ? 'you' : trade[side].displayName;
  const here = trade.chain.findIndex((entry) => entry.id === trade.id);
  const counteredBy = here >= 0 ? trade.chain[here + 1] : undefined;

  const steps: TimelineStep[] = trade.timeline.map((entry) => {
    const action = ACTIONS[entry.action] ?? { verb: entry.action, icon: Clock };
    const by = entry.by === 'initiator' || entry.by === 'recipient' ? ` by ${name(entry.by)}` : '';
    const step: TimelineStep = {
      label: `${action.verb}${action.verb.includes('admin') || entry.by === 'system' ? '' : by}`,
      time: dateTime(entry.at),
      state: 'done',
      icon: action.icon,
    };
    if (entry.action === 'trade.propose' && trade.counteredTradeId !== null) {
      step.label = `${step.label}, as a counter-offer`;
      step.link = {
        href: `/trades/${trade.counteredTradeId}`,
        label: 'Open the offer it answered',
      };
    }
    if (entry.action === 'trade.counter' && counteredBy) {
      step.link = { href: `/trades/${counteredBy.id}`, label: 'Open the counter-offer' };
    }
    return step;
  });

  // Trades older than the trade core have no audit rows: what the trade itself records.
  if (steps.length === 0) {
    steps.push({
      label: `Proposed by ${name('initiator')}`,
      time: dateTime(trade.createdAt),
      state: 'done',
      icon: Send,
    });
    if (trade.status !== 'PENDING') {
      steps.push({
        label: `Closed as ${trade.status.toLowerCase()}`,
        time: trade.resolvedAt ? dateTime(trade.resolvedAt) : undefined,
        state: 'done',
        icon: CheckCheck,
      });
    }
  }

  if (trade.status === 'PENDING') {
    const waitingOn = trade.role === 'recipient' ? 'your' : `${trade.recipient.displayName}'s`;
    steps.push(
      { label: `Awaiting ${waitingOn} response`, state: 'active', icon: Clock },
      { label: 'Cards swap and the trade settles', state: 'pending', icon: CheckCheck },
    );
  }
  return steps;
}
