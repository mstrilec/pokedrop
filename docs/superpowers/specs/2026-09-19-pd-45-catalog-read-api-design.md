# PD-45 — The catalog read API

Design, 2026-09-19. Milestone M3 · Catalog Mirror & Sync.

Ticket: [PD-45](https://linear.app/mstrilec/issue/PD-45/catalog-read-api-card-search-card-detail-set-list-and-set-detail) ·
Reference: `docs/API.md` (Catalog) · `docs/Architecture.md` §6 (read path).

The first public read surface this project has. Four routes over the mirror
[PD-42](https://linear.app/mstrilec/issue/PD-42/catalog-sync-processor-batched-upsert-of-sets-and-cards)
filled, and none of them may reach an external API.

Taken after PD-42 rather than before it deliberately: every measurement below is
against the real 20 670-card catalog, not against twelve seeded rows.

---

## Measured before designing

`EXPLAIN (ANALYZE)` against the live table on 2026-09-19, after `ANALYZE cards`.

| Query | Plan | Time |
| --- | --- | --- |
| `"setId" = 'base1'` | Bitmap Index Scan on `cards_setId_idx` | — |
| `"setId" + rarity` | **BitmapAnd** of both btrees | — |
| `types @> ARRAY['Fire']` | Index Scan on name, `types` as a filter | — |
| `name ILIKE '%blastoise%'` | Index Scan on name + filter | 0.84 ms |
| `name ILIKE '%char%' AND "setId" = 'base1'` | BitmapAnd on `setId`, then filter | 0.37 ms |
| **`name ILIKE '%zzzznotacard%'`** | **Seq Scan, 20 670 rows filtered** | **9.0 ms** |
| `count(*)` with an `ILIKE` predicate | Index Only Scan, 20 403 filtered | 8.2 ms |

Two of these confirm predictions `docs/DataModel.md` already recorded. The
`setId + rarity` filter plans as a `BitmapAnd` exactly as written there, and the
`types` containment prefers a scan because `Fire` covers roughly 17% of rows —
which that document calls "the correct choice rather than a fault", and it is.

---

## Free-text search stays on `ILIKE`, without trigrams

The database was created with `--locale=C` (`docker-compose.yml`), and that turns
out to matter more than anything else about search.

| Predicate | Plan |
| --- | --- |
| `name LIKE 'Char%'` | **`Index Cond: name >= 'Char' AND name < 'Chas'`** — a real seek |
| `name ILIKE 'char%'` | Index Scan + filter, 2 278 rows removed |
| `name ILIKE '%char%'` | Index Scan + filter, 2 270 rows removed |
| `lower(name) LIKE 'char%'` | Index Scan + filter, 2 278 rows removed |

Only the case-**sensitive** prefix gets an index condition. Case-insensitive
search cannot use a plain btree at all, whatever shape it takes.

`pg_trgm` is available in this PostgreSQL image and not installed. It would give
indexed case-insensitive substring search, and it costs two things: a
`CREATE EXTENSION` in a migration, and a GIN index with the `gin_trgm_ops`
operator class that **Prisma cannot declare**. `docs/DataModel.md` already
records what that means — an index added by hand reads as schema drift, and
Prisma tries to drop it on every subsequent migration. The same paragraph
explains why the one-snapshot-per-day cap lives in a job rather than in the
schema, for exactly this reason.

Nine milliseconds is the price of not doing that, and it is the **worst** case:
a query matching nothing, which is the only one that reads all 20 670 rows.
A query matching something stops at the `LIMIT`.

So: plain `ILIKE '%q%'`, measured, with the upgrade recorded rather than taken.
Revisit `pg_trgm` when the catalog passes roughly 100 000 rows or when search
becomes a hot path — neither is true, and the catalog grows by a few hundred
cards a year.

### What the first acceptance criterion honestly says

"Every filter combination in the spec is index-backed."

`set`, `rarity` and the two together genuinely are — `Bitmap Index Scan` and
`BitmapAnd`. `types` and `q` are filters applied over an index scan, and `q`
alone with no match degrades to a sequential scan.

That is written down rather than glossed, because the measurement is what makes
it acceptable, not the label. A reader who later finds a `Seq Scan` in a plan
should find this paragraph rather than conclude something regressed.

---

## Sorting: `name`, and always `id` beside it

Not a style choice. Measured:

```
total cards          20 670
distinct names        4 454
rows sharing a name  16 216
```

`Pikachu` alone appears 134 times. Sorting by `name` with offset pagination and
no tiebreak lets PostgreSQL return ties in any order it likes, which means a row
can appear on two consecutive pages while another appears on none. At 78% of the
table sharing a name, that is not an edge case.

`ORDER BY name, id` plans as an **Incremental Sort** with `Presorted Key: name`,
so the btree still does the work and only the tied runs are sorted.

The sort surface is deliberately one field with two directions. Price columns
are null until M4, and a meaningful rarity order needs `RarityTier` — a UI
concept that belongs to the read model, not to this endpoint. Adding a sort
field later is one line in a Zod enum.

---

## The four routes

All `@Public()`. Card detail is SEO-facing; the rest are public for the same
reason a catalog is.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/cards` | `q`, `set`, `rarity`, `type`, `sort`, `page`, `pageSize` |
| GET | `/api/v1/cards/:id` | 404 when absent |
| GET | `/api/v1/sets` | all 176, unpaginated |
| GET | `/api/v1/sets/:id` | the set plus its card count |

`type` takes one value and matches with containment (`types @> ARRAY[type]`),
not a list. A card carries at most two types, and the FilterBar in
`docs/ComponentSpecs.md` is a single dropdown — a multi-value filter would be
surface nobody asked for.

`/sets` is unpaginated on purpose. There are 176 rows and the number grows by a
handful a year; paginating it would add a page control to every consumer for a
list that fits on one screen.

### Pagination bounds are already enforced

`PaginationQuerySchema` in `@pokedrop/shared` is `page ≥ 1` and
`pageSize ≤ 100`, and Zod **rejects** rather than clamps. A `pageSize=1000`
therefore returns the standard 400 envelope naming the field, which is the
second acceptance criterion, satisfied by code that already exists.

The `total` a paginated response carries costs the 8.2 ms count measured above.
That is paid on every search; it is the price of telling a client how many pages
there are, and at this size it is affordable.

---

## Shape

```
apps/api/src/catalog/
  catalog.module.ts
  catalog.controller.ts     four routes, thin
  catalog.service.ts        the queries
  catalog.dto.ts            createZodDto wrappers over the shared schemas
```

Thin controllers and fat services, per `docs/Architecture.md` §1.

### The contract lives in `@pokedrop/shared`

`packages/shared/src/index.ts` states the rule: "Endpoint request/response
schemas are added by the ticket that implements the endpoint." This is that
ticket, so the query and response schemas go there — `CardSearchQuerySchema`,
the sort enum, and the set-detail response — and the frontend imports the same
objects the API validates against.

`pageOf(CardSchema)` already exists and is the list response.

### Why no code path can reach a provider

The third acceptance criterion, and it is satisfied structurally rather than by
inspection: `CatalogModule` imports **nothing**. `PrismaModule` is `@Global()`,
so `PrismaService` injects without an import, and `SyncModule` is not global —
which means the tokens for `CARD_SOURCE_PROVIDER` and the registry are simply
not in this module's context. Injecting one would fail at boot, not at runtime.

The ESLint fence PD-38 built stops a provider's *internals* being imported
anywhere outside `sync/providers/`. It does not stop someone importing the
public token, which is why the empty imports array is the argument that
matters here.

---

## What is deliberately absent

**Caching.** PD-46 adds it, with invalidation driven by the sync processor, and
that ticket's notes already record what `CacheService` does and does not do.
Adding a cache here would mean PD-46 rewriting rather than extending.

**Prices.** `Card.latestPriceUsd`, `latestPriceEur` and `priceUpdatedAt` are
columns on the model and are returned as they are — currently null everywhere,
because M4 has not run. The ticket's phrase "plus cached latest price" describes
what the payload will contain once the price path exists; nothing here computes
or fetches one.

**Facets.** The list of filterable values is PD-47.

---

## Failure handling

`GET /cards/:id` and `GET /sets/:id` throw `NotFoundException` for an unknown
id, which the global filter shapes into the standard envelope. Absence is not
cached and not represented as an empty object — `CacheService.getOrSet` cannot
store `null` usefully (a stored `null` reads back as a miss), and caching a
negative invites filling the cache with random ids. A 404 costs one indexed
primary-key lookup.

An invalid query parameter is a 400 from `ZodValidationPipe` naming the field.
No route in this module can produce a 5xx from anything but a database failure.

---

## Verification plan

No automated tests. Each item is measured once, by hand, against the running
stack with the full catalog.

1. **All four routes answer without a session.** `curl` with no cookie returns
   200 from each — `@Public()` is doing its job under the global `SessionGuard`.
2. **Filters return what they claim.** `?set=base1` returns only `base1` cards
   and the count matches `SELECT count(*) FROM cards WHERE "setId"='base1'`.
   Same for `rarity` and `type`.
3. **Search finds things.** `?q=charizard` returns Charizards across sets.
4. **Pagination is stable.** Page 1 and page 2 of the default sort share no ids —
   the test that would fail without the `id` tiebreak.
5. **`pageSize=1000` is rejected**, not clamped: a 400 whose message names
   `pageSize`.
6. **`/cards/:id` on an unknown id is a 404** in the standard envelope.
7. **`/sets` returns 176** and `/sets/:id` returns a card count matching the
   table.
8. **The plans are still what was measured.** Re-run `EXPLAIN` through the
   service's actual SQL, not a hand-written approximation — Prisma's generated
   query is what runs in production.
9. **Nothing reaches a provider.** Stop the worker, point `POKEMONTCG_BASE_URL`
   at an unroutable host, and confirm every route still answers 200.
10. **Gates.** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`.

---

## Files

**New**

| Path | Holds |
| --- | --- |
| `apps/api/src/catalog/catalog.module.ts` | the module |
| `apps/api/src/catalog/catalog.controller.ts` | four routes |
| `apps/api/src/catalog/catalog.service.ts` | the queries |
| `apps/api/src/catalog/catalog.dto.ts` | `createZodDto` wrappers |
| `apps/api/src/catalog/index.ts` | the module's public surface |
| `packages/shared/src/entities/catalog.ts` | query and response schemas |

**Edited**

| Path | Change |
| --- | --- |
| `apps/api/src/app.module.ts` | import `CatalogModule` |
| `packages/shared/src/index.ts` | export the new schemas |
| `docs/API.md` | the Catalog section, with the measured plans |

No migration. No dependency.

---

## Out of scope

| Not here | Where |
| --- | --- |
| Redis caching and invalidation | PD-46 |
| The facets endpoint | PD-47 |
| Price reads and history | M4 (PD-51) |
| `RarityTier` mapping | the frontend, M12 |
| Inventory-aware "owned" flags | M5 |

---

## Forward notes

**PD-46 should cache the detail route before the list route.** A card detail is
one row by primary key and is the SEO-facing page; a search result set is keyed
by a filter combination whose cardinality is large and whose hit rate is
therefore low. The TTL table in `docs/Architecture.md` §8 already names
`card:{id}` and `sets`, and not a search key, which is consistent.

**The count query is the first thing to drop if search gets slow.** At 8.2 ms it
is roughly as expensive as the search itself. A client that only needs "is there
a next page" can be served by fetching `pageSize + 1` rows — but note that
`total` and `totalPages` are **required** fields in `pageOf`, so dropping the
count means changing that shared schema and every consumer with it. `nextCursor`
is the optional one, and it is the escape hatch `pagination.ts` was written to
leave open.

**`pg_trgm` is the recorded upgrade for search**, with the trigger being catalog
size rather than taste. Whoever takes it should expect to fight Prisma over the
operator class, and `docs/DataModel.md` explains why.
