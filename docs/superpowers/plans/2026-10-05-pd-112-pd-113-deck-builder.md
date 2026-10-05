# PD-112 + PD-113 Deck Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/decks/:id` — the owner's deck builder (a searchable pool, the decklist, live legality and stats, drag and drop with a full keyboard path, explicit save with a leave guard) and the read-only public deck page for everyone else.

**Architecture:** The API's pure `validateDeck` and `toDeckStats` move to `@pokedrop/shared`, so the browser runs the server's own validator over a Zustand draft on every change. Deck and inventory payloads gain `legalities` (through a new `PlayableCardSchema`) and `DeckDetail` gains `rules.deckSize`. The builder is a client tree under `components/decks/builder/`: a header, a virtualized pool reusing PD-107's collection pieces, the decklist of `DeckSlot`s, the checks column (`DeckValidationBanner` plus lazy Recharts stats), and a `@dnd-kit/core` context with announcements.

**Tech Stack:** Next 16.3, React 19.2, TanStack Query 5 / Virtual 3, Zustand 5, `@dnd-kit/core` (new), `recharts` (new), NestJS + Prisma (API), Zod 4 (shared).

**Spec:** `docs/superpowers/specs/2026-10-05-pd-112-pd-113-deck-builder-design.md`

## Global Constraints

- No automated tests in v1. Each task's gate is the type check and lint of what it touched; behaviour is measured in a browser (Task 8) and, for the API, with `curl` (Task 1).
  - shared: `pnpm --filter @pokedrop/shared build` (also how `apps/api` and `apps/web` see shared changes)
  - api: `pnpm --filter @pokedrop/api typecheck` and `npx eslint apps/api/src/decks apps/api/src/inventory apps/api/src/common`
  - web: `pnpm --filter @pokedrop/web typecheck` and `npx eslint <touched folders under apps/web> --max-warnings=0`
- No hex colors and no arbitrary spacing lengths in `apps/web` class strings (lint); inline `style` values are fine. Arbitrary font sizes (`text-[11px]`) are already used and allowed.
- Commits on `dev`, header `[PD-112]: …` or `[PD-113]: …` (≤ 72 characters), body ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Comments only where they carry a reason; rationale goes to `docs/`.
- Code, commits and docs in English.
- Request bounds (shared): `MAX_DECK_ENTRIES = 100` distinct cards, `MAX_DECK_CARD_COUNT = 100` copies of one card, `DECK_NAME_MAX = 64`. `DECK_MAX_COPIES = 4`. Deck size comes from `DeckDetail.rules.deckSize` (env `DECK_SIZE`, default 60), never a constant in the web app.
- Breakpoints: drag and drop and the three-column layout from `(min-width: 1024px)`; three columns from `(min-width: 1280px)`, two from 1024 px; tabs below 1024 px.
- Pointer drag activates after 6 px of movement.
- The draft store is seeded once per deck id; only a save (`reset`) or leaving replaces it. Never key it by `updatedAt`.
- Shared changes need `pnpm --filter @pokedrop/shared build` before the API or the web app sees them. The API runs as the `api` preview (`nest start --watch`), the web app as the `web` preview (`next dev`).

## Review Focus

1. **Flipping *Public* with unsaved changes**: the `updateDeck` mutation invalidates the `decks` root, so `GET /decks/:id` refetches; the draft must survive untouched. Pinned in Task 4 (the provider takes the first answer only; `isPublic` read from the live query) and measured in Task 8, check 6.
2. **Back with a dirty draft, then *Stay*, then *Save***: the page stays with the draft intact, and after the save one Back leaves (the sentinel entry is removed). Pinned in Task 2 (`useUnsavedChanges`) and measured in Task 8, check 6.
3. **Another printing of the same name** (`Charizard` from two sets): *+ Add*, the stepper and a drop all count them together, and basic energy is exempt. Pinned in Task 2 (`addRefusal` over `copiesAllowed`) and measured in Task 8, check 2.
4. **A card added from *All cards* before its owned count is known**: no flash of *not owned*; the ownership verdict settles when the count arrives. Pinned in Task 2 (`useDeckChecks` counts an unknown card as available until answered) and measured in Task 8, check 4.
5. **A save that fails** (offline or 5xx): the draft, the dirty state and the leave guard all stay; *Save* is enabled again. Pinned in Task 4 (`submit`'s catch keeps the store) and measured in Task 8, check 7.

---

## File structure

| File | Responsibility |
| --- | --- |
| `packages/shared/src/decks/validate.ts` | `validateDeck` (moved from the API) |
| `packages/shared/src/decks/stats.ts` | `toDeckStats` (moved from the API) |
| `packages/shared/src/entities/inventory.ts` | `PlayableCardSchema`; inventory entries carry it |
| `packages/shared/src/entities/deck.ts` | deck entries carry `PlayableCardSchema`; `DeckDetail.rules` |
| `apps/api/src/common/card-summary.ts` | `PLAYABLE_CARD_SELECT`, `toPlayableCard`, `toLegalities` |
| `apps/api/src/decks/*.ts`, `apps/api/src/inventory/inventory.service.ts` | wire the moved functions and the new fields |
| `apps/web/lib/api/endpoints/decks.ts`, `lib/query/{keys,invalidation,decks}.ts` | `deck(id)`, `useDeck`, `useSaveDeck` |
| `apps/web/lib/stores/deck-draft.ts` | the draft: name, format, `ownedOnly`, cards, card data, availability, last server verdict |
| `apps/web/lib/use-unsaved-changes.ts` | the leave guard: unload, links, Back |
| `apps/web/lib/use-media-query.ts` | `useMediaQuery` |
| `apps/web/lib/toast.ts` | `toastError` |
| `apps/web/components/decks/deck-rules.ts` | `copiesAllowed` (existing), `addRefusal`, `slotMax`, `saveBlocker` |
| `apps/web/components/decks/deck-format.ts` | `FORMAT_LABELS`, `formatLabel` (moved from the decks list) |
| `apps/web/components/decks/deck-groups.ts` | `groupBySupertype` |
| `apps/web/components/decks/deck-slot.tsx` | `readOnly`, `ref`, `handle` |
| `apps/web/components/decks/deck-page.tsx` | owner → builder, anyone else → public view; 404 |
| `apps/web/components/decks/public-deck.tsx` | the read-only deck |
| `apps/web/components/decks/stats/deck-stats.tsx`, `deck-stats-charts.tsx` | the lazy stats panel |
| `apps/web/components/decks/builder/use-deck-checks.ts` | availability, live validation, stats |
| `apps/web/components/decks/builder/deck-builder.tsx` | layout, save, Ctrl+S, leave dialog, gone dialog |
| `apps/web/components/decks/builder/builder-header.tsx` | name, format, mode, verdict, Public, Save |
| `apps/web/components/decks/builder/deck-list.tsx` | the editable decklist |
| `apps/web/components/decks/builder/deck-checks.tsx` | the banner and the stats in the builder |
| `apps/web/components/decks/builder/card-pool.tsx`, `pool-tile.tsx` | the pool |
| `apps/web/components/decks/builder/builder-dnd.tsx` | `BuilderDnd`, `DropZone`, drag data, announcements |
| `apps/web/components/collection/virtual-card-grid.tsx`, `layout-metrics.ts` | `scrollElement`, `useOffsetWithin` |
| `apps/web/app/(public)/decks/[id]/page.tsx` | the route and its metadata |

---

### Task 1: The validator and stats in shared; legalities and deck size on the wire

**Files:**
- Move: `apps/api/src/decks/deck-validator.ts` → `packages/shared/src/decks/validate.ts`
- Move: `apps/api/src/decks/deck-stats.ts` → `packages/shared/src/decks/stats.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/entities/inventory.ts`, `packages/shared/src/entities/deck.ts`
- Modify: `apps/api/src/common/card-summary.ts`, `apps/api/src/decks/deck-validation.service.ts`, `apps/api/src/decks/decks.service.ts`, `apps/api/src/inventory/inventory.service.ts`
- Modify: `docs/API.md`

**Interfaces:**
- Produces (shared): `validateDeck(input: ValidationInput): DeckValidation`; `type ValidationCard = { cardId: string; count: number; name: string; supertype: string; subtypes: string[]; legalities: Legalities }`; `type ValidationInput = { format: string; ownedOnly: boolean; deckSize: number; cards: ValidationCard[]; available: ReadonlyMap<string, number> }`; `toDeckStats(rows: StatsRow[]): DeckStats`; `type StatsRow = { supertype: string; rarity: string | null; types: string[]; count: number }`; `PlayableCardSchema` / `type PlayableCard` (= `InventoryCard` + `legalities: Legalities`); `InventoryEntry.card: PlayableCard`; `DeckEntry.card: PlayableCard`; `DeckDetail.rules: { deckSize: number }` (so `DeckSaveResult.rules` too).
- Produces (api): `PLAYABLE_CARD_SELECT`, `toPlayableCard(row)`, `toLegalities(value: Prisma.JsonValue): Legalities` in `common/card-summary.ts`.
- `InventoryCardSchema` itself stays as it is: it is also the card of pack openings, pack history, trades and profile showcases. `PlayableCardSchema` puts `legalities` only on inventory entries and deck entries, the builder's two sources.

- [ ] **Step 1: Record the verdicts before the move**

The move must not change a single verdict. With the API running and the cookie jar from earlier sessions (`$S` is the scratchpad, `C:/Users/MaxSt/AppData/Local/Temp/claude/M--projects-pokedrop/8d10f40f-9e44-417a-989f-5dca9039d88f/scratchpad`):

```bash
S="C:/Users/MaxSt/AppData/Local/Temp/claude/M--projects-pokedrop/8d10f40f-9e44-417a-989f-5dca9039d88f/scratchpad"
A="http://localhost:4000/api/v1"
H="Origin: http://localhost:3000"
curl -s -b "$S/jar.txt" -H "$H" "$A/decks" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).items.map(d=>d.id).join(' ')))" > "$S/deck-ids.txt"
cat "$S/deck-ids.txt"
for id in $(cat "$S/deck-ids.txt"); do
  curl -s -b "$S/jar.txt" -H "$H" -X POST "$A/decks/$id/validate" > "$S/before-validate-$id.json"
  curl -s -b "$S/jar.txt" -H "$H" "$A/decks/$id/stats" > "$S/before-stats-$id.json"
done
ls "$S"/before-*
```

Expected: two deck ids (*Unfinished*, *Base Sixty*); four JSON files, each non-empty. If the jar has expired (a 401), sign in again with the scratchpad's `signin.mjs` (`withJar`) for `pd102-1791136869104@pokedrop.test` and rerun.

- [ ] **Step 2: Move the two files into shared**

```bash
cd /m/projects/pokedrop
mkdir -p packages/shared/src/decks
git mv apps/api/src/decks/deck-validator.ts packages/shared/src/decks/validate.ts
git mv apps/api/src/decks/deck-stats.ts packages/shared/src/decks/stats.ts
```

In `packages/shared/src/decks/validate.ts`, replace the import block (the first 11 lines, `import { baseCardName, … } from '@pokedrop/shared';`) with:

```ts
import type { Legalities } from '../entities/card.js';
import {
  baseCardName,
  copyLimitKey,
  DECK_MAX_COPIES,
  DECK_RULES,
  DeckValidationSchema,
  type DeckIssueCode,
  type DeckRule,
  type DeckValidation,
} from '../entities/deck.js';
```

In `packages/shared/src/decks/stats.ts`, replace its import block (`import { DECK_SUPERTYPES, … } from '@pokedrop/shared';`) with:

```ts
import {
  DECK_SUPERTYPES,
  DeckStatsSchema,
  type ChartDatum,
  type DeckStats,
} from '../entities/deck.js';
```

Append to `packages/shared/src/index.ts`:

```ts

export * from './decks/validate.js';
export * from './decks/stats.js';
```

- [ ] **Step 3: `PlayableCardSchema` and the deck size in shared**

In `packages/shared/src/entities/inventory.ts`, extend the import from `./card.js` with `LegalitiesSchema`, and directly after `export type InventoryCard = …;` add:

```ts

/** The card summary plus legalities: what the deck validator reads about a card. */
export const PlayableCardSchema = InventoryCardSchema.extend({ legalities: LegalitiesSchema });
export type PlayableCard = z.infer<typeof PlayableCardSchema>;
```

and change `InventoryEntrySchema`'s `card: InventoryCardSchema,` to `card: PlayableCardSchema,`.

In `packages/shared/src/entities/deck.ts`: change the import `import { InventoryCardSchema } from './inventory.js';` to `import { PlayableCardSchema } from './inventory.js';`; in `DeckEntrySchema` change `card: InventoryCardSchema,` to `card: PlayableCardSchema,`; and replace `DeckDetailSchema` with:

```ts
export const DeckDetailSchema = DeckSchema.extend({
  ownerDisplayName: z.string(),
  cards: z.array(DeckEntrySchema),
  /** Configuration the builder reads instead of copying it: the deck size is `DECK_SIZE`. */
  rules: z.object({ deckSize: z.number().int().min(1) }),
});
```

Run: `pnpm --filter @pokedrop/shared build`
Expected: exits 0; `packages/shared/dist/decks/validate.js` and `stats.js` exist.

- [ ] **Step 4: The API's card helpers**

Append to `apps/api/src/common/card-summary.ts` (and add `import { LegalitiesSchema, type Legalities } from '@pokedrop/shared';` at the top):

```ts

/** The summary plus legalities, for the deck builder: decklists and inventory entries. */
export const PLAYABLE_CARD_SELECT = {
  ...CARD_SUMMARY_SELECT,
  legalities: true,
} satisfies Prisma.CardSelect;

export type PlayableCardRow = Prisma.CardGetPayload<{ select: typeof PLAYABLE_CARD_SELECT }>;

export function toPlayableCard(row: PlayableCardRow): Record<string, unknown> {
  return { ...toCardSummary(row), legalities: toLegalities(row.legalities) };
}

/** A malformed column reads as "no legality recorded", which the validator warns about. */
export function toLegalities(value: Prisma.JsonValue): Legalities {
  const parsed = LegalitiesSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}
```

- [ ] **Step 5: Wire the decks module**

`apps/api/src/decks/deck-validation.service.ts`:
- replace `import { LegalitiesSchema, type DeckValidation, type Legalities } from '@pokedrop/shared';` with `import { validateDeck, type DeckValidation } from '@pokedrop/shared';`
- delete `import { validateDeck } from './deck-validator.js';` and `import type { Prisma } from '@prisma/client';`
- add `import { toLegalities } from '../common/card-summary.js';`
- delete the local `function toLegalities(…) { … }` at the end of the file.

`apps/api/src/decks/decks.service.ts`:
- change `import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';` to `import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';`
- add `toDeckStats` and `type StatsRow` to the `@pokedrop/shared` import, and delete `import { toDeckStats, type StatsRow } from './deck-stats.js';`
- change `import { CARD_SUMMARY_SELECT, toCardSummary } from '../common/card-summary.js';` to `import { PLAYABLE_CARD_SELECT, toPlayableCard } from '../common/card-summary.js';`
- add `import { APP_CONFIG, type AppConfig } from '../config/index.js';`
- in `DETAIL_SELECT`, change `card: { select: CARD_SUMMARY_SELECT }` to `card: { select: PLAYABLE_CARD_SELECT }`
- the constructor becomes:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: DeckValidationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
```

- `toDetail` becomes:

```ts
function toDetail({ user, ...row }: DetailRow, deckSize: number): DeckDetail {
  return DeckDetailSchema.parse({
    ...row,
    ownerDisplayName: user.displayName,
    cards: row.cards.map((entry) => ({
      cardId: entry.cardId,
      count: entry.count,
      card: toPlayableCard(entry.card),
    })),
    rules: { deckSize },
  });
}
```

- every call `toDetail(row)` (in `saveResult` and `get`) becomes `toDetail(row, this.config.decks.size)`.

Run: `grep -rn "deck-validator\|deck-stats\|toDetail(row)" apps/api/src`
Expected: no output.

- [ ] **Step 6: Inventory entries carry legalities**

In `apps/api/src/inventory/inventory.service.ts`: add `legalities: true,` as the last field of `ENTRY_SELECT.card.select`; add `import { toLegalities } from '../common/card-summary.js';`; in `toEntry`, the `card` object becomes:

```ts
    card: {
      ...row.card,
      latestPriceUsd: toNumber(row.card.latestPriceUsd),
      latestPriceEur: toNumber(row.card.latestPriceEur),
      legalities: toLegalities(row.card.legalities),
    },
```

Run: `pnpm --filter @pokedrop/api typecheck && npx eslint apps/api/src/decks apps/api/src/inventory apps/api/src/common --max-warnings=0`
Expected: both exit 0.

- [ ] **Step 7: Same verdicts, new fields**

The `api` preview recompiles on change; wait for `preview_logs` to show `Nest application successfully started` after the edits (restart the preview if it does not). Then:

```bash
S="C:/Users/MaxSt/AppData/Local/Temp/claude/M--projects-pokedrop/8d10f40f-9e44-417a-989f-5dca9039d88f/scratchpad"
A="http://localhost:4000/api/v1"
H="Origin: http://localhost:3000"
for id in $(cat "$S/deck-ids.txt"); do
  curl -s -b "$S/jar.txt" -H "$H" -X POST "$A/decks/$id/validate" | diff - "$S/before-validate-$id.json" && echo "validate $id same"
  curl -s -b "$S/jar.txt" -H "$H" "$A/decks/$id/stats" | diff - "$S/before-stats-$id.json" && echo "stats $id same"
  curl -s -b "$S/jar.txt" -H "$H" "$A/decks/$id" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);console.log(d.name,'rules',JSON.stringify(d.rules),'legalities',JSON.stringify(d.cards[0]?.card.legalities))})"
