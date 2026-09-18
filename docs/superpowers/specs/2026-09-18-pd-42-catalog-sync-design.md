# PD-42 — The catalog sync processor

Design, 2026-09-18. Milestone M3 · Catalog Mirror & Sync.

Ticket: [PD-42](https://linear.app/mstrilec/issue/PD-42/catalog-sync-processor-batched-upsert-of-sets-and-cards) ·
Reference: `docs/Architecture.md` §7 · `docs/PRD.md` §15.

The job that fills the mirror. Everything user-facing reads what this writes,
and until it runs the database holds twelve seeded cards instead of 20 670 real
ones.

It is the first ticket in M3 that writes to the database, the first to add a
model since M1, and the one that finally installs `@nestjs/schedule`.

---

## The measurement the ticket asked for

PD-42's description records an `xmin` experiment and ends with an instruction:
"Whichever form you choose, measure it the same way." Done, against the real
`cards` table on 2026-09-18.

```
                                                      xmin    rows
baseline                                              2758      -
unguarded ON CONFLICT DO UPDATE, identical payload    2882    INSERT 0 1
guarded   ON CONFLICT ... WHERE IS DISTINCT FROM      2882    INSERT 0 0
guarded,  rarity actually changed                     2884    INSERT 0 1
guarded,  same changed payload again                  2884    INSERT 0 0
```

`xmin` is the transaction that last wrote a row, so a change in it means
PostgreSQL rewrote the tuple. The unguarded form rewrote a row whose payload was
byte-identical. On a nightly sweep that is 20 670 dead tuples and index churn
across five indexes on `cards`, for a catalog that changes a few times a year.

The guarded form leaves an unchanged row alone and still updates a changed one.
Both directions were checked, because a guard that never fires is as wrong as
one that always does.

### The comparison has to survive jsonb and arrays

Five columns on `cards` are `jsonb` and four are arrays. If `IS DISTINCT FROM`
treated equal values as distinct on either type, the guard would fire on every
row and the whole exercise would be theatre.

```sql
'{"a":1}'::jsonb IS DISTINCT FROM '{"a":1}'::jsonb   -- f
'{"a":1}'::jsonb IS DISTINCT FROM '{"a":2}'::jsonb   -- t
ARRAY['x','y']   IS DISTINCT FROM ARRAY['x','y']     -- f
```

It behaves.

---

## What binding raw SQL through Prisma actually requires

Measured with a throwaway table and the real driver adapter, because the
combination of Prisma 7, `PrismaPg` and a multi-row `VALUES` is not something to
assume.

`Prisma.join` over an array of `Prisma.sql` fragments composes a multi-row
`VALUES` correctly, and the guard held end to end: a second run with an identical
payload reported **0 rows affected**.

Three things that are not obvious:

- **`jsonb` needs an explicit cast.** The bound value must be
  `JSON.stringify(value)` followed by `::jsonb` in the SQL. Binding a JavaScript
  object without the cast does not work.
- **Arrays bind natively.** `text[]` and `integer[]` take JS arrays directly, and
  empty arrays are fine.
- **`numeric` reads back as a string.** `1.5` returned as `"1.5"`. Nothing in
  this ticket reads those columns, but M4 writes them and will care.

### Columns are quoted camelCase

`sets` and `cards` were created without `@map` on their fields, so the real
column names are `"setId"`, `"printedTotal"`, `"imageSmall"` and
`"nationalPokedexNumbers"`. Every one has to be quoted in raw SQL; unquoted,
PostgreSQL folds to lowercase and looks for `setid`.

### `@updatedAt` does not fire in raw SQL

Prisma applies `@updatedAt` in its own query layer, which raw SQL bypasses. The
writer sets `"updatedAt" = now()` explicitly.

**And `updatedAt` must stay out of the comparison tuple.** Including it would
make every row differ from itself on every run, which restores exactly the churn
this ticket exists to remove — quietly, because the SQL would still look
guarded.

---

## Flat pagination rather than per-set

A deliberate departure from the ticket's scope line, which says "fetch cards per
set in batches".

The catalog is 20 670 cards across 176 sets. Per set that is at least 176
requests; at the 30% success rate PD-39 measured, roughly 590 with retries.
Fetched flat at 250 per page it is 83 requests, roughly 275 with retries.

`docs/PRD.md` §2 records that v1 uses no paid services, and no API key is set, so
the sync runs against the anonymous ceiling — documented at around 1 000 requests
a day and unverifiable, since the provider returns no rate-limit headers and has
never answered with a 429. A daily sweep at 590 requests would consume most of a
limit we cannot observe. At 275 it consumes roughly a quarter of it.

Three times cheaper decides it, and nothing is lost:

- **"Running the job twice back-to-back leaves row counts identical"** is a
  property of the guarded upsert, not of the loop shape.
- **"Progress and last-run metrics are persisted"** is `SyncRun`, unaffected.
- **"A single failing set does not abort the entire run"** reads as failure
  isolation. Flat pagination isolates at the page, which is finer than a set —
  a page that exhausts its retries is counted and skipped, and the run continues.

The resume unit becomes the page number, which is also a simpler cursor than a
list of outstanding set ids.

---

## `SyncRun`

The decision was taken when M3 was planned and recorded in PD-38's forward
notes; this is where it is built.

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

model SyncRun {
  id         String     @id @default(cuid())
  kind       SyncKind
  provider   String
  status     SyncStatus @default(RUNNING)
  jobId      String?
  startedAt  DateTime   @default(now())
  finishedAt DateTime?
  processed  Int        @default(0)
  failed     Int        @default(0)
  cursor     Json?
  error      String?

  @@index([kind, startedAt(sort: Desc)])
  @@map("sync_runs")
}
```

Redis and BullMQ job state were both rejected when this was decided. Redis loses
the history on `docker compose down -v`, and its keys would have to live outside
the `cache:` namespace or a routine invalidation would sweep them. BullMQ's
retention is bounded, and "the last successful catalog run" is a scan there
rather than a query.

`provider` is a plain string rather than an enum: it records which source served
a run, and PD-43 will switch mid-run. A closed enum would need a migration every
time a provider is added, which is exactly the coupling PD-38's adapter removes.

`jobId` is what makes resumption safe. Without it, a processor starting fresh
would adopt any `RUNNING` row it found — including one abandoned a week ago by a
process that was killed. The rule is: resume a `RUNNING` run only when its
`jobId` matches the job now executing. BullMQ retries keep the same id, so a
retry resumes and a new job starts clean.

---

## The processor

### The loop

1. Find or create the run. A `RUNNING` row for `CATALOG` whose `jobId` matches
   this job is resumed from its cursor; anything else starts a new run.
2. `fetchSets()` and upsert all 176. Sets first, always — `cards.setId`
   references `sets.id` with `onDelete: Restrict`, so a card whose set is
   missing fails the insert.
3. Page through cards from the cursor's page number, upserting each page and
   advancing the cursor.
4. On completion, invalidate the catalog cache and close the run.

### A transaction is never held across a network call

A page is fetched in full first, and only then is a transaction opened to write
it. The alternative — opening a transaction and fetching inside it — holds locks
for as long as PD-39's client spends retrying, which at five attempts is several
seconds of a write transaction doing nothing.

Each page's write goes through `PrismaService.withTransaction`, which
`prisma.service.ts` already establishes as the only sanctioned transaction entry
point.

### Failure isolation

A page that raises `ProviderUnavailableError` after its retry budget is counted
into `failed`, logged with the page number, and skipped; the loop continues.
Items the provider itself could not parse arrive in `CardPage.skipped` — PD-39
already separates those from a fatal envelope error — and are counted the same
way.

The run closes as:

- `SUCCEEDED` when nothing failed,
- `PARTIAL` when some pages failed and some succeeded,
- `FAILED` when the sets fetch itself failed, or every page did.

`ProviderContractError` is different in kind: the upstream changed shape, and
continuing would write nonsense. It ends the run as `FAILED` immediately.

### Progress

`processed` and `failed` are written to the run after each page, so the admin API
in PD-81 can read a live count rather than only a final one.
`job.updateProgress()` carries the same numbers into BullMQ for anything watching
the queue.

Writing the row once per page is 83 small updates per sweep — immaterial beside
the 20 670 upserts, and the alternative of buffering them means a crash loses the
progress that made the cursor worth keeping.

---

## Cache invalidation

On a run that reaches `SUCCEEDED` or `PARTIAL`, the three entries the catalog
owns: `cachePatterns.allSets()` (which matches both `cache:sets` and
`cache:set:{id}`), `cachePatterns.allCards()`, and the `facets` key.

All three have existed unused since PD-17. A `FAILED` run invalidates nothing:
the mirror is no less current than it was, and flushing a warm cache to replace
it with the same data is a cost with no benefit.

Prices are deliberately not invalidated. `cachePatterns.allPrices()` belongs to
M4's write path, and the catalog sync does not touch price columns — `CardDTO`
has no field for them, by PD-38's design.

---

## The scheduler

`@nestjs/schedule` 12.0.2 arrives here, deferred from PD-41 because that ticket
had no schedule to keep.

The cron method's entire body is a `queue.add`, per the rule PD-41 wrote into
`queue/README.md`. Doing the work inline would lose every retry, backoff and
failure record the queue provides.

Daily. The catalog gains a set a few times a year, so anything more frequent
spends a rate limit we cannot measure on data that has not changed. The job is
idempotent by construction, so a missed day costs nothing.

It registers in the worker, not the API. Two processes running the same cron
would enqueue two jobs a night.

---

## Verification plan

No automated tests. Everything below is run once, by hand, against the real
stack.

1. **A full sync populates the mirror.** Run the job; `sets` reaches 176 and
   `cards` approaches 20 670. Record how many pages failed.
2. **Running it twice leaves row counts identical** — the first acceptance
   criterion. That is weaker than what the ticket is really asking, so also:
3. **A second run rewrites no rows.** Capture the maximum `xmin` before a re-sync
   of unchanged data and confirm no row exceeds it afterwards. That is the guard
   doing its job, and it is the measurement the ticket's description specifies.
4. **A changed row still updates.** Edit one card's rarity directly in SQL,
   re-run, and confirm the provider's value wins and `xmin` moved for that row
   alone.
5. **Resumption works.** Kill the worker mid-run, restart it, and confirm the job
   resumes from the cursor rather than page 1 — visible in the log and in the
   run's `processed` count not resetting.
6. **A failing page does not abort the run.** Force failures by pointing the
   provider at an unreachable base URL partway through, and confirm the run
   finishes `PARTIAL` with `failed` greater than zero.
7. **Cache invalidation fires.** Warm `cache:sets` before the run and confirm it
   is gone afterwards.
8. **The cron enqueues rather than executes.** Trigger the scheduled method
   directly and confirm a job appears in `bull:catalog-sync:wait` while the
   caller writes no rows.
9. **Gates.** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`,
   and the migration applies from scratch.

A full sweep is roughly 275 live requests against a flaky upstream. Expect it to
take minutes and to log retries throughout; that is the system working.

---

## Files

**New**

| Path | Holds |
| --- | --- |
| `apps/api/src/sync/sync-run.service.ts` | the `SyncRun` lifecycle: start, resume, progress, close |
| `apps/api/src/sync/catalog.writer.ts` | the guarded upserts, and the only raw SQL in the module |
| `apps/api/src/sync/catalog-sync.processor.ts` | the loop, failure isolation, cache invalidation |
| `apps/api/src/sync/catalog-sync.scheduler.ts` | the daily cron that enqueues |
| `apps/api/prisma/migrations/*_sync_runs/` | the enums and the table |

**Edited**

| Path | Change |
| --- | --- |
| `apps/api/prisma/schema.prisma` | `SyncKind`, `SyncStatus`, `SyncRun` |
| `apps/api/src/sync/sync.module.ts` | register the processor, the writer, the run service, the scheduler |
| `apps/api/src/worker.module.ts` | `ScheduleModule.forRoot()` |
| `apps/api/package.json` | `@nestjs/schedule` |
| `docs/DataModel.md` | the `SyncRun` entity |
| `apps/api/src/sync/README.md` | the guard, the cursor, the measured numbers |

One migration. One dependency.

---

## Out of scope

| Not here | Where |
| --- | --- |
| Reading `SyncRun` over HTTP | PD-81, admin sync status |
| Failover between providers mid-run | PD-43 |
| The catalog read API | PD-45 |
| Facet computation | PD-47 |
| Any price write | M4 |
| Deleting sets or cards that vanished upstream | nothing plans it; the mirror only grows |

---

## Forward notes

**PD-43 will want to write `provider` per page, not per run.** The column records
one value, and a run that fails over halfway through served two. Either the
breaker records the switch in the log and `provider` means "the one it finished
with", or the column becomes a list. The simpler reading is enough until someone
needs otherwise, and PD-43 should decide explicitly rather than inherit it.

**Nothing deletes.** A set or card withdrawn upstream stays in the mirror for
ever. That is the right default — deleting a card is forbidden anyway, since
`onDelete: Restrict` protects rows that inventory references — but it means the
mirror is append-only and a mistaken upstream entry is permanent. Worth a ticket
if it ever matters.

**The anonymous rate limit is still unmeasured.** 275 requests a day is a guess
against a documented figure the provider does not expose. If a sweep ever starts
failing wholesale rather than intermittently, a 429 is the first thing to check —
and the free API key is the fix.
