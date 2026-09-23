# PD-51 Prices Read API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two public endpoints that give back what three tickets have been writing — a card's latest USD and EUR figures with the timestamp they were written at, and a windowed series for a sparkline.

**Architecture:** A new `prices` module, as `docs/Architecture.md` §4 lists it. The latest-price read caches through `cacheKeys.cardPrice(id)` — a key PD-48, PD-49 and PD-50 already delete and nothing has ever created — so this ticket closes that loop without adding an invalidation contract. History is not cached: it is one indexed query over at most a few dozen rows, and a fourth cache key would oblige three jobs to delete it.

**Tech Stack:** NestJS 12 (ESM, `module: nodenext` — every relative import ends in `.js`), Prisma 7.10.0, Zod 4 via `@pokedrop/shared`, Redis 7.4 behind `CacheService`, PostgreSQL 17.

**Spec:** [`docs/superpowers/specs/2026-09-23-pd-51-prices-read-api-design.md`](../specs/2026-09-23-pd-51-prices-read-api-design.md)

## Global Constraints

- **Work directly on `dev`.** No feature branches, no pull requests.
- **Commit subjects are `[PD-51]: short lowercase description`**, no trailing period, **72 characters maximum**. Bodies end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **No automated tests in v1** (`docs/PRD.md` §20). **This overrides the TDD structure the writing-plans skill normally imposes.** Every verification step is a measurement against the running stack. Do not add test files, test runners, test dependencies, or a `test` step to CI.
- **ESM.** Relative imports inside `apps/api` carry the `.js` extension or the build fails.
- **Both endpoints are `@Public()`.** Without the decorator the global `SessionGuard` answers 401 — the polarity PD-33 chose so a forgotten decorator is noisy rather than silent.
- **Pass the Zod schema to `getOrSet`.** JSON has no date type; without it a warm read returns `priceUpdatedAt` as a string where a cold read returns a `Date`, and the two responses stop being identical.
- **`Decimal` becomes `number` at the boundary.** Prisma returns `Decimal` for `latestPriceUsd`, `latestPriceEur` and `market`; `JSON.stringify` turns those into strings, which fail the response schema.
- **404 only for a card that does not exist.** A card that exists but was never priced returns 200 with nulls. Absence is never cached — the loader throws from inside `getOrSet`, which rejects and stores nothing.
- **`currency` is a constant of the source**, not a value read from a row: `TCGPLAYER` is `USD`, `CARDMARKET` is `EUR`.
- **Every commit compiles.** `pnpm typecheck`, `pnpm lint` and `pnpm format:check` pass from the repository root before each one.
- **Verified claims only.** If a measurement contradicts the spec, report the contradiction rather than adjusting the claim to fit.

## Review Focus

Five input classes the spec implies but does not pin down. Each has a measurement in the task that owns the code.

1. **`days` outside its range or not a number at all** — `?days=abc`, `?days=0`, `?days=999`. The query is user-controlled and reaches a date computation; a coercion that yields `NaN` would produce `capturedAt >= Invalid Date` and silently return nothing. Expected: 400 through the standard envelope. *Task 3.*
2. **Card ids that carry URL escapes** — this catalog really contains `exu-!` and `exu-%3F`, recorded in `apps/api/src/sync/README.md`. A route param decoded twice turns a real card into a 404. Expected: both ids resolve. *Task 2.*
3. **A snapshot whose `market` is null** — `PriceSnapshot.market` is nullable and PD-48 writes null when a marketplace returns none. The spec's point shape has no room for it. Expected: the row is excluded from the series, because a point with no value is not a point. *Task 3.*
4. **Redis unreachable** — `CacheService` treats a failure as a miss by design. Expected: the endpoint still answers from the database rather than 500. *Task 2.*
5. **A card priced in one currency only** — real today: 12 cards carry `latestPriceUsd` and none carry `latestPriceEur`. Expected: `eur` serialises as `null`, present in the body rather than omitted. *Task 2.*

### Shared shell setup

```bash
cd /m/projects/pokedrop
PSQL="docker compose exec -T postgres psql -U pokedrop -d pokedrop"
REDIS="docker compose exec -T redis redis-cli -n 0"
API="http://localhost:4000/api/v1"
```

`docker compose ps` must show postgres and redis healthy. The API is started with `pnpm --filter @pokedrop/api dev` and answers on port 4000.

### Live values these steps assert against

Measured 2026-09-23. Re-measure if a step disagrees rather than editing the expectation.

