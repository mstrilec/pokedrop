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
once retries are counted.

**The anonymous ceiling is 1 000 requests a day and 30 a minute**, documented
rather than observed: no response carries a rate-limit header, verified again
2026-09-21 on both a 200 and a 500. A key would raise the daily figure to 20 000
and **there is no longer a key to get** — pokemontcg.io closed registration when
it deprecated the API. Existing keys work through 2027-03-01.

So a sweep and a price sweep together spend roughly half the day's allowance,
and PD-49 counts what it spends rather than trusting the arithmetic.

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

**A page's `catch` also runs `alreadyMirrored()` and the upsert transaction, and
only a `ProviderUnavailableError` out of that block counts toward the breaker.**
A Prisma error, a constraint violation or a lock timeout is counted into the
run's `failed` total like any other bad page, but never toward failover: it is
this application's failure, not evidence the provider is down, and counting it
would open the breaker against a healthy primary over a database hiccup —
paying the fallback's rarity and image-URL churn on ~15 000 rows for something
that had nothing to do with either provider.

**The breaker opening mid-run is what stops the page loop while a provider is
down.** Every failed page sets `hasMore = true` with no ceiling on `page`, so
without this a fully unavailable provider would page for ever. After a
`ProviderUnavailableError` is recorded, the processor checks whether that
recording just opened the breaker; if it did, the loop breaks — after the
cursor and progress for that page are written, so the run resumes from the
right place — and the run closes `PARTIAL`. The next scheduled run picks up
from the cursor, served by whichever provider the selector then chooses.

### A resumed run keeps the provider its row names

`process()` looks for a `RUNNING` row this job already owns *before* it asks
`ProviderSelectorService` for anything. If one exists, the run calls
`selector.resume(row.provider)` instead of `selector.select()` — it does not
ask the selector to choose again.

That matters because a `SyncRun.cursor` page number means something different
to each provider: pokemontcg.io paginates its own catalog and TCGdex paginates
a differently-ordered index of a differently-sized one, so page 41 on one
provider is not page 41 on the other. A breaker can flip between a job's
attempts — that is the whole point of a breaker — so a BullMQ retry that asked
`select()` again could resume a cursor cut on one provider's list against the
other's, silently skipping or re-reading the wrong slice. It would also leave
`sync_runs.provider` naming a source that did not write the pages recorded
under it, which breaks the admin endpoint's whole purpose.

`resume()` returns `null` when the row's own provider has an open breaker by
the time the retry runs. The processor then closes that row `PARTIAL` and
returns without starting a page loop, rather than resuming on a different
source with a cursor that means nothing there.

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

## The price write path

`price-sync.processor.ts` on `QUEUE.priceSync`. It is handed card ids and does
not choose them — PD-52 enqueues a single card at a time. One producer, one
consumer. Neither PD-49's nightly sweep nor PD-50's active refresh fills this
queue: both are their own coordinator job on their own queue
(`QUEUE.priceSweep`, `QUEUE.priceActive`), calling `PriceBatchService`
directly rather than enqueuing here — see "The nightly price sweep" and "The
active refresh" below.

### Per batch

1. Ask the selector for a provider — the same breaker the catalog sync feeds.
2. `fetchPrices(cardIds)` once for the whole batch.
3. `UPDATE cards` for every card the response carried.
4. `createMany` the snapshots with `skipDuplicates`.
5. `DEL cache:price:card:{id}` and `cache:card:{id}` per card, **after the commit**.

**Batch size is 100.** Measured against the primary: 100 cards in 3.9 s, 250 in
19.2 s — five times the wall clock for two and a half times the work, because
the provider's `OR`-query cost grows faster than linearly. At 100 the catalog is
207 jobs and a failed one costs 100 cards.

**Re-measured 2026-09-21, and the curve is not what this says.** Through the
same code path: 100 cards cost 4.53 s (fetch 4.37, write 0.16) and 250 cost
12.57 s (fetch 12.21, write 0.36) — 2.77× the time for 2.5× the work, which is
roughly linear. A single 19.9 s observation for 250 did appear, and a 21.4 s
*success* appears in a 20-request sample of single cards, so the original 19.2 s
looks like this distribution's tail rather than its shape.

