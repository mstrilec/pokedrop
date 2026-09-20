# Sync module

The seam between this application and whichever card API is behind it. Nothing
outside this folder knows that pokemontcg.io or TCGdex exist.

## Shape

| File | Holds |
| --- | --- |
| `providers/provider.dto.ts` | `SetDTO`, `CardDTO`, `PriceDTO` — provider-neutral, Zod |
| `providers/provider.errors.ts` | the error taxonomy, and `ProviderItemError` |
| `providers/card-source-provider.ts` | the interface, `CardPage`, the two tokens |
| `providers/index.ts` | the folder's entire public surface |
| `sync.module.ts` | the registry and the configured default |

## The boundary, and how it is held

Nothing outside `providers/` may import a provider-specific type. That is not a
convention — `eslint.config.mjs` refuses it, the same way PD-10's rule refuses
`apps/api` importing from `apps/web`. Import from `providers/index.ts`.

Choosing a provider is `CARD_SOURCE_PROVIDER` in the environment and nothing
else. If changing it ever requires a code change outside this folder, the seam
has been broken.

Note that the patterns match the import specifier **as written**, so the block
exempting this folder is load-bearing rather than decorative: without it, a
sibling import written in the long form — `../../../sync/providers/tcgdex/…` —
is refused inside the very folder it is meant to protect. Verified by removing
the block and watching it fail.

## Three things that will bite

**`CardDTO` has no price fields, and that is deliberate.** `latestPriceUsd`,
`latestPriceEur` and `priceUpdatedAt` belong to the price path. Adding them here
would let a nightly catalog sync overwrite a fresh price with a stale one; with
no field to put it in, it cannot.

**A 429 is not a failover signal.** `ProviderRateLimitError` means slow down.
`ProviderUnavailableError` and `ProviderContractError` mean the upstream is not
serving, and only those two count toward PD-43's circuit breaker. Counting a 429
would move the load onto the fallback and rate-limit that one too.

**A malformed envelope throws; a malformed item does not.** A response that is
not the documented shape raises `ProviderContractError`. One bad card inside a
good response is skipped and reported through `CardPage.skipped`, so it cannot
discard the good ones beside it.

## Measured, 2026-09-18

pokemontcg.io answered 500 on `/v2/cards` — from the origin, `x-runtime`
present — while `/v2/sets` served normally. TCGdex answered everything, but has
no bulk path to full card data: full cards are one request each, roughly 20 000
for a catalog against pokemontcg.io's 80. That is why the primary did not change
when it broke.

The DTOs were checked against both live payloads: a pokemontcg.io set and a
TCGdex set map to `SetDTO`s equal to the millisecond, from `1999/01/09` and
`1999-01-09` respectively.

## What is not here yet

`SyncModule` waited to be imported into `AppModule` until the first provider
existed, because Nest builds providers eagerly and wiring an empty registry
would have made the boot refusal fire on every start.

## The pokemontcg.io provider

Registered as `pokemontcg` and the default. `providers/pokemon-tcg/` holds the
HTTP layer, the raw schemas, the mapper and the client.

Registration itself lives in `providers/providers.module.ts`, inside the sealed
folder. That is not incidental: the lint rule refuses a concrete provider being
named anywhere else, and keeping it here is what makes PD-38's first acceptance
criterion literally true — adding or swapping a provider changes no file outside
this folder.

### The upstream is flaky, and the client is built around that

Measured 2026-09-18: **6 of 20** consecutive requests to `/v2/cards` succeeded.
The failures were scattered rather than clustered, so retrying works.

`http.ts` runs two policies. A 5xx or a network fault is an ordinary event —
retried on a jittered exponential backoff from 250 ms, five attempts in total,
and raised as `ProviderUnavailableError` only once those are spent. A 429 is the
opposite: `Retry-After` is honoured and the error raised is
`ProviderRateLimitError`, which PD-43 must **not** count toward failover.

That distinction is what keeps a breaker useful here. Counting individual 5xx
responses at a 70% failure rate would trip any sensible threshold within seconds
of every sweep.

A page that fails all five attempts is PD-42's problem: the job fails, BullMQ
retries it, and the cursor resumes from the page that failed.

