# PD-81 — Admin sync control and status

Design, 2026-09-29. Milestone M10 · Admin API & Metrics.

Ticket: [PD-81](https://linear.app/mstrilec/issue/PD-81/admin-sync-control-and-status-endpoints).
It also carries two findings parked by [PD-43](https://linear.app/mstrilec/issue/PD-43/provider-failover-switch-to-fallback-after-repeated-failures)
and the sync-trigger part of [PD-79](https://linear.app/mstrilec/issue/PD-79/auditlog-writer-for-admin-and-sensitive-actions).
Reference: `docs/API.md` (Admin / Sync) · `docs/UserFlows.md` §6 · `docs/DataModel.md` (SyncRun, AuditLog) ·
`apps/api/src/queue/README.md` · `apps/api/src/sync/README.md`.

---

## What the ticket asks

| Scope item | Where it lands |
| --- | --- |
| `POST /admin/sync/catalog`, `POST /admin/sync/prices` — enqueue, never execute inline, return the job id | [Triggers](#triggers) |
| `GET /admin/sync/status` — last run per job with duration and counts, queue depth, active provider, failure counts | [Status contract](#status-contract) |
| No duplicate run while one is active | [The duplicate guard](#the-duplicate-guard) |
| Both triggers audit-logged | [Audit](#audit) |
| PD-43: a false all-clear when Redis is down; a run stranded `RUNNING`; `lastRunPerKind()` unguarded | [Status contract](#status-contract), [Run lifecycle](#run-lifecycle), [Degradation](#degradation) |

| Acceptance criterion | How it is met |
| --- | --- |
| Triggering a sync returns immediately with a job ID | The route enqueues and answers 202 `{ jobId, kind }`; the work runs in a processor |
| A second trigger while a run is active is rejected with a clear message | BullMQ deduplication on a per-queue key, shared by the cron and the admin route; 409 `SYNC_IN_PROGRESS` naming the job |
| Status reflects a job that crashed, rather than showing it as still running forever | A final job failure closes its run `FAILED`; anything that escapes that is reported `stale: true` at read time |

## Measured before designing

- **`QUEUE_CONCURRENCY` defaults to 4, and the API process consumes every queue** (`queue/README.md`). Nothing today stops two `price-sweep` jobs running at once — the nightly cron and a manual trigger would both start from the same `lastClosedCursor` and spend the daily budget twice.
- **BullMQ 5.81.5 has deduplication.** `JobsOptions.deduplication = { id }` refuses a second job while one with that id is waiting, delayed or active; `Queue.getDeduplicationJobId(id)` reads the holder. The key is released when the job completes or finally fails.
- **A `SyncRun` row is created by the processor, not by the trigger** (`SyncRunService.startOrResume`). At trigger time only a job id exists.
- **A throw that escapes `process()` before `runs.close` leaves the row `RUNNING` for ever.** `ProviderSelectorService.resume()` throws for a provider no longer registered, and so does any Prisma error in `recordProgress`. BullMQ retries with the same job id and then parks the job in `failed`; nothing closes the row.
- **`AdminModule` imports nothing on purpose**, so it cannot reach a provider. `PricesModule` already imports `QueueModule` for `@InjectQueue` without importing `SyncModule` — the precedent this design follows.
- **The catalog sync (3 am) and the price sweep (4 am) share one budget of 1 000 requests a day and a ceiling of 30 a minute.** They do not overlap today only because of the schedule.

## Decisions

1. **`POST /admin/sync/prices` enqueues the full sweep** (`price-sweep`, kind `PRICE`) — the job the 4 am cron runs. The active refresh already runs four times a day and gets no button.
2. **The guard is BullMQ deduplication, not a Postgres check.** A `SyncRun` row appears only once a job starts, so a Postgres guard cannot see a waiting job and two triggers in a row both pass. A fixed `jobId` is worse: BullMQ keeps a completed job for 24 h, which would block the next trigger for a day, and `SyncRunService` resumes by job id, so a new run would adopt an old `RUNNING` row.
3. **The cron and the admin route share the dedup key**, so a duplicate is impossible from either side. A cron firing over a manual run is deduplicated and logs so.
4. **A catalog trigger is also refused while a price sweep is queued or running, and the reverse.** The schedule keeps the two apart; a button would not. Crons are unchanged — the schedule still separates them.
5. **One code, `SYNC_IN_PROGRESS`, for both refusals.** The client does the same thing either way — waits — and the message says which job is in the way.
6. **Breaker reset is in scope** (`POST /admin/sync/breakers/:provider/reset`). With every breaker open, a trigger fails with `every registered provider has an open breaker` for up to 30 minutes; the reset is the operator's way out.
7. **No endpoint to close a stuck run.** A final job failure closes it automatically, and anything left is reported `stale`. A row left `RUNNING` harms nothing: `lastClosedCursor` ignores `RUNNING`, and the next run of the kind replaces it in the status.
8. **`null` means unknown, `[]` means none**, for every section of the status. This replaces the ticket's `breakersReadable` flag and covers Postgres as well as Redis.
9. **`GET` never writes.** Staleness is derived when the status is read, not persisted by it.

## Triggers

| Method | Path | Success | Refusal |
| --- | --- | --- | --- |
| POST | `/admin/sync/catalog` | 202 `{ jobId, kind: "CATALOG" }` | 409 `SYNC_IN_PROGRESS` |
| POST | `/admin/sync/prices` | 202 `{ jobId, kind: "PRICE" }` | 409 `SYNC_IN_PROGRESS` |
| POST | `/admin/sync/breakers/:provider/reset` | 200 — the breaker state after the reset | 404 for a provider not in `CARD_SOURCE_NAMES` |

No request body on any of them. 202 because the work was accepted, not done. The message on a refusal names the job: `A price sweep is already queued or running (job 3f2c…)`.

### The duplicate guard

A constant per queue in `queue/` — the dedup ids for `catalog-sync` and `price-sweep` — and a helper that builds the `add` options from it. `CatalogSyncScheduler`, `PriceSweepScheduler` and the admin route all enqueue through it. The rule joins `queue/README.md`: a sync is enqueued only with its shared dedup options.

A trigger, in order:

1. `getDeduplicationJobId` for its own queue and for the other one. Either held → 409, nothing written.
2. Generate the `jobId` (a UUID), so the audit row can name the job before it exists.
3. One transaction: `AuditService.record(tx, …)` first, then `queue.add(name, {}, { jobId, deduplication })`. If BullMQ returns a job id other than the one generated — another admin got in between steps 1 and 3 — throw 409 and the audit row rolls back.
4. After commit, 202.

### Audit

| Action | Entity | `entityId` | `meta` |
| --- | --- | --- | --- |
| `sync.trigger` | `SyncJob` | the job id | `{ kind, queue }` |
| `sync.breaker_reset` | `Provider` | the provider name | `{ failures, openUntil }` before the reset |

`SyncJob`, not `SyncRun`: no run row exists yet. The processor later writes a `SyncRun` with the same `jobId`, so `sync_runs."jobId" = audit_logs."entityId"` joins the two.

A reset of a breaker that is closed with no failures answers 200 and writes nothing — a write that changes nothing is not audited, as `docs/DataModel.md` already says. Otherwise the audit row and then a `DEL` of both breaker keys, in one transaction; a failed `DEL` rolls the row back.

**Why audit first.** Redis is not in the transaction, so the two cannot be atomic; the order decides what can be left behind. A failed enqueue rolls the audit row back. A refused duplicate rolls it back. What remains:

- **Accepted residual 1:** the commit fails after `add` succeeded — a job with no audit row. The window is one `COMMIT` of a one-row insert. The same outcome follows when Redis fails between step 1 and `add` — see [Degradation](#degradation).
- **Accepted residual 2:** two admins trigger catalog and prices at the same moment, both pass step 1, and both jobs are queued. The cost is contention for 30 requests a minute, which the processors' stall handling already absorbs. A Redis lock is not worth it.

Both go into `docs/DataModel.md` beside the other accepted boundaries.

### Where the code lives

`AdminModule` imports `QueueModule` only. Writes go in a new `admin-sync-control.service.ts`; `admin-sync.service.ts` stays the status reader.

## Status contract

```ts
SyncStatusResponse = {
  runs: SyncRunSummary[] | null;            // null: Postgres unreadable
  queues: QueueDepth[] | null;              // null: the queue Redis unreadable
  breakers: ProviderBreakerState[] | null;  // null: breaker keys unreadable
  primaryProvider: string;                  // from config
  nextProvider: string | null;              // what select() would choose now; null: every breaker open
};

SyncRunSummary += { jobId: string | null; durationMs: number | null; stale: boolean | null };
QueueDepth = { queue: string; waiting: number; active: number; delayed: number; failed: number };
```

- `durationMs` is `finishedAt − startedAt`, null while the run is open.
- `queues` lists `catalog-sync`, `price-sweep`, `price-active` and `price-sync`.
- `nextProvider` comes from the selection rule moved out of `ProviderSelectorService.select()` into a pure function over the primary, the registered names and a breaker reading. The selector and the status both call it, so the rule has one home, and `AdminModule` still imports no provider.
- `breakers` becoming nullable is a breaking change to the contract. It has no consumer yet — the admin page is PD-122, in M13.

## Run lifecycle

Four ways a run can be left open, each with its own answer.

1. **A throw escapes `process()`.** BullMQ retries under the same job id and the run resumes, as now. On the final failure, `@OnWorkerEvent('failed')` in `CatalogSyncProcessor`, `PriceSweepProcessor` and `PriceActiveProcessor` calls a new `SyncRunService.closeAbandoned(kind, jobId, reason)`: `updateMany where { kind, jobId, status: RUNNING }` → `FAILED`, `finishedAt`, `error: "job failed after N attempts: <failedReason>"`. The `RUNNING` condition makes it idempotent and leaves closed rows alone. "Final" is `job.getState() === 'failed'`, not `attemptsMade >= attempts`: BullMQ fails a stalled job with attempts to spare, and a count would miss it. `resume()` is not changed — the unregistered-provider case closes `FAILED` after the ~15 s of backoff.
2. **The process is killed.** The job's lock lapses after 30 s, a live worker's stalled check puts it back in the queue, and the retry resumes the row from its cursor. A second stall fails the job, and case 1 closes the row.
3. **No worker is alive.** Then the API is not either — it is itself a worker for every queue. While the status endpoint answers, a stalled check is running. Recorded in `sync/README.md`; no mechanism needed.
4. **Read-time net.** For each `RUNNING` row in `runs`, the status reads `queue.getJob(jobId)`:

   | Job | `stale` |
   | --- | --- |
   | `active`, `waiting` or `delayed` | `false` |
   | missing, `completed` or `failed`, or the row has no `jobId` | `true` |
   | Redis unreadable | `null` |

   Mapping: `CATALOG → catalog-sync`, `PRICE → price-sweep`, `PRICE_ACTIVE → price-active`. This catches a process that died inside the `failed` handler and a job hash removed from Redis.

## Degradation

The BullMQ connection is built to wait for Redis rather than give up (`maxRetriesPerRequest: null`, plus ioredis' offline queue), so a read against a dead Redis may hang instead of failing. Every admin call to BullMQ or to the breaker keys therefore runs under a **2 s timeout**, and a timeout counts as unreadable. Probe 0.2 measures what actually happens; the timeout stays either way.

**Status** reads each section independently, each with its own `catch` and a `warn` log. It always answers 200.

| Down | `runs` | `queues` | `breakers` | `stale` | `nextProvider` |
| --- | --- | --- | --- | --- | --- |
| nothing | data | data | data | boolean | computed |
| Postgres | `null` | data | data | — | computed |
| Redis | data | `null` | `null` | `null` | `primaryProvider` |

With Redis down, `ProviderBreakerService.isOpen()` returns false, so the selector really would choose the primary. `nextProvider` reports that behaviour; `breakers: null` says the breakers themselves are unknown.

**Triggers and reset:**

| Down | Answer | Left behind |
| --- | --- | --- |
| Redis | 503 — step 1 times out | nothing |
| Postgres | 500 — the audit insert fails first | nothing; `add` never ran |
| Redis, between step 1 and `add` | 503 — `add` times out, the transaction rolls back | **a job with no audit row**, once Redis returns (see below) |

**Measured by probe 0.2:** with Redis stopped, `getDeduplicationJobId`, `getJobCounts` and `add` each stayed pending past 5 s rather than failing, and an `add` issued while Redis was down was stored once it came back. So the timeout is load-bearing, and a trigger whose `add` is already in ioredis' offline queue when the timeout fires leaves a job with no audit row. Step 1's read times out first when Redis is down before the trigger starts, so this needs Redis to fail in the milliseconds between step 1 and `add`; it joins accepted residual 1.

A 503 carries no `code`: it is not a domain error, and retrying is the only thing a client can do.

**The `failed` handler** logs an `error` if Postgres is down when it tries to close the run; the row stays `RUNNING` and the read-time net reports it.

## Verification

No automated tests in v1. Probes against the running stack — HTTP, psql, `redis-cli` — as in PD-80.

**Budget discipline.** A real catalog run costs about 83 of the 1 000 daily requests. The guard scenarios run against a **paused** queue (`queue.pause()`): the job stays `waiting`, the dedup key is held, and no request is spent. One real run end to end. The crash scenarios use the unregistered-provider path, which fails before the first request.

**Probe 0 — measured before the code depends on it**, results recorded here and in the READMEs:

1. `add` with a held dedup key: which `job.id` comes back.
2. A producer `Queue` with Redis stopped: hang or fail.
3. The `failed` event and `getState()` for a job that exhausted its attempts, and for one failed as stalled.

Measured 2026-09-29, BullMQ 5.81.5:

1. A second `add` under a held key stored nothing and **returned the holder's id** (`pd81-a` for a request carrying `jobId: pd81-b`). Queue defaults (`attempts`, `backoff`) survived beside `deduplication`. A job on a paused queue reported `getState() = waiting` but was counted under `paused`, not `waiting`. `getJobState` of an unknown id is `unknown`.
2. Every call stayed pending past 5 s with Redis stopped, and a pending `add` was stored after recovery — see [Degradation](#degradation).
3. `failed` fired on every attempt: states `delayed`, `delayed`, then `failed` with `attemptsMade 3`. The dedup key was released after the final failure. The stalled case is measured in the implementation, by killing the process mid-run.

| # | Scenario | Expected |
| --- | --- | --- |
| 1 | Trigger catalog | 202 with `jobId`, latency recorded; one `sync.trigger` row; a `SyncRun` with the same `jobId` |
| 2 | Trigger again while the job is `waiting` | 409 `SYNC_IN_PROGRESS` naming the job; no second audit row; one job in the queue |
| 3 | Prices while catalog is queued, and the reverse | 409 |
| 4 | The cron's `enqueue()` over a manual job | logged as deduplicated; one job |
| 5 | Two simultaneous triggers, 5 times | each time exactly one 202 and one 409, one audit row |
| 6 | A `RUNNING` row's provider set to `ghost`, job retried | the row `FAILED` with the reason within ~15 s |
| 7 | `taskkill /F` mid-run, then restart | the same row resumed from its cursor |
| 8 | A `RUNNING` row with an invented `jobId` | `stale: true` |
| 9 | Reset an open breaker; reset again; unknown provider | 200, both keys gone, audit row with the prior state; 200 and no row; 404 |
| 10 | Redis stopped | status 200 with `null` sections within 2.5 s; trigger 503, no audit row |
| 11 | Postgres stopped | status 200 with `runs: null`; trigger 500, no job queued |
| 12 | A trigger that makes `audit_logs` inserts fail (PD-80's technique) | 500, no job queued |
| 13 | Member and signed-out on every new route | 403 / 401 |

## Files

| File | Change |
| --- | --- |
| `packages/shared/src/entities/sync.ts` | the status contract above; the trigger response |
| `packages/shared` `ERROR_CODES` | `SYNC_IN_PROGRESS` |
| `apps/api/src/queue/` | dedup ids and the `add` options helper |
| `apps/api/src/sync/catalog-sync.scheduler.ts`, `price-sweep.scheduler.ts` | enqueue with the shared options; log a deduplicated add |
| `apps/api/src/sync/providers/` | the selection rule as a pure function; `select()` calls it |
| `apps/api/src/sync/sync-run.service.ts` | `closeAbandoned` |
| `apps/api/src/sync/catalog-sync.processor.ts`, `price-sweep.processor.ts`, `price-active.processor.ts` | `@OnWorkerEvent('failed')` |
| `apps/api/src/admin/admin.module.ts` | import `QueueModule` |
| `apps/api/src/admin/admin-sync-control.service.ts` | new: triggers and reset |
| `apps/api/src/admin/admin-sync.service.ts` | sections read independently, timeouts, queues, `stale`, `nextProvider` |
| `apps/api/src/admin/admin.controller.ts` | the three routes |
| `docs/API.md` | Admin / Sync routes, contract, `SYNC_IN_PROGRESS`, measurements |
| `docs/DataModel.md` | the two audit actions, both residuals; drop "arrive with PD-81" |
| `apps/api/src/queue/README.md` | producers in the queue table; the dedup rule |
| `apps/api/src/sync/README.md` | the `failed` handler, `stale`, the no-live-worker argument |

## Out of scope

- Automated tests — deferred for v1.
- Deduplicating the `price-active` cron: a run past six hours is not plausible.
- The admin sync page — PD-122.
- Metrics, queue history, error rate — PD-82.
- Triggering the active refresh or `price-sync` from the admin API.
