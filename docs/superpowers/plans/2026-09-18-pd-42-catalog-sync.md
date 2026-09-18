# PD-42 Catalog Sync Processor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The job that fills the mirror — 176 sets and 20 670 cards written with a guarded upsert that rewrites nothing when nothing changed, resumable after a crash, and scheduled daily.

**Architecture:** `SyncRun` is a durable row recording every run, keyed to the BullMQ job id so a retry resumes and a new job starts clean. `catalog.writer.ts` owns the only raw SQL in the module: a multi-row `INSERT … ON CONFLICT … WHERE … IS DISTINCT FROM` that leaves untouched rows alone. `catalog-sync.processor.ts` pages the provider flat, fetching each page in full before opening a transaction to write it, counting failures rather than aborting. A daily cron in the worker enqueues and does nothing else.

**Tech Stack:** NestJS 12 (ESM, `module: nodenext` — every relative import ends in `.js`), Prisma 7.10.0 with the `PrismaPg` driver adapter, `@nestjs/schedule` 12.0.2, PostgreSQL 17, BullMQ 5.81.5.

**Spec:** [`docs/superpowers/specs/2026-09-18-pd-42-catalog-sync-design.md`](../specs/2026-09-18-pd-42-catalog-sync-design.md)

## Global Constraints

- **Work directly on `dev`.** No feature branches, no pull requests.
- **Commit subjects are `[PD-42]: short lowercase description`**, no trailing period. Bodies end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Avoid a line inside the body that starts a word then a colon — commitlint reads it as a footer and warns.
- **No automated tests in v1** (`docs/PRD.md` §20). **This overrides the TDD structure the writing-plans skill normally imposes.** Every red/green cycle is a measurement against the running stack.
- **No paid services** (`docs/PRD.md` §2). A full sweep is ~275 live requests against an anonymous ceiling that cannot be observed; do not add a step that sweeps repeatedly for convenience.
- **Every commit compiles.** `pnpm typecheck` and `pnpm lint` pass from the repository root before each one.
- **ESM.** Relative imports inside `apps/api` carry the `.js` extension or the build fails.
- **Columns are quoted camelCase in raw SQL.** `"setId"`, `"printedTotal"`, `"imageSmall"`, `"nationalPokedexNumbers"`. Unquoted, PostgreSQL folds to lowercase and looks for `setid`.
- **`"updatedAt"` is set explicitly with `now()`** — Prisma's `@updatedAt` does not fire in raw SQL — **and must stay out of the comparison tuple**, or every row differs from itself and the guard is dead while still looking guarded.
- **`jsonb` values bind as `JSON.stringify(value)` with an explicit `::jsonb` cast.** Arrays bind natively. Both measured.
- **One migration only**, named for the change and not the ticket: `sync_runs`.
- **Verified claims only.** If a measurement contradicts the spec, report the contradiction rather than adjusting the claim to fit.

### Shared shell setup

```bash
cd /m/projects/pokedrop
PSQL="docker compose exec -T postgres psql -U pokedrop -d pokedrop"
RCLI="docker compose exec -T redis redis-cli -n 1"
```

`docker compose ps` must show postgres, redis and mailpit healthy before starting.

**Probes live in `apps/api/dist/`,** which is gitignored, and must sit inside `apps/api` because Node resolves bare imports relative to the file. **Build before writing a probe, never after** — `nest build` has `deleteOutDir: true` and deletes it. This bit twice during PD-41 and once during PD-39.

**A probe that boots a Nest context needs the environment.** Run it as `node --env-file=../../.env dist/probe-x.mjs` from `apps/api`, the way PD-42's binding probe was run.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/api/src/sync/sync-run.service.ts` | the `SyncRun` lifecycle — start or resume, record progress, close. The only file that touches the table. |
| `apps/api/src/sync/catalog.writer.ts` | the guarded upserts. The only raw SQL in the module. |
| `apps/api/src/sync/catalog-sync.processor.ts` | the loop, failure isolation, cache invalidation. |
| `apps/api/src/sync/catalog-sync.scheduler.ts` | the daily cron. Its body is one `queue.add`. |

Split by reason to change: the writer changes when the schema does, the run
service when the reporting needs do, the processor when the sync strategy does,
and the scheduler when the cadence does. Keeping the raw SQL in one file also
means the quoting rules live in one place rather than being re-derived.

### Task order

The schema first, because everything else references the model. Then the writer,
which is the part with the real algorithm and can be measured on its own against
seeded rows. Then the run service. The processor composes all three, and the
scheduler is last because it only enqueues what by then already works.

---

## Task 1: The `SyncRun` model and its migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_sync_runs/migration.sql` (generated)
- Modify: `docs/DataModel.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the `SyncRun` model, `SyncKind` and `SyncStatus` enums on the Prisma client. Task 3's service is the only consumer.

- [ ] **Step 1: Add the enums beside the existing ones**

`docs/Migrations.md` records the convention: all enums live together at the top
of the schema. Add these after `TransactionType`, the last one there:

```prisma
enum SyncKind {
  CATALOG
  PRICE
}

