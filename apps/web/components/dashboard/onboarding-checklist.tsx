'use client';

import type { OnboardingProgress } from '@pokedrop/shared';
import { ArrowRight, Check, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Step = {
  key: keyof OnboardingProgress;
  label: string;
  /** What the first open step's button says. */
  action: string;
  href: string;
};

// In the order a new collector meets them; each is ticked by what the API finds.
const STEPS: Step[] = [
  {
    key: 'emailVerified',
    label: 'Verify your email',
    action: 'Verify your email',
    href: '/verify-email',
  },
  {
    key: 'openedPack',
    label: 'Open your first pack',
    action: 'Open your first pack',
    href: '/packs',
  },
  { key: 'builtDeck', label: 'Build a full deck', action: 'Build a deck', href: '/decks' },
  { key: 'madeTrade', label: 'Complete a trade', action: 'Propose a trade', href: '/trades/new' },
];

/** `1 of 4`, the steps as chips, and the next one as the button; gone once all are done. */
export function OnboardingChecklist({ progress }: { progress: OnboardingProgress }) {
  const done = STEPS.filter((step) => progress[step.key]).length;
  const next = STEPS.find((step) => !progress[step.key]);
  if (!next) return null;

  return (
    <section
      aria-labelledby="checklist-heading"
      className="flex flex-col gap-4 rounded-card border border-pri/30 bg-pri-dim p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="checklist-heading" className="flex items-center gap-2 text-h3">
            <Sparkles aria-hidden className="size-5 text-pri" />
            Get started · {done} of {STEPS.length}
          </h2>
          <p className="text-small text-mut">
            Each step ticks itself off when you’ve done it — nothing to mark by hand.
          </p>
        </div>
        <Button asChild icon={ArrowRight}>
          <Link href={next.href}>{next.action}</Link>
        </Button>
      </div>
      <div
        role="progressbar"
        aria-label="Steps done"
        aria-valuemin={0}
        aria-valuemax={STEPS.length}
        aria-valuenow={done}
        className="h-1.5 overflow-hidden rounded-pill bg-surface-2"
      >
        <div
          className="h-full rounded-pill bg-pri"
          style={{ width: `${(done / STEPS.length) * 100}%` }}
        />
      </div>
      <ol className="flex flex-wrap gap-2">
        {STEPS.map((step) => {
          const complete = progress[step.key];
          return (
            <li key={step.key}>
              {complete ? (
                <span className="flex items-center gap-1.5 rounded-pill border border-grn/30 bg-grn/14 px-3 py-1 text-small text-grn">
                  <Check aria-hidden className="size-3.5" />
                  <span className="sr-only">Done: </span>
                  {step.label}
                </span>
              ) : (
                <Link
                  href={step.href}
                  className={cn(
                    'focus-ring flex items-center gap-1.5 rounded-pill border px-3 py-1 text-small transition hover:border-pri hover:text-pri',
                    step === next ? 'border-pri/50 text-tx' : 'border-bd-2 text-mut',
                  )}
                >
                  <span className="sr-only">To do: </span>
                  {step.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