- `price_snapshots` is **empty**; `latestPriceUsd` is set on **12** cards and `latestPriceEur` on **none**
- there are **zero** `cache:price:*` keys in Redis, because nothing has ever created one
- the catalog holds **20 670** cards, among them the awkward ids `exu-!` and `exu-%3F`
- `config.cache.ttl.cardPrice` is **3 600** seconds
- `price_snapshots` carries `(cardId, capturedAt)` and the unique `(cardId, source, capturedOn)`

### Three traps that have already cost time on this project

**`getOrSet` cannot cache a bare `null`.** A stored `null` reads back as a miss and the loader re-runs on every request. The never-priced response is an *object with null fields*, which caches normally — do not "simplify" it into returning `null`.

**A cold read and a warm read must be byte-identical.** PD-46 measured what a missing Zod schema costs: `CardSchema` rejected every cached card and the cache silently never served one, presenting as mild slowness rather than as an error.

**`pnpm build` deletes `apps/api/dist/`.** Anything written there for a probe goes after the build, not before.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/shared/src/entities/price.ts` | **edit** — the two response contracts and the query contract |
| `apps/api/src/prices/prices.service.ts` | **new** — both reads, the cache, the `Decimal` boundary |
| `apps/api/src/prices/prices.controller.ts` | **new** — two `@Public()` routes |
| `apps/api/src/prices/prices.dto.ts` | **new** — the `days` query DTO |
| `apps/api/src/prices/prices.module.ts` | **new** — wiring |
| `apps/api/src/prices/index.ts` | **new** — the module's public surface |
| `apps/api/src/app.module.ts` | **edit** — import `PricesModule` |
| `docs/API.md`, `apps/api/src/sync/README.md` | **edit** — the responses and the closed cache loop |

### Task order

Task 1 → 2 → 3 → 4, strictly. Task 2 imports Task 1's schemas; Task 3 adds a route to Task 2's controller; Task 4 documents what 1–3 measured.

---

## Task 1: The response contracts

**Files:**
- Modify: `packages/shared/src/entities/price.ts`

**Interfaces:**
- Produces: `CardPriceSchema` / `CardPrice`, `PricePointSchema` / `PricePoint`, `PriceSeriesSchema`, `PriceHistorySchema` / `PriceHistory`, `PriceHistoryQuerySchema` / `PriceHistoryQuery`. Tasks 2 and 3 import all of them from `@pokedrop/shared`.

- [ ] **Step 1: Add the contracts**

Append to `packages/shared/src/entities/price.ts`, below the existing `PriceSnapshotSchema`:

```ts
/**
 * What `GET /cards/:id/price` answers.
 *
 * Every field is nullable because a card that exists but has never been
 * price-synced is a 200 with nulls, not a 404. `priceUpdatedAt` being null IS
 * the indicator that the card has never been priced - a separate boolean would
 * be a second way of saying the same thing, and two sources of truth for one
 * fact is how they drift.
 *
 * The timestamp is absolute and never a computed age. This response is cached
 * for an hour, and a relative "updated 300 seconds ago" served from cache forty
 * minutes later is wrong by forty minutes - least accurate exactly when the data
 * is most stale, which is the case the field exists to expose.
 */
export const CardPriceSchema = z.object({
  cardId: CardIdSchema,
  usd: z.number().nonnegative().nullable(),
  eur: z.number().nonnegative().nullable(),
  priceUpdatedAt: z.coerce.date().nullable(),
});
export type CardPrice = z.infer<typeof CardPriceSchema>;

/**
 * One point on a sparkline.
 *
 * `capturedOn` is a plain `YYYY-MM-DD` string rather than a timestamp: it is the
 * materialised UTC day PD-48 added, and the axis a daily sparkline plots. An ISO
 * datetime here would invite a timezone question that this very column exists to
 * have already answered.
 *
 * `market` is NOT nullable, and that is the decision that a snapshot carrying no
 * market value is left out of the series entirely. A point with no value is not
 * a point, and admitting `null` here would contradict the rule that a gap is an
 * absent point.
 */
export const PricePointSchema = z.object({
  capturedOn: z.iso.date(),
  market: z.number().nonnegative(),
});
export type PricePoint = z.infer<typeof PricePointSchema>;

/**
 * `currency` is a constant of the source rather than a value read from a row,
 * because an empty series has no row to read it from, and a field that appears
 * only when data happens to exist is one a client cannot rely on.
 */
