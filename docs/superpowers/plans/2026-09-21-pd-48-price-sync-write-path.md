# PD-48 Price Sync Write Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first thing in this project that writes a price — a BullMQ processor that takes a batch of card ids, fetches their prices, updates the card's latest columns, appends at most one snapshot per card per source per day, and drops that card's price cache key.

**Architecture:** The processor is handed ids and does not choose them; PD-49, PD-50 and PD-52 are three producers over this one consumer. The one-snapshot-per-day cap becomes a **database invariant** rather than a code convention, by materialising the day as a `capturedOn` date column and putting an ordinary Prisma-declared unique index on `(cardId, source, capturedOn)`. That makes the insert `ON CONFLICT DO NOTHING`, which Prisma expresses as `createMany({ skipDuplicates: true })` — so this ticket needs no raw SQL.

**Tech Stack:** NestJS 12 (ESM, `module: nodenext` — every relative import ends in `.js`), Prisma 7.10.0 with the `PrismaPg` driver adapter, BullMQ 5.81.5, PostgreSQL 17, Redis 7.4.

**Spec:** [`docs/superpowers/specs/2026-09-21-pd-48-price-sync-write-path-design.md`](../specs/2026-09-21-pd-48-price-sync-write-path-design.md)

## Global Constraints

- **Work directly on `dev`.** No feature branches, no pull requests.
- **Commit subjects are `[PD-48]: short lowercase description`**, no trailing period, **72 characters maximum**. Bodies end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. **That trailer is this repository's attribution on every commit regardless of which model does the work.** commitlint rejects two ticket tags in one subject and warns on a body line that starts a word then a colon.
- **No automated tests in v1** (`docs/PRD.md` §20). **This overrides the TDD structure the writing-plans skill normally imposes.** Every red/green cycle is a measurement against the running stack.
- **`capturedOn` is derived in UTC**, once per job, and every snapshot row in one job shares it. Local time would make "a day" mean different things on different machines and the cap would admit a second row the first time a clock crossed a DST boundary.
- **A currency the provider did not return is written as `null`**, never zero and never the previous value.
- **A card the provider returned nothing at all for is not touched** — not the columns, not `priceUpdatedAt`, not a snapshot.
- **A 429 never reaches the breaker.** Only `ProviderUnavailableError` and `ProviderContractError` do.
- **Cache deletes happen after the transaction commits**, never inside it.
- **Per-card keys only.** Never `cachePatterns.allPrices()` — a batch of 100 must not flush the other 20 570 cards.
- **ESM.** Relative imports inside `apps/api` carry the `.js` extension or the build fails.
- **Every commit compiles.** `pnpm typecheck`, `pnpm lint` and `pnpm format:check` pass from the repository root before each one.
- **Verified claims only.** If a measurement contradicts the spec, report the contradiction rather than adjusting the claim to fit.

### Shared shell setup

```bash
cd /m/projects/pokedrop
PSQL="docker compose exec -T postgres psql -U pokedrop -d pokedrop"
REDIS="docker compose exec -T redis redis-cli -n 0"
```

`docker compose ps` must show postgres and redis healthy. `$PSQL -tAc "SELECT count(*) FROM cards"` must return **20670** and `$PSQL -tAc "SELECT count(*) FROM price_snapshots"` must return **0**. A non-empty snapshot table means someone has run this before and Task 1's migration is no longer operating on the clean table this plan assumes — stop and report it.

### Four traps that have already cost time on this project

**A probe that imports project code must live inside `apps/api`.** Node resolves bare imports relative to the file and pnpm keeps packages under `apps/api/node_modules`. `apps/api/dist/` is gitignored and is the right home.

**`pnpm build` deletes `dist/`, and your probe with it.** Write the probe *after* building, not before.

**A probe that boots `WorkerModule` will not exit on its own** once it has consumed a job — `app.close()` drains the job in flight. Every probe in this plan ends with `process.exit(0)` or polls for a terminal condition and then exits. Three processes were left running for hours across PD-40 and PD-43 before this was written down; do not add a fourth.

**After `prisma migrate dev`, run `pnpm exec prisma generate` in `apps/api`** if the types do not update. A stale client produces `Unsafe assignment of an error typed value` from lint, which looks like a code fault and is not.

### Live values these steps assert against

Measured 2026-09-21. Re-measure if a step disagrees rather than editing the expectation.

