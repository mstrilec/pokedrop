# PD-50 Active-Card Price Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A job running four times a day that refreshes the prices of cards people actually have — owned, in a deck, or recently traded — staleest first, bounded in size, and skipping anything the nightly sweep has already refreshed.

**Architecture:** One SQL statement defines the work: it unions the three membership signals, excludes anything whose `priceUpdatedAt` is inside the freshness window, orders by staleness and takes `maxCards + 1` rows so truncation is detectable. That single query satisfies the ticket's deduplication, priority and boundedness criteria at once, with no state shared between this job and the nightly sweep. The job itself is PD-49's coordinator shape minus the cursor: the set is re-derived every run, so there is nothing to resume.

**Tech Stack:** NestJS 12 (ESM, `module: nodenext` — every relative import ends in `.js`), Prisma 7.10.0 with the `PrismaPg` driver adapter, BullMQ 5.81.5, PostgreSQL 17, Redis 7.4.

**Spec:** [`docs/superpowers/specs/2026-09-22-pd-50-active-price-refresh-design.md`](../specs/2026-09-22-pd-50-active-price-refresh-design.md)

## Global Constraints

- **Work directly on `dev`.** No feature branches, no pull requests.
- **Commit subjects are `[PD-50]: short lowercase description`**, no trailing period, **72 characters maximum**. Bodies end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. commitlint rejects two ticket tags in one subject and warns on a body line that starts a word then a colon.
- **No automated tests in v1** (`docs/PRD.md` §20). **This overrides the TDD structure the writing-plans skill normally imposes.** Every verification step is a measurement against the running stack. Do not add test files, test runners, test dependencies, or a `test` step to CI.
- **ESM.** Relative imports inside `apps/api` carry the `.js` extension or the build fails.
- **A 429 never reaches the breaker, and never counts into `failed`.** Only `ProviderUnavailableError` and `ProviderContractError` do.
- **Batch size is 250**, the same constant PD-49 measured and uses.
- **The budget counter is read through `RedisService`, never `CacheService`.**
- **Nothing outside `sync/providers/` may import a provider-specific type**; imports go through `providers/index.ts`. An ESLint rule enforces this.
- **Every commit compiles.** `pnpm typecheck`, `pnpm lint` and `pnpm format:check` pass from the repository root before each one.
- **Verified claims only.** If a measurement contradicts the spec, report the contradiction rather than adjusting the claim to fit.

### Shared shell setup

```bash
cd /m/projects/pokedrop
PSQL="docker compose exec -T postgres psql -U pokedrop -d pokedrop"
REDIS="docker compose exec -T redis redis-cli -n 0"
```

`docker compose ps` must show postgres and redis healthy.

### Live values these steps assert against

Measured 2026-09-22. Re-measure if a step disagrees rather than editing the expectation.

- `inventory_items` **7 rows / 7 cards**, `deck_cards` **3 / 3**, `trade_items` **7 rows / 6 cards**
- the three unioned: **8 distinct cards** — they overlap
- the catalog is **20 670** cards; `price_snapshots` is empty; `latestPriceUsd` is set on **12** cards
- all 6 seeded trades were created inside the last 30 days
- `SyncKind` currently has exactly two values, `CATALOG` and `PRICE`
- no usable `cardId` index exists on any of the three membership tables, and `cards.priceUpdatedAt` is unindexed

### Four traps that have already cost time on this project

**`pnpm build` deletes `apps/api/dist/`, and your probe with it.** Write probes *after* building.

**A probe that boots `WorkerModule` will not exit on its own** once it has consumed a job. Every probe here ends with `process.exit(0)`.

**After `prisma migrate dev`, run `pnpm exec prisma generate` in `apps/api`** if the types do not update. A stale client produces `Unsafe assignment of an error typed value` from lint, which looks like a code fault and is not.

**`defaultJobOptions` is applied by the producer.** Anything that enqueues must use the injected queue.

### Restoring state between measurements

Task 2 and Task 3 write real prices, and Task 2 inserts synthetic rows. Capture the price restore script **before** the first one:

```bash
SCRATCH=$(mktemp -d)
$PSQL -tAc "SELECT format('UPDATE cards SET \"latestPriceUsd\"=%s, \"latestPriceEur\"=%s, \"priceUpdatedAt\"=%s WHERE id=%L;', coalesce(\"latestPriceUsd\"::text,'NULL'), coalesce(\"latestPriceEur\"::text,'NULL'), coalesce(quote_literal(\"priceUpdatedAt\"::text),'NULL'), id) FROM cards WHERE \"priceUpdatedAt\" IS NOT NULL ORDER BY id;" | tr -d '\r' > "$SCRATCH/rows.sql"
{ echo 'UPDATE cards SET "latestPriceUsd"=NULL, "latestPriceEur"=NULL, "priceUpdatedAt"=NULL WHERE "priceUpdatedAt" IS NOT NULL;'; cat "$SCRATCH/rows.sql"; echo 'DELETE FROM price_snapshots;'; } > "$SCRATCH/restore.sql"
echo "restore script at $SCRATCH/restore.sql"
```

