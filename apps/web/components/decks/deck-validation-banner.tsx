'use client';

import { DECK_MAX_COPIES, type DeckRule, type DeckValidation } from '@pokedrop/shared';
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { setNumber } from '../cards/card-data';

function ruleText(rule: DeckRule, v: DeckValidation): string {
  switch (rule) {
    case 'DECK_SIZE':
      return `${v.deckSize.actual} of ${v.deckSize.expected} cards`;
    case 'COPY_LIMIT':
      return `At most ${DECK_MAX_COPIES} copies of a card (basic energy excepted)`;
    case 'FORMAT_LEGALITY':
      return `Every card legal in ${v.format}`;
    case 'OWNERSHIP':
      return v.ownedOnly ? 'You own every card' : 'Cards you do not own (theorycrafting)';
  }
}

type DeckValidationBannerProps = {
  validation: DeckValidation;
  /** Names for the cards issues point at; an unknown id shows as itself. */
  cardNames: Record<string, string>;
  /** Called with the card an issue is about: scroll to it and highlight it (`focusDeckSlot`). */
  onSelectCard: (cardId: string) => void;
  className?: string;
};

export function DeckValidationBanner({
  validation,
  cardNames,
  onSelectCard,
  className,
}: DeckValidationBannerProps) {
  const failing = validation.rules.filter((r) => !r.ok);
  const summary = validation.valid
    ? 'Deck is legal'
    : `${failing.length} ${failing.length === 1 ? 'rule' : 'rules'} failing`;

  return (
    <section
      aria-label="Deck legality"
      className={cn('flex flex-col gap-3 rounded-card border border-bd bg-surface p-4', className)}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-h3">Legality</h3>
        <Badge
          live
          tone={validation.valid ? 'success' : 'warning'}
          icon={validation.valid ? CircleCheck : TriangleAlert}
          label={summary}
        />
      </div>
      <ul className="flex flex-col gap-2.5">
        {validation.rules.map((result) => {
          const issues = validation.issues.filter((issue) => issue.rule === result.rule);
          const Icon = !result.ok ? CircleX : result.warnings > 0 ? TriangleAlert : CircleCheck;
          const state = !result.ok
            ? 'Fails'
            : result.warnings > 0
              ? 'Passes with warnings'
              : 'Passes';
          return (
            <li key={result.rule} className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2 text-small">
                <Icon
                  aria-hidden
                  className={cn(
                    'size-4 shrink-0',
                    !result.ok ? 'text-red' : result.warnings > 0 ? 'text-gold' : 'text-grn',
                  )}
                />
                <span className="sr-only">{state}: </span>
                <span className={result.ok ? 'text-mut' : 'text-tx'}>
                  {ruleText(result.rule, validation)}
                </span>
              </span>
              {issues.length > 0 ? (
                <ul className="ml-6 flex flex-col gap-1">
                  {issues.map((issue, i) => (
                    <li key={`${issue.code}-${i}`} className="text-[12.5px] text-mut">
                      {issue.message}
                      {issue.cardIds.map((cardId) => (
                        <button
                          key={cardId}
                          type="button"
                          onClick={() => onSelectCard(cardId)}
                          className="focus-ring ml-2 cursor-pointer rounded-tag text-pri underline-offset-2 hover:underline"
                        >
                          Show {cardNames[cardId] ?? cardId} ({setNumber(cardId)})
                        </button>
                      ))}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