done
curl -s -b "$S/jar.txt" -H "$H" "$A/inventory?pageSize=1" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('inventory legalities',JSON.stringify(JSON.parse(s).items[0].card.legalities)))"
curl -s -b "$S/jar.txt" -H "$H" "$A/packs/history?pageSize=1" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const c=JSON.parse(s).items[0]?.cards?.[0]?.card;console.log('history card has legalities:', c ? 'legalities' in c : 'no history')})"
```

Expected: `validate <id> same` and `stats <id> same` for both decks; each deck prints `rules {"deckSize":60}` and a legalities object such as `{"unlimited":"Legal"}`; the inventory line prints a legalities object; the history line prints `false` (or `no history`).

- [ ] **Step 8: Document the fields**

In `docs/API.md`, *Decks* section: add to the description of `GET /decks/:id` (and the save results that share its shape) that each entry's `card` carries `legalities` (the card's format legality map, as on `GET /cards/:id`) and that the deck carries `rules: { deckSize }`, the configured deck size, so a client validating a draft reads it rather than assuming 60. *Inventory* section: each entry's `card` carries `legalities`. Add one sentence under *Decks*: *`validateDeck` and `toDeckStats` live in `@pokedrop/shared`; the deck builder runs the same validator on its draft (D4 in `docs/Pages.md`).*

- [ ] **Step 9: Commit**

```bash
cd /m/projects/pokedrop
git add packages/shared/src apps/api/src docs/API.md
git commit -m "[PD-113]: share the deck validator and send what it reads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The web data layer — queries, the draft store, rules, checks and the leave guard

**Files:**
- Modify: `apps/web/package.json` (via pnpm)
- Modify: `apps/web/lib/api/endpoints/decks.ts`, `apps/web/lib/query/keys.ts`, `apps/web/lib/query/invalidation.ts`, `apps/web/lib/query/decks.ts`, `apps/web/lib/toast.ts`
- Rewrite: `apps/web/lib/stores/deck-draft.ts`, `apps/web/lib/use-unsaved-changes.ts`
- Create: `apps/web/lib/use-media-query.ts`, `apps/web/components/decks/builder/use-deck-checks.ts`
- Modify: `apps/web/components/decks/deck-rules.ts`

**Interfaces:**
- Consumes: Task 1's `PlayableCard`, `DeckDetail` (with `rules`), `validateDeck`, `toDeckStats`.
- Produces:
  - `deck(id: string)` endpoint; `keys.decks.detail(id: string)` = `['decks', 'detail', id]`; `keys.inventory.ownedAll` = `['inventory', 'owned']`; `mutationKeys.saveDeck`; `useDeck(id: string)`; `useSaveDeck(id: string)` whose `mutationFn` takes `DeckDraftBody = { name: string; format: DeckFormat; ownedOnly: boolean; cards: DeckCardInput[] }` and resolves to `DeckSaveResult`.
  - `toastError(message: string): void`.
  - `type DeckDraft = { name: string; format: DeckFormat; ownedOnly: boolean; cards: DeckCardInput[] }`; `DeckDraftProvider` (props `{ deck: DeckDetail }`); `useDeckDraft(selector)`; store fields `saved`, `draft`, `cardsById: Record<string, PlayableCard>`, `available: Record<string, number>`, `verdict: DeckValidation | null`; actions `add(card: PlayableCard, available?: number)`, `remove(cardId)`, `setCount(cardId, count)`, `setName(name)`, `setFormat(format)`, `setOwnedOnly(ownedOnly)`, `learnAvailable(counts: Record<string, number>)`, `reset(deck: DeckDetail, verdict?: DeckValidation)`; `isDirty(state)`; `countIn(cards, cardId): number`.
  - `addRefusal(card: RuleCard, cards: DeckCardInput[], cardsById: Record<string, RuleCard>): string | null`; `slotMax(card: RuleCard, cards: DeckCardInput[], cardsById: Record<string, RuleCard>): number`; `saveBlocker(draft: DeckDraft, dirty: boolean): string | null`; constant `NO_CHANGES = 'No changes to save'`.
  - `useDeckChecks(deckSize: number): { validation: DeckValidation; stats: DeckStats; checkingCopies: boolean }`.
  - `useMediaQuery(query: string): boolean`.
  - `useUnsavedChanges(dirty: boolean, onAttempt: (leave: () => void) => void): void`.

- [ ] **Step 1: Dependencies**

Run: `pnpm --filter @pokedrop/web add @dnd-kit/core recharts`
Expected: `apps/web/package.json` gains `@dnd-kit/core` and `recharts`; the lockfile updates.

- [ ] **Step 2: Endpoint, keys, invalidation, toast**

`apps/web/lib/api/endpoints/decks.ts`: add `DeckDetailSchema` to the `@pokedrop/shared` import and add:

```ts
/** Public decks for anyone; a private one only for its owner (otherwise 404). */
export const deck = (id: string) => get(`/decks/${id}`, DeckDetailSchema);
```

`apps/web/lib/query/keys.ts`: in `inventory`, after `owned: …`, add `ownedAll: ['inventory', 'owned'],`; `decks` becomes:

```ts
  decks: {
    all: ['decks'],
    mine: ['decks', 'mine'],
    detail: (id: string) => ['decks', 'detail', id],
  },
```

`apps/web/lib/query/invalidation.ts`: add `saveDeck: ['saveDeck'],` to `mutationKeys` and to `INVALIDATES`:

```ts
  // A save's verdict counts the owner's copies; the builder's counts follow it.
  saveDeck: [keys.decks.all, keys.inventory.ownedAll],
```

`apps/web/lib/toast.ts`, after `toastApiError`:

```ts
export function toastError(message: string): void {
  toast.error(message);
}
```

- [ ] **Step 3: `useDeck` and `useSaveDeck`**

Replace the imports of `apps/web/lib/query/decks.ts` and append the two hooks:

```ts
import type { CreateDeck, DeckCardInput, DeckFormat, UpdateDeck } from '@pokedrop/shared';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/core';
import {
  cloneDeck,
  createDeck,
  deck,
  deleteDeck,
  myDecks,
  updateDeck,
} from '@/lib/api/endpoints/decks';
import { mutationKeys } from './invalidation';
import { keys } from './keys';
```

```ts
export function useDeck(id: string) {
  return useQuery({
    queryKey: keys.decks.detail(id),
    queryFn: () => api.call(deck(id)),
    // A 404 is an answer (gone, or someone's private deck), not a failure to retry.
    retry: (failures, error) =>
      !(error instanceof ApiError && error.statusCode === 404) && failures < 2,
  });
}

export type DeckDraftBody = {
  name: string;
  format: DeckFormat;
  ownedOnly: boolean;
  cards: DeckCardInput[];
};

export function useSaveDeck(id: string) {
  return useMutation({
    mutationKey: mutationKeys.saveDeck,
    mutationFn: (body: DeckDraftBody) => api.call(updateDeck(id, body)),
    meta: { toast: false },
  });
}
```

- [ ] **Step 4: The draft store**

Replace `apps/web/lib/stores/deck-draft.ts`:

```ts
import {
  type DeckCardInput,
  type DeckDetail,
  type DeckFormat,
  DeckFormatSchema,
  type DeckValidation,
  type PlayableCard,
} from '@pokedrop/shared';
import { createStore } from 'zustand/vanilla';
import { createStoreContext } from './context';

// The deck being edited, before it is saved: the one place a card list is held outside
// TanStack Query. Seeded once from the server's copy; later refetches of that copy (the
// Public switch invalidates every deck query) never touch it. Only a save replaces it.
export type DeckDraft = {
  name: string;
  format: DeckFormat;
  ownedOnly: boolean;
  cards: DeckCardInput[];
};

export interface DeckDraftStore {
  saved: DeckDraft;
  draft: DeckDraft;
  /** What the validator, the rows and the charts read about each card in the draft. */
  cardsById: Record<string, PlayableCard>;
  /** Available copies per card id; an absent id is not known yet. */
  available: Record<string, number>;
  /** The server's verdict from the last save, shown until the next change. */
  verdict: DeckValidation | null;
  add: (card: PlayableCard, available?: number) => void;
  remove: (cardId: string) => void;
  setCount: (cardId: string, count: number) => void;
  setName: (name: string) => void;
  setFormat: (format: DeckFormat) => void;
  setOwnedOnly: (ownedOnly: boolean) => void;
  learnAvailable: (counts: Record<string, number>) => void;
  reset: (deck: DeckDetail, verdict?: DeckValidation) => void;
}

export function countIn(cards: DeckCardInput[], cardId: string): number {
  return cards.find((card) => card.cardId === cardId)?.count ?? 0;
}

function withCount(cards: DeckCardInput[], cardId: string, count: number): DeckCardInput[] {
  if (count < 1) return cards.filter((card) => card.cardId !== cardId);
  return cards.some((card) => card.cardId === cardId)
    ? cards.map((card) => (card.cardId === cardId ? { cardId, count } : card))
    : [...cards, { cardId, count }];
}

function draftOf(deck: DeckDetail): DeckDraft {
  const format = DeckFormatSchema.safeParse(deck.format);
  return {
    name: deck.name,
    format: format.success ? format.data : 'standard',
    ownedOnly: deck.ownedOnly,
    cards: deck.cards.map(({ cardId, count }) => ({ cardId, count })),
  };
}

function cardsOf(deck: DeckDetail): Record<string, PlayableCard> {
  return Object.fromEntries(deck.cards.map((entry) => [entry.cardId, entry.card]));
}

export function isDirty({ saved, draft }: Pick<DeckDraftStore, 'saved' | 'draft'>): boolean {
  if (
    saved.name !== draft.name ||
    saved.format !== draft.format ||
    saved.ownedOnly !== draft.ownedOnly ||
    saved.cards.length !== draft.cards.length
  ) {
    return true;
  }
  return draft.cards.some((card) => countIn(saved.cards, card.cardId) !== card.count);
}

export const [DeckDraftProvider, useDeckDraft] = createStoreContext(
  'useDeckDraft',
  ({ deck }: { deck: DeckDetail }) =>
    createStore<DeckDraftStore>()((set) => {
      const edit = (change: (draft: DeckDraft) => Partial<DeckDraft>) =>
        set((s) => ({ draft: { ...s.draft, ...change(s.draft) }, verdict: null }));
      return {
        saved: draftOf(deck),
        draft: draftOf(deck),
        cardsById: cardsOf(deck),
        available: {},
        verdict: null,
        add: (card, available) =>
          set((s) => ({
            draft: {
              ...s.draft,
              cards: withCount(s.draft.cards, card.id, countIn(s.draft.cards, card.id) + 1),
            },
            cardsById: card.id in s.cardsById ? s.cardsById : { ...s.cardsById, [card.id]: card },
            available:
              available === undefined || card.id in s.available
                ? s.available
                : { ...s.available, [card.id]: available },
            verdict: null,
          })),
        remove: (cardId) =>
          edit((d) => ({ cards: withCount(d.cards, cardId, countIn(d.cards, cardId) - 1) })),
        setCount: (cardId, count) => edit((d) => ({ cards: withCount(d.cards, cardId, count) })),
        setName: (name) => edit(() => ({ name })),
        setFormat: (format) => edit(() => ({ format })),
        setOwnedOnly: (ownedOnly) => edit(() => ({ ownedOnly })),
        learnAvailable: (counts) => set((s) => ({ available: { ...s.available, ...counts } })),
        reset: (next, verdict) =>
          set({
            saved: draftOf(next),
            draft: draftOf(next),
            cardsById: cardsOf(next),
            available: {},
            verdict: verdict ?? null,
          }),
      };
    }),
);
```

