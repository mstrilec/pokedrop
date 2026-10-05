import {
  type Card,
  type InventoryCard,
  MAX_TRADE_CURRENCY,
  MAX_TRADE_LINE_QUANTITY,
  MAX_TRADE_LINES,
  type PublicProfile,
  type TradeDetail,
  type TradeParty,
} from '@pokedrop/shared';
import { setNumber } from '@/components/cards/card-data';
import type { TradeTermsBody } from '@/lib/api/endpoints/trades';
import { formatCoins } from '@/lib/format';

export type Side = 'give' | 'get';
export type Line = { card: InventoryCard; count: number };

export type ComposerState = {
  mode: 'new' | 'counter';
  counteredId: string | null;
  counterparty: TradeParty | null;
  give: Line[];
  get: Line[];
  coinsGive: number;
  coinsGet: number;
  step: 'compose' | 'review';
};

export type ComposerAction =
  | { type: 'counterparty'; party: TradeParty | null }
  | { type: 'add'; side: Side; card: InventoryCard }
  | { type: 'count'; side: Side; cardId: string; count: number }
  | { type: 'remove'; side: Side; cardId: string }
  | { type: 'coins'; side: Side; coins: number }
  | { type: 'step'; step: ComposerState['step'] };

const EMPTY: ComposerState = {
  mode: 'new',
  counteredId: null,
  counterparty: null,
  give: [],
  get: [],
  coinsGive: 0,
  coinsGet: 0,
  step: 'compose',
};

function withLines(state: ComposerState, side: Side, lines: Line[]): ComposerState {
  return side === 'give' ? { ...state, give: lines } : { ...state, get: lines };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

export function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case 'counterparty':
      // A counter's counterparty is the offer's initiator, fixed.
      return state.mode === 'counter' ? state : { ...state, counterparty: action.party };
    case 'add': {
      const lines = state[action.side];
      const found = lines.find((line) => line.card.id === action.card.id);
      return withLines(
        state,
        action.side,
        found
          ? lines.map((line) =>
              line === found
                ? { ...line, count: Math.min(line.count + 1, MAX_TRADE_LINE_QUANTITY) }
                : line,
            )
          : [...lines, { card: action.card, count: 1 }],
      );
    }
    case 'count':
      return withLines(
        state,
        action.side,
        state[action.side].map((line) =>
          line.card.id === action.cardId
            ? { ...line, count: clamp(action.count, 1, MAX_TRADE_LINE_QUANTITY) }
            : line,
        ),
      );
    case 'remove':
      return withLines(
        state,
        action.side,
        state[action.side].filter((line) => line.card.id !== action.cardId),
      );
    case 'coins': {
      const coins = clamp(action.coins, 0, MAX_TRADE_CURRENCY);
      return action.side === 'give'
        ? { ...state, coinsGive: coins }
        : { ...state, coinsGet: coins };
    }
    case 'step':
      return { ...state, step: action.step };
  }
}

/** The catalog's full card, as the slim card a trade line carries. */
export function summaryOf(card: Card): InventoryCard {
  const { id, setId, name, supertype, subtypes, types, hp, rarity, imageSmall } = card;
  const { latestPriceUsd, latestPriceEur, priceUpdatedAt } = card;
  return {
    ...{ id, setId, name, supertype, subtypes, types, hp, rarity, imageSmall },
    ...{ latestPriceUsd, latestPriceEur, priceUpdatedAt },
  };
}

export const cardCount = (lines: Line[]) => lines.reduce((sum, line) => sum + line.count, 0);

export const lineText = (line: Line) =>
  `${line.count} × ${line.card.name} (${setNumber(line.card.id)})`;

/** Why a picker may not add one more of `card` to `side`, or null. */
export function pickRefusal(
  state: ComposerState,
  side: Side,
  card: InventoryCard,
  available: number | undefined,
  otherName: string,
): string | null {
  const lines = state[side];
  const other = side === 'give' ? state.get : state.give;
  const line = lines.find((entry) => entry.card.id === card.id);
  if (other.some((entry) => entry.card.id === card.id)) {
    return side === 'give'
      ? `Already on ${otherName}’s side — a card can’t be on both`
      : 'Already on your side — a card can’t be on both';
  }
  if (!line && lines.length >= MAX_TRADE_LINES) {
    return `At most ${MAX_TRADE_LINES} different cards a side`;
  }
  if (side === 'give' && available === 0) return 'All copies locked in pending trades';
  if (side === 'give' && available !== undefined && (line?.count ?? 0) >= available) {
    return 'All available copies added';
  }
  if ((line?.count ?? 0) >= MAX_TRADE_LINE_QUANTITY) {
    return `At most ${MAX_TRADE_LINE_QUANTITY} copies of a card`;
  }
  return null;
}

