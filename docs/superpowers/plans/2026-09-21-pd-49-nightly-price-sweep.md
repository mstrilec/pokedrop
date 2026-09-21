# PD-49 Nightly Price Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A nightly job that walks the whole card catalog in batches of 250, refreshes every card's price through the path PD-48 built, counts every request it spends against the provider's daily allowance, and records the run so `/admin/sync/status` can report it.

**Architecture:** A coordinator, not a fan-out. One BullMQ job on its own `price-sweep` queue walks our own `cards` table by keyset pagination and awaits each batch through a `PriceBatchService` lifted out of PD-48's processor, so both producers share one write path. The cursor does **not** reset between nights: a new run continues from the last closed run's position and wraps at the end, making "full sweep" true in aggregate rather than per night. Every outbound request increments a per-provider, per-UTC-day counter in Redis, and the sweep stops while there is still a configured reserve left for the catalog sync.

**Tech Stack:** NestJS 12 (ESM, `module: nodenext` — every relative import ends in `.js`), Prisma 7.10.0 with the `PrismaPg` driver adapter, BullMQ 5.81.5, ioredis 5.8.2, PostgreSQL 17, Redis 7.4.

**Spec:** [`docs/superpowers/specs/2026-09-21-pd-49-nightly-price-sweep-design.md`](../specs/2026-09-21-pd-49-nightly-price-sweep-design.md)

## Global Constraints

- **Work directly on `dev`.** No feature branches, no pull requests.
- **Commit subjects are `[PD-49]: short lowercase description`**, no trailing period, **72 characters maximum**. Bodies end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. **That trailer is this repository's attribution on every commit regardless of which model does the work.** commitlint rejects two ticket tags in one subject and warns on a body line that starts a word then a colon.
- **No automated tests in v1** (`docs/PRD.md` §20). **This overrides the TDD structure the writing-plans skill normally imposes.** Every verification step below is a measurement against the running stack. Do not add test files, test runners, test dependencies, or a `test` step to CI.
- **ESM.** Relative imports inside `apps/api` carry the `.js` extension or the build fails.
- **The two `http.ts` files stay separate.** `sync/README.md`: the TCGdex HTTP layer is "deliberately a parallel of the other rather than shared code: the mechanism matches, the policy does not." Add the same hook to each; do not merge them.
- **Nothing outside `sync/providers/` may import a provider-specific type.** `eslint.config.mjs` refuses it. Import from `providers/index.ts`.
- **A 429 never reaches the breaker.** Only `ProviderUnavailableError` and `ProviderContractError` do.
- **The budget counter is read through `RedisService`, never `CacheService`.** That service turns a Redis failure into a miss, which for a counter means forgetting the day's spend during the incident that caused it.
- **The budget fails open.** With Redis unreachable the sweep proceeds and warns.
- **Cache deletes happen after the transaction commits**, never inside it, and **per card** — never `cachePatterns.allPrices()`.
- **Batch size is 250.** Measured 2026-09-21: 100 cards cost 4.53 s and 250 cost 12.57 s, so the curve is roughly linear and requests, not seconds, are the scarce resource.
- **Every commit compiles.** `pnpm typecheck`, `pnpm lint` and `pnpm format:check` pass from the repository root before each one.
- **Verified claims only.** If a measurement contradicts the spec, report the contradiction rather than adjusting the claim to fit.

### Shared shell setup

```bash
cd /m/projects/pokedrop
PSQL="docker compose exec -T postgres psql -U pokedrop -d pokedrop"
REDIS="docker compose exec -T redis redis-cli -n 0"
```

`docker compose ps` must show postgres and redis healthy. `$PSQL -tAc "SELECT count(*) FROM cards"` must return **20670**.

### Live values these steps assert against

Measured 2026-09-21. Re-measure if a step disagrees rather than editing the expectation.

- the mirror holds **20 670** cards in **176** sets
- `price_snapshots` is **empty**; `latestPriceUsd` is set on **12** cards and `latestPriceEur` on **none**
- `sync_runs` holds **8 `CATALOG` rows and 0 `PRICE` rows**
- pokemontcg.io answers roughly **6 of 20** requests; the rest are 500 and 502
- a batch of 250 costs about **12.6 s** end to end, of which **0.36 s** is the database
- the anonymous ceiling is **1 000 requests a day and 30 a minute**, and it is invisible: no rate-limit header is returned on success or on failure

### Five traps that have already cost time on this project

**A probe that imports project code must live inside `apps/api`.** Node resolves bare imports relative to the file and pnpm keeps packages under `apps/api/node_modules`. `apps/api/dist/` is gitignored and is the right home.

**`pnpm build` deletes `dist/`, and your probe with it.** Write the probe *after* building, not before.

**A probe that boots `WorkerModule` will not exit on its own** once it has consumed a job — `app.close()` drains the job in flight, and for a sweep that is minutes. Every probe here ends with `process.exit(0)`.

**An unhandled rejection kills the probe mid-run and leaves rows behind.** Wrap each measured call in `try`/`catch`; a batch exhausting its retry budget is a ~17% event, not an exception.

**`defaultJobOptions` is applied by the producer.** Anything that enqueues must use the injected queue, or the job gets BullMQ's bare defaults — one attempt, no backoff, no retention.

### Restoring the price state between measurements

Several tasks write real prices. Capture a restore script **before the first one** and use it whenever a step needs the clean baseline back:

```bash
SCRATCH=$(mktemp -d)
$PSQL -tAc "SELECT format('UPDATE cards SET \"latestPriceUsd\"=%s, \"latestPriceEur\"=%s, \"priceUpdatedAt\"=%s WHERE id=%L;', coalesce(\"latestPriceUsd\"::text,'NULL'), coalesce(\"latestPriceEur\"::text,'NULL'), coalesce(quote_literal(\"priceUpdatedAt\"::text),'NULL'), id) FROM cards WHERE \"priceUpdatedAt\" IS NOT NULL ORDER BY id;" | tr -d '\r' > "$SCRATCH/rows.sql"
{ echo 'UPDATE cards SET "latestPriceUsd"=NULL, "latestPriceEur"=NULL, "priceUpdatedAt"=NULL WHERE "priceUpdatedAt" IS NOT NULL;'; cat "$SCRATCH/rows.sql"; echo 'DELETE FROM price_snapshots;'; } > "$SCRATCH/restore.sql"
echo "restore script at $SCRATCH/restore.sql"
```