- [ ] **Step 5: The rules the builder enforces before the validator does**

Replace `apps/web/components/decks/deck-rules.ts`:

```ts
import {
  baseCardName,
  copyLimitKey,
  DECK_MAX_COPIES,
  DECK_NAME_MAX,
  type DeckCardInput,
  MAX_DECK_CARD_COUNT,
  MAX_DECK_ENTRIES,
} from '@pokedrop/shared';
import type { DeckDraft } from '@/lib/stores/deck-draft';

type RuleCard = { id: string; name: string; supertype: string; subtypes: readonly string[] };

export const NO_CHANGES = 'No changes to save';

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

function entriesOf(cards: DeckCardInput[], cardsById: Record<string, RuleCard>) {
  return cards.flatMap((entry) => {
    const card = cardsById[entry.cardId];
    return card ? [{ card, count: entry.count }] : [];
  });
}

/** The stepper's ceiling for a decklist row: the copy limit, or the request bound for energy. */
export function slotMax(
  card: RuleCard,
  cards: DeckCardInput[],
  cardsById: Record<string, RuleCard>,
): number {
  return Math.min(copiesAllowed(card, entriesOf(cards, cardsById)), MAX_DECK_CARD_COUNT);
}

/** Why one more copy of `card` cannot go in, or null. *+ Add* and a drop both ask. */
export function addRefusal(
  card: RuleCard,
  cards: DeckCardInput[],
  cardsById: Record<string, RuleCard>,
): string | null {
  const count = cards.find((entry) => entry.cardId === card.id)?.count ?? 0;
  if (count === 0 && cards.length >= MAX_DECK_ENTRIES) {
    return `A deck holds at most ${MAX_DECK_ENTRIES} different cards`;
  }
  if (count >= MAX_DECK_CARD_COUNT) return `At most ${MAX_DECK_CARD_COUNT} copies of one card`;
  if (count >= copiesAllowed(card, entriesOf(cards, cardsById))) {
    return `${baseCardName(card.name)} is at the ${DECK_MAX_COPIES}-copy limit`;
  }
  return null;
}

/** What keeps Save disabled: only what the API would refuse with a 400 (D4), or no change. */
export function saveBlocker(draft: DeckDraft, dirty: boolean): string | null {
  if (!dirty) return NO_CHANGES;
  const name = draft.name.trim();
  if (name === '') return 'Name the deck';
  if (name.length > DECK_NAME_MAX) return `Use at most ${DECK_NAME_MAX} characters`;
  if (draft.cards.length > MAX_DECK_ENTRIES) {
    return `A deck holds at most ${MAX_DECK_ENTRIES} different cards`;
  }
  return null;
}
```

- [ ] **Step 6: Live checks**

Create `apps/web/components/decks/builder/use-deck-checks.ts`:

```ts
'use client';

import { type DeckStats, type DeckValidation, toDeckStats, validateDeck } from '@pokedrop/shared';
import { useEffect, useMemo } from 'react';
import { useOwnedCounts } from '@/lib/query/inventory';
import { useDeckDraft } from '@/lib/stores/deck-draft';

/**
 * The server's own validator over the draft, on every change. A card whose available copies
 * are not known yet counts as available, so nothing reads "not owned" before the count
 * arrives; `checkingCopies` says the ownership verdict is still settling.
 */
export function useDeckChecks(deckSize: number): {
  validation: DeckValidation;
  stats: DeckStats;
  checkingCopies: boolean;
} {
  const draft = useDeckDraft((s) => s.draft);
  const cardsById = useDeckDraft((s) => s.cardsById);
  const available = useDeckDraft((s) => s.available);
  const verdict = useDeckDraft((s) => s.verdict);
  const learnAvailable = useDeckDraft((s) => s.learnAvailable);

  const unknown = useMemo(
    () =>
      draft.cards
        .map((card) => card.cardId)
        .filter((id) => !(id in available))
        .sort(),
    [draft.cards, available],
  );
  const { owned, known } = useOwnedCounts(unknown.length > 0 ? [unknown] : [], true);

  useEffect(() => {
    const learned: Record<string, number> = {};
    for (const id of unknown) {
      if (known.has(id)) learned[id] = owned.get(id)?.available ?? 0;
    }
    if (Object.keys(learned).length > 0) learnAvailable(learned);
  }, [unknown, owned, known, learnAvailable]);

  const validation = useMemo(
    () =>
      validateDeck({
        format: draft.format,
        ownedOnly: draft.ownedOnly,
        deckSize,
        cards: draft.cards.flatMap(({ cardId, count }) => {
          const card = cardsById[cardId];
          return card
            ? [
                {
                  cardId,
                  count,
                  name: card.name,
                  supertype: card.supertype,
                  subtypes: card.subtypes,
                  legalities: card.legalities,
                },
              ]
            : [];
        }),
        available: new Map(
          draft.cards.map(({ cardId, count }) => [cardId, available[cardId] ?? count]),
        ),
      }),
    [draft, cardsById, available, deckSize],
  );

  const stats = useMemo(
    () =>
      toDeckStats(
        draft.cards.flatMap(({ cardId, count }) => {
          const card = cardsById[cardId];
          return card
            ? [{ supertype: card.supertype, rarity: card.rarity, types: card.types, count }]
            : [];
        }),
      ),
    [draft.cards, cardsById],
  );

  return { validation: verdict ?? validation, stats, checkingCopies: unknown.length > 0 };
}
```

- [ ] **Step 7: `useMediaQuery`**

Create `apps/web/lib/use-media-query.ts`:

```ts
'use client';

import { useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
```

- [ ] **Step 8: The leave guard**

Replace `apps/web/lib/use-unsaved-changes.ts` (nothing imports it yet: `grep -rn useUnsavedChanges apps/web --include=*.tsx` is empty):

```ts
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

const GUARD = 'pokedropLeaveGuard';

type Leave = () => void;

function onGuardEntry(): boolean {
  return (window.history.state as Record<string, unknown> | null)?.[GUARD] === true;
}

function pushGuard(): void {
  window.history.pushState(
    { ...(window.history.state as object | null), [GUARD]: true },
    '',
    window.location.href,
  );
}

/**
 * While `dirty`, catches what can be caught of leaving the page — the App Router cannot cancel
 * a navigation: closing or reloading the tab (`beforeunload`), a click on a link to another
 * page, and Back, through a sentinel history entry that `popstate` puts back. `onAttempt`
 * decides; calling the `leave` it is given goes on. The sentinel is removed when the page
 * stops being dirty, so one Back leaves after a save.
 */
export function useUnsavedChanges(dirty: boolean, onAttempt: (leave: Leave) => void): void {
  const router = useRouter();
  const attempt = useRef(onAttempt);
  useEffect(() => {
    attempt.current = onAttempt;
  });

  useEffect(() => {
    if (!dirty) return;
    let leaving = false;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!leaving) event.preventDefault();
    };

    const onClick = (event: MouseEvent) => {
      if (leaving || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest('a[href]');
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.download) {
        return;
      }
      const url = new URL(link.href);
      const here = window.location;
      if (url.origin !== here.origin || url.pathname + url.search === here.pathname + here.search) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      attempt.current(() => {
        leaving = true;
        router.push(url.pathname + url.search + url.hash);
      });
    };

    const onPopState = () => {
      if (leaving) return;
      pushGuard();
      attempt.current(() => {
        leaving = true;
        window.history.go(-2);
      });
    };

    if (!onGuardEntry()) pushGuard();
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
      if (!leaving && onGuardEntry()) window.history.back();
    };
  }, [dirty, router]);
}
```

- [ ] **Step 9: Gate and commit**

Run: `pnpm --filter @pokedrop/web typecheck && npx eslint apps/web/lib apps/web/components/decks --max-warnings=0`
Expected: both exit 0. (`DeckSlot` and the gallery still compile: their props are unchanged.)

```bash
cd /m/projects/pokedrop
git add apps/web/package.json pnpm-lock.yaml apps/web/lib apps/web/components/decks
git commit -m "[PD-112]: add the deck draft, live checks and the leave guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The deck page and the public view

**Files:**
- Create: `apps/web/components/decks/deck-format.ts`, `apps/web/components/decks/deck-groups.ts`, `apps/web/components/decks/deck-page.tsx`, `apps/web/components/decks/public-deck.tsx`
- Modify: `apps/web/components/decks/decks-list.tsx` (import `formatLabel`, `FORMAT_LABELS`), `apps/web/components/decks/deck-slot.tsx` (`readOnly`)
- Rewrite: `apps/web/app/(public)/decks/[id]/page.tsx`

**Interfaces:**
- Consumes: `useDeck`, `useCloneDeck`, `useSession`, `ApiError`.
- Produces: `FORMAT_LABELS: Record<DeckFormat, string>`, `formatLabel(format: string): string`; `groupBySupertype<T extends { count: number }>(entries: T[], cardOf: (entry: T) => { name: string; supertype: string }): DeckGroup<T>[]` with `type DeckGroup<T> = { label: string; total: number; entries: T[] }`; `DeckSlot` prop union — `{ readOnly?: false; max: number; onChange: (count: number) => void } | { readOnly: true }`; `DeckPage({ id })`; `PublicDeck({ deck })`; `DeckPageSkeleton`.
- Until Task 4, `DeckPage` shows the public view to every viewer, the owner included.

- [ ] **Step 1: Shared deck helpers**

Create `apps/web/components/decks/deck-format.ts`:

```ts
import type { DeckFormat } from '@pokedrop/shared';

export const FORMAT_LABELS: Record<DeckFormat, string> = {
  standard: 'Standard',
  expanded: 'Expanded',
  unlimited: 'Unlimited',
};

export function formatLabel(format: string): string {
  return format in FORMAT_LABELS ? FORMAT_LABELS[format as DeckFormat] : format;
}
```

In `apps/web/components/decks/decks-list.tsx`, delete the local `FORMAT_LABELS` constant and `formatLabel` function, and add `import { FORMAT_LABELS, formatLabel } from './deck-format';` (drop `type DeckFormat` from the shared import if it becomes unused).

Create `apps/web/components/decks/deck-groups.ts`:

```ts
import { DECK_SUPERTYPES } from '@pokedrop/shared';

export type DeckGroup<T> = { label: string; total: number; entries: T[] };

const byName = new Intl.Collator('en');

/** Pokémon, Trainer, Energy — then anything the mirror calls otherwise — each sorted by name. */
export function groupBySupertype<T extends { count: number }>(
  entries: T[],
  cardOf: (entry: T) => { name: string; supertype: string },
): DeckGroup<T>[] {
  const labels = [
    ...DECK_SUPERTYPES,
    ...new Set(
      entries
        .map((entry) => cardOf(entry).supertype)
        .filter((supertype) => !(DECK_SUPERTYPES as readonly string[]).includes(supertype)),
    ),
  ];
  return labels.flatMap((label) => {
    const own = entries
      .filter((entry) => cardOf(entry).supertype === label)
      .sort((a, b) => byName.compare(cardOf(a).name, cardOf(b).name));
    return own.length === 0
      ? []
      : [{ label, total: own.reduce((sum, entry) => sum + entry.count, 0), entries: own }];
  });
}
```

- [ ] **Step 2: `DeckSlot` `readOnly`**

In `apps/web/components/decks/deck-slot.tsx`, replace the `DeckSlotProps` type and the function's signature line through the destructuring with:

```tsx
type DeckSlotProps = {
  card: CardView;
  count: number;
  /** The card is promised in a pending trade; its count cannot change here. */
  locked?: boolean;
  /** Drag feedback for the builder, which owns the drag itself. */
  dragging?: boolean;
  dropTarget?: boolean;
  className?: string;
} & (
  | { readOnly?: false; max: number; onChange: (count: number) => void }
  | { readOnly: true; max?: never; onChange?: never }
);