Apply with `$PSQL -q -v ON_ERROR_STOP=1 < "$SCRATCH/restore.sql"`. The clean baseline is `price_snapshots` **0**, `latestPriceUsd` on **12** cards, `latestPriceEur` on **0**.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/api/src/sync/active-card.selector.ts` | **new** — the one query, and the truncation flag |
| `apps/api/src/sync/price-active.processor.ts` | **new** — select, walk in batches, record the run |
| `apps/api/src/sync/price-active.scheduler.ts` | **new** — the cron, whose entire body is an enqueue |
| `apps/api/prisma/schema.prisma` | **edit** — `PRICE_ACTIVE`, four `@@index` declarations |
| `packages/shared/src/enums.ts` | **edit** — `PRICE_ACTIVE` in `SyncKindSchema` |
| `apps/api/src/admin/admin-sync.service.ts` | **edit** — one more kind |
| `apps/api/src/queue/queue.constants.ts`, `queue.module.ts` | **edit** — the `price-active` queue |
| `apps/api/src/sync/sync.module.ts`, `index.ts` | **edit** — register and export |
| `apps/api/src/config/env.schema.ts`, `app.config.ts`, `.env.example` | **edit** — four settings |
| `apps/api/src/sync/README.md`, `docs/API.md` | **edit** — the job and the third kind |

### Task order

Task 1 → 2 → 3 → 4, strictly. Task 2's query needs Task 1's indexes to measure a plan; Task 3's processor calls Task 2's selector; Task 4 documents what Tasks 1–3 measured.

---

## Task 1: A third sync kind, and the indexes the query needs

**Files:**
- Modify: `apps/api/prisma/schema.prisma`, `packages/shared/src/enums.ts`, `apps/api/src/admin/admin-sync.service.ts`

**Interfaces:**
- Produces: `SyncKind.PRICE_ACTIVE` in both the Prisma client and `@pokedrop/shared`; btree indexes on `inventory_items(cardId)`, `deck_cards(cardId)`, `trade_items(cardId)` and `cards(priceUpdatedAt)`. Tasks 2 and 3 rely on all of them.

- [ ] **Step 1: Add the enum value and the four indexes**

In `apps/api/prisma/schema.prisma`:

```prisma
enum SyncKind {
  CATALOG
  PRICE
  PRICE_ACTIVE
}
```

Add `@@index([cardId])` to `model InventoryItem`, beside its existing `@@unique([userId, cardId])`. The unique index cannot serve a `cardId` lookup — `cardId` is its second column, and a btree is only searchable on a leading prefix of its columns.

Add `@@index([cardId])` to `model DeckCard`, beside `@@unique([deckId, cardId])`, for the same reason.

Add `@@index([cardId])` to `model TradeItem`. This table has no index on the column at all; its only one is `@@index([tradeId])`.

Add `@@index([priceUpdatedAt])` to `model Card`, beside the existing `@@index([name])` and friends. It serves both the freshness predicate and the `ORDER BY`.

- [ ] **Step 2: Generate and apply the migration**

```bash
cd apps/api && pnpm exec prisma migrate dev --name price_active_and_card_lookup_indexes && cd ../..
```

**Read the generated SQL before continuing.** It must contain `ALTER TYPE "SyncKind" ADD VALUE 'PRICE_ACTIVE'` and four `CREATE INDEX` statements, and **must not** contain any statement that *uses* the new value — no default, no backfill, no check constraint mentioning it. A new enum value cannot be used in the transaction that adds it, and Prisma runs a migration inside one. If Prisma generated anything that uses it, stop and report rather than editing around it.

- [ ] **Step 3: Confirm the migration landed**

```bash
$PSQL -tAc "SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='SyncKind' ORDER BY e.enumsortorder"
$PSQL -tAc "SELECT indexname FROM pg_indexes WHERE (tablename='inventory_items' OR tablename='deck_cards' OR tablename='trade_items') AND indexdef LIKE '%(\"cardId\")%' ORDER BY indexname"
$PSQL -tAc "SELECT indexname FROM pg_indexes WHERE tablename='cards' AND indexdef LIKE '%priceUpdatedAt%'"
```

**Expected:** three enum labels ending in `PRICE_ACTIVE`; three `cardId` index names; one `priceUpdatedAt` index name.

- [ ] **Step 4: Widen the shared enum**

In `packages/shared/src/enums.ts`:

```ts
export const SyncKindSchema = z.enum(['CATALOG', 'PRICE', 'PRICE_ACTIVE']);
```

Without this, `SyncStatusResponseSchema.parse` in `AdminSyncService` throws the moment a `PRICE_ACTIVE` row exists — the endpoint validates its own output against the shared contract.

- [ ] **Step 5: Report the third kind from the admin endpoint**

In `apps/api/src/admin/admin-sync.service.ts`, in `lastRunPerKind`:

```ts
    const kinds = [SyncKind.CATALOG, SyncKind.PRICE, SyncKind.PRICE_ACTIVE];
```

This is the whole reason the value exists: `lastRunPerKind` reports the last run of each kind, so a separate kind is what keeps the seventeen-minute nightly sweep visible beside a two-minute active refresh instead of being overwritten by it.

- [ ] **Step 6: Gates**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
```

