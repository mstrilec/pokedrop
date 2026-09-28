# PD-64 + PD-65 — Validating a deck, owned or planned

Design, 2026-09-28. Milestone M7 · Deck Builder API.

Tickets:
[PD-64](https://linear.app/mstrilec/issue/PD-64/deck-validation-engine-size-copy-limits-and-format-legality) (the engine) ·
[PD-65](https://linear.app/mstrilec/issue/PD-65/owned-only-vs-theorycrafting-deck-mode-toggle) (the mode).
Reference: `docs/PRD.md` §5.3 · `docs/UserFlows.md` §3 · `docs/ComponentSpecs.md`
(DeckValidationBanner) · `docs/API.md` (Decks, from PD-63/66/67) ·
`apps/api/src/inventory/README.md` (PD-55's `availableQuantity` contract).

One spec for two tickets because the mode is one input to the engine: strict
and theorycrafting run the same rules and differ only in whether "you do not
have this card" is an error or a warning.

---

## Measured before designing

Against the local mirror, 2026-09-28.

| Probe | Result |
| --- | --- |
| Cards / distinct names | 20 670 / 4 454 — Pikachu alone has 134 printings |
| Names with more than one printing, basic energy excluded | 2 821 |
| Energy cards | 394: 183 `Basic`, 196 `Special`, the rest `Special` plus a tag (`ACE SPEC`, `Prism Star`, …) |
| `subtypes` containing `Basic` | 10 141 — Basic Pokémon carry it too, so "basic energy" is `supertype = 'Energy'` **and** `Basic` |
| Names shared by basic and special energy | `Metal Energy`, `Darkness Energy` — 15 special printings each |
| `legalities` values | `Legal`, `Not Legal`, `Banned`; keys `standard`, `expanded`, `unlimited` only |
| `legalities` key present | `unlimited` 20 479 · `expanded` 14 964 · `standard` 7 373 |
| `legalities = {}` | 191, every one from `me55` / `me55c`, released 2026-09-16 — legality not yet published, not illegal |
| Special-rule subtypes | `ACE SPEC` 46 · `Prism Star` 27 · `Radiant` 16 |
| Inventory rows with `lockedQuantity > 0` | 1 |

---

## Decisions

Agreed with the owner in brainstorming, 2026-09-28.

1. **A save never fails on a deck rule; it reports.** `POST /decks`,
   `PATCH /decks/:id` and `POST /decks/:id/clone` persist the deck and return
   it with a `validation` field computed by the same engine, inside the same
   transaction. Validity is never stored, so a deck cannot be "persisted as
   valid" — the ticket's worry — and an unfinished 20-card draft can still be
   saved. Request bounds from PD-63 (unknown card, duplicate `cardId`, `count`
   past 100) stay 400s: those are malformed requests, not rule breaches.
2. **The mode is a column: `Deck.ownedOnly`, default `false`.** A player keeps
   an owned deck and a planned one side by side, and the builder's toggle is
   saved with the deck. Default theorycrafting, because a clone of someone
   else's deck and a new player's first deck would otherwise open as invalid.
   Changing `ownedOnly` changes nothing else about the deck. A clone copies
   the source's `ownedOnly` along with its format and cards.
3. **The copy limit counts a name across printings; only basic energy is
   exempt.** The real rule, and the one `DataModel.md` and the schema comment
   already state. The ticket's "energy cards exempt" is read as basic energy:
   special energy is limited like any other card.
4. **Only the saved deck is validated.** `POST /decks/:id/validate` takes no
   body. Live validation in the builder is autosave plus the `validation` on
   the save response — one path from data to verdict.
5. **Validation is shown to the owner only.** In either mode the result says
   how many copies of each card the owner has available, which is their
   private inventory. So `validate` is owner-only, and `validation` rides on
   the owner's save responses and nowhere public.
6. **A missing legality is a warning, not an error.** Every card without one
   comes from a set released twelve days ago; calling them illegal would be a
   claim the data does not make.
7. **Out of scope:** ACE SPEC (one per deck), Radiant (one per deck), Prism
   Star (one per name) — none is in the ticket, and each is a rule function
   added later without touching the contract (see *Rules*).

---

## Schema change

```prisma
model Deck {
  …
  /// Strict mode: a card beyond the owner's available copies is an error
  /// rather than a warning. Read by the validation engine only; changing it
  /// never touches the decklist.
  ownedOnly Boolean @default(false)
  …
}
```

One migration, `*_deck_owned_only`: `ALTER TABLE "decks" ADD COLUMN "ownedOnly"
BOOLEAN NOT NULL DEFAULT false`. Additive, so existing rows — the seed deck
included — become theorycrafting decks, which is what they were in effect.

---

## Configuration

`DECK_SIZE` — integer 1–100, default `60`, validated in `env.schema.ts`, exposed
as `config.decks.size` and documented in `.env.example`. The ticket asks for a
configurable size; the copy limit (4) is a constant, since the ticket does not.
A deck is the right size only at exactly `DECK_SIZE` copies.

---

## Rules

Four rules, always evaluated in this order. Each is a function from the
loaded deck to a list of issues; the engine concatenates them. A new rule
(ACE SPEC, say) is a fifth function and a fifth `rules` row — the response
shape does not change.

| `rule` | `code` | Severity | Raised when | `cardIds` | `params` |
| --- | --- | --- | --- | --- | --- |
| `DECK_SIZE` | `DECK_SIZE_MISMATCH` | error | total copies ≠ `DECK_SIZE` | `[]` | `{ expected, actual }` |
| `COPY_LIMIT` | `COPY_LIMIT_EXCEEDED` | error | more than 4 copies share a `name`, basic energy excluded | every printing of that name in the deck | `{ name, count, max: 4 }` |
| `FORMAT_LEGALITY` | `CARD_BANNED` | error | `legalities[format] === 'Banned'` | `[cardId]` | `{ name, format }` |
| | `CARD_NOT_LEGAL` | error | `legalities[format]` present and neither `Legal` nor `Banned` | `[cardId]` | `{ name, format, status }` |
| | `CARD_LEGALITY_UNKNOWN` | warning | no `legalities[format]` | `[cardId]` | `{ name, format }` |
| `OWNERSHIP` | `CARD_NOT_OWNED` | error if `ownedOnly`, else warning | `count > available` | `[cardId]` | `{ name, needed, available }` |

**Basic energy** is `supertype === 'Energy' && subtypes.includes('Basic')`. It is
removed *before* grouping by name, so the 15 special `Metal Energy` printings
are limited among themselves and a deck's basic `Metal Energy` never counts
against them.

**`available`** is `InventoryService.availableQuantities(ownerId, cardIds,
tx)` — `quantity − lockedQuantity`, so copies promised to a pending trade do
not count. A card absent from the map is `0`. Ownership is per printing
(`cardId`), because inventory is.

**An empty deck** raises only `DECK_SIZE_MISMATCH` (`actual: 0`).

**A format the cards do not know** — possible only for rows written before
`DeckFormatSchema` existed — makes every card `CARD_LEGALITY_UNKNOWN`. The
engine does not reject the format; it reports what it cannot confirm.

---

## `DeckValidation` — the contract

In `packages/shared/src/entities/deck.ts`.

```ts
export const DECK_RULES = ['DECK_SIZE', 'COPY_LIMIT', 'FORMAT_LEGALITY', 'OWNERSHIP'] as const;
export const DECK_ISSUE_CODES = [
  'DECK_SIZE_MISMATCH', 'COPY_LIMIT_EXCEEDED',
  'CARD_BANNED', 'CARD_NOT_LEGAL', 'CARD_LEGALITY_UNKNOWN',
  'CARD_NOT_OWNED',
] as const;

DeckIssueSchema = z.object({
  severity: z.enum(['error', 'warning']),
  rule: z.enum(DECK_RULES),
  code: z.enum(DECK_ISSUE_CODES),
  cardIds: z.array(CardIdSchema),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
  message: z.string(),
});

DeckValidationSchema = z.object({
  valid: z.boolean(),                // no issue of severity 'error'
  format: z.string(),
  ownedOnly: z.boolean(),
  deckSize: z.object({ expected: int, actual: int }),
  rules: z.array(z.object({ rule, ok: z.boolean(), errors: int, warnings: int })),
  issues: z.array(DeckIssueSchema),
});

DeckSaveResultSchema = DeckDetailSchema.extend({ validation: DeckValidationSchema });
```

- **`rules`** always holds the four rules in the order above — the
  DeckValidationBanner's checklist rows. `ok` is `errors === 0`: a warning
  never fails a rule.
- **`issues`** are sorted by rule order, then by first `cardId`, then by
  `code`. With `rules` fixed and the inputs read in a stable order, the same
  deck and inventory give a byte-identical response.
- **`code` + `params` are the localisable part.** `message` is an English
  fallback for logs and API clients — `"Charizard has 5 copies; at most 4 are
  allowed"` — and may be reworded; the client branches on `code`, as with the
  error envelope.
- **`cardIds` is the field address.** The builder highlights those rows; an
  issue with `[]` is about the whole deck.
- `DeckSchema` gains `ownedOnly`; `CreateDeckSchema` takes `ownedOnly`
  (default `false`); `UpdateDeckSchema` takes it as optional.

---

## Components

| Unit | Does | Depends on |
| --- | --- | --- |
| `decks/deck-validator.ts` | `validateDeck(input): DeckValidation` — pure. The four rule functions, the sort, the `rules` rows, the messages | `@pokedrop/shared` only |
| `decks/deck-validation.service.ts` | `DeckValidationService.validate(deckId, client)` — one Prisma read of the deck with its cards, never a read per card (`name`, `supertype`, `subtypes`, `legalities`, `count`), `availableQuantities` for the owner, `DECK_SIZE` from config; hands them to `validateDeck` | Prisma, `InventoryService`, `APP_CONFIG` |
| `decks/decks.service.ts` | `create`, `update`, `clone` call `validate(id, tx)` after their writes, inside their transaction, and return `DeckSaveResult`. `clone` moves into a transaction for this. New `validate(user, id)` with PATCH's 404/403 rule | the above |
| `decks/decks.controller.ts` | `POST /decks/:id/validate` → 200 | — |
| `decks/decks.module.ts` | imports `InventoryModule` (already exports `InventoryService`) | — |

`validateDeck` takes:

```ts
type ValidationCard = {
  cardId: string; count: number; name: string;
  supertype: string; subtypes: string[]; legalities: Record<string, string>;
};
type ValidationInput = {
  format: string; ownedOnly: boolean; deckSize: number;
  cards: ValidationCard[];            // ordered by cardId
  available: Map<string, number>;
};
```

`legalities` is parsed with the existing `LegalitiesSchema`; a value that fails
the parse is treated as `{}` — unknown, a warning.

---

## `POST /decks/:id/validate`

No body. 200 with `DeckValidation`. Writes nothing.

| Case | Answer |
| --- | --- |
| the caller's deck | 200 |
| a private deck not the caller's, or no such deck | 404 `Deck not found` |
| a public deck not the caller's | 403 `Insufficient permissions` |
| signed out | 401 |

The same lookup as PATCH: `assertVisible`, then `assertOwner`.

---

## The save path

```
withTransaction(tx):
  PD-63's writes (create / update / clone), unchanged
  validation = DeckValidationService.validate(id, tx)
  detail     = the deck read as PD-63 reads it
return { ...detail, validation }
```

Reading inside the transaction makes the verdict describe exactly the rows the
response returns. It adds two short reads — the decklist with card fields, and
the owner's inventory rows for those cards — to a transaction that already
holds the deck row lock; nothing here takes another lock.

`GET /decks/:id`, `/decks/:id/stats`, `/users/:id/decks` and `GET /decks`
carry no `validation` (decision 5, and a list would cost a validation per
deck).

---

## Verification plan

Through HTTP against the running API, database checked after each step, probe
users deleted at the end — the method PD-63/66/67 used. No test files.

1. **Copy limit.** 5 × a non-energy card → `COPY_LIMIT_EXCEEDED`,
   `valid: false`. 5 × a basic energy → no copy issue. 5 × a special energy
   → `COPY_LIMIT_EXCEEDED`. 4 + 1 Pikachu from two sets → one issue whose
   `cardIds` holds both printings. 4 special `Metal Energy` + 10 basic `Metal
   Energy` → no copy issue.
2. **Size.** 59 and 61 copies → `DECK_SIZE_MISMATCH` with `actual` 59 / 61;
   60 → the `DECK_SIZE` row `ok`. `DECK_SIZE=40` in the environment → 40 is
   right.
3. **Legality.** In `expanded`, a card whose `expanded` is `Banned` →
   `CARD_BANNED`; in `standard`, a `Not Legal` card → `CARD_NOT_LEGAL` with
   `status`; a `me55` card → `CARD_LEGALITY_UNKNOWN` as a warning and the
   `FORMAT_LEGALITY` row still `ok`.
4. **Mode.** One deck with a card the owner does not have: theorycrafting →
   `CARD_NOT_OWNED` warning, `OWNERSHIP` `ok`; `PATCH {ownedOnly: true}` →
   the same issue as an error, `valid: false`, and `deck_cards` hashed
   identical before and after the PATCH. A card the owner holds 2 of with 1
   locked (`lockedQuantity` set in the probe) and 2 in the deck →
   `CARD_NOT_OWNED { needed: 2, available: 1 }`.
5. **Save reports, never refuses.** A PATCH producing each error above → 200,
   rows written, `validation` in the body matching a following
   `POST /validate`.
6. **Determinism.** Two `POST /validate` in a row → byte-identical bodies;
   `decks`, `deck_cards` and `inventory_items` hashed identical before and
   after.
7. **Access.** Another member's private deck → 404, public → 403; signed out
   → 401; `GET /decks/:id` and the public shelf carry no `validation`.
8. **Clone.** Cloning a strict public deck the cloner owns nothing of → 201,
   `ownedOnly: true` copied, `CARD_NOT_OWNED` errors computed against the
   cloner's inventory.

---

## Files

| Path | Change |
| --- | --- |
| `apps/api/prisma/schema.prisma` | `Deck.ownedOnly` |
| `apps/api/prisma/migrations/*_deck_owned_only/` | new — add the column |
| `apps/api/src/config/env.schema.ts`, `app.config.ts`, `.env.example` | `DECK_SIZE` |
| `packages/shared/src/entities/deck.ts` | `ownedOnly`, `DeckValidation`, `DeckSaveResult`, rule and code lists |
| `apps/api/src/decks/deck-validator.ts` | new — the pure engine |
| `apps/api/src/decks/deck-validation.service.ts` | new — the loader |
| `apps/api/src/decks/decks.service.ts`, `decks.controller.ts`, `decks.module.ts` | save path, `validate`, wiring |
| `docs/API.md` (Decks), `docs/DataModel.md` (Deck) | the contract, the rules, the measured results |

---

## Out of scope

- ACE SPEC, Radiant and Prism Star limits (decision 7).
- Validating an unsaved draft (decision 4).
- Persisting validity, or showing it on lists or public reads (decisions 1, 5).
- Decks reserving inventory: a deck never raises `lockedQuantity`; two decks
  may use the same copies (PRD §14).
- Translations of `code`s — the frontend's.