The batch of 100 stands for PD-52, where a failed batch should be small.
**PD-49's sweep uses 250**, because against a ceiling of 1 000 requests a day
the 83-request pass beats the 207-request one and the two minutes of wall
clock between them buy nothing. **PD-50's active refresh also uses 250, for
the same reason** — a failed batch there is picked up again at the job's next
scheduled run rather than needing to stay small for isolation, since the
cards in it are simply staler by then and sort higher in the next selection.

**Two keys are deleted per card, after the transaction commits, not inside
it** — a crash in that gap leaves a stale price readable for up to the price
TTL of one hour. Doing the deletes after commit is still the right trade, since
the alternative holds row locks across a network call. `cache:price:card:{id}`
is the obvious one; `cache:card:{id}` is the second, and it is not incidental —
`CatalogService.getCard` caches the whole card, price columns included, for 24
hours, so leaving that key behind serves the pre-sweep price from
`GET /cards/:id` for up to a day while `GET /cards/:id/price` serves the new
one. `PriceBatchService.invalidate` deletes both.

**PD-51 is `cache:price:card:{id}`'s first reader.** Until now every `DEL`
this path issued removed a key nothing had ever populated — PD-48, PD-49 and
PD-50 all invalidated a namespace no route was serving out of, so the crash
window above cost nothing observable. `GET /cards/:id/price` reads through
that key now, so the same commit-then-delete gap can hand a real client a
stale cached price for up to the TTL if a crash lands inside it. The trade is
unchanged — deleting after commit is still right, since the alternative holds
row locks across a network call — but the window it leaves is observable
rather than theoretical.

### Two rules that look similar and are not

**A currency the response did not carry is written as `null`.** There is one
`priceUpdatedAt` for both columns, so keeping a stale EUR beside a fresh USD
would make that timestamp true of one column and false of the other with no way
for a reader to tell which. The older value is still in `PriceSnapshot`.

**A card the response did not carry at all is not touched** — not its columns,
not its timestamp, not a snapshot. The two are told apart by whether the card
appears in the response, not by whether a particular currency does.

### The cap is a database invariant

`skipDuplicates` against the unique index on `(cardId, source, capturedOn)`.
The database decides, so a second run in a day inserts nothing and two
concurrent workers get the same answer as one. See `docs/DataModel.md` for why
this is a materialised date column rather than an expression index.

### Prices cannot fork the catalog

PD-43 needed two rules to stop a failover forking the mirror. This path needs
none, and not by carefulness: the response is intersected against `cardIds`
before anything is grouped, so the only ids that reach the writer are the ones
this job put in its own payload — which came out of our own database, not the
provider's. The path does insert rows, `price_snapshots` among them, but every
snapshot is keyed by a card id that already passed that intersection, so a
snapshot can never reference a card the mirror does not hold.

**The known cost of a fallback price run:** TCGdex cannot address roughly 10–15%
of our card ids — the zero-padding divergence PD-43 documents. Measured through
the real processor: of 40 `sv10` cards, TCGdex could address 35 and could not
address 5. Those cards keep their previous values, which is indistinguishable
from "the provider has no price for this card". Recorded rather than solved,
for the same reason the id translation table was rejected twice.

### "A card the provider has no price for" is a fallback-only state

The primary prices essentially everything in this mirror. Measured across four
sets — `base1`, `basep`, `si1`, `mcd19` — **143 of 143 cards came back priced**,
so a batch against pokemontcg.io cannot produce an unpriced card to observe.

The state is reachable through the fallback, and that is its real production
shape. Measured by opening the primary's breaker and running 40 `sv10` cards
through the processor on TCGdex:

| | |
| --- | --- |
| refreshed | 35 — the ids at 100 and above, which TCGdex can address |
| **untouched** | **5** — `sv10-1`, `sv10-10`, `sv10-11` and two more |

Each untouched card kept both its previous values and its previous timestamp
exactly: `1.11 usd / 2.22 eur at 2026-01-01T00:00:00.000Z`, seeded before the
run. That is "keeps its previous values and stale timestamp" demonstrated in
the circumstance that actually produces it, rather than against a row that was
empty to begin with.