enum SyncStatus {
  RUNNING
  SUCCEEDED
  PARTIAL
  FAILED
}
```

- [ ] **Step 2: Add the model**

At the end of `apps/api/prisma/schema.prisma`:

```prisma
/// One execution of a background sync. Durable because four consumers need it:
/// PD-42 resumes from `cursor`, PD-43 records which provider served a run,
/// PD-49 reports per-run counts, and PD-81 and PD-82 read all of it.
model SyncRun {
  id     String     @id @default(cuid())
  kind   SyncKind
  /// A string rather than an enum. It records which source served the run, and
  /// a closed enum would need a migration every time a provider is added -
  /// exactly the coupling the CardSourceProvider adapter removes.
  provider String
  status SyncStatus @default(RUNNING)

  /// The BullMQ job that owns this run. Resumption is only safe when it
  /// matches: without it a fresh processor would adopt any RUNNING row it
  /// found, including one abandoned by a process that was killed a week ago.
  jobId String?

  startedAt  DateTime  @default(now())
  finishedAt DateTime?

  processed Int @default(0)
  failed    Int @default(0)

  /// Resume point. `{ "page": 12 }` for a catalog run.
  cursor Json?
  error  String?

  @@index([kind, startedAt(sort: Desc)])
  @@map("sync_runs")
}
```

- [ ] **Step 3: Generate the migration**

```bash
cd apps/api && pnpm exec prisma migrate dev --name sync_runs
cd /m/projects/pokedrop
```

Expected: a new folder under `apps/api/prisma/migrations/` whose `migration.sql`
creates two enum types and the `sync_runs` table.

- [ ] **Step 4: Confirm the table and the index landed**

```bash
$PSQL -c "\d sync_runs"
$PSQL -tAc "SELECT unnest(enum_range(NULL::\"SyncStatus\"))"
```

Expected: the table with `id`, `kind`, `provider`, `status`, `jobId`,
`startedAt`, `finishedAt`, `processed`, `failed`, `cursor`, `error`; an index on
`(kind, startedAt DESC)`; and the four status values.

Note that `id` has **no** `DEFAULT` in PostgreSQL — `@default(cuid())` is
generated by the Prisma client, per `docs/Migrations.md`. Rows must be created
through the client, never by raw `INSERT`.

- [ ] **Step 5: Document the entity**

In `docs/DataModel.md`, after the `PriceSnapshot` section, add:

```markdown
### SyncRun — *operational*

`id, kind(CATALOG|PRICE), provider, status(RUNNING|SUCCEEDED|PARTIAL|FAILED), jobId?, startedAt, finishedAt?, processed, failed, cursor(json)?, error?`
**Index:** `(kind, startedAt DESC)` — every consumer asks for the most recent run of a kind.

One row per execution of a background sync. Redis and BullMQ job state were both
considered and rejected: Redis loses the history on `docker compose down -v` and
its keys would have to live outside the `cache:` namespace or a routine
invalidation would sweep them, and BullMQ's retention is bounded so "the last
successful catalog run" is a scan there rather than a query.

`cursor` is the resume point — `{ "page": 12 }` for a catalog run. `jobId` is
what makes resuming safe: a `RUNNING` row is only continued when the BullMQ job
now executing is the one that created it, so a retry resumes and a new job starts
clean.

`provider` is a plain string on purpose. A closed enum would need a migration
every time a provider is added.
```

- [ ] **Step 6: Gates and commit**

CI runs the migration history from scratch on every push, so check it here
rather than discovering it there:

```bash
pnpm --filter @pokedrop/api exec prisma migrate diff --from-migrations ./prisma/migrations --to-schema ./prisma/schema.prisma --shadow-database-url "$DATABASE_URL" --exit-code
```

Expected: exit 0 and no diff — the schema and the migration history agree.

```bash
pnpm typecheck && pnpm lint
npx prettier --write docs/DataModel.md
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations docs/DataModel.md
git commit -F - <<'EOF'
[PD-42]: add the sync run model

One durable row per execution of a background sync. Redis and BullMQ job state
were both rejected when this was decided - Redis loses the history on a volume
drop and its keys would need to sit outside the cache namespace, and BullMQ's
retention is bounded so the last successful run is a scan there rather than a
query.

jobId is what makes resuming safe. Without it a fresh processor would adopt any
RUNNING row it found, including one abandoned by a killed process.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 2: The guarded writer

The part with the real algorithm, and the only raw SQL in the module. Measured on
seeded rows before the processor exists to call it.

**Files:**
- Create: `apps/api/src/sync/catalog.writer.ts`

**Interfaces:**
- Consumes: `PrismaService` and its `TransactionClient` type from `../prisma/index.js`; `SetDTO` and `CardDTO` from `./providers/index.js`.
- Produces: `CatalogWriter` with `upsertSets(tx, sets): Promise<number>` and `upsertCards(tx, cards): Promise<number>`, both returning the number of rows the statement actually wrote. Task 4's processor calls both.

- [ ] **Step 1: Write the writer**