export const PriceSeriesSchema = z.object({
  currency: z.string().length(3),
  points: z.array(PricePointSchema),
});
export type PriceSeries = z.infer<typeof PriceSeriesSchema>;

/**
 * What `GET /cards/:id/price/history` answers.
 *
 * Both series are always present. A card with data from only one marketplace
 * still returns the other with an empty `points` array: an absent key would say
 * "this marketplace does not exist", where the thing being said is "this
 * marketplace has no data for this card in this window".
 */
export const PriceHistorySchema = z.object({
  cardId: CardIdSchema,
  windowDays: z.number().int().min(1).max(365),
  series: z.object({
    TCGPLAYER: PriceSeriesSchema,
    CARDMARKET: PriceSeriesSchema,
  }),
});
export type PriceHistory = z.infer<typeof PriceHistorySchema>;

/**
 * The window, defaulted and bounded. A year is the ceiling because the daily cap
 * makes that at most 730 points for one card, which is still one small response,
 * and because nothing in the product asks to look further back. Unbounded would
 * let one request ask for the whole of the fastest-growing table in the system.
 */
export const PriceHistoryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type PriceHistoryQuery = z.infer<typeof PriceHistoryQuerySchema>;
```

`packages/shared/src/index.ts` already does `export * from './entities/price.js';`, so nothing needs adding there.

- [ ] **Step 2: Gates**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
```

- [ ] **Step 3: Measure that the contracts parse what they will be handed**

Build first. Then create `apps/api/dist/probe-contracts.js`:

```js
import {
  CardPriceSchema, PriceHistorySchema, PriceHistoryQuerySchema,
} from '@pokedrop/shared';

const show = (label, result) =>
  console.log(`${label}: ${result.success ? 'OK' : 'REJECTED - ' + result.error.issues[0].message}`);

show('priced card', CardPriceSchema.safeParse({
  cardId: 'base1-4', usd: 412.95, eur: 289.4, priceUpdatedAt: '2026-09-22T03:14:07.221Z',
}));
show('never priced', CardPriceSchema.safeParse({
  cardId: 'base1-4', usd: null, eur: null, priceUpdatedAt: null,
}));
show('usd only (real today)', CardPriceSchema.safeParse({
  cardId: 'base1-4', usd: 142, eur: null, priceUpdatedAt: new Date(),
}));
show('price as a string must fail', CardPriceSchema.safeParse({
  cardId: 'base1-4', usd: '142.00', eur: null, priceUpdatedAt: null,
}));

show('history with a gap', PriceHistorySchema.safeParse({
  cardId: 'base1-4', windowDays: 30,
  series: {
    TCGPLAYER: { currency: 'USD', points: [{ capturedOn: '2026-08-24', market: 1.2 }, { capturedOn: '2026-09-21', market: 1.5 }] },
    CARDMARKET: { currency: 'EUR', points: [] },
  },
}));
show('a null market point must fail', PriceHistorySchema.safeParse({
  cardId: 'base1-4', windowDays: 30,
  series: {
    TCGPLAYER: { currency: 'USD', points: [{ capturedOn: '2026-08-24', market: null }] },
    CARDMARKET: { currency: 'EUR', points: [] },
  },
}));
show('capturedOn as a timestamp must fail', PriceHistorySchema.safeParse({
  cardId: 'base1-4', windowDays: 30,
  series: {
    TCGPLAYER: { currency: 'USD', points: [{ capturedOn: '2026-08-24T00:00:00.000Z', market: 1.2 }] },
    CARDMARKET: { currency: 'EUR', points: [] },
  },
}));

for (const days of ['30', '1', '365', '0', '366', 'abc', '1.5']) {
  const r = PriceHistoryQuerySchema.safeParse({ days });
  console.log(`days=${JSON.stringify(days)} -> ${r.success ? r.data.days : 'REJECTED'}`);
}
console.log(`days absent -> ${PriceHistoryQuerySchema.parse({}).days}`);
```

```bash
node apps/api/dist/probe-contracts.js
```

**Expected:** the first three `OK`; `price as a string must fail` **REJECTED**; `history with a gap` `OK`; `a null market point must fail` **REJECTED**; `capturedOn as a timestamp must fail` **REJECTED**; then `30, 1, 365` accepted and `0, 366, abc, 1.5` all **REJECTED**; `days absent -> 30`.

Two of those are the point of this task rather than decoration: a string price passing would mean the `Decimal` boundary could be skipped unnoticed, and a null market passing would mean the no-interpolation rule lived only in prose.

- [ ] **Step 4: Clean up and commit**