- the mirror holds **20 670** cards; `price_snapshots` is **empty**
- `latestPriceUsd` is set on **12** cards, `latestPriceEur` on **none**
- pokemontcg returns **two points per card** — `TCGPLAYER`/USD and `CARDMARKET`/EUR
- a batch of **100** cards takes about **3.9 s**; 250 takes **19.2 s**
- `base1-4` (Charizard) is priced by both providers and is a good single-card probe

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/api/prisma/schema.prisma` | **modified** — `capturedOn` and the unique index that makes the cap an invariant |
| `apps/api/src/sync/price.writer.ts` | the two writes, so the processor reads as a sequence rather than as SQL |
| `apps/api/src/sync/price-sync.processor.ts` | the job: select a provider, fetch, group, write, invalidate |
| `apps/api/src/sync/sync.module.ts` | **modified** — register both |
| `apps/api/src/sync/index.ts` | **modified** — export the job type, which PD-49, PD-50 and PD-52 all speak |
| `docs/DataModel.md` | **modified** — correct the claim that this cap cannot live in the schema |
| `apps/api/src/sync/README.md`, `docs/Architecture.md` | **modified** — the write path, measured |

`price.writer.ts` sits where `catalog.writer.ts` sits — the place writes live — without mirroring its raw SQL, which exists for a conditional-update guard this path does not need.

### Task order

Task 1 → 2 → 3 → 4, strictly. Task 2's writer inserts the column Task 1 adds; Task 3 injects Task 2's writer.

---

## Task 1: The migration that makes the cap an invariant

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

**Interfaces:**
- Produces: `PriceSnapshot.capturedOn` (a `DateTime @db.Date`) and a unique constraint on `(cardId, source, capturedOn)` that later tasks rely on for `skipDuplicates`

- [ ] **Step 1: Add the column and the index**

In `apps/api/prisma/schema.prisma`, in `model PriceSnapshot`, add `capturedOn` directly beneath `capturedAt`, and the unique index beside the existing `@@index`:

```prisma
  capturedAt DateTime

  /// The UTC day of `capturedAt`, materialised so the one-snapshot-per-card-
  /// per-day cap can be a unique index instead of a convention.
  ///
  /// docs/DataModel.md used to say this cap could not live in the schema,
  /// because expressing it needs an index over `capturedAt::date` and Prisma
  /// cannot declare expression indexes. That is true and it is not the only
  /// way to state the constraint: materialise the day and the index becomes an
  /// ordinary composite one that Prisma declares natively, with no drift.
  ///
  /// Derived in UTC by the price sync processor. Prisma has no generated
  /// columns, so nothing in the database enforces that it matches
  /// `capturedAt` - the processor is the only writer, and it computes both
  /// from one instant per job.
  capturedOn DateTime @db.Date

  card Card @relation(fields: [cardId], references: [id], onDelete: Cascade)

  @@unique([cardId, source, capturedOn])
  @@index([cardId, capturedAt])
  @@map("price_snapshots")