If `typecheck` reports `PRICE_ACTIVE` missing from the Prisma client, run `cd apps/api && pnpm exec prisma generate && cd ../..`.

- [ ] **Step 7: Measure that the endpoint survives a row of the new kind**

Build first, then create `apps/api/dist/probe-kind.js`:

```js
import { NestFactory } from '@nestjs/core';
import { SyncKind, SyncStatus } from '@prisma/client';
import { AppModule } from './app.module.js';
import { PrismaService } from './prisma/prisma.service.js';
import { AdminSyncService } from './admin/admin-sync.service.js';

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
const prisma = app.get(PrismaService);
const admin = app.get(AdminSyncService);

const row = await prisma.syncRun.create({
  data: { kind: SyncKind.PRICE_ACTIVE, provider: 'pokemontcg', jobId: 'probe-kind',
          status: SyncStatus.SUCCEEDED, finishedAt: new Date(), processed: 42, failed: 0 },
});

const status = await admin.status();
console.log(`kinds reported: ${status.runs.map((r) => r.kind).join(', ')}`);
console.log(`price_active row processed: ${status.runs.find((r) => r.kind === 'PRICE_ACTIVE')?.processed}`);

await prisma.syncRun.delete({ where: { id: row.id } });
await app.close();
process.exit(0);
```

```bash
node apps/api/dist/probe-kind.js
```

**Expected:** `kinds reported: PRICE_ACTIVE` (only this kind has a row — `CATALOG` rows exist too, so the list may read `CATALOG, PRICE_ACTIVE`), and `processed: 42`. A Zod parse error here means Step 4 was skipped.

Confirm nothing was left behind:

```bash
$PSQL -tAc "SELECT count(*) FROM sync_runs WHERE kind='PRICE_ACTIVE'"
```

**Expected:** `0`.

- [ ] **Step 8: Clean up and commit**

```bash
rm -f apps/api/dist/probe-kind.js
git add -A
git commit -F- <<'MSG'
[PD-50]: add a third sync kind and the indexes the active query needs

A separate kind keeps the nightly sweep visible on the admin endpoint.
Sharing PRICE would mean a two-minute active refresh overwriting the
seventeen-minute sweep in the one place an operator looks to see what
happened.

None of the three membership tables could be searched by cardId: two
have it as the second column of a composite unique index, which a btree
cannot use, and trade_items had no index on it at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Task 2: The selection query

**Files:**
- Create: `apps/api/src/sync/active-card.selector.ts`
- Modify: `apps/api/src/config/env.schema.ts`, `apps/api/src/config/app.config.ts`, `.env.example`, `apps/api/src/sync/sync.module.ts`, `apps/api/src/sync/index.ts`

**Interfaces:**
- Consumes: the four indexes and `SyncKind.PRICE_ACTIVE` from Task 1.
- Produces: `ActiveCardSelector.select(now?: Date): Promise<ActiveCardSelection>` where `ActiveCardSelection` is `{ cardIds: string[]; truncated: boolean }`. Task 3's processor calls exactly this.
- Produces: `config.priceActive.freshnessSeconds`, `.tradeWindowDays`, `.maxCards`, `.reserve`.

- [ ] **Step 1: Add the configuration**

In `apps/api/src/config/env.schema.ts`, beside the other price settings:

```ts
    PRICE_ACTIVE_FRESHNESS: z.coerce.number().int().min(1).default(21_600),

    PRICE_ACTIVE_TRADE_WINDOW_DAYS: z.coerce.number().int().min(1).default(30),

    PRICE_ACTIVE_MAX_CARDS: z.coerce.number().int().min(1).default(2_500),

    PRICE_ACTIVE_RESERVE: z.coerce.number().int().min(0).default(150),
```

In `apps/api/src/config/app.config.ts`, after the `priceSweep` block:

```ts
    priceActive: {
      // Equal to the cadence. Shorter re-fetches what the previous run just
      // wrote; longer leaves a run with nothing to do.
      freshnessSeconds: env.PRICE_ACTIVE_FRESHNESS,

      // How far back a trade still counts as evidence somebody cares about a
      // card. Nothing measured - the cheapest of these four to change later.
      tradeWindowDays: env.PRICE_ACTIVE_TRADE_WINDOW_DAYS,

      // The bound, and the setting that actually protects the budget. Unbounded
      // at four runs a day, an active set the size of the catalog would cost
      // roughly 960 requests of the 1 000 available.
      maxCards: env.PRICE_ACTIVE_MAX_CARDS,

      // Left unspent for everything else - by the time this job runs, that is
      // PD-52's on-demand traffic rather than the nightly jobs, which took
      // their share hours earlier.
      reserve: env.PRICE_ACTIVE_RESERVE,
    },
```

In `.env.example`, under the price settings:

```bash
# How old a price must be before the active refresh will re-fetch it, in
# seconds. Equal to the cron cadence: shorter and a run re-fetches what the
# last one just wrote, longer and a run finds nothing to do.
PRICE_ACTIVE_FRESHNESS=21600

# How far back a trade still counts as interest in a card.
PRICE_ACTIVE_TRADE_WINDOW_DAYS=30