**No 429 has ever been observed from this provider.** The `Retry-After` path is
designed from its documentation and verified against a local stub, not in the
field. Treat it as unconfirmed until a production sweep says otherwise.

### Mapping rules

| Target | Source | Note |
| --- | --- | --- |
| `hp` | `hp` | arrives as a string; parsed, `null` when it is not a number |
| `printedTotal` | `printedTotal ?? total` | the key is absent on the newest set in the catalog |
| `releaseDate` | `releaseDate` | `YYYY/MM/DD`, not ISO |
| `tcgplayerId`, `cardmarketId` | — | **always null.** This provider publishes no identifier; TCGdex does, so PD-40 fills them and this one cannot |

Prices: among TCGplayer's print variants, the first present in the order
`normal`, `holofoil`, `reverseHolofoil`, `1stEditionHolofoil`,
`unlimitedHolofoil`. A card can carry a `tcgplayer` block whose `prices` is
empty — one on the first page does — and it yields no price point rather than a
row of nulls.

Cardmarket maps `averageSellPrice` → `market`, `lowPrice` → `low`, `trendPrice`
→ `mid`, and `high` → `null`, because it publishes no median. `trendPrice`
standing in for `mid` is an approximation, not an equivalence; M4 may prefer to
widen `PriceDTO` instead.

### Measured end to end, 2026-09-18

Through the registered client, against the live API:

| Call | Result | Elapsed |
| --- | --- | --- |
| `fetchSets()` | 176 sets, `me55c` with `printedTotal` 30 = `total` | 1 671 ms |
| `fetchCards({ page: 1, pageSize: 250 })` | 250 items, 0 skipped, total 20 670, `hasMore` true | 7 636 ms |
| `fetchCards({ setId: 'base1' })` | 102 cards, all in the set | 2 770 ms |
| `fetchPrices(['base1-4','base1-2'])` | 4 price points, USD and EUR | 3 326 ms |

**Four retries were needed across those four calls**, one of them taking three
before it succeeded. That is the measurement that matters: the elapsed times are
dominated by backoff, not by the provider being slow, and a run that needed zero
retries would prove nothing about the retry path.

Corrupting one card in a captured page keeps the other four and reports the bad
one by id — one malformed card costs one card.

The catalog is 20 670 cards, so a full sweep is 83 pages — roughly 275 requests
once retries are counted. Well inside the anonymous rate limit. The free API key
raises it further and should be set before the first production sweep; v1 uses
no paid services, and this key is free.

## The TCGdex provider

Registered as `tcgdex` and used as the fallback. `providers/tcgdex/` holds the
same four files as the primary, and `http.ts` is deliberately a parallel of the
other rather than shared code: the mechanism matches, the policy does not.

### It fails in the opposite direction to the primary

Measured 2026-09-19. pokemontcg.io answered **6 of 20** requests; TCGdex
answered **10 of 10**, then **64 of 64** under concurrency, with no `429` at any
level. What it lacks is bulk: every filtered endpoint — `?set=`, `?id=`,
pagination — returns briefs of `{id, localId, name, image}`, and a full card is
one request each.

| Concurrency | Rate | HTTP time for 23 736 |
| --- | --- | --- |
| 1 | 12.5 req/s | 27.5 min |
| 4 | 63.9 req/s | 5.4 min |
| **8** | **114.5 req/s** | **3.0 min** |
| 16 | 177.3 req/s | 1.9 min |

**That last column is HTTP time only, and it is not how long a sweep takes.**
Measured end to end: a real catalog sync wrote 220 sets and 7 007 cards at
roughly 1 400 cards a minute, so a full catalog is **15 to 25 minutes**. The gap
is everything the throughput probe left out — every page opens a transaction and
upserts 250 rows, and the pages are walked one at a time.

Eight, and not because sixteen failed. This is a free keyless community service
and `docs/PRD.md` §2 commits the project to free infrastructure; doubling to 16
would only halve the HTTP time, which the correction above shows is a minority
of a sweep's wall clock.

### A page is a slice of the brief index

The whole index is **one request — 23 736 entries, 2.3 MB, 960 ms**. The client
holds it for an hour, **sorted by `id`**, and a page is a slice hydrated through
a pool of eight.