```bash
rm -f apps/api/dist/probe-contracts.js
git add -A
git commit -F- <<'MSG'
[PD-51]: add the price read contracts to the shared package

Every field of the latest-price response is nullable, because a card that
exists but was never priced is a 200 with nulls rather than a 404, and
priceUpdatedAt being null is itself the indicator.

Two constraints in the history contract carry decisions rather than
types. `market` is non-nullable, so a snapshot with no market value is
left out of the series instead of putting a null in it. And capturedOn is
a plain date string, because it is a day rather than an instant and the
column exists to have settled that already.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Task 2: The latest-price endpoint

**Files:**
- Create: `apps/api/src/prices/prices.service.ts`, `prices.controller.ts`, `prices.module.ts`, `index.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `CardPriceSchema` / `CardPrice` from Task 1.
- Produces: `PricesService.getLatest(cardId: string): Promise<CardPrice>`, and a `PricesModule` registered in `AppModule`. Task 3 adds `getHistory` to the same service and a second route to the same controller.

- [ ] **Step 1: Write the service**

Create `apps/api/src/prices/prices.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { CardPriceSchema, type CardPrice } from '@pokedrop/shared';
import { PrismaService } from '../prisma/index.js';
import { CacheService, cacheKeys } from '../redis/index.js';

/**
 * Prisma returns `Decimal` for the price columns, and JSON.stringify turns a
 * Decimal into a string - which then fails the response schema. PD-46 measured
 * what missing this costs: the schema rejected every cached row and the cache
 * silently never served one, presenting as mild slowness rather than an error.
 *
 * Duplicated from catalog.service.ts rather than shared, the way
 * catalog.writer.ts and price.writer.ts sit beside each other: three lines are
 * worth less than the module boundary.
 */
function toNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

@Injectable()
export class PricesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /**
   * The first reader of `cache:price:card:{id}`.
   *
   * PD-48 delete it after every batch, and PD-49 and PD-50 reach the same delete
   * through PriceBatchService - so three invalidation sites have been deleting a
   * key nothing ever created. This closes that loop without adding a fourth
   * obligation anywhere.
   *
   * The schema is load-bearing rather than decoration: JSON has no date type, so
   * without it a warm read returns priceUpdatedAt as a string where a cold read
   * returns a Date, and the two responses stop being identical.
   */
  async getLatest(cardId: string): Promise<CardPrice> {
    return this.cache.getOrSet(
      cacheKeys.cardPrice(cardId),
      this.cache.ttl.cardPrice,
      async () => {
        const row = await this.prisma.card.findUnique({
          where: { id: cardId },
          select: { id: true, latestPriceUsd: true, latestPriceEur: true, priceUpdatedAt: true },
        });

        // Throwing from inside the loader is what keeps absence uncached:
        // getOrSet rejects and stores nothing. A 404 is one primary-key lookup,
        // and caching negatives invites filling the cache with invented ids.
        if (row === null) {
          throw new NotFoundException('Card not found');
        }

        // A card that exists but was never priced returns nulls, not a 404, and
        // this object caches normally - it is an object with null fields rather
        // than a null response, which getOrSet could not store.
        return CardPriceSchema.parse({
          cardId: row.id,
          usd: toNumber(row.latestPriceUsd),
          eur: toNumber(row.latestPriceEur),
          priceUpdatedAt: row.priceUpdatedAt,
        });
      },
      CardPriceSchema,
    );
  }
}
```

- [ ] **Step 2: Write the controller**

Create `apps/api/src/prices/prices.controller.ts`:

```ts
import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CardPrice } from '@pokedrop/shared';
import { Public } from '../common/decorators/public.decorator.js';
import { PricesService } from './prices.service.js';

/**
 * Public because the card detail page is, and because it is SEO-facing. Without
 * @Public() the global SessionGuard answers 401 - the polarity PD-33 chose so
 * that forgetting the decorator is noisy rather than silent.
 */
@ApiTags('prices')
@Public()
@Controller()
export class PricesController {
  constructor(private readonly prices: PricesService) {}

  @Get('cards/:id/price')
  getLatest(@Param('id') id: string): Promise<CardPrice> {
    return this.prices.getLatest(id);
  }
}
```

- [ ] **Step 3: Wire the module**

Create `apps/api/src/prices/prices.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PricesController } from './prices.controller.js';
import { PricesService } from './prices.service.js';

/**
 * An empty `imports` for the reason CatalogModule states: PrismaModule and
 * RedisModule are both @Global(), so PrismaService and CacheService inject
 * without one, and naming a non-global module here would put tokens into this
 * context that do not belong to it.
 */
@Module({
  controllers: [PricesController],
  providers: [PricesService],
})
export class PricesModule {}
```