# The most cards one active run will refresh. This is the bound that keeps the
# job affordable as the active set grows; coverage degrades before the budget
# does, and the staleness ordering means the cards left behind are the freshest.
PRICE_ACTIVE_MAX_CARDS=2500

# Requests this job leaves unspent for on-demand refreshes.
PRICE_ACTIVE_RESERVE=150
```

- [ ] **Step 2: Write the selector**

Create `apps/api/src/sync/active-card.selector.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { PrismaService } from '../prisma/index.js';

export interface ActiveCardSelection {
  cardIds: string[];

  /** True when more cards were eligible than the bound allows. */
  truncated: boolean;
}

const MS_PER_DAY = 86_400_000;

/**
 * Which cards the active refresh should price, and in what order.
 *
 * One statement, and it satisfies three of the ticket's criteria at once.
 *
 * **Deduplication against the nightly sweep is free.** A card that sweep
 * refreshed carries a fresh `priceUpdatedAt`, so the freshness predicate
 * excludes it until the window passes. There is no run registry and no Redis
 * marker: the column PD-48 already writes is the entire mechanism, which means
 * there is no shared state between the two jobs that could fall out of step.
 *
 * **Ordering is staleness, oldest first.** The ticket asks for the most-viewed
 * cards first; view tracking is deferred to its own ticket because no traffic
 * exists to shape it, and staleness is the honest replacement - it is the
 * ordering a refresh job wants anyway.
 *
 * Raw SQL because the membership test is a UNION of three tables and Prisma's
 * query builder cannot express one. Every interpolation below is a tagged
 * template parameter, not string concatenation.
 */
@Injectable()
export class ActiveCardSelector {
  private readonly freshnessMs: number;
  private readonly tradeWindowMs: number;
  private readonly maxCards: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.freshnessMs = config.priceActive.freshnessSeconds * 1_000;
    this.tradeWindowMs = config.priceActive.tradeWindowDays * MS_PER_DAY;
    this.maxCards = config.priceActive.maxCards;
  }

  async select(now: Date = new Date()): Promise<ActiveCardSelection> {
    const staleBefore = new Date(now.getTime() - this.freshnessMs);
    const tradedAfter = new Date(now.getTime() - this.tradeWindowMs);

    // One more than the bound, so truncation is detectable. A bare LIMIT
    // returning exactly `maxCards` cannot tell "there were this many" from
    // "there were more", and a second COUNT(*) would run the membership union
    // twice to learn one boolean.
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c.id
      FROM cards c
      WHERE c.id IN (
              SELECT "cardId" FROM inventory_items
        UNION SELECT "cardId" FROM deck_cards
        UNION SELECT ti."cardId" FROM trade_items ti
                JOIN trades t ON t.id = ti."tradeId"
               WHERE t."createdAt" > ${tradedAfter}
            )
        AND (c."priceUpdatedAt" IS NULL OR c."priceUpdatedAt" < ${staleBefore})
      ORDER BY c."priceUpdatedAt" ASC NULLS FIRST
      LIMIT ${this.maxCards + 1}
    `;

    return {
      cardIds: rows.slice(0, this.maxCards).map((row) => row.id),
      truncated: rows.length > this.maxCards,
    };
  }
}
```

`NULLS FIRST` is explicit and load-bearing: Postgres defaults `ASC` to `NULLS LAST`, so without it a card that has never been priced at all would sort behind every card that has — the opposite of what this job is for.

- [ ] **Step 3: Register and export**

In `apps/api/src/sync/sync.module.ts`, add `ActiveCardSelector` to `providers` and `exports`. In `apps/api/src/sync/index.ts`:

```ts
export { ActiveCardSelector } from './active-card.selector.js';
export type { ActiveCardSelection } from './active-card.selector.js';
```

- [ ] **Step 4: Gates**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
```

- [ ] **Step 5: Measure correctness at the real size**

Create `apps/api/dist/probe-selector.js`:

```js
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';
import { PrismaService } from './prisma/prisma.service.js';
import { ActiveCardSelector } from './sync/active-card.selector.js';

const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['warn', 'error'] });
const prisma = app.get(PrismaService);
const selector = app.get(ActiveCardSelector);

const first = await selector.select();
console.log(`selected ${first.cardIds.length}, truncated ${first.truncated}`);
console.log(`ids: ${first.cardIds.join(', ')}`);

// Freshen one of them and confirm it drops out - the dedup property, shown
// rather than asserted.
const victim = first.cardIds[0];
await prisma.card.update({ where: { id: victim }, data: { priceUpdatedAt: new Date() } });
const second = await selector.select();
console.log(`after freshening ${victim}: ${second.cardIds.length} selected, present: ${second.cardIds.includes(victim)}`);

// And that it comes back once the window has passed.
const third = await selector.select(new Date(Date.now() + 7 * 3600 * 1000));
console.log(`with the clock moved 7h forward: present again: ${third.cardIds.includes(victim)}`);