The sort is load-bearing. `SyncRun.cursor` stores a page number, and a page
number only means something if it names the same cards twice. Without it the
order is whatever the endpoint answered with, and every resumed sync writes some
cards twice and misses others.

A resume more than an hour later refetches the index, and cards published in
between shift the boundaries. Harmless: the guarded upsert absorbs a repeat, and
a missed card is picked up by the next sweep — which is how this mirror already
converges.

The TTL is checked on every page fetch, not only on a resume, so a single run
lasting over an hour also refetches mid-run — reachable, since the sync
processor sets `hasMore` on any page failure and keeps going with no page
ceiling. `total` and `hasMore` are recomputed against the new index afterward,
so a shrunken index can end the page loop early.

### Mapping rules, and four that are silent when wrong

| Target | Source | Note |
| --- | --- | --- |
| `supertype` | `category` | **`Pokemon` → `Pokémon`.** One character. Without it the supertype facet grows a fourth value and `?supertype=Pokémon` misses every row this provider wrote |
| `subtypes` | `stage` | **`Stage2` → `["Stage 2"]`**, one word upstream and two here |
| `retreatCost` | `retreat` | a count upstream, a cost here — expanded to that many `Colorless`, which is what the rules of the game say it is |
| `symbolUrl` | `symbol` | **the published URL answers 400.** It points at `assets.tcgdex.net/univ/…`; the asset lives under the language prefix. Verified across 8 sets: `univ` 0/8, `en` 8/8. `z.url()` accepts a dead URL, so dropping the rewrite is silent |
| `logoUrl` | `logo` | `+ ".png"`; 63 of 220 sets publish none |
| `legalities` | `legal` | booleans → `Legal`/`Illegal`. `unlimited` is **omitted**, not guessed |
| `attacks[].convertedEnergyCost` | — | `cost.length`, which is the definition |
| `tcgplayerId`, `cardmarketId` | `variants_detailed[].thirdParty` | **the one place this provider beats the primary**, which publishes neither |

### Two gaps that are the contract's, not the mapper's

**1 749 of 23 736 cards carry no image**, across 68 sets, confirmed on the full
object rather than the index. The first page of the sorted index is unusually
affected — 84 items and 166 skipped out of 250 — because digits sort before
letters, so the earliest ids are all promo-era sets whose image coverage is far
below the catalog's 7.4% average. `CardDTO.imageSmall` is a non-nullable
`z.url()`, so such a card cannot be represented; it goes to `CardPage.skipped`
without a request being spent on it. Making images optional is a schema
decision the catalog UI has to answer first.

**`attacks[].text` and `attacks[].damage` become `""` when absent**, because
`AttackSchema` in `@pokedrop/shared` declares both non-nullable. PD-40's second
acceptance criterion — absent fields become explicit nulls — holds for `hp`,
`rarity`, `logoUrl`, `symbolUrl` and the two third-party ids, and cannot hold
here. `hgss1-1`'s Sharp Fang is the card to look at.

**`weaknesses[].value` and `resistances[].value` become `""` when absent**, for
the same reason: `WeaknessSchema` and `ResistanceSchema` declare `value`
non-nullable, so a weakness whose type is published without a multiplier has
nowhere to put a null. This is not rare noise — 30 of 151 POP-series cards with
images are in this state, including all 17 of `pop1` — so the mapper defaults
the string and keeps the card rather than requiring `value` in the raw schema
and losing the card (and, at that concentration, most of two sets) instead.

### Two ids need encoding

`exu-!` and `exu-%3F`. The second already carries a percent escape, so
`encodeURIComponent` produces `exu-%253F` — and that is the URL that answers
200. The double encoding is correct.

### What the first real sweep proved, and what it did not

Run 2026-09-20 against a throwaway database, deliberately not the mirror. It
wrote **220 sets and 7 007 cards across roughly 30 of 95 pages** before the
process was stopped, so the catalog was not swept to completion.

What it did prove, on real rows rather than on a probe's return value:

| Check | Result |
| --- | --- |
| `supertype` carries the accent | `Pokémon` 6 210, `Trainer` 663, `Energy` 134 — rows saying `Pokemon` : **0** |
| the symbol rewrite held | symbol URLs containing `/univ/` : **0**, across 169 sets that publish one |
| `subtypes` gained its space | `30th-002` is `{"Stage 1"}` |
| `retreatCost` became a cost | `30th-002` is four `Colorless` |
| no legality was invented | rows carrying an `unlimited` key : **0** |
| image URLs are well formed | rows not ending `/low.webp` and `/high.webp` : **0** |
| the third-party ids landed | 1 537 TCGplayer, 1 489 Cardmarket |

What it did not prove is that the remaining 65 pages complete, and that gap was
real: page 45 fails. `pop1-9`, `pop1-11` and `pop2-6` — in fact all 17 of
`pop1` and 13 of `pop2` — publish a weakness with a `type` and no `value`, and
the mapper threw a raw `ZodError` when it built a `WeaknessSchema` object that
requires one, a throw nothing caught: the pool worker rejected, `Promise.all`
rejected, `fetchCards` rejected, and the whole page was lost rather than the
one card. The sweep never reached page 45, so it did not catch this; the final
review did, by reading the schemas rather than by running further. It is fixed
two ways: `hydrate` now catches any throw out of `toCardDTO`, so no DTO-only
constraint the raw schema doesn't mirror can take a page down with it, and the
mapper defaults the missing `value` to `""` rather than the raw schema
requiring it — a card whose weakness has no printed multiplier is kept, not
dropped, which matters at this concentration because requiring it would have
emptied `pop1` and most of `pop2` out of the mirror.

### The ids diverge from the primary's, and that is PD-43's problem

TCGdex publishes 220 sets to the primary's 176, and the two disagree about
naming on the newer ones: `sv3pt5` against `sv03.5`, `me1` against `me01`. Card
ids inherit the set prefix, so **15 222 of the mirror's 20 670 cards (73.6%)
share an id with TCGdex and 5 448 do not**.

Switching providers on a populated database therefore forks the catalog rather
than failing — every foreign key holds and nothing raises. PD-43 carries the two
rules that make failover safe; until then, a TCGdex sweep belongs in its own
database.

## The catalog sync

`catalog-sync.processor.ts` fills the mirror. `catalog-sync.scheduler.ts`
enqueues it daily at 3am, and its entire body is a `queue.add`.

### The guard is the whole point

`catalog.writer.ts` holds the only raw SQL in this module, because Prisma has no
conditional-update upsert and `prisma.card.upsert` issues an UPDATE on conflict
unconditionally. On a 20 670-card catalog that is 20 670 dead tuples per sweep
plus churn across five indexes, for data that changes a few times a year.

Measured with `xmin`, the transaction that last wrote a row:

| | rows written | xmin |
| --- | --- | --- |
| unguarded, identical payload | 1 | moved |
| guarded, identical payload | 0 | unmoved |
| guarded, rarity changed | 1 | moved |
| guarded, same change replayed | 0 | unmoved |

Measured again end to end, which is the number that matters. Every existing card
id was snapshotted with its `xmin`, then a full sync re-fetched and re-upserted
19 920 cards:

```
rewrites among rows that already existed : 0
rows inserted (pages that had failed before) : 250
```

**Three rules hold it together, and breaking any is silent.** Column names are
quoted, because they are camelCase in the database. `"updatedAt"` is set with
`now()`, because Prisma's `@updatedAt` does not apply to raw SQL. And
`"updatedAt"` stays **out** of the comparison tuple — including it makes every
row differ from itself, which restores the churn while the SQL still looks
guarded.

`jsonb` values bind as `JSON.stringify(value)` with an explicit `::jsonb` cast;
arrays bind natively.

### Flat pagination, not per set

The ticket's scope line says per set. Per set is at least 176 requests, roughly
590 once PD-39's retries are counted at the measured 30% success rate. Flat at
250 cards a page is 83 requests, roughly 275. The anonymous rate limit cannot be
observed, since the provider sends no headers, so the cheaper loop wins and
failure isolation happens per page instead of per set — which is finer.

### The mirror converges rather than completing

A sweep does not finish the catalog in one pass, and is not meant to. Measured
across four real runs:

| run | processed | pages failed | cards in the mirror |
| --- | --- | --- | --- |
| 1 | 18 420 | 9 | 18 421 |
| 2 | 19 920 | 3 | 20 420 |
| 3 | 19 920 | 3 | 20 670 |
| 4 | 19 920 | 3 | 20 670 |