export function DeckSlot(props: DeckSlotProps) {
  const { card, count, locked = false, dragging = false, dropTarget = false, className } = props;
```

and replace the `<CopyCountStepper … />` element with:

```tsx
      {props.readOnly ? (
        <span className="font-mono text-mono text-tx">×{count}</span>
      ) : (
        <CopyCountStepper
          count={count}
          max={props.max}
          onChange={props.onChange}
          cardName={card.name}
          disabled={locked}
        />
      )}
```

- [ ] **Step 3: The public view**

Create `apps/web/components/decks/public-deck.tsx`:

```tsx
'use client';

import type { DeckDetail } from '@pokedrop/shared';
import { Copy, LogIn } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cardView } from '@/components/cards/card-data';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useCloneDeck } from '@/lib/query/decks';
import { useSession } from '@/lib/session/context';
import { formatLabel } from './deck-format';
import { groupBySupertype } from './deck-groups';
import { DeckSlot } from './deck-slot';

export function PublicDeck({ deck }: { deck: DeckDetail }) {
  const session = useSession();
  const router = useRouter();
  const clone = useCloneDeck();
  const total = deck.cards.reduce((sum, entry) => sum + entry.count, 0);
  const groups = groupBySupertype(deck.cards, (entry) => entry.card);

  return (
    <>
      <PageHeader
        title={deck.name}
        description={
          <>
            {formatLabel(deck.format)} · {total} {total === 1 ? 'card' : 'cards'} · by{' '}
            <Link
              href={`/profile/${deck.userId}`}
              className="focus-ring rounded-tag text-pri hover:underline"
            >
              {deck.ownerDisplayName}
            </Link>
          </>
        }
        actions={
          session ? (
            <Button
              icon={Copy}
              loading={clone.isPending}
              onClick={() =>
                clone.mutate(deck.id, { onSuccess: (copy) => router.push(`/decks/${copy.id}`) })
              }
            >
              Clone
            </Button>
          ) : (
            <Button asChild variant="secondary" icon={LogIn}>
              <Link href={`/sign-in?next=${encodeURIComponent(`/decks/${deck.id}`)}`}>
                Sign in to clone
              </Link>
            </Button>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Decklist" className="flex flex-col gap-5">
          {groups.length === 0 ? <p className="text-body text-mut">This deck is empty.</p> : null}
          {groups.map((group) => (
            <div key={group.label} className="flex flex-col gap-2">
              <h2 className="flex items-center justify-between text-small font-semibold text-mut">
                {group.label}
                <span className="font-mono">{group.total}</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {group.entries.map((entry) => (
                  <li key={entry.cardId}>
                    <DeckSlot card={cardView(entry.card)} count={entry.count} readOnly />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
```

(Check `PageHeader`'s props: `title`, `description: ReactNode`, `actions`. `Button` with `asChild` and `icon` is used the same way in `app/(public)/layout.tsx`; if `icon` is not rendered with `asChild`, put the icon inside the link instead.)

- [ ] **Step 4: The page component and the route**

Create `apps/web/components/decks/deck-page.tsx`:

```tsx
'use client';

import { notFound } from 'next/navigation';
import { ListError } from '@/components/list-states';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/core';
import { useDeck } from '@/lib/query/decks';
import { PublicDeck } from './public-deck';

export function DeckPageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the deck" className="flex flex-col gap-4">
      <Skeleton shape="block" height="3.5rem" />
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((slot) => (
          <Skeleton key={slot} shape="block" height="24rem" />
        ))}
      </div>
    </div>
  );
}

export function DeckPage({ id }: { id: string }) {
  const deck = useDeck(id);

  if (deck.isPending) return <DeckPageSkeleton />;
  if (deck.isError) {
    if (deck.error instanceof ApiError && deck.error.statusCode === 404) notFound();
    return <ListError error={deck.error} onRetry={() => void deck.refetch()} />;
  }
  return <PublicDeck deck={deck.data} />;
}
```

Replace `apps/web/app/(public)/decks/[id]/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { DeckPage } from '@/components/decks/deck-page';
import { deck } from '@/lib/api/endpoints/decks';
import { serverApi } from '@/lib/api/server';

// The deck's name for anyone who may see it: the API answers a private deck to its owner only.
export async function generateMetadata({ params }: PageProps<'/decks/[id]'>): Promise<Metadata> {
  const { id } = await params;
  try {
    return { title: (await serverApi.call(deck(id))).name };
  } catch {
    return { title: 'Deck' };
  }
}

export default async function Page({ params }: PageProps<'/decks/[id]'>) {
  const { id } = await params;
  return <DeckPage id={id} />;
}
```

(`serverApi` forwards the visitor's cookies, so the owner's own private deck is named in their tab too, and nobody else's private deck can be: the API answers them 404.)

- [ ] **Step 5: Gate and look**

Run: `pnpm --filter @pokedrop/web typecheck && npx eslint "apps/web/components/decks" "apps/web/app/(public)/decks" --max-warnings=0`
Expected: both exit 0.

With the `web` preview: open `/decks/<Base Sixty id>` signed in. Expected: title *Base Sixty · PokéDrop*, header *Unlimited · 60 cards · by …*, groups with read-only rows *×n*. `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/decks/does-not-exist` → `404`.

- [ ] **Step 6: Commit**

```bash
cd /m/projects/pokedrop
git add apps/web/components/decks "apps/web/app/(public)/decks"
git commit -m "[PD-112]: show a deck read-only at its shareable address

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The builder — header, decklist, checks, save and leaving

**Files:**
- Create: `apps/web/components/decks/builder/deck-builder.tsx`, `builder-header.tsx`, `deck-list.tsx`, `deck-checks.tsx`
- Modify: `apps/web/components/decks/deck-page.tsx` (the owner gets the builder)

**Interfaces:**
- Consumes: Task 2's store, `useDeckChecks`, `saveBlocker`, `NO_CHANGES`, `slotMax`, `useSaveDeck`, `useUpdateDeck`, `useUnsavedChanges`, `useMediaQuery`, `toastError`, `toastApiError`, `toastSuccess`; Task 3's `groupBySupertype`, `FORMAT_LABELS`, `DeckSlot`.
- Produces: `DeckBuilder({ deck }: { deck: DeckDetail })` — mounts `DeckDraftProvider` keyed by `deck.id` with the first `deck` it gets, and reads `isPublic` from the prop on every render; `BuilderHeader(props)`; `DeckList()` (Task 6 adds `dragEnabled`); `DeckChecks({ validation, stats, checkingCopies, onSelectCard })`; the pool column takes `pool: ReactNode` from Task 5 (`null` until then); the decklist column has `id="deck-list"` and `tabIndex={-1}` for the skip link. `failingRules(validation: DeckValidation): string` (*2 rules failing*) exported from `builder-header.tsx`.

- [ ] **Step 1: The decklist**

Create `apps/web/components/decks/builder/deck-list.tsx`:

```tsx
'use client';

import { Layers } from 'lucide-react';
import { cardView } from '@/components/cards/card-data';
import { groupBySupertype } from '@/components/decks/deck-groups';
import { slotMax } from '@/components/decks/deck-rules';
import { DeckSlot } from '@/components/decks/deck-slot';
import { useDeckDraft } from '@/lib/stores/deck-draft';

export function DeckList() {
  const cards = useDeckDraft((s) => s.draft.cards);
  const cardsById = useDeckDraft((s) => s.cardsById);
  const setCount = useDeckDraft((s) => s.setCount);
  const entries = cards.flatMap((entry) => {
    const card = cardsById[entry.cardId];
    return card ? [{ ...entry, card }] : [];
  });
  const groups = groupBySupertype(entries, (entry) => entry.card);
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="flex items-center justify-between text-h3">
        Decklist
        <span className="font-mono text-small text-mut">
          {total} {total === 1 ? 'card' : 'cards'}
        </span>
      </h2>
      {groups.length === 0 ? (
        <p className="flex flex-col items-center gap-2 rounded-card border border-dashed border-bd-2 p-6 text-center text-small text-mut">
          <Layers aria-hidden className="size-5" />
          Drag cards here or press + Add
        </p>
      ) : null}
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-2">
          <h3 className="flex items-center justify-between text-small font-semibold text-mut">
            {group.label}
            <span className="font-mono">{group.total}</span>
          </h3>
          <ul className="flex flex-col gap-2">
            {group.entries.map((entry) => (
              <li key={entry.cardId}>
                <DeckSlot
                  card={cardView(entry.card)}
                  count={entry.count}
                  max={slotMax(entry.card, cards, cardsById)}
                  onChange={(count) => setCount(entry.cardId, count)}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

(Task 6 replaces `DeckSlot` here with a draggable row and adds the `dragEnabled` prop.)

- [ ] **Step 2: The checks column**

Create `apps/web/components/decks/builder/deck-checks.tsx`:

```tsx
'use client';

import type { DeckStats, DeckValidation } from '@pokedrop/shared';
import { DeckValidationBanner } from '@/components/decks/deck-validation-banner';
import { Spinner } from '@/components/ui/spinner';
import { useDeckDraft } from '@/lib/stores/deck-draft';

export function DeckChecks({
  validation,
  stats,
  checkingCopies,
  onSelectCard,
}: {
  validation: DeckValidation;
  stats: DeckStats;
  checkingCopies: boolean;
  onSelectCard: (cardId: string) => void;
}) {
  const cardsById = useDeckDraft((s) => s.cardsById);
  const names = Object.fromEntries(Object.values(cardsById).map((card) => [card.id, card.name]));

  return (
    <div id="deck-checks" tabIndex={-1} className="flex flex-col gap-4 outline-none">
      <DeckValidationBanner
        validation={validation}
        cardNames={names}
        onSelectCard={onSelectCard}
      />
      {checkingCopies ? (
        <p role="status" className="flex items-center gap-2 text-small text-mut">
          <Spinner size={14} /> Checking your copies…
        </p>
      ) : null}
      <p className="sr-only">{stats.totalCards} cards in the draft.</p>
    </div>
  );
}
```

(Task 7 replaces the `sr-only` line with the stats panel.)

- [ ] **Step 3: The header**

Create `apps/web/components/decks/builder/builder-header.tsx`:

```tsx
'use client';

import {
  DECK_FORMATS,
  DECK_NAME_MAX,
  type DeckDetail,
  type DeckFormat,
  type DeckValidation,
} from '@pokedrop/shared';
import { ArrowLeft, CircleCheck, Save, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useId } from 'react';
import { FORMAT_LABELS } from '@/components/decks/deck-format';
import { NO_CHANGES } from '@/components/decks/deck-rules';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { useUpdateDeck } from '@/lib/query/decks';
import { useDeckDraft } from '@/lib/stores/deck-draft';
import { cn } from '@/lib/utils';

const MODES = [
  { ownedOnly: true, label: 'Owned only' },
  { ownedOnly: false, label: 'Theorycraft' },
] as const;

export function failingRules(validation: DeckValidation): string {
  const failing = validation.rules.filter((rule) => !rule.ok).length;
  return `${failing} ${failing === 1 ? 'rule' : 'rules'} failing`;
}

export function BuilderHeader({
  deck,
  validation,
  dirty,
  saving,
  blocker,
  onSave,
  onShowChecks,
}: {
  deck: DeckDetail;
  validation: DeckValidation;
  dirty: boolean;
  saving: boolean;
  blocker: string | null;
  onSave: () => void;
  onShowChecks: () => void;
}) {
  const draft = useDeckDraft((s) => s.draft);
  const setName = useDeckDraft((s) => s.setName);
  const setFormat = useDeckDraft((s) => s.setFormat);
  const setOwnedOnly = useDeckDraft((s) => s.setOwnedOnly);
  const update = useUpdateDeck();
  const statusId = useId();
  const { actual, expected } = validation.deckSize;

  const status =
    blocker !== null && blocker !== NO_CHANGES
      ? blocker
      : saving
        ? 'Saving…'
        : dirty
          ? 'Unsaved changes'
          : 'Saved';

  return (
    <header className="flex flex-wrap items-center gap-3 rounded-card border border-bd bg-surface p-3">
      <Button asChild variant="ghost" size="sm" icon={ArrowLeft}>
        <Link href="/decks">Decks</Link>
      </Button>
      <input
        aria-label="Deck name"
        value={draft.name}
        maxLength={DECK_NAME_MAX}
        onChange={(event) => setName(event.target.value)}
        className="focus-ring h-10 min-w-40 flex-1 rounded-control border border-bd-2 bg-bg px-3 text-h3 font-semibold text-tx"
      />
      <select
        aria-label="Format"
        value={draft.format}
        onChange={(event) => setFormat(event.target.value as DeckFormat)}
        className="focus-ring h-10 rounded-control border border-bd-2 bg-bg px-3 text-body text-tx"
      >
        {DECK_FORMATS.map((format) => (
          <option key={format} value={format}>
            {FORMAT_LABELS[format]}
          </option>
        ))}
      </select>
      <div
        role="group"
        aria-label="Cards allowed"
        className="flex rounded-control border border-bd-2 p-0.5"
      >
        {MODES.map((mode) => (
          <button
            key={mode.label}
            type="button"
            aria-pressed={draft.ownedOnly === mode.ownedOnly}
            onClick={() => setOwnedOnly(mode.ownedOnly)}
            className={cn(
              'focus-ring h-8 cursor-pointer rounded-tag px-3 text-small font-medium text-mut transition',
              draft.ownedOnly === mode.ownedOnly && 'bg-pri-dim font-semibold text-pri',
            )}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onShowChecks}
        aria-label={`${actual} of ${expected} cards, ${validation.valid ? 'legal' : failingRules(validation)}. Show the checks`}
        className="focus-ring cursor-pointer rounded-pill"
      >
        <Badge
          live
          tone={validation.valid ? 'success' : 'warning'}
          icon={validation.valid ? CircleCheck : TriangleAlert}
          label={`${actual}/${expected} · ${validation.valid ? 'Legal' : failingRules(validation)}`}
        />
      </button>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        <Toggle
          label="Public"
          checked={deck.isPublic}
          disabled={update.isPending}
          onCheckedChange={(isPublic) => update.mutate({ id: deck.id, patch: { isPublic } })}
        />
        <span id={statusId} aria-live="polite" className="text-small text-mut">
          {status}
        </span>
        <Button
          icon={Save}
          loading={saving}
          disabled={blocker !== null}
          aria-describedby={statusId}
          onClick={onSave}
        >
          Save
        </Button>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: The builder**

Create `apps/web/components/decks/builder/deck-builder.tsx`:

```tsx
'use client';

import type { DeckDetail } from '@pokedrop/shared';
import { useQueryClient } from '@tanstack/react-query';
import { TriangleAlert, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { focusDeckSlot } from '@/components/decks/deck-slot';
import { saveBlocker } from '@/components/decks/deck-rules';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Tabs, TabsPanel } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api/core';
import { useSaveDeck } from '@/lib/query/decks';
import { keys } from '@/lib/query/keys';
import { DeckDraftProvider, isDirty, useDeckDraft } from '@/lib/stores/deck-draft';
import { toastApiError, toastError, toastSuccess } from '@/lib/toast';
import { useMediaQuery } from '@/lib/use-media-query';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { BuilderHeader, failingRules } from './builder-header';
import { DeckChecks } from './deck-checks';
import { DeckList } from './deck-list';
import { useDeckChecks } from './use-deck-checks';

type Tab = 'pool' | 'deck' | 'check';

// Below the 60 px topbar and the main element's 2 × 32 px padding.
const BUILDER_HEIGHT = 'calc(100dvh - 3.75rem - 4rem)';

export function DeckBuilder({ deck }: { deck: DeckDetail }) {
  return (
    <DeckDraftProvider key={deck.id} deck={deck}>
      <Builder deck={deck} />
    </DeckDraftProvider>
  );
}

function Builder({ deck }: { deck: DeckDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const wide = useMediaQuery('(min-width: 1024px)');
  const widest = useMediaQuery('(min-width: 1280px)');
  const [tab, setTab] = useState<Tab>('deck');
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const [gone, setGone] = useState(false);

  const draft = useDeckDraft((s) => s.draft);
  const dirty = useDeckDraft(isDirty);
  const reset = useDeckDraft((s) => s.reset);
  const { validation, stats, checkingCopies } = useDeckChecks(deck.rules.deckSize);
  const save = useSaveDeck(deck.id);
  const blocker = saveBlocker(draft, dirty);
  const total = draft.cards.reduce((sum, card) => sum + card.count, 0);

  useUnsavedChanges(dirty && !gone, (leave) => setPendingLeave(() => leave));

  async function submit(thenLeave?: () => void) {
    if (blocker !== null || save.isPending) return;
    try {
      const result = await save.mutateAsync({
        name: draft.name.trim(),
        format: draft.format,
        ownedOnly: draft.ownedOnly,
        cards: draft.cards,
      });
      queryClient.setQueryData(keys.decks.detail(deck.id), result);
      if (thenLeave) {
        thenLeave();
        return;
      }
      reset(result, result.validation);
      toastSuccess(
        result.validation.valid
          ? 'Saved'
          : `Saved — not legal yet: ${failingRules(result.validation)}`,
      );
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) setGone(true);
      else if (error instanceof ApiError && error.statusCode === 400) toastApiError(error);
      else toastError('Couldn’t save — your changes are still here');
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 's' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void submit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const selectCard = (cardId: string) => {
    if (wide) {
      focusDeckSlot(cardId);
      return;
    }
    setTab('deck');
    requestAnimationFrame(() => requestAnimationFrame(() => focusDeckSlot(cardId)));
  };

  const showChecks = () => {
    if (!wide) setTab('check');
    requestAnimationFrame(() => document.getElementById('deck-checks')?.focus());
  };

  const pool: ReactNode = null;
  const list = (
    <div id="deck-list" tabIndex={-1} className="outline-none">
      <DeckList />
    </div>
  );
  const checks = (
    <DeckChecks
      validation={validation}
      stats={stats}
      checkingCopies={checkingCopies}
      onSelectCard={selectCard}
    />
  );
  const column = 'min-h-0 overflow-y-auto rounded-card border border-bd bg-surface p-4';

  return (
    <div className="flex flex-col gap-4" style={wide ? { height: BUILDER_HEIGHT } : undefined}>
      <BuilderHeader
        deck={deck}
        validation={validation}
        dirty={dirty}
        saving={save.isPending}
        blocker={blocker}
        onSave={() => void submit()}
        onShowChecks={showChecks}
      />
      {wide ? (
        <div
          className="grid min-h-0 flex-1 gap-4"
          style={{
            gridTemplateColumns: widest
              ? 'minmax(0, 1fr) 22.5rem 20rem'
              : 'minmax(0, 1fr) 22.5rem',
          }}
        >
          <section aria-label="Card pool" className={column}>
            {pool}
          </section>
          {widest ? (
            <>
              <section aria-label="Deck" className={column}>
                {list}
              </section>
              <section aria-label="Checks" className={column}>
                {checks}
              </section>
            </>
          ) : (
            <section aria-label="Deck and checks" className={`${column} flex flex-col gap-6`}>
              {list}
              {checks}
            </section>
          )}
        </div>
      ) : (
        <Tabs
          label="Deck builder"
          value={tab}
          onValueChange={setTab}
          tabs={[
            { value: 'pool', label: 'Pool' },
            { value: 'deck', label: 'Deck', count: total },
            { value: 'check', label: 'Check' },
          ]}
        >
          <TabsPanel value="pool">{pool}</TabsPanel>
          <TabsPanel value="deck">{list}</TabsPanel>
          <TabsPanel value="check">{checks}</TabsPanel>
        </Tabs>
      )}

      <Dialog
        open={pendingLeave !== null}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setPendingLeave(null);
        }}
        tone="danger"
        icon={TriangleAlert}
        title="Leave without saving?"
        description="Your changes to this deck are not saved."
      >
        <div className="flex flex-col gap-2.5">
          <Button variant="secondary" onClick={() => setPendingLeave(null)}>
            Stay
          </Button>
          <Button
            loading={save.isPending}
            disabled={blocker !== null}
            onClick={() => {
              const leave = pendingLeave;
              if (leave) void submit(leave);
            }}
          >
            Save and leave
          </Button>
          <Button
            variant="destructive"
            icon={Trash2}
            disabled={save.isPending}
            onClick={() => {
              const leave = pendingLeave;
              setPendingLeave(null);
              leave?.();
            }}
          >
            Discard changes
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={gone}
        onOpenChange={() => {}}
        tone="danger"
        icon={TriangleAlert}
        title="This deck no longer exists"
        description="It was deleted, perhaps in another tab, so these changes cannot be saved."
        confirmLabel="Back to decks"
        onConfirm={() => router.push('/decks')}
      />
    </div>
  );
}
```

- [ ] **Step 5: Route the owner to the builder**

In `apps/web/components/decks/deck-page.tsx`: add `import { useSession } from '@/lib/session/context';` and `import { DeckBuilder } from './builder/deck-builder';`; add `const session = useSession();` as the first line of `DeckPage`; and replace the final `return <PublicDeck deck={deck.data} />;` with:

```tsx
  return deck.data.userId === session?.id ? (
    <DeckBuilder deck={deck.data} />
  ) : (
    <PublicDeck deck={deck.data} />
  );
```

- [ ] **Step 6: Gate and look**

Run: `pnpm --filter @pokedrop/web typecheck && npx eslint apps/web/components/decks --max-warnings=0`
Expected: both exit 0.

In the `web` preview, signed in as the test user, open *Base Sixty*: three columns at ≥ 1280 px (an empty pool column), the header shows *60/60 · Legal*, *Saved*, Save disabled. Press − on any row: *59/60 · 1 rule failing*, *Unsaved changes*, Save enabled; flip *Public*: the row still shows the lowered count. Save: toast *Saved — not legal yet: 1 rule failing*; reload: 59 cards. Raise it back and save: *Saved*.

- [ ] **Step 7: Commit**

```bash
cd /m/projects/pokedrop
git add apps/web/components/decks
git commit -m "[PD-112]: add the deck builder's header, decklist, checks and save

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The card pool

**Files:**
- Modify: `apps/web/components/collection/layout-metrics.ts` (`useOffsetWithin`), `apps/web/components/collection/virtual-card-grid.tsx` (`scrollElement`)
- Create: `apps/web/components/decks/builder/pool-tile.tsx`, `apps/web/components/decks/builder/card-pool.tsx`
- Modify: `apps/web/components/decks/builder/deck-builder.tsx` (the pool column)

**Interfaces:**
- Consumes: `useInventory`, `useCatalogBrowse`, `useCatalogFacets`, `useOwnedCounts`, `type Owned`, `collectionView`, `FilterBar`, `SearchInput`, `addRefusal`, `countIn`, `useDeckDraft`.
- Produces: `VirtualCardGrid` optional prop `scrollElement?: HTMLElement | null` (absent or null: the window scrolls, as before); `useOffsetWithin(ref, scroller: HTMLElement): number`; `PoolTile` (memo) with props `{ card: PlayableCard; owned?: Owned; inDeck: number; refusal: string | null; onAdd: (card: PlayableCard, available?: number) => void; draggable: boolean }`; `CardPool({ scrollElement, dragEnabled }: { scrollElement: HTMLElement | null; dragEnabled: boolean })`. `draggable` is unused until Task 6.

- [ ] **Step 1: `useOffsetWithin`**

Append to `apps/web/components/collection/layout-metrics.ts`:

```ts

/** The element's distance from the top of a scrolling ancestor's content; scrolling leaves it alone. */
export function useOffsetWithin(ref: RefObject<HTMLElement | null>, scroller: HTMLElement): number {
  return useSyncExternalStore(
    subscribeToLayout,
    () => {
      const element = ref.current;
      if (!element) return 0;
      const top = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      return Math.round(top + scroller.scrollTop);
    },
    () => 0,
  );
}
```

- [ ] **Step 2: `VirtualCardGrid` inside a scrolling element**

Replace `apps/web/components/collection/virtual-card-grid.tsx`:

```tsx
'use client';

import { useVirtualizer, useWindowVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { type ReactNode, type RefObject, useEffect, useRef } from 'react';
import { useDocumentTop, useElementWidth, useOffsetWithin } from './layout-metrics';

const GAP = 16;
// A tile is 5:7 art over a 37 px footer.
const FOOTER = 37;

type GridProps<T> = {
  items: T[];
  getKey: (item: T) => string;
  renderTile: (item: T) => ReactNode;
  label: string;
  minTileWidth?: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  /** Virtualize inside this scrolling element instead of the window (the deck builder's pool). */
  scrollElement?: HTMLElement | null;
};

type Layout = { columns: number; tileWidth: number; rowCount: number };

// What the row renderer needs from either virtualizer.
type Rows = {
  getVirtualItems: () => VirtualItem[];
  getTotalSize: () => number;
  measure: () => void;
  measureElement: (element: Element | null) => void;
  options: { scrollMargin: number };
};

function useLayout(container: RefObject<HTMLDivElement | null>, minTileWidth: number, count: number): Layout {
  const width = useElementWidth(container);
  const columns = Math.max(1, Math.floor((width + GAP) / (minTileWidth + GAP)));
  const tileWidth = width > 0 ? (width - GAP * (columns - 1)) / columns : minTileWidth;
  return { columns, tileWidth, rowCount: Math.ceil(count / columns) };
}

const rowSize = (layout: Layout) => (layout.tileWidth * 7) / 5 + FOOTER + GAP;

export function VirtualCardGrid<T>(props: GridProps<T>) {
  return props.scrollElement ? (
    <ElementGrid {...props} scroller={props.scrollElement} />
  ) : (
    <WindowGrid {...props} />
  );
}

function WindowGrid<T>(props: GridProps<T>) {
  const container = useRef<HTMLDivElement>(null);
  const layout = useLayout(container, props.minTileWidth ?? 150, props.items.length);
  const top = useDocumentTop(container);
  const virtualizer = useWindowVirtualizer({
    count: layout.rowCount,
    estimateSize: () => rowSize(layout),
    overscan: 3,
    scrollMargin: top,
  });
  return <GridRows {...props} container={container} layout={layout} rows={virtualizer} />;
}

function ElementGrid<T>(props: GridProps<T> & { scroller: HTMLElement }) {
  const container = useRef<HTMLDivElement>(null);
  const layout = useLayout(container, props.minTileWidth ?? 150, props.items.length);
  const top = useOffsetWithin(container, props.scroller);
  const virtualizer = useVirtualizer({
    count: layout.rowCount,
    getScrollElement: () => props.scroller,
    estimateSize: () => rowSize(layout),
    overscan: 3,
    scrollMargin: top,
  });
  return <GridRows {...props} container={container} layout={layout} rows={virtualizer} />;
}

function GridRows<T>({
  items,
  getKey,
  renderTile,
  label,
  hasMore,
  loadingMore,
  onLoadMore,
  container,
  layout,
  rows: virtualizer,
}: GridProps<T> & { container: RefObject<HTMLDivElement | null>; layout: Layout; rows: Rows }) {
  const { columns, rowCount } = layout;
  const rows = virtualizer.getVirtualItems();
  const lastRendered = rows.at(-1)?.index ?? -1;

  useEffect(() => {
    if (hasMore && !loadingMore && rowCount > 0 && lastRendered >= rowCount - 3) onLoadMore();
  }, [hasMore, loadingMore, rowCount, lastRendered, onLoadMore]);

  // The column count changes the rows' heights: measure them again.
  useEffect(() => {
    virtualizer.measure();
  }, [columns, virtualizer]);

  const margin = virtualizer.options.scrollMargin;

  return (
    <div
      ref={container}
      role="list"
      aria-label={label}
      className="relative w-full"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {rows.map((row) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={virtualizer.measureElement}
          className="absolute inset-x-0 top-0 grid"
          style={{
            transform: `translateY(${row.start - margin}px)`,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gap: GAP,
            paddingBottom: GAP,
          }}
        >
          {items.slice(row.index * columns, row.index * columns + columns).map((item) => (
            <div key={getKey(item)} role="listitem">
              {renderTile(item)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

Run: `pnpm --filter @pokedrop/web typecheck`
Expected: exits 0. If TypeScript refuses a virtualizer as `Rows` (the `measureElement` parameter type), type `Rows.measureElement` as `(element: HTMLDivElement | null) => void`.

- [ ] **Step 3: The pool tile**

Create `apps/web/components/decks/builder/pool-tile.tsx`:

```tsx
'use client';

import type { PlayableCard } from '@pokedrop/shared';
import { Plus } from 'lucide-react';
import { memo, useId, useState } from 'react';
import { CardArt } from '@/components/cards/card-art';
import { cardView, setNumber } from '@/components/cards/card-data';
import type { Owned } from '@/lib/query/inventory';
import { cn } from '@/lib/utils';

type PoolTileProps = {
  card: PlayableCard;
  /** The member's copies; absent while unknown. */
  owned?: Owned;
  inDeck: number;
  /** Why *+ Add* refuses, from `addRefusal`; null when it may add. */
  refusal: string | null;
  onAdd: (card: PlayableCard, available?: number) => void;
  /** The art is a drag handle (from 1024 px). */
  draggable: boolean;
};

function ownedText(owned: Owned): string {
  if (owned.quantity === 0) return 'Not owned';
  const locked = owned.quantity - owned.available;
  return locked > 0 ? `×${owned.quantity} · ${locked} locked` : `×${owned.quantity}`;
}

function PoolTileImpl({ card, owned, inDeck, refusal, onAdd }: PoolTileProps) {
  const reasonId = useId();
  const [refused, setRefused] = useState(false);

  return (
    <div className="flex flex-col overflow-hidden rounded-tile border border-bd bg-surface">
      <div className="relative aspect-[5/7]">
        <CardArt card={cardView(card)} sizes="140px" />
        {inDeck > 0 ? (
          <span className="absolute top-2 left-2 rounded-tag bg-pri-strong px-1.5 py-0.5 font-mono text-[10px] leading-4 font-semibold text-on-pri">
            In deck ×{inDeck}
          </span>
        ) : null}
        {owned ? (
          <span className="absolute top-2 right-2 rounded-tag bg-black/50 px-1.5 py-0.5 font-mono text-[10px] leading-4 font-semibold text-white">
            {ownedText(owned)}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5 border-t border-bd px-2.5 py-2">
        <span className="truncate text-small font-semibold text-tx" title={card.name}>
          {card.name}
        </span>
        <button
          type="button"
          aria-label={`Add ${card.name} (${setNumber(card.id)}) to the deck`}
          aria-disabled={refusal !== null || undefined}
          aria-describedby={refusal !== null ? reasonId : undefined}
          onClick={() => {
            if (refusal !== null) {
              setRefused(true);
              return;
            }
            setRefused(false);
            onAdd(card, owned?.available);
          }}
          className="focus-ring inline-flex h-7 cursor-pointer items-center justify-center gap-1 rounded-tag border border-bd-2 bg-surface-2 text-small font-semibold text-tx transition hover:bg-elev aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          <Plus aria-hidden className="size-3.5" />
          Add
        </button>
        {refusal !== null ? (
          <p
            id={reasonId}
            role={refused ? 'alert' : undefined}
            className={cn('text-[11px] leading-4', refused ? 'text-gold' : 'text-faint')}
          >
            {refusal}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// The pool renders dozens of these; a draft change must re-render only the tiles it touches.
export const PoolTile = memo(PoolTileImpl);
```

- [ ] **Step 4: The pool**

Create `apps/web/components/decks/builder/card-pool.tsx`:

```tsx
'use client';

import type { Card, PlayableCard } from '@pokedrop/shared';
import { Droplet, Grid3x3, PackageOpen, SearchX, Star } from 'lucide-react';
import { type ReactNode, useCallback, useState } from 'react';
import { VirtualCardGrid } from '@/components/collection/virtual-card-grid';
import { addRefusal } from '@/components/decks/deck-rules';
import { ListError } from '@/components/list-states';
import { EmptyState } from '@/components/ui/empty-state';
import { type FilterDef, FilterBar } from '@/components/ui/filter-bar';
import { SearchInput } from '@/components/ui/search-input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { collectionView } from '@/lib/name-match';
import { useCatalogBrowse, useCatalogFacets } from '@/lib/query/catalog';
import { type Owned, useInventory, useOwnedCounts } from '@/lib/query/inventory';
import { countIn, useDeckDraft } from '@/lib/stores/deck-draft';
import { cn } from '@/lib/utils';
import { PoolTile } from './pool-tile';

type Source = 'mine' | 'all';
type PoolFilters = { q?: string; set?: string; rarity?: string; type?: string };
type RenderTile = (card: PlayableCard, owned: Owned | undefined) => ReactNode;

const SOURCES: { value: Source; label: string }[] = [
  { value: 'mine', label: 'My cards' },
  { value: 'all', label: 'All cards' },
];

function sameBesidesQ(a: PoolFilters, b: PoolFilters): boolean {
  return a.set === b.set && a.rarity === b.rarity && a.type === b.type;
}

function playable(card: Card): PlayableCard {
  const { id, setId, name, supertype, subtypes, types, hp, rarity, imageSmall } = card;
  const { latestPriceUsd, latestPriceEur, priceUpdatedAt, legalities } = card;
  return {
    ...{ id, setId, name, supertype, subtypes, types, hp, rarity, imageSmall },
    ...{ latestPriceUsd, latestPriceEur, priceUpdatedAt, legalities },
  };
}

type Answer = {
  pending: boolean;
  error: unknown;
  hasData: boolean;
  total: number;
  current: boolean;
  stale: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  retry: () => void;
};

function PoolResults<T>({
  answer,
  items,
  getKey,
  render,
  scrollElement,
  empty,
}: {
  answer: Answer;
  items: T[];
  getKey: (item: T) => string;
  render: (item: T) => ReactNode;
  scrollElement: HTMLElement | null;
  empty: ReactNode;
}) {
  if (answer.pending) {
    return (
      <div aria-busy="true" aria-label="Loading cards" className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {Array.from({ length: 6 }, (_, slot) => (
          <Skeleton key={slot} shape="block" className="aspect-[5/8]" />
        ))}
      </div>
    );
  }
  if (answer.error && !answer.hasData) return <ListError error={answer.error} onRetry={answer.retry} />;
  if (answer.total === 0 && !answer.current) {
    return (
      <p role="status" aria-busy="true" className="flex items-center justify-center gap-2 py-12 text-small text-mut">
        <Spinner size={16} /> Searching…
      </p>
    );
  }
  if (answer.total === 0) return empty;
  return (
    <div aria-busy={answer.stale || undefined} className={cn('transition-opacity', answer.stale && 'opacity-50')}>
      <VirtualCardGrid
        items={items}
        getKey={getKey}
        renderTile={render}
        label="Card pool"
        minTileWidth={130}
        hasMore={answer.current && answer.hasMore}
        loadingMore={answer.loadingMore}
        onLoadMore={answer.loadMore}
        scrollElement={scrollElement}
      />
    </div>
  );
}

function MinePool({
  filters,
  typed,
  renderTile,
  scrollElement,
  empty,
}: {
  filters: PoolFilters;
  typed: string;
  renderTile: RenderTile;
  scrollElement: HTMLElement | null;
  empty: (filtered: boolean) => ReactNode;
}) {
  const list = useInventory(filters);
  const pages = list.data?.pages ?? [];
  const answered = pages[0]?.answeredFor;
  const view = collectionView({
    items: pages.flatMap((page) => page.items),
    nameOf: (entry) => entry.card.name,
    typed,
    answeredQ: answered?.q ?? '',
    otherFiltersMatch: answered === undefined || sameBesidesQ(answered, filters),
    placeholder: list.isPlaceholderData,
  });
  const loadMore = () => {
    if (list.hasNextPage && !list.isFetchingNextPage && !list.isFetchNextPageError) {
      void list.fetchNextPage();
    }
  };
  return (
    <PoolResults
      answer={{
        pending: list.isPending,
        error: list.error,
        hasData: list.data !== undefined,
        total: pages[0]?.total ?? 0,
        current: view.current,
        stale: view.stale,
        hasMore: list.hasNextPage,
        loadingMore: list.isFetchingNextPage,
        loadMore,
        retry: () => void list.refetch(),
      }}
      items={view.items}
      getKey={(entry) => entry.id}
      render={(entry) =>
        renderTile(entry.card, { quantity: entry.quantity, available: entry.availableQuantity })
      }
      scrollElement={scrollElement}
      empty={empty(Boolean(filters.q || filters.set || filters.rarity || filters.type))}
    />
  );
}

function AllPool({
  filters,
  typed,
  renderTile,
  scrollElement,
  empty,
}: {
  filters: PoolFilters;
  typed: string;
  renderTile: RenderTile;
  scrollElement: HTMLElement | null;
  empty: (filtered: boolean) => ReactNode;
}) {
  const list = useCatalogBrowse(filters);
  const pages = list.data?.pages ?? [];
  const answered = pages[0]?.answeredFor;
  const view = collectionView({
    items: pages.flatMap((page) => page.items),
    nameOf: (card) => card.name,
    typed,
    answeredQ: answered?.q ?? '',
    otherFiltersMatch: answered === undefined || sameBesidesQ(answered, filters),
    placeholder: list.isPlaceholderData,
  });
  const { owned, known } = useOwnedCounts(
    pages.map((page) => page.items.map((card) => card.id)),
    true,
  );
  const loadMore = () => {
    if (list.hasNextPage && !list.isFetchingNextPage && !list.isFetchNextPageError) {
      void list.fetchNextPage();
    }
  };
  return (
    <PoolResults
      answer={{
        pending: list.isPending,
        error: list.error,
        hasData: list.data !== undefined,
        total: pages[0]?.total ?? 0,
        current: view.current,
        stale: view.stale,
        hasMore: list.hasNextPage,
        loadingMore: list.isFetchingNextPage,
        loadMore,
        retry: () => void list.refetch(),
      }}
      items={view.items}
      getKey={(card) => card.id}
      render={(card) =>
        renderTile(
          playable(card),
          known.has(card.id) ? (owned.get(card.id) ?? { quantity: 0, available: 0 }) : undefined,
        )
      }
      scrollElement={scrollElement}
      empty={empty(true)}
    />
  );
}

export function CardPool({
  scrollElement,
  dragEnabled,
}: {
  scrollElement: HTMLElement | null;
  dragEnabled: boolean;
}) {
  const [source, setSource] = useState<Source>('mine');
  const [filters, setFilters] = useState<PoolFilters>({});
  const [typed, setTyped] = useState('');
  const [said, setSaid] = useState('');
  const facets = useCatalogFacets();
  const cards = useDeckDraft((s) => s.draft.cards);
  const cardsById = useDeckDraft((s) => s.cardsById);
  const add = useDeckDraft((s) => s.add);

  const onAdd = useCallback(
    (card: PlayableCard, available?: number) => {
      add(card, available);
      setSaid(`Added ${card.name}`);
    },
    [add],
  );

  const renderTile: RenderTile = (card, owned) => (
    <PoolTile
      card={card}
      owned={owned}
      inDeck={countIn(cards, card.id)}
      refusal={addRefusal(card, cards, cardsById)}
      onAdd={onAdd}
      draggable={dragEnabled}
    />
  );

  const clear = () => {
    setFilters({});
    setTyped('');
  };
  const empty = (filtered: boolean) =>
    filtered ? (
      <EmptyState
        icon={SearchX}
        tone="neutral"
        title="No cards match"
        body="Try another name, set, rarity or type."
        cta={{ label: 'Clear filters', onClick: clear }}
      />
    ) : (
      <EmptyState
        icon={PackageOpen}
        title="No cards of your own yet"
        body="Build from every card in the catalog instead, as a theorycraft deck."
        cta={{ label: 'Show all cards', onClick: () => setSource('all') }}
      />
    );

  const filterDefs: FilterDef[] = [
    { key: 'set', label: 'Set', icon: Grid3x3, kind: 'select', options: facets.data?.sets, error: facets.isError },
    { key: 'rarity', label: 'Rarity', icon: Star, kind: 'select', options: facets.data?.rarities, error: facets.isError },
    { key: 'type', label: 'Type', icon: Droplet, kind: 'select', options: facets.data?.types, error: facets.isError },
  ];
  const props = { filters, typed, renderTile, scrollElement, empty };

  return (
    <div className="flex flex-col gap-4">
      <a
        href="#deck-list"
        className="focus-ring sr-only rounded-control bg-pri-strong px-3 py-1.5 text-small text-on-pri focus:not-sr-only focus:self-start"
      >
        Skip to deck
      </a>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-h3">Card pool</h2>
        <div role="group" aria-label="Cards to show" className="flex rounded-control border border-bd-2 p-0.5">
          {SOURCES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={source === option.value}
              onClick={() => setSource(option.value)}
              className={cn(
                'focus-ring h-8 cursor-pointer rounded-tag px-3 text-small font-medium text-mut transition',
                source === option.value && 'bg-pri-dim font-semibold text-pri',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <FilterBar
        filters={filterDefs}
        value={filters}
        onChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
        search={
          <SearchInput
            value={filters.q ?? ''}
            onSearch={(q) => setFilters((current) => ({ ...current, q: q || undefined }))}
            onInput={setTyped}
            label="Search the pool"
            placeholder="Search pool…"
            maxLength={100}
          />
        }
      />
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
      {source === 'mine' ? <MinePool {...props} /> : <AllPool {...props} />}
    </div>
  );
}
```

(Prettier will reflow the long `filterDefs` lines on commit.)

- [ ] **Step 5: Mount the pool**

In `apps/web/components/decks/builder/deck-builder.tsx`: add `import { CardPool } from './card-pool';`; add `const [poolElement, setPoolElement] = useState<HTMLElement | null>(null);` after the `gone` state; replace `const pool: ReactNode = null;` with:

```tsx
  const pool: ReactNode = (
    <CardPool scrollElement={wide ? poolElement : null} dragEnabled={wide} />
  );
```

and give the wide layout's pool section the ref: `<section aria-label="Card pool" ref={setPoolElement} className={column}>`.

- [ ] **Step 6: Gate and look**

Run: `pnpm --filter @pokedrop/web typecheck && npx eslint apps/web/components/decks apps/web/components/collection --max-warnings=0`
Expected: both exit 0.

In the preview: the pool lists *My cards* (the test user has 5,000) in the left column, scrolling inside it and loading more near its end; *+ Add* on a card puts it in the decklist and shows *In deck ×1*; on a 4th copy *+ Add* turns faint with *… is at the 4-copy limit*; *All cards* shows owned badges; `/inventory` and `/cards` still scroll with the window as before.

- [ ] **Step 7: Commit**

```bash
cd /m/projects/pokedrop
git add apps/web/components/decks apps/web/components/collection
git commit -m "[PD-112]: add the builder's card pool with tap-to-add

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Drag and drop with announcements

**Files:**
- Create: `apps/web/components/decks/builder/builder-dnd.tsx`
- Modify: `apps/web/components/decks/deck-slot.tsx` (`ref`, `handle`), `apps/web/components/decks/builder/pool-tile.tsx` (draggable art), `apps/web/components/decks/builder/deck-list.tsx` (draggable rows), `apps/web/components/decks/builder/deck-builder.tsx` (context and drop zones)

**Interfaces:**
- Consumes: `addRefusal`, `countIn`, `useDeckDraft`, `cardView`, `CardArt`.
- Produces: `POOL_ZONE = 'pool'`, `DECK_ZONE = 'deck'`; `type DragData = { from: 'pool' | 'deck'; card: PlayableCard; available?: number }`; `BuilderDnd({ enabled, children })` (renders children alone when `enabled` is false); `DropZone({ id, label, className, onElement, children })` — a `<section>` that is a droppable; `DeckSlot` props `ref?: Ref<HTMLDivElement>` and `handle?: HTMLAttributes<HTMLDivElement> & { ref?: (element: HTMLElement | null) => void }`; `DeckList({ dragEnabled }: { dragEnabled: boolean })`.

- [ ] **Step 1: The dnd context**

Create `apps/web/components/decks/builder/builder-dnd.tsx`:

```tsx
'use client';

import {
  type Active,
  type Announcements,
  type CollisionDetection,
  DndContext,
  DragOverlay,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { PlayableCard } from '@pokedrop/shared';
import { type ReactNode, useState } from 'react';
import { CardArt } from '@/components/cards/card-art';
import { cardView } from '@/components/cards/card-data';
import { addRefusal } from '@/components/decks/deck-rules';
import { countIn, useDeckDraft } from '@/lib/stores/deck-draft';
import { cn } from '@/lib/utils';

export const POOL_ZONE = 'pool';
export const DECK_ZONE = 'deck';
type Zone = typeof POOL_ZONE | typeof DECK_ZONE;

export type DragData = { from: Zone; card: PlayableCard; available?: number };

const ZONE_NAMES: Record<Zone, string> = { pool: 'the pool', deck: 'the deck' };

const INSTRUCTIONS =
  'To pick up a card, press Space or Enter. Use the left and right arrow keys to move between the pool and the deck. Press Space or Enter again to drop it, or Escape to cancel.';

const dataOf = (active: Active) => active.data.current as DragData;

const copies = (n: number) => `${n} ${n === 1 ? 'copy' : 'copies'}`;

// The keyboard moves a card between the two zones only: right to the deck, left to the pool.
const jumpBetweenZones: KeyboardCoordinateGetter = (event, { context }) => {
  if (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft') return undefined;
  event.preventDefault();
  const rect = context.droppableRects.get(event.code === 'ArrowRight' ? DECK_ZONE : POOL_ZONE);
  return rect ? { x: rect.left + 16, y: rect.top + 16 } : undefined;
};

const collision: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args);

export function BuilderDnd({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const cards = useDeckDraft((s) => s.draft.cards);
  const cardsById = useDeckDraft((s) => s.cardsById);
  const add = useDeckDraft((s) => s.add);
  const remove = useDeckDraft((s) => s.remove);
  const [active, setActive] = useState<DragData | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: jumpBetweenZones }),
  );

  // What a drop does, in words and in deed; the announcement and the handler share it.
  const outcome = (data: DragData, over: string | null) => {
    const { name, id } = data.card;
    const count = countIn(cards, id);
    if (data.from === POOL_ZONE && over === DECK_ZONE) {
      const refusal = addRefusal(data.card, cards, cardsById);
      return refusal
        ? { act: null, text: `${refusal}; nothing added` }
        : { act: 'add' as const, text: `Added ${name} — ${copies(count + 1)} in the deck` };
    }
    if (data.from === DECK_ZONE && over === POOL_ZONE) {
      return {
        act: 'remove' as const,
        text:
          count <= 1
            ? `Removed ${name} from the deck`
            : `Removed a copy of ${name} — ${count - 1} left`,
      };
    }
    return { act: null, text: `${name} is back where it was; the deck is unchanged` };
  };

  const announcements: Announcements = {
    onDragStart: ({ active: dragged }) => {
      const data = dataOf(dragged);
      const way = data.from === POOL_ZONE ? 'right to move it to the deck' : 'left to move it to the pool';
      return `Picked up ${data.card.name} from ${ZONE_NAMES[data.from]}. Arrow ${way}, Space to drop, Escape to cancel.`;
    },
    onDragOver: ({ over }) => (over ? `Over ${ZONE_NAMES[over.id as Zone]}` : 'Not over a drop area'),
    onDragEnd: ({ active: dragged, over }) =>
      outcome(dataOf(dragged), over ? String(over.id) : null).text,
    onDragCancel: () => 'Cancelled; the deck is unchanged',
  };

  if (!enabled) return <>{children}</>;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      accessibility={{ announcements, screenReaderInstructions: { draggable: INSTRUCTIONS } }}
      onDragStart={({ active: dragged }) => setActive(dataOf(dragged))}
      onDragCancel={() => setActive(null)}
      onDragEnd={({ active: dragged, over }) => {
        setActive(null);
        const data = dataOf(dragged);
        const { act } = outcome(data, over ? String(over.id) : null);
        if (act === 'add') add(data.card, data.available);
        if (act === 'remove') remove(data.card.id);
      }}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className="w-24 overflow-hidden rounded-tile border border-pri shadow-lg">
            <div className="relative aspect-[5/7]">
              <CardArt card={cardView(active.card)} sizes="96px" />
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export function DropZone({
  id,
  label,
  className,
  onElement,
  children,
}: {
  id: Zone;
  label: string;
  className?: string;
  onElement?: (element: HTMLElement | null) => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver, active } = useDroppable({ id });
  const fromElsewhere = active !== null && (active.data.current as DragData | undefined)?.from !== id;
  return (
    <section
      aria-label={label}
      ref={(element) => {
        setNodeRef(element);
        onElement?.(element);
      }}
      className={cn(className, isOver && fromElsewhere && 'bg-pri-dim outline-2 outline-pri outline-dashed')}
    >
      {children}
    </section>
  );
}
```

(`useDroppable` outside a `DndContext` — below 1024 px — registers with dnd-kit's default context and does nothing.)

- [ ] **Step 2: `DeckSlot` takes a node ref and a drag handle**

In `apps/web/components/decks/deck-slot.tsx`: add `import type { HTMLAttributes, Ref } from 'react';`; add to the common part of `DeckSlotProps`:

```ts
  ref?: Ref<HTMLDivElement>;
  /** Makes the art and name a drag handle: dnd-kit's activator ref, attributes and listeners. */
  handle?: HTMLAttributes<HTMLDivElement> & { ref?: (element: HTMLElement | null) => void };
```

destructure `ref` and `handle` with the others; put `ref={ref}` on the root `<div id={deckSlotId(card.id)} …>`; and wrap the art and the name column in one handle element — replace the two siblings (`<div className="relative aspect-[5/7] w-10 …">…</div>` and `<div className="flex min-w-0 flex-1 flex-col">…</div>`) with:

```tsx
      <div
        {...handle}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-3 rounded-tag',
          handle && 'focus-ring cursor-grab touch-none active:cursor-grabbing',
        )}
      >
        {/* the existing art div, unchanged */}
        {/* the existing name column div, unchanged */}
      </div>
```

keeping the two inner `div`s exactly as they are.

- [ ] **Step 3: Draggable pool tiles**

In `apps/web/components/decks/builder/pool-tile.tsx`: add `import { useDraggable } from '@dnd-kit/core';` and `import { type DragData, POOL_ZONE } from './builder-dnd';`; destructure `draggable` too; at the top of `PoolTileImpl`:

```tsx
  const drag = useDraggable({
    id: `${POOL_ZONE}:${card.id}`,
    data: { from: POOL_ZONE, card, available: owned?.available } satisfies DragData,
    disabled: !draggable,
  });
```

put `ref={drag.setNodeRef}` on the root `div`, add `drag.isDragging && 'opacity-50'` to its classes (wrap the class string in `cn(…)`), and make the art a handle — the art `div` becomes:

```tsx
      <div
        ref={drag.setActivatorNodeRef}
        {...(draggable ? { ...drag.attributes, ...drag.listeners } : {})}
        aria-label={draggable ? `${card.name} (${setNumber(card.id)})` : undefined}
        className={cn(
          'relative aspect-[5/7]',
          draggable && 'focus-ring cursor-grab touch-none active:cursor-grabbing',
        )}
      >
```

(the badges stay inside it).

- [ ] **Step 4: Draggable decklist rows**

In `apps/web/components/decks/builder/deck-list.tsx`: add `import { useDraggable } from '@dnd-kit/core';`, `import type { PlayableCard } from '@pokedrop/shared';` and `import { DECK_ZONE, type DragData } from './builder-dnd';`; give `DeckList` the prop `{ dragEnabled }: { dragEnabled: boolean }`; add above it:

```tsx
function DraggableSlot({
  card,
  count,
  max,
  onChange,
  dragEnabled,
}: {
  card: PlayableCard;
  count: number;
  max: number;
  onChange: (count: number) => void;
  dragEnabled: boolean;
}) {
  const drag = useDraggable({
    id: `${DECK_ZONE}:${card.id}`,
    data: { from: DECK_ZONE, card } satisfies DragData,
    disabled: !dragEnabled,
  });
  return (
    <DeckSlot
      ref={drag.setNodeRef}
      handle={
        dragEnabled
          ? {
              ref: drag.setActivatorNodeRef,
              ...drag.attributes,
              ...drag.listeners,
              'aria-label': card.name,
            }
          : undefined
      }
      dragging={drag.isDragging}
      card={cardView(card)}
      count={count}
      max={max}
      onChange={onChange}
    />
  );
}
```

and render `<DraggableSlot card={entry.card} count={entry.count} max={slotMax(entry.card, cards, cardsById)} onChange={(count) => setCount(entry.cardId, count)} dragEnabled={dragEnabled} />` in place of the `<DeckSlot … />`.

- [ ] **Step 5: Wire the builder**

In `apps/web/components/decks/builder/deck-builder.tsx`: add `import { BuilderDnd, DECK_ZONE, DropZone, POOL_ZONE } from './builder-dnd';`; render `<DeckList dragEnabled={wide} />` in `list`; wrap the whole returned tree's layout part (header and columns, not the dialogs) in `<BuilderDnd enabled={wide}>…</BuilderDnd>`; and in the wide layout replace the pool `<section>` with

```tsx
          <DropZone id={POOL_ZONE} label="Card pool" className={column} onElement={setPoolElement}>
            {pool}
          </DropZone>
```

and the decklist `<section aria-label="Deck" …>` (three columns) and `<section aria-label="Deck and checks" …>` (two columns) with `<DropZone id={DECK_ZONE} label="Deck" …>` / `<DropZone id={DECK_ZONE} label="Deck and checks" …>` carrying the same classes and children.

- [ ] **Step 6: Gate and look**

Run: `pnpm --filter @pokedrop/web typecheck && npx eslint apps/web/components/decks --max-warnings=0`
Expected: both exit 0.

In the preview at ≥ 1280 px: drag a pool card onto the decklist — the deck column highlights while over it, the card lands (+1); drag a decklist row to the pool — one copy less. Tab to a pool card's art, Space, →, Space: the card is added. Clicking *+ Add* still adds without starting a drag. At 375 px no drag handles are in the tab order.

- [ ] **Step 7: Commit**

```bash
cd /m/projects/pokedrop
git add apps/web/components/decks
git commit -m "[PD-112]: drag cards between the pool and the deck, by keys too

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The stats panel

**Files:**
- Create: `apps/web/components/decks/stats/deck-stats-charts.tsx`, `apps/web/components/decks/stats/deck-stats.tsx`
- Modify: `apps/web/components/decks/builder/deck-checks.tsx`, `apps/web/components/decks/public-deck.tsx`

**Interfaces:**
- Consumes: `DeckStats` (shared), `toDeckStats`, `energyStyle`, `RARITY_STYLES`, `rarityTier`.
- Produces: `DeckStatsPanel({ stats }: { stats: DeckStats })` — lazy, client only, a skeleton while Recharts loads.

- [ ] **Step 1: The charts**

Create `apps/web/components/decks/stats/deck-stats-charts.tsx`:

```tsx
'use client';

import type { ChartDatum, DeckStats } from '@pokedrop/shared';
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { energyStyle } from '@/lib/design/energy';
import { RARITY_STYLES, rarityTier } from '@/lib/design/rarity';

const SUPERTYPE_COLORS: Record<string, string> = {
  Pokémon: 'var(--pri)',
  Trainer: 'var(--gold)',
  Energy: 'var(--grn)',
};

function summary(data: ChartDatum[]): string {
  return data.length === 0 ? 'None yet' : data.map((d) => `${d.name} ${d.value}`).join(', ');
}

function ChartFigure({
  title,
  column,
  data,
  colorOf,
}: {
  title: string;
  column: string;
  data: ChartDatum[];
  colorOf: (name: string) => string;
}) {
  const shown = data.filter((d) => d.value > 0);
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-col gap-0.5">
        <span className="text-small font-semibold text-tx">{title}</span>
        <span className="text-[12px] text-mut">{summary(shown)}</span>
      </figcaption>
      {shown.length > 0 ? (
        // The caption and the table below say the same; the bars are for the eye.
        <div aria-hidden style={{ height: shown.length * 28 + 8 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={shown} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={88}
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--mut)', fontSize: 12 }}
              />
              <Bar dataKey="value" radius={4} isAnimationActive={false}>
                {shown.map((d) => (
                  <Cell key={d.name} fill={colorOf(d.name)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{column}</th>
            <th scope="col">Copies</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((d) => (
            <tr key={d.name}>
              <th scope="row">{d.name}</th>
              <td>{d.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function DeckStatsCharts({ stats }: { stats: DeckStats }) {
  return (
    <section aria-label="Deck stats" className="flex flex-col gap-4 rounded-card border border-bd bg-surface p-4">
      <h3 className="text-h3">Stats</h3>
      <p className="text-small text-mut">
        <span className="font-mono text-h2 font-bold text-tx">{stats.energyCount}</span> energy of{' '}
        {stats.totalCards} {stats.totalCards === 1 ? 'card' : 'cards'}
      </p>
      <ChartFigure
        title="Cards by supertype"
        column="Supertype"
        data={stats.supertypes}
        colorOf={(name) => SUPERTYPE_COLORS[name] ?? 'var(--mut)'}
      />
      <ChartFigure
        title="Pokémon by type"
        column="Type"
        data={stats.types}
        colorOf={(name) => energyStyle(name).face}
      />
      <ChartFigure
        title="Cards by rarity"
        column="Rarity"
        data={stats.rarities}
        colorOf={(name) => RARITY_STYLES[rarityTier(name)].color}
      />
    </section>
  );
}
```

Check the token names: `grep -n "^\s*--gold:\|^\s*--grn:" apps/web/app/globals.css` — each must print one line; if a name differs, use the one there.

- [ ] **Step 2: The lazy wrapper**

Create `apps/web/components/decks/stats/deck-stats.tsx`:

```tsx
'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

// Recharts loads with the panel only, never with the rest of the page.
export const DeckStatsPanel = dynamic(
  () => import('./deck-stats-charts').then((module) => module.DeckStatsCharts),
  { ssr: false, loading: () => <Skeleton shape="block" height="18rem" /> },
);
```

- [ ] **Step 3: Use it in the builder and the public view**

In `apps/web/components/decks/builder/deck-checks.tsx`: add `import { DeckStatsPanel } from '@/components/decks/stats/deck-stats';` and replace `<p className="sr-only">{stats.totalCards} cards in the draft.</p>` with `<DeckStatsPanel stats={stats} />`.

In `apps/web/components/decks/public-deck.tsx`: add `import { toDeckStats } from '@pokedrop/shared';` (merge with the type import) and `import { DeckStatsPanel } from './stats/deck-stats';`; compute

```tsx
  const stats = toDeckStats(
    deck.cards.map(({ card, count }) => ({
      supertype: card.supertype,
      rarity: card.rarity,
      types: card.types,
      count,
    })),
  );
```

and add `<DeckStatsPanel stats={stats} />` as the second child of the `grid gap-6 lg:grid-cols-2` div, after the decklist section.

- [ ] **Step 4: Gate and look**

Run: `pnpm --filter @pokedrop/web typecheck && npx eslint apps/web/components/decks --max-warnings=0`
Expected: both exit 0.

In the preview: the checks column shows *Stats* with three bar charts; − on a Pokémon row changes the type bars and the captions at once. The public view of a deck shows the same panel. The Network panel shows the Recharts chunk only once the panel mounts.

- [ ] **Step 5: Commit**

```bash
cd /m/projects/pokedrop
git add apps/web/components/decks
git commit -m "[PD-113]: chart a deck's types, rarities and energy as it changes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Measure, document, close

**Files:**
- Create (scratchpad, not committed): `measure-builder.mjs`, built on the scratchpad's `cdp.mjs` (`launch`, `goto`, `eval`, `waitFor`, `key`, `type`, `send`, `requests`, `consoleErrors`, `focused`) and `signin.mjs` (`signIn`, `withJar`), the way `measure-decks.mjs` is
- Modify: `docs/Pages.md`, `docs/Components.md`, `docs/Architecture.md`
- Linear: PD-112, PD-113

**Interfaces:**
- Consumes: everything above; the test user `pd102-1791136869104@pokedrop.test` (jar `jar.txt`, decks *Unfinished* and *Base Sixty*, 5,000 inventory cards, trades locking `base1-28` and `base1-100`) and `n64-1791136966@pokedrop.test` / `aaaaaaaaaaaa` (no decks).

Run each check under `next dev` with real key and pointer events (CDP `Input.dispatchKeyEvent` / `Input.dispatchMouseEvent`), record the numbers, and fix what fails before moving on (systematic-debugging, then re-run the check).

- [ ] **Step 1: Check 1 — a deck without a mouse**

Create a deck *Keyboard Sixty* (unlimited) by `POST /decks` from the page's `fetch`, open `/decks/<id>` at 1440×900, and by keys only: focus the pool search, type `Energy`, Tab to *+ Add* on a basic energy and press Enter 20 times; search `Pikachu` and add 4; continue until 60 cards from what the test user owns; Tab to *Save*, Enter (or Ctrl+S). Expected: the badge reads *60/60 · Legal* (or names what fails), the toast *Saved*, and `GET /decks/<id>` holds exactly the draft's cards and counts. Record the number of key presses.

- [ ] **Step 2: Check 2 — drag, refusal and announcements**

Pointer: drag a pool tile onto the deck column (mouse down on the art, move in 10 steps, up over the decklist): +1. Drag a fifth copy of a 4-copy card: nothing changes. Drag a decklist row to the pool: −1. Two printings of one name (search `Charizard` in *All cards*, add 2 + 2 of two printings): the fifth refuses by *+ Add*, by drop and at the stepper. Keyboard: focus a tile's art, Space, ArrowRight, Space. Read the dnd-kit live region (`[id^="DndLiveRegion"]` text) after each step. Expected: *Picked up …*, *Over the deck*, *Added … — n copies in the deck*, *… is at the 4-copy limit; nothing added*, *Removed a copy of … — n left*, *Cancelled; the deck is unchanged* (Escape).

- [ ] **Step 3: Check 3 — smoothness**

With *My cards* (5,000), scroll the pool to row 30, inject `new PerformanceObserver((l) => window.__long.push(...l.getEntries().map((e) => e.duration))).observe({ type: 'longtask' })` and a `requestAnimationFrame` frame-time recorder, then drag a tile across the pool and onto the deck over 60 pointer moves. Expected: no long task over 50 ms during the move phase; record the median and the worst frame time. Count the rendered tiles (`[role=listitem]` in the pool) to confirm virtualization (well under 100).

- [ ] **Step 4: Check 4 — agreement with the server**

For *Keyboard Sixty* and *Base Sixty*: after a change and a save, compare the page's verdict (the banner's rules and issues, read from the DOM) with `POST /decks/<id>/validate`. Switch the format to *Standard*: the base-set cards fail *Every card legal in standard* at once, without a request (`requests` shows no `/validate`). Set *Owned only*, add from *All cards* a card the user does not own: *Checking your copies…* shows, then *not owned* appears without a flash of the opposite. Trade lock: with the builder open on an owned-only deck holding a card, propose a trade from the test user offering all available copies of that card (`POST /trades`, body as `docs/API.md` *Trades*), then change a count and save: the toast and the banner show the server's ownership error, which the page did not predict; cancel that trade afterwards.

- [ ] **Step 5: Check 5 — charts**

Remove a Pokémon of one type: its bar and caption shrink in the same frame; each `table.sr-only` holds the caption's numbers; with `prefers-reduced-motion: reduce` emulated nothing animates (`isAnimationActive` is off anyway).

- [ ] **Step 6: Check 6 — leaving and the Public switch**

With a dirty draft: flip *Public* — the draft and *Unsaved changes* survive; click the sidebar's *Inventory* — *Leave without saving?* with focus on *Stay*; *Stay* — still on the deck, draft intact; Back — the same dialog; *Discard changes* — on the previous page; forward to the deck again: the saved deck, clean. Dirty again: *Save and leave* from a link — saved, then on the link's page. Reload with a dirty draft — the browser's own prompt (`Page.javascriptDialogOpening` over CDP). After a plain save: one Back leaves the deck. A clean draft: no dialog anywhere.

- [ ] **Step 7: Check 7 — failures, small screens, the public view**

Offline (`Network.emulateNetworkConditions` offline) then Save: *Couldn’t save — your changes are still here*, *Unsaved changes* stays, Save enabled; back online, Save works. Delete the deck from another tab's `fetch` then Save: *This deck no longer exists*. At 375 px: tabs *Pool / Deck · n / Check*, `scrollWidth` 375, *+ Add* and steppers build the deck, *Show card* switches to *Deck* and highlights the row. The public view: a guest (fresh browser, no jar) on a public deck sees the decklist, the stats and *Sign in to clone*; `n64` sees *Clone*, which opens a private copy; a private deck is the 404 page for both. No console errors anywhere. Delete the decks this run created.

- [ ] **Step 8: Document**

- `docs/Pages.md`: add to the decisions table the row `| D4 | The deck builder validates its draft in the browser with the API's own validator, from \`@pokedrop/shared\`; rule failures never block a save — only what the API would refuse with a 400 does | PD-112, PD-113 |`; add a section *Deck builder (PD-112, PD-113)* after *Decks list (PD-111)*: what the page is (owner's builder vs public view), the draft (what is in it, *Public* saving at once, seeded once), the pool (*My cards* / *All cards*), drag and the keyboard path, the leave guard (links, Back sentinel, unload), the checks and stats, then **Measured 2026-10-0x** bullets with the numbers from checks 1–7, and **Traps**: keying the draft by `updatedAt` wipes it on *Public*; `serverApi` metadata forwards cookies (the owner's private deck title); the history sentinel and React Strict Mode (the guard only installs when the draft becomes dirty, never on mount); `useDroppable` outside a context below 1024 px.
- `docs/Components.md`: the builder's parts (table rows for `DeckBuilder`, `BuilderHeader`, `CardPool`, `PoolTile`, `DeckList`, `DeckChecks`, `BuilderDnd` / `DropZone`, `DeckStatsPanel`), `VirtualCardGrid` `scrollElement`, `DeckSlot` `readOnly` / `handle`, `useUnsavedChanges` (dialog-driven, Back covered); replace the line *Drag is PD-112's…* with what PD-112 did.
- `docs/Architecture.md` §5: the deck validator and the stats live in `@pokedrop/shared`, used by the API and the builder.

- [ ] **Step 9: Commit the docs**

```bash
cd /m/projects/pokedrop
git add docs/Pages.md docs/Components.md docs/Architecture.md
git commit -m "[PD-112]: document the deck builder and what it measured

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 10: Close the tickets**

Set PD-112 and PD-113 to *Done* in Linear, with every acceptance criterion's checkbox ticked in the description (`- [x]`), each only after its check above passed.
