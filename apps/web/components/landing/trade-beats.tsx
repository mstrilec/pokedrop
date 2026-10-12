import type { TradeStatus } from '@pokedrop/shared';
import {
  ArrowLeftRight,
  ArrowRightLeft,
  Check,
  Coins,
  Lock,
  type LucideIcon,
  MessageSquareReply,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { TRADE_STATUS_STYLES } from '@/lib/design/status';
import { cn } from '@/lib/utils';
import { Reveal } from './reveal';
import { SectionHeading } from './section-heading';

const BEATS: { icon: LucideIcon; title: string; body: string; delay: string }[] = [
  {
    icon: Lock,
    title: 'Your cards lock',
    body: 'The cards you offer are held while the offer is open, so they can’t be promised twice. Coins are checked when you offer and again when the swap settles.',
    delay: '',
  },
  {
    icon: MessageSquareReply,
    title: 'The other side answers',
    body: 'They accept, decline or counter. A counter replaces your offer: your cards unlock and theirs lock instead. An offer left unanswered expires after 7 days.',
    delay: '[animation-delay:1.8s]',
  },
  {
    icon: ArrowLeftRight,
    title: 'One atomic swap',
    body: 'On accept, both sides move in a single transaction. Either everything changes hands, or nothing does.',
    delay: '[animation-delay:3.6s]',
  },
];

const BLASTOISE = { src: 'https://images.pokemontcg.io/base1/2.png', alt: 'Blastoise' };
const VENUSAUR = { src: 'https://images.pokemontcg.io/base1/15.png', alt: 'Venusaur' };

function Thumb({ card }: { card: { src: string; alt: string } }) {
  return (
    <Image
      src={card.src}
      alt={card.alt}
      width={40}
      height={56}
      sizes="40px"
      className="h-14 w-10 rounded-sm"
    />
  );
}

const CHAIN: { title: string; status: TradeStatus; cards: ReactNode; body: string }[] = [
  {
    title: 'You offer',
    status: 'PENDING',
    cards: (
      <>
        <Thumb card={BLASTOISE} />
        <ArrowRightLeft aria-hidden className="size-3.5 text-mut" />
        <span className="sr-only">for</span>
        <Thumb card={VENUSAUR} />
      </>
    ),
    body: 'Blastoise for their Venusaur. Your Blastoise locks.',
  },
  {
    title: 'They counter',
    status: 'COUNTERED',
    cards: (
      <>
        <Thumb card={BLASTOISE} />
        <span className="inline-flex items-center gap-1 text-gold">
          <Plus aria-hidden className="size-3" />
          <Coins aria-hidden className="size-3.5" />
          <span className="sr-only">plus coins</span>
        </span>
        <ArrowRightLeft aria-hidden className="size-3.5 text-mut" />
        <span className="sr-only">for</span>
        <Thumb card={VENUSAUR} />
      </>
    ),
    body: 'They ask for coins on top. Your offer closes, your Blastoise unlocks and their Venusaur locks.',
  },
  {
    title: 'You accept',
    status: 'ACCEPTED',
    cards: (
      <>
        <Thumb card={VENUSAUR} />
        <Check aria-hidden className="size-3.5 text-grn" />
      </>
    ),
    body: 'One swap. Cards and coins move together, or nothing moves.',
  },
];

export function TradeBeats() {
  return (
    <section
      id="trading"
      aria-labelledby="trade-title"
      className="mx-auto max-w-300 scroll-mt-20 px-5 py-14 sm:py-20 lg:py-28 sm:px-14"
    >
      <SectionHeading
        id="trade-title"
        eyebrow="Safe trading"
        icon={ShieldCheck}
        tone="text-energy-water"
        title="Your cards stay yours"
        lead="Trades lock first, then swap in one step."
        className="mb-10"
      />
      <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16.25rem),1fr))] gap-4">
        {BEATS.map((beat, i) => (
          <Reveal
            as="li"
            key={beat.title}
            className={cn(
              'flex animate-beat flex-col gap-3 rounded-card border border-bd bg-surface p-5',
              'motion-reduce:animate-none motion-reduce:border-energy-water/55',
              beat.delay,
            )}
          >
            <div className="flex items-center justify-between">
              <span className="flex size-11 items-center justify-center rounded-control bg-energy-water/14 text-energy-water">
                <beat.icon aria-hidden className="size-5" />
              </span>
              <span className="font-mono text-caption text-faint">0{i + 1}</span>
            </div>
            <h3 className="text-h3">{beat.title}</h3>
            <p className="text-body leading-relaxed text-pretty text-mut">{beat.body}</p>
          </Reveal>
        ))}
      </ol>

      <Reveal className="mt-6 rounded-card border border-bd bg-surface p-5">
        <h3 className="mb-4 text-h3">A counter-offer, start to finish</h3>
        <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-3">
          {CHAIN.map((step) => {
            const status = TRADE_STATUS_STYLES[step.status];
            return (
              <li
                key={step.title}
                className="flex flex-col gap-2.5 rounded-control bg-surface-2 p-3.5"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-small font-semibold text-tx">{step.title}</span>
                  <Badge label={status.label} tone={status.tone} />
                </span>
                <span className="flex items-center gap-2">{step.cards}</span>
                <span className="text-small leading-normal text-mut">{step.body}</span>
              </li>
            );
          })}
        </ol>
      </Reveal>
    </section>
  );
}
