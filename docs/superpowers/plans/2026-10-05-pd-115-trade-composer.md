# PD-115 Trade Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/trades/new` — compose a trade (counterparty by search, cards and coins on both sides), review it in plain language and send it, or counter an incoming offer from the same screen.

**Architecture:** One new member endpoint, `GET /users?q=`, finds counterparties by display name. The web composer is a client tree under `components/trades/composer/`: a pure state module (reducer, problems, pre-fill, request body), a counterparty combobox, a card picker dialog over the inventory and the catalog, the existing `TradeOfferPanel` with a count stepper, and a review step. The server page passes `?to`, `?card` and `?counter` to a loader that waits for their reads and mounts the composer with its initial state.

**Tech Stack:** NestJS + Prisma (API), Zod 4 (shared), Next 16.3, React 19.2, TanStack Query 5 / Virtual 3.

**Spec:** `docs/superpowers/specs/2026-10-05-pd-115-trade-composer-design.md`

## Global Constraints

- No automated tests in v1. Each task's gate: shared `pnpm --filter @pokedrop/shared build`; api `pnpm --filter @pokedrop/api typecheck` and `npx eslint apps/api/src/users --max-warnings=0`; web `pnpm --filter @pokedrop/web typecheck` and `npx eslint <touched folders under apps/web> --max-warnings=0`. Behaviour is measured with `curl` (Task 1) and in a browser (Task 6).
- No hex colors and no arbitrary spacing lengths in `apps/web` class strings; arbitrary font sizes (`text-[11px]`) are allowed; inline `style` values are fine.
- Commits on `dev`, header `[PD-115]: …` (≤ 72 characters), body ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Code, commits and docs in English; comments only where they carry a reason.
- Request bounds from `@pokedrop/shared`: `MAX_TRADE_LINES = 20` per side, `MAX_TRADE_LINE_QUANTITY = 100`, `MAX_TRADE_CURRENCY = 1_000_000`. The user search: `q` 2–64 characters, at most 10 results, `MODERATE_THROTTLE` (30 a minute by default).
- The expiry window is never written in the web app: the review says *…or the offer expires*; the sent trade carries `expiresAt`.
- Error codes come from `ERROR_CODES` in `@pokedrop/shared` (`CARDS_UNAVAILABLE`, `TRADE_NOT_PENDING`), never string literals.
- The leave guard is `useUnsavedChanges` (`lib/use-unsaved-changes.ts`); a successful send leaves through the function it returns (Task 4), never a bare `router.push`, so the guard's sentinel is not popped under the navigation.

## Review Focus

1. **A copy locked elsewhere after it was added** (another tab proposes a trade with it): the give line is flagged *only n available* before Review, and a send that races it answers 409 with the draft intact. Pinned in Task 3 (`composeProblems` reads `available` from `GET /inventory/owned`) and measured in Task 6, check 7.
2. **The counterparty is the caller** by any route — search, `?to=`, a crafted state: Review stays disabled with *You can't trade with yourself*. Pinned in Task 1 (search excludes the caller), Task 3 (`initialState` drops `?to=` self, `composeProblems` refuses it) and measured in Task 6, check 3.
3. **A card on both sides** through the pickers or pre-fill (`?card=` naming a card then added on the give side): refused at the picker and flagged by `composeProblems`. Pinned in Task 3 (`pickRefusal`, `composeProblems`) and measured in Task 6, check 2.
4. **Counter on an offer that is not open or not the caller's**: a blocking explanation, never a composer that sends a doomed counter. Pinned in Task 3 (`initialState` → `blocked`) and measured in Task 6, check 8.
5. **Leaving with a half-built offer, then sending one**: the guard asks before leaving, and after *Send* the page leaves without a prompt and without bouncing back. Pinned in Task 4 (`useUnsavedChanges` returns `leaveTo`) and Task 5, measured in Task 6, check 6.

---

## File structure

| File | Responsibility |
| --- | --- |
| `packages/shared/src/entities/user.ts` | `UserSearchQuerySchema`, `UserSearchResultSchema` |
| `apps/api/src/users/users.{dto,service,controller}.ts` | `GET /users?q=` |
| `apps/web/lib/api/endpoints/{users,trades,catalog}.ts` | `userSearch`, `publicProfile`; `trade`, `proposeTrade`, `counterTrade`; `card` |
| `apps/web/lib/query/{keys,invalidation,users,trades,catalog}.ts` | `useUserSearch`, `useProfile`, `useTrade`, `useProposeTrade`, `useCounterTrade`, `useCard` |
| `apps/web/lib/use-debounced.ts` | `useDebounced` |
| `apps/web/lib/use-unsaved-changes.ts` | returns `leaveTo(href)` |
| `apps/web/components/trades/composer/composer-state.ts` | state, reducer, `pickRefusal`, `composeProblems`, `initialState`, `termsOf`, `lineText`, `summaryOf` |
| `apps/web/components/trades/trade-offer-panel.tsx` | count stepper and per-line problem |
| `apps/web/components/trades/composer/counterparty-picker.tsx` | the *Trade with…* combobox |
| `apps/web/components/trades/composer/card-picker-dialog.tsx` | the card pickers |
| `apps/web/components/trades/composer/trade-review.tsx` | the review step |
| `apps/web/components/trades/composer/trade-composer.tsx` | the loader and the composer |
| `apps/web/app/(app)/trades/new/page.tsx` | the route |

---

### Task 1: `GET /users?q=`

**Files:**
- Modify: `packages/shared/src/entities/user.ts`
- Modify: `apps/api/src/users/users.dto.ts`, `apps/api/src/users/users.service.ts`, `apps/api/src/users/users.controller.ts`
- Modify: `docs/API.md`

**Interfaces:**
- Produces: `UserSearchQuerySchema` (`{ q: string }`, trimmed, 2–64, no NUL); `type UserSearchQuery`; `UserSearchResultSchema = z.array(TradePartySchema)`; `type UserSearchResult`; `GET /users?q=` → `UserSearchResult`.

- [ ] **Step 1: Shared schemas**

In `packages/shared/src/entities/user.ts` add `import { TradePartySchema } from './trade.js';` and, after `PublicProfileSchema`:

```ts
/** A member's name search for a trade counterparty: only what a public profile shows. */
export const UserSearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .refine((value) => !value.includes('\u0000'), 'must not contain a NUL character'),
});
export type UserSearchQuery = z.infer<typeof UserSearchQuerySchema>;

export const USER_SEARCH_LIMIT = 10;

export const UserSearchResultSchema = z.array(TradePartySchema).max(USER_SEARCH_LIMIT);
export type UserSearchResult = z.infer<typeof UserSearchResultSchema>;
```

Run: `pnpm --filter @pokedrop/shared build`
Expected: exits 0 (no import cycle: `trade.ts` does not import `user.ts`).

- [ ] **Step 2: DTO and service**