Create `apps/api/src/sync/catalog.writer.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TransactionClient } from '../prisma/index.js';
import type { CardDTO, SetDTO } from './providers/index.js';

/**
 * The only raw SQL in this module.
 *
 * It is raw because Prisma has no conditional-update upsert, and the guard is
 * the entire point: `prisma.card.upsert` issues an UPDATE on conflict
 * unconditionally, which rewrites every row of a 20 670-card catalog on every
 * nightly sweep. Measured with `xmin`, which changes whenever PostgreSQL
 * rewrites a tuple - an unguarded upsert of a byte-identical payload moved it,
 * the guarded form did not.
 *
 * Three rules hold this together, and breaking any of them is silent:
 *
 * - Column names are quoted. They are camelCase in the database, so unquoted
 *   PostgreSQL folds them and looks for `setid`.
 * - `"updatedAt"` is set with now(), because Prisma's `@updatedAt` applies in
 *   its query layer and raw SQL bypasses it.
 * - `"updatedAt"` is NOT in the comparison tuple. Including it would make every
 *   row differ from itself, restoring the churn this exists to remove while the
 *   SQL still looks guarded.
 */
@Injectable()
export class CatalogWriter {
  /** jsonb has to be handed over as text with an explicit cast; a bound object does not work. */
  private json(value: unknown): Prisma.Sql {
    return Prisma.sql`${JSON.stringify(value)}::jsonb`;
  }

  async upsertSets(tx: TransactionClient, sets: SetDTO[]): Promise<number> {
    if (sets.length === 0) {
      return 0;
    }

    const values = Prisma.join(
      sets.map(
        (s) => Prisma.sql`(${s.id}, ${s.name}, ${s.series}, ${s.releaseDate},
          ${s.printedTotal}, ${s.total}, ${s.symbolUrl}, ${s.logoUrl}, now())`,
      ),
    );

    return tx.$executeRaw`
      INSERT INTO sets (id, name, series, "releaseDate", "printedTotal", "total",
        "symbolUrl", "logoUrl", "updatedAt")
      VALUES ${values}
      ON CONFLICT (id) DO UPDATE SET
        name = excluded.name,
        series = excluded.series,
        "releaseDate" = excluded."releaseDate",
        "printedTotal" = excluded."printedTotal",
        "total" = excluded."total",
        "symbolUrl" = excluded."symbolUrl",
        "logoUrl" = excluded."logoUrl",
        "updatedAt" = now()
      WHERE (sets.name, sets.series, sets."releaseDate", sets."printedTotal",
             sets."total", sets."symbolUrl", sets."logoUrl")
        IS DISTINCT FROM
            (excluded.name, excluded.series, excluded."releaseDate", excluded."printedTotal",
             excluded."total", excluded."symbolUrl", excluded."logoUrl")
    `;
  }

  async upsertCards(tx: TransactionClient, cards: CardDTO[]): Promise<number> {
    if (cards.length === 0) {
      return 0;
    }

    const values = Prisma.join(
      cards.map(
        (c) => Prisma.sql`(${c.id}, ${c.setId}, ${c.name}, ${c.supertype}, ${c.subtypes},
          ${c.hp}, ${c.types}, ${c.rarity}, ${c.retreatCost},
          ${this.json(c.weaknesses)}, ${this.json(c.resistances)}, ${this.json(c.attacks)},
          ${this.json(c.abilities)}, ${this.json(c.legalities)},
          ${c.nationalPokedexNumbers}, ${c.imageSmall}, ${c.imageLarge},
          ${c.tcgplayerId}, ${c.cardmarketId}, now())`,
      ),
    );

    // latestPriceUsd, latestPriceEur and priceUpdatedAt are absent on purpose.
    // They belong to the price path, and CardDTO has no field for them, so a
    // catalog sync cannot overwrite a fresh price with a stale one.
    return tx.$executeRaw`
      INSERT INTO cards (id, "setId", name, supertype, subtypes, hp, types, rarity,
        "retreatCost", weaknesses, resistances, attacks, abilities, legalities,
        "nationalPokedexNumbers", "imageSmall", "imageLarge", "tcgplayerId",
        "cardmarketId", "updatedAt")
      VALUES ${values}
      ON CONFLICT (id) DO UPDATE SET
        "setId" = excluded."setId",
        name = excluded.name,
        supertype = excluded.supertype,
        subtypes = excluded.subtypes,
        hp = excluded.hp,
        types = excluded.types,
        rarity = excluded.rarity,
        "retreatCost" = excluded."retreatCost",
        weaknesses = excluded.weaknesses,
        resistances = excluded.resistances,
        attacks = excluded.attacks,
        abilities = excluded.abilities,
        legalities = excluded.legalities,
        "nationalPokedexNumbers" = excluded."nationalPokedexNumbers",
        "imageSmall" = excluded."imageSmall",
        "imageLarge" = excluded."imageLarge",
        "tcgplayerId" = excluded."tcgplayerId",
        "cardmarketId" = excluded."cardmarketId",
        "updatedAt" = now()
      WHERE (cards."setId", cards.name, cards.supertype, cards.subtypes, cards.hp,
             cards.types, cards.rarity, cards."retreatCost", cards.weaknesses,
             cards.resistances, cards.attacks, cards.abilities, cards.legalities,
             cards."nationalPokedexNumbers", cards."imageSmall", cards."imageLarge",
             cards."tcgplayerId", cards."cardmarketId")
        IS DISTINCT FROM
            (excluded."setId", excluded.name, excluded.supertype, excluded.subtypes, excluded.hp,
             excluded.types, excluded.rarity, excluded."retreatCost", excluded.weaknesses,
             excluded.resistances, excluded.attacks, excluded.abilities, excluded.legalities,
             excluded."nationalPokedexNumbers", excluded."imageSmall", excluded."imageLarge",
             excluded."tcgplayerId", excluded."cardmarketId")
    `;
  }
}
```

- [ ] **Step 2: Register it**

In `apps/api/src/sync/sync.module.ts`, import `CatalogWriter` and add it to a
`providers` array (the module currently has only `imports` and `exports`):

```ts
import { CatalogWriter } from './catalog.writer.js';

@Module({
  imports: [ProvidersModule],
  providers: [CatalogWriter],
  exports: [ProvidersModule, CatalogWriter],
})
export class SyncModule {}
```

- [ ] **Step 3: Build, then probe the guard against the seeded rows**

```bash
pnpm typecheck && pnpm lint
pnpm --filter @pokedrop/shared build && pnpm --filter @pokedrop/api build
```

Create `apps/api/dist/probe-writer.mjs`:

