# PD-51 — The prices read API

Design, 2026-09-23. Milestone M4 · Price Sync.

Ticket: [PD-51](https://linear.app/mstrilec/issue/PD-51/prices-read-api-latest-price-and-30-day-sparkline-history) ·
Reference: `docs/API.md` (Prices) · `docs/PRD.md` §5.4 · §15 ·
[PD-48's write path](2026-09-21-pd-48-price-sync-write-path-design.md).

The read side of M4. Three tickets have written prices; this is the first that
gives them back.

---

## Measured before designing

Against the real database and the running stack, 2026-09-23.

| Probe | Result |
| --- | --- |
| `price_snapshots` | **0 rows, 0 distinct cards** |
| `cards` with `latestPriceUsd` | **12**; with `latestPriceEur` **0** |
| `cache:price:*` keys in Redis | **0** |
| `cache:card:*` keys in Redis | 0 |
| `apps/api/src/prices/` | does not exist |
| indexes on `price_snapshots` | `(cardId, capturedAt)`, and the unique `(cardId, source, capturedOn)` |
| `config.cache.ttl.cardPrice` | 3 600 seconds |

Two of these shape the ticket.

### This is the first reader of a key three writers already delete

`cacheKeys.cardPrice(id)` has existed since PD-48. PD-48's processor deletes it
after every batch, PD-49's sweep and PD-50's active refresh reach the same delete
through `PriceBatchService`, and `docs/Architecture.md` §8 has listed its TTL
since M0.

**Nothing has ever created one.** The measurement above is not an accident of
timing: no code path in `apps/api/src` writes that key, which is why three
invalidation sites have been deleting nothing for three tickets.

This ticket closes the loop, and it closes it without adding an invalidation
contract — the writers already do their half. That is the whole reason the
latest-price endpoint is cheap here and would have been expensive anywhere else.

### The history table is empty, and one real run cannot fill it

`price_snapshots` holds nothing. The daily cap means a real price run produces at
most **one** row per card per source, so even running the sweep would give a
one-day series against a thirty-day window.

The endpoint is still fully specifiable — the query, the shape and the gap
semantics do not depend on how many rows exist — but **its acceptance criteria
cannot be demonstrated on today's data**, and the verification plan below says
how that is handled rather than leaving it to whoever implements it.

---

## `GET /cards/:id/price`

```json
{ "cardId": "base1-4", "usd": 412.95, "eur": 289.4, "priceUpdatedAt": "2026-09-22T03:14:07.221Z" }
```

All four fields nullable. Cached under `cacheKeys.cardPrice(id)` at
`config.cache.ttl.cardPrice`, through `CacheService.getOrSet` **with its Zod
schema passed** — JSON has no date type, so without the schema a warm read
returns `priceUpdatedAt` as a string where a cold read returns a `Date`, and the
two responses stop being identical. `CatalogService.getCard` carries the same
note for the same reason.

### Staleness is an absolute timestamp, never a computed age

The ticket asks that the response "carry staleness so the UI can render
'updated X ago'". The obvious reading — a field like `updatedSecondsAgo: 300` —
is wrong here, and specifically wrong **because the response is cached**.

A relative age is computed once, at the moment the loader runs, and then served
from Redis for up to an hour. Forty minutes later it still says 300 and is wrong
by forty minutes. The number would be least accurate exactly when the data is
most stale, which is the case the field exists to expose.

`priceUpdatedAt` is absolute, so it survives caching unchanged and the client
renders the relative phrasing from it. That is the requirement met, not avoided.

### 404 for a card that does not exist, 200 for one never priced

The ticket's third criterion: "a card that has never been price-synced returns
nulls with a clear indicator, not a 404."

So the two cases must be told apart, and the row is what tells them apart:

| Case | Response |
| --- | --- |
| no such card id | **404**, the standard error envelope |
| card exists, never priced | **200**, `usd`, `eur` and `priceUpdatedAt` all `null` |
| card exists and is priced | 200 with values |

`priceUpdatedAt: null` **is** the clear indicator. A separate boolean would be a
second way of saying the same thing, and two sources of truth for one fact is
how they drift.

`CatalogService.getCard` already establishes the mechanism: the loader throws
`NotFoundException` from inside `getOrSet`, so the rejection propagates and
**absence is never cached**. That is deliberate — a 404 is one primary-key
lookup, and caching negatives invites filling the cache with invented ids.

**The never-priced response, by contrast, is cached normally.** It is an object
whose fields are null, not a null response, so it does not meet the trap
`docs/Foundation.md` records — `getOrSet` cannot cache a bare `null`, because a
stored `null` reads back as a miss and the loader re-runs on every request.
Nothing here should be "simplified" into returning `null` for an unpriced card.

---

## `GET /cards/:id/price/history?days=30`

```json
{
  "cardId": "base1-4",
  "windowDays": 30,
  "series": {
    "TCGPLAYER":  { "currency": "USD", "points": [{ "capturedOn": "2026-09-20", "market": 412.95 }] },
    "CARDMARKET": { "currency": "EUR", "points": [] }
  }
}
```

Two named series, because a card's history is two interleaved ones — TCGplayer in
USD and Cardmarket in EUR — and `PriceSnapshot.source` is what distinguishes
them. A client drawing a sparkline wants one line per series and should not have
to group the rows itself.

**`market` only.** `low`, `mid` and `high` are on the row, and a sparkline draws
none of them. Carrying them would quadruple the payload for data nothing asked
for; the card detail page in `docs/PRD.md` §5.4 wants a line and two current
figures.

### A gap is an absent point

The first acceptance criterion — "history for a card with sparse snapshots
returns gaps honestly, not interpolated values" — is satisfied by the shape
rather than by a check. A day with no snapshot has no point. There is no value to
interpolate because there is no slot to put one in, and a series with two points
thirty days apart is two points, not thirty.

A card with no snapshots at all returns both series present and empty, which is
the same statement made about a card rather than about a day.

### Queried on `capturedAt`, reported as `capturedOn`

The range predicate runs against `capturedAt`, because `(cardId, capturedAt)` is
the index that serves it. The point's label is `capturedOn` — the materialised
UTC date PD-48 added, which is the axis a daily sparkline actually plots and is
already a date rather than an instant.

Both columns are on the row, so this costs nothing and avoids the client
re-deriving a day boundary that the database already agreed on.

### `days` is bounded

Configurable per the ticket, defaulted to **30**, validated with a floor of **1**
and a ceiling of **365**. An unbounded window would let one request ask for the
whole series of the fastest-growing table in the system, which
`docs/DataModel.md` already names as the partitioning candidate. A year is chosen
because the daily cap makes it at most 730 points per card, which is still one
small response, and because nothing in the product asks to look further back.

### Both series are always present

A card with snapshots from only one marketplace still returns both keys, the
other with an empty `points` array. An absent key would mean "this marketplace
does not exist", and the thing being said is "this marketplace has no data for
this card in this window" — which is what an empty array says.

**`currency` is a constant of the source, not a value read from a row.**
`TCGPLAYER` is `USD` and `CARDMARKET` is `EUR`, mapped in code. It has to be a
constant because an empty series has no row to read it from, and a field that
appears only when data happens to exist is a field a client cannot rely on.

---

## The history endpoint is not cached, and that is a decision

The latest-price endpoint is cached because the ticket requires it and because
three writers already invalidate the key. History is not, for three reasons in
order of weight:

1. **A fourth key would need a fourth invalidation site.** `PriceBatchService`
   currently deletes two keys per card. Caching history means every price write
   must delete a third, and the three jobs that reach that service would all
   inherit the obligation — for a query that reads at most sixty rows through a
   covering index.
2. **The data barely moves.** The daily cap means a card's series changes at most
   once per source per day, so a cache would serve the same bytes it would have
   computed, at the cost above.
3. **The ticket asks for caching on the latest price only**, and says nothing
   about history.

This is the decision in this spec most worth arguing with. If the card detail
page later proves to be hot enough that the query matters, adding the key is
mechanical — and it will then be adding a cache to a measured problem rather than
to an imagined one.

---

## Decimal at the boundary

`latestPriceUsd`, `latestPriceEur` and `PriceSnapshot.market` are
`Decimal(10, 2)`. Prisma returns a `Decimal`, and `JSON.stringify` turns it into
a **string**, so a response built from raw rows fails its own schema.

Conversion happens at the boundary, as `CatalogService` already does with its
module-private `toNumber`. PD-46 measured what missing it costs: `CardSchema`
rejected every cached card, and the cache silently never served one — a defect
that presents as mild slowness rather than as an error.

The helper is three lines and is duplicated rather than shared, matching how
`catalog.writer.ts` and `price.writer.ts` sit beside each other, and how the two
providers' `http.ts` files do. The mechanism matches; the module boundary is
worth more than the three lines.

---

## Shape

```
prices/prices.controller.ts   two routes, both @Public()
prices/prices.service.ts      the two reads, the cache, the Decimal boundary
prices/prices.dto.ts          the `days` query DTO, via createZodDto
```

A new module rather than two more routes on `CatalogController`, because
`docs/Architecture.md` §4 lists `prices/` as its own and because the catalog
controller already carries the note about `facets` being moved out of `cards/` to
escape route shadowing — a file that has had to think about its own route table
once should not grow a second concern.

Shared contracts — `CardPriceSchema`, `PriceHistorySchema` — live in
`packages/shared/src/entities/price.ts` beside the existing `PriceSnapshotSchema`,
because the frontend imports them in M13.

---

## Verification plan

No automated tests (`docs/PRD.md` §20). Measurements against the running stack.

The table is empty, so most of these need data that does not exist yet. Snapshots
are **seeded back-dated with deliberate gaps**, measured against, and removed;
the baseline afterwards is `price_snapshots` at 0.

1. **A priced card returns its figures**, with `usd`, `eur` and `priceUpdatedAt` matching the row. One of the 12 cards carrying a USD price is the natural subject, and it also exercises a real `eur: null`.
2. **An unpriced card returns 200 with three nulls** — not a 404, and not an empty body.
3. **A card id that does not exist returns 404** in the standard envelope, and **leaves no cache key behind** — absence must stay uncached.
4. **The latest price is served from cache on the second read.** Measured by reading twice and confirming the key exists in Redis between them, and that the two responses are byte-identical — the cold-versus-warm check PD-46 established, which is what catches a missing Zod schema.
5. **The cache key is the one the writers delete.** Read a price to create `cache:price:card:{id}`, run one price batch over that card, confirm the key is gone. This is the loop three tickets have been half-completing.
6. **History returns gaps as absent points.** Seed snapshots on, say, day −30, −20 and −2 for one source, read the window, and confirm exactly three points come back with those dates and no filler between them.
7. **A card with no snapshots returns both series empty**, not a 404 and not a missing `series` key.
8. **`days` is honoured and bounded.** A narrower window excludes older points; a request beyond the ceiling is rejected rather than served.
9. **Decimal arrives as a number.** `typeof` on `usd` and on a point's `market` is `number`, not `string`, on both a cold and a warm read.
10. **Gates.** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`.

Point 5 is the one this ticket exists to make true, and it is the only one that
spans two tickets' code.

---

## Files

**New**

| Path | Holds |
| --- | --- |
| `apps/api/src/prices/prices.controller.ts` | the two routes |
| `apps/api/src/prices/prices.service.ts` | the reads, the cache, the boundary conversion |
| `apps/api/src/prices/prices.dto.ts` | the `days` query DTO |
| `apps/api/src/prices/prices.module.ts` | wiring |
| `apps/api/src/prices/index.ts` | the module's public surface |

**Edited**

| Path | Change |
| --- | --- |
| `packages/shared/src/entities/price.ts` | `CardPriceSchema`, `PriceHistorySchema` and their points |
| `apps/api/src/app.module.ts` | import `PricesModule` |
| `docs/API.md` | the two responses, the staleness rule, the 404-versus-nulls rule |
| `apps/api/src/sync/README.md` | note that the price cache key now has a reader |

No migration. Nothing here changes the schema.

---

## Out of scope

| Not here | Where |
| --- | --- |
| A per-card on-demand refresh and its cooldown | PD-52 |
| Rendering the sparkline | M13, `docs/InformationArchitecture.md` |
| `low`, `mid` and `high` in any response | nothing asks for them yet |
| Caching the history query | when it is measured to matter |
| Downsampling or partitioning the series | `docs/DataModel.md` names it as the growth plan, not as work |
| Currency conversion between USD and EUR | never — the two are independent marketplaces, not a conversion |

---

## Forward notes

**PD-52 will want the same cache key.** An on-demand refresh that returns the
current figures should read through this service rather than re-implementing the
read, so the cooldown response and the ordinary response cannot drift.

**The history payload is M13's contract.** Two named series with dated points is
the shape the card detail page will bind to, and changing it later means changing
a component as well as an endpoint.

**The series is the table that grows.** At two sources a day per card, a fully
priced catalog adds roughly 41 000 rows a day. The thirty-day window keeps a
single response small regardless, but `docs/DataModel.md`'s note about
partitioning is about this table and this ticket is the first thing that reads it
at all.