Apply it with `$PSQL -q -v ON_ERROR_STOP=1 < "$SCRATCH/restore.sql"`.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/api/src/sync/providers/request-budget.service.ts` | **new** — count a provider's requests per UTC day, answer whether headroom remains |
| `apps/api/src/sync/price-batch.service.ts` | **new** — one batch end to end: fetch, group, write, invalidate, breaker |
| `apps/api/src/sync/price-sweep.processor.ts` | **new** — the catalog walk, the rolling cursor, the run record |
| `apps/api/src/sync/price-sweep.scheduler.ts` | **new** — the cron, whose entire body is an enqueue |
| `apps/api/src/redis/cache.keys.ts` | **edit** — `budgetKeys`, outside the cache namespace |
| `apps/api/src/sync/providers/pokemon-tcg/http.ts` | **edit** — an `onRequest` hook beside the existing `onRetry` |
| `apps/api/src/sync/providers/tcgdex/http.ts` | **edit** — the same hook, separately |
| `apps/api/src/sync/providers/pokemon-tcg/pokemon-tcg.client.ts`, `.../tcgdex/tcgdex.client.ts` | **edit** — inject the budget service and supply the hook |
| `apps/api/src/sync/providers/providers.module.ts`, `index.ts` | **edit** — register and export the budget service |
| `apps/api/src/sync/price-sync.processor.ts` | **edit** — delegate its body to `PriceBatchService` |
| `apps/api/src/sync/sync-run.service.ts` | **edit** — the price cursor and the last closed run's position |
| `apps/api/src/queue/queue.constants.ts`, `queue.module.ts` | **edit** — the `price-sweep` queue |
| `apps/api/src/sync/sync.module.ts`, `index.ts` | **edit** — register and export |
| `apps/api/src/config/env.schema.ts`, `app.config.ts`, `.env.example` | **edit** — the budget, the reserve, the stall ceiling |

### Task order

Task 1 → 2 → 3 → 4 → 5, strictly. Task 2's service is what Task 4's processor calls; Task 3's cursor is what Task 4's loop reads; Task 4 is what Task 5 documents.

---

## Task 1: Count every request against a daily budget

**Files:**
- Create: `apps/api/src/sync/providers/request-budget.service.ts`
- Modify: `apps/api/src/redis/cache.keys.ts`, `apps/api/src/config/env.schema.ts`, `apps/api/src/config/app.config.ts`, `.env.example`, `apps/api/src/sync/providers/pokemon-tcg/http.ts`, `apps/api/src/sync/providers/pokemon-tcg/pokemon-tcg.client.ts`, `apps/api/src/sync/providers/tcgdex/http.ts`, `apps/api/src/sync/providers/tcgdex/tcgdex.client.ts`, `apps/api/src/sync/providers/providers.module.ts`, `apps/api/src/sync/providers/index.ts`

**Interfaces:**
- Produces: `RequestBudgetService` with `record(provider: CardSourceName): Promise<void>`, `stateOf(provider: CardSourceName): Promise<BudgetState>`, and `hasHeadroom(provider: CardSourceName, reserve: number): Promise<boolean>`. `BudgetState` is `{ provider: CardSourceName; used: number; limit: number | null; remaining: number | null }`. Task 4's processor calls `hasHeadroom`.
- Produces: `config.providers.dailyRequestBudget`, a `Record<CardSourceName, number | null>`, and `config.priceSweep.reserve` / `config.priceSweep.maxStalls`, read by Task 4.

- [ ] **Step 1: Add the key builder**

In `apps/api/src/redis/cache.keys.ts`, beneath the existing `breakerKeys` block, add:

```ts
/**
 * Outside the `cache:` namespace for the same reason `breakerKeys` is: a
 * routine cache flush must not reset a day's request count. It would hand a
 * sweep a fresh allowance against a provider that has already been asked 900
 * times today, which is the one moment the number matters.
 *
 * Read through RedisService directly and never through CacheService - that one
 * turns a Redis failure into a miss, and a counter that forgets is worse than
 * no counter at all.
 */
export const BUDGET_NAMESPACE = 'budget';

export const budgetKeys = {
  /** `day` is an ISO date, `YYYY-MM-DD`, in UTC. */
  spent: (provider: string, day: string) => `${BUDGET_NAMESPACE}:${provider}:${day}`,
} as const;
```

- [ ] **Step 2: Add the configuration**

In `apps/api/src/config/env.schema.ts`, beside the other provider variables:

```ts
    POKEMONTCG_DAILY_REQUEST_BUDGET: z.coerce.number().int().min(1).default(1_000),

    PRICE_SWEEP_RESERVE: z.coerce.number().int().min(0).default(300),

    PRICE_SWEEP_MAX_STALLS: z.coerce.number().int().min(1).default(5),
```

In `apps/api/src/config/app.config.ts`, extend the `providers` block and add a `priceSweep` block after it:

```ts
    providers: {
      active: env.CARD_SOURCE_PROVIDER,

      pokemonTcgApiKey: env.POKEMONTCG_API_KEY ?? null,
      pokemonTcgBaseUrl: env.POKEMONTCG_BASE_URL,
      tcgdexBaseUrl: env.TCGDEX_BASE_URL,

      // Per provider, because the ceilings are not comparable. pokemontcg.io
      // documents 1 000 a day anonymously and sends no header to check it
      // against; TCGdex documents no limit at all and answered 64 of 64 under
      // concurrency, so null means uncapped rather than unknown.
      dailyRequestBudget: {
        pokemontcg: env.POKEMONTCG_DAILY_REQUEST_BUDGET,
        tcgdex: null,
      } as Record<CardSourceName, number | null>,
    },
    priceSweep: {
      // What the sweep leaves behind for everything else - principally the
      // catalog sync, which spends roughly 250 of the same allowance on its own
      // 83 pages.
      reserve: env.PRICE_SWEEP_RESERVE,

      // Consecutive 429 waits before the run gives up for the night.
      maxStalls: env.PRICE_SWEEP_MAX_STALLS,
    },
```

`CardSourceName` is already exported from `env.schema.ts`'s neighbour; import the type at the top of `app.config.ts`:

```ts
import type { CardSourceName } from './env.schema.js';
```

If `env.schema.ts` does not export that type, add it there beside `CARD_SOURCE_NAMES`:

```ts
export type CardSourceName = (typeof CARD_SOURCE_NAMES)[number];
```

In `.env.example`, under the provider section:

```bash
# The anonymous ceiling documented by pokemontcg.io is 1000 requests a day and
# 30 a minute. No response carries a rate-limit header, so this number is our
# own accounting and never the provider's - it is checked by counting what we
# send, including retries, which at this upstream's ~30% success rate are the
# dominant consumer.
POKEMONTCG_DAILY_REQUEST_BUDGET=1000

# What the nightly price sweep leaves unspent for everything else. The catalog
# sync costs roughly 250 requests a night on the same allowance.
PRICE_SWEEP_RESERVE=300

# Consecutive rate-limit waits before the sweep stops for the night.
PRICE_SWEEP_MAX_STALLS=5
```

- [ ] **Step 3: Write the budget service**

Create `apps/api/src/sync/providers/request-budget.service.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';
import { RedisService, budgetKeys } from '../../redis/index.js';
import type { CardSourceName } from './card-source-provider.js';

/**
 * Two days. A run that starts before midnight and finishes after it writes to
 * two keys, and both should still be readable while an operator works out what
 * happened. Anything longer accumulates keys nobody reads.
 */
const KEY_TTL_SECONDS = 172_800;

export interface BudgetState {
  provider: CardSourceName;
  used: number;
  limit: number | null;
  remaining: number | null;
}

/**
 * The UTC day, as the key spells it.
 *
 * UTC for the reason `price.writer.ts` gives about `capturedOn`: two processes
 * that disagree about where a day begins disagree about how much of it has been
 * spent, and they would disagree the first time a server moved timezone.
 */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

@Injectable()
export class RequestBudgetService {
  private readonly logger = new Logger(RequestBudgetService.name);

  private readonly limits: Record<CardSourceName, number | null>;

  constructor(
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.limits = config.providers.dailyRequestBudget;
  }

  /**
   * One request left for this provider. Called immediately before the fetch,
   * from inside the retry loop, so retries are counted - at a 30% success rate
   * they are most of what a sweep spends.
   *
   * Never throws. A request that has already been made cannot be un-made by a
   * counter failing to record it, and turning that into an error would fail the
   * batch over bookkeeping.
   */
  async record(provider: CardSourceName): Promise<void> {
    const key = budgetKeys.spent(provider, utcDay(new Date()));

    try {
      // Pipelined, for the reason ProviderBreakerService gives: a crash between
      // a bare incr and a separate expire leaves a key with no TTL, and the
      // day's count quietly becomes the epoch's count.
      await this.redis.client.multi().incr(key).expire(key, KEY_TTL_SECONDS).exec();
    } catch (error) {
      this.logger.warn(`Could not count a request for ${provider}: ${describe(error)}`);
    }
  }

  async stateOf(provider: CardSourceName): Promise<BudgetState> {
    const limit = this.limits[provider] ?? null;

    try {
      const raw = await this.redis.client.get(budgetKeys.spent(provider, utcDay(new Date())));
      const parsed = raw === null ? 0 : Number(raw);
      const used = Number.isFinite(parsed) ? parsed : 0;

      return {
        provider,
        used,
        limit,
        remaining: limit === null ? null : Math.max(0, limit - used),
      };
    } catch (error) {
      this.logger.warn(`Could not read the budget for ${provider}: ${describe(error)}`);
      return { provider, used: 0, limit, remaining: limit };
    }
  }