```

Leave `@@index([cardId, capturedAt])` in place. It serves PD-51's 30-day sparkline read; the new unique index serves writes and does not replace it.

- [ ] **Step 2: Generate the migration**

```bash
cd apps/api && pnpm exec prisma migrate dev --name price_snapshot_daily_cap; cd ..
```

The table is empty, so this needs no backfill and Prisma should not prompt about data loss. If it does prompt, stop and report it — that would mean the table is not empty and this plan's assumptions do not hold.

```bash
cd apps/api && pnpm exec prisma generate; cd ..
```

- [ ] **Step 3: Confirm the constraint exists and actually refuses a duplicate**

This is the step that distinguishes what was built from the alternative it replaced. A guard in application code would pass every other check in this plan and fail this one.

```bash
$PSQL -c "\d price_snapshots"
```

Expected: a `capturedOn` column of type `date`, and a unique index on
`("cardId", source, "capturedOn")`.

```bash
$PSQL -c "
INSERT INTO price_snapshots (id, \"cardId\", source, currency, market, low, mid, high, \"capturedAt\", \"capturedOn\")
VALUES ('probe-1', 'base1-4', 'TCGPLAYER', 'USD', 10.00, 9.00, 10.00, 11.00, now(), current_date);
INSERT INTO price_snapshots (id, \"cardId\", source, currency, market, low, mid, high, \"capturedAt\", \"capturedOn\")
VALUES ('probe-2', 'base1-4', 'TCGPLAYER', 'USD', 99.00, 98.00, 99.00, 100.00, now(), current_date);
"
```

Expected: the first succeeds, **the second fails** with
`duplicate key value violates unique constraint`. Record the error verbatim.

Then confirm the constraint is scoped correctly — a different source on the same
day is a different series and must be allowed:

```bash
$PSQL -c "
INSERT INTO price_snapshots (id, \"cardId\", source, currency, market, low, mid, high, \"capturedAt\", \"capturedOn\")
VALUES ('probe-3', 'base1-4', 'CARDMARKET', 'EUR', 8.00, 7.00, 8.00, 9.00, now(), current_date);
SELECT id, source, \"capturedOn\" FROM price_snapshots ORDER BY id;
DELETE FROM price_snapshots WHERE id LIKE 'probe-%';
SELECT count(*) AS must_be_zero FROM price_snapshots;
"
```

Expected: `probe-3` **succeeds**, the select shows `probe-1` and `probe-3`, and
the table is empty again afterwards. A constraint that refused `probe-3` would
be over-tight and would cap a card at one price a day across both marketplaces.

- [ ] **Step 4: Gates and commit**

```bash
pnpm -s typecheck && pnpm -s lint && pnpm -s format:check
```

```bash
git add apps/api/prisma/
git commit -F - <<'EOF'
[PD-48]: make the one-snapshot-per-day cap a database invariant

DataModel.md said this could not live in the schema: expressing it needs an
index over capturedAt::date and Prisma cannot declare expression indexes. The
premise holds, the conclusion does not - materialising the day as a capturedOn
date column makes the index an ordinary composite one, declared natively.

A guard in the processor would close the sequential case and not the
concurrent one, and QUEUE_CONCURRENCY=4 already sits in .env waiting to be
wired up. The table is empty today, so this is the cheapest it will ever be.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 2: The writer

**Files:**
- Create: `apps/api/src/sync/price.writer.ts`

**Interfaces:**
- Consumes: `TransactionClient` from `../prisma/index.js`; `PriceSource` from `@prisma/client`
- Produces:
  - `startOfUtcDay(at: Date): Date`
  - `interface LatestPrice { cardId: string; usd: number | null; eur: number | null; capturedAt: Date }`
  - `interface SnapshotRow { cardId: string; source: PriceSource; currency: string; market: number | null; low: number | null; mid: number | null; high: number | null; capturedAt: Date; capturedOn: Date }`
  - `class PriceWriter` with `updateLatest(tx, rows: LatestPrice[]): Promise<number>` and `insertSnapshots(tx, rows: SnapshotRow[]): Promise<number>`

- [ ] **Step 1: Write the writer**

Create `apps/api/src/sync/price.writer.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { PriceSource } from '@prisma/client';
import type { TransactionClient } from '../prisma/index.js';

export interface LatestPrice {
  cardId: string;
  usd: number | null;
  eur: number | null;
  capturedAt: Date;
}

export interface SnapshotRow {
  cardId: string;
  source: PriceSource;
  currency: string;
  market: number | null;
  low: number | null;
  mid: number | null;
  high: number | null;
  capturedAt: Date;
  capturedOn: Date;
}

/**
 * The UTC day `at` falls in.
 *
 * UTC rather than local time is load-bearing. `capturedOn` is half of the
 * unique key that caps a card at one snapshot per source per day, so if two
 * processes disagreed about where a day begins the cap would admit a second
 * row - and they would disagree the first time a server moved timezone or a
 * clock crossed a DST boundary.
 */
export function startOfUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/**
 * Where the price path writes. The sibling `catalog.writer.ts` is raw SQL
 * because a conditional-update upsert has no Prisma equivalent; nothing here
 * has that shape, so this one is ordinary Prisma.
 */
@Injectable()
export class PriceWriter {
  /**
   * One UPDATE per card rather than a single statement over a VALUES list.
   *
   * A price genuinely changes, so unlike the catalog sweep there is nothing to
   * guard against here - no dead tuples to avoid, no reason to compare before
   * writing. At a batch of 100 inside one transaction this is 100 statements on
   * an already-open connection, which the provider call in front of it dwarfs.
   */
  async updateLatest(tx: TransactionClient, rows: LatestPrice[]): Promise<number> {
    let written = 0;

    for (const row of rows) {
      await tx.card.update({
        where: { id: row.cardId },
        data: {
          latestPriceUsd: row.usd,
          latestPriceEur: row.eur,
          priceUpdatedAt: row.capturedAt,
        },
      });

      written += 1;
    }

    return written;
  }

  /**
   * `skipDuplicates` is the whole cap.
   *
   * It compiles to ON CONFLICT DO NOTHING against the unique index on
   * (cardId, source, capturedOn), so a second run on the same day inserts
   * nothing and raises nothing - the database decides, not a check in front of
   * the write, and two concurrent workers get the same answer as one.
   */
  async insertSnapshots(tx: TransactionClient, rows: SnapshotRow[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    const result = await tx.priceSnapshot.createMany({ data: rows, skipDuplicates: true });
    return result.count;
  }
}
```

- [ ] **Step 2: Confirm `skipDuplicates` compiles to what the cap needs**

`skipDuplicates` is supported by Prisma on PostgreSQL and not on every
connector, and this plan rests on it. Measure rather than assume.

```bash
pnpm -s typecheck && pnpm -s build
```

```bash
cat > apps/api/dist/writer-probe.mjs <<'EOF'
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';
import { PrismaService } from './prisma/index.js';
import { PriceWriter, startOfUtcDay } from './sync/price.writer.js';

const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error'] });
const prisma = app.get(PrismaService);
const writer = new PriceWriter();

const at = new Date();
const on = startOfUtcDay(at);
console.log('capturedAt        :', at.toISOString());
console.log('capturedOn        :', on.toISOString(), '| must be midnight UTC');

const row = {
  cardId: 'base1-4', source: 'TCGPLAYER', currency: 'USD',
  market: 882.02, low: 449.99, mid: 859.1, high: 3499.1,
  capturedAt: at, capturedOn: on,
};

const first = await prisma.withTransaction((tx) => writer.insertSnapshots(tx, [row]));
const second = await prisma.withTransaction((tx) => writer.insertSnapshots(tx, [row]));
console.log('first insert wrote:', first, '| expect 1');
console.log('second insert wrote:', second, '| expect 0, and no error thrown');

const stored = await prisma.priceSnapshot.findFirst({ where: { cardId: 'base1-4' } });
console.log('stored market     :', String(stored.market), '| expect exactly 882.02');
console.log('stored capturedOn :', stored.capturedOn.toISOString());

const updated = await prisma.withTransaction((tx) =>
  writer.updateLatest(tx, [{ cardId: 'base1-4', usd: 882.02, eur: null, capturedAt: at }]),
);
const card = await prisma.card.findUnique({ where: { id: 'base1-4' } });
console.log('updateLatest wrote:', updated, '| usd', String(card.latestPriceUsd),
  '| eur', card.latestPriceEur, '| expect 882.02 and null');

await prisma.priceSnapshot.deleteMany({ where: { cardId: 'base1-4' } });
await prisma.card.update({
  where: { id: 'base1-4' },
  data: { latestPriceUsd: null, latestPriceEur: null, priceUpdatedAt: null },
});
console.log('cleaned up        :', await prisma.priceSnapshot.count(), 'snapshots left');
process.exit(0);
EOF
cd apps/api && node dist/writer-probe.mjs; cd ..
```

Expected, and each line is a separate claim this plan makes:

- `capturedOn` prints as `T00:00:00.000Z` — midnight **UTC**, not local midnight
- the first insert writes **1**
- **the second writes 0 and throws nothing** — `skipDuplicates` really is
  `ON CONFLICT DO NOTHING` here, which is the cap
- the stored market reads back as exactly **882.02**, with no float tail
- `updateLatest` writes 1, leaving `usd` at 882.02 and **`eur` null**
- the table is empty again at the end

If the second insert throws instead of returning 0, `skipDuplicates` is not
doing what this plan assumes on this connector — stop and report it rather than
wrapping the call in a try/catch.

- [ ] **Step 3: Gates and commit**

```bash
rm -f apps/api/dist/writer-probe.mjs
pnpm -s typecheck && pnpm -s lint && pnpm -s format:check
```

```bash
git add apps/api/src/sync/price.writer.ts
git commit -F - <<'EOF'
[PD-48]: write latest prices and append a capped daily snapshot

skipDuplicates against the new unique index is the entire cap: the database
decides, so a second run in a day inserts nothing and two concurrent workers
get the same answer as one.

Unlike the catalog sweep there is nothing to guard against on the card update
- a price genuinely changes - so this writer is ordinary Prisma rather than
the raw SQL its sibling needs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 3: The processor

**Files:**
- Create: `apps/api/src/sync/price-sync.processor.ts`
- Modify: `apps/api/src/sync/sync.module.ts`
- Modify: `apps/api/src/sync/index.ts`

**Interfaces:**
- Consumes: `PriceWriter`, `LatestPrice`, `SnapshotRow`, `startOfUtcDay`; `ProviderSelectorService`, `ProviderBreakerService`, `ProviderContractError`, `ProviderUnavailableError`, `PriceDTO` from `./providers/index.js`; `CacheService`, `cacheKeys`; `PrismaService`; `QUEUE`
- Produces: `interface PriceSyncJob { cardIds: string[] }`, exported from `sync/index.ts` for PD-49, PD-50 and PD-52

- [ ] **Step 1: Write the processor**

Create `apps/api/src/sync/price-sync.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { PriceSource } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/index.js';
import { QUEUE } from '../queue/index.js';
import { CacheService, cacheKeys } from '../redis/index.js';
import {
  ProviderBreakerService,
  ProviderContractError,
  ProviderSelectorService,
  ProviderUnavailableError,
  type CardSourceName,
  type PriceDTO,
} from './providers/index.js';
import { PriceWriter, startOfUtcDay, type LatestPrice, type SnapshotRow } from './price.writer.js';

/**
 * The contract three producers speak: PD-49 enqueues batches covering the
 * catalog, PD-50 the active set, PD-52 a single card. All the selection logic
 * lives in the schedules; this processor is handed ids and does not choose
 * them.
 */
export interface PriceSyncJob {
  cardIds: string[];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@Processor(QUEUE.priceSync)
export class PriceSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(PriceSyncProcessor.name);

  constructor(
    private readonly selector: ProviderSelectorService,
    private readonly breaker: ProviderBreakerService,
    private readonly prisma: PrismaService,
    private readonly writer: PriceWriter,
    private readonly cache: CacheService,
  ) {
    super();
  }

  async process(job: Job<PriceSyncJob>): Promise<void> {
    const { cardIds } = job.data;

    if (cardIds.length === 0) {
      return;
    }

    const choice = await this.selector.select();
    const provider = choice.provider;

    const points = await this.fetch(provider.name, () => provider.fetchPrices(cardIds));
    await this.breaker.recordSuccess(provider.name);

    // One instant for the whole job, so every row shares a day by
    // construction. The DTO carries its own capturedAt from the moment the
    // client made the call; the difference is milliseconds, and one value here
    // is what keeps `capturedOn` consistent across the batch.
    const capturedAt = new Date();
    const capturedOn = startOfUtcDay(capturedAt);

    const byCard = new Map<string, PriceDTO[]>();
    for (const point of points) {
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
      // A currency this response did not carry becomes null rather than
      // keeping its previous value. There is one priceUpdatedAt for both
      // columns, so a stale EUR beside a fresh USD would make that timestamp
      // true of one and false of the other with no way to tell which.
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
    // touched at all - not its columns, not its timestamp, not a snapshot.
    // That is the difference between "no new price" and "the price is now
    // nothing", and it is why this loop runs over the response rather than
    // over cardIds.
    const written = await this.prisma.withTransaction(async (tx) => {
      const cards = await this.writer.updateLatest(tx, updates);
      const rows = await this.writer.insertSnapshots(tx, snapshots);
      return { cards, rows };
    });

    // After the commit, never inside it: a Redis round trip inside an open
    // transaction holds row locks for the length of a network call.
    //
    // Per card, never cachePatterns.allPrices() - a batch of 100 must not
    // flush the other 20 570 cards' prices.
    await this.cache.del(...updates.map((update) => cacheKeys.cardPrice(update.cardId)));

    this.logger.log(
      `job ${job.id}: ${cardIds.length} asked, ${byCard.size} priced by ${provider.name}, ` +
        `${written.cards} cards updated, ${written.rows} snapshots written`,
    );
  }

  /**
   * Only ProviderUnavailableError and ProviderContractError feed the breaker.
   * A ProviderRateLimitError says the upstream is healthy and we are asking too
   * fast; counting it would move load onto the fallback and rate-limit that one
   * too. The same rule sync/README.md and http.ts already state.
   */
  private async fetch(
    name: CardSourceName,
    call: () => Promise<PriceDTO[]>,
  ): Promise<PriceDTO[]> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof ProviderUnavailableError || error instanceof ProviderContractError) {
        const count = await this.breaker.recordFailure(name);
        this.logger.warn(`price fetch failed (${count} consecutive) - ${describe(error)}`);
      } else {
        this.logger.warn(`price fetch failed locally - ${describe(error)}`);
      }

      throw error;
    }
  }
}
```

- [ ] **Step 2: Register it**

In `apps/api/src/sync/sync.module.ts`, import both classes and add them to
`providers`. Add `PriceWriter` to `exports` beside `CatalogWriter`; the
processor is discovered by BullMQ's explorer and does not need exporting.

Update the module's doc comment — it currently reads "Processors arrive with
the tickets that own them: PD-42 (catalog sync), PD-48 (price sync), PD-74
(trade expiry)". PD-48 is no longer pending, so remove it from that list.

In `apps/api/src/sync/index.ts`, add:

```ts
export type { PriceSyncJob } from './price-sync.processor.js';
export { PriceWriter, startOfUtcDay } from './price.writer.js';
export type { LatestPrice, SnapshotRow } from './price.writer.js';
```

- [ ] **Step 3: Measure the whole path against the live provider**

```bash
pnpm -s typecheck && pnpm -s lint && pnpm -s build
```

```bash
cat > apps/api/dist/price-sync-probe.mjs <<'EOF'
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';
import { PrismaService } from './prisma/index.js';
import { QUEUE } from './queue/index.js';
import { getQueueToken } from '@nestjs/bullmq';
import { RedisService } from './redis/index.js';

const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['log','warn','error'] });
const prisma = app.get(PrismaService);
const redis = app.get(RedisService).client;
const queue = app.get(getQueueToken(QUEUE.priceSync));