Create `apps/api/src/prices/index.ts`:

```ts
export { PricesModule } from './prices.module.js';
export { PricesService } from './prices.service.js';
```

In `apps/api/src/app.module.ts`, add `PricesModule` to the `imports` array directly after `CatalogModule`, and import it with `import { PricesModule } from './prices/index.js';`.

- [ ] **Step 4: Gates**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
```

- [ ] **Step 5: Measure the three response shapes**

Start the API (`pnpm --filter @pokedrop/api dev`) and wait for it to answer. Pick a card that carries a price and one that does not:

```bash
PRICED=$($PSQL -tAc "SELECT id FROM cards WHERE \"latestPriceUsd\" IS NOT NULL ORDER BY id LIMIT 1" | tr -d '\r')
UNPRICED=$($PSQL -tAc "SELECT id FROM cards WHERE \"priceUpdatedAt\" IS NULL ORDER BY id LIMIT 1" | tr -d '\r')
echo "priced=$PRICED unpriced=$UNPRICED"

echo "--- priced ---";   curl -s -w ' [%{http_code}]\n' "$API/cards/$PRICED/price"
echo "--- unpriced ---"; curl -s -w ' [%{http_code}]\n' "$API/cards/$UNPRICED/price"
echo "--- missing ---";  curl -s -w ' [%{http_code}]\n' "$API/cards/no-such-card-xyz/price"
```

**Expected:** the priced card returns 200 with a numeric `usd`, **`"eur":null`** (Review Focus 5 — no card in this database has a EUR price, so the field must be present and null rather than omitted), and an ISO `priceUpdatedAt`. The unpriced card returns **200** with `usd`, `eur` and `priceUpdatedAt` all null. The missing id returns **404** in the standard envelope.

Confirm the 404 cached nothing:

```bash
$REDIS EXISTS "cache:price:card:no-such-card-xyz"
```

**Expected:** `0`.

- [ ] **Step 6: Measure the cache, cold against warm**

```bash
$REDIS DEL "cache:price:card:$PRICED"
COLD=$(curl -s "$API/cards/$PRICED/price")
echo "key after the first read: $($REDIS EXISTS "cache:price:card:$PRICED")"
WARM=$(curl -s "$API/cards/$PRICED/price")
[ "$COLD" = "$WARM" ] && echo "IDENTICAL" || { echo "DIFFER"; echo "cold: $COLD"; echo "warm: $WARM"; }
$REDIS TTL "cache:price:card:$PRICED"
```

**Expected:** the key exists after the first read (`1`), the two bodies are **IDENTICAL**, and the TTL is at or just under **3600**. A difference here means the Zod schema was not passed to `getOrSet` — the exact defect PD-46 recorded, where `priceUpdatedAt` comes back as a string on the warm read only.

- [ ] **Step 7: Measure the awkward card ids** *(Review Focus 2)*

This catalog contains ids with characters that a route decoded twice would mangle:

```bash
for ID in 'exu-!' 'exu-%3F'; do
  ENC=$(python -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$ID")
  echo "$ID -> /cards/$ENC/price : $(curl -s -o /dev/null -w '%{http_code}' "$API/cards/$ENC/price")"
done
$PSQL -tAc "SELECT id FROM cards WHERE id IN ('exu-!','exu-%3F') ORDER BY id"
```

**Expected:** both return **200**, and the psql query confirms both ids really are in the catalog. A 404 on `exu-%3F` means the parameter was decoded twice — the same double-encoding trap `apps/api/src/sync/README.md` records for the TCGdex client.

- [ ] **Step 8: Measure that Redis being down degrades rather than fails** *(Review Focus 4)*

```bash
docker compose stop redis
curl -s -w ' [%{http_code}]\n' "$API/cards/$PRICED/price"
docker compose start redis
```

**Expected:** **200** with the same body as before. `CacheService` treats a Redis failure as a miss by design, so the read falls through to the database. A 500 here means the cache was not given that latitude. Report the observed latency if it is notably slow — `enableOfflineQueue` is `false`, but a command already in flight when the socket drops was measured in PD-49 to hang for up to 60–90 s.

- [ ] **Step 9: Clean up and commit**

```bash
$REDIS DEL "cache:price:card:$PRICED"
git add -A
git commit -F- <<'MSG'
[PD-51]: read a card's latest price through the cache key three jobs delete

PD-48 created the key, PD-49 and PD-50 inherited its invalidation, and
nothing had ever written one - so three delete sites have been removing a
key that never existed. This is its first reader, and it needs no fourth
invalidation site because the writers already do their half.

A card that exists but was never priced answers 200 with nulls. Only a
card id that is not in the catalog is a 404, and that answer is never
cached: the loader throws from inside getOrSet, which rejects and stores
nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Task 3: The history endpoint

**Files:**
- Create: `apps/api/src/prices/prices.dto.ts`
- Modify: `apps/api/src/prices/prices.service.ts`, `apps/api/src/prices/prices.controller.ts`

**Interfaces:**
- Consumes: `PriceHistorySchema` / `PriceHistory`, `PricePoint`, `PriceHistoryQuerySchema` from Task 1; `PricesService` from Task 2.
- Produces: `PricesService.getHistory(cardId: string, days: number): Promise<PriceHistory>` and the route `GET /cards/:id/price/history`.

- [ ] **Step 1: Write the query DTO**

Create `apps/api/src/prices/prices.dto.ts`:

```ts
import { PriceHistoryQuerySchema } from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

/**
 * The wrapper is what ZodValidationPipe looks for and what puts the schema into
 * the OpenAPI document. The schema itself lives in @pokedrop/shared, because the
 * frontend imports it too.
 */
export class PriceHistoryQueryDto extends createZodDto(
  'PriceHistoryQuery',
  PriceHistoryQuerySchema,
) {}
```

- [ ] **Step 2: Add the read to the service**

In `apps/api/src/prices/prices.service.ts`, add the imports `PriceHistorySchema`, and the types `PriceHistory` and `PricePoint`, from `@pokedrop/shared`; add `PriceSource` from `@prisma/client`. Then add this method to `PricesService`:

```ts
  /**
   * Not cached, and that is a decision rather than an omission.
   *
   * A fourth cache key would oblige PriceBatchService - and through it all three
   * jobs that call it - to delete a third key per card, for a query that reads at
   * most a few dozen rows through a covering index. The daily cap also means a
   * card's series changes at most once per source per day, so the cache would
   * mostly serve bytes it would have computed anyway. The ticket asks for caching
   * on the latest price only.
   */
  async getHistory(cardId: string, days: number): Promise<PriceHistory> {
    // The existence check is its own query rather than a join, so that a card
    // with no snapshots is still told apart from a card that does not exist -
    // both would otherwise produce zero rows and the same empty answer.
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      select: { id: true },
    });

    if (card === null) {
      throw new NotFoundException('Card not found');
    }

    const since = new Date(Date.now() - days * MS_PER_DAY);

    // Ranged on capturedAt because (cardId, capturedAt) is the index that serves
    // it; reported as capturedOn, which is the UTC day a daily sparkline plots.
    //
    // `market: { not: null }` is the no-interpolation rule expressed in SQL: a
    // snapshot carrying no market value is not a point, so it never reaches the
    // series rather than arriving as a null the client has to skip.
    const rows = await this.prisma.priceSnapshot.findMany({
      where: { cardId, capturedAt: { gte: since }, market: { not: null } },
      select: { source: true, capturedOn: true, market: true },
      orderBy: { capturedAt: 'asc' },
    });

    // Both keys always, each with its currency fixed by its source. An empty
    // series has no row to read a currency from, and a field that appears only
    // when data happens to exist is one a client cannot rely on.
    const series = {
      [PriceSource.TCGPLAYER]: { currency: 'USD', points: [] as PricePoint[] },
      [PriceSource.CARDMARKET]: { currency: 'EUR', points: [] as PricePoint[] },
    };

    for (const row of rows) {
      series[row.source].points.push({
        capturedOn: row.capturedOn.toISOString().slice(0, 10),
        market: Number(row.market),
      });
    }

    return PriceHistorySchema.parse({ cardId, windowDays: days, series });
  }
```

Add this constant beside `toNumber` at the top of the file:

```ts
const MS_PER_DAY = 86_400_000;
```

- [ ] **Step 3: Add the route**

In `apps/api/src/prices/prices.controller.ts`, add `Query` to the `@nestjs/common` import, `PriceHistory` to the type import from `@pokedrop/shared`, and `PriceHistoryQueryDto` from `./prices.dto.js`. Then add:

```ts
  @Get('cards/:id/price/history')
  getHistory(
    @Param('id') id: string,
    @Query() query: PriceHistoryQueryDto,
  ): Promise<PriceHistory> {
    return this.prices.getHistory(id, query.days);
  }
```

- [ ] **Step 4: Gates**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
```

- [ ] **Step 5: Seed a series with deliberate gaps**

`price_snapshots` is empty, and a real price run would produce one day against a thirty-day window. Seed back-dated rows, including one with a **null market** so Review Focus 3 is exercised on real data:

```bash
CARD=$($PSQL -tAc "SELECT id FROM cards ORDER BY id LIMIT 1" | tr -d '\r')
echo "subject: $CARD"
$PSQL -v ON_ERROR_STOP=1 <<SQL
INSERT INTO price_snapshots (id, "cardId", source, currency, market, low, mid, high, "capturedAt", "capturedOn") VALUES
  ('probe-1', '$CARD', 'TCGPLAYER',  'USD', 1.10, NULL, NULL, NULL, now() - interval '30 days', (now() - interval '30 days')::date),
  ('probe-2', '$CARD', 'TCGPLAYER',  'USD', 1.50, NULL, NULL, NULL, now() - interval '20 days', (now() - interval '20 days')::date),
  ('probe-3', '$CARD', 'TCGPLAYER',  'USD', 2.00, NULL, NULL, NULL, now() - interval  '2 days', (now() - interval  '2 days')::date),
  ('probe-4', '$CARD', 'TCGPLAYER',  'USD', NULL, NULL, NULL, NULL, now() - interval  '1 days', (now() - interval  '1 days')::date),
  ('probe-5', '$CARD', 'CARDMARKET', 'EUR', 0.90, NULL, NULL, NULL, now() - interval '45 days', (now() - interval '45 days')::date);
SQL
$PSQL -tAc "SELECT count(*) FROM price_snapshots"
```

**Expected:** `5`. Note what each row is for: three real TCGplayer points spread across the window with gaps between them, one TCGplayer row with a **null market** one day ago, and one Cardmarket point **45 days ago** — outside a 30-day window but inside a 60-day one.

- [ ] **Step 6: Measure the window, the gaps and the null market**

```bash
echo "--- default 30 days ---"; curl -s "$API/cards/$CARD/price/history"
echo "--- 60 days ---";         curl -s "$API/cards/$CARD/price/history?days=60"
echo "--- 5 days ---";          curl -s "$API/cards/$CARD/price/history?days=5"
```

**Expected, and each number matters:**

- **30 days:** `TCGPLAYER.points` has exactly **three** entries — the −30, −20 and −2 rows — with no filler between them, which is the first acceptance criterion shown rather than asserted. The −1 row is **absent**, because its `market` is null *(Review Focus 3)*. `CARDMARKET.points` is **empty**, and the key is still present *(both series always present)*.
- **60 days:** `CARDMARKET.points` now has **one** entry, proving the window is honoured rather than ignored.
- **5 days:** `TCGPLAYER.points` has exactly **one** entry, the −2 row.

Confirm the point shape:

```bash
curl -s "$API/cards/$CARD/price/history" | python -c "import json,sys; d=json.load(sys.stdin); p=d['series']['TCGPLAYER']['points'][0]; print('capturedOn:', repr(p['capturedOn']), '| market:', repr(p['market']), type(p['market']).__name__)"
```

**Expected:** `capturedOn` is a plain `'YYYY-MM-DD'` string with no time part, and `market` is a **float**, not a string — the `Decimal` boundary holding.

- [ ] **Step 7: Measure a card with no snapshots, and one that does not exist**

```bash
OTHER=$($PSQL -tAc "SELECT id FROM cards WHERE id <> '$CARD' ORDER BY id LIMIT 1" | tr -d '\r')
echo "--- no snapshots ---"; curl -s -w ' [%{http_code}]\n' "$API/cards/$OTHER/price/history"
echo "--- missing card ---"; curl -s -o /dev/null -w '%{http_code}\n' "$API/cards/no-such-card-xyz/price/history"
```

**Expected:** the card with no snapshots returns **200** with both series present and both `points` arrays empty — not a 404 and not a missing `series` key. The missing card returns **404**.

- [ ] **Step 8: Measure the `days` bounds** *(Review Focus 1)*

```bash
for D in 1 365 0 366 abc 1.5 -5; do
  echo "days=$D -> $(curl -s -o /dev/null -w '%{http_code}' "$API/cards/$CARD/price/history?days=$D")"
done
```

**Expected:** `1` and `365` return **200**; `0`, `366`, `abc`, `1.5` and `-5` all return **400** through the standard error envelope. A 200 for `abc` would mean the coercion produced `NaN`, and `capturedAt >= Invalid Date` silently matches nothing — an empty series that looks like a card with no history.

- [ ] **Step 9: Clean up and commit**

```bash
$PSQL -c "DELETE FROM price_snapshots WHERE id LIKE 'probe-%';"
$PSQL -tAc "SELECT count(*) FROM price_snapshots"
git add -A
git commit -F- <<'MSG'
[PD-51]: serve a bounded price history as two named series

A gap is an absent point. The query filters out snapshots carrying no
market value, so the no-interpolation rule is expressed in SQL rather
than left to a client to skip nulls, and a series with two points thirty
days apart is two points.

Both series are always present, each with its currency fixed by its
source rather than read from a row - an empty series has no row to read
one from. Not cached: a fourth key would oblige three jobs to delete it,
for a query over a few dozen rows through a covering index.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

**Expected from the cleanup:** `price_snapshots` back to **0**.

---

## Task 4: Document the two endpoints and the closed loop

**Files:**
- Modify: `docs/API.md`, `apps/api/src/sync/README.md`

- [ ] **Step 1: Document the responses**

In `docs/API.md`, replace the two-line Prices table with the real contract: both routes, both public, the example bodies, and the three rules a reader would otherwise have to infer —

- **staleness is an absolute timestamp, never a computed age**, because the response is cached for an hour and a relative age served from cache is wrong by however long it sat there, least accurate exactly when the data is most stale;
- **404 means the card does not exist; a card that was never priced is a 200 with nulls**, and `priceUpdatedAt: null` is the indicator;
- **a gap in the history is an absent point**, never an interpolated or null one, and both series are always present with `currency` fixed by source.

State the `days` default of 30 and its ceiling of 365, and say what the ceiling is for.

- [ ] **Step 2: Record that the price cache key now has a reader**

In `apps/api/src/sync/README.md`, in the price write path section, the text records that the cache deletes are safe partly because "nothing in `apps/api/src` populates `cacheKeys.cardPrice` yet". That is now false. Correct it: PD-51 reads through that key, so the deletes the three jobs perform now invalidate something real, and the window between a commit and its cache delete is now observable rather than theoretical.

- [ ] **Step 3: Gate and commit**

```bash
pnpm format:check
git add -A
git commit -F- <<'MSG'
[PD-51]: document the price reads and retire a claim they falsify

The sync README said nothing populates the price cache key. PD-51 is its
first reader, so the deletes PD-48, PD-49 and PD-50 perform now remove
something real, and the gap between a commit and its cache delete stops
being theoretical.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Self-review notes

Checked against the spec, 2026-09-23.

**Spec coverage.** Contracts, the staleness rule and the null-cache trap map to Task 1; the latest endpoint, its cache, the 404-versus-nulls rule and the `Decimal` boundary to Task 2; the history shape, the gap rule, `capturedOn`, the `days` bound and the no-caching decision to Task 3; both documentation edits to Task 4. The spec's verification list has ten entries and all ten appear as steps.

**Review Focus coverage.** Each of the five has a measurement in the task that owns the code: `days` bounds in Task 3 Step 8 (and at the schema level in Task 1 Step 3), awkward ids in Task 2 Step 7, the null market in Task 3 Steps 5–6, Redis down in Task 2 Step 8, and the one-currency card in Task 2 Step 5.

**One decision the plan makes that the spec left open.** The spec never says what a snapshot with `market: null` does to the series. PD-48 writes such rows whenever a marketplace returns no figure, so they will exist. The plan excludes them, in the query and in the schema both, because a point with no value is not a point and admitting a null would contradict the gap rule the same spec sets. **If a reviewer disagrees, the argument is in `PricePointSchema`'s docblock and this is the place to overturn it.**

**Type consistency.** `CardPrice`, `PricePoint`, `PriceSeries`, `PriceHistory` and `PriceHistoryQuery` are spelled identically in Tasks 1, 2 and 3. `getLatest(cardId)` and `getHistory(cardId, days)` are the only two service methods and both appear with the same signatures in the task that defines them and the task that calls them.

**A known asymmetry.** `getLatest` finds the card and reads its prices in one query; `getHistory` spends a separate existence check before querying snapshots. That second query is what keeps "card has no history" distinguishable from "card does not exist", which the third acceptance criterion needs — both would otherwise return zero rows. One indexed primary-key lookup is the price of that distinction.