  /**
   * Whether more than `reserve` requests remain unspent today.
   *
   * Fails open. With Redis unreachable `stateOf` already reports nothing spent,
   * so this answers true and the sweep proceeds. Failing closed would stop all
   * synchronisation on a Redis blip, while the cost of overshooting a budget is
   * a 429 - which the sweep is obliged to handle anyway, because this counter is
   * our estimate and never the provider's.
   */
  async hasHeadroom(provider: CardSourceName, reserve: number): Promise<boolean> {
    const state = await this.stateOf(provider);
    return state.remaining === null || state.remaining > reserve;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
```

- [ ] **Step 4: Add the hook to the pokemontcg HTTP layer**

In `apps/api/src/sync/providers/pokemon-tcg/http.ts`, add one field to `PokemonTcgHttpOptions`, beneath `onRetry`:

```ts
  /**
   * Awaited immediately before every request, including each retry. This is
   * where the daily request budget is counted, and counting retries is the
   * whole point: against this upstream they are most of what a sweep spends.
   */
  onRequest?: () => Promise<void>;
```

Then, inside `getJson`'s `for` loop, as the **first statement of the loop body** — before `let response: Response;`:

```ts
    await options.onRequest?.();
```

- [ ] **Step 5: Add the same hook to the TCGdex HTTP layer, separately**

In `apps/api/src/sync/providers/tcgdex/http.ts`, add the identical field to `TcgdexHttpOptions` and the identical `await options.onRequest?.();` as the first statement of its retry loop body.

**Do not extract this into a shared module.** `sync/README.md` records that these two files are parallel rather than shared because the policy differs; the hook is the mechanism, and the mechanism matching is exactly why they look alike.

- [ ] **Step 6: Supply the hook from both clients**

In `apps/api/src/sync/providers/pokemon-tcg/pokemon-tcg.client.ts`, take the service and pass the callback:

```ts
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    budget: RequestBudgetService,
  ) {
    this.http = {
      baseUrl: config.providers.pokemonTcgBaseUrl,
      apiKey: config.providers.pokemonTcgApiKey,
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxAttempts: MAX_ATTEMPTS,
      onRequest: () => budget.record(this.name),
    };
  }
```

Import it with `import { RequestBudgetService } from '../request-budget.service.js';`.

Do the same in `apps/api/src/sync/providers/tcgdex/tcgdex.client.ts`, against its own options object and its own `this.name`.

The arrow function reads `this.name` lazily, at call time, so it does not depend on field-initialisation order.

- [ ] **Step 7: Register and export it**

In `apps/api/src/sync/providers/providers.module.ts`, add `RequestBudgetService` to both `providers` and `exports`. It must be listed **before** the clients are constructed only in the sense that Nest resolves it as a dependency — order in the array does not matter.

In `apps/api/src/sync/providers/index.ts`, beside the breaker's exports:

```ts
export { RequestBudgetService, utcDay } from './request-budget.service.js';
export type { BudgetState } from './request-budget.service.js';
```

- [ ] **Step 8: Gates**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
```

- [ ] **Step 9: Measure that retries are counted**

Build first, then write the probe — `pnpm build` deletes `dist/`.

Create `apps/api/dist/probe-budget.js`:

```js
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';
import { RequestBudgetService } from './sync/providers/request-budget.service.js';
import { ProviderSelectorService } from './sync/providers/provider-selector.service.js';
import { PrismaService } from './prisma/prisma.service.js';

const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['warn', 'error'] });
const budget = app.get(RequestBudgetService);
const prisma = app.get(PrismaService);
const provider = (await app.get(ProviderSelectorService).select()).provider;

const before = await budget.stateOf(provider.name);
const rows = await prisma.card.findMany({ orderBy: { id: 'asc' }, take: 250, select: { id: true } });

try {
  const points = await provider.fetchPrices(rows.map((r) => r.id));
  console.log(`fetched ${points.length} price points`);
} catch (error) {
  console.log(`batch failed, which still spends requests: ${error.message}`);
}

const after = await budget.stateOf(provider.name);
console.log(`used ${before.used} -> ${after.used} (+${after.used - before.used}), limit ${after.limit}, remaining ${after.remaining}`);
console.log(`headroom above a reserve of 300: ${await budget.hasHeadroom(provider.name, 300)}`);

await app.close();
process.exit(0);
```

Run it:

```bash
node apps/api/dist/probe-budget.js
```

**Expected:** the delta is **at least 1 and usually 2–5** for a single batch. One request per attempt, and at a ~30% success rate a successful call takes about three. A delta of exactly 1 across several runs means the hook is outside the retry loop — check that `await options.onRequest?.();` is the first statement *inside* `for (let attempt = ...)`, not before it.

Confirm the key directly:

```bash
$REDIS GET "budget:pokemontcg:$(date -u +%F)"
$REDIS TTL "budget:pokemontcg:$(date -u +%F)"
```

**Expected:** the same number, and a TTL near 172800. A TTL of −1 means the `expire` did not pipeline with the `incr`.

- [ ] **Step 10: Measure that it fails open**

Append to the probe, or run separately with Redis stopped — note that this probe does **not** use the queue, which is why it can run at all while Redis is down:

```bash
docker compose stop redis
node apps/api/dist/probe-budget.js 2>&1 | tail -5
docker compose start redis
```

**Expected:** `hasHeadroom` answers **true**, the log carries a warning naming the provider, and the process does not throw. If it throws, the `catch` in `stateOf` is not covering the call that failed.

- [ ] **Step 11: Clean up and commit**

```bash
rm -f apps/api/dist/probe-budget.js
git add -A
git commit -F- <<'MSG'
[PD-49]: count every provider request against a daily budget

The anonymous ceiling is 1000 a day and 30 a minute, and no response
carries a header to check it against, so the only way to know what has
been spent is to count what we send.

Counted immediately before each fetch from inside the retry loop, because
at a 30% success rate retries are most of what a sweep spends. The key
lives outside the cache namespace for the same reason the breaker's does,
and a Redis failure answers "there is budget" rather than stopping work.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Task 2: Lift one batch into a service both producers share

**Files:**
- Create: `apps/api/src/sync/price-batch.service.ts`
- Modify: `apps/api/src/sync/price-sync.processor.ts`, `apps/api/src/sync/sync.module.ts`, `apps/api/src/sync/index.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `PriceBatchService.refreshBatch(cardIds: string[], provider: CardSourceProvider): Promise<BatchResult>` where `BatchResult` is `{ asked: number; priced: number; cards: number; snapshots: number }`. Task 4's processor calls exactly this.

The service fetches, records the breaker either way, groups, writes and invalidates — and **rethrows**. The two callers differ in what they do with a failure: PD-48's processor lets it reach BullMQ, and Task 4's sweep counts it and continues. Breaker accounting is identical for both, so it belongs inside.

- [ ] **Step 1: Write the service**

Create `apps/api/src/sync/price-batch.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { PriceSource } from '@prisma/client';
import { PrismaService } from '../prisma/index.js';
import { CacheService, cacheKeys } from '../redis/index.js';
import {
  ProviderBreakerService,
  ProviderContractError,
  ProviderUnavailableError,
  type CardSourceProvider,
  type PriceDTO,
} from './providers/index.js';
import { PriceWriter, startOfUtcDay, type LatestPrice, type SnapshotRow } from './price.writer.js';

export interface BatchResult {
  asked: number;
  priced: number;
  cards: number;
  snapshots: number;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One batch, end to end. Lifted out of PriceSyncProcessor so that PD-49's sweep
 * and PD-48's processor reach the same write path rather than two copies of it:
 * PD-48 promised one write path and three producers, and this is what makes
 * that literally true now that one of the producers does not enqueue.
 */
@Injectable()
export class PriceBatchService {
  private readonly logger = new Logger(PriceBatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: PriceWriter,
    private readonly cache: CacheService,
    private readonly breaker: ProviderBreakerService,
  ) {}

  async refreshBatch(cardIds: string[], provider: CardSourceProvider): Promise<BatchResult> {
    if (cardIds.length === 0) {
      return { asked: 0, priced: 0, cards: 0, snapshots: 0 };
    }

    const points = await this.fetch(provider, cardIds);
    await this.breaker.recordSuccess(provider.name);

    // One instant for the whole batch, so every row shares a day by
    // construction and `capturedOn` cannot straddle midnight within one job.
    const capturedAt = new Date();
    const capturedOn = startOfUtcDay(capturedAt);

    // Only ids this batch asked for. Under failover the response's cardId is
    // TCGdex's vocabulary - `sv04-25` where this mirror holds `sv4-25` - and
    // writing one would raise P2025 out of the transaction and cost the whole
    // batch rather than the row that caused it. It is also what keeps prices
    // unable to fork the catalog: every id that reaches the writer came out of
    // our own database.
    const asked = new Set(cardIds);

    const byCard = new Map<string, PriceDTO[]>();
    for (const point of points) {
      if (!asked.has(point.cardId)) {
        continue;
      }

      const existing = byCard.get(point.cardId);
      if (existing) {
        existing.push(point);
      } else {
        byCard.set(point.cardId, [point]);
      }
    }

    const updates: LatestPrice[] = [];
    const snapshots: SnapshotRow[] = [];

    for (const [cardId, forCard] of byCard) {
      // A currency this response did not carry becomes null rather than keeping
      // its previous value. There is one priceUpdatedAt for both columns, so a
      // stale EUR beside a fresh USD would make that timestamp true of one and
      // false of the other with no way for a reader to tell which.
      const usd = forCard.find((p) => p.source === PriceSource.TCGPLAYER)?.market ?? null;
      const eur = forCard.find((p) => p.source === PriceSource.CARDMARKET)?.market ?? null;

      updates.push({ cardId, usd, eur, capturedAt });

      for (const point of forCard) {
        snapshots.push({
          cardId: point.cardId,
          source: point.source,
          currency: point.currency,
          market: point.market,
          low: point.low,
          mid: point.mid,
          high: point.high,
          capturedAt,
          capturedOn,
        });
      }
    }

    // A card absent from the response is absent from `updates`, so it is not
    // touched at all - not its columns, not its timestamp, not a snapshot. That
    // is the difference between "no new price" and "the price is now nothing",
    // and it is why this loop runs over the response rather than over cardIds.
    const written = await this.prisma.withTransaction(async (tx) => {
      const cards = await this.writer.updateLatest(tx, updates);
      const rows = await this.writer.insertSnapshots(tx, snapshots);
      return { cards, rows };
    });

    await this.invalidate(updates.map((update) => update.cardId));

    return {
      asked: cardIds.length,
      priced: byCard.size,
      cards: written.cards,
      snapshots: written.rows,
    };
  }

  /**
   * Both keys, because both carry the price and each path used to assume the
   * other owned it.
   *
   * `cache:price:card:{id}` is the obvious one. `cache:card:{id}` is the whole
   * card payload, and CatalogService builds it from the row including
   * latestPriceUsd, latestPriceEur and priceUpdatedAt - so leaving it behind
   * serves the pre-run price from `GET /cards/:id` for up to its 24-hour TTL
   * while `GET /cards/:id/price` serves the new one. Two numbers for one card.
   *
   * After the commit, never inside it: a Redis round trip inside an open
   * transaction holds row locks for the length of a network call.
   *
   * Per card, never cachePatterns.allPrices() - a batch of 250 must not flush
   * the other 20 420 cards' prices.
   */
  private async invalidate(cardIds: string[]): Promise<void> {
    if (cardIds.length === 0) {
      return;
    }

    await this.cache.del(
      ...cardIds.map((id) => cacheKeys.cardPrice(id)),
      ...cardIds.map((id) => cacheKeys.card(id)),
    );
  }

  /**
   * Only ProviderUnavailableError and ProviderContractError feed the breaker. A
   * ProviderRateLimitError says the upstream is healthy and we are asking too
   * fast; counting it would move load onto the fallback and rate-limit that one
   * too. The same rule sync/README.md, http.ts and the catalog processor state.
   */
  private async fetch(provider: CardSourceProvider, cardIds: string[]): Promise<PriceDTO[]> {
    try {
      return await provider.fetchPrices(cardIds);
    } catch (error) {
      if (error instanceof ProviderUnavailableError || error instanceof ProviderContractError) {
        const count = await this.breaker.recordFailure(provider.name);
        this.logger.warn(`price fetch failed (${count} consecutive) - ${describe(error)}`);
      } else {
        this.logger.warn(`price fetch failed locally - ${describe(error)}`);
      }

      throw error;
    }
  }
}
```

- [ ] **Step 2: Reduce the processor to a caller**

Replace the body of `apps/api/src/sync/price-sync.processor.ts` with:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE } from '../queue/index.js';
import { ProviderSelectorService } from './providers/index.js';
import { PriceBatchService } from './price-batch.service.js';

