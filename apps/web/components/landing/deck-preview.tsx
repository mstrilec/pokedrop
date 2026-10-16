'use client';

import type { DeckValidation } from '@pokedrop/shared';
import { Copy, Layers, RectangleVertical, Scale } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { DeckValidationBanner } from '@/components/decks/deck-validation-banner';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { baseSetImage } from './base-set';
import { Reveal } from './reveal';

const SIZE = 60;
const START = 52;
const HOLD = 4;

const copies = (id: string, n: number) => Array.from({ length: n }, () => id);
// A Base Set Lightning deck in slot order: 24 basic Energy, 20 Trainers, 16 Pokémon.
const SLOTS = [
  ...copies('base1-100', 24), // Lightning Energy
  ...copies('base1-91', 4), // Bill
  ...copies('base1-88', 3), // Professor Oak
  ...copies('base1-92', 3), // Energy Removal
  ...copies('base1-84', 3), // PlusPower
  ...copies('base1-95', 3), // Switch
  ...copies('base1-93', 2), // Gust of Wind
  ...copies('base1-94', 2), // Potion
  ...copies('base1-58', 4), // Pikachu
  ...copies('base1-20', 3), // Electabuzz
  ...copies('base1-53', 3), // Magnemite
  ...copies('base1-14', 2), // Raichu
  ...copies('base1-9', 2), // Magneton
  ...copies('base1-16', 2), // Zapdos
];
// The cards that drop in, one per step from 52 to 60.
const DROPS = SLOTS.slice(START);
const LEGEND = [
  { id: 'base1-58', label: 'Pokémon', count: (n: number) => Math.min(Math.max(n - 44, 0), 16) },
  { id: 'base1-91', label: 'Trainer', count: (n: number) => Math.min(Math.max(n - 24, 0), 20) },
  { id: 'base1-100', label: 'Energy', count: (n: number) => Math.min(n, 24) },
];

const RULES = [
  { icon: RectangleVertical, title: 'Exactly 60 cards', detail: null },
  { icon: Copy, title: 'At most 4 copies', detail: 'of a card, basic energy excepted' },
  { icon: Scale, title: 'Format legality', detail: 'for Standard, Expanded or Unlimited' },
];

// What the deck builder's validator answers for this deck at `n` cards; the
// banner below is the builder's own.
function validation(n: number): DeckValidation {
  const ok = n === SIZE;
  return {
    valid: ok,
    format: 'unlimited',
    ownedOnly: true,
    deckSize: { expected: SIZE, actual: n },
    rules: [
      { rule: 'DECK_SIZE', ok, errors: ok ? 0 : 1, warnings: 0 },
      { rule: 'COPY_LIMIT', ok: true, errors: 0, warnings: 0 },
      { rule: 'FORMAT_LEGALITY', ok: true, errors: 0, warnings: 0 },
      { rule: 'OWNERSHIP', ok: true, errors: 0, warnings: 0 },
    ],
    issues: ok
      ? []
      : [
          {
            severity: 'error',
            rule: 'DECK_SIZE',
            code: 'DECK_SIZE_MISMATCH',
            cardIds: [],
            params: { expected: SIZE, actual: n },
            message: `The deck has ${n} cards; it needs exactly ${SIZE}`,
          },
        ],
  };
}

const noop = () => {};