const ids = (await prisma.card.findMany({ where: { setId: 'base1' }, select: { id: true }, take: 100 })).map(c => c.id);
console.log('batch size        :', ids.length);

// A card the probe can watch for the untouched rule: give it a distinctive
// price and an old timestamp, then check it survives if unpriced.
await redis.set('cache:price:card:' + ids[0], 'sentinel');
await redis.set('cache:price:card:base2-1', 'neighbour');

const t0 = Date.now();
const job = await queue.add('price-sync', { cardIds: ids });

const settled = async () => {
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    const state = await job.getState();
    if (state === 'completed' || state === 'failed') return state;
    if (Date.now() - t0 > 300000) return 'timeout';
  }
};
console.log('first run         :', await settled(), `in ${Date.now() - t0}ms`);

const count1 = await prisma.priceSnapshot.count();
const priced = await prisma.card.count({ where: { id: { in: ids }, priceUpdatedAt: { not: null } } });
console.log('snapshots         :', count1);
console.log('cards with a price:', priced, 'of', ids.length);
console.log('sentinel key      :', await redis.get('cache:price:card:' + ids[0]), '| expect null');
console.log('neighbour key     :', await redis.get('cache:price:card:base2-1'), '| expect neighbour');

const sample = await prisma.card.findFirst({ where: { id: { in: ids }, latestPriceUsd: { not: null } } });
console.log('sample card       :', sample.id, '| usd', String(sample.latestPriceUsd),
  '| eur', String(sample.latestPriceEur), '| at', sample.priceUpdatedAt.toISOString());