### Measured

| Measured | Result |
| --- | --- |
| batch size, elapsed for the first run | 100 cards, completed |
| cards asked / cards the provider priced | 100 / 100 |
| snapshots after the first run | 199 — one card in the batch was priced by a single marketplace rather than both, not a rounding error |
| snapshots after a second run the same day | **199** — unchanged |
| `priceUpdatedAt` on the second run | moved, `11:50:17.797Z` → `11:50:21.553Z` |
| sentinel cache key on a written card | gone; 0 of 100 sentinels survived, matching 100 − 100 priced |
| neighbouring card's cache key | survived |
| maximum snapshot rows for one card in a day | 2, one per source |
| a sample card's USD and EUR | both populated |

## The nightly price sweep

`price-sweep.processor.ts` on `QUEUE.priceSweep`, triggered by
`price-sweep.scheduler.ts` at 4am. It is the third producer PD-48 named and
never enqueued — this is where it lives, and it calls `PriceBatchService`
directly rather than filling `price-sync` with 83 jobs.

### One coordinator, not a fan-out

The sweep is a single job that walks `cards` itself, batch after batch, inside
one `process()` call. A fan-out — 83 `price-sync` jobs, one per batch — buys
BullMQ's own retries per job, and costs a run-tracking problem with no good
answer: 83 jobs closing one `SyncRun` row have no natural order, and the row
would need to decide which job's failure, if any, decides the run's status. One
coordinator keeps the row's lifecycle exactly as legible as the catalog sync's.

### The rolling cursor and the wrap

`SyncRun.cursor` holds `{ lastCardId }`, walked with `id > lastCardId` in
ascending order, `BATCH_SIZE` (250) rows at a time — keyset pagination over our
own table, not a provider's list.

A nightly sweep that always started over at the first card would starve
whatever lies near the end of a 20 670-row catalog: a truncated night — the
budget or a stall cutting it short — would mean the tail never gets swept at
all. So a fresh run does not start at the beginning; it starts from where the
last **finished** run stopped (`SyncRunService.lastClosedCursor`), and when the
walk reaches the end of the table it wraps once, to `id > ''`, and continues
until it crosses its own starting point. That is what makes "full sweep"
something the aggregate of runs achieves rather than something one run must
prove — reaching the end of the table is not the same as covering the catalog,
and the loop tracks both separately (`wrapped`, `startedFrom`, `lastOfPass`).

A second wrap is refused: a run that reaches the end of the table twice would
sweep for ever rather than stop.

### Two resumptions, kept apart

They look alike and are not. Within a run, a BullMQ retry of the same job
continues from that row's own cursor — `SyncRunService.findResumable` matches
on `jobId`, the same guard the catalog sync uses, so a retry picks up exactly
where its own attempt left off. Between runs, a fresh job (a new `jobId`) has
no row of its own yet, so it continues from the last **finished** run's
cursor instead. Conflating the two would let a retry re-derive "the last
finished run's position" and skip whatever its own failed attempt had already
priced — the row that exists for exactly that job is the one source of truth
for it.

### The budget counter

`RequestBudgetService` counts every request against `POKEMONTCG_DAILY_REQUEST_BUDGET`,
keyed `budget:{provider}:{day}` (UTC day) — outside the `cache:` namespace, for
the same reason the breaker's keys are: a routine cache flush must not hand a
sweep a fresh allowance against a provider it has already asked hundreds of
times today. `hasHeadroom(provider, reserve)` is checked before every batch,
not only once, and the sweep stops while `reserve` (`PRICE_SWEEP_RESERVE`,
300) is still unspent, leaving room for PD-50 and PD-52 on the same day.

**It fails open.** A Redis error makes `stateOf` report nothing spent, so
`hasHeadroom` answers true and the sweep proceeds. Failing closed would stop
every sync on a Redis blip; the cost of failing open is at worst a 429, which
the sweep already has to handle, because this counter is our own accounting
and never the provider's — no response carries a rate-limit header.

### The 429 stall