export function DeckPreview() {
  const ref = useRef<HTMLDivElement>(null);
  // Steps 0–8 add a card each; the rest hold the full deck before starting over.
  const [step, setStep] = useState(DROPS.length + HOLD);
  const n = START + Math.min(step, DROPS.length);

  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let timer = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        window.clearInterval(timer);
        if (!entry?.isIntersecting) return;
        timer = window.setInterval(() => setStep((s) => (s + 1) % (DROPS.length + HOLD + 1)), 650);
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  const drop = step >= 1 && step <= DROPS.length ? DROPS[step - 1] : null;

  return (
    <section
      id="deck-builder"
      aria-labelledby="deck-title"
      className="scroll-mt-20 border-y border-bd bg-[radial-gradient(800px_500px_at_20%_50%,color-mix(in_srgb,var(--e-grass)_10%,transparent),transparent_70%)]"
    >
      <div className="mx-auto grid max-w-300 grid-cols-[repeat(auto-fit,minmax(min(100%,23.75rem),1fr))] items-center gap-8 px-5 py-14 sm:px-14 sm:py-20 lg:gap-16 lg:py-28">
        <Reveal className="flex flex-col gap-3">
          <p className="inline-flex items-center gap-2 text-caption text-energy-grass uppercase">
            <Layers aria-hidden className="size-4" />
            Deck builder
          </p>
          <h2
            id="deck-title"
            className="text-[clamp(1.75rem,3.4vw,2.5rem)] leading-[1.1] font-bold tracking-[-0.02em] text-balance"
          >
            Build decks that are legal to play
          </h2>
          <p className="text-[1rem] leading-relaxed text-pretty text-mut">
            The builder checks every rule as you add cards, so you know a deck is ready before you
            share it.
          </p>
          <ul className="mt-3 flex flex-col gap-2.5">
            {RULES.map((rule) => (
              <li key={rule.title} className="flex items-center gap-3 text-[0.9375rem]">
                <span className="flex size-8 flex-none items-center justify-center rounded-control bg-energy-grass/14 text-energy-grass">
                  <rule.icon aria-hidden className="size-4" />
                </span>
                <span>
                  <b className="font-semibold">{rule.title}</b>
                  {rule.detail ? <span className="text-mut"> {rule.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal className="flex flex-col gap-4">
          <div
            ref={ref}
            aria-hidden
            className="overflow-hidden rounded-card border border-bd bg-surface shadow-lg"
          >
            <div className="flex items-center justify-between gap-3 border-b border-bd px-4 py-3.5">
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="text-body font-semibold whitespace-nowrap">Lightning Rush</span>
                <Badge label="Unlimited" tone="neutral" />
              </span>
              <span className={cn('font-mono text-body', n === SIZE ? 'text-grn' : 'text-tx')}>
                {n} / {SIZE}
              </span>
            </div>
            <div className="relative p-4">
              {drop ? (
                <Image
                  key={step}
                  src={baseSetImage(drop)}
                  alt=""
                  width={64}
                  height={90}
                  sizes="64px"
                  className="pointer-events-none absolute -top-1.5 left-1/2 z-10 -ml-8 h-22.5 w-16 animate-deck-drop rounded-sm shadow-md"
                />
              ) : null}
              <div className="grid grid-cols-10 gap-1 sm:grid-cols-15">
                {SLOTS.map((id, i) => (
                  <span
                    key={i}
                    className={cn(
                      'relative aspect-[63/88] overflow-hidden rounded-[3px] border transition-[scale,opacity] duration-300 ease-reveal',
                      i < n ? 'border-transparent' : 'scale-86 border-bd bg-surface-2',
                    )}
                  >
                    {i < n ? <Image src={baseSetImage(id)} alt="" fill sizes="44px" /> : null}
                  </span>
                ))}
              </div>
              <div className="mt-3.5 flex flex-wrap gap-x-4 gap-y-3 text-caption font-normal tracking-normal text-mut normal-case">
                {LEGEND.map((kind) => (
                  <span key={kind.label} className="inline-flex items-center gap-1.5">
                    <Image
                      src={baseSetImage(kind.id)}
                      alt=""
                      width={12}
                      height={17}
                      sizes="12px"
                      className="h-4.25 w-3 rounded-xs"
                    />
                    {kind.label} {kind.count(n)}
                  </span>
                ))}
              </div>
            </div>
          </div>
          {/* inert: the banner's live badge would otherwise announce every step of the loop. */}
          <div inert>
            <DeckValidationBanner validation={validation(n)} cardNames={{}} onSelectCard={noop} />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