`apps/api/src/users/users.dto.ts` — add `UserSearchQuerySchema` to the import and:

```ts
export class UserSearchQueryDto extends createZodDto('UserSearchQuery', UserSearchQuerySchema) {}
```

`apps/api/src/users/users.service.ts` — add `USER_SEARCH_LIMIT`, `UserSearchResultSchema` and `type UserSearchResult` to the `@pokedrop/shared` import, `import { escapeLike } from '../common/escape-like.js';`, and the method:

```ts
  /**
   * Collectors whose display name contains `q`, an exact name first. Never the caller, never a
   * suspended account, and only the public fields — the trade composer's counterparty search.
   */
  async search(viewerId: string, q: string): Promise<UserSearchResult> {
    const where = { id: { not: viewerId }, suspendedAt: null };
    const select = { id: true, displayName: true, avatarUrl: true } as const;
    const [exact, partial] = await Promise.all([
      this.prisma.user.findMany({
        where: { ...where, displayName: { equals: q, mode: 'insensitive' } },
        select,
        orderBy: { id: 'asc' },
        take: USER_SEARCH_LIMIT,
      }),
      this.prisma.user.findMany({
        where: { ...where, displayName: { contains: escapeLike(q), mode: 'insensitive' } },
        select,
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        take: USER_SEARCH_LIMIT,
      }),
    ]);
    const seen = new Set(exact.map((user) => user.id));
    return UserSearchResultSchema.parse(
      [...exact, ...partial.filter((user) => !seen.has(user.id))].slice(0, USER_SEARCH_LIMIT),
    );
  }
```

- [ ] **Step 3: Controller**

`apps/api/src/users/users.controller.ts` — import `Query` from `@nestjs/common`, `Throttle` from `@nestjs/throttler`, `MODERATE_THROTTLE` from `../common/throttle.js`, `UserSearchQueryDto`, `type UserSearchResult` and `UserSearchResultSchema`; add before `me()`:

```ts
  // A name search enumerates members, so it is throttled like proposing a trade.
  @Throttle(MODERATE_THROTTLE)
  @Doc(
    'Collectors by display name, for choosing a trade counterparty',
    returns('UserSearchResult', UserSearchResultSchema),
  )
  @Get()
  search(
    @CurrentUser() user: AuthUser,
    @Query() query: UserSearchQueryDto,
  ): Promise<UserSearchResult> {
    return this.users.search(user.id, query.q);
  }
```

Run: `pnpm --filter @pokedrop/api typecheck && npx eslint apps/api/src/users --max-warnings=0`
Expected: both exit 0.

- [ ] **Step 4: Measure through HTTP**

With the `api` preview recompiled (`preview_logs` with `search: "successfully started"`), from the scratchpad (`$S`, the cookie jar `jar.txt` of `pd102-1791136869104@pokedrop.test`, display name *PD102 Tester*):

```bash
S="C:/Users/MaxSt/AppData/Local/Temp/claude/M--projects-pokedrop/8d10f40f-9e44-417a-989f-5dca9039d88f/scratchpad"
A="http://localhost:4000/api/v1"; H="Origin: http://localhost:3000"
for q in nnn NNNN pd102 a '%25' "$(printf 'x%.0s' $(seq 1 65))"; do
  printf "%s → " "$q"; curl -s -o "$S/us.json" -w "%{http_code} " -b "$S/jar.txt" -H "$H" "$A/users?q=$q"; head -c 160 "$S/us.json"; echo
done
curl -s -o /dev/null -w "signed out: %{http_code}\n" -H "$H" "$A/users?q=nnn"
docker exec pokedrop-postgres psql -U pokedrop -d pokedrop -c "EXPLAIN ANALYZE SELECT id FROM users WHERE id <> 'x' AND \"suspendedAt\" IS NULL AND \"displayName\" ILIKE '%nnn%' ORDER BY \"displayName\", id LIMIT 10;" | tail -4
```

Expected: `nnn` and `NNNN` → 200 with the second test member (`4tIju4nF…`, 64 `n`s) and fields `id`, `displayName`, `avatarUrl` only; `pd102` → 200 `[]` (the caller is excluded); `a` and 65 characters → 400; `%25` (a literal `%`) → 200 `[]` or only names containing `%`; signed out → 401; the plan's execution time under a millisecond on the test database. If the `docker exec` user or database name differs, read them from `.env` (`DATABASE_URL`).

- [ ] **Step 5: Document**

In `docs/API.md` *Users / Profile*: add the row `| GET | \`/users?q=\` | member | Collectors by display name for a trade counterparty — throttled |` to the table, and a paragraph after the public-profile bullets:

> **`GET /users?q=`** (PD-115) — a trade counterparty search. `q` is trimmed, 2–64 characters; the answer is at most 10 `{ id, displayName, avatarUrl }` — the public profile's own fields — an exact name (case-insensitive) first, then names containing `q` alphabetically; `%`, `_` and `\` match literally. Never the caller, never a suspended account. Throttled with `MODERATE_THROTTLE`, as a name search can enumerate members. No index: a sequential scan of `users` measured under a millisecond (*Measured* with the numbers from Step 4); a trigram index is the answer when the table grows.

- [ ] **Step 6: Commit**

```bash
cd /m/projects/pokedrop
git add packages/shared/src/entities/user.ts apps/api/src/users docs/API.md
git commit -m "[PD-115]: let members find a trade counterparty by name

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Web data — endpoints, keys and hooks

**Files:**
- Modify: `apps/web/lib/api/endpoints/users.ts`, `apps/web/lib/api/endpoints/trades.ts`, `apps/web/lib/api/endpoints/catalog.ts`
- Modify: `apps/web/lib/query/keys.ts`, `apps/web/lib/query/invalidation.ts`, `apps/web/lib/query/trades.ts`, `apps/web/lib/query/catalog.ts`
- Create: `apps/web/lib/query/users.ts`, `apps/web/lib/use-debounced.ts`

**Interfaces:**
- Consumes: Task 1's `UserSearchResultSchema`.
- Produces: `userSearch(q)`, `publicProfile(id)`, `trade(id)`, `proposeTrade(body: ProposeTradeBody)`, `counterTrade(id, body: TradeTermsBody)`, `card(id)`; `keys.profiles.search(q)`, `keys.profiles.detail(id)`, `keys.trades.detail(id)`, `keys.catalog.card(id)`; `useUserSearch(q: string)`, `useProfile(id: string | undefined)`, `useTrade(id: string | undefined)`, `useCard(id: string | undefined)`, `useProposeTrade()` (`mutationFn(body: ProposeTradeBody)`), `useCounterTrade()` (`mutationFn({ id, body })`); `type TradeTermsBody = { offered: TradeLine[]; requested: TradeLine[]; currencyFromInitiator: number; currencyFromRecipient: number }`, `type ProposeTradeBody = TradeTermsBody & { recipientId: string }`; `useDebounced<T>(value: T, ms: number): T`.

- [ ] **Step 1: Endpoints**

`apps/web/lib/api/endpoints/users.ts`:

```ts
import { MyProfileSchema, PublicProfileSchema, UserSearchResultSchema } from '@pokedrop/shared';
import { get } from '../core';