await app.close();
process.exit(0);
```

```bash
node apps/api/dist/probe-selector.js
```

**Expected:** `selected 8, truncated false`; after freshening, **7 selected and `present: false`**; with the clock moved forward, **`present again: true`**. A card that stays selected after being freshened means the freshness predicate is wrong; one that never returns means the window arithmetic is.

Restore the victim's price afterwards with the restore script from the preamble.

- [ ] **Step 6: Measure the query plan at a size where a plan means something**

At eight rows Postgres will sequentially scan whatever indexes exist, correctly — so this is the only step that can tell whether the acceptance criterion holds.

The synthetic rows are all prefixed `probe-` in their `id`, which is how Step 6's
cleanup finds them again. Column names and nullability were checked against the
live table before this plan was written: `id`, `userId`, `cardId` and `quantity`
have no defaults and must be supplied; `lockedQuantity` and `acquiredAt` do.

```bash
$PSQL <<'SQL'
INSERT INTO inventory_items (id, "userId", "cardId", quantity, "lockedQuantity", "acquiredAt")
SELECT 'probe-' || c.id, (SELECT id FROM users LIMIT 1), c.id, 1, 0, now()
FROM cards c LIMIT 40000
ON CONFLICT DO NOTHING;
ANALYZE inventory_items;
ANALYZE cards;
SQL
```

Then capture the plan:

```bash
$PSQL <<'SQL'
EXPLAIN (ANALYZE, BUFFERS)
SELECT c.id FROM cards c
WHERE c.id IN (
        SELECT "cardId" FROM inventory_items
  UNION SELECT "cardId" FROM deck_cards
  UNION SELECT ti."cardId" FROM trade_items ti JOIN trades t ON t.id = ti."tradeId"
         WHERE t."createdAt" > now() - interval '30 days')
  AND (c."priceUpdatedAt" IS NULL OR c."priceUpdatedAt" < now() - interval '6 hours')
ORDER BY c."priceUpdatedAt" ASC NULLS FIRST
LIMIT 2501;
SQL
```

**Record the plan verbatim in your report.** What to look for and report honestly either way: whether the membership tables are reached by index scan or sequential scan, and whether the `ORDER BY` uses the `priceUpdatedAt` index or a sort node. **A sequential scan here is a finding, not a failure to hide** — at 40 000 of 20 670 eligible cards a seq scan may genuinely be the cheaper plan, and saying so is more useful than claiming an index is used when the planner disagrees.

Remove the synthetic rows and confirm the baseline:

```bash
$PSQL -c "DELETE FROM inventory_items WHERE id LIKE 'probe-%';"
$PSQL -tAc "SELECT count(*) FROM inventory_items"
```

**Expected:** back to **7**.

- [ ] **Step 7: Clean up and commit**

```bash
rm -f apps/api/dist/probe-selector.js
git add -A
git commit -F- <<'MSG'
[PD-50]: select active cards by staleness in one bounded query

The union of owned, decked and recently traded, minus anything the
nightly sweep refreshed inside the freshness window, ordered oldest
first and limited.

Deduplication against the sweep costs nothing: the freshness predicate
reads the priceUpdatedAt column PD-48 already writes, so the two jobs
share no state that could fall out of step. One row beyond the bound is
fetched so truncation can be told from an exactly-full page.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Task 3: The job

**Files:**
- Create: `apps/api/src/sync/price-active.processor.ts`, `apps/api/src/sync/price-active.scheduler.ts`
- Modify: `apps/api/src/queue/queue.constants.ts`, `apps/api/src/queue/queue.module.ts`, `apps/api/src/sync/sync.module.ts`

**Interfaces:**
- Consumes: `ActiveCardSelector.select()` (Task 2), `PriceBatchService.refreshBatch(cardIds, provider)` returning `{ asked, priced, cards, snapshots }` (PD-49), `RequestBudgetService.hasHeadroom(provider, reserve)` and `.stateOf(provider)` (PD-49), `SyncRunService.findResumable/startOrResume/recordProgress/close` (PD-49).
- Produces: `SyncRun` rows of kind `PRICE_ACTIVE`.

- [ ] **Step 1: Add the queue**

In `apps/api/src/queue/queue.constants.ts`:

```ts
export const QUEUE = {
  catalogSync: 'catalog-sync',
  priceSync: 'price-sync',
  priceSweep: 'price-sweep',
  priceActive: 'price-active',
  tradeExpiry: 'trade-expiry',
} as const;
```

In `apps/api/src/queue/queue.module.ts`, add `{ name: QUEUE.priceActive }` to `BullModule.registerQueue`.

- [ ] **Step 2: Write the processor**