```js
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';
import { PrismaService } from './prisma/prisma.service.js';
import { CatalogWriter } from './sync/catalog.writer.js';

const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error'] });
const prisma = app.get(PrismaService);
const writer = app.get(CatalogWriter);

const row = await prisma.$queryRaw`SELECT * FROM cards WHERE id = 'base1-4'`;
const c = row[0];
const card = {
  id: c.id, setId: c.setId, name: c.name, supertype: c.supertype,
  subtypes: c.subtypes, hp: c.hp, types: c.types, rarity: c.rarity,
  retreatCost: c.retreatCost, weaknesses: c.weaknesses, resistances: c.resistances,
  attacks: c.attacks, abilities: c.abilities, legalities: c.legalities,
  nationalPokedexNumbers: c.nationalPokedexNumbers,
  imageSmall: c.imageSmall, imageLarge: c.imageLarge,
  tcgplayerId: c.tcgplayerId, cardmarketId: c.cardmarketId,
};

const xmin = async () => {
  const r = await prisma.$queryRaw`SELECT xmin::text AS x FROM cards WHERE id = 'base1-4'`;
  return r[0].x;
};

console.log('xmin before          :', await xmin());

let written = await prisma.withTransaction((tx) => writer.upsertCards(tx, [card]));
console.log('identical payload    :', written, 'rows written | xmin', await xmin());

written = await prisma.withTransaction((tx) =>
  writer.upsertCards(tx, [{ ...card, rarity: 'Ultra Rare' }]),
);
console.log('changed rarity       :', written, 'rows written | xmin', await xmin());

written = await prisma.withTransaction((tx) =>
  writer.upsertCards(tx, [{ ...card, rarity: 'Ultra Rare' }]),
);
console.log('same change again    :', written, 'rows written | xmin', await xmin());

// Put it back, so the seed stays truthful for the next probe.
await prisma.withTransaction((tx) => writer.upsertCards(tx, [card]));
console.log('restored             : rarity is', (await prisma.$queryRaw`SELECT rarity FROM cards WHERE id='base1-4'`)[0].rarity);

await app.close();
```

- [ ] **Step 4: Run it**

```bash
( cd apps/api && node --env-file=../../.env dist/probe-writer.mjs )
```

Expected, with the exact `xmin` numbers differing run to run:

```
xmin before          : 2884
identical payload    : 0 rows written | xmin 2884
changed rarity       : 1 rows written | xmin 2887
same change again    : 0 rows written | xmin 2887
restored             : rarity is Rare Holo
```

The two lines that matter are the first and third: **0 rows written and an
unmoved `xmin` for an identical payload**, and 0 again when the same change is
replayed. A `1` on either would mean the guard is not firing — most likely
because `"updatedAt"` crept into the comparison tuple.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint
git add apps/api/src/sync/catalog.writer.ts apps/api/src/sync/sync.module.ts
git commit -F - <<'EOF'
[PD-42]: add the guarded catalog writer

Raw SQL because Prisma has no conditional-update upsert, and the guard is the
whole point. prisma.card.upsert issues an UPDATE on conflict unconditionally,
which rewrites every row of a 20 670-card catalog on every sweep.

Verified through the service against a seeded row. An identical payload wrote 0
rows and left xmin untouched, a changed rarity wrote 1 and moved it, and
replaying the same change wrote 0 again.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 3: The run service

**Files:**
- Create: `apps/api/src/sync/sync-run.service.ts`
- Modify: `apps/api/src/sync/sync.module.ts`

**Interfaces:**
- Consumes: `PrismaService`.
- Produces: `SyncRunService` with `startOrResume(kind, provider, jobId): Promise<SyncRun>`, `recordProgress(id, processed, failed, cursor): Promise<void>`, and `close(id, status, error?): Promise<void>`. Task 4's processor calls all three.

- [ ] **Step 1: Write the service**

Create `apps/api/src/sync/sync-run.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { SyncKind, SyncStatus, type SyncRun } from '@prisma/client';
import { PrismaService } from '../prisma/index.js';

export interface CatalogCursor {
  page: number;
}

@Injectable()
export class SyncRunService {
  private readonly logger = new Logger(SyncRunService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Continues the run this job already started, or begins a new one.
   *
   * The jobId match is what makes that safe. Adopting any RUNNING row would
   * mean a fresh processor picking up a run abandoned a week ago by a process
   * that was killed, and resuming from a cursor that no longer means anything.
   * A BullMQ retry keeps the same job id, so a retry resumes and a new job
   * starts clean.
   */
  async startOrResume(kind: SyncKind, provider: string, jobId: string): Promise<SyncRun> {
    const existing = await this.prisma.syncRun.findFirst({
      where: { kind, status: SyncStatus.RUNNING, jobId },
      orderBy: { startedAt: 'desc' },
    });

    if (existing) {
      this.logger.log(`Resuming sync run ${existing.id} from ${JSON.stringify(existing.cursor)}`);
      return existing;
    }

    return this.prisma.syncRun.create({ data: { kind, provider, jobId } });
  }

  /**
   * Written once per page rather than buffered. 83 small updates a sweep is
   * immaterial beside 20 670 upserts, and buffering means a crash loses exactly
   * the cursor that made resuming possible.
   */
  async recordProgress(
    id: string,
    processed: number,
    failed: number,
    cursor: CatalogCursor,
  ): Promise<void> {
    await this.prisma.syncRun.update({
      where: { id },
      data: { processed, failed, cursor },
    });
  }

  async close(id: string, status: SyncStatus, error?: string): Promise<void> {
    await this.prisma.syncRun.update({
      where: { id },
      data: { status, finishedAt: new Date(), error: error ?? null },
    });
  }

  /** Reads the cursor a resumed run left behind, defaulting to the first page. */
  readCursor(run: SyncRun): CatalogCursor {
    const cursor = run.cursor as CatalogCursor | null;
    return cursor && typeof cursor.page === 'number' ? cursor : { page: 1 };
  }
}
```

- [ ] **Step 2: Register it**

In `apps/api/src/sync/sync.module.ts`, add `SyncRunService` to `providers` and
`exports` alongside `CatalogWriter`, with the matching import.