A `ProviderRateLimitError` does not advance the cursor and is not counted into
`failed`: the batch is asked for again on the next turn of the loop, after a
wait sized against the documented per-minute ceiling (30 s base, doubling,
capped at 5 min) rather than `http.ts`'s 250 ms 5xx backoff. Five consecutive
stalls (`PRICE_SWEEP_MAX_STALLS`) stop the run for the night rather than wait
indefinitely.

As with the catalog sync's `Retry-After` path, **this is verified by reading
the code, not in the field.** A deliberate 60-request burst on 2026-09-21
produced 29×200, 23×500, 8×502 and zero 429s — the per-minute ceiling could not
be provoked, because this upstream fails faster than it rate-limits. The two
claims that matter — a stall does not touch `failed`, and the cursor does not
move across one — hold by inspection (`runBatch` returns before any mutation
of `lastCardId`), and remain unconfirmed against a real 429.

### A `PARTIAL` run with no error is the ordinary outcome, not a fault

A completed pass — the walk reached its own starting point — closes `PARTIAL`
whenever any batch failed along the way, and it closes with `error = NULL`
whenever nothing else stopped it early: no budget message, no breaker message,
no fallback note. Against this upstream that is the *ordinary* nightly result,
not a degraded one — batches die outright, scattered rather than clustered,
the same shape the catalog sync's pages fail in. (The design spec predicted
one in six, 0.7⁵ ≈ 17%, from the measured 30% per-request success rate; the
real sweep measured 6 of 83, about 7%, one in fourteen. The measurement wins —
likely because that prediction came from a probe retrying in a tight loop with
no backoff, while the real client waits on a jittered exponential backoff and
so lands in healthier moments than a burst does.) An operator reading
`/admin/sync/status` sees `PARTIAL` and must read the `failed` count beside it
to know why; the design deliberately does not synthesise a reason string for
"some batches failed, the rest of the catalog got priced."

### Measured, 2026-09-21

| Measured | Result |
| --- | --- |
| a full pass, 83 batches of 250 | 874.6 s, closed `PARTIAL`, 18 193 processed, 1 500 failed |
| batches that died outright (5xx/timeout, not a 429) | 6 of 83 |
| the breaker | never opened during the pass |
| the budget stop | `daily request budget exhausted: 900 of 1000 spent, reserve 300`, cursor unmoved |
| a second run re-pricing 249 already-priced cards the same day | 0 new snapshots |
| maximum rows per `(cardId, source, capturedOn)` | 1 |
| 60-request burst, provoking the per-minute ceiling | 29×200, 23×500, 8×502, **0×429** |

## The active refresh

`price-active.processor.ts` on `QUEUE.priceActive`, triggered by
`price-active.scheduler.ts` four times a day. It is the nightly sweep's
sibling rather than its replacement: the sweep walks the whole catalog slowly
and thoroughly; this job walks a small, bounded set of cards someone actually
has a stake in, often.

### Three signals, one union, and why trade counts regardless of status

A card is active if it appears in `inventory_items`, `deck_cards`, or
`trade_items` for a trade created within the trade window — any status. A
trade offered and never accepted is still evidence someone looked this card up
recently and might again; restricting to completed trades would drop that
signal for exactly the window in which it is freshest, on the theory that a
still-open trade is less interesting than a closed one. It is the opposite.

### One query, three criteria

`ActiveCardSelector.select()` is a single `$queryRaw` statement — raw SQL
because the membership test is a `UNION` of three tables and Prisma's query
builder cannot express one. It earns three of the ticket's acceptance
criteria in one round trip:

- **Membership** — the `UNION` of the three signals above, against the
  `cardId` indexes Task 1 added.
