'use client';

import {
  copyLimitKey,
  DECK_MAX_COPIES,
  DECK_RULES,
  type DeckIssue,
  type DeckValidation,
} from '@pokedrop/shared';
import { useState } from 'react';
import type { CardView } from '@/components/cards/card-data';
import { copiesAllowed } from '@/components/decks/deck-rules';
import { DeckSlot, focusDeckSlot } from '@/components/decks/deck-slot';
import { DeckValidationBanner } from '@/components/decks/deck-validation-banner';
import { type OfferSide, TradeOfferPanel } from '@/components/trades/trade-offer-panel';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Group, Row, Specimen } from './frame';

type DemoCard = CardView & { supertype: string; subtypes: string[] };

const card = (
  id: string,
  name: string,
  rarity: string,
  types: string[],
  supertype = 'Pokémon',
  subtypes = ['Stage 2'],
  priceUsd: number | null = null,
): DemoCard => {
  const [set, number] = id.split('-');
  return {
    id,
    name,
    image: `https://images.pokemontcg.io/${set}/${number}.png`,
    rarity,
    types,
    hp: supertype === 'Pokémon' ? 120 : null,
    priceUsd,
    supertype,
    subtypes,
  };
};

const CHARIZARD = card(
  'base1-4',
  'Charizard',
  'Rare Holo',
  ['Fire'],
  'Pokémon',
  ['Stage 2'],
  312.5,
);
const CHARIZARD_2 = card(
  'base4-4',
  'Charizard',
  'Rare Holo',
  ['Fire'],
  'Pokémon',
  ['Stage 2'],
  180,
);
const FIRE = card('base1-98', 'Fire Energy', 'Common', [], 'Energy', ['Basic'], 0.4);
const MEWTWO = card('base1-10', 'Mewtwo', 'Rare Holo', ['Psychic'], 'Pokémon', ['Basic'], 24);

// The gallery has no deck to send to the API, so it applies the two rules a list of counts
// can show: size and copies. The page asks the API (POST /decks/:id/validate).
function localValidation(deck: { card: DemoCard; count: number }[]): DeckValidation {
  const actual = deck.reduce((n, e) => n + e.count, 0);
  const issues: DeckIssue[] = [];
  if (actual !== 60) {
    issues.push({
      severity: 'error',
      rule: 'DECK_SIZE',
      code: 'DECK_SIZE_MISMATCH',
      cardIds: [],
      params: { expected: 60, actual },
      message: `The deck has ${actual} cards; it needs exactly 60`,
    });
  }
  const groups = new Map<string, { card: DemoCard; count: number }[]>();
  for (const entry of deck) {
    const key = copyLimitKey(entry.card);
    if (key) groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  for (const entries of groups.values()) {
    const total = entries.reduce((n, e) => n + e.count, 0);
    if (total > DECK_MAX_COPIES) {
      issues.push({
        severity: 'error',
        rule: 'COPY_LIMIT',
        code: 'COPY_LIMIT_EXCEEDED',
        cardIds: entries.map((e) => e.card.id as DeckIssue['cardIds'][number]),
        params: { count: total },
        message: `${entries[0]?.card.name} has ${total} copies; at most ${DECK_MAX_COPIES} are allowed`,
      });
    }
  }
  return {
    valid: issues.length === 0,
    format: 'unlimited',
    ownedOnly: false,
    deckSize: { expected: 60, actual },
    rules: DECK_RULES.map((rule) => {
      const errors = issues.filter((i) => i.rule === rule).length;
      return { rule, ok: errors === 0, errors, warnings: 0 };
    }),
    issues,
  };
}

export function DomainSection() {
  const [deck, setDeck] = useState([
    { card: CHARIZARD, count: 3 },
    { card: CHARIZARD_2, count: 2 },
    { card: FIRE, count: 10 },
    { card: MEWTWO, count: 2, locked: true },
  ]);
  const [give, setGive] = useState<OfferSide>({
    label: 'You give',
    cards: [{ card: CHARIZARD, count: 1 }],
    coins: 50,
  });
  const [get, setGet] = useState<OfferSide>({
    label: 'MistyW gives',
    cards: [{ card: MEWTWO, count: 2 }],
    coins: 0,
  });
  const [grant, setGrant] = useState(0);

  const setCount = (id: string, count: number) =>
    setDeck((d) => d.flatMap((e) => (e.card.id !== id ? [e] : count > 0 ? [{ ...e, count }] : [])));
  const validation = localValidation(deck);
  const names = Object.fromEntries(deck.map((e) => [e.card.id, e.card.name]));

  return (
    <Group id="domain" title="TCG domain">
      <Specimen name="DeckSlot · CopyCountStepper · DeckValidationBanner">
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="flex flex-col gap-2">
            {deck.map((entry) => (
              <DeckSlot
                key={entry.card.id}
                card={entry.card}
                count={entry.count}
                max={copiesAllowed(entry.card, deck)}
                locked={'locked' in entry && entry.locked}
                onChange={(n) => setCount(entry.card.id, n)}
              />
            ))}
            <Row label="Drag feedback (the drag itself is PD-112's)">
              <DeckSlot
                card={MEWTWO}
                count={1}
                max={4}
                onChange={() => {}}
                dragging
                className="w-72"
              />
              <DeckSlot
                card={FIRE}
                count={4}
                max={Infinity}
                onChange={() => {}}
                dropTarget
                className="w-72"
              />
            </Row>
          </div>
          <DeckValidationBanner
            validation={validation}
            cardNames={names}
            onSelectCard={(id) => focusDeckSlot(id)}
          />
        </div>
      </Specimen>

      <Specimen name="TradeOfferPanel (editable; balance 1,250 coins)">
        <TradeOfferPanel
          give={give}
          get={get}
          editable
          balance={1250}
          onAddCard={(side) =>
            (side === 'give' ? setGive : setGet)((s) => ({
              ...s,
              cards: s.cards.some((l) => l.card.id === FIRE.id)
                ? s.cards
                : [...s.cards, { card: FIRE, count: 1 }],
            }))
          }
          onRemoveCard={(side, id) =>
            (side === 'give' ? setGive : setGet)((s) => ({
              ...s,
              cards: s.cards.filter((l) => l.card.id !== id),
            }))
          }
          onCoinsChange={(side, coins) =>
            (side === 'give' ? setGive : setGet)((s) => ({ ...s, coins }))
          }
        />
      </Specimen>

      <Specimen name="TradeOfferPanel (read-only, a card in escrow)">
        <TradeOfferPanel
          give={{
            label: 'MistyW gives',
            cards: [{ card: CHARIZARD_2, count: 1, locked: true }],
            coins: 120,
          }}
          get={{ label: 'You give', cards: [{ card: MEWTWO, count: 2 }], coins: 0 }}
        />
      </Specimen>

      <Specimen name="CurrencyInput (admin grant: negative takes coins back)">
        <CurrencyInput
          label="Grant coins"
          value={grant}
          min={-1_000_000}
          max={1_000_000}
          help="A negative amount takes coins back."
          onChange={setGrant}
          className="max-w-xs"
        />
      </Specimen>
    </Group>
  );
}
