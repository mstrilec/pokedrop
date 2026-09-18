# PD-39 — PokemonTcgClient, the primary provider

Design, 2026-09-18. Milestone M3 · Catalog Mirror & Sync.

Ticket: [PD-39](https://linear.app/mstrilec/issue/PD-39/pokemontcgclient-primary-provider-pokemontcgio-v2) ·
Reference: `docs/Architecture.md` §3 · `docs/PRD.md` §15 (sources).

Implements the interface [PD-38](https://linear.app/mstrilec/issue/PD-38/cardsourceprovider-adapter-interface-and-normalized-dtos)
defined, and discharges the obligation that ticket left behind: its description
of the pokemontcg.io card shape was taken from documentation, not from a
response. This one measured it.

---

## The upstream, measured rather than assumed

Every number here came from calling the live API on 2026-09-18, before any code
was written.

### It is flaky, not down

When M3 opened, `/v2/cards` answered 500 on every attempt and the milestone was
sequenced around that. It has since become intermittent. Twenty consecutive
requests to `/v2/cards?pageSize=2&page=1`:

```
500 500 502 200 500 500 500 500 502 500 200 200 500 200 500 500 200 500 500 200
6 / 20 = 30%
```

The successes are scattered rather than clustered, so the failures behave
independently and retrying works. `/v2/sets` and `/v2/cards/{id}` fail at a
similar rate; nothing suggests one route is worse than another.

**This is the single fact that shapes the client.** A provider that fails 70% of
requests is usable only if the client treats a 5xx as an ordinary event rather
than an error to report.

### The catalog is 20 670 cards in 176 sets

`totalCount` on `/v2/cards` is 20 670. `pageSize=250` works and returns a 486 KB
page, so a full sweep is **83 pages**. At the measured success rate that is
roughly 275 HTTP requests including retries — comfortably inside the daily
budget even anonymously.

This is what keeps pokemontcg.io primary despite the flakiness: TCGdex serves
full card data one card at a time, which is 20 670 requests for the same result.

### There are no rate-limit headers

A successful response carries `x-request-id` and nothing else — no
`X-RateLimit-Remaining`, no `X-RateLimit-Reset`. The client cannot know how much
budget it has left; it finds out by receiving a 429.

`POKEMONTCG_API_KEY` is currently unset, so the sync runs anonymously at the
lower documented ceiling. The key must be picked up the moment it is set, and it
must never reach a log.

**No 429 was observed.** Everything below about `Retry-After` is designed from
the provider's documentation, not measured. PD-43 or a production sweep is where
it gets confirmed, and the spec should not pretend otherwise.

---

## What the payload actually looks like

Verified against a captured 250-card page and the complete 176-set list.

### Three things PD-38 got wrong from the documentation

**`hp` is a string.** `"140"`, in all 250 cards on the page. `Card.hp` is `Int?`
in Prisma and `z.number().int().min(0).nullable()` in `CardDTO`, so the mapper
parses it and yields `null` when it cannot.

**There is no TCGplayer or Cardmarket id.** The union of keys across all 245
`tcgplayer` objects and all 246 `cardmarket` objects on the page is exactly
`url`, `updatedAt`, `prices`. No numeric identifier anywhere.

`Card.tcgplayerId` and `Card.cardmarketId` therefore stay `null` when this
provider syncs. TCGdex, which PD-40 will implement, does supply them
(`thirdParty: { cardmarket: 273699, tcgplayer: 42382 }`) — so the fallback is
richer than the primary in this one respect, which inverts the usual assumption
and is worth knowing before someone treats an empty column as a bug.

Nothing reads those columns. No document says what they are for; `DataModel.md`
and `PRD.md` list them and stop. Writing `null` costs nothing today, and if a
"buy this card" link is ever wanted, this provider already returns a ready-made
`tcgplayer.url` that would serve it better than an id. That decision belongs to
the ticket that needs the link.

**Prices are not in the shape `PriceDTO` expects.** `tcgplayer.prices` is keyed
by print variant — `normal`, `holofoil`, `reverseHolofoil`, `1stEditionHolofoil`,
`unlimitedHolofoil` — each with `low`, `mid`, `high`, `market`, `directLow`.
`cardmarket.prices` is flat but differently named: `averageSellPrice`,
`lowPrice`, `trendPrice`, `avg1`, `avg7`, `avg30`, plus reverse-holo variants.
Neither has a field called `market`, `mid` or `high` in the Cardmarket case.

### One set has no `printedTotal`

Found by reading all 176 sets rather than the first one:

```json
{ "id": "me55c", "name": "30th Celebration: Classic Collection",
  "series": "Mega Evolution", "total": 30, "releaseDate": "2026/09/16" }
```

The key is **absent**, not null. `SetDTOSchema.printedTotal` is a required
`z.number().int().min(0)`, so a naive mapping throws — on the newest set in the
catalog, two days after release, which is precisely the set users would be
looking for.

The mapper defaults it to `total`. `printedTotal` is the number printed on the
card ("1/102") and `total` includes secret rares, so they differ; but `total` is
never absent, and it is a far better approximation than `0`, which would make
set-completion tracking in PD-54 read as 0%.

Every other nullable field survives contact with reality: all 176 sets have
`series`, `releaseDate`, `total`, `name`, `images.symbol` and `images.logo`. The
nullability on `symbolUrl` and `logoUrl` is defensive and never exercised by
this provider.

### `releaseDate` is slash-separated

`1999/01/09`, not `1999-01-09`. `SetDTOSchema.releaseDate` is a strict
`z.date()` — deliberately, per PD-38 — so the mapper parses it explicitly rather
than leaving a string to be coerced somewhere else.

---

## Architecture

```
apps/api/src/sync/providers/pokemon-tcg/
  http.ts                   fetch with the two retry policies and a timeout
  pokemon-tcg.schema.ts     raw response schemas, only the fields consumed
  pokemon-tcg.mapper.ts     raw -> SetDTO / CardDTO / PriceDTO
  pokemon-tcg.client.ts     the CardSourceProvider implementation
```

Everything stays behind the fence PD-38 built: `eslint.config.mjs` refuses an
import of any of these files from outside `sync/providers/`, and the folder's
`index.ts` exports only the interface, DTOs, errors and tokens.

### Two retry policies, and why they differ

The heart of this ticket.

**5xx and network failures — retry quickly.** The server is unreliable, not
busy; there is nothing to wait for. Exponential backoff from 250 ms with jitter,
**five attempts in total** — the first try plus four retries, not six requests.
At the measured 30% that gives roughly 83% per page (`1 − 0.7⁵`), and a worst
case of about 3.75 s of backoff before the attempt budget is spent.

**429 — wait as instructed.** `Retry-After` is honoured when present, a bounded
backoff otherwise. A rate limit means the opposite of a 5xx: the server is
working and we are asking too fast.

The distinction is not cosmetic. It is the same one PD-38's taxonomy encodes:
`ProviderRateLimitError` must not count toward PD-43's failover, because
switching providers on a 429 moves the load onto the fallback and rate-limits
that one too. `ProviderUnavailableError` does count — but only after the five
attempts are spent, so the breaker measures "unusable even with retries" rather
than "one request failed". Without that, a 70% failure rate would trip any
sensible breaker within seconds.

**The remaining 17% is PD-42's problem, by design.** A page that fails all five
attempts fails the job; BullMQ retries it three times with the backoff PD-41
measured, and PD-42's cursor resumes from the page that failed rather than from
the start. Two layers, each covering what the other cannot: the client absorbs
individual bad dice, the processor absorbs a bad minute.

### The client

`fetch` from Node 22 — no HTTP dependency is added. `AbortSignal.timeout` bounds
each attempt so a hung upstream cannot hold a worker indefinitely.

`X-Api-Key` is sent when `config.providers.pokemonTcgApiKey` is set. It is read
from the typed config, never from `process.env`, and never logged — the header
allowlist in `logger.options.ts` already excludes it, and nothing here logs a
request object.

### Pagination

The envelope gives `page`, `pageSize`, `count` and `totalCount`, which is
exactly what `CardPage` needs. `hasMore` is `page * pageSize < totalCount`.

`fetchCards({ setId })` filters with `q=set.id:{setId}`, which is the provider's
query syntax. `fetchSets` stays a single unpaginated call: 176 sets fit in one
`pageSize=250` response.

### Mapping rules

| Target | Source | Note |
| --- | --- | --- |
| `hp` | `hp` | string → int, `null` when unparseable |
| `printedTotal` | `printedTotal ?? total` | the key can be absent on a new set |
| `releaseDate` | `releaseDate` | `YYYY/MM/DD` → `Date` |
| `imageSmall` / `imageLarge` | `images.small` / `images.large` | |
| `symbolUrl` / `logoUrl` | `images.symbol` / `images.logo` | `null` when absent |
| `tcgplayerId` / `cardmarketId` | — | always `null`; the provider has none |

`supertype`, `subtypes`, `types`, `rarity`, `retreatCost`, `legalities`,
`nationalPokedexNumbers`, `weaknesses`, `resistances`, `attacks` and `abilities`
map across unchanged — the shapes in `@pokedrop/shared` were modelled on this
provider in M1 and the page confirms they match.

### Price mapping, for M4's benefit

`fetchPrices` is implemented here because the ticket asks for it and PD-38's
interface requires it, even though M4 is the first caller. Both rules are
recorded in the folder's README so that M4 does not have to guess.

**TCGplayer (USD):** take the first variant present in the order `normal`,
`holofoil`, `reverseHolofoil`, `1stEditionHolofoil`, `unlimitedHolofoil`. Its
`low`, `mid`, `high` and `market` map straight across. The order puts the
ordinary print first, so a card that exists in both normal and holofoil reports
the price most holders actually have.

**Cardmarket (EUR):** `averageSellPrice` → `market`, `lowPrice` → `low`,
`trendPrice` → `mid`, and `high` → `null`, because Cardmarket does not publish
one. Mapping `trendPrice` onto `mid` is the loosest link in this table and is
flagged as such: it is a trend, not a median. M4 may prefer to widen `PriceDTO`
rather than keep the approximation.

### Validation

The raw schemas cover only the fields consumed, and unknown keys are stripped,
so a provider that adds a field never breaks a sync.

A response whose envelope does not parse raises `ProviderContractError`. A card
inside a good response that does not parse is skipped, recorded as a
`ProviderItemError` carrying its id, and returned in `CardPage.skipped` — the
split PD-38 built and measured.

### Registration, and `SyncModule` finally being wired

PD-38 deliberately left `SyncModule` out of `AppModule`, because an empty
registry would have made the boot refusal fire on every start. This ticket
registers `PokemonTcgClient` under `pokemontcg` and imports `SyncModule` into
`AppModule` in the same commit — the first moment the refusal can only fire for
a real reason.

---

## Verification plan

No automated tests. Every claim is measured once, by hand, against the live API —
with retries, since without them most attempts fail.

1. **`fetchSets` returns all 176 sets**, and `me55c` comes back with
   `printedTotal === total === 30` rather than throwing.
2. **`fetchCards` returns a full page of 250**, with `total` 20 670 and
   `hasMore` true, and `skipped` empty.
3. **Every card on that page maps cleanly.** 250 valid `CardDTO`s, `hp` an
   integer or null, `tcgplayerId` and `cardmarketId` null throughout.
4. **A set filter works:** `fetchCards({ setId: 'base1', page: 1, pageSize: 250 })`
   returns 102 cards, all with `setId === 'base1'`.
5. **Retry is what makes this pass.** Log the attempt count per request and
   record the distribution: the run should show several pages needing two or
   three attempts. A run where nothing retried is not evidence the retry works.
6. **A simulated 429 backs off rather than failing**, using a stub response
   since the live API has not produced one. Confirm `Retry-After` is read and
   that a `ProviderRateLimitError` escapes only after the budget is spent.
7. **A malformed item is skipped, not fatal:** corrupt one card in a captured
   page and confirm 249 survive with one entry in `skipped`.
8. **The API key never appears** in any log line or error message — checked with
   a deliberately wrong key set, which must produce a failure that does not
   quote it.
9. **The API boots with `SyncModule` wired**, and `CARD_SOURCE_PROVIDER` resolves
   to the client instead of throwing.
10. **Gates:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`.

The ticket's second acceptance criterion — "full set list and a full set's cards
fetch end-to-end against the live API" — is reachable now that retries exist. If
a measurement says otherwise, it gets reported as blocked upstream rather than
quietly marked done.

---

## Files

**New**

| Path | Holds |
| --- | --- |
| `apps/api/src/sync/providers/pokemon-tcg/http.ts` | fetch, timeout, the two retry policies |
| `apps/api/src/sync/providers/pokemon-tcg/pokemon-tcg.schema.ts` | raw Zod schemas |
| `apps/api/src/sync/providers/pokemon-tcg/pokemon-tcg.mapper.ts` | raw → DTOs |
| `apps/api/src/sync/providers/pokemon-tcg/pokemon-tcg.client.ts` | the provider |
| `apps/api/src/sync/README.md` | extended with the mapping and retry rules |

**Edited**

| Path | Change |
| --- | --- |
| `apps/api/src/sync/sync.module.ts` | register the client in the registry |
| `apps/api/src/app.module.ts` | import `SyncModule` |

No migration. No new dependency.

---

## Out of scope

| Not here | Where |
| --- | --- |
| The TCGdex client | PD-40 |
| Failover, the circuit breaker, failure counters | PD-43 |
| Writing anything to the database | PD-42 |
| Calling `fetchPrices` | M4 |
| An API key for the project | operational, not a ticket |

---

## Forward notes

**PD-43 needs a threshold that survives 30%.** The breaker counts
`ProviderUnavailableError`, which this client raises only after five failed
attempts. At the measured rate that is roughly one in six pages. A threshold of
three consecutive such failures would trip during an ordinary sweep; the counter
should be consecutive-per-batch and generous, or it will spend the milestone
flapping to TCGdex and back.

**PD-40 inherits an inverted expectation.** TCGdex supplies the TCGplayer and
Cardmarket ids this provider does not, and richer Cardmarket fields besides. The
fallback is not uniformly worse, and PD-40's "document field-level gaps versus
the primary" should say so in both directions.

**An API key is worth getting before the first production sweep.** It is free
from dev.pokemontcg.io and raises the ceiling substantially. The anonymous limit
has not been hit at this volume, but a nightly full sweep plus M4's price
refresh is a different load from a few hundred requests.