/**
 * The contract the producers speak. PD-50 enqueues the active set and PD-52 a
 * single card; PD-49's sweep does not enqueue at all - it coordinates batches
 * itself and calls PriceBatchService directly, because a fan-out has no good
 * answer for which of 83 jobs closes the run. All of them reach the same write
 * path.
 */
export interface PriceSyncJob {
  cardIds: string[];
}

@Processor(QUEUE.priceSync)
export class PriceSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(PriceSyncProcessor.name);

  constructor(
    private readonly selector: ProviderSelectorService,
    private readonly batch: PriceBatchService,
  ) {
    super();
  }

  async process(job: Job<PriceSyncJob>): Promise<void> {
    const { cardIds } = job.data;

    if (cardIds.length === 0) {
      return;
    }

    const choice = await this.selector.select();
    const result = await this.batch.refreshBatch(cardIds, choice.provider);

    this.logger.log(
      `job ${job.id}: ${result.asked} asked, ${result.priced} priced by ${choice.provider.name}, ` +
        `${result.cards} cards updated, ${result.snapshots} snapshots written`,
    );
  }
}
```

- [ ] **Step 3: Register and export**

In `apps/api/src/sync/sync.module.ts`, add `PriceBatchService` to `providers` and to `exports`. In `apps/api/src/sync/index.ts`:

```ts
export { PriceBatchService } from './price-batch.service.js';
export type { BatchResult } from './price-batch.service.js';
```

- [ ] **Step 4: Gates**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
```

- [ ] **Step 5: Measure that the processor still works and both keys drop**

Capture the restore script from the preamble first. Then create `apps/api/dist/probe-batch.js`:

```js
import { NestFactory } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { WorkerModule } from './worker.module.js';
import { PrismaService } from './prisma/prisma.service.js';
import { RedisService } from './redis/redis.service.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['warn', 'error'] });
const prisma = app.get(PrismaService);
const redis = app.get(RedisService);
const queue = app.get(getQueueToken('price-sync'));

const rows = await prisma.card.findMany({ orderBy: { id: 'asc' }, take: 10, select: { id: true } });
const ids = rows.map((r) => r.id);

// Sentinels, so "the key was deleted" is distinguishable from "there was never
// a key". A neighbour that must survive proves the delete is per card.
for (const id of ids) {
  await redis.client.set(`cache:price:card:${id}`, 'sentinel');
  await redis.client.set(`cache:card:${id}`, 'sentinel');
}
const neighbour = (await prisma.card.findMany({ orderBy: { id: 'asc' }, skip: 10, take: 1, select: { id: true } }))[0].id;
await redis.client.set(`cache:card:${neighbour}`, 'sentinel');

const job = await queue.add('price-sync', { cardIds: ids });
for (;;) {
  const state = await job.getState();
  if (state === 'completed' || state === 'failed') { console.log(`job ${state}`); break; }
  await sleep(200);
}

let priceLeft = 0, cardLeft = 0;
for (const id of ids) {
  if (await redis.client.exists(`cache:price:card:${id}`)) priceLeft += 1;
  if (await redis.client.exists(`cache:card:${id}`)) cardLeft += 1;
}
console.log(`sentinels surviving - price ${priceLeft}/10, card ${cardLeft}/10`);
console.log(`neighbour survived: ${(await redis.client.exists(`cache:card:${neighbour}`)) === 1}`);
console.log(`snapshots ${await prisma.priceSnapshot.count()}`);

await app.close();
process.exit(0);
```