export const me = () => get('/users/me', MyProfileSchema);

export const publicProfile = (id: string) => get(`/users/${id}`, PublicProfileSchema);

export const userSearch = (q: string) => get('/users', UserSearchResultSchema, { q });
```

`apps/web/lib/api/endpoints/trades.ts` — replace with:

```ts
import {
  type TradeInboxQuerySchema,
  type TradeLine,
  TradeDetailSchema,
  TradePageSchema,
  TradeSchema,
} from '@pokedrop/shared';
import { z } from 'zod';
import { get, post } from '../core';

export type TradeInboxParams = z.input<typeof TradeInboxQuerySchema>;

export type TradeTermsBody = {
  offered: TradeLine[];
  requested: TradeLine[];
  currencyFromInitiator: number;
  currencyFromRecipient: number;
};
export type ProposeTradeBody = TradeTermsBody & { recipientId: string };

export const trades = (params: TradeInboxParams = {}) => get('/trades', TradePageSchema, params);

/** A trade the caller is a party to; 404 to anyone else. */
export const trade = (id: string) => get(`/trades/${id}`, TradeDetailSchema);

export const proposeTrade = (body: ProposeTradeBody) => post('/trades', TradeSchema, body);

export const counterTrade = (id: string, body: TradeTermsBody) =>
  post(`/trades/${id}/counter`, TradeSchema, body);

export const acceptTrade = (id: string) => post(`/trades/${id}/accept`, TradeSchema);

export const declineTrade = (id: string) => post(`/trades/${id}/decline`, TradeSchema);
```

`apps/web/lib/api/endpoints/catalog.ts` — add `CardSchema` to the shared import and:

```ts
export const card = (id: string) => get(`/cards/${id}`, CardSchema);
```

- [ ] **Step 2: Keys and invalidation**

`apps/web/lib/query/keys.ts`: in `catalog` add `card: (id: string) => ['catalog', 'card', id],`; in `trades` add `detail: (id: string) => ['trades', 'detail', id],`; replace `profiles: { all: ['profiles'] },` with

```ts
  profiles: {
    all: ['profiles'],
    detail: (id: string) => ['profiles', 'detail', id],
    search: (q: string) => ['profiles', 'search', q],
  },
```

`apps/web/lib/query/invalidation.ts`: add `proposeTrade: ['proposeTrade'],` and `counterTrade: ['counterTrade'],` to `mutationKeys`, and to `INVALIDATES`:

```ts
  // The offered copies are locked now; the inbox and its counts change.
  proposeTrade: [keys.trades.all, keys.inventory.all, keys.notifications.all],
  counterTrade: [keys.trades.all, keys.inventory.all, keys.notifications.all],
```

- [ ] **Step 3: Hooks**

Create `apps/web/lib/use-debounced.ts`:

```ts
'use client';

import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
```

Create `apps/web/lib/query/users.ts`:

```ts
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/browser';
import { publicProfile, userSearch } from '@/lib/api/endpoints/users';
import { keys } from './keys';

export function useUserSearch(q: string) {
  return useQuery({
    queryKey: keys.profiles.search(q),
    queryFn: () => api.call(userSearch(q)),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
  });
}

export function useProfile(id: string | undefined) {
  return useQuery({
    queryKey: keys.profiles.detail(id ?? ''),
    queryFn: () => api.call(publicProfile(id ?? '')),
    enabled: id !== undefined,
    retry: false,
  });
}
```

`apps/web/lib/query/catalog.ts` — add `card` to the endpoints import and:

```ts
export function useCard(id: string | undefined) {
  return useQuery({
    queryKey: keys.catalog.card(id ?? ''),
    queryFn: () => api.call(card(id ?? '')),
    enabled: id !== undefined,
    retry: false,
  });
}
```

`apps/web/lib/query/trades.ts` — extend the endpoints import with `counterTrade`, `type ProposeTradeBody`, `proposeTrade`, `trade`, `type TradeTermsBody`, and add:

```ts
export function useTrade(id: string | undefined) {
  return useQuery({
    queryKey: keys.trades.detail(id ?? ''),
    queryFn: () => api.call(trade(id ?? '')),
    enabled: id !== undefined,
    retry: false,
  });
}

export function useProposeTrade() {
  return useMutation({
    mutationKey: mutationKeys.proposeTrade,
    mutationFn: (body: ProposeTradeBody) => api.call(proposeTrade(body)),
    meta: { toast: false },
  });
}

export function useCounterTrade() {
  return useMutation({
    mutationKey: mutationKeys.counterTrade,
    mutationFn: ({ id, body }: { id: string; body: TradeTermsBody }) =>
      api.call(counterTrade(id, body)),
    meta: { toast: false },
  });
}
```

- [ ] **Step 4: Gate and commit**

Run: `pnpm --filter @pokedrop/web typecheck && npx eslint apps/web/lib --max-warnings=0`
Expected: both exit 0.

```bash
cd /m/projects/pokedrop
git add apps/web/lib
git commit -m "[PD-115]: add the queries and mutations the composer reads and sends

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The composer's state module

**Files:**
- Create: `apps/web/components/trades/composer/composer-state.ts`

**Interfaces:**
- Consumes: `TradeTermsBody` (Task 2); `setNumber` (`components/cards/card-data`); `formatCoins` (`lib/format`).
- Produces:
  - `type Side = 'give' | 'get'`; `type Line = { card: InventoryCard; count: number }`; `type ComposerState = { mode: 'new' | 'counter'; counteredId: string | null; counterparty: TradeParty | null; give: Line[]; get: Line[]; coinsGive: number; coinsGet: number; step: 'compose' | 'review' }`; `type ComposerAction` (`counterparty`, `add`, `count`, `remove`, `coins`, `step`).
  - `composerReducer(state, action): ComposerState`.
  - `summaryOf(card: Card): InventoryCard`.
  - `pickRefusal(state, side, card, available: number | undefined, otherName: string): string | null`.
  - `composeProblems(state, { meId, balance, available }: { meId: string; balance: number | undefined; available: (cardId: string) => number | undefined }): string[]`.
  - `initialState(input: InitialInput): { state: ComposerState; notices: string[]; blocked: string | null }` with `type InitialInput = { meId: string; to?: { profile: PublicProfile | undefined; missing: boolean }; card?: { card: Card | undefined; missing: boolean }; counter?: { trade: TradeDetail | undefined; missing: boolean } }`.
  - `termsOf(state): TradeTermsBody`; `lineText(line: Line): string`; `cardCount(lines: Line[]): number`.

- [ ] **Step 1: Write the module**

