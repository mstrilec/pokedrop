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

`SyncModule` is not imported into `AppModule`. Nest builds providers eagerly, so
wiring an empty registry would make the boot refusal fire on every start. PD-39
wires it together with the first provider.

| Ticket | Adds |
| --- | --- |
| PD-39 | `providers/pokemon-tcg/` — client, raw schema, mapper |
| PD-40 | `providers/tcgdex/` — the same against the fallback |
| PD-41 | BullMQ queues and the worker entrypoint |
| PD-42 | `catalog-sync.processor.ts` and the `SyncRun` model |
| PD-43 | failover and the circuit breaker, reading the error taxonomy |

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