Run it:

```bash
node apps/api/dist/probe-batch.js
```

**Expected:** `job completed`; **both** sentinel counts **0/10**; the neighbour **survived: true**; snapshots greater than zero. A `card` count of 10/10 means the second key was not added to the `cache.del` varargs. A neighbour that did not survive means a pattern invalidation crept in.

- [ ] **Step 6: Restore, clean up and commit**

```bash
$PSQL -q -v ON_ERROR_STOP=1 < "$SCRATCH/restore.sql"
rm -f apps/api/dist/probe-batch.js
git add -A
git commit -F- <<'MSG'
[PD-49]: lift one price batch into a service both producers share

PD-48 promised one write path and three producers. The sweep is the first
producer that does not enqueue, so the batch had to stop living inside a
processor for that promise to stay true.

Also closes a gap neither path owned. The card cache holds the price
columns and the price cache holds the price, and each invalidation
assumed the other covered them, so a refreshed card kept serving its old
price from GET /cards/:id for up to a day.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Task 3: Teach the run service a price cursor and a rolling position

**Files:**
- Modify: `apps/api/src/sync/sync-run.service.ts`

**Interfaces:**
- Produces: `PriceCursor` = `{ lastCardId: string }`; `SyncCursor` = `CatalogCursor | PriceCursor`; `SyncRunService.readPriceCursor(run: SyncRun): PriceCursor`; `SyncRunService.lastClosedCursor(kind: SyncKind): Promise<PriceCursor>`. `recordProgress`'s fourth parameter widens from `CatalogCursor` to `SyncCursor`.

This is the task most likely to be implemented wrong, because it holds **two different resumptions** that look alike:

| | Trigger | Method |
| --- | --- | --- |
| within a run | a BullMQ retry of the same job | `findResumable` + `readPriceCursor` |
| between runs | tonight's scheduled job | `lastClosedCursor` |

Collapsing them lets a retry adopt the *previous* run's position and silently skip everything the failed attempt had already priced.

- [ ] **Step 1: Add the types and widen the progress signature**

In `apps/api/src/sync/sync-run.service.ts`, beneath `CatalogCursor`:

```ts
/**
 * Keyset pagination over our own `cards` table, not a provider's list.
 *
 * `{ lastCardId }` rather than `{ offset }`: it rides the primary key, stays
 * correct when cards are inserted or removed between runs, and does not degrade
 * at the far end of a 20 670-row catalog the way OFFSET does. The catalog sync's
 * cursor is a page number because it paginates a provider's list and has no
 * stable key to hold; this one does.
 *
 * The empty string is the start. Every card id sorts above it, so `id > ''`
 * is the first page with no special case in the query.
 */
export type PriceCursor = {
  lastCardId: string;
};

export type SyncCursor = CatalogCursor | PriceCursor;
```

Change `recordProgress`'s parameter type from `cursor: CatalogCursor` to `cursor: SyncCursor`. Nothing else in that method changes.

- [ ] **Step 2: Add the two readers**

Beneath `readCursor`:

```ts
  /** The price cursor a resumed run left behind, defaulting to the start. */
  readPriceCursor(run: SyncRun): PriceCursor {
    const cursor = run.cursor as PriceCursor | null;
    return cursor && typeof cursor.lastCardId === 'string' ? cursor : { lastCardId: '' };
  }

  /**
   * Where the previous *finished* run stopped - the position tonight's run
   * continues from.
   *
   * This is not resumption. A run that is still RUNNING is either in flight or
   * was abandoned by a killed process, and adopting either one's position would
   * mean two runs sweeping the same cards while a third of the catalog goes
   * untouched. Resuming a run this job already owns is `findResumable`'s job and
   * keys on the job id; this keys on nothing but recency.
   *
   * Defaults to the start, which is what an empty sync_runs table means: the
   * first sweep this project has ever run begins at the first card.
   */
  async lastClosedCursor(kind: SyncKind): Promise<PriceCursor> {
    const previous = await this.prisma.syncRun.findFirst({
      where: { kind, status: { not: SyncStatus.RUNNING } },
      orderBy: { startedAt: 'desc' },
    });

    return previous === null ? { lastCardId: '' } : this.readPriceCursor(previous);
  }
```

- [ ] **Step 3: Gates**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
```

- [ ] **Step 4: Measure both readers against seeded rows**

Create `apps/api/dist/probe-cursor.js`:

```js
import { NestFactory } from '@nestjs/core';
import { SyncKind, SyncStatus } from '@prisma/client';
import { WorkerModule } from './worker.module.js';
import { PrismaService } from './prisma/prisma.service.js';
import { SyncRunService } from './sync/sync-run.service.js';

const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['warn', 'error'] });
const prisma = app.get(PrismaService);
const runs = app.get(SyncRunService);

console.log('empty table ->', JSON.stringify(await runs.lastClosedCursor(SyncKind.PRICE)));

const closed = await prisma.syncRun.create({
  data: { kind: SyncKind.PRICE, provider: 'pokemontcg', jobId: 'probe-closed',
          status: SyncStatus.PARTIAL, finishedAt: new Date(), cursor: { lastCardId: 'base1-42' } },
});
console.log('after a closed run ->', JSON.stringify(await runs.lastClosedCursor(SyncKind.PRICE)));

const running = await prisma.syncRun.create({
  data: { kind: SyncKind.PRICE, provider: 'pokemontcg', jobId: 'probe-running',
          status: SyncStatus.RUNNING, cursor: { lastCardId: 'zzz-999' } },
});
console.log('a RUNNING row must be ignored ->', JSON.stringify(await runs.lastClosedCursor(SyncKind.PRICE)));
console.log('but it resumes within its own run ->', JSON.stringify(runs.readPriceCursor(running)));
console.log('a row with no cursor ->', JSON.stringify(runs.readPriceCursor({ ...running, cursor: null })));

await prisma.syncRun.deleteMany({ where: { id: { in: [closed.id, running.id] } } });
await app.close();
process.exit(0);
```

Run it:

```bash
node apps/api/dist/probe-cursor.js
```

**Expected, line by line:**

```
empty table -> {"lastCardId":""}
after a closed run -> {"lastCardId":"base1-42"}
a RUNNING row must be ignored -> {"lastCardId":"base1-42"}
but it resumes within its own run -> {"lastCardId":"zzz-999"}
a row with no cursor -> {"lastCardId":""}
```

Line three is the one that matters. `zzz-999` appearing there means `lastClosedCursor` is not filtering out `RUNNING`, and a retry would jump the sweep to the end of the catalog.

Confirm the probe left nothing behind:

```bash
$PSQL -tAc "SELECT count(*) FROM sync_runs WHERE kind = 'PRICE'"
```

**Expected:** `0`.

- [ ] **Step 5: Clean up and commit**

