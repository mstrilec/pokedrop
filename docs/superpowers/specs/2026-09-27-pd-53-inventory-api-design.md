# PD-53 — The inventory read API

Design, 2026-09-27. Milestone M5 · Inventory.

Ticket: [PD-53](https://linear.app/mstrilec/issue/PD-53/inventory-api-owned-cards-with-filters-sorting-and-pagination) ·
Reference: `docs/API.md` (Inventory) · `docs/PRD.md` §5.2 · §18 ·
`docs/Architecture.md` §8, §10 · first consumer:
[PD-107](https://linear.app/mstrilec/issue/PD-107/inventory-page-virtualized-grid-and-list-with-filters-and-instant).

The first read over user property rather than over the mirror. The catalog and
price reads answer the same bytes to everyone; this one answers a different
collection to every caller, and must never answer anyone else's.

---

## Measured before designing

Against the local database, 2026-09-27.

| Probe | Result |
| --- | --- |
| `cards` | 20 670 rows, 4 454 distinct names |
| `cards` with `latestPriceUsd` | **16**; with `latestPriceEur` 8 |
| `inventory_items` | 7 rows across 8 users, at most 3 per user |
| indexes on `inventory_items` | pkey `(id)`, unique `(userId, cardId)`, `(cardId)` |
| `apps/api/src/inventory/` | does not exist |
| generated client | `CardOrderByWithRelationInput.latestPriceUsd` accepts `{ sort, nulls }`; `InventoryItemOrderByWithRelationInput.card` exists |

Two of these shape the ticket.

### A price sort is almost entirely the NULL branch

16 priced cards out of 20 670 means that on real data, sorting by price puts
nearly every row in the "no price" tail. The NULL handling in the keyset is not
an edge case here — it is the main path, and the verification plan exercises it
deliberately.

### No collection is large enough to measure

The largest inventory is three rows. The 5 000-row acceptance criterion has to be
measured on a probe user created for the purpose and removed afterwards.

---

## Decisions

Taken during brainstorming, 2026-09-27:

| Question | Decision |
| --- | --- |
| Pagination model | **Keyset cursor**, not offset |
| Meaning of "owned-count" | `minQuantity`: rows with `quantity >= N` |
| Server-side name search | **Yes**, `q`, same rules as the catalog |
| Card data per row | A **slim** projection of `Card`, not the whole card |
| Keyset mechanics | Value-carrying cursor, query built with Prisma (below) |
| Performance budget | **≤ 100 ms** server time, `pageSize=100`, 5 000 rows, every sort |
| `toNumber` | Lifted into `common/`, reversing PD-51 (see "Decimal at the boundary") |

### Why a keyset cursor

An inventory changes while it is being scrolled — a pack opened in another tab
adds rows, a settled trade removes them. Offset pagination then shows one row
twice or skips one, and PD-107 is a virtualized infinite scroll where that is
visible. The ticket asks for a cursor, and `pagination.ts` left `nextCursor` as
the escape hatch for exactly this (see PD-45's spec, "Forward notes").

### Why the cursor carries values, not a row reference

Prisma's built-in `cursor: { id }` re-reads the cursor row to find its sort
values. A trade settlement deletes a row whose quantity reaches zero, and a
cursor naming a deleted row breaks pagination mid-scroll. A cursor that carries
the sort value and the tiebreak id needs no row to exist.

Raw SQL with a row-value comparison `(price, id) < ($1, $2)` was rejected: a NULL
in the tuple makes the comparison NULL, so it needs a `COALESCE` sentinel;
dynamic filters would be assembled from `Prisma.sql` fragments; and the result
loses its type. Raw SQL in this codebase is for what Prisma cannot express, and
this it can.

---

## `GET /inventory`

Member-only, protected by the global `SessionGuard` (no `@Public()`). The caller
comes from `@CurrentUser()` and nowhere else; no parameter names a user.

### Query — `InventoryQuerySchema`

| Parameter | Rule |
| --- | --- |
| `cursor` | optional, opaque, 1–512 chars |
| `pageSize` | 1–`MAX_PAGE_SIZE` (100), default `DEFAULT_PAGE_SIZE` (24) |
| `q` | optional, trimmed, 1–100 chars; case-insensitive contains on card name |
| `set` | optional, trimmed, 1–64 chars; exact `setId` |
| `rarity` | optional, trimmed, 1–64 chars; exact rarity |
| `type` | optional, trimmed, 1–32 chars; array containment on `types` |
| `minQuantity` | optional, coerced integer ≥ 1; `quantity >= N` |
| `sort` | `acquired_desc` (default) · `acquired_asc` · `name_asc` · `name_desc` · `price_desc` · `price_asc` |

`q`, `set`, `rarity` and `type` use the same bounds as `CardSearchQuerySchema`.
No `page` parameter: a keyset has no page numbers.

- **`acquired_desc` is the default** because the moment someone looks at their
  collection most is right after opening a pack.
- **Price means `latestPriceUsd`.** Collection value (PD-54) is in USD, and a
  sort over two currencies has no single order. `latestPriceEur` is still
  returned on every row for display.
- **Unpriced cards sort last in both directions.** "Cheapest first" should not
  open on 20 000 cards with no price.

### Response — `cursorPageOf(InventoryEntrySchema)`

```json
{
  "items": [
    {
      "id": "clx…",
      "cardId": "base1-4",
      "quantity": 2,
      "lockedQuantity": 1,
      "availableQuantity": 1,
      "acquiredAt": "2026-09-27T10:15:00.123Z",
      "card": {
        "id": "base1-4",
        "setId": "base1",
        "name": "Charizard",
        "supertype": "Pokémon",
        "subtypes": ["Stage 2"],
        "types": ["Fire"],
        "hp": 120,
        "rarity": "Rare Holo",
        "imageSmall": "https://…",
        "latestPriceUsd": 350.0,
        "latestPriceEur": null,
        "priceUpdatedAt": "2026-09-26T03:00:00.000Z"
      }
    }
  ],
  "pageSize": 24,
  "total": 1,
  "nextCursor": null
}
```

- **`cursorPageOf(item)`** is new in `primitives/pagination.ts`, beside `pageOf`:
  `{ items, pageSize, total, nextCursor: string | null }`. `pageOf` cannot be
  reused — its `page` and `totalPages` are required and mean nothing to a keyset.
- **`total`** counts the rows matching the current filters. PD-107 needs it for
  the virtual scroll height and the "N cards" label.
- **`nextCursor: null`** means the end of the list.
- **`InventoryEntrySchema`** is `InventoryItemSchema` without `userId` (it is
  always the caller), extended with `card: InventoryCardSchema`.
- **`InventoryCardSchema`** is `CardSchema.pick` of the twelve fields above:
  what CardTile, the dense DataTable and Fuse.js need. `supertype` and `subtypes`
  are there for the energy exemption the deck pool (M7) will need. Everything
  else is on the cached `GET /cards/:id`. The full card is roughly 5–10× the
  bytes per row.
- **`availableQuantity`** is `quantity − lockedQuantity`, computed in the mapper.
  PD-55 moves that definition into one shared place.

### Errors

| Case | Response |
| --- | --- |
| no session | 401, from `SessionGuard` |
| invalid query parameter | 400, from the Zod pipe |
| cursor that does not decode, or fails its schema | 400 `Invalid cursor` |
| cursor issued under a different `sort` | 400 `Invalid cursor` |

A cursor reused after the **filters** change is not an error: it positions the
new result set at the same sort value. The client resets the cursor when a
filter changes; the server does not bind cursors to filters.

---

## The keyset

### The cursor

`inventory.cursor.ts` owns encoding and decoding.

- Payload `{ s, v, id }`: the sort it was issued under, the last row's sort
  value, and that row's inventory item id.
- `v` is always a string or `null`:
  - price — the decimal as a string (`"15.60"`), so no float enters the
    comparison;
  - name — as stored;
  - `acquiredAt` — ISO 8601. The column is `TIMESTAMP(3)`, so milliseconds
    round-trip exactly and equality on the tie holds.
- Encoded as base64url of the JSON. Decoded with a Zod schema; anything that
  fails, or whose `s` differs from the request's `sort`, is a 400.

The cursor carries no user id. It can only move a position within the caller's
own rows, never widen them (see "Isolation").

### Order

`[{ K: dir, nulls: 'last' }, { id: dir }]`, where `K` is `acquiredAt` on the
inventory row, or `card.name` / `card.latestPriceUsd` through the relation.
`nulls` is only passed for price; `name` and `acquiredAt` are `NOT NULL`.

The `id` tiebreak is load-bearing: 16 216 of 20 670 cards share a name with
another, and a bulk mint gives many rows one `acquiredAt`. Without it,
PostgreSQL may order ties differently between two requests.

### "After the cursor"

For direction `dir`, "beyond" means `lt` for `desc` and `gt` for `asc`.

- `v` not null: `OR[ K beyond v ; K = v AND id beyond cursor.id ; K IS NULL ]`.
  The third branch exists only for price, because the NULL tail comes after
  every priced row in both directions.
- `v` null (price only): `K IS NULL AND id beyond cursor.id`.

`K` on a card field is expressed through `card: { is: { … } }`.

### The query

```
where = AND[ { userId: caller }, filters, afterCursor ]
```

- `userId` is its own element of the `AND`, so no filter or cursor branch can be
  combined with it into something wider.
- Filters: `quantity: { gte: minQuantity }` on the row; `q`, `set`, `rarity` and
  `type` through `card: { is: { … } }`, matching the catalog's semantics.
- `findMany({ where, orderBy, take: pageSize + 1, select })` and
  `count({ where: without afterCursor })` run under `Promise.all`.
- **Three SQL statements per request, whatever the page size:** the page of
  inventory rows, the cards for that page in one batched
  `SELECT … FROM cards WHERE id IN (…)`, and the count. Never a query per row.
  Measured while planning: Prisma 7.10 without the `relationJoins` preview loads
  a nested `select` as that second batched statement rather than as a `JOIN` —
  `take: 1` and `take: 3` each produced exactly two statements for the
  `findMany`. The sort's own `LEFT JOIN cards` is inside the first statement.
- If `pageSize + 1` rows come back, the extra row is dropped and `nextCursor` is
  built from the last row kept.

`count` and `findMany` are not wrapped in a transaction. Under a concurrent
mutation `total` may be off by the rows that changed between the two reads,
which a scroll corrects on the next page; a transaction would buy nothing a user
could see.

### Not cached

For the same reason catalog search is not: a user times six sorts times every
filter combination is high cardinality with a low repeat rate, and this data is
the most volatile a user owns. `docs/Architecture.md` §8 names no key for it.

### Indexes

No migration by default. Every query is bounded by `userId`, the leading column
of the unique `(userId, cardId)` index, and sorting a few thousand rows in memory
costs milliseconds. `(userId, acquiredAt)` is the first index to add if the
measurement below misses the budget, and only then.

---

## Isolation

The third acceptance criterion — another user's inventory is never reachable —
holds by construction:

1. The route has no user parameter; `userId` comes from `@CurrentUser()`.
2. `userId` is a separate `AND` element that no other clause can widen.
3. The cursor carries no user id. A cursor built by hand around another user's
   item id only positions the caller's own rows at that id's sort value.

`assertOwner` is not needed: there is no resource id to check ownership of, only
a filter that is always the caller.

---

## Decimal at the boundary

`catalog.service.ts` and `prices.service.ts` each carry a private
`toNumber(value: unknown): number | null`. This ticket needs a third. Instead,
it moves to `apps/api/src/common/decimal.ts` and all three import it — a
targeted cleanup of code this ticket touches, not a refactor.

**This reverses a recorded decision.** PD-51 kept a second copy on purpose:
"three lines are worth less than the module boundary". That held at two copies.
At three it no longer does, and the boundary argument is weak for `common/`,
which every module already imports (`ownership.ts`, `zod-dto.ts`, the pipes).
Confirmed with the owner on 2026-09-27; the rationale comment in
`prices.service.ts` goes with the copy.

Every row leaves through `InventoryEntrySchema.parse`, as catalog rows leave
through `CardSchema`, so undeclared columns cannot leak.

---

## Verification plan

No automated tests during v1. Verification is a one-off probe script in the
session scratchpad, not committed; its results go into `docs/API.md`, as PD-45
through PD-52 did.

### Probe data

- A probe user with **5 000** inventory rows over distinct mirrored cards,
  including all 16 priced cards.
- Deliberate ties: rows sharing a card name, rows sharing one `acquiredAt`.
- Equal-price ties need more than 16 priced cards. The probe sets
  `latestPriceUsd` on a handful of its chosen cards that are currently NULL,
  giving some of them one shared value, and **restores them to NULL** at the
  end. The next price sync would overwrite them anyway, but the probe leaves the
  mirror as it found it.
- A second probe user with a few rows, for isolation.
- Both users and all their rows are deleted at the end.

### Checks

1. **Budget.** Server time for `pageSize=100`, first page and a deep page, for
   each of the six sorts, with and without filters: **≤ 100 ms**. The SQL Prisma
   emits is run under `EXPLAIN ANALYZE` and its plan recorded.
2. **Constant query count.** Prisma query events logged at `pageSize` 1, 24
   and 100: exactly 3 statements each time.
3. **Keyset correctness.** For each of the six sorts, walk the whole list at
   `pageSize=7`. The union of pages equals `total`; no id repeats; the order is
   monotone under `(K, id)`; unpriced rows come strictly last for both price
   sorts.
4. **Mutation mid-scroll.** Delete the row a cursor was built from; the next
   page continues from the right place.
5. **Isolation.** The second user never sees the first user's rows; a hand-built
   cursor around the first user's item id returns only the second user's rows;
   no session is a 401.
6. **Errors.** A garbage cursor is a 400; a cursor issued under `name_asc` sent
   with `price_desc` is a 400.
7. `typecheck`, `lint` and `build` pass.

If check 1 misses the budget, the index named under "Indexes" is added in its
own migration and the check re-run before anything else changes.

---

## Files

| File | Change |
| --- | --- |
| `packages/shared/src/primitives/pagination.ts` | `cursorPageOf`, `CursorPage<T>` |
| `packages/shared/src/entities/inventory.ts` | `InventorySortSchema`, `InventoryQuerySchema`, `InventoryCardSchema`, `InventoryEntrySchema`, `InventoryPageSchema` and types |
| `apps/api/src/common/decimal.ts` | new; `toNumber` lifted from catalog and prices |
| `apps/api/src/catalog/catalog.service.ts` | import `toNumber` |
| `apps/api/src/prices/prices.service.ts` | import `toNumber` |
| `apps/api/src/inventory/inventory.cursor.ts` | new; encode, decode, sort check |
| `apps/api/src/inventory/inventory.service.ts` | new; query building and mapping |
| `apps/api/src/inventory/inventory.controller.ts` | new; `GET /inventory` |
| `apps/api/src/inventory/inventory.dto.ts` | new; `InventoryQueryDto` |
| `apps/api/src/inventory/inventory.module.ts`, `index.ts` | new |
| `apps/api/src/app.module.ts` | register `InventoryModule` |
| `docs/API.md` | Inventory section: parameters, cursor semantics, measurements; drop "+ aggregates" from `/inventory` |
| `docs/DataModel.md` | only if an index is added |

---

## Out of scope

- **Aggregates** — totals, value, set completion: PD-54, `GET /inventory/summary`.
  `docs/API.md` currently says `/inventory` returns "aggregates"; that line is
  corrected here.
- **Lock and release helpers** and the single definition of
  `availableQuantity`: PD-55.
- **Viewing another user's inventory** (trade composer, public profiles): M8/M9,
  behind their own routes and privacy rules.
- **Filter facets scoped to the caller's inventory.** PD-107's FilterBar can use
  the global `GET /facets` for now.
- **Fuzzy search.** `q` is a case-insensitive contains, like the catalog;
  `pg_trgm` remains the recorded upgrade.

---

## Forward notes

- **PD-55** should replace the mapper's inline `quantity − lockedQuantity` with
  its shared definition; the response field does not change.
- **PD-54** reads the same rows in aggregate and does not depend on this
  endpoint's cursor.
- **PD-107** must drop the cursor whenever a filter or the sort changes. The
  server rejects a cursor from another sort, but it cannot tell that filters
  changed.
