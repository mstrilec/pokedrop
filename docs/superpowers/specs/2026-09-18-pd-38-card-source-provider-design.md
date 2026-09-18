# PD-38 — CardSourceProvider and the normalized DTOs

Design, 2026-09-18. Milestone M3 · Catalog Mirror & Sync.

Ticket: [PD-38](https://linear.app/mstrilec/issue/PD-38/cardsourceprovider-adapter-interface-and-normalized-dtos) ·
Reference: `docs/Architecture.md` §3 (provider adapter pattern) · `docs/PRD.md` §15 and Appendix A decision 2.

First ticket of M3. Nothing in this ticket talks to a network, writes to the
database, or enqueues a job. It defines the seam the rest of the milestone is
built against.

---

## The seam, and what it is worth

The entire mirror architecture rests on one claim: the application does not know
which card API is behind it. `docs/Architecture.md` §1 states it as a principle,
§3 names the providers, and `docs/PRD.md` Appendix A decision 2 records it as a
deliberate choice rather than an accident of implementation.

A claim like that is worth exactly as much as the enforcement behind it. This
ticket is the enforcement.

### The measurement that made it concrete

Taken 2026-09-18 against both live providers, before any code was written.

```
GET https://api.pokemontcg.io/v2/sets?pageSize=2   → 200, 0.68s, totalCount 176
GET https://api.pokemontcg.io/v2/cards?pageSize=1  → 500   (three attempts)
GET https://api.pokemontcg.io/v2/cards?q=set.id:…  → 500   (url-encoded and raw)
GET https://api.pokemontcg.io/v2/cards/base1-4     → 500
```

The response headers rule out an edge failure:

```
HTTP/1.1 500 Internal Server Error
x-request-id: 760e0459-6b6b-4a57-b2a9-04f7c788e2a0
x-runtime: 0.054025
cf-cache-status: DYNAMIC
Server: cloudflare
```

`x-runtime` is present, so the origin answered. The primary provider's card
endpoint is returning a server error of its own while its set endpoint serves
normally.

TCGdex answered every request during the same window.

The documented fallback stopped being a hypothetical on the day M3 started. That
does not change which provider is primary — see *Why the roles are not swapped*
— but it does mean the error taxonomy and the registry in this ticket are load
bearing from the first job that runs, not from some later hardening pass.

---

## What the two providers actually return

Both payloads were captured live and are the fixtures the verification plan
feeds through the schemas.

### pokemontcg.io

`/v2/sets` returns what `CardSet` needs, in one call:

```json
{ "id": "base1", "name": "Base", "series": "Base", "printedTotal": 102,
  "total": 102, "releaseDate": "1999/01/09",
  "images": { "symbol": "…/symbol.png", "logo": "…/logo.png" } }
```

`releaseDate` is `YYYY/MM/DD` with slashes, which `new Date()` parses but
`z.coerce.date()` should not be trusted with blindly — the mapper normalizes it.

`/v2/cards` could not be measured — it answers 500. Its shape is taken from the
provider's documentation and from this repository's own M1 work, where `Card`
and the schemas in `packages/shared` were modelled on it: full card objects, up
to 250 per page, with TCGPlayer (USD) and Cardmarket (EUR) price blocks
embedded. That is roughly 80 requests for a 20 000-card catalog, and it is the
reason this provider is primary.

**Everything in this section attributed to `/v2/cards` is documented, not
observed.** PD-39 is the ticket that confirms or corrects it against a live
response, and it should treat these as expectations to verify rather than as
settled facts.

### TCGdex

`/v2/en/sets` returns a **brief** set: `id`, `name`, optional `logo` and
`symbol`, `cardCount`. It carries neither `series` nor `releaseDate`, both of
which are `NOT NULL` on `CardSet`. The full shape is only on
`/v2/en/sets/{id}`:

```json
{ "id": "base1", "name": "Base Set", "releaseDate": "1999-01-09",
  "serie": { "id": "base", "name": "Base" },
  "cardCount": { "official": 102, "total": 102 },
  "logo": "…/logo", "legal": { "standard": false, "expanded": false } }
```

So a TCGdex set sync is 1 + N calls, not 1. N is 176 today.

Cards are worse. `/v2/en/cards?set=base1` and the `cards[]` array inside a set
both return only `{id, localId, name, image}`. Full card data exists solely at
`/v2/en/cards/{id}` — one request per card, so roughly 20 000 for a full sweep
against pokemontcg.io's 80.

GraphQL does not rescue this. The endpoint is live and validates queries, but
introspecting `CardsFilters` returns:

```
category, description, energyType, evolveFrom, hp, id, localId, dexId,
illustrator, level, name, rarity, regulationMark, stage, suffix,
trainerType, retreat
```

There is no `set` filter, so cards cannot be batched by set there either.

What TCGdex gives back in exchange is richer pricing —
`pricing.cardmarket` with `avg/low/trend/avg1/avg7/avg30` in EUR,
`pricing.tcgplayer` with `lowPrice/midPrice/highPrice/marketPrice` in USD per
variant — and `thirdParty: { cardmarket, tcgplayer }`, which is exactly our
`cardmarketId` and `tcgplayerId`.

### Where the shapes disagree

These are the differences the mappers in PD-39 and PD-40 must absorb so that
nothing downstream ever learns of them. Listed here because they are what
justifies the DTO layer existing at all.

The TCGdex column is measured. The pokemontcg.io column is documented — its set
rows come from the live `/v2/sets` response, its card rows from the provider's
documentation and the shapes M1 already encoded in `packages/shared`.

| Concept | pokemontcg.io | TCGdex |
| --- | --- | --- |
| Card class | `supertype` | `category: "Pokemon"` |
| Subtypes | `subtypes: string[]` | `stage: "Stage2"` |
| Image | `images.small` / `images.large`, full URLs | `image`, extensionless base — append `/low.webp`, `/high.png` |
| Retreat | `retreatCost: string[]` | `retreat: 3` |
| Attack damage | string | `100` (number) |
| Attack text | `text` | `effect` |
| Converted cost | `convertedEnergyCost` | absent — it is `cost.length` |
| Ability text | `text` | `effect` |
| Legality | `legalities: Record<string, string>` | `legal: { standard: false, expanded: false }` |
| Pokédex number | `nationalPokedexNumbers: number[]` | `dexId: [6]` |
| Weakness value | string | `"×2"` — U+00D7, not ASCII `x` |
| Set series | `series: "Base"` | `serie: { id, name }`, set detail only |
| Set totals | `printedTotal`, `total` | `cardCount.official`, `cardCount.total` |

`retreat: 3` maps to three `"Colorless"` entries rather than to an opaque count.
That is not an approximation: retreat cost in this game is always colorless, so
the expansion is lossless.

---

## Why the roles are not swapped

The obvious reaction to a primary provider returning 500 is to promote the one
that answers. It is the wrong move here, for a reason that outlives today's
outage: **TCGdex has no bulk path to full card data.** 20 000 requests against
80 is not a fallback penalty worth accepting as the steady state, and a provider
serving one card per request will hit its own limits long before it finishes.

pokemontcg.io stays primary, per `docs/PRD.md` §15. The default of the new
`CARD_SOURCE_PROVIDER` variable is `pokemontcg`.

What the outage changes is sequencing, not architecture. PD-41 moves ahead of
PD-39 in M3 — it has no provider dependency at all, and it gives the upstream
time to recover. If `/v2/cards` is still answering 500 when PD-39 is
implemented, that ticket's second acceptance criterion is recorded as blocked
upstream rather than quietly marked done. This repository does not carry claims
it has not measured.

---

## Architecture

### Layout

```
apps/api/src/sync/
  providers/
    card-source-provider.ts   the interface, the name union, the tokens
    provider.dto.ts           SetDTO, CardDTO, PriceDTO and their schemas
    provider.errors.ts        the error taxonomy
    index.ts                  the only public surface of this folder
  sync.module.ts              provides both tokens
  index.ts
```

PD-39 adds `providers/pokemon-tcg/`, PD-40 adds `providers/tcgdex/`. Each owns
its raw payload schema, its mapper, and its HTTP client, and exports nothing but
a class implementing the interface.

### The DTOs stay out of `@pokedrop/shared`

`packages/shared` is the contract between `apps/web` and `apps/api`. The web app
never sees a provider payload; it sees `CardSchema`. Publishing the provider
seam there would expose an internal boundary to the frontend and invite exactly
the coupling this ticket exists to prevent.

The nested value objects are a different matter. `WeaknessSchema`,
`ResistanceSchema`, `AttackSchema`, `AbilitySchema`, `LegalitiesSchema` and
`PriceSourceSchema` already exist in shared and already describe these
structures. The DTOs import them rather than redeclare them — a second
definition of `Attack` is a second thing to keep in step, and nothing about a
provider's attack is different from ours once the mapper has run.

### `SetDTO`

An exact image of the `CardSet` model:

```ts
{ id, name, series, releaseDate: Date, printedTotal, total,
  symbolUrl: string | null, logoUrl: string | null }
```

Every field is required except the two image URLs, which are already nullable in
Prisma. `releaseDate` is a `Date` by the time it leaves a provider — parsing
`1999/01/09` versus `1999-01-09` is the mapper's problem and must not leak.

### `CardDTO`

An image of `Card`, **minus** `latestPriceUsd`, `latestPriceEur` and
`priceUpdatedAt`.

The omission is the point. Those three columns are written by the price path.
If they are not expressible in the type the catalog path carries, then a nightly
catalog sync **cannot** overwrite a fresher price with a staler one — not by
convention, but because there is no field to put it in. `docs/Architecture.md`
§7 defines the price write path separately for the same reason; this makes the
separation structural.

```ts
{ id, setId, name, supertype, subtypes: string[], hp: number | null,
  types: string[], rarity: string | null, retreatCost: string[],
  weaknesses: Weakness[], resistances: Resistance[], attacks: Attack[],
  abilities: Ability[], legalities: Legalities,
  nationalPokedexNumbers: number[], imageSmall: string, imageLarge: string,
  tcgplayerId: string | null, cardmarketId: string | null }
```

`rarity` is a nullable string, not an enum, for the reason already recorded in
`packages/shared/src/enums.ts`: the list is extensible and a closed enum turns
the next set release into a failed sync. Mapping onto `RarityTier` is a read-path
concern and belongs to PD-45 and PD-47, not here.

### `PriceDTO`

An image of `PriceSnapshot` without `id`:

```ts
{ cardId, source: PriceSource, currency: string, market: number | null,
  low: number | null, mid: number | null, high: number | null,
  capturedAt: Date }
```

One card yields up to two of these, one per source. `currency` is the three-letter
code the snapshot column expects, derived from the source rather than trusted
from the payload.

### The interface

```ts
export type CardSourceName = 'pokemontcg' | 'tcgdex';

export interface FetchCardsParams {
  setId?: string;
  page: number;
  pageSize: number;
}

export interface CardPage {
  items: CardDTO[];
  skipped: ProviderItemError[];
  page: number;
  pageSize: number;
  /** Matching cards across every page, not the length of `items`. */
  total: number;
  hasMore: boolean;
}

export interface CardSourceProvider {
  readonly name: CardSourceName;
  fetchSets(): Promise<SetDTO[]>;
  fetchCards(params: FetchCardsParams): Promise<CardPage>;
  fetchPrices(cardIds: string[]): Promise<PriceDTO[]>;
}
```

#### `fetchCards` returns a page — a deliberate departure

The ticket writes the signature as `fetchCards(params): Promise<CardDTO[]>`.
It is changed here, and the reason should survive the change.

PD-42 requires the catalog sync to be resumable: "a crash mid-run continues
rather than restarting from zero". PD-39 requires "pagination handling across
the full catalog". Both are impossible if the provider hides pagination behind a
flat array. A provider that loops internally holds an entire catalog in memory
before returning anything, and a crash in the middle leaves nothing to resume
from because no caller ever saw a page boundary.

Returning a page puts the loop in the processor, which is the only layer that
can persist where it got to.

`fetchSets` keeps its flat return. 176 sets is one small response from
pokemontcg.io, and paginating it would be ceremony with no resume point worth
saving.

#### `fetchPrices` exists now and is called in M4

The third acceptance criterion is that the interface be sufficient for both
catalog sync and price sync. It has to be declared here or the criterion cannot
be met.

Both providers embed prices in the card payload, so the honest implementation in
PD-39 and PD-40 is to fetch those cards and project the price blocks out. That
is not a workaround; it is what the upstream shape allows, and hiding it behind
a method named for the intent is exactly the adapter's job. M4 is the first
caller.

#### `FetchCardsParams` has no `updatedSince`

An incremental sync filter was considered and cut. No M3 or M4 ticket asks for
one: PD-42 asks for *resumable*, which the page cursor already gives, and PD-49
asks for a full nightly sweep. Adding a parameter that every provider would have
to either implement or silently ignore buys nothing today and would need a
second code path to stay honest.

### Validation: the envelope is fatal, an item is not

Each provider folder owns a raw Zod schema covering only the fields we consume.
Unknown keys are stripped, which is Zod's default and is what keeps a provider
adding a field from breaking a sync.

Two distinct failures get two distinct behaviours:

- **The envelope does not parse** — the response is not the shape the endpoint is
  documented to return at all. This throws `ProviderContractError`. Upstream
  changed its contract and continuing quietly would fill the mirror with
  nonsense.
- **One item does not parse** — the response was fine, one card inside it was
  not. The item is skipped, recorded as a `ProviderItemError` carrying the
  provider, the item id and the Zod issue, and returned in `CardPage.skipped`.

The split is what makes PD-42's third acceptance criterion — "a single failing
set does not abort the entire run" — reachable. Treating every parse failure as
fatal would let one malformed card discard the 249 good ones beside it.

The caller decides what a non-empty `skipped` means. PD-42 will log the items,
count them into `SyncRun.failed`, and finish the run as `PARTIAL`.

### Error taxonomy

```
ProviderError                    provider name, message, cause
├─ ProviderUnavailableError      5xx, timeout, DNS, connection reset
├─ ProviderRateLimitError        429, carries retryAfterMs
└─ ProviderContractError         the envelope did not parse
```

`ProviderItemError` is not in this tree and is not thrown. It is a value
describing one rejected item.

The distinction that matters is 429 against 5xx. A rate limit means *slow down*;
it does not mean the provider is broken. PD-43's circuit breaker must count
`ProviderUnavailableError` and `ProviderContractError` toward failover and must
not count `ProviderRateLimitError` — failing over on a 429 moves the load to the
fallback and rate-limits that one too, converting a delay into an outage.

Today's measurement is the canonical `ProviderUnavailableError`: a 500 on
`/cards` while `/sets` answers normally.

PD-38 defines the classes. PD-39 is the first to throw them, PD-43 the first to
count them.

### Registry and tokens

```ts
export const CARD_SOURCE_PROVIDER = Symbol('CARD_SOURCE_PROVIDER');
export const CARD_SOURCE_REGISTRY = Symbol('CARD_SOURCE_REGISTRY');
```

`CARD_SOURCE_PROVIDER` resolves to the provider named by configuration — what
every consumer in M3 and M4 injects. `CARD_SOURCE_REGISTRY` resolves to a
`ReadonlyMap<CardSourceName, CardSourceProvider>`, which is what PD-43 needs in
order to switch providers at runtime.

Both land now. The registry is three lines, and introducing it later would mean
changing every call site that had injected the single token.

`SyncModule` builds both. Until PD-39 registers an implementation the map is
empty, so the factory **refuses to boot** with a readable message rather than
resolving to `undefined`:

```
No card source provider is registered for "pokemontcg". Providers are
registered by PD-39 (pokemontcg) and PD-40 (tcgdex).
```

This follows the precedent set by `parseEnv`: a misconfiguration names itself at
boot instead of surfacing as a null dereference inside a job at 3am.

### Configuration

One new variable, following the shape every other provider setting already has
in `env.schema.ts`:

```ts
CARD_SOURCE_PROVIDER: z.enum(['pokemontcg', 'tcgdex']).default('pokemontcg'),
```

and in `buildAppConfig`, alongside the existing `providers` block:

```ts
providers: {
  active: env.CARD_SOURCE_PROVIDER,
  pokemonTcgApiKey: …,
  pokemonTcgBaseUrl: …,
  tcgdexBaseUrl: …,
}
```

The base URLs and the optional API key are already there from PD-15 and need no
change. Satisfying the first acceptance criterion — "swapping the configured
provider changes no code outside the providers folder" — is then a one-word edit
to `.env`.

### The boundary is enforced by ESLint

The ticket asks for a "documented rule: nothing outside `sync/providers/` may
import a provider-specific type". A documented rule is a rule until someone is
in a hurry.

The repository already has the pattern. PD-10 used `no-restricted-imports` to
stop `apps/web` and `apps/api` reaching into each other, and
`eslint.config.mjs` records why the relative form has to be listed alongside the
package form: the rule matches the specifier **as written**, not the resolved
path.

The same mechanism applies here. Files under `apps/api/**` that are not
themselves under `sync/providers/**` may not import from
`**/sync/providers/pokemon-tcg/**` or `**/sync/providers/tcgdex/**`. The folder's
`index.ts` stays reachable, and it exports only the interface, the DTOs, the
errors and the tokens.

A violation then fails `pnpm lint`, which CI runs on every push.

---

## Verification plan

No automated tests — `docs/PRD.md` §20. Every claim below is checked by running
it once, by hand, and the result is what gets written down.

The probe lives in `apps/api/dist/`, which is gitignored. It has to sit inside
`apps/api` because Node resolves bare imports relative to the file rather than
the working directory — a trap that already cost commands in PD-36 and PD-132.

Fixtures are the live payloads captured on 2026-09-18 and saved to the
scratchpad: `ptcg-sets.json`, `tcgdex-sets.json`, `tcgdex-set.json`,
`tcgdex-card.json`.

1. **The DTO schemas accept real data.** Feed the captured pokemontcg.io set
   payload through `SetDTOSchema` after a hand-written mapping, and the TCGdex
   set detail through the same schema. Both parse.
2. **`releaseDate` survives both formats.** `1999/01/09` and `1999-01-09` both
   land as the same `Date`.
3. **The envelope/item split holds.** Parse a two-item array where the second
   item has `hp: "sixty"`. The result carries one item and one
   `ProviderItemError` naming the id and the field. Then parse a response that
   is not an array at all: `ProviderContractError` is thrown.
4. **The error taxonomy is distinguishable.** Construct one of each and assert
   `instanceof ProviderError` holds for all three while the subclasses remain
   distinct — this is what PD-43 will branch on.
5. **The boot refusal fires.** Start the API with no provider registered and
   confirm it exits naming `pokemontcg` rather than starting and failing later.
6. **The ESLint boundary bites.** Add a temporary import of a path under
   `sync/providers/pokemon-tcg/` from `apps/api/src/app.service.ts`, confirm
   `pnpm lint` fails with the configured message, then remove it.
7. **Gates.** `pnpm typecheck` and `pnpm lint` from the repository root.

Claim discipline: if a measurement contradicts this spec, the contradiction gets
reported, not smoothed over.

---

## Files

**New**

| Path | Holds |
| --- | --- |
| `apps/api/src/sync/providers/provider.dto.ts` | `SetDTO`, `CardDTO`, `PriceDTO` and their Zod schemas |
| `apps/api/src/sync/providers/provider.errors.ts` | `ProviderError` and its three subclasses, `ProviderItemError` |
| `apps/api/src/sync/providers/card-source-provider.ts` | the interface, `CardSourceName`, `FetchCardsParams`, `CardPage`, both tokens |
| `apps/api/src/sync/providers/index.ts` | the folder's public surface |
| `apps/api/src/sync/sync.module.ts` | provides `CARD_SOURCE_PROVIDER` and `CARD_SOURCE_REGISTRY` |
| `apps/api/src/sync/index.ts` | the module's public surface |

**Edited**

| Path | Change |
| --- | --- |
| `apps/api/src/config/env.schema.ts` | `CARD_SOURCE_PROVIDER` |
| `apps/api/src/config/app.config.ts` | `providers.active` |
| `apps/api/src/app.module.ts` | import `SyncModule` |
| `eslint.config.mjs` | the provider-folder boundary rule |
| `.env.example`, `.env` | the new variable, documented |

No migration. No new dependency.

---

## Out of scope

| Not here | Where |
| --- | --- |
| HTTP client, retry, backoff, `Retry-After`, timeouts | PD-39 and PD-40, per provider |
| The pokemontcg.io and TCGdex implementations and their mappers | PD-39, PD-40 |
| Failover, circuit breaker, failure counters | PD-43 |
| BullMQ, the worker entrypoint, cron triggers | PD-41 |
| Any database write, the `SyncRun` model, cache invalidation | PD-42 |
| Calling `fetchPrices` | M4 |
| `RarityTier` mapping | PD-45, PD-47 |
| Fixture-based contract tests | PD-44, deferred — no automated tests during v1 |

---

## Forward notes

**`SyncRun` is decided but not built here.** PD-42 needs progress and last-run
metrics persisted and readable by the admin API, PD-43 needs to record which
provider served a run, PD-49 needs per-run duration and counts, and PD-81 and
PD-82 read all of it. Redis was rejected for this: `docker compose down -v`
erases it, and keys would have to live outside the `cache:` namespace or a
routine invalidation would sweep them. BullMQ job state was rejected too —
retention is bounded and "the last successful catalog run" is a scan there, not
a query. A `SyncRun` table with `kind`, `provider`, `status`, `startedAt`,
`finishedAt`, `processed`, `failed`, `cursor` and `error` serves all five
consumers. It arrives with PD-42, together with its migration and a
`docs/DataModel.md` entry. Redis keeps only what is genuinely ephemeral: PD-43's
breaker counters and PD-52's per-card cooldown.

**The 1 + N problem on TCGdex sets.** A TCGdex catalog sync needs one call per
set to obtain `series` and `releaseDate`, both `NOT NULL` on `CardSet`. PD-40
should state that cost plainly rather than discover it mid-implementation.

**`ioredis` stays at 5.8.2.** `docs/Foundation.md` flags the decision as due at
PD-41, alongside BullMQ. The answer is no change: BullMQ declares
`ioredis >=5.0.0` without having tested 6, and there is nothing in 6 this project
wants.