- **Freshness, and one-directional deduplication against the sweep** — the
  same `WHERE c."priceUpdatedAt" IS NULL OR c."priceUpdatedAt" < staleBefore`
  predicate does both jobs. A card the nightly sweep (or this job's own
  previous run) just priced carries a recent `priceUpdatedAt` and drops out of
  the union on its own; there is no run registry and no Redis marker shared
  between the two jobs, because the column PD-48 already writes is the entire
  mechanism. **The avoidance runs one way, not both.** The active job skips
  what the sweep already priced, through this predicate. The sweep does not
  return the favour — `price-sweep.processor.ts` is a pure keyset walk with no
  freshness predicate at all, so it will re-price a card the 23:00 active run
  refreshed five hours earlier, inside the same 6-hour window. That costs
  nothing, since the sweep's ~250 requests are fixed by the catalog's size
  regardless of what it finds stale, but it means the ticket's "never
  double-fetch the same card in one window" criterion holds for the active job
  avoiding the sweep's work, not for the sweep avoiding the active job's.
- **The bound** — `LIMIT maxCards + 1`, one more than the bound so truncation
  is detectable without a second query (a bare `LIMIT` returning exactly
  `maxCards` cannot tell "there were this many" from "there were more").

### Staleness stands in for the trending signal the ticket asked for, and view tracking was deferred rather than built

The ticket asks for priority ordering by most-viewed. That was not built.
Ordering is `ORDER BY c."priceUpdatedAt" ASC NULLS FIRST` — oldest-priced
first — because there is no traffic to shape a view-based ordering with: the
frontend is M11–M13, and all three of those milestones are at 0%. A view
counter built today would record nothing but this project's own probes and
call that a popularity signal. Staleness is not a placeholder standing in
until traffic arrives; it is the ordering a refresh job wants on its own
terms, since the point of the job is to price whatever has gone longest
without a price. If M11–M13 ship a real view signal later, that is a
prioritisation *within* the active set this query already selects, not a
change to what makes a card active.

### The bound protects the budget; the cadence does not

Four runs a day of an unbounded active set would cost roughly the same as a
full sweep, repeated four times — at 20 670 cards that is close to the whole
1 000-request daily allowance in active-refresh traffic alone, leaving
nothing for the sweep, the catalog sync, or PD-52's on-demand path. The
cadence controls how often the job asks the question; `maxCards` controls how
expensive one asking is allowed to be. Only the second one is what keeps a
popular catalog affordable — a busier cadence with the same bound costs the
same per run, just more often; a smaller bound is the only thing that lowers
the cost of a single run.

### The cron is four fixed hours, not `EVERY_6_HOURS`

`price-active.scheduler.ts` registers `0 5,11,17,23 * * *`, not
`CronExpression.EVERY_6_HOURS`. That built-in expression is `0,6,12,18`,
which puts a run at 00:00 UTC — immediately after
`POKEMONTCG_DAILY_REQUEST_BUDGET` resets for the day and three hours *before*
the catalog sync (3am) and the nightly sweep (4am). Those two jobs are safe
running unreserved not because either one carries a reserve of its own — the
sweep's `PRICE_SWEEP_RESERVE` (300) protects what runs *after* it, not the
sweep itself — but because they are first to spend from a fresh allowance
every day; an active run at midnight would spend ahead of them, before either
had a chance to take its share. 05, 11, 17 and 23 UTC are all after both
nightly jobs have already taken their share, and none of the four straddles
the reset.

Registered in the worker and not the API, same as the sweep: two processes
running this cron would enqueue two runs each time.

### The 05:00 run is structurally empty, and that is not a bug

Measured, not inferred: a full nightly sweep takes 874.6 s (about 14.6
minutes), so a sweep starting at 04:00 finishes around 04:15, having written
`priceUpdatedAt` on every card it got a response for. At 05:00 UTC — 45
minutes later — every one of those cards is well inside the 6-hour
`PRICE_ACTIVE_FRESHNESS` window, so the same predicate that deduplicates
against the sweep (see "One query, three criteria" above) empties the 05:00
selection out too, except for whatever active card the sweep could not price
that night.

That makes the ticket's "four runs a day, so an active card is refreshed up
to four times" **three in practice**: 05:00 is a near-guaranteed no-op sitting
between a sweep that just finished and three runs (11:00, 17:00, 23:00) that
actually have stale cards to find. It costs nothing when it happens — an empty
selection spends zero requests — so it is a wasted cron tick, not a wasted
budget.