Each run picks up the pages the last one dropped, and the guard means the rows
already there are not rewritten on the way past. By run 3 the mirror was
complete. A run reporting `PARTIAL` with a handful of failed pages is the normal
outcome against this upstream, not a fault.

### Resumption

`SyncRun.cursor` holds `{ page }`. A run is only resumed when the BullMQ job now
executing is the one that created it, so a retry continues and a new job starts
clean.

Measured by killing the worker at page 5 and restarting it:

```
Resuming sync run cmu7hn5m8...  from {"page":5}
first page after restart: 5
sets re-fetched: 0
```

Sets are fetched only on page 1, so a resumed run does not spend a request
re-reading 176 sets it already wrote.

### Failure handling

| What | Result |
| --- | --- |
| a page exhausts PD-39's retry budget | counted into `failed`, skipped, loop continues |
| a card fails to parse | arrives in `CardPage.skipped`, counted, logged by id |
| `ProviderContractError` | run closes `FAILED` immediately — the upstream changed shape |
| the sets fetch fails | run closes `FAILED`; without sets, cards violate the foreign key |

A run finishes `SUCCEEDED` when nothing failed and `PARTIAL` otherwise. Only
those two invalidate the cache; a `FAILED` run leaves it warm, because the mirror
is no less current than it was.

### Two things that are not obvious

**`SyncModule` imports `QueueModule` for the scheduler, not the processor.**
BullMQ's explorer discovers `@Processor` classes globally, so the processor
resolves without it — but `@InjectQueue` resolves through the importing module's
own context, and the scheduler will not boot without the import.

**A probe that boots `WorkerModule` and enqueues will not exit promptly.** The
worker consumes what it enqueued, and `app.close()` drains the job in flight —
which for a catalog sync is minutes. That is PD-41's graceful shutdown working,
not a hang.

## Failover

`ProviderSelectorService` answers which provider a run uses. The processor asks
it **once per run**, never per page.

### The breaker

| | |
| --- | --- |
| counts | `ProviderUnavailableError`, `ProviderContractError` |
| never counts | `ProviderRateLimitError` |
| threshold | 5 **consecutive** escaped failures |
| cooldown | 30 minutes, expressed as the open key's TTL |
| state | `breaker:fail:{provider}`, `breaker:open:{provider}` in Redis db 0 |

Five, because four real sweeps against the primary failed 3 pages out of 83,
scattered rather than clustered — five in a row at that rate is an event of
roughly 6 × 10⁻⁸. Consecutive is what makes that true: any successful page
deletes the counter.

An individual 5xx never reaches the breaker. `http.ts` retries internally, so a
`ProviderUnavailableError` means the whole attempt budget was spent — which is
what makes the signal mean "unusable" rather than "a request failed".

**The state is not in the cache namespace and is not read through
`CacheService`.** That service turns a Redis failure into a miss, which is right
for a cache and catastrophic for a counter: the breaker would forget an outage
during exactly the incident that caused it. With Redis unreachable the breaker
reports closed and the run uses the configured primary — failing toward the
source the operator chose, rather than switching on no evidence.

### Two rules keep a failover from forking the mirror

The providers disagree about set ids on 50 of the mirror's 176 sets — `sv3pt5`
against `sv03.5`, `me1` against `me01`. **15 222 of the 20 670 cards (73.6%)
share an id with TCGdex; 5 448 do not.** A naive failover does not fail, it
forks: every foreign key holds, nothing raises, and the mirror quietly grows a
second copy of 50 sets.

1. **A fallback run never writes a set.** `fetchSets()` is not called.
2. **A fallback run may only write a card whose `id` is already in the mirror.**
   It refreshes; it never introduces.

Rule two checks the card and not its set, and that distinction was measured the
expensive way. TCGdex zero-pads card numbers **inside sets both providers
share** — `sv10-060` against `sv10-60` is one physical card under two ids — so a
set-level filter passes both. A real failover run wrote 593 such duplicates into
the mirror before this was caught, with every other rule holding and nothing
raising an error.

Neither rule names a provider, because this is a property of failing over rather
than of one source — a third provider inherits the protection without a line of
new code. The 50 divergent sets simply do not refresh while the primary is down;
they stay as they were, which is what a mirror is for.

