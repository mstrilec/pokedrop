# PD-49 — The nightly full-catalog price sweep

Design, 2026-09-21. Milestone M4 · Price Sync.

Ticket: [PD-49](https://linear.app/mstrilec/issue/PD-49/nightly-full-catalog-price-sweep-with-rate-limit-aware-batching) ·
Reference: `docs/PRD.md` §15 (nightly full sweep) · `docs/Architecture.md` §7 ·
[PD-48's design](2026-09-21-pd-48-price-sync-write-path-design.md).

The slow half of the two-speed strategy. PD-48 built the consumer and said three
producers would feed it; this is the first of them, and the only one that has to
answer for the whole catalog.

---

## Measured before designing

Against the live API and the real 20 670-card mirror, 2026-09-21.

| Probe | Result |
| --- | --- |
| 20 consecutive single-card requests | **6 succeeded — 30%**, identical to the 2026-09-18 figure in `sync/README.md` |
| failures observed | HTTP 500 and 502 (Cloudflare), fast: 0.2–0.5 s. One *success* took 21.4 s |
| rate-limit headers, on 200 and on failure | **none** — no `X-RateLimit-*`, no `Retry-After` |
| one batch during the probe run | **exhausted the client's 5-attempt budget** and raised `ProviderUnavailableError` |
| batch of 100, through provider + writer | fetch **4.37 s**, write **0.16 s**, total **4.53 s** (4 reps, 0 failures) |
| batch of 250, through provider + writer | fetch **12.21 s**, write **0.36 s**, total **12.57 s** (4 reps, 0 failures) |
| isolated HTTP, no backoff, no database | OR-100 3.45 s / 168 KB · OR-250 9.30 s / 451 KB · flat page of 250 8.46 s / 487 KB |
| `select=id,tcgplayer,cardmarket` on 100 | 5.08 s / **60 KB** — payload cut 2.8×, **no time saved** |
| `sync_runs` | 8 `CATALOG` rows, **0 `PRICE`** |
| the catalog sync of this morning | 15 170 processed, **22 pages failed** — worse than the 19 920 / 3 of 09-18 |

Three of these decide the design.

**The write is 3–4% of a batch.** The cost is the provider call, and most of
that call is backoff between retries rather than the request itself. Anything
this ticket does to go faster has to act on requests, not on SQL.

**The cost curve is roughly linear.** 2.5× the cards cost 2.77× the time. PD-48
justified a batch of 100 with "five times the wall clock for two and a half
times the work" — 3.9 s against 19.2 s. That does not reproduce. A single 19.9 s
observation did turn up in the first probe run, and a 21.4 s *success* appears
in the 20-request sample above, so 19.2 s looks like the tail of this
distribution rather than the shape of it. **The correction belongs in PD-48's
spec and in `sync/README.md`, not quietly here.**

**Roughly one batch in six dies outright.** At a 30% per-request success rate,
five attempts all failing is 0.7⁵ = 16.8%, and the probe run produced one on
schedule. Card loss per sweep is the same at any batch size, because the failure
probability is per batch rather than per card — a bigger batch concentrates the
loss without increasing it.

`select=` is the measurement that kills an obvious idea: the payload shrinks
2.8× and the wall clock does not move, because the cost is the provider's query,
not the transfer.

---

## The ceiling is 1 000 a day and 30 a minute, and nobody will tell us

No file in this repository names the real limit. `docs/PRD.md` §2 says "~20k
with it, lower anonymously"; `.env.example` says "a lower ceiling";
`sync/README.md` says the anonymous limit "cannot be observed, since the
provider sends no headers". The last is confirmed above and the other two are
now resolved, from the provider's own documentation:

| | |
| --- | --- |
| with an API key | 20 000 / day |
| **anonymous** | **1 000 / day, maximum 30 / minute** |

### There is no key to get

The same documentation carries a deprecation notice: **"New account
registrations are no longer available."** Existing keys keep working **through
2027-03-01**, and the documented migration is Scrydex.

So the anonymous ceiling is not the conservative choice. It is the only one.
`sync/README.md` and `.env.example` both advise setting the free key before the
first production sweep; that advice is now impossible to follow and has to go.

**A larger consequence is out of this ticket's scope and must not be solved
inside it.** `docs/PRD.md` targets M14 for 2027-02-28; the primary provider stops
one day later, and the documented successor is paid, which §2 forbids in v1.
TCGdex is free, keyless, already implemented and already the fallback. That is a
project-level decision deserving its own ticket, and PD-49 neither makes it nor
pre-empts it.

### What a sweep costs against 1 000

| batch | batches | requests at ~3 attempts each | wall clock |
| --- | --- | --- | --- |
| 100 | 207 | ~620 | 15.6 min |
| **250** | **83** | **~250** | **17.4 min** |

Both fit in a night; only one fits in the budget beside a catalog sync, which
spends roughly the same 250 on its own 83 pages. **The sweep uses 250.** Requests
are the scarce resource and wall clock is not — the two differ by two minutes
and by a factor of 2.5.

---

## Shape

A new queue, its own scheduler, its own processor, and one service shared with
what PD-48 already built.

```
price-sweep.scheduler.ts   @Cron 4am  ->  queue.add, and nothing else
price-sweep.processor.ts   walks the catalog, one batch at a time
price-batch.service.ts     one batch: fetch, group, write, invalidate
price-sync.processor.ts    PD-48's consumer, now delegating to the same service
```

`PriceBatchService.refreshBatch(cardIds, provider)` is the whole of a batch, and
it is lifted out of `PriceSyncProcessor` rather than duplicated. PD-48's
processor keeps serving PD-50 and PD-52; the sweep calls the service directly
and awaits it. One write path, as PD-48 promised, reached two ways.

**PD-48's README says PD-49 "enqueues batches".** It does not, and the sentence
has to be corrected. Enqueuing 83 jobs would buy BullMQ's per-job retries and
would cost a run-tracking problem with no good answer: which job closes the
`SyncRun`, what `failed` counts, and how a half-finished fan-out resumes. The
coordinator shape has all three already solved, in `catalog-sync.processor.ts`,
against the same upstream.

### Its own queue, not `price-sync`

The sweep is a single job of roughly 17 minutes. On the `price-sync` queue it
would sit in front of PD-52's one-card jobs, which exist to answer a user
waiting on a page.

### 4am, and concurrency of one

Catalog sync runs at 3am and takes 11–15 minutes. The two share a daily budget
and a 30-per-minute ceiling, so they must not overlap.

Concurrency inside the sweep is **1**, and that is the measurement rather than
caution: sequential batches ran at roughly 15 requests a minute including
retries, and doubling that reaches the ceiling. `QUEUE_CONCURRENCY` stays
unused; wiring it is not this ticket's business.

---

## The cursor rolls between runs

Read literally, "nightly full-catalog sweep" means starting at the first card
every night. That is wrong in a way that only shows up once the upstream is
having a bad week: if the budget or the health runs out at 60% of the catalog,
the sweep stops at the same place every night and the tail is **never** priced.

So the cursor does not reset. A new run reads the last closed `PRICE` run's
cursor, continues from there, and **wraps to the beginning on reaching the end**.
A full sweep is true in aggregate rather than per night — the property
`sync/README.md` already claims for the mirror: *the mirror converges rather
than completing.*

### `{ lastCardId }`, not `{ offset }`

Keyset pagination — `WHERE id > :lastCardId ORDER BY id LIMIT 250` — rides the
primary key, stays correct when cards are inserted or deleted between runs, and
does not degrade at the far end of the catalog the way `OFFSET 20000` does.

The catalog sync's cursor is `{ page }` because it paginates a *provider's* list
and has nothing else to hold on to. This one paginates our own table, where a
stable key exists.

### Two resumptions that must not be confused

| | Trigger | Mechanism |
| --- | --- | --- |
| **within a run** | a BullMQ retry of the same job | the existing `jobId` match in `SyncRunService.startOrResume` |
| **between runs** | tonight's scheduled job | read the previous closed `PRICE` run's cursor |

Collapsing them would let a retry adopt the *previous* run's position and skip
everything the failed attempt had already done. The distinction PD-43 drew for
providers — a resumed run keeps what its own row names — applies here to
position.

---

## The request budget

`RequestBudgetService`, counting in Redis.

- `INCR budget:{provider}:{YYYY-MM-DD}` immediately before each `fetch`, in both
  `http.ts` files. Before, not after, and not in `onRetry`: retries are the
  dominant consumer and the count has to include every request that left.
- The key carries a TTL comfortably longer than a day and shorter than a week,
  so yesterday's counter disappears without a sweeper.
- Limits are per provider, from config: **pokemontcg 1 000**, **TCGdex
  uncapped** — it publishes no limit and answered 64 of 64 under concurrency.
- `PRICE_SWEEP_RESERVE` is what the sweep leaves for everything else. Below it,
  the sweep stops, closes `PARTIAL`, and leaves the cursor where it stands.

### The two `http.ts` files stay separate

`sync/README.md` is explicit that the TCGdex HTTP layer is "deliberately a
parallel of the other rather than shared code: the mechanism matches, the policy
does not." This ticket does not merge them. Each calls the same injected service;
neither learns anything about the other's policy.

### Redis unreachable means fail open

The sweep proceeds, with a warning.

Failing closed would stop all synchronisation on a Redis blip. Failing open
risks overshooting a budget whose only consequence is a 429 — which this design
is already obliged to handle, because the counter is *our* estimate and never
the provider's. It is the polarity PD-43 chose for the breaker: with Redis down,
fail toward the source the operator configured.

**This is the decision in this spec most likely to be wrong**, and it is cheap to
reverse: one branch, one configuration flag if it ever needs to be both.

---

## Rate limiting and 429

`http.ts` already honours `Retry-After` and retries internally, so a
`ProviderRateLimitError` reaching the sweep means the attempt budget was spent
while the upstream was *still* refusing. The sweep's wait is a second layer, not
a duplicate of the first.

On that error the sweep waits `retryAfterMs`, or — when the header was absent,
which it always has been here — an escalating wait doubling from 30 s and capped
at 5 minutes, chosen against the documented ceiling of 30 requests a minute
rather than against the retry base in `http.ts`, which is sized for a 5xx. It
**does not advance the cursor**, and retries the same batch. It is not counted into `failed`: a 429
says the provider is healthy and we are asking too fast, the rule `http.ts`,
PD-43's breaker and PD-48's processor all already follow. After a configured
number of consecutive stalls the run closes `PARTIAL` with the reason recorded.

**A BullMQ queue limiter cannot do this job.** `limiter: { max, duration }`
paces *jobs*, and the sweep is one job containing 83 batches; the limiter would
never see them. The shape chosen in §Shape rules the instrument out, which is
worth writing down because the ticket's title points straight at it.

A proactive token bucket is **rejected for now**. The measured pace is 15
requests a minute against a ceiling of 30, so a bucket would exist only to
prevent a condition the reactive path must handle regardless. If PD-50 running
several times a day changes that arithmetic, it can add one — and it will have
this spec's numbers to argue from.

---

## Failure handling

The same shape as the catalog sync, because the problem is the same.

| What | Result |
| --- | --- |
| a batch exhausts the client's retry budget | counted into `failed`, skipped, the loop continues |
| `ProviderRateLimitError` | waits, retries the same batch, not counted |
| `ProviderContractError` | the run closes `FAILED` — the upstream changed shape |
| the breaker opens mid-run | the loop breaks *after* the cursor is written, run closes `PARTIAL` |
| the budget falls below the reserve | the loop breaks after the cursor is written, run closes `PARTIAL` |

A run closes `SUCCEEDED` when nothing failed and `PARTIAL` otherwise. Against
this upstream `PARTIAL` is the ordinary outcome, not a fault — four consecutive
catalog runs said so.

The provider is chosen **once per run**, and a resumed run keeps the one its row
names, exactly as PD-43 requires. The fallback's known cost carries over
unchanged: TCGdex cannot address roughly 10–15% of our card ids, and those cards
keep their previous values.

### One `SyncRun`, and the admin endpoint already reads it

`kind: PRICE`, the provider, `processed`, `failed`, the cursor, and the closing
status and reason. `AdminSyncService.lastRunPerKind` already queries
`SyncKind.PRICE` and today finds nothing. The ticket's third acceptance
criterion is satisfied by writing the row, with no new machinery and no change
to `/admin/sync/status`.

---

## The cache gap this closes

`CatalogService.getCard` caches the whole card — `latestPriceUsd`,
`latestPriceEur` and `priceUpdatedAt` among its fields — under `cache:card:{id}`
for 24 hours. PD-48's processor deletes `cache:price:card:{id}` and nothing else.
The catalog sync deletes `cache:card:*` and deliberately not the price keys,
with a comment saying prices "belong to M4's write path".

Each path believes the other owns the overlap, so after a price run
`GET /cards/:id` serves the pre-run price until the next catalog sync flushes
everything — up to a day.

It is invisible today: there are zero `cache:price:*` keys in Redis, because
nothing yet writes or reads them. PD-51 makes it visible as two different numbers
for one card on one screen.

`PriceBatchService` deletes both keys per card, in the call that already exists.
One added argument, and PD-50, PD-51 and PD-52 inherit the fix.

---

## Verification plan

No automated tests (`docs/PRD.md` §20). Each of these is a measurement against
the running stack, and a result that contradicts this spec is reported rather
than accommodated.

1. **A sweep runs and writes a `SyncRun`.** `kind=PRICE`, a provider, a cursor,
   `processed` and `failed`, closed `SUCCEEDED` or `PARTIAL`.
2. **`/admin/sync/status` returns it** — as admin, 200, with the price row
   present where there was none.
3. **The cursor rolls.** Stop a run early, start another, confirm the second
   begins where the first stopped rather than at the first card.
4. **It wraps.** Seed the cursor near the last card id; the next run crosses the
   end and resumes from the beginning.
5. **A BullMQ retry resumes within the run**, not from the previous run's
   cursor. This is the distinction most likely to be implemented wrong, so it is
   measured by killing the worker mid-run and restarting it.
6. **The budget counter counts retries.** Run one batch, read
   `budget:pokemontcg:{today}`, and confirm it exceeds the number of batches —
   at a 30% success rate it should be roughly triple.
7. **The reserve stops the sweep.** Set the counter near the limit by hand;
   the run closes `PARTIAL` with the budget as its reason and the cursor intact.
8. **Redis down does not stop a batch.** Not through the queue: with Redis
   stopped there is no queue to enqueue onto and no worker to consume, so a
   sweep cannot start at all and the fail-open branch is unreachable that way.
   It is measured the way PD-43 measured the same property of the breaker —
   a probe calling `RequestBudgetService` against an unreachable client
   directly, confirming it answers "there is budget" and warns.
9. **A 429 slows rather than fails.** Now provokable for the first time: the
   anonymous ceiling is 30 a minute, so a deliberate burst produces a real 429
   rather than a stub's. Confirm the batch is retried, the cursor does not move,
   and `failed` does not increase.
10. **Both cache keys are gone after a batch**, and a neighbouring card's are not.
11. **The daily snapshot cap still holds** across a sweep and a second run the
    same day: `latestPrice*` refreshes, snapshot count does not move.
12. **Gates.** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`.

Point 9 is the one this ticket could not have verified last week. It is worth
stating plainly that `sync/README.md` currently records the `Retry-After` path as
**unconfirmed in the field**; this is the chance to confirm it.

---

## Files

**New**

| Path | Holds |
| --- | --- |
| `apps/api/src/sync/price-sweep.scheduler.ts` | the cron, whose entire body is an enqueue |
| `apps/api/src/sync/price-sweep.processor.ts` | the catalog walk, the cursor, the run |
| `apps/api/src/sync/price-batch.service.ts` | one batch, shared with PD-48's processor |
| `apps/api/src/sync/providers/request-budget.service.ts` | the per-provider daily counter |

**Edited**

| Path | Change |
| --- | --- |
| `apps/api/src/sync/price-sync.processor.ts` | delegate the batch to the service |
| `apps/api/src/sync/providers/pokemon-tcg/http.ts`, `.../tcgdex/http.ts` | count each request |
| `apps/api/src/queue/queue.constants.ts` | the `price-sweep` queue |
| `apps/api/src/queue/queue.module.ts` | register it |
| `apps/api/src/sync/sync.module.ts`, `index.ts` | register and export |
| `apps/api/src/redis/cache.keys.ts` | `budgetKeys`, beside `breakerKeys` and outside the cache namespace |
| `apps/api/src/config/env.schema.ts`, `app.config.ts`, `.env.example` | the budget, the reserve, the stall ceiling |
| `docs/superpowers/specs/2026-09-21-pd-48-price-sync-write-path-design.md` | correct the batch-size justification |
| `apps/api/src/sync/README.md` | the sweep; the real limits; retire the API-key advice |
| `docs/PRD.md` §2, `docs/Architecture.md` §3 | the real limits; the deprecation. Both state the API strategy; `docs/API.md` documents our own endpoints and is untouched |

No migration. Nothing here changes the schema.

---

## Out of scope

| Not here | Where |
| --- | --- |
| Choosing which cards are "active" | PD-50 |
| Reading prices back, sparklines, staleness in a response | PD-51 |
| A per-card cooldown, an on-demand endpoint | PD-52 |
| Triggering a sweep from the admin API | PD-81 |
| What replaces pokemontcg.io after 2027-03-01 | its own ticket, after M4 |
| Wiring `QUEUE_CONCURRENCY` into any processor | whichever ticket needs concurrency; this one needs 1 |
| A proactive token bucket | PD-50, if its cadence changes the arithmetic |

---

## Forward notes

**PD-50 inherits the budget and will feel it.** A sweep costs about a quarter of
the anonymous daily allowance and the catalog sync costs another quarter. An
active refresh running every few hours has roughly 500 requests a day to live
in, and `RequestBudgetService` is where it will find out.

**The wrap-around makes freshness a function of budget.** At a full 83-batch
sweep a night, every card is repriced daily. If the reserve or the upstream
truncates runs to half, every card is repriced every two days instead, and
nothing breaks — the series simply thins. `priceUpdatedAt` is what a reader
should trust, which is exactly why PD-51 returns staleness rather than hiding it.

**The 30-per-minute ceiling is the real constraint on ever going faster**, not
the daily total. Any future concurrency has to be argued against that number,
and the measured baseline to argue from is 15 requests a minute at concurrency 1.
