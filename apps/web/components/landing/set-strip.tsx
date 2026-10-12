import type { CardSet } from '@pokedrop/shared';
import { ArrowRight, Library } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { CompletionMeter } from '@/components/ui/completion-meter';
import type { Completion } from './landing-data';
import { Reveal } from './reveal';
import { SectionHeading } from './section-heading';
import { SetLogo } from './set-logo';

const CLASSICS = ['base1', 'base2', 'neo1', 'ex1', 'dp1', 'swsh1'];
const NEWEST = 4;
const count = new Intl.NumberFormat('en-US');

export function SetStrip({
  sets,
  completion,
}: {
  sets: CardSet[];
  completion: Map<string, Completion> | null;
}) {
  if (sets.length === 0) return null;
  const newest = [...sets]
    .sort((a, b) => b.releaseDate.getTime() - a.releaseDate.getTime())
    .slice(0, NEWEST);
  const chosen = new Set<string>(newest.map((set) => set.id));
  const classics = CLASSICS.flatMap((id) => {
    const set = sets.find((s) => s.id === id);
    return set && !chosen.has(id) ? [set] : [];
  });
  const shown = [
    ...newest.map((set) => ({ set, newest: true })),
    ...classics.map((set) => ({ set, newest: false })),
  ];

  return (
    <section
      aria-labelledby="sets-title"
      className="mx-auto max-w-300 px-5 py-14 sm:py-20 lg:py-28 sm:px-14"
    >
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <SectionHeading
          id="sets-title"
          eyebrow="Collect every set"
          icon={Library}
          tone="text-energy-grass"
          title={`${count.format(sets.length)} sets, from Base to the newest release`}
          lead={
            completion
              ? 'Your progress on the newest sets and the classics.'
              : 'Each set shows how many cards it holds. Sign in to track how many you own.'
          }
        />
        <Link
          href="/sets"
          className="focus-ring inline-flex items-center gap-2 rounded-control py-2 text-body font-semibold text-pri hover:text-pri-hover"
        >
          Browse all sets
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
      <ul className="-mx-5 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-5">
        {shown.map(({ set, newest: isNew }) => {
          const progress = completion
            ? (completion.get(set.id) ?? { owned: 0, total: set.printedTotal })
            : null;
          return (
            <Reveal as="li" key={set.id} className="w-42 flex-none snap-start sm:w-auto">
              <Link
                href={`/cards?set=${encodeURIComponent(set.id)}`}
                className="focus-ring flex h-full flex-col gap-3 rounded-card border border-bd bg-surface p-4 transition-[translate,border-color,box-shadow] duration-200 hover:-translate-y-1 hover:border-energy-grass/50 hover:shadow-md"
              >
                <span className="flex h-14 items-center justify-center rounded-control bg-surface-2 p-2">
                  <SetLogo name={set.name} logoUrl={set.logoUrl} />
                </span>
                <span className="flex flex-col items-start gap-2">
                  <span className="line-clamp-2 w-full text-body font-semibold">{set.name}</span>
                  <Badge
                    label={isNew ? 'Newest' : 'Classic'}
                    tone={isNew ? 'success' : 'neutral'}
                  />
                </span>
                {progress ? (
                  <CompletionMeter
                    label={`${set.name} completion`}
                    value={progress.owned}
                    max={progress.total}
                    showHeader={false}
                    color="var(--grn)"
                    height={6}
                    className="mt-auto"
                  />
                ) : (
                  <span className="mt-auto font-mono text-small text-mut">
                    {count.format(set.printedTotal)} cards
                  </span>
                )}
                {progress ? (
                  <span aria-hidden className="font-mono text-small text-mut">
                    <span className="text-tx">{count.format(progress.owned)}</span> /{' '}
                    {count.format(progress.total)}
                  </span>
                ) : null}
              </Link>
            </Reveal>
          );
        })}
      </ul>
    </section>
  );
}
