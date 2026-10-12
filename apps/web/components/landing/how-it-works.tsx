import { Flame, Lock, Route } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
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
      <div className="relative flex h-21 w-13 animate-wiggle items-center justify-center overflow-hidden rounded-sm bg-booster booster-crimp text-booster-ink [--energy:var(--e-fire)]">
        <span className="absolute inset-x-0 top-0 h-[6%] bg-booster-shade" />
        <span className="absolute inset-x-0 bottom-0 h-[6%] bg-booster-shade" />
        <Flame className="size-5.5" />
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
      <div className="relative h-16 w-11.5">
        {[
          { energy: '[--energy:var(--e-grass)]', place: '-translate-x-3.5 -rotate-8', delay: '' },
          { energy: '[--energy:var(--e-water)]', place: '', delay: '[animation-delay:0.4s]' },
          {
            energy: '[--energy:var(--e-fire)]',
            place: 'translate-x-3.5 rotate-8',
            delay: '[animation-delay:0.8s]',
          },
        ].map((card) => (
          <span
            key={card.energy}
            className={cn(
              'absolute inset-0 animate-stack-in rounded-sm border border-bd-2 bg-card-face',
              card.energy,
              card.place,
              card.delay,
            )}
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
        <span className="h-14 w-10 animate-swap-l rounded-sm border border-bd-2 bg-card-face [--energy:var(--e-water)]" />
        <span className="h-14 w-10 animate-swap-r rounded-sm border border-bd-2 bg-card-face [--energy:var(--e-lightning)]" />
        <Lock className="absolute bottom-3 left-1/2 size-3.5 -translate-x-1/2 text-energy-water" />
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
              className="flex h-30 items-center justify-center overflow-hidden rounded-control bg-surface-2 pb-2"
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
