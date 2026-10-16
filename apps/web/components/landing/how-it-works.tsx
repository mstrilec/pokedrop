import { Lock, Route } from 'lucide-react';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { BoosterPack } from '@/components/packs/booster-pack';
import { cn } from '@/lib/utils';
import { BASE_SET_ART, BASE_SET_PACK, baseSetImage } from './base-set';
import { Reveal } from './reveal';
import { SectionHeading } from './section-heading';

type Step = {
  title: string;
  body: string;
  tone: string;
  glow: string;
  art: ReactNode;
  link?: { href: string; label: string };
};

// The stack darkens toward the bottom: gold mixed with the page background.
const coins = [
  'bg-[color-mix(in_srgb,var(--gold)_70%,var(--bg))]',
  'bg-[color-mix(in_srgb,var(--gold)_80%,var(--bg))]',
  'bg-[color-mix(in_srgb,var(--gold)_90%,var(--bg))]',
];

function CardImage({ id, className }: { id: string; className?: string }) {
  return (
    <Image
      src={baseSetImage(id)}
      alt=""
      width={68}
      height={95}
      sizes="68px"
      className={cn('rounded-[5px] shadow-md', className)}
    />
  );
}

const STEPS: Step[] = [
  {
    title: 'Get 1,000 coins',
    body: 'Every new account starts with 1,000 coins. They open packs and sweeten trades, and they can’t be bought or cashed out.',
    tone: 'text-gold',
    glow: 'var(--gold)',
    art: (
      <div className="relative h-13 w-14 self-end">
        {coins.map((shade, i) => (
          <span
            key={shade}
            style={{ bottom: i * 10 }}
            className={cn('absolute left-0 h-3.5 w-14 rounded-pill border-2 border-gold', shade)}
          />
        ))}
        <span className="absolute bottom-7.5 left-0 h-3.5 w-14 animate-coin-drop rounded-pill border-2 border-gold bg-gold" />
      </div>
    ),
  },
  {
    title: 'Open packs',
    body: 'Pick a booster and rip it open. The cards are yours the moment it opens.',
    tone: 'text-energy-fire',
    glow: 'var(--e-fire)',
    art: (
      <div className="animate-wiggle">
        <BoosterPack art={BASE_SET_ART} name={BASE_SET_PACK} size="sm" />
      </div>
    ),
    link: { href: '#pack-opening', label: 'See a pack open' },
  },
  {
    title: 'Build decks',
    body: 'Turn your pulls into a 60-card deck, or let the builder deal you a random legal one.',
    tone: 'text-energy-grass',
    glow: 'var(--e-grass)',
    art: (
      <div className="relative h-23.75 w-17">
        {[
          { id: 'base1-58', place: '-translate-x-6 -rotate-8', delay: '' },
          { id: 'base1-14', place: '', delay: '[animation-delay:0.4s]' },
          { id: 'base1-16', place: 'translate-x-6 rotate-8', delay: '[animation-delay:0.8s]' },
        ].map((card) => (
          <CardImage
            key={card.id}
            id={card.id}
            className={cn('absolute inset-0 animate-stack-in', card.place, card.delay)}
          />
        ))}
      </div>
    ),
    link: { href: '#deck-builder', label: 'See the builder' },
  },
  {
    title: 'Trade',
    body: 'Swap cards and coins with any collector.',
    tone: 'text-energy-water',
    glow: 'var(--e-water)',
    art: (
      <div className="relative flex h-full w-full items-center justify-center gap-1">
        <CardImage id="base1-2" className="h-20 w-14.25 animate-swap-l" />
        <CardImage id="base1-15" className="h-20 w-14.25 animate-swap-r" />
        <span className="absolute bottom-1 left-1/2 flex size-6 -translate-x-1/2 items-center justify-center rounded-pill bg-surface-2 text-energy-water">
          <Lock className="size-3.5" />
        </span>
      </div>
    ),
    link: { href: '#trading', label: 'How trades stay safe' },
  },
];

export function HowItWorks() {
  return (
    <section
      aria-labelledby="how-title"
      className="mx-auto max-w-300 px-5 py-14 sm:py-20 lg:py-28 sm:px-14"
    >
      <SectionHeading
        id="how-title"
        eyebrow="How it works"
        icon={Route}
        tone="text-pri"
        title="From your first coin to your first trade"
        className="mb-10"
      />
      <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-4">
        {STEPS.map((step, i) => (
          <Reveal
            as="li"
            key={step.title}
            className="flex flex-col gap-3 overflow-hidden rounded-card border border-bd bg-surface p-5"
          >
            <div
              aria-hidden
              style={{
                backgroundImage: `radial-gradient(120px 80px at 50% 65%, color-mix(in srgb, ${step.glow} 28%, transparent), transparent 70%)`,
              }}
              className="flex h-36 items-center justify-center overflow-hidden rounded-control bg-surface-2 pb-2"
            >
              {step.art}
            </div>
            <p className={cn('font-mono text-caption', step.tone)}>0{i + 1}</p>
            <h3 className="text-h3">{step.title}</h3>
            <p className="text-body leading-relaxed text-pretty text-mut">{step.body}</p>
            {step.link ? (
              <a
                href={step.link.href}
                className="focus-ring mt-auto w-max rounded-control text-small font-semibold text-pri hover:text-pri-hover"
              >
                {step.link.label}
              </a>
            ) : null}
          </Reveal>
        ))}
      </ol>
    </section>
  );
}