```bash
rm -f apps/api/dist/probe-cursor.js
git add -A
git commit -F- <<'MSG'
[PD-49]: give the run service a keyset cursor and a rolling position

Two resumptions that look alike and are not. A BullMQ retry continues the
run it already owns and reads that row's cursor; tonight's scheduled run
continues where the last finished run stopped. Collapsing them would let
a retry adopt the previous run's position and skip what the failed
attempt had already priced.

The cursor is a card id rather than an offset because this walks our own
table, where a stable key exists.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Task 4: The sweep

**Files:**
- Create: `apps/api/src/sync/price-sweep.processor.ts`, `apps/api/src/sync/price-sweep.scheduler.ts`
- Modify: `apps/api/src/queue/queue.constants.ts`, `apps/api/src/queue/queue.module.ts`, `apps/api/src/sync/sync.module.ts`

**Interfaces:**
- Consumes: `PriceBatchService.refreshBatch` (Task 2), `SyncRunService.readPriceCursor` / `lastClosedCursor` (Task 3), `RequestBudgetService.hasHeadroom` (Task 1).
- Produces: a `SyncRun` row with `kind: PRICE`, which `AdminSyncService.lastRunPerKind` already queries and today never finds.

- [ ] **Step 1: Add the queue**

In `apps/api/src/queue/queue.constants.ts`:

```ts
export const QUEUE = {
  catalogSync: 'catalog-sync',
  priceSync: 'price-sync',
  priceSweep: 'price-sweep',
  tradeExpiry: 'trade-expiry',
} as const;
```

In `apps/api/src/queue/queue.module.ts`, add `{ name: QUEUE.priceSweep }` to `BullModule.registerQueue`.

Its own queue, not `price-sync`: the sweep is a single job of roughly 17 minutes, and on the shared queue it would sit in front of PD-52's one-card jobs, which exist to answer a user waiting on a page.

- [ ] **Step 2: Write the processor**

Create `apps/api/src/sync/price-sweep.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { SyncKind, SyncStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { PrismaService } from '../prisma/index.js';
import { QUEUE } from '../queue/index.js';
import {
  ProviderBreakerService,
  ProviderContractError,
  ProviderRateLimitError,
  ProviderSelectorService,
  ProviderUnavailableError,
  RequestBudgetService,
  type ProviderChoice,
} from './providers/index.js';
import { PriceBatchService } from './price-batch.service.js';
import { SyncRunService } from './sync-run.service.js';

/**
 * 250, measured 2026-09-21: a batch of 100 costs 4.53 s and a batch of 250
 * costs 12.57 s, so the cost is roughly linear in cards and the catalog is 83
 * requests at 250 against 207 at 100. Against a ceiling of 1 000 requests a day
 * that difference is the whole argument; two minutes of wall clock is not.
 */
const BATCH_SIZE = 250;

/**
 * The first 429 wait, doubling, capped. Sized against the documented ceiling of
 * 30 requests a minute rather than against http.ts's 250 ms base, which is sized
 * for a 5xx - a rate limit measured per minute cannot be cleared by waiting a
 * quarter of a second.
 */
const STALL_BASE_MS = 30_000;
const STALL_CAP_MS = 300_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What one batch tells the loop. `stalled` and `failed` are deliberately
 * separate: a rate limit is not a failure, and conflating them would both
 * inflate the run's failure count and let a slow night look like a broken one.
 */
interface BatchOutcome {
  processed: number;
  failed: number;
  stalled: boolean;
  down: boolean;
}

@Processor(QUEUE.priceSweep)
export class PriceSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(PriceSweepProcessor.name);

  private readonly reserve: number;
  private readonly maxStalls: number;

  constructor(
    private readonly selector: ProviderSelectorService,
    private readonly breaker: ProviderBreakerService,
    private readonly budget: RequestBudgetService,
    private readonly prisma: PrismaService,
    private readonly batch: PriceBatchService,
    private readonly runs: SyncRunService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    super();
    this.reserve = config.priceSweep.reserve;
    this.maxStalls = config.priceSweep.maxStalls;
  }

  async process(job: Job): Promise<void> {
    const resumable = await this.runs.findResumable(SyncKind.PRICE, job.id ?? '');

    let choice: ProviderChoice;

    if (resumable === null) {
      choice = await this.selector.select();
    } else {
      const resumed = await this.selector.resume(resumable.provider);

      if (resumed === null) {
        await this.runs.close(
          resumable.id,
          SyncStatus.PARTIAL,
          `resume abandoned: the breaker for ${resumable.provider} opened while this run was in flight`,
        );
        this.logger.warn(
          `run ${resumable.id}: abandoned on resume, ${resumable.provider} is now breaking`,
        );
        return;
      }

      choice = resumed;
    }

    const provider = choice.provider;
    const run = await this.runs.startOrResume(SyncKind.PRICE, provider.name, job.id ?? '');
    const log = (message: string): void =>
      this.logger.log(`run ${run.id} job ${job.id}: ${message}`);

    // The two resumptions, kept apart. A retry continues this run from its own
    // row; a fresh run continues from where the last finished run stopped, which
    // is what makes "full sweep" true in aggregate rather than per night.
    let lastCardId =
      resumable === null
        ? (await this.runs.lastClosedCursor(SyncKind.PRICE)).lastCardId
        : this.runs.readPriceCursor(run).lastCardId;

    const startedFrom = lastCardId;
    let wrapped = false;

    let processed = run.processed;
    let failed = run.failed;
    let stalls = 0;

    // Two different endings, and they must not be one variable. `completed`
    // says the pass covered the catalog; `stoppedBecause` says it was cut
    // short and why. A run that swept everything has nothing to report, and a
    // run that stopped at the budget must not be able to claim SUCCEEDED by
    // leaving a reason unset.
    let completed = false;
    let stoppedBecause: string | null = null;

    log(`starting after card id "${lastCardId}" via ${provider.name}`);

    for (;;) {
      if (!(await this.budget.hasHeadroom(provider.name, this.reserve))) {
        const state = await this.budget.stateOf(provider.name);
        stoppedBecause = `daily request budget exhausted: ${state.used} of ${state.limit ?? 'unlimited'} spent, reserve ${this.reserve}`;
        break;
      }

      const rows = await this.prisma.card.findMany({
        where: { id: { gt: lastCardId } },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: { id: true },
      });

      if (rows.length === 0) {
        // The end of the catalog. A run that began at the start has now covered
        // it; one that began mid-table wraps once to pick up what lay behind
        // its starting point. A second wrap would sweep for ever.
        if (wrapped || startedFrom === '') {
          completed = true;
          break;
        }

        wrapped = true;
        lastCardId = '';
        log('reached the end of the catalog, wrapping to the start');
        continue;
      }

      // Having wrapped, this batch may cross the position the run began at.
      // Everything at or below it belongs to this pass; everything above it was
      // already swept before the wrap. Ids sort lexicographically and the query
      // walks them in that order, so the comparison is the order the cursor
      // advances in.
      const ids = wrapped
        ? rows.map((row) => row.id).filter((id) => id <= startedFrom)
        : rows.map((row) => row.id);

      if (ids.length === 0) {
        completed = true;
        lastCardId = startedFrom;
        break;
      }

      const batchEnd = ids[ids.length - 1];
      const lastOfPass = wrapped && batchEnd >= startedFrom;

      let outcome: BatchOutcome;

      try {
        outcome = await this.runBatch(ids, choice, run.id);
      } catch (error) {
        // A contract error is the only thing runBatch lets out: the upstream
        // changed shape, and continuing would fill the mirror with nonsense.
        // PriceBatchService has already recorded the breaker failure, so this
        // only decides the run's fate.
        await this.runs.close(run.id, SyncStatus.FAILED, describe(error));
        throw error;
      }

      if (outcome.stalled) {
        stalls += 1;

        if (stalls >= this.maxStalls) {
          stoppedBecause = `rate limited ${stalls} times consecutively`;
          break;
        }

        // The cursor does not move. The same batch is asked for again on the
        // next turn of the loop, after the wait runBatch already took.
        continue;
      }

      stalls = 0;
      processed += outcome.processed;
      failed += outcome.failed;
      lastCardId = batchEnd;

      await this.runs.recordProgress(run.id, processed, failed, { lastCardId });
      await job.updateProgress({ processed, failed, lastCardId });

      if (outcome.down) {
        stoppedBecause = `${provider.name} breaker opened`;
        break;
      }

      if (lastOfPass) {
        completed = true;
        break;
      }
    }

    await this.runs.recordProgress(run.id, processed, failed, { lastCardId });

    const status =
      completed && failed === 0 && !choice.isFallback ? SyncStatus.SUCCEEDED : SyncStatus.PARTIAL;

    const notes = [
      choice.isFallback ? `fallback via ${provider.name} (${choice.reason})` : null,
      stoppedBecause,
    ].filter((note): note is string => note !== null);

    await this.runs.close(run.id, status, notes.length > 0 ? notes.join('; ') : undefined);
    log(`finished ${status}: ${processed} processed, ${failed} failed, stopped at "${lastCardId}"`);
  }

  /**
   * One batch, plus the 429 wait. Everything but a contract error is turned
   * into an outcome the loop can act on, so the loop reads as a sequence rather
   * than as error handling.
   *
   * A rate limit is not a failure: it says the provider is healthy and we are
   * asking too fast. It is not counted into `failed`, it does not touch the
   * breaker, and the caller does not advance the cursor - the same batch is
   * asked for again after the wait.
   */
  private async runBatch(
    ids: string[],
    choice: ProviderChoice,
    runId: string,
  ): Promise<BatchOutcome> {
    try {
      const result = await this.batch.refreshBatch(ids, choice.provider);
      return { processed: result.priced, failed: 0, stalled: false, down: false };
    } catch (error) {
      if (error instanceof ProviderRateLimitError) {
        const wait = Math.min(error.retryAfterMs ?? STALL_BASE_MS, STALL_CAP_MS);
        this.logger.warn(`run ${runId}: rate limited, waiting ${wait}ms - ${describe(error)}`);
        await sleep(wait);
        return { processed: 0, failed: 0, stalled: true, down: false };
      }

      // The upstream changed shape. The caller closes the run rather than
      // carrying on against a source that is no longer serving what we parse.
      if (error instanceof ProviderContractError) {
        throw error;
      }

      // refreshBatch has already recorded the breaker failure for the errors
      // that deserve one. What is left here is whether this run continues.
      let down = false;

      if (error instanceof ProviderUnavailableError) {
        // The breaker opening mid-run is what stops a sweep while a provider is
        // down. Without it a fully unavailable source would be asked for every
        // batch in the catalog, one retry budget at a time.
        down = await this.breaker.isOpen(choice.provider.name);
        this.logger.warn(
          `run ${runId}: a batch of ${ids.length} failed - ${describe(error)}${down ? ', breaker now open' : ''}`,
        );
      } else {
        this.logger.warn(
          `run ${runId}: a batch of ${ids.length} failed locally, not counted toward the breaker - ${describe(error)}`,
        );
      }

      return { processed: 0, failed: ids.length, stalled: false, down };
    }
  }
}
```

- [ ] **Step 3: Write the scheduler**

Create `apps/api/src/sync/price-sweep.scheduler.ts`:

```ts
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { QUEUE } from '../queue/index.js';

