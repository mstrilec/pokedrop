import {
  DECK_MAX_COPIES,
  DECK_RULES,
  DeckValidationSchema,
  type DeckIssueCode,
  type DeckRule,
  type DeckValidation,
  type Legalities,
} from '@pokedrop/shared';

export type ValidationCard = {
  cardId: string;
  count: number;
  name: string;
  supertype: string;
  subtypes: string[];
  legalities: Legalities;
};

export type ValidationInput = {
  format: string;
  ownedOnly: boolean;
  deckSize: number;
  cards: ValidationCard[];
  available: ReadonlyMap<string, number>;
};

type Issue = {
  severity: 'error' | 'warning';
  rule: DeckRule;
  code: DeckIssueCode;
  cardIds: string[];
  params: Record<string, string | number>;
  message: string;
};

export function validateDeck(input: ValidationInput): DeckValidation {
  const cards = [...input.cards].sort((a, b) => compare(a.cardId, b.cardId));
  const actual = cards.reduce((sum, card) => sum + card.count, 0);

  const issues = [
    ...deckSize(input.deckSize, actual),
    ...copyLimit(cards),
    ...formatLegality(cards, input.format),
    ...ownership(cards, input.available, input.ownedOnly),
  ].sort(
    (a, b) =>
      DECK_RULES.indexOf(a.rule) - DECK_RULES.indexOf(b.rule) ||
      compare(a.cardIds[0] ?? '', b.cardIds[0] ?? '') ||
      compare(a.code, b.code),
  );

  return DeckValidationSchema.parse({
    valid: issues.every((issue) => issue.severity !== 'error'),
    format: input.format,
    ownedOnly: input.ownedOnly,
    deckSize: { expected: input.deckSize, actual },
    rules: DECK_RULES.map((rule) => {
      const own = issues.filter((issue) => issue.rule === rule);
      const errors = own.filter((issue) => issue.severity === 'error').length;
      return { rule, ok: errors === 0, errors, warnings: own.length - errors };
    }),
    issues,
  });
}

function deckSize(expected: number, actual: number): Issue[] {
  if (actual === expected) {
    return [];
  }
  return [
    {
      severity: 'error',
      rule: 'DECK_SIZE',
      code: 'DECK_SIZE_MISMATCH',
      cardIds: [],
      params: { expected, actual },
      message: `The deck has ${actual} cards; it needs exactly ${expected}`,
    },
  ];
}

// Basic energy leaves before grouping: "Metal Energy" names both a basic and a
// special card, and only the special one is limited.
function copyLimit(cards: ValidationCard[]): Issue[] {
  const byName = new Map<string, ValidationCard[]>();
  for (const card of cards) {
    if (isBasicEnergy(card)) {
      continue;
    }
    byName.set(card.name, [...(byName.get(card.name) ?? []), card]);
  }

  const issues: Issue[] = [];
  for (const [name, printings] of byName) {
    const count = printings.reduce((sum, card) => sum + card.count, 0);
    if (count > DECK_MAX_COPIES) {
      issues.push({
        severity: 'error',
        rule: 'COPY_LIMIT',
        code: 'COPY_LIMIT_EXCEEDED',
        cardIds: printings.map((card) => card.cardId),
        params: { name, count, max: DECK_MAX_COPIES },
        message: `${name} has ${count} copies; at most ${DECK_MAX_COPIES} are allowed`,
      });
    }
  }
  return issues;
}

function formatLegality(cards: ValidationCard[], format: string): Issue[] {
  const issues: Issue[] = [];
  for (const card of cards) {
    const status = Object.hasOwn(card.legalities, format) ? card.legalities[format] : undefined;
    const about = { rule: 'FORMAT_LEGALITY' as const, cardIds: [card.cardId] };

    if (status === undefined) {
      issues.push({
        ...about,
        severity: 'warning',
        code: 'CARD_LEGALITY_UNKNOWN',
        params: { name: card.name, format },
        message: `${label(card)} has no legality recorded for ${format}`,
      });
    } else if (status === 'Banned') {
      issues.push({
        ...about,
        severity: 'error',
        code: 'CARD_BANNED',
        params: { name: card.name, format },
        message: `${label(card)} is banned in ${format}`,
      });
    } else if (status !== 'Legal') {
      issues.push({
        ...about,
        severity: 'error',
        code: 'CARD_NOT_LEGAL',
        params: { name: card.name, format, status },
        message: `${label(card)} is not legal in ${format} (${status})`,
      });
    }
  }
  return issues;
}

function ownership(
  cards: ValidationCard[],
  available: ReadonlyMap<string, number>,
  ownedOnly: boolean,
): Issue[] {
  const issues: Issue[] = [];
  for (const card of cards) {
    const have = available.get(card.cardId) ?? 0;
    if (card.count > have) {
      issues.push({
        severity: ownedOnly ? 'error' : 'warning',
        rule: 'OWNERSHIP',
        code: 'CARD_NOT_OWNED',
        cardIds: [card.cardId],
        params: { name: card.name, needed: card.count, available: have },
        message: `${label(card)} needs ${card.count} copies; ${have} available`,
      });
    }
  }
  return issues;
}

function isBasicEnergy(card: ValidationCard): boolean {
  return card.supertype === 'Energy' && card.subtypes.includes('Basic');
}

function label(card: ValidationCard): string {
  return `${card.name} (${card.cardId})`;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