Create `apps/web/components/trades/composer/composer-state.ts`:

```ts
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
      return action.side === 'give' ? { ...state, coinsGive: coins } : { ...state, coinsGet: coins };
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
```

- [ ] **Step 2: Gate and commit**

Run: `pnpm --filter @pokedrop/web typecheck && npx eslint apps/web/components/trades --max-warnings=0`
Expected: both exit 0. (If `TradeLine.cardId` is the branded `CardId`, `card.id` from `InventoryCard` is already branded; no cast is needed.)

```bash
cd /m/projects/pokedrop
git add apps/web/components/trades/composer/composer-state.ts
git commit -m "[PD-115]: model the composer's state, problems and pre-fill

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The panel's stepper, the counterparty picker, the card picker and `leaveTo`

**Files:**
- Modify: `apps/web/components/trades/trade-offer-panel.tsx`
- Modify: `apps/web/lib/use-unsaved-changes.ts`
- Create: `apps/web/components/trades/composer/counterparty-picker.tsx`, `apps/web/components/trades/composer/card-picker-dialog.tsx`

**Interfaces:**
- Consumes: Task 2 hooks; Task 3 `pickRefusal`, `summaryOf`, `ComposerState`, `Side`.
- Produces:
  - `OfferLine` gains `max?: number` and `problem?: string`; `TradeOfferPanel` gains `onCountChange?: (side: 'give' | 'get', cardId: string, count: number) => void`.
  - `useUnsavedChanges(dirty, onAttempt, fallback?)` now returns `leaveTo: (href: string) => void`, which navigates without asking and without popping the sentinel.
  - `CounterpartyPicker({ value, onChange, locked }: { value: TradeParty | null; onChange: (party: TradeParty | null) => void; locked: boolean })`.
  - `CardPickerDialog({ side, state, counterpartyName, showcase, onPick, onClose }: { side: Side | null; state: ComposerState; counterpartyName: string; showcase: InventoryCard[]; onPick: (side: Side, card: InventoryCard) => void; onClose: () => void })` — open while `side` is not null.

- [ ] **Step 1: The panel's stepper**

In `apps/web/components/trades/trade-offer-panel.tsx`: add `Minus` to the lucide import; change `export type OfferLine = { card: CardView; count: number; locked?: boolean };` to

```ts
export type OfferLine = {
  card: CardView;
  count: number;
  locked?: boolean;
  /** The stepper's ceiling when editable: available copies on the give side. */
  max?: number;
  /** Why this line keeps the offer from being sent, shown under it. */
  problem?: string;
};
```

add `onCountChange?: (side: SideKey, cardId: string, count: number) => void;` to `TradeOfferPanelProps` and to the `Pick<…>` list of `Side`'s props, destructure it in `Side`, and replace `<span className="font-mono text-mut">×{line.count}</span>` with

```tsx
              {editable && !line.locked && onCountChange ? (
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`One fewer ${line.card.name}`}
                    disabled={line.count <= 1}
                    onClick={() => onCountChange(side, line.card.id, line.count - 1)}
                    className="focus-ring flex size-6 cursor-pointer items-center justify-center rounded-tag border border-bd-2 text-mut hover:text-tx disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Minus aria-hidden className="size-3" />
                  </button>
                  <span aria-live="polite" className="min-w-6 text-center font-mono text-tx">
                    <span className="sr-only">{line.card.name}: </span>×{line.count}
                  </span>
                  <button
                    type="button"
                    aria-label={`One more ${line.card.name}`}
                    disabled={line.max !== undefined && line.count >= line.max}
                    onClick={() => onCountChange(side, line.card.id, line.count + 1)}
                    className="focus-ring flex size-6 cursor-pointer items-center justify-center rounded-tag border border-bd-2 text-mut hover:text-tx disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus aria-hidden className="size-3" />
                  </button>
                </span>
              ) : (
                <span className="font-mono text-mut">×{line.count}</span>
              )}
```

and, after that `<div …>` row inside the `<li>`, add

```tsx
            {line.problem ? <p className="text-[11px] leading-4 text-red">{line.problem}</p> : null}