- [ ] **Step 3: Build and probe the lifecycle**

```bash
pnpm typecheck && pnpm lint
pnpm --filter @pokedrop/api build
```

Create `apps/api/dist/probe-runs.mjs`:

```js
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';
import { PrismaService } from './prisma/prisma.service.js';
import { SyncRunService } from './sync/sync-run.service.js';

const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error'] });
const prisma = app.get(PrismaService);
const runs = app.get(SyncRunService);

const a = await runs.startOrResume('CATALOG', 'pokemontcg', 'job-1');
console.log('created        :', a.id, a.status, 'cursor', a.cursor);

await runs.recordProgress(a.id, 500, 1, { page: 3 });
const resumed = await runs.startOrResume('CATALOG', 'pokemontcg', 'job-1');
console.log('same job id    :', resumed.id === a.id ? 'RESUMED' : 'STARTED NEW - wrong', '| cursor', resumed.cursor, '| page', runs.readCursor(resumed).page);

const other = await runs.startOrResume('CATALOG', 'pokemontcg', 'job-2');
console.log('different job  :', other.id === a.id ? 'RESUMED - wrong' : 'STARTED NEW', '| page', runs.readCursor(other).page);

await runs.close(a.id, 'PARTIAL', 'one page failed');
await runs.close(other.id, 'SUCCEEDED');
const closed = await prisma.syncRun.findUnique({ where: { id: a.id } });
console.log('closed         :', closed.status, '| finishedAt set:', closed.finishedAt !== null, '| error:', closed.error);

const after = await runs.startOrResume('CATALOG', 'pokemontcg', 'job-1');
console.log('closed run     :', after.id === a.id ? 'RESUMED - wrong' : 'STARTED NEW');

await prisma.syncRun.deleteMany({ where: { id: { in: [a.id, other.id, after.id] } } });
console.log('cleaned up     :', await prisma.syncRun.count(), 'rows left');
await app.close();
```

- [ ] **Step 4: Run it**

```bash
( cd apps/api && node --env-file=../../.env dist/probe-runs.mjs )
```

Expected:

```
created        : <cuid> RUNNING cursor null
same job id    : RESUMED | cursor { page: 3 } | page 3
different job  : STARTED NEW | page 1
closed         : PARTIAL | finishedAt set: true | error: one page failed
closed run     : STARTED NEW
cleaned up     : 0 rows left
```

The third and fifth lines are the ones worth watching: a different job id must
not resume, and a closed run must not be resumed even by the job that created
it.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/sync/sync-run.service.ts apps/api/src/sync/sync.module.ts
git commit -F - <<'EOF'
[PD-42]: add the sync run service

startOrResume continues a run only when the BullMQ job now executing is the one
that created it. A fresh processor adopting any RUNNING row would resume from a
cursor belonging to a run abandoned days ago.

Progress is written once per page rather than buffered, because buffering loses
exactly the cursor that made resuming possible.

Verified. The same job id resumes and reads its cursor back, a different job id
starts fresh, and a closed run is not resumed even by its own job.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 4: The processor

**Files:**
- Create: `apps/api/src/sync/catalog-sync.processor.ts`
- Modify: `apps/api/src/sync/sync.module.ts`, `apps/api/src/worker.module.ts`

**Interfaces:**
- Consumes: `CatalogWriter` (Task 2), `SyncRunService` and `CatalogCursor` (Task 3), `CARD_SOURCE_PROVIDER` and the error classes from `./providers/index.js`, `PrismaService`, `CacheService`, `cacheKeys` and `cachePatterns` from `../redis/index.js`, `QUEUE` from `../queue/index.js`.
- Produces: `CatalogSyncProcessor`. Task 5's scheduler enqueues onto the queue it consumes.

- [ ] **Step 1: Write the processor**