**A fallback run always closes `PARTIAL`**, with the provider, the reason and the
skipped count in `SyncRun.error`.

### The set rule alone was not enough, and a real run proved it

The first implementation filtered on `setId`, and a live failover sweep ran with
every rule doing exactly what it was told: no set written, 7 160 cards skipped,
the run closed `PARTIAL` with its reason recorded. The catalog forked anyway.

**TCGdex zero-pads card numbers inside sets both providers already share.**

```
sv10-060  vs  sv10-60     Abomasnow
sv10-092  vs  sv10-92     Annihilape
sv10-023  vs  sv10-23     Arboliva ex
```

`sv10` is in the mirror, so a set-level filter passed both spellings. **593
physical cards ended up under two ids each**, with no error raised and every
foreign key intact.

It was quiet for a reason worth knowing: card numbers from 100 upward are
identical in both schemes, because there is nothing left to pad. Only 1–99
diverge, so roughly a third of each modern set forked — few enough to miss,
many enough to break search.

Measured after the fix, against TCGdex's `sv10` page: 244 ids fetched, 145
already in the mirror, so rule two writes 145 and blocks 99. The 99 are exactly
the forks.

### It switches at the next run, not mid-run

The ticket's scope line says the sync layer should switch "that batch". It does
not, deliberately. A mid-run switch would put two id vocabularies inside one
`SyncRun` — pages 1–40 as `sv4-25`, 41–83 as `sv04-25` — and the run's
`provider` column could then name only one of the two sources that wrote it.
The fork would arrive through the door marked resilience.

The cost is one sync cycle of staleness on the sets the fallback could have
served. The scheduler runs daily and the catalog gains a set a few times a year,
so that is a cost the architecture already absorbs; a forked catalog is not.

### Measured

| Measured | Result |
| --- | --- |
| provider recorded by the failover run | `tcgdex` |
| the failover run's close | `PARTIAL`, reason `fallback via tcgdex (breaker open for pokemontcg); no set written, 7160 cards skipped as not already mirrored` — 21 947 processed, 1 789 failed |
| sets before / after | 176 / 176 — rule one held |
| cards in sets absent from the mirror | 0 |
| sets matching the TCGdex id scheme (`30th`, `A1`, `sv04`…) | 0 |
| breaker after 10 consecutive 429s | failures 0, openUntil null |
| breaker after 5 consecutive 5xx | failures 5, openUntil set |
| four failures then a success | counter back to 0 — the measurement that proves "consecutive" |
| selection once the cooldown key expired | `pokemontcg`, isFallback false |
| selection with Redis unreachable, breaker open | `pokemontcg`, isFallback false, with a warning |
| `/admin/sync/status` no session / admin / member | 401 / 200 / 403 |
| `/admin/sync/status` with Redis stopped | 200 in 26 ms, every breaker reported closed |

When every registered provider's breaker is open, the selector throws before a
`SyncRun` is created, so the job fails in BullMQ and no row is written to
`sync_runs` — the spec's failure table says such a run closes `FAILED`, and this
is where that is corrected.

### What a failover costs beyond freshness

A fallback run refreshes the cards it is allowed to write **with TCGdex's field
values**. Measured on the run above: 14 787 rows were rewritten, and the rarity
vocabulary moved with them — 2 401 cards came back reading `Ultra Rare` and
`Holo Rare` where pokemontcg.io writes `Rare Ultra` and `Rare Holo`. Image URLs
moved to TCGdex's CDN for the same rows.

Nothing is lost and nothing forks, but it is visible: after an outage day a
filter on `?rarity=Rare Ultra` stops matching those cards until the primary
sweeps them again.

A rarity translation table is the same brittle construct rejected for set ids,
and it would break in the same silent way. `RarityTier` in M12 is a
presentation-layer concept that already has to normalise rarity for display, and
that is where this belongs.

### When every provider is down, no run is recorded

If every registered provider's breaker is open, the selector throws before a
`SyncRun` row is created, so the job fails in BullMQ's failed set and nothing
is written to `sync_runs`. A row would have nothing truthful to put in its
`provider` column. An operator looking for the event finds it in the queue, not
in the table.