Create `apps/api/src/sync/price-active.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { SyncKind, SyncStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
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
import { ActiveCardSelector } from './active-card.selector.js';
import { PriceBatchService } from './price-batch.service.js';
import { SyncRunService } from './sync-run.service.js';

/** The same 250 PD-49 measured: 100 cards cost 4.53 s and 250 cost 12.57 s. */
const BATCH_SIZE = 250;

/** As in the sweep: sized against a ceiling of 30 requests a minute. */
const STALL_BASE_MS = 30_000;
const STALL_CAP_MS = 300_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface BatchOutcome {
  processed: number;
  failed: number;
  stalled: boolean;
  down: boolean;
}

@Processor(QUEUE.priceActive)
export class PriceActiveProcessor extends WorkerHost {
  private readonly logger = new Logger(PriceActiveProcessor.name);

  private readonly reserve: number;
  private readonly maxStalls: number;

  constructor(
    private readonly selector: ProviderSelectorService,
    private readonly breaker: ProviderBreakerService,
    private readonly budget: RequestBudgetService,
    private readonly active: ActiveCardSelector,
    private readonly batch: PriceBatchService,
    private readonly runs: SyncRunService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    super();
    this.reserve = config.priceActive.reserve;
    this.maxStalls = config.priceSweep.maxStalls;
  }

  async process(job: Job): Promise<void> {
    const resumable = await this.runs.findResumable(SyncKind.PRICE_ACTIVE, job.id ?? '');

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
    const run = await this.runs.startOrResume(SyncKind.PRICE_ACTIVE, provider.name, job.id ?? '');
    const log = (message: string): void =>
      this.logger.log(`run ${run.id} job ${job.id}: ${message}`);

    // Re-selected on every run, including a BullMQ retry. There is no cursor
    // because there is nothing to resume: the set is derived fresh and bounded,
    // and cards a failed attempt did not reach are staler now and therefore
    // sort higher in the next selection.
    const selection = await this.active.select();
    log(
      `${selection.cardIds.length} active cards selected${selection.truncated ? ' (truncated by the bound)' : ''}`,
    );

    let processed = 0;
    let failed = 0;
    let stalls = 0;
    let stoppedBecause: string | null = null;

    for (let offset = 0; offset < selection.cardIds.length; ) {
      if (!(await this.budget.hasHeadroom(provider.name, this.reserve))) {
        const state = await this.budget.stateOf(provider.name);
        stoppedBecause = `daily request budget exhausted: ${state.used} of ${state.limit ?? 'unlimited'} spent, reserve ${this.reserve}`;
        break;
      }

      const ids = selection.cardIds.slice(offset, offset + BATCH_SIZE);

      let outcome: BatchOutcome;

      try {
        outcome = await this.runBatch(ids, choice, run.id, stalls);
      } catch (error) {
        // Only a contract error escapes runBatch: the upstream changed shape.
        // PriceBatchService has already recorded the breaker failure.
        await this.runs.close(run.id, SyncStatus.FAILED, describe(error));
        throw error;
      }

      if (outcome.stalled) {
        stalls += 1;

        if (stalls >= this.maxStalls) {
          stoppedBecause = `rate limited ${stalls} times consecutively`;
          break;
        }

        // `offset` does not advance. The same batch is asked for again after
        // the wait runBatch already took.
        continue;
      }

      stalls = 0;
      processed += outcome.processed;
      failed += outcome.failed;
      offset += ids.length;

      await this.runs.recordProgress(run.id, processed, failed, { lastCardId: ids[ids.length - 1] as string });
      await job.updateProgress({ processed, failed, offset });

      if (outcome.down) {
        stoppedBecause = `${provider.name} breaker opened`;
        break;
      }
    }

    // A truncated selection is not a complete piece of work even when every
    // batch succeeded: cards were eligible and went unpriced.
    const notes = [
      choice.isFallback ? `fallback via ${provider.name} (${choice.reason})` : null,
      stoppedBecause,
      selection.truncated && stoppedBecause === null
        ? `bounded at ${selection.cardIds.length} cards; more were eligible`
        : null,
    ].filter((note): note is string => note !== null);

    const status =
      notes.length === 0 && failed === 0 ? SyncStatus.SUCCEEDED : SyncStatus.PARTIAL;

    await this.runs.close(run.id, status, notes.length > 0 ? notes.join('; ') : undefined);
    log(`finished ${status}: ${processed} processed, ${failed} failed`);
  }

  /**
   * One batch, plus the 429 wait. Everything but a contract error becomes an
   * outcome the loop can act on.
   *
   * A rate limit is not a failure: it says the provider is healthy and we are
   * asking too fast. It is not counted into `failed`, it does not touch the
   * breaker, and the caller does not advance past the batch.
   */
  private async runBatch(
    ids: string[],
    choice: ProviderChoice,
    runId: string,
    stalls: number,
  ): Promise<BatchOutcome> {
    try {
      const result = await this.batch.refreshBatch(ids, choice.provider);
      return { processed: result.priced, failed: 0, stalled: false, down: false };
    } catch (error) {
      if (error instanceof ProviderRateLimitError) {
        // Honour a Retry-After when the provider sends one; this upstream never
        // does, so in practice this is the escalation. `stalls` is the count
        // before this one, so the first wait is the base rather than double it.
        const wait = Math.min(
          error.retryAfterMs ?? STALL_BASE_MS * 2 ** stalls,
          STALL_CAP_MS,
        );
        this.logger.warn(`run ${runId}: rate limited, waiting ${wait}ms - ${describe(error)}`);
        await sleep(wait);
        return { processed: 0, failed: 0, stalled: true, down: false };
      }

      if (error instanceof ProviderContractError) {
        throw error;
      }

      let down = false;

      if (error instanceof ProviderUnavailableError) {
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

Create `apps/api/src/sync/price-active.scheduler.ts`:

```ts
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { QUEUE } from '../queue/index.js';