/**
 * 4am, an hour after the catalog sync.
 *
 * They must not overlap. The two share a daily allowance of 1 000 requests and
 * a ceiling of 30 a minute, and the catalog sync takes 11 to 15 minutes from
 * 3am, so an hour is room enough for it to finish badly.
 *
 * Registered in the worker and not the API: two processes running this cron
 * would enqueue two sweeps a night and spend the budget twice.
 */
@Injectable()
export class PriceSweepScheduler {
  private readonly logger = new Logger(PriceSweepScheduler.name);

  constructor(@InjectQueue(QUEUE.priceSweep) private readonly queue: Queue) {}

  /**
   * The entire body is an enqueue, per the rule in queue/README.md. Doing the
   * work here would run it outside the queue and lose every retry, backoff and
   * failure record the queue provides.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'price-sweep' })
  async enqueue(): Promise<void> {
    const job = await this.queue.add('price-sweep', {});
    this.logger.log(`Enqueued price sweep as job ${job.id}`);
  }
}
```

- [ ] **Step 4: Register both**

In `apps/api/src/sync/sync.module.ts`, add `PriceSweepProcessor` and `PriceSweepScheduler` to `providers`. `QueueModule` is already imported, which the scheduler's `@InjectQueue` needs — the processor does not, because BullMQ's explorer discovers `@Processor` classes globally.

- [ ] **Step 5: Gates**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
```

- [ ] **Step 6: Measure a bounded sweep**

A full sweep is ~17 minutes and spends most of the day's budget. Measure a bounded one by seeding the cursor near the end of the catalog, which exercises the wrap as well.

Create `apps/api/dist/probe-sweep.js`:

```js
import { NestFactory } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { SyncKind, SyncStatus } from '@prisma/client';
import { WorkerModule } from './worker.module.js';
import { PrismaService } from './prisma/prisma.service.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['log', 'warn', 'error'] });
const prisma = app.get(PrismaService);
const queue = app.get(getQueueToken('price-sweep'));

// Start 400 cards from the end, so the run crosses the end of the catalog,
// wraps, and stops on reaching its own starting point.
const total = await prisma.card.count();
const near = await prisma.card.findMany({ orderBy: { id: 'asc' }, skip: total - 400, take: 1, select: { id: true } });
await prisma.syncRun.create({
  data: { kind: SyncKind.PRICE, provider: 'pokemontcg', jobId: 'probe-seed',
          status: SyncStatus.PARTIAL, finishedAt: new Date(), cursor: { lastCardId: near[0].id } },
});
console.log(`seeded the rolling cursor at ${near[0].id}`);

const started = Date.now();
const job = await queue.add('price-sweep', {});
for (;;) {
  const state = await job.getState();
  if (state === 'completed' || state === 'failed') { console.log(`job ${state} in ${((Date.now() - started) / 1000).toFixed(1)}s`); break; }
  await sleep(1000);
}

const runs = await prisma.syncRun.findMany({ where: { kind: SyncKind.PRICE }, orderBy: { startedAt: 'desc' }, take: 2 });
for (const r of runs) {
  console.log(`${r.status} provider=${r.provider} processed=${r.processed} failed=${r.failed} cursor=${JSON.stringify(r.cursor)} error=${r.error ?? '-'}`);
}

await app.close();
process.exit(0);
```

Run it:

```bash
node apps/api/dist/probe-sweep.js 2>&1 | tail -30
```

**Expected:**
- a log line `reached the end of the catalog, wrapping to the start`
- the job completes
- the newest run is `PARTIAL` (against this upstream a failed batch is a ~17% event) or `SUCCEEDED`, with `processed` in the low hundreds and a cursor that is **not** the seeded id

If the run never wraps, the `rows.length === 0` branch is not reached — check that `take: BATCH_SIZE` with `id > lastCardId` returns empty at the end rather than throwing.

- [ ] **Step 7: Measure that the budget stops it**

```bash
$REDIS SET "budget:pokemontcg:$(date -u +%F)" 900
node apps/api/dist/probe-sweep.js 2>&1 | tail -10
```

**Expected:** the run closes `PARTIAL` almost immediately with an error reading `daily request budget exhausted: 900 of 1000 spent, reserve 300`, and its cursor equals the seeded id — nothing was swept.

Reset the counter afterwards:

```bash
$REDIS DEL "budget:pokemontcg:$(date -u +%F)"
```

- [ ] **Step 8: Measure that a 429 slows rather than fails**

This is the first time this project can provoke a real 429: the anonymous ceiling is 30 requests a minute.

```bash
for i in $(seq 1 60); do curl -s -o /dev/null -w "%{http_code}\n" --get "https://api.pokemontcg.io/v2/cards" --data-urlencode "q=id:base1-4" --data-urlencode "pageSize=1" & done; wait
```

**Expected:** at least one `429` among the codes. If none appears after two attempts, record that the per-minute ceiling could not be provoked and that the stall path therefore remains verified only by reading it — **do not** claim a measurement that did not happen. `sync/README.md` already records the `Retry-After` path as unconfirmed in the field, and leaving it unconfirmed is an honest outcome.

If a 429 is reachable, run the sweep probe while the burst is in flight and confirm in the run row that `failed` did **not** increase and the cursor did **not** move across the stall.

- [ ] **Step 9: Confirm the admin endpoint reports it**

```bash
$PSQL -c "SELECT kind, provider, status, processed, failed, cursor FROM sync_runs WHERE kind = 'PRICE' ORDER BY \"startedAt\" DESC LIMIT 3;"
```

**Expected:** price rows where there were none. `AdminSyncService` needs no change — it already queries `SyncKind.PRICE`.

- [ ] **Step 10: Measure that the daily cap still holds**

```bash
$PSQL -tAc "SELECT count(*) FROM price_snapshots"
node apps/api/dist/probe-sweep.js > /dev/null 2>&1
$PSQL -tAc "SELECT count(*) FROM price_snapshots"
$PSQL -tAc "SELECT max(cnt) FROM (SELECT count(*) AS cnt FROM price_snapshots GROUP BY \"cardId\", source, \"capturedOn\") t"
```

**Expected:** the two counts differ only by cards the first run had not reached, and the maximum per `(cardId, source, capturedOn)` is **1**.

- [ ] **Step 11: Restore, clean up and commit**

```bash
$PSQL -q -v ON_ERROR_STOP=1 < "$SCRATCH/restore.sql"
$PSQL -c "DELETE FROM sync_runs WHERE kind = 'PRICE';"
rm -f apps/api/dist/probe-sweep.js
git add -A
git commit -F- <<'MSG'
[PD-49]: sweep the catalog nightly on a rolling cursor

One coordinator job walking our own table, not a fan-out of 83. A
fan-out buys BullMQ retries and costs a run-tracking problem with no
good answer for which job closes the row.

The cursor does not reset between nights. Read literally, a nightly full
sweep starting at the first card means a truncated night starves the same
tail for ever; continuing from the last finished run and wrapping makes
the sweep complete in aggregate instead.

A 429 waits and retries the same batch without moving the cursor, and the
run stops while a reserve of the day's requests is still unspent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Task 5: Correct what is now untrue, and document what is now true

**Files:**
- Modify: `apps/api/src/sync/README.md`, `apps/api/src/queue/README.md`, `.env.example`, `docs/PRD.md`, `docs/Architecture.md`, `docs/superpowers/specs/2026-09-21-pd-48-price-sync-write-path-design.md`

Three claims in this repository are now false. Leaving any of them is worse than never having written it, because each reads as a measurement.

- [ ] **Step 1: Retire the API-key advice**

In `apps/api/src/sync/README.md`, the paragraph ending "The free API key raises it further and should be set before the first production sweep; v1 uses no paid services, and this key is free." Replace the advice with the fact:

```markdown
The catalog is 20 670 cards, so a full sweep is 83 pages — roughly 275 requests
once retries are counted.

**The anonymous ceiling is 1 000 requests a day and 30 a minute**, documented
rather than observed: no response carries a rate-limit header, verified again
2026-09-21 on both a 200 and a 500. A key would raise the daily figure to 20 000
and **there is no longer a key to get** — pokemontcg.io closed registration when
it deprecated the API. Existing keys work through 2027-03-01.

So a sweep and a price sweep together spend roughly half the day's allowance,
and PD-49 counts what it spends rather than trusting the arithmetic.
```

In `.env.example`, the `POKEMONTCG_API_KEY` comment block: replace "Optional permanently… visit https://dev.pokemontcg.io to raise the ceiling" with a note that registration is closed, the anonymous ceiling is 1 000 a day and 30 a minute, and the variable remains only for an existing key.

- [ ] **Step 2: Correct the batch-size claim in PD-48's spec and in the README**

Both say a batch of 250 costs "five times the wall clock for two and a half times the work". Add the re-measurement rather than deleting the original — the project's record of what it believed and when is worth keeping:

```markdown
**Re-measured 2026-09-21, and the curve is not what this says.** Through the
same code path: 100 cards cost 4.53 s (fetch 4.37, write 0.16) and 250 cost
12.57 s (fetch 12.21, write 0.36) — 2.77× the time for 2.5× the work, which is
roughly linear. A single 19.9 s observation for 250 did appear, and a 21.4 s
*success* appears in a 20-request sample of single cards, so the original 19.2 s
looks like this distribution's tail rather than its shape.

The batch of 100 stands for PD-52 and PD-50, where a failed batch should be
small. **PD-49's sweep uses 250**, because against a ceiling of 1 000 requests a
day the 83-request pass beats the 207-request one and the two minutes of wall
clock between them buy nothing.
```

- [ ] **Step 3: Document the sweep**

In `apps/api/src/sync/README.md`, after "The price write path", add a section covering: the coordinator shape and why not a fan-out; the rolling cursor and the wrap; the two resumptions kept apart; the budget counter, its key namespace and its fail-open polarity; the 429 stall; and a measured table from Task 4's probes. Follow the voice of the surrounding sections — what was measured, when, and what it cost.

In `apps/api/src/queue/README.md`, update the queue table:

```markdown
| `price-sync` | PD-50, PD-52 | PD-48 |
| `price-sweep` | PD-49's nightly cron | PD-49 |
```

and correct the line that says `price-sync` is filled by "PD-49's nightly sweep" — it is not; the sweep coordinates its own batches.

- [ ] **Step 4: Record the real limits where they are looked for**

In `docs/PRD.md` §2, the API-strategy table row for the primary source: replace "free; the key is free too and only raises the daily ceiling (~20k with it, lower anonymously)" with the measured figures and the deprecation date.

In `docs/Architecture.md` §3, the same row, plus a sentence in §7 noting that the nightly sweep counts its requests against that allowance and stops while a reserve remains.

**Do not** propose a provider migration in either document. The deprecation is recorded as a fact; what to do about it is a separate ticket, after M4.

- [ ] **Step 5: Gates and commit**

```bash
pnpm format:check
git add -A
git commit -F- <<'MSG'
[PD-49]: record the real ceiling and retire the advice to get a key

Three claims here had become false. The README told a reader to register
a free API key before the first production sweep, and registration is
closed. Nothing named the anonymous limits, which are 1000 a day and 30 a
minute. And PD-48's batch-size measurement does not reproduce.

The re-measurement is added beside the original rather than replacing it,
because what this project believed and when is part of what the
measurements are for.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Self-review notes

Checked against the spec, 2026-09-21.

**Spec coverage.** Every section maps to a task: the budget and its fail-open polarity to Task 1; the shared batch service and the cache gap to Task 2; the rolling cursor and the two resumptions to Task 3; the coordinator, the queue, the cron, the 429 stall, the reserve and the `SyncRun` to Task 4; all six documentation corrections to Task 5.

**Verification coverage.** The spec lists twelve checks. Task 1 covers 6 and 8; Task 2 covers 10; Task 3 covers the mechanism behind 3, 4 and 5; Task 4 covers 1, 2, 3, 4, 7, 9 and 11; gates (12) run in every task. **Check 5 — that a BullMQ retry resumes within the run rather than from the previous run's cursor — is exercised at the unit level in Task 3 Step 4 but is not re-run against a killed worker mid-sweep.** Task 4's probe seeds a closed run and does not interrupt one. If an executor has the budget for one more measurement, killing the worker mid-sweep and restarting it is the highest-value one left, because it is the distinction this plan calls most likely to be implemented wrong.

**Type consistency.** `BatchResult` (Task 2, returned by `refreshBatch`) and `BatchOutcome` (Task 4, internal to the sweep) are different shapes on purpose and are named differently so they cannot be confused: the service reports what it wrote, the processor reports what the loop should do next. `PriceCursor` is spelled `{ lastCardId }` in Tasks 3 and 4 and nowhere else.

**Three defects this review caught and fixed inline.** They are recorded because each would have been quiet: a completed first pass starting from the beginning was classified `PARTIAL`, because the status test asked whether a stop reason was set rather than whether the catalog had been covered — so every successful sweep would have reported as degraded. The wrapped-tail branch called a helper whose rejection handler swallowed `ProviderContractError`, which is the one error that must close the run `FAILED`. And the breaker failure for a contract error would have been recorded twice, once in `PriceBatchService` and once in the processor, halving the effective threshold.

**Known rough edge.** `PriceSweepProcessor.process` is long — roughly 150 lines — and the wrap-around arithmetic inside the loop is its least obvious part. It mirrors `catalog-sync.processor.ts`, which is longer, so it matches the house pattern rather than introducing a new one. If it grows during implementation, the loop body is the natural thing to lift into a private method.