```

- [ ] **Step 2: `leaveTo`**

In `apps/web/lib/use-unsaved-changes.ts`:
- change the signature's return type from `: void {` to `: (href: string) => void {`;
- add `const leavingRef = useRef(false);` after `const attempt = useRef(onAttempt);`;
- inside the effect, replace `let leaving = false;` with `leavingRef.current = false;` and replace every other `leaving` in the effect with `leavingRef.current` (the four reads and the three `leaving = true` assignments);
- append before the closing brace of the hook:

```ts
  // Leaving on purpose (a sent offer): no prompt, and the cleanup must not pop the sentinel
  // under the navigation.
  return (href: string) => {
    leavingRef.current = true;
    router.push(href);
  };
```

Update the docblock's last sentence to add: *The function it returns leaves on purpose, without asking.*

- [ ] **Step 3: The counterparty picker**

Create `apps/web/components/trades/composer/counterparty-picker.tsx`:

```tsx
'use client';

import type { TradeParty } from '@pokedrop/shared';
import { UserSearch } from 'lucide-react';
import { type KeyboardEvent, useId, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useUserSearch } from '@/lib/query/users';
import { useDebounced } from '@/lib/use-debounced';
import { cn } from '@/lib/utils';

export function CounterpartyPicker({
  value,
  onChange,
  locked,
}: {
  value: TradeParty | null;
  onChange: (party: TradeParty | null) => void;
  locked: boolean;
}) {
  const inputId = useId();
  const listId = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const query = useDebounced(text.trim(), 300);
  const search = useUserSearch(query);
  const results = query.length >= 2 ? (search.data ?? []) : [];
  const showList = open && query.length >= 2;

  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-small text-mut">Trade with</span>
        <div className="flex items-center gap-3 rounded-control border border-bd-2 bg-surface px-3 py-2">
          <Avatar name={value.displayName} src={value.avatarUrl} size={32} decorative />
          <span className="min-w-0 flex-1 truncate font-semibold text-tx">{value.displayName}</span>
          {locked ? null : (
            <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
              Change
            </Button>
          )}
        </div>
      </div>
    );
  }

  const choose = (party: TradeParty) => {
    onChange(party);
    setText('');
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, Math.max(0, results.length - 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && showList && results[active]) {
      event.preventDefault();
      choose(results[active]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const optionId = (id: string) => `${listId}-${id}`;

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-small text-mut">
        Trade with
      </label>
      <div className="relative">
        <UserSearch
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
        />
        <input
          id={inputId}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showList && results[active] ? optionId(results[active].id) : undefined
          }
          autoComplete="off"
          value={text}
          placeholder="Search collectors by name…"
          maxLength={64}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
          className="focus-ring h-10 w-full rounded-control border border-bd-2 bg-bg pr-3 pl-10 text-body text-tx placeholder:text-faint"
        />
      </div>
      {text.trim().length === 1 ? (
        <p className="text-[12px] text-faint">Type at least 2 characters</p>
      ) : null}
      <ul
        id={listId}
        role="listbox"
        aria-label="Collectors"
        hidden={!showList}
        className="absolute top-full z-20 mt-1 flex w-full flex-col overflow-hidden rounded-control border border-bd-2 bg-surface shadow-lg"
      >
        {search.isFetching && results.length === 0 ? (
          <li role="presentation" className="px-3 py-2 text-small text-mut">
            Searching…
          </li>
        ) : results.length === 0 ? (
          <li role="presentation" className="px-3 py-2 text-small text-mut">
            No collectors match
          </li>
        ) : (
          results.map((party, index) => (
            <li
              key={party.id}
              id={optionId(party.id)}
              role="option"
              aria-selected={index === active}
              // Keep the input focused, so the blur does not close the list before the choice.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(party);
              }}
              className={cn(
                'flex cursor-pointer items-center gap-3 px-3 py-2 text-small text-tx',
                index === active && 'bg-pri-dim',
              )}
            >
              <Avatar name={party.displayName} src={party.avatarUrl} size={28} decorative />
              <span className="truncate">{party.displayName}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: The card picker**

Create `apps/web/components/trades/composer/card-picker-dialog.tsx`:

```tsx
'use client';

import type { InventoryCard } from '@pokedrop/shared';
import { useId, useState } from 'react';
import { CardArt } from '@/components/cards/card-art';
import { cardView, setNumber } from '@/components/cards/card-data';
import { VirtualCardGrid } from '@/components/collection/virtual-card-grid';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { SearchInput } from '@/components/ui/search-input';
import { useCatalogBrowse } from '@/lib/query/catalog';
import { useInventory } from '@/lib/query/inventory';
import { cn } from '@/lib/utils';
import { type ComposerState, pickRefusal, type Side, summaryOf } from './composer-state';

function PickTile({
  card,
  badge,
  refusal,
  onPick,
}: {
  card: InventoryCard;
  badge?: string;
  refusal: string | null;
  onPick: () => void;
}) {
  const reasonId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-label={`Add ${card.name} (${setNumber(card.id)})${badge ? `, ${badge}` : ''}`}
        aria-disabled={refusal !== null || undefined}
        aria-describedby={refusal !== null ? reasonId : undefined}
        onClick={() => {
          if (refusal === null) onPick();
        }}
        className={cn(
          'focus-ring block overflow-hidden rounded-tile border border-bd bg-surface text-left transition hover:border-pri',
          refusal !== null && 'cursor-not-allowed opacity-50 grayscale',
        )}
      >
        <span className="relative block aspect-[5/7]">
          <CardArt card={cardView(card)} sizes="120px" />
          {badge ? (
            <span className="absolute top-2 right-2 rounded-tag bg-black/50 px-1.5 py-0.5 font-mono text-[10px] leading-4 font-semibold text-white">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="block truncate border-t border-bd px-2 py-1.5 text-small font-semibold text-tx">
          {card.name}
        </span>
      </button>
      {refusal !== null ? (
        <p id={reasonId} className="text-[11px] leading-4 text-faint">
          {refusal}
        </p>
      ) : null}
    </div>
  );
}

type ResultsProps = {
  q: string;
  state: ComposerState;
  counterpartyName: string;
  scroller: HTMLElement | null;
  pick: (card: InventoryCard) => void;
};

function Status({ children }: { children: string }) {
  return <p className="py-8 text-center text-small text-mut">{children}</p>;
}

function MyCards({ q, state, counterpartyName, scroller, pick }: ResultsProps) {
  const list = useInventory({ q: q || undefined });
  const entries = list.data?.pages.flatMap((page) => page.items) ?? [];
  if (list.isPending) return <Status>Loading your cards…</Status>;
  if (entries.length === 0) return <Status>{q ? 'No cards of yours match' : 'You have no cards yet'}</Status>;
  return (
    <VirtualCardGrid
      items={entries}
      getKey={(entry) => entry.id}
      label="Your cards"
      minTileWidth={110}
      hasMore={list.hasNextPage}
      loadingMore={list.isFetchingNextPage}
      onLoadMore={() => void list.fetchNextPage()}
      scrollElement={scroller}
      renderTile={(entry) => {
        const locked = entry.quantity - entry.availableQuantity;
        return (
          <PickTile
            card={entry.card}
            badge={locked > 0 ? `×${entry.quantity} · ${locked} locked` : `×${entry.quantity}`}
            refusal={pickRefusal(state, 'give', entry.card, entry.availableQuantity, counterpartyName)}
            onPick={() => pick(entry.card)}
          />
        );
      }}
    />
  );
}

function CatalogCards({ q, state, counterpartyName, scroller, pick }: ResultsProps) {
  const list = useCatalogBrowse({ q: q || undefined });
  const cards = list.data?.pages.flatMap((page) => page.items) ?? [];
  if (list.isPending) return <Status>Loading the catalog…</Status>;
  if (cards.length === 0) return <Status>No cards match</Status>;
  return (
    <VirtualCardGrid
      items={cards}
      getKey={(card) => card.id}
      label="Catalog cards"
      minTileWidth={110}
      hasMore={list.hasNextPage}
      loadingMore={list.isFetchingNextPage}
      onLoadMore={() => void list.fetchNextPage()}
      scrollElement={scroller}
      renderTile={(card) => {
        const summary = summaryOf(card);
        return (
          <PickTile
            card={summary}
            refusal={pickRefusal(state, 'get', summary, undefined, counterpartyName)}
            onPick={() => pick(summary)}
          />
        );
      }}
    />
  );
}

export function CardPickerDialog({
  side,
  state,
  counterpartyName,
  showcase,
  onPick,
  onClose,
}: {
  side: Side | null;
  state: ComposerState;
  counterpartyName: string;
  showcase: InventoryCard[];
  onPick: (side: Side, card: InventoryCard) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [said, setSaid] = useState('');
  const give = side === 'give';

  const pick = (card: InventoryCard) => {
    if (!side) return;
    onPick(side, card);
    setSaid(`Added ${card.name} ${give ? 'to what you give' : `to what ${counterpartyName} gives`}`);
  };
  const props: ResultsProps = { q, state, counterpartyName, scroller, pick };

  return (
    <Dialog
      open={side !== null}
      onOpenChange={(open) => {
        if (!open) {
          setQ('');
          onClose();
        }
      }}
      title={give ? 'Add a card you give' : `Add a card ${counterpartyName} gives`}
      description={
        give
          ? 'Only copies not promised to another trade can be offered.'
          : `${counterpartyName}’s collection is private: pick any card; the trade can only be accepted if they have it.`
      }
      className="max-w-180"
    >
      <div className="flex flex-col gap-4">
        <SearchInput
          value={q}
          onSearch={setQ}
          label={give ? 'Search your cards' : 'Search the catalog'}
          placeholder="Search by name…"
          maxLength={100}
        />
        <p aria-live="polite" className="sr-only">
          {said}
        </p>
        <div ref={setScroller} className="overflow-y-auto pr-1" style={{ height: '55dvh' }}>
          {!give && showcase.length > 0 && q === '' ? (
            <section aria-label={`On ${counterpartyName}’s showcase`} className="mb-5 flex flex-col gap-3">
              <h3 className="text-small font-semibold text-mut">On {counterpartyName}’s showcase</h3>
              <div className="grid grid-cols-3 gap-4 sm:grid-cols-5">
                {showcase.map((card) => (
                  <PickTile
                    key={card.id}
                    card={card}
                    refusal={pickRefusal(state, 'get', card, undefined, counterpartyName)}
                    onPick={() => pick(card)}
                  />
                ))}
              </div>
              <h3 className="text-small font-semibold text-mut">Every card</h3>
            </section>
          ) : null}
          {side === null ? null : give ? <MyCards {...props} /> : <CatalogCards {...props} />}
        </div>
        <Button onClick={onClose} className="self-end">
          Done
        </Button>
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 5: Gate and commit**

Run: `pnpm --filter @pokedrop/web typecheck && npx eslint apps/web/components/trades apps/web/lib --max-warnings=0`
Expected: both exit 0. If the lint flags `max-w-180` as unknown, use `className` with an existing scale value (`max-w-4xl`).

```bash
cd /m/projects/pokedrop
git add apps/web/components/trades apps/web/lib/use-unsaved-changes.ts
git commit -m "[PD-115]: add the counterparty search, card pickers and line steppers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The composer, the review and the route

**Files:**
- Create: `apps/web/components/trades/composer/trade-review.tsx`, `apps/web/components/trades/composer/trade-composer.tsx`
- Rewrite: `apps/web/app/(app)/trades/new/page.tsx`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces: `TradeReview({ state, sending, onBack, onSend })`; `TradeComposerPage({ to, card, counter }: { to?: string; card?: string; counter?: string })`.

- [ ] **Step 1: The review**

Create `apps/web/components/trades/composer/trade-review.tsx`:

```tsx
'use client';

import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Send } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { formatCoins } from '@/lib/format';
import { cn } from '@/lib/utils';
import { cardCount, type ComposerState, type Line, lineText } from './composer-state';

function SideList({
  heading,
  give,
  lines,
  coins,
  empty,
}: {
  heading: string;
  give: boolean;
  lines: Line[];
  coins: number;
  empty: string;
}) {
  const Arrow = give ? ArrowUpRight : ArrowDownLeft;
  return (
    <section
      aria-label={heading}
      className={cn('flex flex-col gap-2 rounded-card border bg-surface p-4', give ? 'border-red/25' : 'border-grn/25')}
    >
      <h2 className="flex items-center gap-2 text-h3">
        <Arrow aria-hidden className={cn('size-4', give ? 'text-red' : 'text-grn')} />
        {heading}
      </h2>
      {lines.length === 0 && coins === 0 ? (
        <p className="text-body text-mut">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-body text-tx">
          {lines.map((line) => (
            <li key={line.card.id}>{lineText(line)}</li>
          ))}
          {coins > 0 ? <li>{formatCoins(coins)} coins</li> : null}
        </ul>
      )}
    </section>
  );
}

export function TradeReview({
  state,
  sending,
  onBack,
  onSend,
}: {
  state: ComposerState;
  sending: boolean;
  onBack: () => void;
  onSend: () => void;
}) {
  const name = state.counterparty?.displayName ?? '';
  const given = cardCount(state.give);
  const consequences: ReactNode[] = [];
  if (given > 0) {
    consequences.push(
      `Your ${given} ${given === 1 ? 'card locks' : 'cards lock'} until ${name} answers, you cancel, or the offer expires.`,
    );
  }
  if (state.get.length > 0) {
    consequences.push(
      `${name}’s cards aren’t checked now — the trade can only be accepted if ${name} has them.`,
    );
  }
  if (state.mode === 'counter') {
    consequences.push(`Your counter-offer replaces ${name}’s offer, which closes as Countered.`);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <SideList
          heading={`You give ${name}`}
          give
          lines={state.give}
          coins={state.coinsGive}
          empty="Nothing — a request"
        />
        <SideList
          heading={`${name} gives you`}
          give={false}
          lines={state.get}
          coins={state.coinsGet}
          empty="Nothing in return — a gift"
        />
      </div>
      {consequences.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-small text-mut">
          {consequences.map((text, index) => (
            <li key={index}>{text}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" icon={ArrowLeft} disabled={sending} onClick={onBack}>
          Back to edit
        </Button>
        <Button icon={Send} loading={sending} onClick={onSend}>
          {state.mode === 'counter' ? 'Send counter-offer' : 'Send offer'}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: The composer**

Create `apps/web/components/trades/composer/trade-composer.tsx`:

```tsx
'use client';

import { ERROR_CODES, type InventoryCard } from '@pokedrop/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Info, Trash2, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useMemo, useReducer, useState } from 'react';
import { cardView } from '@/components/cards/card-data';
import { ListError } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/core';
import { useCard } from '@/lib/query/catalog';
import { useOwnedCounts } from '@/lib/query/inventory';
import { keys } from '@/lib/query/keys';
import { useMe } from '@/lib/query/me';
import { useCounterTrade, useProposeTrade, useTrade } from '@/lib/query/trades';
import { useProfile } from '@/lib/query/users';
import { toastApiError, toastSuccess } from '@/lib/toast';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { TradeOfferPanel } from '../trade-offer-panel';
import { CardPickerDialog } from './card-picker-dialog';
import {
  composeProblems,
  type ComposerState,
  composerReducer,
  initialState,
  type Side,
  termsOf,
} from './composer-state';
import { CounterpartyPicker } from './counterparty-picker';
import { TradeReview } from './trade-review';

const is404 = (error: unknown) => error instanceof ApiError && error.statusCode === 404;

/** Waits for what `?to=`, `?card=` and `?counter=` name, then mounts the composer with it. */
export function TradeComposerPage({
  to,
  card,
  counter,
}: {
  to?: string;
  card?: string;
  counter?: string;
}) {
  const me = useMe();
  const profile = useProfile(counter ? undefined : to);
  const cardQuery = useCard(counter ? undefined : card);
  const trade = useTrade(counter);

  if (me.isError) return <ListError error={me.error} onRetry={() => void me.refetch()} />;
  if (me.isPending || profile.isLoading || cardQuery.isLoading || trade.isLoading) {
    return <Skeleton shape="block" height="24rem" />;
  }
  for (const query of [profile, cardQuery, trade]) {
    if (query.isError && !is404(query.error)) {
      return <ListError error={query.error} onRetry={() => void query.refetch()} />;
    }
  }

  const { state, notices, blocked } = initialState({
    meId: me.data.id,
    to: !counter && to ? { profile: profile.data, missing: profile.isError } : undefined,
    card: !counter && card ? { card: cardQuery.data, missing: cardQuery.isError } : undefined,
    counter: counter ? { trade: trade.data, missing: trade.isError } : undefined,
  });

  if (blocked) {
    return (
      <>
        <PageHeader title="Counter an offer" />
        <p className="flex items-center gap-2 text-body text-mut">
          <Info aria-hidden className="size-4" />
          {blocked}{' '}
          <Link href="/trades" className="focus-ring rounded-tag text-pri hover:underline">
            Back to your trades
          </Link>
        </p>
      </>
    );
  }
  return <TradeComposer initial={state} notices={notices} meId={me.data.id} />;
}

function TradeComposer({
  initial,
  notices,
  meId,
}: {
  initial: ComposerState;
  notices: string[];
  meId: string;
}) {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(composerReducer, initial);
  const [picker, setPicker] = useState<Side | null>(null);
  const [notice, setNotice] = useState<ReactNode>(notices.length > 0 ? notices.join(' ') : null);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const me = useMe();
  const profile = useProfile(state.counterparty?.id);
  const propose = useProposeTrade();
  const counter = useCounterTrade();
  const sending = propose.isPending || counter.isPending;

  const giveIds = useMemo(() => state.give.map((line) => line.card.id).sort(), [state.give]);
  const { owned, known } = useOwnedCounts(giveIds.length > 0 ? [giveIds] : [], true);
  const available = (cardId: string) =>
    known.has(cardId) ? (owned.get(cardId)?.available ?? 0) : undefined;
  const problems = composeProblems(state, { meId, balance: me.data?.currency, available });

  const name = state.counterparty?.displayName ?? 'They';
  // Changed by the user, not merely non-empty: a pre-filled composer is not dirty on mount, so
  // the guard never installs during React Strict Mode's mount–unmount–mount (Pages.md, traps).
  const dirty =
    state.give !== initial.give ||
    state.get !== initial.get ||
    state.coinsGive !== initial.coinsGive ||
    state.coinsGet !== initial.coinsGet;
  const leaveTo = useUnsavedChanges(dirty, (leave) => setPendingLeave(() => leave), '/trades');

  const lineProblem = (line: { card: InventoryCard; count: number }) => {
    const have = available(line.card.id);
    if (have === undefined || line.count <= have) return undefined;
    return have === 0 ? 'No copies available now' : `Only ${have} available now`;
  };

  async function send() {
    const body = termsOf(state);
    try {
      if (state.mode === 'counter' && state.counteredId) {
        await counter.mutateAsync({ id: state.counteredId, body });
      } else if (state.counterparty) {
        await propose.mutateAsync({ ...body, recipientId: state.counterparty.id });
      }
      toastSuccess(
        state.mode === 'counter' ? `Counter-offer sent to ${name}` : `Offer sent to ${name}`,
      );
      leaveTo('/trades?tab=sent');
    } catch (error) {
      dispatch({ type: 'step', step: 'compose' });
      if (error instanceof ApiError && error.code === ERROR_CODES.CARDS_UNAVAILABLE) {
        setNotice('Some of your copies were locked by another trade meanwhile — lower the marked lines.');
        void queryClient.invalidateQueries({ queryKey: keys.inventory.ownedAll });
      } else if (error instanceof ApiError && error.statusCode === 402) {
        setNotice('You don’t have that many coins any more.');
        void queryClient.invalidateQueries({ queryKey: keys.me });
      } else if (error instanceof ApiError && error.code === ERROR_CODES.TRADE_NOT_PENDING) {
        setNotice(
          <>
            {name}’s offer was already answered.{' '}
            <Link href="/trades" className="text-pri hover:underline">
              Back to your trades
            </Link>
          </>,
        );
      } else {
        toastApiError(error);
      }
    }
  }

  const title = state.mode === 'counter' ? `Counter ${name}’s offer` : 'Propose a trade';

  return (
    <>
      <Breadcrumbs
        trail={[{ label: 'Trades', href: '/trades' }, { label: state.mode === 'counter' ? 'Counter-offer' : 'New proposal' }]}
        className="mb-4"
      />
      <PageHeader
        title={title}
        description="Pick a collector, then build the offer. The cards you offer lock when you send it."
      />
      {notice ? (
        <p role="status" className="mb-5 flex items-start gap-2 rounded-control border border-gold/30 bg-surface p-3 text-small text-tx">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-gold" />
          <span>{notice}</span>
        </p>
      ) : null}

      {state.step === 'review' ? (
        <TradeReview
          state={state}
          sending={sending}
          onBack={() => dispatch({ type: 'step', step: 'compose' })}
          onSend={() => void send()}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="max-w-110">
            <CounterpartyPicker
              value={state.counterparty}
              onChange={(party) => dispatch({ type: 'counterparty', party })}
              locked={state.mode === 'counter'}
            />
          </div>
          <TradeOfferPanel
            editable
            balance={me.data?.currency}
            give={{
              label: 'You give',
              coins: state.coinsGive,
              cards: state.give.map((line) => ({
                card: cardView(line.card),
                count: line.count,
                max: available(line.card.id),
                problem: lineProblem(line),
              })),
            }}
            get={{
              label: `${name} gives`,
              coins: state.coinsGet,
              cards: state.get.map((line) => ({ card: cardView(line.card), count: line.count })),
            }}
            onAddCard={(side) => setPicker(side)}
            onRemoveCard={(side, cardId) => dispatch({ type: 'remove', side, cardId })}
            onCountChange={(side, cardId, count) => dispatch({ type: 'count', side, cardId, count })}
            onCoinsChange={(side, coins) => dispatch({ type: 'coins', side, coins })}
          />
          <div className="flex flex-wrap items-center justify-end gap-3">
            {problems.length > 0 ? (
              <p id="compose-problem" className="text-small text-mut">
                {problems[0]}
              </p>
            ) : null}
            <Button asChild variant="ghost">
              <Link href="/trades">Cancel</Link>
            </Button>
            <Button
              icon={ArrowRight}
              disabled={problems.length > 0}
              aria-describedby={problems.length > 0 ? 'compose-problem' : undefined}
              onClick={() => dispatch({ type: 'step', step: 'review' })}
            >
              Review offer
            </Button>
          </div>
        </div>
      )}

      <CardPickerDialog
        side={picker}
        state={state}
        counterpartyName={name}
        showcase={profile.data?.showcase ?? []}
        onPick={(side, card) => dispatch({ type: 'add', side, card })}
        onClose={() => setPicker(null)}
      />
      <Dialog
        open={pendingLeave !== null}
        onOpenChange={(open) => {
          if (!open) setPendingLeave(null);
        }}
        tone="danger"
        icon={TriangleAlert}
        title="Leave this offer?"
        description="Nothing has been sent; the offer you were building will be lost."
      >
        <div className="flex flex-col gap-2.5">
          <Button variant="secondary" onClick={() => setPendingLeave(null)}>
            Stay
          </Button>
          <Button
            variant="destructive"
            icon={Trash2}
            onClick={() => {
              const leave = pendingLeave;
              setPendingLeave(null);
              leave?.();
            }}
          >
            Discard the offer
          </Button>
        </div>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: The route**

Replace `apps/web/app/(app)/trades/new/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { TradeComposerPage } from '@/components/trades/composer/trade-composer';

export const metadata: Metadata = { title: 'Propose a trade' };

const one = (value: string | string[] | undefined) => (typeof value === 'string' && value ? value : undefined);

export default async function NewTradePage({ searchParams }: PageProps<'/trades/new'>) {
  const params = await searchParams;
  const to = one(params.to);
  const card = one(params.card);
  const counter = one(params.counter);
  // Keyed by the parameters: a link to a different pre-fill starts a fresh composer.
  return (
    <TradeComposerPage
      key={`${to ?? ''}|${card ?? ''}|${counter ?? ''}`}
      to={to}
      card={card}
      counter={counter}
    />
  );
}
```

- [ ] **Step 4: Gate and look**

Run: `pnpm --filter @pokedrop/web typecheck && npx prettier --write apps/web/components/trades "apps/web/app/(app)/trades" && npx eslint apps/web/components/trades "apps/web/app/(app)/trades" apps/web/lib --max-warnings=0`
Expected: all exit 0.

In the `web` preview, signed in as the test member: `/trades/new` shows *Trade with*, both empty sides and *Review offer* disabled with *Choose who to trade with*; typing `nnn` lists the second member; choosing them, adding a card from each side and pressing *Review offer* shows *You give …* / *… gives you*.

- [ ] **Step 5: Commit**

```bash
cd /m/projects/pokedrop
git add apps/web/components/trades "apps/web/app/(app)/trades/new/page.tsx"
git commit -m "[PD-115]: add the trade composer with a review step and counters

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Measure, document, close

**Files:**
- Create (scratchpad, not committed): `measure-composer.mjs`, on the scratchpad's `cdp.mjs` and `signin.mjs`, as `measure-trades.mjs` does
- Modify: `docs/Pages.md`, `docs/Components.md`
- Linear: PD-115

**Interfaces:**
- Consumes: everything above; the test members `pd102-1791136869104@pokedrop.test` (jar `jar.txt`, *PD102 Tester*, ~5,000 cards, three pending sent trades locking copies) and `n64-1791136966@pokedrop.test` / `aaaaaaaaaaaa` (64 `n`s, 1,000 coins, one *Psychic Energy*).

Each check runs under `next dev` with real key and pointer events; record the numbers; fix what fails (systematic-debugging) and re-run.

- [ ] **Step 1: Checks 1–3 — counterparty, locked copies, self-trade**

1. Keys only: focus *Trade with*, type `nnn`, ArrowDown, Enter → the chip shows the second member; *Change* clears it; searching `PD102` shows *No collectors match*.
2. Open *Add a card you give*, search `Growlithe` (a card all of whose copies are locked by the seed's pending trades, *×n · n locked*): the tile is greyed, `aria-disabled`, *All copies locked in pending trades*, a click adds nothing; a partly locked card's line stops at its available copies (*One more* disabled). Add a card on the get side, then try it on the give side: *Already on …’s side — a card can’t be on both*.
3. `/trades/new?to=IHszA3swNmm048UeG8nEiFj4nbZptmXc` (the caller's own id): the notice *You can’t trade with yourself.*, no counterparty, *Review offer* disabled.

- [ ] **Step 2: Checks 4–6 — pre-fill, review, send and leaving**

4. `/trades/new?to=4tIju4nF89Ka2b28Fn6AiiBo23QU3mVQ&card=base1-4`: the counterparty chip and one *Charizard* on *… gives*.
5. Review texts read from the DOM for: a two-sided trade with coins; a gift (give side only: *Nothing in return — a gift*); a request (get side only: *Nothing — a request*, and the *aren’t checked now* line).
6. With a card on a side, the sidebar's *Inventory* → *Leave this offer?*; *Stay* keeps it. Send the two-sided trade: the toast *Offer sent to …*, `/trades?tab=sent` with the new row first, no dialog on the way; `GET /inventory/owned` shows the offered copies locked.

- [ ] **Step 3: Checks 7–9 — refusal, counter, small screens**

7. Compose an offer with one available copy of a card, then from the page's `fetch` propose another trade locking that copy; *Review offer* is now disabled with *…: no copies available — remove it* and the line marked; for the race, send from the review with the lock made between Review and Send: the notice *Some of your copies were locked…*, back on compose, the draft intact. Cancel the extra trade afterwards.
8. Sign in as the second member (it holds the test member's pending gifts): open `/trades/new?counter=<one of those ids>`: *Counter … offer*, the counterparty fixed (no *Change*), the sides flipped (their *Growlithe* on *… gives you* … check against `GET /trades/:id`); send: the original *Countered*, the new trade pending the other way (`GET /trades?tab=sent` for the second member). `?counter=` on a trade the second member initiated, or an id that does not exist: *You can only counter an open offer made to you.* / *That offer doesn’t exist, or it isn’t yours.*
9. 375 px: `scrollWidth` 375 on compose and review; the whole flow by keyboard (Tab through the picker tiles, Enter to add, *Done*); no console errors. Delete or cancel the trades this run created.

- [ ] **Step 4: Document**

- `docs/Pages.md`: add to the decisions table `| D5 | The trade composer asks for any catalog card (the counterparty's showcase first) — inventories stay private and settlement checks; counterparties come from a member name search, \`GET /users?q=\`; counter-offers use the same composer | PD-115, PD-116 |`; add *Trade composer (PD-115)* after *Trades inbox (PD-114)*: the screen, the pickers, the problems that disable Review, the review texts, the refusals, pre-fill and counter mode, then **Measured 2026-10-0x** with checks 1–9 and **Traps** (a send leaves through `leaveTo`, never `router.push`, or the guard's sentinel is popped under it; `?counter=` ignores `?to=` and `?card=`).
- `docs/Components.md`: `TradeOfferPanel`'s `onCountChange`, `max` and `problem`; `CounterpartyPicker`; `CardPickerDialog`; `useUnsavedChanges` returning `leaveTo`.

- [ ] **Step 5: Commit the docs and close**

```bash
cd /m/projects/pokedrop
git add docs/Pages.md docs/Components.md
git commit -m "[PD-115]: document the trade composer and what it measured

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Set PD-115 to *Done* in Linear with each acceptance criterion ticked, after the final review and its fixes.