/**
 * Four times a day, and deliberately not `CronExpression.EVERY_6_HOURS`.
 *
 * That expression is `0,6,12,18`, which puts a run at 00:00 UTC - immediately
 * after the request budget resets and three hours BEFORE the catalog sync and
 * the nightly sweep. The whole reason the two big jobs are safe without a rule
 * protecting them is that they run first on a fresh allowance, and an active
 * run at midnight would spend ahead of them.
 *
 * 05:00, 11:00, 17:00 and 23:00 UTC are all after both nightly jobs have taken
 * their share, and none of them straddles the reset.
 *
 * Registered in the worker and not the API: two processes running this cron
 * would enqueue two runs each time.
 */
@Injectable()
export class PriceActiveScheduler {
  private readonly logger = new Logger(PriceActiveScheduler.name);

  constructor(@InjectQueue(QUEUE.priceActive) private readonly queue: Queue) {}

  /**
   * The entire body is an enqueue, per the rule in queue/README.md. Doing the
   * work here would lose every retry, backoff and failure record the queue
   * provides.
   */
  @Cron('0 5,11,17,23 * * *', { name: 'price-active', timeZone: 'UTC' })
  async enqueue(): Promise<void> {
    const job = await this.queue.add('price-active', {});
    this.logger.log(`Enqueued active price refresh as job ${job.id}`);
  }
}
```

- [ ] **Step 4: Register both**

In `apps/api/src/sync/sync.module.ts`, add `PriceActiveProcessor` and `PriceActiveScheduler` to `providers`.

- [ ] **Step 5: Gates**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
```

- [ ] **Step 6: Measure a real run**

The active set is 8 cards, so a run is one batch and costs about 3 requests. Capture the restore script from the preamble first.

Create `apps/api/dist/probe-active.js`:

```js
import { NestFactory } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { SyncKind } from '@prisma/client';
import { WorkerModule } from './worker.module.js';
import { PrismaService } from './prisma/prisma.service.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['log', 'warn', 'error'] });
const prisma = app.get(PrismaService);
const queue = app.get(getQueueToken('price-active'));

const started = Date.now();
const job = await queue.add('price-active', {});
for (;;) {
  const state = await job.getState();
  if (state === 'completed' || state === 'failed') { console.log(`job ${state} in ${((Date.now() - started) / 1000).toFixed(1)}s`); break; }
  await sleep(500);
}

const run = await prisma.syncRun.findFirst({ where: { kind: SyncKind.PRICE_ACTIVE }, orderBy: { startedAt: 'desc' } });
console.log(`run: ${run.status} provider=${run.provider} processed=${run.processed} failed=${run.failed} error=${run.error ?? '-'}`);

// A second run immediately after must select nothing: the first just freshened
// every card it touched, which is the deduplication property end to end.
const job2 = await queue.add('price-active', {});
for (;;) {
  const s = await job2.getState();
  if (s === 'completed' || s === 'failed') break;
  await sleep(500);
}
const run2 = await prisma.syncRun.findFirst({ where: { kind: SyncKind.PRICE_ACTIVE }, orderBy: { startedAt: 'desc' } });
console.log(`second run: ${run2.status} processed=${run2.processed} failed=${run2.failed}`);

await app.close();
process.exit(0);
```

```bash
node apps/api/dist/probe-active.js 2>&1 | tail -20
```

**Expected:** the log line `8 active cards selected`; the first run `SUCCEEDED` with `processed=8` (or `PARTIAL` if the upstream dropped the batch — a ~17% event, and if so re-run rather than recording a failure as the expected outcome); the **second run `processed=0`**, because everything it would have selected was freshened moments earlier. That second number is the deduplication criterion demonstrated end to end rather than at the query level.

- [ ] **Step 7: Confirm the admin endpoint shows both price kinds**

```bash
$PSQL -c "SELECT kind, status, processed, failed, error FROM sync_runs WHERE kind LIKE 'PRICE%' ORDER BY \"startedAt\" DESC LIMIT 4;"
```

**Expected:** `PRICE_ACTIVE` rows present. If a `PRICE` row from PD-49 also survives, both kinds appear — which is the point of Task 1.

- [ ] **Step 8: Restore, clean up and commit**

