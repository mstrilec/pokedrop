# PD-82 — Admin metrics: DAU, packs opened, trade volume, freshness

Design, 2026-09-30. Milestone M10 · Admin API & Metrics.

Ticket: [PD-82](https://linear.app/mstrilec/issue/PD-82/admin-metrics-endpoint-dau-packs-opened-trade-volume-data-freshness).
It also carries the pack-opening counters [PD-58](https://linear.app/mstrilec/issue/PD-58) deferred here, and builds on
[PD-81](https://linear.app/mstrilec/issue/PD-81/admin-sync-control-and-status-endpoints)'s sync status.
Reference: `docs/API.md` (Admin / Sync) · `docs/PRD.md` §5.8 · `docs/DataModel.md` ·
`design/Pokemon TCG App.dc.html` ("Operations overview").

---

## What the ticket asks

| Scope item | Where it lands |
| --- | --- |
| `GET /admin/metrics`: DAU, packs opened, trade volume and outcomes, catalog and price freshness, queue depth, error rate | [Contract](#contract), [Sources](#sources) |
| Time series shaped for charts, with a configurable window | [Contract](#contract) |
| Aggregations bounded and indexed — never a full-table scan | [Indexes](#indexes), [Budget](#budget) |
| Short cache TTL | [Cache and degradation](#cache-and-degradation) |

| Acceptance criterion | How it is met |
| --- | --- |
| Responds within the performance budget on a realistically sized dataset | ≤ 300 ms uncached at a 30-day window over the dataset in [Budget](#budget), every aggregate an index or index-only scan |
| Freshness figures match what the sync status reports | `freshness.lastRuns` and `queues` are read through `AdminSyncService.status()` — the same read `/admin/sync/status` serves |
| Feeds the dashboard charts without client-side reshaping | One flat row per UTC day, zero-filled, with rates computed server-side; the cards' pair of days served as-is |

## Measured before designing

- **Nothing records activity.** `User` has no last-seen column, and sessions are deleted on sign-out, expiry and suspension, so they hold no history.
- **Nothing counts requests or errors.** The exception filter logs 5xx and keeps no count.
- **No index serves a date range across all users.** `pack_openings` has `(userId, createdAt)`; `trades` has `(recipientId, status)` and `(initiatorId, status)`.
- **Timestamps are stored as UTC without a zone** (`TIMESTAMP(3)`, Prisma's default), so a UTC day is `date_trunc('day', col)`.
- **There is no `EXPIRED` trade status.** The expiry job closes a trade as `CANCELLED` with a `trade.expire` audit row.
- **The design** shows four cards — daily active users, packs opened, trade volume, catalog freshness — each with a trend against the previous period, and a bar chart of packs opened over 14 days.
- **PD-58 deferred two counters here:** openings where a slot fell back to another rarity, and refusals with `PACK_UNAVAILABLE`. Both are only logged today.
- **`AdminSyncService.status()` (PD-81)** already reads the last run per kind and the queue depths, each null when unreadable.
- **`/api/v1/health/*`** is exempt from rate limiting because an orchestrator polls it.

## Decisions

0. **No 90-day window — amended after probe 0.** The design first offered 7, 14, 30 and 90 days. Probe 0 measured the aggregates at 90 days over the budget dataset: the window covers nearly every row, so the planner seq-scans, and `pack_openings` alone took 353 ms whether read from the table or, forced, from its index — 1 000 000 entries is the cost, not the access path. Warm sum 685 ms. At 30 days every aggregate was an index-only scan: 28 + 106 + 25 + 35 ms, run in parallel, so about 110 ms of wall time. At 14 days, 111 ms in total. Windows are therefore 7, 14 and 30 days, and the budget is measured at 30. A 90-day view belongs with a daily rollup table (approach B), when one is wanted.

1. **Computed on read, cached 60 s** — no rollup table, no materialized view. One source of truth and no background job. If probe 0 shows the aggregates cannot fit the budget, the fallback is a daily rollup table filled by a cron (approach B), and that is decided before any code is written.
2. **DAU comes from a new `user_activity(userId, day)` table in Postgres.** Exact, durable, indexed. Redis HyperLogLog was rejected as approximate and lost with Redis; deriving activity from writes was rejected because it misses users who only browse.
3. **Activity is written without Redis and without `await`.** A per-process in-memory set of today's user ids means a user costs one `INSERT … ON CONFLICT DO NOTHING` per day per process, and nothing on every other request.
4. **Trade volume is trades that became `ACCEPTED` that day**, by `resolvedAt`. Beside it: trades proposed that day, by `createdAt`, and trades closed without a deal — declined, cancelled (including expired), countered, voided — by `resolvedAt`.
5. **Error rate is 5xx over all requests to `/api/v1`**, health excluded, from daily Redis counters kept 100 days. The PD-58 counters use the same mechanism.
6. **Days are UTC, and the cards show the last complete day against the day before.** Activity is recorded per day, so a rolling 24 h DAU cannot exist; mixing a day for DAU with a rolling 24 h for packs would put numbers for different periods side by side. Today's partial day stays in the series, flagged.
7. **`null` means unknown, as in PD-81.** Every section of the response is read independently and the answer is always 200.

## Contract

`GET /admin/metrics?days=14` — `days` ∈ {7, 14, 30}, default 14 (the design's chart); anything else is 400. Admin only, like the rest of `/admin`.

```ts
AdminMetrics = {
  generatedAt: Date;
  window: { days: number; from: string; to: string };   // 'YYYY-MM-DD', UTC; to = today, inclusive
  series: MetricsDay[] | null;                          // one row per day, oldest first, zero-filled
  summary: { current: MetricsDay; previous: MetricsDay } | null;  // yesterday and the day before
  freshness: {
    oldestPriceUpdatedAt: Date | null;
    cardsWithoutPrice: number;
    lastRuns: SyncRunSummary[] | null;                  // AdminSyncService.status().runs
  } | null;
  queues: QueueDepth[] | null;                          // AdminSyncService.status().queues
};

MetricsDay = {
  day: string;                  // 'YYYY-MM-DD'
  partial: boolean;             // true for today only
  activeUsers: number;
  packsOpened: number;
  tradesProposed: number;       // by createdAt
  tradesAccepted: number;       // by resolvedAt — trade volume
  tradesDeclined: number;
  tradesCancelled: number;      // includes expired
  tradesCountered: number;
  tradesVoided: number;
  requests: number | null;      // null: counters unreadable, or the day is past their 100-day life
  serverErrors: number | null;
  errorRate: number | null;     // serverErrors / requests; null also when requests is 0
  packFallbacks: number | null;
  packUnavailable: number | null;
};
```

- **Flat keys**, so a chart takes `dataKey="packsOpened"` straight from `series`.
- **`summary`** is `series`' last two complete days, served separately so the cards need no lookup; `summary` is computed from the same rows and so cannot disagree with the chart. It is null when `series` is.
- **`window.from`** is `days − 1` days before today, so `series` has exactly `days` rows.

## Sources

### Activity

```prisma
model UserActivity {
  userId String
  day    DateTime @db.Date
  user   User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, day])
  @@index([day])
  @@map("user_activity")
}
```

- **Written by `SessionGuard`**, once it holds a valid session of a user who is not suspended, on protected and `@Public()` routes alike, through `ActivityService.touch(userId)`.
- **`touch`** checks an in-memory set for the current UTC day. A user already in it costs nothing. Otherwise it adds the id and issues `INSERT … ON CONFLICT DO NOTHING`, not awaited. A failed insert is logged and removes the id, so a later request retries. The set is replaced when the day changes.
- **Replicas each insert once per user per day**, and the primary key absorbs the duplicates.
- **`/api/auth/*`** does not pass through `SessionGuard`, so a sign-in alone is not activity. The first `/api/v1` request after it is.
- **Read:** `SELECT day, count(*) FROM user_activity WHERE day >= $from GROUP BY day`, an index-only scan on `(day)`.
- **No retention job.** At 5 000 daily users the table grows by about 1.8 million rows a year.

### Counters

Keys live in the cache database under `metrics:`, outside `cache:` — as `breaker:` and `throttle:` are — so a cache flush does not reset them:

| Key | Incremented by |
| --- | --- |
| `metrics:requests:{YYYY-MM-DD}` | a middleware on `/api/v1`, on `res.on('finish')`, `/api/v1/health/*` excluded |
| `metrics:server_errors:{YYYY-MM-DD}` | the same middleware, when the final status is ≥ 500 |
| `metrics:pack_fallbacks:{YYYY-MM-DD}` | `PackOpeningService`, once per opening with any fallback, where it logs today |
| `metrics:pack_unavailable:{YYYY-MM-DD}` | `PackOpeningService`, each `PACK_UNAVAILABLE` refusal |

- **Each increment is `INCR` plus `EXPIRE 100 days`**, pipelined, not awaited, with errors swallowed. A warning is logged at most once a minute, so a Redis outage does not flood the log.
- **A middleware, not a Nest interceptor.** Interceptors run after guards, and would miss a 401 from `SessionGuard` or a 404 from the not-found handler. The `finish` event sees every final status.
- **Read:** one `MGET` of all four counters across the window, under PD-81's 2 s timeout (`admin/with-timeout.ts`).

### Aggregates

Each aggregate is one query grouped by `date_trunc('day', col)` over `col >= $from`, and all run in parallel:

- `pack_openings` by `createdAt` → `packsOpened`;
- `trades` by `createdAt` → `tradesProposed`;
- `trades` by `resolvedAt` and `status` → accepted, declined, cancelled, countered, voided.

### Freshness and queues

- `min("priceUpdatedAt")` — one step down the existing `cards (priceUpdatedAt)` index.
- `count(*) WHERE "priceUpdatedAt" IS NULL` — on the same index.
- `lastRuns` and `queues` — `AdminSyncService.status()`, so AC2 holds by construction.

### Where the code lives

- New global module `apps/api/src/metrics/`: `ActivityService`, `MetricsCounterService`, the request-counting middleware, and the key builders.
- `AdminMetricsService`, the controller route and the query DTO in `apps/api/src/admin/`.
- The contract in `packages/shared`.

## Indexes

One migration, `admin_metrics`, with the `user_activity` table and:

- `pack_openings ("createdAt")`
- `trades ("createdAt")`
- `trades ("resolvedAt", "status")` — so the outcome aggregate is index-only.

## Cache and degradation

- **The whole response is cached** under `cache:admin:metrics:{days}` for 60 s through `CacheService` (read with the response schema).
- **No invalidation.** `generatedAt` shows the age.
- **No stampede protection.** A few admins read this page.

The aggregates, the counter `MGET` and `AdminSyncService.status()` run in parallel. Each fails into its own `null`:

| Down | `series` | counter fields | `summary` | `freshness` | `queues` |
| --- | --- | --- | --- | --- | --- |
| nothing | data | numbers | data | data | data |
| Postgres aggregates | `null` | — | `null` | `null` | from `status()` |
| Redis | data | `null` | data | data; `lastRuns` from `status()` | `null` |

- **A cache read failure** is a miss — `CacheService` already behaves so — and a cache write failure is ignored.
- **On the write side,** a failed activity insert or counter increment never fails the request it rides on.

## Budget

**≤ 300 ms uncached, p50 and p95, for `days=30`** over:

| Table | Rows |
| --- | --- |
| users | ~50 000 |
| pack_openings | ~1 000 000 |
| trades | ~200 000 |
| user_activity | ~500 000 across 90 days |

Every aggregate's `EXPLAIN ANALYZE` must show an index or index-only scan, never a `Seq Scan` on these tables. The dataset is generated by one SQL script with `generate_series`, marked (emails `pd82-…`), and deleted afterwards.

## Verification

No automated tests in v1. Probes against the running stack — HTTP, psql, `redis-cli` — as in PD-81.

**Probe 0 — before any code:** generate the dataset, create the three indexes by hand, and `EXPLAIN ANALYZE` each aggregate at the longest window. The sum must fit roughly 200 ms, leaving room for the rest of the response; otherwise stop and move to approach B. The indexes are then dropped, and the migration creates them for real.

| # | Scenario | Expected |
| --- | --- | --- |
| 1 | Member; signed out; `days=5` and `days=90`; default; `days=30` | 403; 401; 400; 14 and 30 rows, oldest first, zero-filled, the last `partial: true` |
| 2 | A user makes 5 requests; the API restarts; one more; an anonymous request to a `@Public()` route | exactly one `user_activity` row for today; the anonymous request adds none; today's `activeUsers` up by 1 |
| 3 | Pack opens; a template that falls back; a template refused with `PACK_UNAVAILABLE` | `packsOpened`, `packFallbacks`, `packUnavailable` up by the right counts |
| 4 | Trades proposed, accepted, declined, cancelled; some rows moved to yesterday by SQL | each in its day and status; `summary.current` is yesterday |
| 5 | Requests; a forced 500 (the failing `audit_logs` trigger from PD-80/81); health requests | `requests` and `serverErrors` up; `errorRate` their ratio; health uncounted |
| 6 | Against `/admin/sync/status`, cache cleared | `freshness.lastRuns` and `queues` identical — AC2 |
| 7 | Two requests in a row, then `DEL` of the cache key | the same `generatedAt`, then a new one |
| 8 | Redis stopped; then `pack_openings` renamed for a moment | 200 with counters and `queues` null; then `series` and `summary` null and the rest readable |
| 9 | 20 requests at `days=30`, cache cleared before each | p50 and p95 ≤ 300 ms — AC1 |
| 10 | `/users/me` 200 times before and after the change | p50 not visibly worse; the difference recorded |

## Files

| File | Change |
| --- | --- |
| `apps/api/prisma/schema.prisma` + migration `admin_metrics` | `UserActivity`; three indexes; `User.activity` relation |
| `packages/shared/src/entities/metrics.ts` (+ index export) | `AdminMetricsQuery`, `MetricsDay`, `AdminMetrics` |
| `apps/api/src/metrics/` | new: `ActivityService`, `MetricsCounterService`, request-counting middleware, key builders, global module |
| `apps/api/src/app.module.ts` | import the metrics module |
| `apps/api/src/main.ts` | mount the request-counting middleware with `app.use` before `app.init()`, as the auth throttle is — an Express middleware there sees requests no route matches, which a Nest `MiddlewareConsumer` binding may not |
| `apps/api/src/common/guards/session.guard.ts` | `touch` after a valid, unsuspended session |
| `apps/api/src/packs/pack-opening.service.ts` | the two PD-58 counters |
| `apps/api/src/admin/` | `AdminMetricsService`, `GET /admin/metrics`, the query DTO |
| `docs/API.md` | a new `## Admin / Metrics` section, with every definition above and a Measured list |
| `docs/DataModel.md` | `UserActivity` and the three indexes |
| `apps/api/src/metrics/README.md` | why activity skips Redis and `await`, why a middleware, the hot-path cost |

## Out of scope

- The rollup table (approach B), unless probe 0 calls for it.
- DAU at a finer grain than a day.
- A retention job for `user_activity`.
- Alerting — PD-129.
- Coins and cards moved in the trade volume.
- The dashboard page — PD-121.