No fourth working slot exists under the current window. Moving the run
earlier collides with the sweep still in flight; moving it later collides
with 11:00. Fixing this would mean shrinking `PRICE_ACTIVE_FRESHNESS` below
6 hours, or moving the sweep, and both are out of scope here. **The cron is
not changed by this ticket.**

### The thresholds are decisions, not measurements

Four numbers, and none of them came from load — they were sized by reasoning
against a live active set of 8 cards, because that is the size this database
had:

| Setting | Value | Why |
| --- | --- | --- |
| `PRICE_ACTIVE_FRESHNESS` | 6 hours | equal to the cadence — shorter re-fetches what the previous run just wrote; longer leaves a run with nothing to do |
| `PRICE_ACTIVE_TRADE_WINDOW_DAYS` | 30 days | how far back a trade still counts as evidence somebody cares — the cheapest of the four to revisit |
| `PRICE_ACTIVE_MAX_CARDS` | 2 500 | the bound, and the setting that actually protects the budget — see below, arithmetic rather than measured |
| `PRICE_ACTIVE_RESERVE` | 150 | left unspent for whatever runs after this job on the same day — by the time this job runs that is PD-52's on-demand traffic, since the nightly jobs already took their share hours earlier |

The `maxCards` row is arithmetic, not a measurement, and is spelled out rather
than just asserted: 20 670 cards at 250 a batch is 83 batches; four runs a day
is 332 batches; at roughly three requests a batch — the same retry-inflated
multiplier the catalog sync measures, 275 requests over 83 pages above — that
is on the order of 990 of the 1 000 requests available. Close enough to the
daily ceiling that an unbounded active set would leave nothing for the sweep,
the catalog sync, or PD-52; the number is a computation from those two
measured figures, not an observation of its own.

`price-active.processor.ts` also reuses `PRICE_SWEEP_MAX_STALLS` as its own
stall ceiling rather than declaring a fifth setting. The two jobs hit the
same upstream under the same rate-limiting policy, so the right value is the
same number by construction; a `PRICE_ACTIVE_MAX_STALLS` that always equalled
the sweep's would be a knob nobody could turn separately. The cost is that the
constructor reads a config key named for the other job, which reads oddly on
first sight.

### No cursor, and no attempt to keep one

Unlike the sweep, this job re-derives the active set from scratch on every
run, including a BullMQ retry of the same job — there is nothing to resume.
A card a failed attempt did not reach is staler on the next run than it was
on this one, and therefore sorts higher in the selection; the ordering itself
is what recovers the work a dead run left undone.

`SyncRunService.recordProgress` requires a cursor argument regardless, so
this job passes `{ lastCardId: <last id of the batch just written> }` — true
of where the run got to, but read by nothing and meaningless as a resumption
point. Widening `SyncCursor` with a no-cursor variant for this one caller
would be more machinery than the problem deserves; the field is not
load-bearing here, and this paragraph is the record of that.

### A card the provider never returns is a permanent head-of-queue slot

`priceUpdatedAt` is written only when a card appears in the provider's
response (`price.writer.ts`'s `updateLatest`, fed from `PriceBatchService`'s
`updates`, which is built from the response) — deliberate, and correct for
what the `latestPrice*` columns mean. A card the provider is simply never
going to return is not touched at all: no columns, no timestamp, forever
`NULL`.

The selector orders `ASC NULLS FIRST` and re-derives its set from scratch on
every run (see "No cursor" above), so a card in that state does not merely
get skipped once — it sorts to the very front of every future selection, on
every run, indefinitely. The nightly sweep does not have this problem: its
keyset cursor (`id > lastCardId`) walks past a card it could not price and
keeps going, so an unreturnable card costs that one sweep a slot and nothing
more. The active refresh's ordering gives it no such escape.

The population is not hypothetical, though the number below is an **inference
from the sweep's recorded numbers, not a direct measurement**: the sweep's own
recorded run (see "Measured, 2026-09-21" above) priced 18 193 cards and lost
1 500 to batches that failed outright, out of a 20 670-card catalog. That
leaves roughly **977 cards** (20 670 − 18 193 − 1 500) that were asked for,
inside a batch that did not fail, and simply came back absent from the
response — cards the provider silently declines to price rather than cards a
failure prevented this job from asking about.

