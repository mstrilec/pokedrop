# PD-40 + PD-43 — The fallback provider and failing over to it

Design, 2026-09-19. Milestone M3 · Catalog Mirror & Sync.

Tickets: [PD-40](https://linear.app/mstrilec/issue/PD-40/tcgdexclient-fallback-provider) ·
[PD-43](https://linear.app/mstrilec/issue/PD-43/provider-failover-switch-to-fallback-after-repeated-failures) ·
Reference: `docs/Architecture.md` §3 (external API strategy), §7 (failure handling) ·
`docs/PRD.md` §15 · `apps/api/src/sync/README.md`.

One spec for two tickets. They are separable as code and not as a design: the
decision that shapes both is what happens when the two providers disagree about
what a card is called, and writing that decision twice would be writing it
differently twice. Implementation stays split — one plan each, commits per
ticket.

---

## The measurement that reframed both tickets

`sync/README.md` already recorded, on 2026-09-18, that TCGdex "has no bulk path
to full card data: full cards are one request each". That is true, and it is not
the interesting part.

Measured against the live API on 2026-09-19:

| Probe | Result |
| --- | --- |
| 10 sequential full-card fetches | **10/10 succeeded**, 144 ms each |
| the entire brief index, `/v2/en/cards` | **23 736 entries, 2.3 MB, 960 ms — one request** |
| `/v2/en/cards?set=base1` | briefs only: `{id, localId, name, image}` |
| `/v2/en/cards?id=base1-4` | briefs, and a prefix match rather than an exact one |
| `/v2/en/cards/{id}` | the only full-card shape there is |

Compare the primary, measured the day before: **6 of 20** requests to
pokemontcg.io's `/v2/cards` succeeded.

So the two providers fail in opposite directions. pokemontcg.io is cheap in
requests and unreliable per request. TCGdex is reliable per request and
expensive in requests. A fallback whose failure mode is *unlike* the primary's
is worth more than one that merely duplicates it, and that is the strongest
argument for TCGdex being the right choice here rather than a second flaky
mirror of the same data.

### Throughput, measured

64 full-card fetches at four concurrency levels, every response a 200:

| Concurrency | Elapsed | Rate | Full catalog |
| --- | --- | --- | --- |
| 1 | 5 104 ms | 12.5 req/s | 27.5 min |
| 4 | 1 001 ms | 63.9 req/s | 5.4 min |
| **8** | **559 ms** | **114.5 req/s** | **3.0 min** |
| 16 | 361 ms | 177.3 req/s | 1.9 min |

**Concurrency 8.** Not because 16 failed — nothing failed at any level, and no
`429` was seen at all. Because TCGdex is a free, community-run service with no
API key, and `docs/PRD.md` §2 commits this project to free infrastructure. Being
a guest on it is a constraint, not a courtesy. Three minutes for a full sweep is
already faster than the primary manages, and the remaining 1.1 minutes are not
worth spending someone else's bandwidth on.

---

## `fetchCards` without a bulk endpoint

The interface is fixed: `fetchCards({ page, pageSize }): Promise<CardPage>`. The
processor pages flatly at 250, resumes from `SyncRun.cursor.page`, and PD-40's
third acceptance criterion is that the rest of the codebase changes by nothing.

**The approach: a sorted brief index, then concurrent hydration.**

1. Fetch the brief index once — 960 ms — and hold it for the life of the sweep.
2. **Sort it by `id`.** The server's order is its own business; sorting makes a
   page boundary a property of the data rather than of the response, so page 12
   means the same 250 cards on a resume as it did on the first attempt.
3. Slice `[(page - 1) * pageSize, page * pageSize)`.
4. Hydrate those ids through `/cards/{id}` at concurrency 8.
5. Return a real `CardPage`: `total` is the index length, `hasMore` follows from
   the slice.

Rejected: **iterating per set.** `fetchCards({ setId })` is in the interface and
TCGdex serves it well, but the processor walks flat pages — a decision PD-42
took on measurement (83 requests against roughly 590) and recorded. Switching to
a per-set walk would change the processor, which is exactly the acceptance
criterion this ticket has to hold.

### What the index cache costs, and what it risks

The index is a snapshot. Held for one hour, so a sweep uses one snapshot and a
resume within the hour uses the same one.

A resume *after* the hour refetches, and if TCGdex published cards in between,
page boundaries shift by however many were added. Some cards are then fetched
twice and some skipped. Both are harmless: the upsert is idempotent and guarded,
so a repeat writes nothing, and a skipped card is picked up by the next sweep —
which is exactly how the mirror already converges across runs today (`README.md`,
"the mirror converges rather than completing"). Engineering around this would
cost a persisted index for a failure that costs one day of freshness on a
handful of cards.

---

## The decision that shapes everything: the ids diverge

Card ids inherit their set's id. For the sets both providers know, they agree
exactly — `base1`, `base1-4`. For newer sets they do not:

| pokemontcg.io | TCGdex |
| --- | --- |
| `sv3pt5` | `sv03.5` |
| `sv4` | `sv04` |
| `me1` | `me01` |
| `mcd22` | a year-prefixed scheme entirely (`2024sv`) |

Measured against the live mirror:

| | |
| --- | --- |
| sets in the mirror | 176 |
| sets TCGdex publishes | 220 |
| **mirror cards in sets TCGdex shares by id** | **15 222 — 73.6%, across 126 sets** |
| **mirror cards in sets whose id diverges** | **5 448 — 26.4%, across 50 sets** |
| sets only TCGdex has | 94, including Pokémon TCG Pocket (`A1`, `A2`, `B1`…) |

**A naive failover does not fail. It forks.** Every foreign key holds, no error
is raised, and the mirror quietly grows a second copy of 50 sets under different
ids. Search returns both. Inventory counts both.

A mechanical rule (`pt5` → `.5`, zero-pad the leading number) resolves **21 of
the 50**. The other 29 need a hand-written table, and new sets are exactly where
the scheme diverges — so the table would break first at the place users look
first, and break silently.

### The rule that holds instead

Two sentences in the processor, neither mentioning TCGdex:

1. **A run on a fallback provider never writes a set.** `fetchSets()` is not
   called.
2. **A run on a fallback provider skips any card whose `setId` is not already in
   the mirror.**

This is a property of failing over, not of one provider, so a third source
inherits the protection without a line of new code. The 50 divergent sets simply
do not refresh while the primary is down — they stay in the mirror exactly as
they were, which is what a mirror is for.

**Such a run closes `PARTIAL`, always**, with the reason in `SyncRun.error`.
73.6% coverage is a partial run by definition, and reporting `SUCCEEDED` would
be a lie told to the one person reading the admin page during an outage.

---

## Mapping TCGdex onto the DTOs

`SetDTO` needs `releaseDate` and `series`, and the set list carries neither, so
`fetchSets()` is one request for the list plus one per set — 221 in total, about
30 seconds. Paid once per sweep, and not at all on a fallback run, which does
not fetch sets.

### Cards

| `CardDTO` | TCGdex | Rule |
| --- | --- | --- |
| `id`, `setId` | `id`, `set.id` | identical scheme where the sets are shared |
| `supertype` | `category` = `Pokemon` | **normalise to `Pokémon`.** One character, and without it the supertype facet grows a fourth value and `?supertype=Pokémon` misses every row the fallback wrote |
| `subtypes` | `stage` = `Stage2` | `["Stage 2"]`; absent → `[]` |
| `hp` | `hp` | already a number here; absent → `null` |
| `types` | `types` | absent on Trainer and Energy → `[]` |
| `rarity` | `rarity` | passed through. The vocabularies differ (`Special illustration rare` against `Rare Holo`) and `RaritySchema` is a free string, so nothing rejects — this is a documented divergence, not a mapping |
| `retreatCost` | `retreat` = `3` | three `"Colorless"`. Not invented: retreat cost is colourless by the rules of the game |
| `weaknesses`, `resistances` | same shape | direct |
| `attacks[].convertedEnergyCost` | — | `cost.length`, which is the definition of the field |
| `attacks[].damage` | `100` or `"60+"` or absent | always stringified |
| `attacks[].text` | `effect`, sometimes absent | `""` — see below |
| `abilities` | `{type, name, effect}` | `effect` → `text` |
| `legalities` | `{standard: false, expanded: false}` | booleans → `"Legal"` / `"Illegal"`. `unlimited` is **omitted**, not invented — TCGdex does not publish it |
| `nationalPokedexNumbers` | `dexId` | absent → `[]` |
| `imageSmall`, `imageLarge` | `image`, no extension | `+"/low.webp"`, `+"/high.webp"` — both verified 200 |
| `tcgplayerId`, `cardmarketId` | `variants_detailed[].thirdParty` | **TCGdex is the stronger source.** pokemontcg.io publishes neither and this project's mapper has always written `null` for both |

### Sets

| `SetDTO` | TCGdex | Rule |
| --- | --- | --- |
| `series` | `serie.name` | set detail only |
| `releaseDate` | `releaseDate`, `1999-01-09` | already ISO |
| `printedTotal`, `total` | `cardCount.official`, `cardCount.total` | direct |
| `logoUrl` | `logo` | `+".png"` — verified 200. Absent on 63 of 220 sets → `null` |
| `symbolUrl` | `symbol` | **the published URL is broken.** See below |

**The symbol URL TCGdex returns does not resolve.** The API gives
`https://assets.tcgdex.net/univ/base/base2/symbol`, and that path answers `400`
with every extension and with none. The asset exists under the language prefix
instead. Verified across 8 sets: `univ` 0/8, `en` 8/8.

So the rule is `symbol.replace('/univ/', '/en/') + '.png'`, and it is written
down here because it looks like a typo and is not — a future reader who
"simplifies" it back will write 220 dead URLs into the mirror, and
`SetDTOSchema.symbolUrl` is `z.url()`, which a dead URL satisfies perfectly.

### Two honest gaps

**1 749 of 23 736 cards carry no image at all**, across 68 sets — confirmed on
the full object, not just the index. `CardDTO.imageSmall` is `z.url()` and not
nullable, so such a card cannot be represented. It goes into `CardPage.skipped`
and is counted, which is precisely what the primary's client already does with a
card that fails to parse. Changing the schema to make images optional is a
larger decision than this ticket, and one the catalog UI would have to answer.

**PD-40's second acceptance criterion holds for nullable fields and cannot hold
everywhere.** "Fields absent upstream become explicit nulls, never silent empty
strings" is satisfied for `hp`, `rarity`, `logoUrl`, `symbolUrl`, `tcgplayerId`
and `cardmarketId`. It cannot be satisfied for `attacks[].text` and
`attacks[].damage`: `AttackSchema` in `@pokedrop/shared` declares both as
non-nullable strings, and an attack with no printed effect — `hgss1-1`'s Sharp
Fang is one — has nowhere to put a null. The empty string there is the shared
contract speaking, not the mapper being careless. Recorded rather than glossed.

### Ids that need encoding

Two of the 23 736 ids are `exu-!` and `exu-%3F` — the second already carries a
percent escape in the id itself. `encodeURIComponent` produces `exu-%253F`, and
that is the URL that returns 200. Both fetch correctly; the note exists so that
nobody later "fixes" the double encoding.

Both live in `exu`, a TCGdex-only set, so under the failover rule above neither
is ever written. The client still has to be right about them, because a future
primary switch would reach them.

---

## PD-43: the breaker

### What counts

Only `ProviderUnavailableError` and `ProviderContractError`. Never
`ProviderRateLimitError` — the rule `sync/README.md` and the comment in `http.ts`
both already state, because counting a 429 moves load onto the fallback and rate
limits that one too.

This works only because `http.ts` retries internally. An individual 5xx never
reaches the breaker; a `ProviderUnavailableError` means five attempts on a
jittered backoff were spent. That is what makes the signal mean "the provider is
unusable" rather than "a request failed".

### The threshold

**Five consecutive escaped failures.**

Measured across four real sweeps: 3 failed pages out of 83, scattered rather
than clustered. At that rate a run of five consecutive escapes is an event of
roughly 6 × 10⁻⁸ — so the threshold measures an outage and not a bad night.
Consecutive matters: three scattered failures never reach five in a row, which
is why the counter resets on any success.

### Where the state lives

Redis, under a `breaker:` namespace, reached through `RedisService` **and not
through `CacheService`**.

`CacheService` turns a Redis failure into `null` and carries on. For a cache that
is correct and was verified in PD-46. For a breaker it means the failure counter
silently resets whenever Redis blinks — the breaker would be most likely to
forget an outage during exactly the kind of incident that causes one. The same
argument is already written down in `cache.keys.ts` for `lockKeys`, and this is a
second instance of it.

The cooldown is the key's TTL: **30 minutes**. Nothing schedules a re-test and
nothing has to. The key expires, the next sweep asks the selector, the selector
sees no open breaker and returns the primary. That is PD-43's second acceptance
criterion, satisfied by expiry rather than by a timer.

### Shape

A `ProviderSelector` inside `providers/` answers "which provider should this run
use", reading the breaker and the registry. The processor asks it **once per
run**.

`CARD_SOURCE_PROVIDER` stays what it is — the configured *primary*. The selector
is what the processor injects.

### This deviates from the ticket, deliberately

PD-43's scope line says "after N consecutive failures the sync layer switches
**that batch** to the fallback". That is a mid-run switch, and this design does
not do it.

Switching mid-run puts two id vocabularies inside one `SyncRun`: pages 1–40
written as `sv4-25`, pages 41–83 as `sv04-25`. The run's `provider` column could
then name only one of the two sources that wrote it, and the fork this whole
design exists to prevent would arrive through the door marked "resilience".

So the breaker opens during a run and takes effect at the next one. The cost is
one sync cycle of staleness on the sets the fallback could have served. The
mirror is a day-old snapshot by design — the scheduler runs at 3am and the
catalog gains a set a few times a year — so a cycle of staleness is a cost the
architecture already absorbs, and a forked catalog is not.

PD-43's first acceptance criterion is still met, across two runs rather than
one: the outage is simulated, the breaker opens, and the following sync completes
through the fallback. Verification item 10 measures exactly that.

---

## The admin surface

`GET /admin/sync/status`, `@Roles(Role.ADMIN)`, read only.

`RolesGuard` and the `@Roles` decorator are already registered globally, so this
is a controller and a read — no new infrastructure. It returns the last run of
each `SyncKind` (provider, status, timestamps, processed, failed) and the breaker
state per provider.

It does **not** import `SyncModule`. It reads `SyncRun` through the global
`PrismaService` and the breaker through `RedisService`, the same way
`CatalogModule` imports nothing. The sync runs in the worker process; the
endpoint answers in the API process; they share a database and a Redis, not a
module.

This overlaps [PD-81](https://linear.app/mstrilec/issue/PD-81/admin-sync-control-and-status-endpoints)
in M10, which keeps the control half — triggering a sync, clearing a breaker —
plus everything else that milestone covers. Taken here because PD-43's third
acceptance criterion is a statement about an endpoint, and an acceptance
criterion that can only be checked with `psql` is not one.

---

## Failure handling

| What | Result |
| --- | --- |
| a page exhausts the retry budget | counted into `failed`, breaker incremented, loop continues |
| five consecutive such failures | breaker opens, 30-minute TTL; the current run closes `PARTIAL` |
| the next run while the breaker is open | served by the fallback, `SyncRun.provider` records it |
| a card whose set is not mirrored, on a fallback run | skipped, counted, the run closes `PARTIAL` |
| `ProviderRateLimitError` | honoured by `http.ts`, **not** counted by the breaker |
| `ProviderContractError` | run closes `FAILED` immediately, breaker incremented |
| the fallback also fails five times | both breakers open; the run closes `FAILED` and the mirror stays as it is |
| Redis unavailable | the breaker cannot be read; the run uses the configured primary and logs a warning |

That last row is a deliberate choice. With no breaker state, the safe default is
the provider the operator configured, not a fallback nobody asked for.

---

## Verification plan

No automated tests. Each item measured once by hand against the running stack.

**PD-40**

1. **`fetchSets()` returns 220 sets** with `releaseDate`, `series`, and a
   `logoUrl` that answers 200.
2. **`symbolUrl` answers 200** for a set that publishes a symbol, and is `null`
   for the 51 that do not.
3. **`fetchCards({ page: 1, pageSize: 250 })`** returns 250 items with a `total`
   of 23 736 and `hasMore` true.
4. **Page boundaries are stable.** The same page fetched twice returns the same
   250 ids, and page 1 and page 2 share none.
5. **A card with no image is skipped, not written** — `exu-!` arrives in
   `skipped` with its id.
6. **The odd ids fetch.** `exu-!` and `exu-%3F` both return 200 through the
   client.
7. **Every mapped field is checked against one live card** — `base1-4`, where
   `supertype` is `Pokémon`, `subtypes` is `["Stage 2"]`, `retreatCost` has three
   entries, `legalities` has no `unlimited` key, and both third-party ids are
   present.
8. **A full sync with `CARD_SOURCE_PROVIDER=tcgdex` populates the mirror** — the
   first acceptance criterion, run against an empty database so that the id
   space is TCGdex's own and nothing forks.
9. **No file outside `sync/providers/` changed for PD-40.** `git diff --stat`
   is the check.

**PD-43**

10. **A simulated primary outage completes through the fallback.** Point
    `POKEMONTCG_BASE_URL` at an unroutable host, run a sync, and watch the
    breaker open, the next run select `tcgdex`, and `SyncRun.provider` record it.
11. **The fallback run wrote no new set**, and `SELECT count(*) FROM sets` is
    unchanged at 176.
12. **The fallback run forked nothing.** No card id in the mirror belongs to a
    set id that was not already there, before and after.
13. **The primary is retried once the cooldown elapses** — expire the key and
    confirm the selector returns `pokemontcg` again.
14. **A 429 does not open the breaker.** A local stub returning 429 leaves the
    counter at zero.
15. **`GET /admin/sync/status` names the provider that served the last run**,
    answers 403 without an admin session, and reports the breaker state.
16. **Redis down falls back to the configured primary**, with a warning and no
    crash.
17. **Gates.** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`.

---

## Files

**New — PD-40**

| Path | Holds |
| --- | --- |
| `apps/api/src/sync/providers/tcgdex/http.ts` | the HTTP layer |
| `apps/api/src/sync/providers/tcgdex/tcgdex.schema.ts` | raw Zod shapes |
| `apps/api/src/sync/providers/tcgdex/tcgdex.mapper.ts` | the mapping above |
| `apps/api/src/sync/providers/tcgdex/tcgdex.client.ts` | the client and the brief index |

**New — PD-43**

| Path | Holds |
| --- | --- |
| `apps/api/src/sync/providers/provider-breaker.service.ts` | the counter and the cooldown |
| `apps/api/src/sync/providers/provider-selector.service.ts` | which provider a run uses |
| `apps/api/src/admin/admin.module.ts` | the module |
| `apps/api/src/admin/admin.controller.ts` | the one route |
| `apps/api/src/admin/admin-sync.service.ts` | the reads |
| `apps/api/src/admin/index.ts` | the public surface |

**Edited**

| Path | Change |
| --- | --- |
| `apps/api/src/sync/providers/providers.module.ts` | register `TcgdexClient`, the breaker and the selector |
| `apps/api/src/sync/providers/index.ts` | export the selector and the breaker's state type |
| `apps/api/src/sync/catalog-sync.processor.ts` | ask the selector; the two fallback rules |
| `apps/api/src/app.module.ts` | import `AdminModule` |
| `packages/shared/src/entities/` | the admin status response schema |
| `apps/api/src/redis/cache.keys.ts` | `breakerKeys`, outside the cache namespace |
| `docs/API.md`, `docs/Architecture.md`, `apps/api/src/sync/README.md` | the above, measured |

No migration. `SyncRun.provider` is already a string for exactly this reason,
and `docs/DataModel.md` says so.

---

## Out of scope

| Not here | Where |
| --- | --- |
| Multilingual TCGdex (14 languages) | documented in `Architecture.md` §3, built by nothing in v1 |
| Set-id translation between providers | rejected above; revisit only with a generated map |
| Admin *control* — trigger a sync, clear a breaker | PD-81, M10 |
| Price sync through either provider | M4 (PD-48, PD-49) |
| Scrydex | paid; `PRD.md` §2 |

---

## Forward notes

**The mirror's id space belongs to whichever provider filled it.** That is now a
property of this system rather than an accident, and it is the reason a provider
switch on a populated database is not a configuration change. Switching for real
means an empty mirror.

**TCGdex publishes the third-party ids the primary does not.** `tcgplayerId` and
`cardmarketId` are null for all 20 670 rows today because pokemontcg.io does not
publish them. M4 may find that a single TCGdex pass over the catalog is the
cheapest way to fill them, and that pass costs 20 000 requests and three minutes.

**1 749 image-less cards are a schema question, not a provider one.** If the
catalog UI ever wants them, `CardDTO.imageSmall` becomes nullable and the card
grid needs a placeholder state — a `ComponentSpecs.md` change before a sync one.

**The breaker is per provider and per process.** One worker runs today. When
PD-129 runs more, the Redis key is already shared, so the count aggregates
correctly across them — which is the reason it lives in Redis rather than in
memory, even though there is one worker to share it between.