/** What keeps *Review offer* disabled; empty when the offer can be reviewed. */
export function composeProblems(
  state: ComposerState,
  {
    meId,
    balance,
    available,
  }: {
    meId: string;
    balance: number | undefined;
    available: (cardId: string) => number | undefined;
  },
): string[] {
  const problems: string[] = [];
  if (!state.counterparty) problems.push('Choose who to trade with');
  else if (state.counterparty.id === meId) problems.push('You can’t trade with yourself');
  if (
    state.give.length === 0 &&
    state.get.length === 0 &&
    state.coinsGive === 0 &&
    state.coinsGet === 0
  ) {
    problems.push('Add a card or coins to either side');
  }
  if (state.give.length > MAX_TRADE_LINES || state.get.length > MAX_TRADE_LINES) {
    problems.push(`At most ${MAX_TRADE_LINES} different cards a side`);
  }
  const both = state.give.find((line) => state.get.some((g) => g.card.id === line.card.id));
  if (both) problems.push(`${both.card.name} is on both sides — a card can be on one only`);
  for (const line of state.give) {
    const have = available(line.card.id);
    if (have !== undefined && line.count > have) {
      problems.push(
        have === 0
          ? `${line.card.name}: no copies available — remove it`
          : `${line.card.name}: only ${have} available`,
      );
    }
  }
  if (balance !== undefined && state.coinsGive > balance) {
    problems.push(`You have ${formatCoins(balance)} coins`);
  }
  return problems;
}

type Read<T> = { missing: boolean } & T;

export type InitialInput = {
  meId: string;
  to?: Read<{ profile: PublicProfile | undefined }>;
  card?: Read<{ card: Card | undefined }>;
  counter?: Read<{ trade: TradeDetail | undefined }>;
};

const partyOf = ({ id, displayName, avatarUrl }: TradeParty | PublicProfile): TradeParty => ({
  id,
  displayName,
  avatarUrl,
});

/** The composer as `?to=`, `?card=` and `?counter=` set it up, and what to tell the user. */
export function initialState(input: InitialInput): {
  state: ComposerState;
  notices: string[];
  blocked: string | null;
} {
  if (input.counter) {
    const { trade, missing } = input.counter;
    if (missing || !trade) {
      return { state: EMPTY, notices: [], blocked: 'That offer doesn’t exist, or it isn’t yours.' };
    }
    if (trade.role !== 'recipient' || trade.status !== 'PENDING') {
      return {
        state: EMPTY,
        notices: [],
        blocked: 'You can only counter an open offer made to you.',
      };
    }
    const lines = (side: 'OFFERED' | 'REQUESTED') =>
      trade.items
        .filter((item) => item.side === side)
        .map((item) => ({ card: item.card, count: item.quantity }));
    return {
      state: {
        ...EMPTY,
        mode: 'counter',
        counteredId: trade.id,
        counterparty: partyOf(trade.initiator),
        // What they asked of me is what I give; what they offered is what I get.
        give: lines('REQUESTED'),
        get: lines('OFFERED'),
        coinsGive: trade.currencyFromRecipient,
        coinsGet: trade.currencyFromInitiator,
      },
      notices: [],
      blocked: null,
    };
  }

  const notices: string[] = [];
  let counterparty: TradeParty | null = null;
  if (input.to) {
    if (input.to.missing || !input.to.profile) notices.push('That collector doesn’t exist.');
    else if (input.to.profile.id === input.meId) notices.push('You can’t trade with yourself.');
    else counterparty = partyOf(input.to.profile);
  }
  const get: Line[] = [];
  if (input.card) {
    if (input.card.missing || !input.card.card) notices.push('That card isn’t in the catalog.');
    else get.push({ card: summaryOf(input.card.card), count: 1 });
  }
  return { state: { ...EMPTY, counterparty, get }, notices, blocked: null };
}

export function termsOf(state: ComposerState): TradeTermsBody {
  const linesOf = (lines: Line[]) =>
    lines.map((line) => ({ cardId: line.card.id, quantity: line.count }));
  return {
    offered: linesOf(state.give),
    requested: linesOf(state.get),
    currencyFromInitiator: state.coinsGive,
    currencyFromRecipient: state.coinsGet,
  };
}