Invisible today: the active set is 8 cards, all of them seed data that prices
successfully. But if the active set ever grew to include even a few hundred
such cards, they would permanently occupy the front of every selection this
job runs, and — once enough of them exist to fill `maxCards` on their own —
the job would stop refreshing anything else, ever, while reporting a normal
`SUCCEEDED` or `PARTIAL` run each time.

The real fix is a schema and design decision for a later ticket — a separate
`priceCheckedAt` column that advances whether or not the provider returned a
price, or counting "asked minus priced" some other way — and is out of scope
here. This ticket records the failure mode rather than solving it; **no
column is added and the ordering is unchanged.**

### Measured, 2026-09-22

The active set, against this database's seed data, was **8 cards**: 7 rows in
`inventory_items` covering 7 distinct cards, 3 rows in `deck_cards` covering 3
cards, 7 rows in `trade_items` covering 6 cards, and the three unioned come to
8 distinct cards — the three signals overlap rather than adding cleanly. All
of it is seed data: owned cards arrive with M6, decks with M7, trades with
M8, and all three milestones are at 0% today. The catalog itself is 20 670
cards, so the active set was 0.04% of it.

| Measured | Result |
| --- | --- |
| selection | `8 active cards selected` |
| first run | `SUCCEEDED`, 8 processed, 0 failed |
| second run, immediately after | `SUCCEEDED`, **0** processed, 0 failed |

The second run is the proof, not the first. A job that failed to write
`priceUpdatedAt` back would select the same 8 cards again and the second run
would also show 8. A selector that was simply broken would have returned 0 on
the *first* run, before anything had been priced. Only a selector that reads
correctly and a processor that writes correctly, in that order, produce 8
then 0 — the pair demonstrates the deduplication property end to end rather
than by inspection of the code.

### The query plan, measured twice

The first measurement was wrong by construction, and the reason is worth
keeping alongside the number it produced. It loaded `inventory_items` with
one row per catalog card — roughly 20 670 of the catalog's 20 670 cards
"owned" — which made both branches of the selector's `WHERE` clause close to
100% non-selective: almost every card was active, and almost none had ever
been priced. At that selectivity a sequential scan is the cost-optimal plan
no matter what indexes exist, so that measurement could not have shown
anything else regardless of whether Task 1's indexes worked.

Re-measured at a realistic shape — about 2 200 active cards, with the
remaining ~18 000 freshly priced so the freshness branch became selective
too — the planner chose differently: a `BitmapOr` over two `Bitmap Index
Scan`s on `cards_priceUpdatedAt_idx`, feeding a `Bitmap Heap Scan`. The three
membership tables (`inventory_items`, `deck_cards`, `trade_items`) stayed
sequentially scanned, which is the planner's correct choice at roughly 2 200
rows apiece rather than a sign the indexes Task 1 added on those tables don't
work. The `ORDER BY` was satisfied by an in-memory quicksort rather than an
index scan.

**The honest verdict: the criterion is met for the one branch where it was
contestable — the `cards.priceUpdatedAt` freshness predicate, which is the
predicate that matters once `cards` is the table with 20 670 rows — and it is
not generalised to the membership tables, where a sequential scan is
correct at their size and would stay correct for a long time.**

The plan's row-count estimates are left out of this record on purpose: one
`Bitmap Index Scan` arm reported 16 906 rows against a parent `Bitmap Heap
Scan` of 2 200, and the two did not reconcile on review — stated only to show
the discrepancy, not as selectivity. What is certain from that plan is the
choice of operator and the index name; the row counts are not.

### The membership indexes existed to be added, not merely to be present

`inventory_items(cardId)`, `deck_cards(cardId)` and `trade_items(cardId)` are
Task 1's, alongside `cards(priceUpdatedAt)`. Two of the three membership
tables previously carried `cardId` only as the *second* column of a composite
unique index — a btree cannot search on a column that isn't its prefix — and
`trade_items` had no index on it at all. The active refresh is the first
caller either shape would have slowed down.
