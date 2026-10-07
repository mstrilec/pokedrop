# PD-137 — Generate a random legal deck

Design, 2026-10-08. Milestone M15 · Polish & Extras.

Ticket: [PD-137](https://linear.app/mstrilec/issue/PD-137/deck-builder-generate-a-random-legal-deck). Builds on the
deck validator (PD-64, PD-65: `validateDeck`, `copyLimitKey` in `@pokedrop/shared`), the deck builder (PD-112, PD-113:
the draft store, D4, D10's `?add=`), the catalog sync (PD-39, PD-42: `CardDTO`, `CatalogWriter`) and the pack RNG
(PD-57: `SeededRng`). Reference: `docs/API.md` *Decks* / *Validation* · `docs/Pages.md` *Deck builder* ·
`apps/api/src/sync/README.md`.

---

## What the ticket asks

| Scope item | Where it lands |
| --- | --- |
| *Random deck* in the builder's header and *New deck* on `/decks` | [Web](#web) |
| the result goes into the draft as unsaved changes; replacing a non-empty draft asks | [Web](#web) |
| options: format, owned only or any card, one or two energy types or *Surprise me* | [`POST /decks/random`](#post-decksrandom) |
| legal by `validateDeck`; 15–20 Pokémon with whole evolution lines, 10–15 Trainers, basic Energy of the types | [The generator](#the-generator) |
| owned only from available copies; an explanation when the collection cannot make a deck | [Owned only](#owned-only-and-shortfalls) |
| where it is computed (open decision) | [Decision 2](#decisions) |
| deterministic under a seed in development | [`seed`](#post-decksrandom) |

| Acceptance criterion | How it is met |
| --- | --- |
| Every generated deck passes `validateDeck` for its format (200 generations per format and per mode) | The server validates each result before answering ([Decision 2](#decisions)); [Verification](#verification) G1 runs 200 × 3 formats × 2 modes |
| Owned only never uses more copies than the member has available | Counts capped by `quantity − lockedQuantity` in the pool; validated with `ownedOnly: true`; G2 |
| Evolution lines are complete; energy matches the chosen types | Lines are built down `evolvesFrom` ([Decision 1](#decisions)); G3, G4 |
| The result is an unsaved draft; leaving asks; *Save* stores exactly what is shown | `replaceCards` in the draft store; the existing unsaved-changes guard; B2 |
| A collection too small for a legal deck gets an explanation, not a broken deck | `result: 'shortfall'` with `have`, `need` and a sentence; B3 |

## Decisions

Taken with the user during brainstorming:

1. **`evolvesFrom` joins the catalog mirror.** A nullable `cards."evolvesFrom"` column, carried by `CardDTO` from both
   providers (pokemontcg.io `evolvesFrom`, TCGdex `evolveFrom`), filled by one full catalog sync. Lines are then real:
   Charmander → Charmeleon → Charizard, a V → its VMAX or VSTAR, a Mega, a Lv.X. Rejected: Basic Pokémon only (legal,
   but the deck's shape is what the ticket asks for) and guessing lines from Pokédex numbers (Eevee, regional forms).
   Measured 2026-10-08: pokemontcg.io's `/v2/cards` pages carry `evolvesFrom` (`base1-4` Charizard → *Charmeleon*,
   `base1-6` Gyarados → *Magikarp*); TCGdex's `base1-24` carries `evolveFrom: "Charmander"`.
2. **The server generates**: `POST /decks/random`. It sees the whole legal pool of a format and the member's available
   copies in SQL, without paging, and validates the result with `validateDeck` before answering. Rejected: generating
   in the browser from the pool pages already loaded (100 cards a page — a random slice of the catalog), and the
   server sending the pool for the browser to pick from (thousands of cards for what the server does faster).

## Data

`Card` gains one column, one migration (`card_evolves_from`):

```prisma
evolvesFrom String?

@@index([evolvesFrom])
```

The name of the card this one evolves from, as the provider prints it (*Charmeleon*), or `null` for a Basic, a
Trainer, an Energy, and every card mirrored before the backfill.

## Sync

- `CardDTO` (`apps/api/src/sync/providers/provider.dto.ts`) gains `evolvesFrom: string | null`.
- pokemontcg.io: `RawCardSchema` gains `evolvesFrom: z.string().optional()`; the mapper passes it through
  (`?? null`).
- TCGdex: the raw schema gains `evolveFrom: z.string().optional()`; the mapper maps it to `evolvesFrom`.
- `CatalogWriter.upsertCards` writes it in the `INSERT`, the `UPDATE SET` **and the guarded comparison tuple**. Left out
  of the tuple, a sync would never update a row that already exists — silently, which is the trap the writer's comment
  lists; the comment gains the column.
- `CardSchema` in `@pokedrop/shared` gains `evolvesFrom: z.string().nullable()`.
- **Backfill**: one full catalog sync (`POST /admin/sync/catalog`) after the code is in, about 15 minutes for 84 pages
  on 2026-10-07. Checked with `psql`: every `Stage 1` / `Stage 2` / `VMAX` / `VSTAR` card of the mirror has an
  `evolvesFrom`, except those the provider prints without one (counted and recorded).

## `POST /decks/random`

Member (any signed-in user), throttle `MODERATE_THROTTLE`, writes nothing.

```ts
// RandomDeckRequestSchema (shared)
{
  format: DeckFormat;          // 'standard' | 'expanded' | 'unlimited'
  ownedOnly: boolean;
  types: EnergyType[];         // 0–2 distinct; [] is "Surprise me"
  seed?: string;               // 1–64 characters; refused with 400 in production
}

// RandomDeckResponseSchema (shared), a discriminated union on `result`
| { result: 'deck'; format: DeckFormat; types: EnergyType[]; cards: { cardId; count; card: PlayableCard }[] }
| { result: 'shortfall'; code: 'NOT_ENOUGH_POKEMON' | 'NOT_ENOUGH_TRAINERS' | 'NOT_ENOUGH_ENERGY';
    type: EnergyType | null; have: number; need: number; message: string }
```

- **Generatable types** of a format are the energy types with a basic Energy card `Legal` in it — no Dragon or
  Colorless anywhere (no basic Energy exists), no Fairy in standard. A requested type outside them → 400 *No basic
  {type} Energy is legal in {format}*.
- `types` in the answer are the types used (the ones *Surprise me* picked).
- **A shortfall is an answer, not an error**: 200 with `result: 'shortfall'`, so the client offers *Any card* without
  parsing an error envelope. `message` examples: *You own 9 Fire Pokémon; a deck needs at least 12*, *You own 5
  Trainers; a deck needs at least 8*, *You own 14 basic Water Energy; this deck needs 25*.
- **Checked before answering**: `validateDeck({ format, ownedOnly, deckSize: DECK_SIZE, cards, available })` with
  `available` the member's available copies. A result with any error (a generator bug) is regenerated with a new seed,
  up to 5 times; then 500 and an error log with the seed and the issues.
- `seed` makes the result reproducible against an unchanged pool and collection. Outside production only, so nobody
  can farm a seed in production; in production a request with `seed` is a 400.

## The generator

`apps/api/src/decks/random-deck/`:

| File | Holds |
| --- | --- |
| `random-deck.generator.ts` | `generateDeck(pool: PoolCard[], options: GenerateOptions, rng: Rng): GenerateResult` — pure, no I/O |
| `random-deck.pool.ts` | the SQL that reads the pool |
| `random-deck.service.ts` | pool → generator → `validateDeck` → retry → the answer with `PlayableCard`s |
| `random-deck.controller.ts` | the route, under the decks module |

`PoolCard` is `{ id, name, supertype, subtypes, types, evolvesFrom, available }` (`available` is `Infinity` for *Any
card*). The generator never sees anything else.

**The pool**: every card `Legal` in the format (`legalities->>format = 'Legal'`; an absent legality would be a
validator warning, so it is out). Left out: `V-UNION` cards (four different cards make one) and Pokémon without a type.
For *Owned only*: joined to the member's inventory, `available = quantity − lockedQuantity`, only rows above 0.

**Types**: the requested ones; for *Surprise me*, one or two (even odds) picked at random among the generatable types
that can make a deck from this pool — tried in random order until one fits, so *Owned only* with *Surprise me* only
answers a shortfall when no type can.

**Pokémon — 16 to 18 copies, whole lines:**

1. *Tops*: Pokémon whose `types[0]` is a chosen type and whose line resolves — for each `evolvesFrom`, a pool card of
   that name, down to a card with none. Lower stages may be any type (Magikarp → Gyarados).
2. Line shapes by length: three stages 3-2-2 or 4-3-3; two stages 3-2; one stage 2 or 3 copies.
3. Lines are drawn at random until the Pokémon count is 16–18, 2 to 4 lines (a one-stage line counts). Each stage's
   printing is drawn among the pool's printings of that name.
4. The copy limit counts by `copyLimitKey` across printings: a stage at its name's limit makes the line shorter
   (4-3-3 → 3-2-2 → drop it).
5. At most one card with the subtype `Radiant`.

**Trainers — 12 to 14 copies**: 4–6 copies of Supporters, the rest Items and Pokémon Tools, at most 2 copies of
Stadiums; 1–4 copies of each name; at most one `ACE SPEC` card.

**Energy — the rest, to 60**: basic Energy of the chosen types, split evenly (an odd copy to the first type). A basic
Energy's type is its name without `Basic ` and ` Energy` (*Basic Fire Energy*, *Fire Energy* → Fire) — its `types`
is empty on many printings. Any printing; unlimited copies (`copyLimitKey` is `null` for basic Energy).

### Owned only and shortfalls

Every count is capped by `available`; a type's Energy may combine printings. The minimums that decide a shortfall:

| Code | When | `have` / `need` |
| --- | --- | --- |
| `NOT_ENOUGH_POKEMON` | fewer than 12 copies of whole-line Pokémon of the type(s) can be placed | copies placeable / 12 |
| `NOT_ENOUGH_TRAINERS` | fewer than 8 Trainer copies | copies / 8 |
| `NOT_ENOUGH_ENERGY` | the type's basic Energy cannot fill the rest to 60 | copies / copies needed |

Below the target but above the minimum, the deck is built short of the target and filled up: with more Trainers (to
15), then more Energy. `type` names the type the shortfall is about when one is (Pokémon and Energy).

## Web

**`RandomDeckDialog`** (`components/decks/builder/random-deck-dialog.tsx`), opened by *Random deck* (icon `Shuffle`)
in `BuilderHeader`, beside *Owned only / Theorycraft*:

- *Format* — the deck's; *Cards* — *Owned only* or *Any card*, the deck's current mode; *Energy* — chips of the
  format's generatable types (at most two) and *Surprise me*, selected by default.
- *Generate*. With cards in the draft, it asks first: *Replace the 23 cards in this deck?*
- **A deck**: the draft store's new `replaceCards(entries, { format, ownedOnly })` replaces `draft.cards`, merges the
  cards into `cardsById`, sets the format and mode, and (owned) learns the available counts from the answer. The draft
  is dirty: the existing *Leave this deck?* guard applies, and *Save* stores what is shown. Toast: *Random Fire ·
  Water deck added — save it to keep it*. The builder's own `validateDeck` (D4) shows the banner green.
- **A shortfall**: the dialog stays open with the server's sentence and *Use any card instead* (switches to *Any card*
  and generates again).
- **An error** (429, 400, 500): `toastApiError`; the dialog stays open.

**`/decks` → *New deck***: a *Start with a random deck* toggle. Created with it, the deck opens at
`/decks/<id>?random=1`, and the builder opens the dialog once with the new deck's format; the parameter is dropped
first, as `?add=` is, so a reload or Back does not open it again.

Nothing else in the builder changes: a generated deck is edited like any other.

## Errors

| Case | Answer |
| --- | --- |
| a type with no legal basic Energy in the format | 400 *No basic {type} Energy is legal in {format}* |
| more than two types, a repeated type, an unknown format | 400 (schema) |
| `seed` in production | 400 *seed is only accepted in development* |
| the collection cannot make the deck | 200 `result: 'shortfall'` |
| five generations failing `validateDeck` | 500, logged with the seeds and the issues |
| over the throttle | 429 |
| signed out | 401 |

## Documentation

- `docs/API.md` *Decks*: the route, the request, the union, the generatable types, the shortfalls, `seed`.
- `docs/DataModel.md` *Card*: `evolvesFrom`.
- `apps/api/src/sync/README.md`: the DTO field and the writer's tuple.
- `docs/Pages.md` *Deck builder* and *Decks*: the dialog, the *New deck* toggle, what was measured.

## Verification

No automated tests in v1. A throwaway script in the session scratchpad, not committed, drives the compiled generator
(`apps/api/dist/decks/random-deck/random-deck.generator.js`) against pools read from the dev database, as PD-121 did
with the pack generator.

- **G1** 200 generations × standard, expanded, unlimited × *Any card* and *Owned only* (1,200 decks), seeds
  `pd137-<n>`: each passes `validateDeck` with no error and no warning.
- **G2** *Owned only*: every count ≤ the card's available copies. The test member's collection is topped up in the dev
  database with `psql` so that each format can make a deck, and one member is left too small to get the shortfalls.
- **G3** Every card with an `evolvesFrom` in a deck has a card of that name in the same deck.
- **G4** Energy: only basic Energy of the answer's `types`; Pokémon tops of those types; Pokémon 16–18 (or the
  shortfall fill), Trainers 12–15, 60 in all; at most one ACE SPEC and one Radiant.
- **G5** The same seed twice → the same deck; two seeds → different decks.
- **Backfill**: the counts of Stage 1 / Stage 2 / VMAX / VSTAR cards with and without `evolvesFrom` after the sync.
- **API**: a type outside the format → 400; three types → 400; signed out → 401; the throttle → 429; a small
  collection → the shortfall sentences.
- **B1** (browser, signed in) *Random deck* on an empty deck → 60 cards, banner green, *Save* → the saved deck equals
  what was shown (`GET /decks/:id`).
- **B2** On a deck with cards: the replace question; after generating, leaving asks *Leave this deck?*.
- **B3** *Owned only* with the small collection: the sentence and *Use any card instead* → a deck.
- **B4** *New deck* with *Start with a random deck* → the dialog on arrival, once; a reload does not reopen it.
- **B5** 375 px: the dialog and the builder with `scrollWidth` 375; no console errors.

## Out of scope

- Deck quality beyond the shape above — no archetypes, no attack-cost matching, no competitive staples list.
- Special Energy.
- Saving the generation options with the deck.
- A light-theme pass of the dialog (PD-139).