// Second run, same day: the cap.
const before = sample.priceUpdatedAt.getTime();
const t1 = Date.now();
const job2 = await queue.add('price-sync', { cardIds: ids });
for (;;) {
  await new Promise((r) => setTimeout(r, 2000));
  const s = await job2.getState();
  if (s === 'completed' || s === 'failed') { console.log('second run        :', s, `in ${Date.now()-t1}ms`); break; }
  if (Date.now() - t1 > 300000) { console.log('second run        : timeout'); break; }
}

const count2 = await prisma.priceSnapshot.count();
const again = await prisma.card.findUnique({ where: { id: sample.id } });
console.log('snapshots after   :', count2, `| expect exactly ${count1}`);
console.log('priceUpdatedAt    :', again.priceUpdatedAt.toISOString(), '| expect LATER than', new Date(before).toISOString());

const perCard = await prisma.priceSnapshot.groupBy({
  by: ['cardId'], _count: true, orderBy: { _count: { cardId: 'desc' } }, take: 1,
});
console.log('max rows for one card today:', perCard[0]?._count, '| expect at most 2, one per source');

await redis.del('cache:price:card:base2-1');
process.exit(0);
EOF
cd apps/api && node dist/price-sync-probe.mjs 2>&1 | grep -vE "^\[Nest\] .*(InstanceLoader|NestFactory)"; cd ..
```

Expected, and each maps to something the ticket claims:

- both runs report **completed**
- **`snapshots after` equals `snapshots` exactly** — the first acceptance
  criterion, and the measurement the whole Task 1 migration exists for
- **`priceUpdatedAt` moves on the second run** — the cap is on history, not on
  freshness
- **the sentinel key is gone and the neighbour key survives** — the second
  acceptance criterion, and the proof that this deletes per card rather than by
  pattern
- **max rows for one card today is at most 2**, one per source
- a sample card carries both currencies, and the batch of 100 completes in a
  time near the 3.9 s the provider call was measured at plus the writes

- [ ] **Step 4: Check the untouched rule and restore the mirror**

The third acceptance criterion needs a card the provider prices for nobody.
Find one from the run just made:

```bash
$PSQL -c "
SELECT count(*) AS asked_but_unpriced FROM cards
WHERE \"setId\" = 'base1' AND \"priceUpdatedAt\" IS NULL;
SELECT id, \"latestPriceUsd\", \"latestPriceEur\", \"priceUpdatedAt\" FROM cards
WHERE \"setId\" = 'base1' AND \"priceUpdatedAt\" IS NULL LIMIT 3;
"
```

Any row listed was asked for and came back unpriced, and its three columns are
still `NULL` — untouched, exactly as the criterion requires. If the count is 0,
every `base1` card was priced; say so and note that this criterion was checked
by the absent-currency case in Task 2 instead.

Then put the mirror back the way this plan found it:

```bash
$PSQL -c "
DELETE FROM price_snapshots;
UPDATE cards SET \"latestPriceUsd\" = NULL, \"latestPriceEur\" = NULL, \"priceUpdatedAt\" = NULL
  WHERE \"priceUpdatedAt\" IS NOT NULL;