Create `apps/api/src/sync/catalog-sync.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { SyncKind, SyncStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/index.js';
import { CacheService, cacheKeys, cachePatterns } from '../redis/index.js';
import { QUEUE } from '../queue/index.js';
import { CatalogWriter } from './catalog.writer.js';
import {
  CARD_SOURCE_PROVIDER,
  ProviderContractError,
  type CardSourceProvider,
} from './providers/index.js';
import { SyncRunService } from './sync-run.service.js';

const PAGE_SIZE = 250;

@Processor(QUEUE.catalogSync)
export class CatalogSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(CatalogSyncProcessor.name);

  constructor(
    @Inject(CARD_SOURCE_PROVIDER) private readonly provider: CardSourceProvider,
    private readonly prisma: PrismaService,
    private readonly writer: CatalogWriter,
    private readonly runs: SyncRunService,
    private readonly cache: CacheService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const run = await this.runs.startOrResume(SyncKind.CATALOG, this.provider.name, job.id ?? '');
    const log = (message: string): void => this.logger.log(`run ${run.id} job ${job.id}: ${message}`);

    let processed = run.processed;
    let failed = run.failed;
    let page = this.runs.readCursor(run).page;

    // Sets first, always. cards."setId" references sets(id) with onDelete
    // Restrict, so a card whose set is missing fails the insert.
    //
    // Skipped on a resume: the sets were written before the cursor advanced
    // past page 1, and re-fetching them would spend requests on a rate limit
    // we cannot observe.
    if (page === 1) {
      try {
        const sets = await this.provider.fetchSets();
        const written = await this.prisma.withTransaction((tx) =>
          this.writer.upsertSets(tx, sets),
        );
        log(`${sets.length} sets fetched, ${written} rows written`);
      } catch (error) {
        await this.runs.close(run.id, SyncStatus.FAILED, describe(error));
        throw error;
      }
    }

    for (;;) {
      let hasMore = false;

      try {
        const result = await this.provider.fetchCards({ page, pageSize: PAGE_SIZE });

        // A page is fetched in full before a transaction opens. Fetching inside
        // one would hold write locks for as long as the client spends retrying,
        // which against this upstream is seconds per page.
        const written = await this.prisma.withTransaction((tx) =>
          this.writer.upsertCards(tx, result.items),
        );

        processed += result.items.length;
        failed += result.skipped.length;
        hasMore = result.hasMore;

        for (const skip of result.skipped) {
          this.logger.warn(`run ${run.id}: card ${skip.itemId ?? '(no id)'} skipped - ${skip.message}`);
        }

        log(`page ${page}: ${result.items.length} cards, ${written} rows written, ${result.skipped.length} skipped`);
      } catch (error) {
        if (error instanceof ProviderContractError) {
          // The upstream changed shape. Continuing would fill the mirror with
          // nonsense, which is worse than stopping.
          await this.runs.close(run.id, SyncStatus.FAILED, describe(error));
          throw error;
        }

        failed += 1;
        this.logger.warn(`run ${run.id}: page ${page} failed - ${describe(error)}`);
        // Keep going. A page that exhausted its retry budget is one page, and
        // the next may well succeed - this upstream fails about 70% of
        // individual requests.
        hasMore = true;
      }

      page += 1;
      await this.runs.recordProgress(run.id, processed, failed, { page });
      await job.updateProgress({ processed, failed, page });

      if (!hasMore) {
        break;
      }
    }

    const status = failed === 0 ? SyncStatus.SUCCEEDED : SyncStatus.PARTIAL;
    await this.invalidate();
    await this.runs.close(run.id, status);
    log(`finished ${status}: ${processed} processed, ${failed} failed`);
  }

  /**
   * Only on a run that wrote something. A failed run leaves the mirror no less
   * current than it was, and flushing a warm cache to refill it with the same
   * data is a cost with no benefit.
   *
   * Prices are deliberately untouched: cachePatterns.allPrices() belongs to
   * M4's write path, and a catalog sync cannot change a price column.
   */
  private async invalidate(): Promise<void> {
    await this.cache.invalidate(cachePatterns.allSets());
    await this.cache.invalidate(cachePatterns.allCards());
    await this.cache.del(cacheKeys.facets());
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 2: Register it, and give the worker the module**

In `apps/api/src/sync/sync.module.ts`, add `CatalogSyncProcessor` to `providers`
with its import. It is not exported — nothing injects a processor.

In `apps/api/src/worker.module.ts`, add `import { SyncModule } from './sync/index.js';`
and `SyncModule` to the `imports` array. Without it the worker registers no
processor and jobs sit in `waiting` for ever.

- [ ] **Step 3: Build and run a real sync**

```bash
pnpm typecheck && pnpm lint
pnpm --filter @pokedrop/api build
$PSQL -tAc "SELECT count(*) FROM cards; SELECT count(*) FROM sets;"
$RCLI FLUSHDB
( cd apps/api && node --env-file=../../.env dist/worker.js > /tmp/pd42-sync.log 2>&1 & )
```

Create `apps/api/dist/probe-enqueue.mjs`:

```js
import { Queue } from 'bullmq';