```bash
$PSQL -q -v ON_ERROR_STOP=1 < "$SCRATCH/restore.sql"
$PSQL -c "DELETE FROM sync_runs WHERE kind='PRICE_ACTIVE';"
rm -f apps/api/dist/probe-active.js
git add -A
git commit -F- <<'MSG'
[PD-50]: refresh active cards four times a day

The fast half of the two-speed strategy. One job, no cursor: the set is
re-derived every run and bounded, so a run that dies leaves its cards
staler and therefore higher in the next selection.

The cron is a fixed 05, 11, 17 and 23 UTC rather than EVERY_6_HOURS,
which would put a run at midnight - right after the budget resets and
three hours before the catalog sync and the nightly sweep, which are
safe only because they spend first.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Task 4: Document the job and the third kind

**Files:**
- Modify: `apps/api/src/sync/README.md`, `apps/api/src/queue/README.md`, `docs/API.md`

- [ ] **Step 1: Document the job**

In `apps/api/src/sync/README.md`, after the nightly sweep's section, add "The active refresh" covering: the three membership signals and why any trade status counts; the single query and how it earns three acceptance criteria at once; **staleness standing in for the deferred trending signal, and why view tracking was deferred rather than built** (no traffic exists to shape it — the frontend is M11–M13 at 0%); the bound as the thing that protects the budget rather than the cadence; the cron's fixed hours and why not `EVERY_6_HOURS`; and a measured table from Task 3's probe.

State the sizes honestly: the active set was **8 cards** when this was built, all of it seed data, because owned cards arrive with M6, decks with M7 and trades with M8. The thresholds are chosen, not measured, and the file should say which is which.

Record the query plan from Task 2 Step 6 as measured, including the case where the planner chose a sequential scan.

- [ ] **Step 2: Correct the queue table**

In `apps/api/src/queue/README.md`:

```markdown
| `price-sync` | PD-50's producer path is not this one; PD-52 | PD-48 |
| `price-sweep` | PD-49's nightly cron | PD-49 |
| `price-active` | PD-50's cron, four times a day | PD-50 |
```

Note that PD-50, like PD-49, coordinates its own batches and does not enqueue `price-sync` jobs — the earlier table's "filled by PD-50" line is now wrong and must go.

- [ ] **Step 3: Document the third kind**

In `docs/API.md`, in the `GET /admin/sync/status` passage, record that the endpoint now reports the last run of **three** kinds — `CATALOG`, `PRICE` and `PRICE_ACTIVE` — and why the price work is split in two: a seventeen-minute nightly sweep and a two-minute active refresh share nothing but a provider and a budget, and one row cannot describe both.

- [ ] **Step 4: Gate and commit**

```bash
pnpm format:check
git add -A
git commit -F- <<'MSG'
[PD-50]: document the active refresh and the third sync kind

Records what was measured and what was merely chosen: the active set was
eight cards of seed data when this was built, so the four thresholds are
decisions with reasons rather than numbers from observation.

Also says plainly that view tracking was deferred rather than built,
because no traffic exists to shape a popularity ranking against.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Self-review notes

Checked against the spec, 2026-09-22.

**Spec coverage.** Every section maps to a task: the enum, the admin endpoint and the four indexes to Task 1; the query, the truncation flag, the thresholds and the index measurement to Task 2; the shape, the cron, the budget reserve and failure handling to Task 3; all documentation to Task 4. The deferred trending signal is recorded in Task 4 rather than implemented, per the spec.

**One correction the plan makes to the spec.** The spec says the nightly jobs are safe because "the counter resets at 00:00 UTC and the two big jobs run at 3am and 4am, so they draw on a full allowance before the active refresh has run at all." That is true only if no active run happens between 00:00 and 03:00, and `CronExpression.EVERY_6_HOURS` puts one at exactly 00:00. Task 3 therefore schedules `0 5,11,17,23 * * *` and states why. **The spec's claim is correct as written only with this schedule**, and Task 4's documentation should record the reasoning rather than the expression.

**A residual inconsistency worth naming rather than hiding.** `recordProgress` requires a cursor argument, and this job has no cursor. Task 3 passes `{ lastCardId: <last id of the batch just done> }`, which is truthful — it is where the run got to — but the value has no resumption meaning here and nothing reads it. The alternative, widening `SyncCursor` with a variant for "no cursor", is more machinery than the problem deserves. An implementer who finds this ugly is right; it is a deliberate trade, and Task 4 should mention it in one sentence so the next reader does not think the field is load-bearing.

**Type consistency.** `ActiveCardSelection` is `{ cardIds, truncated }` in Tasks 2 and 3 and nowhere else. `BatchOutcome` is internal to Task 3's processor, deliberately the same shape as PD-49's so the two loops read alike. `config.priceActive.*` is spelled identically in Tasks 2 and 3. `SyncKind.PRICE_ACTIVE` is used in Tasks 1 and 3 and declared in Task 1.

**Batch-size duplication.** `BATCH_SIZE = 250` now appears in both `price-sweep.processor.ts` and `price-active.processor.ts`. Extracting it would couple two jobs that happen to agree today; PD-52 will want a batch of one. Left duplicated on purpose.

**One verification step is deliberately weaker than the spec's.** The spec asks that the cross-job case be shown by running the nightly sweep and then the active refresh. Task 3 Step 6 instead runs the active refresh twice. Both exercise the identical mechanism — the freshness predicate reading `priceUpdatedAt` — and neither job knows which one wrote that column, so the substitution tests the same code. It is made because a sweep costs about a quarter of the provider's daily allowance and this proves nothing the cheaper form does not. **The implementer should record the substitution and its reason**, not present it as the spec's step.

**The active job borrows `priceSweep.maxStalls`.** It has its own reserve but not its own stall ceiling, because a fifth setting whose right value is identical to the fourth's is a knob nobody will ever turn separately. The cost is that `price-active.processor.ts` reads a config key named for the other job, which reads oddly at the constructor. If a reviewer objects, adding `PRICE_ACTIVE_MAX_STALLS` is a two-line change — but it should be argued for, not added by default.
