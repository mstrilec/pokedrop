import { copyLimitKey, DECK_MAX_COPIES } from '@pokedrop/shared';

type RuleCard = { id: string; name: string; supertype: string; subtypes: readonly string[] };

/**
 * How many copies of `card` the deck may hold, counting every other printing of its name;
 * Infinity for basic energy. The same key the API's validator uses, from @pokedrop/shared.
 */
export function copiesAllowed(card: RuleCard, deck: { card: RuleCard; count: number }[]): number {
  const key = copyLimitKey(card);
  if (key === null) return Number.POSITIVE_INFINITY;
  const others = deck
    .filter((entry) => entry.card.id !== card.id && copyLimitKey(entry.card) === key)
    .reduce((sum, entry) => sum + entry.count, 0);
  return Math.max(0, DECK_MAX_COPIES - others);
}