const q = new Queue('catalog-sync', { connection: { url: 'redis://localhost:6379', db: 1 } });
const job = await q.add('catalog-sync', {});
console.log('enqueued', job.id);
await q.close();
```

```bash
sleep 8
node apps/api/dist/probe-enqueue.mjs
```

Then watch it. A full sweep is 83 pages against an upstream that fails most
requests, so expect minutes:

```bash
tail -f /tmp/pd42-sync.log
```

Expected in the log: `176 sets fetched`, then `page 1`, `page 2` … each
reporting cards written, interleaved with retry lines from PD-39's client.

- [ ] **Step 4: Confirm the mirror filled**

```bash
$PSQL -tAc "SELECT count(*) FROM sets; SELECT count(*) FROM cards;"
$PSQL -c "SELECT status, processed, failed, cursor FROM sync_runs ORDER BY \"startedAt\" DESC LIMIT 1;"
```

Expected: 176 sets, cards approaching 20 670, and one run row whose `processed`
matches the card count and whose status is `SUCCEEDED` or `PARTIAL`.

`PARTIAL` with a non-zero `failed` is a success for this ticket, not a defect —
it is the third acceptance criterion working. Record the number.

**If `failed` is 0, the criterion is not yet demonstrated.** At the measured 30%
success rate a clean sweep is unlikely, but the upstream may have recovered.
Force it rather than claiming it: point the provider at a host that does not
resolve, run one more sync, and confirm the run still closes `PARTIAL` with
`failed` above zero instead of throwing.

```bash
( cd apps/api && POKEMONTCG_BASE_URL=https://localhost:9/v2 node --env-file=../../.env dist/worker.js > /tmp/pd42-forced.log 2>&1 & )
sleep 8
node apps/api/dist/probe-enqueue.mjs
sleep 60
grep -c "failed -" /tmp/pd42-forced.log
```

Expected: repeated `page N failed` lines and a run that ends rather than
crashing. Note that the sets fetch fails first in this configuration, which
closes the run `FAILED` — that is the documented behaviour, since cards cannot
be written without their sets. To exercise the page path specifically, let a
normal run write the sets first, then restart the worker with the bad base URL
so the resumed run skips the sets fetch and fails only on pages.

- [ ] **Step 5: Run it a second time and prove nothing was rewritten**

This is the measurement the ticket's description actually specifies, and it is
stronger than "row counts identical".

```bash
$PSQL -tAc "SELECT max(xmin::text::bigint) FROM cards" > /tmp/pd42-xmin-mark
cat /tmp/pd42-xmin-mark
node apps/api/dist/probe-enqueue.mjs
```

Wait for the second run to finish, then:

```bash
MARK=$(cat /tmp/pd42-xmin-mark)
$PSQL -tAc "SELECT count(*) FROM cards WHERE xmin::text::bigint > $MARK"
$PSQL -tAc "SELECT count(*) FROM cards; SELECT count(*) FROM sets;"
```

Expected: **0** rows rewritten, and identical counts. A non-zero count means the
guard is not holding — check that `"updatedAt"` is absent from the comparison
tuple in `catalog.writer.ts`.

- [ ] **Step 6: Confirm a changed row still updates**

```bash
$PSQL -c "UPDATE cards SET rarity = 'WRONG' WHERE id = 'base1-4'"
node apps/api/dist/probe-enqueue.mjs
```

After the run:

```bash
$PSQL -tAc "SELECT rarity FROM cards WHERE id = 'base1-4'"
```

Expected: the provider's real value, not `WRONG`. The guard skips what matches
and fixes what does not.

- [ ] **Step 7: Confirm the cache was invalidated**

```bash
docker compose exec -T redis redis-cli -n 0 SET cache:sets '["warm"]'
node apps/api/dist/probe-enqueue.mjs
# after the run finishes
docker compose exec -T redis redis-cli -n 0 EXISTS cache:sets
```

Expected: `0` — the key is gone.

- [ ] **Step 8: Commit**

```bash
pnpm typecheck && pnpm lint
git add apps/api/src/sync/catalog-sync.processor.ts apps/api/src/sync/sync.module.ts apps/api/src/worker.module.ts
git commit -F - <<'EOF'
[PD-42]: add the catalog sync processor

Pages the provider flat rather than per set. Per set is roughly 590 live
requests against an anonymous ceiling we cannot observe, where flat is 275, and
every acceptance criterion survives the change.

A page is fetched in full before a transaction opens. Fetching inside one would
hold write locks for as long as the client spends retrying, which against this
upstream is seconds per page.

A page that exhausts its retries is counted and skipped, and the run finishes
PARTIAL. A ProviderContractError is different in kind and stops the run, because
the upstream changed shape and continuing would write nonsense.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 5: The daily cron

**Files:**
- Create: `apps/api/src/sync/catalog-sync.scheduler.ts`
- Modify: `apps/api/src/sync/sync.module.ts`, `apps/api/src/worker.module.ts`, `apps/api/package.json`

**Interfaces:**
- Consumes: the `catalog-sync` queue through `@InjectQueue`.
- Produces: `CatalogSyncScheduler`. Nothing consumes it.

- [ ] **Step 1: Install the scheduler**

```bash
pnpm --filter @pokedrop/api add @nestjs/schedule@12.0.2
```

Confirm `apps/api/package.json` records it as `"12.0.2"` with no caret, matching
the neighbouring pins.

- [ ] **Step 2: Write the scheduler**

Create `apps/api/src/sync/catalog-sync.scheduler.ts`:

```ts
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { QUEUE } from '../queue/index.js';

/**
 * Daily. The catalog gains a set a few times a year, so anything more frequent
 * spends a rate limit we cannot measure on data that has not changed. The job
 * is idempotent by construction, so a missed day costs nothing.
 *
 * Registered in the worker and not the API: two processes running this cron
 * would enqueue two jobs a night.
 */
@Injectable()
export class CatalogSyncScheduler {
  private readonly logger = new Logger(CatalogSyncScheduler.name);

  constructor(@InjectQueue(QUEUE.catalogSync) private readonly queue: Queue) {}

  /**
   * The entire body is an enqueue, per the rule in queue/README.md. Doing the
   * work here would run it outside the queue and lose every retry, backoff and
   * failure record the queue provides.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'catalog-sync' })
  async enqueue(): Promise<void> {
    const job = await this.queue.add('catalog-sync', {});
    this.logger.log(`Enqueued catalog sync as job ${job.id}`);
  }
}
```

- [ ] **Step 3: Register it**

In `apps/api/src/sync/sync.module.ts`, add `CatalogSyncScheduler` to `providers`
with its import.

In `apps/api/src/worker.module.ts`, add `import { ScheduleModule } from '@nestjs/schedule';`
and `ScheduleModule.forRoot()` to the `imports` array. Without it the `@Cron`
decorator is inert.

- [ ] **Step 4: Prove the cron enqueues and does not execute**

```bash
pnpm typecheck && pnpm lint
pnpm --filter @pokedrop/api build
$RCLI FLUSHDB
```

Create `apps/api/dist/probe-cron.mjs`:

```js
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';
import { CatalogSyncScheduler } from './sync/catalog-sync.scheduler.js';
import { PrismaService } from './prisma/prisma.service.js';

const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error'] });
const prisma = app.get(PrismaService);
const before = await prisma.card.count();

// Call the scheduled method directly rather than waiting until 3am.
await app.get(CatalogSyncScheduler).enqueue();

const after = await prisma.card.count();
console.log('cards before:', before, '| after:', after, '| caller wrote rows:', after !== before);
await app.close();
```

```bash
( cd apps/api && node --env-file=../../.env dist/probe-cron.mjs )
$RCLI KEYS 'bull:catalog-sync:*'
```

Expected: the caller wrote no rows, and `bull:catalog-sync:wait` exists in db 1 —
the cron enqueued and nothing else.

Note that the probe boots `WorkerModule`, which registers the processor, so the
job it enqueued will start running. Let it finish or stop the process; either
way clear the queue afterwards with `$RCLI FLUSHDB`.

- [ ] **Step 5: Confirm the cron is registered**

```bash
( cd apps/api && node --env-file=../../.env dist/worker.js > /tmp/pd42-cron.log 2>&1 & )
sleep 8
grep -c "catalog-sync" /tmp/pd42-cron.log
```

Then stop the worker. The point is that it boots with `ScheduleModule` without
error; the cron itself fires at 3am and is not waited for.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/sync/catalog-sync.scheduler.ts apps/api/src/sync/sync.module.ts apps/api/src/worker.module.ts apps/api/package.json pnpm-lock.yaml
git commit -F - <<'EOF'
[PD-42]: schedule the catalog sync daily

@nestjs/schedule arrives here rather than in PD-41, which had no schedule to
keep. The cron body is one enqueue, per the rule PD-41 wrote into the queue
README - doing the work inline would lose every retry, backoff and failure
record the queue provides.

Registered in the worker and not the API, because two processes running the same
cron would enqueue two jobs a night.

Verified. Calling the scheduled method wrote no rows from the caller and left a
job waiting in db 1.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 6: Resumption, and the documentation

**Files:**
- Modify: `apps/api/src/sync/README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the measured record.

- [ ] **Step 1: Measure resumption**

Start a sync and kill the worker part-way through, then restart it and confirm
the retried job resumes rather than restarting.

```bash
$RCLI FLUSHDB
( cd apps/api && node --env-file=../../.env dist/worker.js > /tmp/pd42-resume.log 2>&1 & )
sleep 8
node apps/api/dist/probe-enqueue.mjs
sleep 45
grep -o "page [0-9]*:" /tmp/pd42-resume.log | tail -1
$PSQL -c "SELECT status, processed, failed, cursor FROM sync_runs ORDER BY \"startedAt\" DESC LIMIT 1;"
```

Note the cursor's page, then kill the worker:

```bash
ps | grep node | awk '{print $4}' | while read -r p; do taskkill //PID "$p" //F > /dev/null 2>&1; done
```

That kills every Node process, which on this machine is the worker and nothing
else. Check with `ps | grep node` first if the API is also running.

Restart it and let BullMQ retry the interrupted job:

```bash
( cd apps/api && node --env-file=../../.env dist/worker.js > /tmp/pd42-resume2.log 2>&1 & )
sleep 60
grep -m1 "Resuming sync run" /tmp/pd42-resume2.log
grep -o "page [0-9]*:" /tmp/pd42-resume2.log | head -1
```

Expected: a `Resuming sync run` line, and the first page processed after the
restart is the one the cursor recorded — not page 1.

If BullMQ does not retry the interrupted job within the wait, check that the job
was `active` when the process died; a job killed mid-execution is recovered by
BullMQ's stalled-job check, which takes up to its stall interval.

- [ ] **Step 2: Append to the sync README**

Add to `apps/api/src/sync/README.md`. The table below records the shape of the
result rather than exact numbers, so nothing needs substituting — but if any row
of it did not hold in Task 2, fix the writer before writing it down.

```markdown
## The catalog sync

`catalog-sync.processor.ts` fills the mirror. `catalog-sync.scheduler.ts`
enqueues it daily at 3am, and its entire body is a `queue.add`.

### The guard is the whole point

`catalog.writer.ts` holds the only raw SQL in this module, because Prisma has no
conditional-update upsert and `prisma.card.upsert` issues an UPDATE on conflict
unconditionally. On a 20 670-card catalog that is 20 670 dead tuples per sweep
plus index churn, for data that changes a few times a year.

Measured with `xmin`, the transaction that last wrote a row:

| | rows written | xmin |
| --- | --- | --- |
| unguarded, identical payload | 1 | moved |
| guarded, identical payload | 0 | unmoved |
| guarded, rarity changed | 1 | moved |
| guarded, same change replayed | 0 | unmoved |

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
observed — the provider sends no headers — so the cheaper loop wins, and failure
isolation happens per page instead of per set, which is finer.

### Resumption

`SyncRun.cursor` holds `{ page }`. A run is only resumed when the BullMQ job now
executing is the one that created it, so a retry continues and a new job starts
clean. Sets are fetched only on page 1; a resumed run does not re-fetch them.

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
```

- [ ] **Step 3: Clean up, gate and commit**

```bash
rm -f apps/api/dist/probe-*.mjs
npx prettier --write apps/api/src/sync/README.md
npx prettier --check .
pnpm typecheck && pnpm lint && pnpm build
git status --short
git add apps/api/src/sync/README.md
git commit -F - <<'EOF'
[PD-42]: document the catalog sync and what it was measured to do

Leads with the guard, because it is the reason the writer is raw SQL rather than
a Prisma upsert, and because the three rules holding it together all fail
silently - quoted columns, updatedAt set with now(), and updatedAt kept out of
the comparison tuple.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git push origin dev
```

---

## Acceptance criteria

- [ ] **Running the job twice back-to-back leaves row counts identical.** Task 4 Step 5, together with the stronger measurement the ticket's description specifies — zero rows rewritten, by `xmin`.
- [ ] **Progress and last-run metrics are persisted and readable by the admin API.** `SyncRun` carries `processed`, `failed`, `status`, `startedAt`, `finishedAt` and `cursor`; Task 3 verifies the lifecycle and Task 4 Step 4 reads them back. PD-81 is what exposes them over HTTP.
- [ ] **A single failing set does not abort the entire run.** Read as failure isolation, with the page as the unit — Task 4 Step 4, a `PARTIAL` run with non-zero `failed`.

## Out of scope

Reading `SyncRun` over HTTP (PD-81) · failover between providers mid-run (PD-43) · the catalog read API (PD-45) · facet computation (PD-47) · any price write (M4) · deleting rows that vanished upstream (nothing plans it).