SELECT count(*) AS snapshots, (SELECT count(*) FROM cards WHERE \"priceUpdatedAt\" IS NOT NULL) AS priced
FROM price_snapshots;
"
```

Both must read 0. PD-49 is what fills this table for real; leaving one batch of
`base1` behind would make its first measurement ambiguous.

- [ ] **Step 5: Gates and commit**

```bash
rm -f apps/api/dist/price-sync-probe.mjs
pnpm -s typecheck && pnpm -s lint && pnpm -s format:check
```

```bash
git add apps/api/src/sync/
git commit -F - <<'EOF'
[PD-48]: process a batch of card ids into prices and snapshots

The processor is handed ids and does not choose them - PD-49, PD-50 and PD-52
are three producers over this one consumer, and all the selection logic stays
in the schedules.

A card absent from the provider's response is absent from the writes: not its
columns, not its timestamp, not a snapshot. A currency the response did not
carry becomes null, because one priceUpdatedAt cannot be true of a fresh
column and a stale one at the same time.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 4: Documentation

**Files:**
- Modify: `docs/DataModel.md`
- Modify: `apps/api/src/sync/README.md`
- Modify: `docs/Architecture.md`

- [ ] **Step 1: Correct `docs/DataModel.md`**

The PriceSnapshot section currently says the cap "is enforced by the price sync
job, not by the schema" and explains why it cannot be otherwise. That is now
false. Replace that paragraph with:

```markdown
The **≤ 1 snapshot/card/day** cap is a unique index on
`(cardId, source, capturedOn)`, where `capturedOn` is the UTC day of
`capturedAt`, materialised as a `date` column.

This section used to say the cap could not live in the schema, because
expressing it needs a unique index over `capturedAt::date` and Prisma cannot
declare expression indexes. The premise is true; the conclusion was not.
Materialising the day makes the index an ordinary composite one, which Prisma
declares natively — no hand-written SQL, no drift, nothing for a later
`migrate dev` to try to drop.

Prisma has no generated columns, so nothing in the database forces `capturedOn`
to agree with `capturedAt`. The price sync processor is the only writer and
derives both from one instant per job. **In UTC** — local time would make a day
mean different things on different machines, and the cap would admit a second
row the first time a clock crossed a DST boundary.

The cap is on history, not on freshness: a second run the same day writes no
snapshot and still refreshes `latestPriceUsd`, `latestPriceEur` and
`priceUpdatedAt`.
```

Also update the **Index** line of that section so it names both indexes, and
keep the existing note that the table is the fastest-growing in the system —
the growth is now bounded at two rows per card per day by a constraint rather
than by a job behaving correctly.

- [ ] **Step 2: Add the write path to the sync README**

The module doc lists processors that arrive with their tickets. Append a section
after the failover material, using the numbers Task 3 actually printed:

```markdown
## The price write path

`price-sync.processor.ts` on `QUEUE.priceSync`. It is handed card ids and does
not choose them — PD-49 enqueues batches covering the catalog, PD-50 the active
set, PD-52 a single card. Three producers, one consumer.

### Per batch

1. Ask the selector for a provider — the same breaker the catalog sync feeds.
2. `fetchPrices(cardIds)` once for the whole batch.
3. `UPDATE cards` for every card the response carried.
4. `createMany` the snapshots with `skipDuplicates`.
5. `DEL cache:price:card:{id}` per card, **after the commit**.

**Batch size is 100.** Measured against the primary: 100 cards in 3.9 s, 250 in
19.2 s — five times the wall clock for two and a half times the work, because
the provider's `OR`-query cost grows faster than linearly. At 100 the catalog is
207 jobs and a failed one costs 100 cards.

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
none, and not by carefulness: it only ever `UPDATE`s rows whose ids came out of
our own database and never inserts a card.

**The known cost of a fallback price run:** TCGdex cannot address roughly 10–15%
of our card ids — the zero-padding divergence PD-43 documents. Measured: 8 of 10
`sv10` cards priced, against 10 of 10 from the primary. Those cards keep their
previous values, which is indistinguishable from "the provider has no price for
this card". Recorded rather than solved, for the same reason the id translation
table was rejected twice.

### Measured
```

Fill this table in with what Task 3's probe actually printed. Leave no row
blank — a row with no measurement behind it is what this table exists to
prevent:

```markdown
| Measured | Result |
| --- | --- |
| batch size, elapsed for the first run | |
| cards asked / cards the provider priced | |
| snapshots after the first run | |
| snapshots after a second run the same day | |
| `priceUpdatedAt` on the second run | |
| sentinel cache key on a written card | |
| neighbouring card's cache key | |
| maximum snapshot rows for one card in a day | |
| a sample card's USD and EUR | |
```

- [ ] **Step 3: Update `docs/Architecture.md` §7**

Section 7 describes the write path per card in prose. Add one sentence to it
recording that the snapshot cap is now a unique index on
`(cardId, source, capturedOn)` rather than a job behaviour, and that a second
run in a day still refreshes the card's latest columns.

- [ ] **Step 4: Format, gate and commit**

```bash
pnpm -s format && pnpm -s format:check && pnpm -s typecheck && pnpm -s lint
```

```bash
git add docs/DataModel.md docs/Architecture.md apps/api/src/sync/README.md
git commit -F - <<'EOF'
[PD-48]: document the price write path and correct the datamodel claim

DataModel.md said the daily snapshot cap could not live in the schema. It can,
and now does - the section explains why the original reasoning was true about
expression indexes and wrong about the constraint.

Also records the two rules that look alike and are not: an absent currency
becomes null, an absent card is not touched at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git push origin dev
```

---

## Acceptance criteria

- [ ] **Running the job twice in one day creates exactly one snapshot per card.** Task 3 Step 3 measures it over a batch of 100, and Task 1 Step 3 proves the database is what refuses the second row rather than a check in the processor.
- [ ] **A price write invalidates that card's price cache key.** Task 3 Step 3: a sentinel key on a written card is gone and a neighbouring card's key survives.
- [ ] **A card the provider has no price for keeps its previous values and stale timestamp.** Task 3 Step 4, against cards asked for and returned unpriced.

## Out of scope

| Not here | Where |
| --- | --- |
| Deciding which cards to refresh | PD-49 (nightly), PD-50 (active), PD-52 (on demand) |
| Recording a sweep as a `SyncRun` | PD-49 — one nightly sweep is 207 jobs, and a row each would bury the table the admin endpoint reads |
| Reading prices back, sparklines, `Decimal` → number at the API boundary | PD-51 |
| A per-card cooldown | PD-52 |
| Partitioning or downsampling the series | not in v1; `docs/DataModel.md` names it as the growth plan |
| Filling `tcgplayerId` / `cardmarketId` | null on all 20 670 rows; a separate decision |
