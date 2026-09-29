# PD-82 Admin Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /admin/metrics` returns one chart-ready row per UTC day — active users, packs opened, trade outcomes, requests and server errors, the PD-58 pack counters — plus yesterday against the day before for the cards, price and sync freshness, and queue depth, within 300 ms uncached at a 90-day window.

**Architecture:** DAU comes from a new `user_activity(userId, day)` table, which `SessionGuard` writes once per user per day through an in-memory set, never awaited. Requests, 5xx and the two pack counters are daily Redis counters: a request-counting Express middleware in `main.ts` and `PackOpeningService` increment them. `AdminMetricsService` computes indexed `GROUP BY day` aggregates, one `MGET` and `AdminSyncService.status()` in parallel, each failing into its own `null`, and caches the whole answer for 60 s.

**Tech Stack:** NestJS 12, Prisma 7 (PostgreSQL), ioredis, Zod 4 in `@pokedrop/shared`, Express middleware.

**Spec:** `docs/superpowers/specs/2026-09-30-pd-82-admin-metrics-design.md`

## Global Constraints

- **No automated tests, runners or CI test steps during v1.** Every verification step is a build or typecheck, plus a probe against the running stack (HTTP, `psql`, `redis-cli`).
- Commit straight to `dev`. Subject is `[PD-82]: short lowercase description`, header ≤ 72 characters, and the message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Comments only where load-bearing; rationale belongs in `docs/`.
- Never run `prisma migrate reset`. The only migration is `prisma migrate dev --name admin_metrics`.
- `days` ∈ {7, 14, 30, 90}, default 14; anything else is 400. Admin only.
- **Days are UTC.** `series` has exactly `days` rows, oldest first, zero-filled, and the last one (today) is `partial: true`. `summary` is `{ current: yesterday, previous: the day before }`.
- **Trade volume** is `tradesAccepted`, by `resolvedAt`. `tradesProposed` is by `createdAt`. Declined, cancelled (which includes expired), countered and voided are by `resolvedAt`.
- **Counters** are `metrics:{requests|server_errors|pack_fallbacks|pack_unavailable}:{YYYY-MM-DD}` in the cache Redis, `INCR` plus `EXPIRE 8 640 000` (100 days). Never awaited on the request path, and a failure is logged at most once a minute.
- `requests` counts `/api/v1/*` except `/api/v1/health/*`. `server_errors` counts final statuses ≥ 500.
- The response is cached under `cache:admin:metrics:{days}` for 60 s. Every section is `null` when unreadable, and the answer is always 200.
- **Budget:** p50 and p95 ≤ 300 ms uncached at `days=90` over ~50 000 users, ~1 000 000 pack openings, ~200 000 trades and ~500 000 activity rows. No `Seq Scan` on those tables in any aggregate's plan.

## Review Focus

- **The UTC day boundary.** An event at 23:59:59 UTC and another at 00:00:01 must land in two rows, and the in-memory activity set must reset when the UTC date changes, not at process start. The rows are pinned in Task 4, Step 4 (a trade resolved at `23:59:59` yesterday counts as yesterday's; an activity row on yesterday counts as yesterday's). The set's reset is a date comparison on every `touch` (Task 3, Step 1): it cannot be probed without waiting for midnight, so the final review checks it by reading.
- **A 90-day window reaching past the counters' lifetime.** This cannot happen at 100 days of retention, but a counter key that is simply absent must read as `0`, not `null` — `null` is reserved for "Redis unreadable". Pinned in Task 4, Step 4 (a fresh day with no traffic reads `requests: 0`).
- **The request-counting middleware on a request no route matches.** A 404 from the not-found handler and a 401 from `SessionGuard` must both be counted. Pinned in Task 3, Step 5.
- **A suspended user's surviving session must not count as activity.** `SessionGuard` deletes that session and refuses it. Pinned in Task 3, Step 5.
- **`errorRate` on a day with requests but no errors is `0`, not `null`;** on a day with no requests it is `null`. Pinned in Task 4, Step 4.

---

## Shared probe setup

Create once (Task 1, Step 1) at `$S/env82.sh`:

```bash
cd /m/projects/pokedrop
S="C:/Users/MaxSt/AppData/Local/Temp/claude/M--projects-pokedrop/a173296c-ebb8-4245-b075-03d2c93dd1ae/scratchpad"
PSQL="docker compose exec -T postgres psql -U pokedrop -d pokedrop -At"
PSQLF="docker compose exec -T postgres psql -U pokedrop -d pokedrop -v ON_ERROR_STOP=1"
RC="docker compose exec -T redis redis-cli -n 0"
API=http://localhost:4000/api/v1; AUTH=http://localhost:4000/api/auth; WEB=http://localhost:3000
P=pd82
req(){ who=$1; shift; m=$1; shift; p=$1; shift; if [ "$who" = anon ]; then curl -s -w ' |%{http_code}' -X "$m" "$API$p" -H 'Content-Type: application/json' "$@"; else curl -s -w ' |%{http_code}' -b "$S/jar-$who.txt" -X "$m" "$API$p" -H 'Content-Type: application/json' -H "Origin: $WEB" "$@"; fi; echo; }
strip(){ sed -E 's/,"requestId":"[^"]*"//'; }
signin(){ curl -s -o /dev/null -w "sign-in $1 %{http_code}\n" -c "$S/jar-$1.txt" -X POST "$AUTH/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $WEB" -d "{\"email\":\"$P-$1@example.com\",\"password\":\"correct-horse-battery\"}"; }
mkuser(){ curl -s -o /dev/null -X POST "$AUTH/sign-up/email" -H 'Content-Type: application/json' -H "Origin: $WEB" -d "{\"email\":\"$P-$1@example.com\",\"password\":\"correct-horse-battery\",\"name\":\"PD82 $1\"}"; $PSQL -c "update users set \"emailVerified\" = true where email = '$P-$1@example.com'" >/dev/null; signin $1; }
admin(){ $PSQL -c "update users set role = 'ADMIN' where email = '$P-$1@example.com'" >/dev/null; }
uid(){ $PSQL -c "select id from users where email = '$P-$1@example.com'"; }
today(){ $PSQL -c "select to_char(now() at time zone 'utc', 'YYYY-MM-DD')"; }
counter(){ $RC GET "metrics:$1:$(today)"; }
nocache(){ $RC --scan --pattern 'cache:admin:metrics:*' | xargs -r $RC DEL >/dev/null; }
row(){ req a GET "/admin/metrics?days=${2:-7}" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s.replace(/ \|\d+$/,''));const r=j.series.find(x=>x.day==='$1');console.log(JSON.stringify(r))})"; }
cleanup(){
  $PSQL -c "delete from trades where \"initiatorId\" in (select id from users where email like '$P-%') or \"recipientId\" in (select id from users where email like '$P-%')" >/dev/null
  $PSQL -c "delete from users where email like '$P-%'" >/dev/null
  $PSQL -c "delete from pack_templates where id like 'pd82-%'" >/dev/null
  rm -f "$S"/jar-*.txt
}
```

**Starting and stopping the API** is exactly as in PD-81. Stop it with the PowerShell `Stop-Process` one-liner that matches `apps[/\\]api[/\\]dist[/\\]main\.js`. Start it with:

```bash
source "$S/env82.sh"
pnpm build:shared >/dev/null && pnpm --filter @pokedrop/api build 2>&1 | grep -i error
(node apps/api/dist/main.js > "$S/api82.log" 2>&1 &)
for i in $(seq 1 40); do c=$(curl -s -o /dev/null -w '%{http_code}' $API/health/ready); [ "$c" = 200 ] && break; sleep 1; done; echo "ready: $c"
```

End every task by running `cleanup` and stopping the API.

### The dataset

`$S/dataset82.sql`, used by Task 1 and Task 5. It needs `user_activity` to exist, which Task 1 creates by hand and Task 2's migration creates for real:

```sql
BEGIN;
INSERT INTO users (id, email, "emailVerified", "displayName", role, currency, "createdAt", "updatedAt")
SELECT 'pd82u' || n, 'pd82-ds-' || n || '@example.com', true, 'PD82 ' || n, 'MEMBER', 0,
       now() - interval '120 days', now()
FROM generate_series(1, 50000) n;

INSERT INTO pack_openings (id, "userId", "templateId", "openId", "createdAt")
SELECT 'pd82o' || n, 'pd82u' || (1 + floor(random() * 50000))::int,
       (SELECT id FROM pack_templates ORDER BY id LIMIT 1),
       'pd82o' || n, (now() at time zone 'utc') - random() * interval '90 days'
FROM generate_series(1, 1000000) n;

INSERT INTO trades (id, "initiatorId", "recipientId", status, "createdAt", "resolvedAt")
SELECT 'pd82t' || n, 'pd82u' || a, 'pd82u' || (1 + (a % 50000)), st::"TradeStatus", c,
       CASE WHEN st = 'PENDING' THEN NULL
            ELSE least(now() at time zone 'utc', c + random() * interval '48 hours') END
FROM (SELECT n,
             (1 + floor(random() * 50000))::int AS a,
             (now() at time zone 'utc') - random() * interval '90 days' AS c,
             (ARRAY['PENDING','ACCEPTED','ACCEPTED','DECLINED','CANCELLED','COUNTERED','VOIDED'])[1 + floor(random() * 7)::int] AS st
      FROM generate_series(1, 200000) n) g;

INSERT INTO user_activity ("userId", day)
SELECT 'pd82u' || (1 + floor(random() * 50000))::int, (now() at time zone 'utc')::date - d
FROM generate_series(0, 89) d, generate_series(1, 5600) k
ON CONFLICT DO NOTHING;
COMMIT;
VACUUM ANALYZE users;
VACUUM ANALYZE pack_openings;
VACUUM ANALYZE trades;
VACUUM ANALYZE user_activity;
SELECT 'users', count(*) FROM users WHERE id LIKE 'pd82u%'
UNION ALL SELECT 'pack_openings', count(*) FROM pack_openings WHERE id LIKE 'pd82o%'
UNION ALL SELECT 'trades', count(*) FROM trades WHERE id LIKE 'pd82t%'
UNION ALL SELECT 'user_activity', count(*) FROM user_activity WHERE "userId" LIKE 'pd82u%';
```

`$S/dataset82-drop.sql`:

```sql
DELETE FROM trades WHERE id LIKE 'pd82t%';
DELETE FROM pack_openings WHERE id LIKE 'pd82o%';
DELETE FROM users WHERE id LIKE 'pd82u%';
```

`$S/explain82.sql` — the four aggregates exactly as `AdminMetricsService` will issue them, for a 90-day window:

```sql
\set from '''' `date -u -d '89 days ago' +%F` ''''
EXPLAIN (ANALYZE, BUFFERS) SELECT to_char(day, 'YYYY-MM-DD') AS day, count(*) AS n FROM user_activity WHERE day >= :from::date GROUP BY 1;
EXPLAIN (ANALYZE, BUFFERS) SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, count(*) AS n FROM pack_openings WHERE "createdAt" >= :from::timestamp GROUP BY 1;
EXPLAIN (ANALYZE, BUFFERS) SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, count(*) AS n FROM trades WHERE "createdAt" >= :from::timestamp GROUP BY 1;
EXPLAIN (ANALYZE, BUFFERS) SELECT to_char(date_trunc('day', "resolvedAt"), 'YYYY-MM-DD') AS day, status::text AS status, count(*) AS n FROM trades WHERE "resolvedAt" >= :from::timestamp GROUP BY 1, 2;
```

(`\set` with backticks runs `date` inside the postgres container, which is Debian and has GNU `date`.)

---

### Task 1: Probe 0 — do the aggregates fit the budget?

**Files:**
- Create: `$S/env82.sh`, `$S/dataset82.sql`, `$S/dataset82-drop.sql`, `$S/explain82.sql`, `$S/p0-ddl.sql` (throwaway)

**Interfaces:**
- Produces: the go/no-go for approach A, and the `/users/me` p50 baseline for Task 5.

- [ ] **Step 1: Write the probe files** from [Shared probe setup](#shared-probe-setup) and [The dataset](#the-dataset).

- [ ] **Step 2: Create the objects by hand.** Write `$S/p0-ddl.sql`:

```sql
CREATE TABLE user_activity ("userId" text NOT NULL REFERENCES users(id) ON DELETE CASCADE, day date NOT NULL, PRIMARY KEY ("userId", day));
CREATE INDEX user_activity_day_idx ON user_activity (day);
CREATE INDEX pd82_p0_po ON pack_openings ("createdAt");
CREATE INDEX pd82_p0_tc ON trades ("createdAt");
CREATE INDEX pd82_p0_tr ON trades ("resolvedAt", status);
```

```bash
source "$S/env82.sh"
$PSQLF < "$S/p0-ddl.sql"
```

Expected: `CREATE TABLE` and four `CREATE INDEX` lines.

- [ ] **Step 3: Load the dataset and explain**

```bash
time $PSQLF < "$S/dataset82.sql" | tail -6
$PSQLF < "$S/explain82.sql" > "$S/explain82-p0.txt"; grep -E 'Scan|Execution Time' "$S/explain82-p0.txt"
```

Expected:
- the four counts are about `50000`, `1000000`, `200000`, and `~500000` (duplicates are dropped by `ON CONFLICT`);
- every scan line is `Index Only Scan` or `Index Scan` / `Bitmap Index Scan` — **no `Seq Scan`** on these four tables.

Record each `Execution Time` and their sum. Run the explain twice and record the second (warm) run as well.

- [ ] **Step 4: Go / no-go.** If the warm sum is **≤ 200 ms**, continue with approach A. Otherwise **stop**: report the four plans and times, and ask whether to move to approach B (the daily rollup table) before any code is written.

- [ ] **Step 5: The hot-path baseline.** Start the API on the current build and time `/users/me` 200 times:

```bash
mkuser base; for i in $(seq 1 200); do curl -s -o /dev/null -w '%{time_total}\n' -b "$S/jar-base.txt" $API/users/me; done | sort -n | awk '{a[NR]=$1} END {print "p50", a[int(NR*0.5)], "p95", a[int(NR*0.95)]}'
```

Record p50 and p95 as the baseline. Stop the API.

- [ ] **Step 6: Undo everything**

```bash
$PSQLF < "$S/dataset82-drop.sql"
$PSQL -c "drop table user_activity; drop index pd82_p0_po, pd82_p0_tc, pd82_p0_tr"
cleanup
$PSQL -c "select count(*) from users where id like 'pd82u%'"; $PSQL -c "select to_regclass('user_activity')"
```

Expected: `0`, and an empty line (the table is gone). Nothing to commit.

---

### Task 2: Schema, migration and contract

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (models `User`, `PackOpening`, `Trade`; new `UserActivity`)
- Create: `apps/api/prisma/migrations/<timestamp>_admin_metrics/migration.sql` (generated)
- Create: `packages/shared/src/entities/metrics.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/api/src/redis/cache.keys.ts`, `apps/api/src/redis/index.ts`

**Interfaces:**
- Produces (Prisma): `prisma.userActivity`, the table `user_activity ("userId" text, day date)`, and the indexes `pack_openings("createdAt")`, `trades("createdAt")`, `trades("resolvedAt", status)`.
- Produces (shared):
  - `AdminMetricsQuerySchema` (`{ days }` → number) and `type MetricsWindow = number`;
  - `MetricsDaySchema` / `MetricsDay`;
  - `AdminMetricsSchema` / `AdminMetrics`.
- Produces (redis):
  - `cacheKeys.adminMetrics(days: number): string`;
  - `METRICS_NAMESPACE`, `METRIC_COUNTERS`, `type MetricCounter`;
  - `metricsKeys.counter(name: MetricCounter, day: string): string`.

- [ ] **Step 1: The schema.** In `apps/api/prisma/schema.prisma`:

In `model User`, after `auditEntries AuditLog[]`, add:

```prisma
  activity             UserActivity[]
```

Directly after `model User { … }`, add:

```prisma
/// One row per user per UTC day on which they made an authenticated request.
/// Written by SessionGuard, at most once per user per day per process; the
/// source of daily active users.
model UserActivity {
  userId String
  day    DateTime @db.Date

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, day])
  @@index([day])
  @@map("user_activity")
}
```

In `model PackOpening`, after `@@index([userId, createdAt])`, add `@@index([createdAt])`.

In `model Trade`, after `@@index([initiatorId, status])`, add:

```prisma
  @@index([createdAt])
  @@index([resolvedAt, status])
```

Then:

```bash
cd /m/projects/pokedrop/apps/api && pnpm exec prisma migrate dev --name admin_metrics && pnpm exec prisma generate
cat prisma/migrations/*_admin_metrics/migration.sql
```

Expected: a `CREATE TABLE "user_activity"` with its primary key, `CREATE INDEX "user_activity_day_idx"`, `"pack_openings_createdAt_idx"`, `"trades_createdAt_idx"` and `"trades_resolvedAt_status_idx"`, and the foreign key with `ON DELETE CASCADE`.

- [ ] **Step 2: The contract.** Create `packages/shared/src/entities/metrics.ts`:

```ts
import { z } from 'zod';
import { QueueDepthSchema, SyncRunSummarySchema } from './sync.js';

const DaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Count = z.number().int().min(0);

export const AdminMetricsQuerySchema = z.object({
  days: z.enum(['7', '14', '30', '90']).default('14').transform(Number),
});
export type AdminMetricsQuery = z.infer<typeof AdminMetricsQuerySchema>;
export type MetricsWindow = AdminMetricsQuery['days'];

/**
 * One UTC day. Flat, so a chart takes any field as its dataKey. The counter
 * fields are null when Redis could not be read; a day with no traffic is 0.
 */
export const MetricsDaySchema = z.object({
  day: DaySchema,
  partial: z.boolean(),
  activeUsers: Count,
  packsOpened: Count,
  tradesProposed: Count,
  tradesAccepted: Count,
  tradesDeclined: Count,
  tradesCancelled: Count,
  tradesCountered: Count,
  tradesVoided: Count,
  requests: Count.nullable(),
  serverErrors: Count.nullable(),
  errorRate: z.number().min(0).max(1).nullable(),
  packFallbacks: Count.nullable(),
  packUnavailable: Count.nullable(),
});
export type MetricsDay = z.infer<typeof MetricsDaySchema>;

export const AdminMetricsSchema = z.object({
  generatedAt: z.coerce.date(),
  window: z.object({ days: z.number().int(), from: DaySchema, to: DaySchema }),
  series: z.array(MetricsDaySchema).nullable(),
  summary: z.object({ current: MetricsDaySchema, previous: MetricsDaySchema }).nullable(),
  freshness: z
    .object({
      oldestPriceUpdatedAt: z.coerce.date().nullable(),
      cardsWithoutPrice: Count,
      lastRuns: z.array(SyncRunSummarySchema).nullable(),
    })
    .nullable(),
  queues: z.array(QueueDepthSchema).nullable(),
});
export type AdminMetrics = z.infer<typeof AdminMetricsSchema>;
```

In `packages/shared/src/index.ts`, after the `sync.js` line, add `export * from './entities/metrics.js';`.

- [ ] **Step 3: The keys.** In `apps/api/src/redis/cache.keys.ts`:

In `cacheKeys`, after `inventorySummary`, add:

```ts
  adminMetrics: (days: number) => key('admin', 'metrics', days),
```

At the end of the file, add:

```ts
/**
 * Outside the `cache:` namespace for the reason `breakerKeys` is: a routine
 * cache flush must not reset a day's request count.
 */
export const METRICS_NAMESPACE = 'metrics';

export const METRIC_COUNTERS = [
  'requests',
  'server_errors',
  'pack_fallbacks',
  'pack_unavailable',
] as const;

export type MetricCounter = (typeof METRIC_COUNTERS)[number];

export const metricsKeys = {
  /** `day` is an ISO date, `YYYY-MM-DD`, in UTC. */
  counter: (name: MetricCounter, day: string) => `${METRICS_NAMESPACE}:${name}:${day}`,
} as const;
```

In `apps/api/src/redis/index.ts`, add `METRICS_NAMESPACE`, `METRIC_COUNTERS` and `metricsKeys` to the value export list, and add a line `export type { MetricCounter } from './cache.keys.js';`.

- [ ] **Step 4: Verify**

```bash
cd /m/projects/pokedrop && pnpm build:shared >/dev/null && pnpm --filter @pokedrop/api build 2>&1 | grep -i error; pnpm --filter @pokedrop/api typecheck; source "$S/env82.sh"; $PSQL -c "\d user_activity"; $PSQL -c "select indexname from pg_indexes where indexname in ('pack_openings_createdAt_idx','trades_createdAt_idx','trades_resolvedAt_status_idx','user_activity_day_idx') order by 1"
```

Expected: no build errors, typecheck exit 0, the table described with its primary key and foreign key, and the four index names listed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma packages/shared/src/entities/metrics.ts packages/shared/src/index.ts apps/api/src/redis
git commit -m "[PD-82]: add the activity table, metric indexes and contract

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Record activity and count requests

**Files:**
- Create: `apps/api/src/metrics/utc-day.ts`
- Create: `apps/api/src/metrics/activity.service.ts`
- Create: `apps/api/src/metrics/metrics-counter.service.ts`
- Create: `apps/api/src/metrics/request-metrics.middleware.ts`
- Create: `apps/api/src/metrics/metrics.module.ts`
- Create: `apps/api/src/metrics/index.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/common/guards/session.guard.ts`
- Modify: `apps/api/src/packs/pack-opening.service.ts`

**Interfaces:**
- Consumes: `prisma.userActivity` via raw SQL; `METRIC_COUNTERS`, `metricsKeys`, `MetricCounter` (Task 2).
- Produces:
  - `utcDayOf(date: Date): string`;
  - `ActivityService.touch(userId: string): void`;
  - `MetricsCounterService.increment(name: MetricCounter): void`;
  - `MetricsCounterService.read(days: readonly string[]): Promise<CounterTable>`, where `type CounterTable = Map<string, Record<MetricCounter, number>>`;
  - `createRequestMetricsMiddleware(counters: MetricsCounterService): RequestHandler`;
  - `MetricsModule` (global).

- [ ] **Step 1: The day and the activity writer.** Create `apps/api/src/metrics/utc-day.ts`:

```ts
/** `YYYY-MM-DD` in UTC — the day every metric in this module is keyed on. */
export function utcDayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}
```

Create `apps/api/src/metrics/activity.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/index.js';
import { utcDayOf } from './utc-day.js';

/**
 * Called on every authenticated request, so it must cost nothing on all but
 * the first of a user's day: an in-memory set per process answers that, and
 * the one insert is not awaited. Replicas each insert once; the primary key
 * absorbs the duplicate.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);
  private day = '';
  private seen = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  touch(userId: string): void {
    const today = utcDayOf(new Date());
    if (today !== this.day) {
      this.day = today;
      this.seen = new Set();
    }
    if (this.seen.has(userId)) {
      return;
    }
    this.seen.add(userId);

    this.prisma.$executeRaw`
      INSERT INTO user_activity ("userId", day) VALUES (${userId}, ${today}::date)
      ON CONFLICT DO NOTHING`.catch((error: unknown) => {
      this.seen.delete(userId);
      this.logger.warn(
        `Could not record activity for ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
}
```

- [ ] **Step 2: The counters and the middleware.** Create `apps/api/src/metrics/metrics-counter.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { METRIC_COUNTERS, RedisService, metricsKeys, type MetricCounter } from '../redis/index.js';
import { utcDayOf } from './utc-day.js';

/** Past the longest window (90 days), so every day a window asks for exists. */
const COUNTER_TTL_SECONDS = 100 * 86_400;
const WARN_EVERY_MS = 60_000;

export type CounterTable = Map<string, Record<MetricCounter, number>>;

@Injectable()
export class MetricsCounterService {
  private readonly logger = new Logger(MetricsCounterService.name);
  private lastWarnAt = 0;

  constructor(private readonly redis: RedisService) {}

  /** Never awaited by a request. A count lost to a Redis outage is lost. */
  increment(name: MetricCounter): void {
    const key = metricsKeys.counter(name, utcDayOf(new Date()));
    try {
      this.redis.client
        .multi()
        .incr(key)
        .expire(key, COUNTER_TTL_SECONDS)
        .exec()
        .catch((error: unknown) => this.warn(name, error));
    } catch (error) {
      this.warn(name, error);
    }
  }

  /** An absent key is a day with nothing to count: 0, not unknown. */
  async read(days: readonly string[]): Promise<CounterTable> {
    const keys = days.flatMap((day) => METRIC_COUNTERS.map((name) => metricsKeys.counter(name, day)));
    const values = await this.redis.client.mget(...keys);

    const table: CounterTable = new Map();
    days.forEach((day, d) => {
      const row = {} as Record<MetricCounter, number>;
      METRIC_COUNTERS.forEach((name, c) => {
        const raw = values[d * METRIC_COUNTERS.length + c];
        const n = raw === null || raw === undefined ? 0 : Number(raw);
        row[name] = Number.isFinite(n) ? n : 0;
      });
      table.set(day, row);
    });
    return table;
  }

  private warn(name: MetricCounter, error: unknown): void {
    const now = Date.now();
    if (now - this.lastWarnAt < WARN_EVERY_MS) {
      return;
    }
    this.lastWarnAt = now;
    this.logger.warn(
      `Could not count ${name}: ${error instanceof Error ? error.message : String(error)}; further failures are silent for a minute`,
    );
  }
}
```

Create `apps/api/src/metrics/request-metrics.middleware.ts`:

```ts
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { MetricsCounterService } from './metrics-counter.service.js';

const API_PREFIX = '/api/v1/';
const HEALTH_PREFIX = '/api/v1/health';

/**
 * Express, mounted in main.ts, rather than a Nest interceptor: interceptors run
 * after guards and never see a 401 from SessionGuard or a 404 from the
 * not-found handler. `finish` sees every final status.
 */
export function createRequestMetricsMiddleware(counters: MetricsCounterService): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (request.path.startsWith(API_PREFIX) && !request.path.startsWith(HEALTH_PREFIX)) {
      response.on('finish', () => {
        counters.increment('requests');
        if (response.statusCode >= 500) {
          counters.increment('server_errors');
        }
      });
    }
    next();
  };
}
```

Create `apps/api/src/metrics/metrics.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { ActivityService } from './activity.service.js';
import { MetricsCounterService } from './metrics-counter.service.js';

@Global()
@Module({
  providers: [ActivityService, MetricsCounterService],
  exports: [ActivityService, MetricsCounterService],
})
export class MetricsModule {}
```

Create `apps/api/src/metrics/index.ts`:

```ts
export { ActivityService } from './activity.service.js';
export { MetricsCounterService } from './metrics-counter.service.js';
export type { CounterTable } from './metrics-counter.service.js';
export { MetricsModule } from './metrics.module.js';
export { createRequestMetricsMiddleware } from './request-metrics.middleware.js';
export { utcDayOf } from './utc-day.js';
```

- [ ] **Step 3: Wire it in.**
  - **`apps/api/src/app.module.ts`:** add `import { MetricsModule } from './metrics/index.js';` and put `MetricsModule` in `imports` directly after `RedisModule`.
  - **`apps/api/src/main.ts`:** add `import { MetricsCounterService, createRequestMetricsMiddleware } from './metrics/index.js';`. Directly after `app.use(requestIdMiddleware);`, add:

```ts
  app.use(createRequestMetricsMiddleware(app.get(MetricsCounterService)));
```

  - **`apps/api/src/common/guards/session.guard.ts`:** add `import { ActivityService } from '../../metrics/index.js';`, add `private readonly activity: ActivityService,` as the last constructor parameter, and change the block that sets the auth context to:

```ts
    if (session && !suspended) {
      setAuthContext(request, session);
      this.activity.touch(session.user.id);
    }
```

  - **`apps/api/src/packs/pack-opening.service.ts`:** add `import { MetricsCounterService } from '../metrics/index.js';` and `private readonly counters: MetricsCounterService,` as the last constructor parameter. In `openFresh`:
    - after the `logger.warn` for fallbacks, inside the same `if`, add `this.counters.increment('pack_fallbacks');`;
    - after the `logger.error` for `EmptySlotError`, before the `throw`, add `this.counters.increment('pack_unavailable');`.

- [ ] **Step 4: Build, typecheck and lint**

```bash
pnpm build:shared >/dev/null && pnpm --filter @pokedrop/api build 2>&1 | grep -i error; pnpm --filter @pokedrop/api typecheck; pnpm exec eslint apps/api/src/metrics apps/api/src/common/guards apps/api/src/packs apps/api/src/main.ts apps/api/src/app.module.ts
```

Expected: no errors. Also start the worker once (`node apps/api/dist/worker.js`, stop it after it logs `Worker started`) to confirm `WorkerModule` still boots without `MetricsModule`.

- [ ] **Step 5: Verify (spec scenarios 2, 3 and 5, write side).** Start the API, then:

```bash
source "$S/env82.sh"
mkuser a; admin a; signin a; mkuser m
T=$(today); U=$(uid m)
# 2 - five requests, one row
for i in 1 2 3 4 5; do req m GET /users/me >/dev/null; done
$PSQL -c "select count(*) from user_activity where \"userId\" = '$U' and day = '$T'"
# an anonymous request to a public route writes nothing
before=$($PSQL -c "select count(*) from user_activity where day = '$T'"); req anon GET /packs/templates >/dev/null; after=$($PSQL -c "select count(*) from user_activity where day = '$T'"); echo "anon: $before -> $after"
# a suspended user's surviving session adds nothing (Review Focus)
mkuser s; S_ID=$(uid s); $PSQL -c "update users set \"suspendedAt\" = now() where id = '$S_ID'" >/dev/null; req s GET /users/me | grep -o '|[0-9]*$'; $PSQL -c "select count(*) from user_activity where \"userId\" = '$S_ID'"
# 5 - requests and 5xx counters, 404 and 401 counted, health not
r0=$(counter requests); req anon GET /users/me >/dev/null; req anon GET /no-such-route >/dev/null; curl -s -o /dev/null $API/health/live; sleep 1; r1=$(counter requests); echo "requests: $r0 -> $r1 (expect +2)"
e0=$(counter server_errors)
$PSQL -c "create function pd82_fail() returns trigger language plpgsql as \$\$ begin raise exception 'pd82 injected'; end \$\$; create trigger pd82_fail before insert on audit_logs for each row execute function pd82_fail();"
req a POST /admin/users/$U/role -d '{"role":"ADMIN"}' | grep -o '|[0-9]*$'
$PSQL -c "drop trigger pd82_fail on audit_logs; drop function pd82_fail();"
sleep 1; echo "server_errors: $e0 -> $(counter server_errors) (expect +1)"
$RC TTL "metrics:requests:$T"
# 3 - pack counters, through templates that drifted from the catalog (inserted past the API's validation)
SET_ID=$($PSQL -c "select \"setId\" from cards where rarity is not null group by 1 order by 1 limit 1"); RAR=$($PSQL -c "select rarity from cards where \"setId\" = '$SET_ID' and rarity is not null limit 1")
$PSQL -c "insert into pack_templates (id, name, \"setFilter\", cost, \"slotConfig\", active) values
  ('pd82-fb', 'PD82 fallback', '{\"setIds\":[\"$SET_ID\"]}', 0, '{\"slots\":[{\"count\":1,\"weights\":{\"PD82 Missing\":1000000,\"$RAR\":1}}]}', true),
  ('pd82-na', 'PD82 unavailable', '{\"setIds\":[\"$SET_ID\"]}', 0, '{\"slots\":[{\"count\":1,\"weights\":{\"PD82 Missing\":1}}]}', true)"
f0=$(counter pack_fallbacks); n0=$(counter pack_unavailable)
for i in 1 2 3; do req m POST /packs/pd82-fb/open -d "{\"openId\":\"$(node -e 'console.log(crypto.randomUUID())')\"}" | grep -o '|[0-9]*$'; done
req m POST /packs/pd82-na/open -d "{\"openId\":\"$(node -e 'console.log(crypto.randomUUID())')\"}" | strip
sleep 1; echo "pack_fallbacks: $f0 -> $(counter pack_fallbacks) (expect +3); pack_unavailable: $n0 -> $(counter pack_unavailable) (expect +1)"
```

Expected:
- **Activity:** `1` (five requests, one row); `anon: N -> N`; the suspended user gets `|403` and `0` rows.
- **Request counters:** `requests` +2 (the 401 and the 404; health uncounted); the forced role change `|500`, and `server_errors` +1; the TTL is about `8640000`.
- **Pack counters:** three `|200` opens; `{"statusCode":409,…,"code":"PACK_UNAVAILABLE"} |409`; `pack_fallbacks` +3, `pack_unavailable` +1.

An empty counter before the first increment prints as empty. Treat it as 0.

Then restart the API (stop and start) and, as the same member, make one more request:

```bash
signin m >/dev/null; req m GET /users/me >/dev/null; sleep 1; $PSQL -c "select count(*) from user_activity where \"userId\" = '$U' and day = '$T'"
```

Expected: still `1` — the restarted process inserted again and `ON CONFLICT` absorbed it. Run `cleanup` and stop the API.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/metrics apps/api/src/app.module.ts apps/api/src/main.ts apps/api/src/common/guards/session.guard.ts apps/api/src/packs/pack-opening.service.ts
git commit -m "[PD-82]: record daily activity and count requests and pack refusals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The metrics endpoint

**Files:**
- Create: `apps/api/src/admin/admin-metrics.service.ts`
- Create: `apps/api/src/admin/admin-metrics.controller.ts`
- Create: `apps/api/src/admin/admin-metrics.dto.ts`
- Modify: `apps/api/src/admin/admin.module.ts`

**Interfaces:**
- Consumes: `AdminMetricsSchema`, `AdminMetricsQuerySchema`, `AdminMetrics`, `MetricsDay`, `MetricsWindow` (Task 2); `cacheKeys.adminMetrics` (Task 2); `MetricsCounterService.read`, `CounterTable` (Task 3); `AdminSyncService.status()` and `withTimeout` (PD-81).
- Produces: `GET /api/v1/admin/metrics?days=`; `AdminMetricsService.metrics(days: MetricsWindow): Promise<AdminMetrics>`; `windowDays(now: Date, days: number): string[]`.

- [ ] **Step 1: The service.** Create `apps/api/src/admin/admin-metrics.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import {
  AdminMetricsSchema,
  type AdminMetrics,
  type MetricsDay,
  type MetricsWindow,
} from '@pokedrop/shared';
import { MetricsCounterService, type CounterTable } from '../metrics/index.js';
import { PrismaService } from '../prisma/index.js';
import { CacheService, cacheKeys } from '../redis/index.js';
import { AdminSyncService } from './admin-sync.service.js';
import { withTimeout } from './with-timeout.js';

const CACHE_TTL_SECONDS = 60;
const DAY_MS = 86_400_000;

type DayRow = { day: string; n: bigint };
type StatusRow = DayRow & { status: string };
type DayCounts = Map<string, number>;

type Aggregates = {
  activeUsers: DayCounts;
  packsOpened: DayCounts;
  tradesProposed: DayCounts;
  resolved: Map<string, DayCounts>;
};

@Injectable()
export class AdminMetricsService {
  private readonly logger = new Logger(AdminMetricsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly counters: MetricsCounterService,
    private readonly sync: AdminSyncService,
  ) {}

  async metrics(days: MetricsWindow): Promise<AdminMetrics> {
    const key = cacheKeys.adminMetrics(days);
    const cached = await this.cache.get(key, AdminMetricsSchema);
    if (cached !== null) {
      return cached;
    }
    const fresh = await this.compute(days);
    await this.cache.set(key, fresh, CACHE_TTL_SECONDS);
    return fresh;
  }

  private async compute(days: number): Promise<AdminMetrics> {
    const now = new Date();
    const window = windowDays(now, days);
    const from = window[0] as string;
    const to = window[window.length - 1] as string;

    const [aggregates, counters, prices, status] = await Promise.all([
      this.section('aggregates', () => this.aggregates(from)),
      this.section('counters', () => withTimeout(this.counters.read(window), 'metrics counters')),
      this.section('prices', () => this.priceFreshness()),
      this.sync.status(),
    ]);

    const series =
      aggregates === null
        ? null
        : window.map((day) => toDay(day, day === to, aggregates, counters));
    const current = series?.at(-2);
    const previous = series?.at(-3);

    return AdminMetricsSchema.parse({
      generatedAt: now,
      window: { days, from, to },
      series,
      summary: current && previous ? { current, previous } : null,
      freshness: prices === null ? null : { ...prices, lastRuns: status.runs },
      queues: status.queues,
    });
  }

  private async section<T>(name: string, read: () => Promise<T>): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      this.logger.warn(
        `metrics: ${name} unreadable - ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** Each a range scan on its own index; see docs/API.md, Admin / Metrics. */
  private async aggregates(from: string): Promise<Aggregates> {
    const [active, packs, proposed, resolved] = await Promise.all([
      this.prisma.$queryRaw<DayRow[]>`
        SELECT to_char(day, 'YYYY-MM-DD') AS day, count(*) AS n
        FROM user_activity WHERE day >= ${from}::date GROUP BY 1`,
      this.prisma.$queryRaw<DayRow[]>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, count(*) AS n
        FROM pack_openings WHERE "createdAt" >= ${from}::timestamp GROUP BY 1`,
      this.prisma.$queryRaw<DayRow[]>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, count(*) AS n
        FROM trades WHERE "createdAt" >= ${from}::timestamp GROUP BY 1`,
      this.prisma.$queryRaw<StatusRow[]>`
        SELECT to_char(date_trunc('day', "resolvedAt"), 'YYYY-MM-DD') AS day,
               status::text AS status, count(*) AS n
        FROM trades WHERE "resolvedAt" >= ${from}::timestamp GROUP BY 1, 2`,
    ]);

    const byStatus = new Map<string, DayCounts>();
    for (const row of resolved) {
      const counts = byStatus.get(row.status) ?? new Map<string, number>();
      counts.set(row.day, Number(row.n));
      byStatus.set(row.status, counts);
    }

    return {
      activeUsers: countsOf(active),
      packsOpened: countsOf(packs),
      tradesProposed: countsOf(proposed),
      resolved: byStatus,
    };
  }

  private async priceFreshness(): Promise<{
    oldestPriceUpdatedAt: Date | null;
    cardsWithoutPrice: number;
  }> {
    const [oldest, cardsWithoutPrice] = await Promise.all([
      this.prisma.card.aggregate({ _min: { priceUpdatedAt: true } }),
      this.prisma.card.count({ where: { priceUpdatedAt: null } }),
    ]);
    return { oldestPriceUpdatedAt: oldest._min.priceUpdatedAt, cardsWithoutPrice };
  }
}

/** `days` UTC dates ending today, oldest first. */
export function windowDays(now: Date, days: number): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, i) =>
    new Date(today - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10),
  );
}

function countsOf(rows: DayRow[]): DayCounts {
  return new Map(rows.map((row) => [row.day, Number(row.n)]));
}

function toDay(
  day: string,
  partial: boolean,
  aggregates: Aggregates,
  counters: CounterTable | null,
): MetricsDay {
  const counted = counters?.get(day) ?? null;
  const requests = counted?.requests ?? null;
  const serverErrors = counted?.server_errors ?? null;
  const resolved = (status: string): number => aggregates.resolved.get(status)?.get(day) ?? 0;

  return {
    day,
    partial,
    activeUsers: aggregates.activeUsers.get(day) ?? 0,
    packsOpened: aggregates.packsOpened.get(day) ?? 0,
    tradesProposed: aggregates.tradesProposed.get(day) ?? 0,
    tradesAccepted: resolved('ACCEPTED'),
    tradesDeclined: resolved('DECLINED'),
    tradesCancelled: resolved('CANCELLED'),
    tradesCountered: resolved('COUNTERED'),
    tradesVoided: resolved('VOIDED'),
    requests,
    serverErrors,
    errorRate:
      requests === null || serverErrors === null || requests === 0 ? null : serverErrors / requests,
    packFallbacks: counted?.pack_fallbacks ?? null,
    packUnavailable: counted?.pack_unavailable ?? null,
  };
}
```

- [ ] **Step 2: The route.** Create `apps/api/src/admin/admin-metrics.dto.ts`:

```ts
import { AdminMetricsQuerySchema } from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

export class AdminMetricsQueryDto extends createZodDto('AdminMetricsQuery', AdminMetricsQuerySchema) {}
```

Create `apps/api/src/admin/admin-metrics.controller.ts`:

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AdminMetrics } from '@pokedrop/shared';
import { Roles } from '../common/decorators/roles.decorator.js';
import { AdminMetricsQueryDto } from './admin-metrics.dto.js';
import { AdminMetricsService } from './admin-metrics.service.js';

@ApiTags('admin')
@Roles(['ADMIN'])
@Controller('admin')
export class AdminMetricsController {
  constructor(private readonly metrics: AdminMetricsService) {}

  @Get('metrics')
  get(@Query() query: AdminMetricsQueryDto): Promise<AdminMetrics> {
    return this.metrics.metrics(query.days);
  }
}
```

In `apps/api/src/admin/admin.module.ts`, import both files, add `AdminMetricsController` to `controllers` and `AdminMetricsService` to `providers`.

- [ ] **Step 3: Build, typecheck and lint**

```bash
pnpm build:shared >/dev/null && pnpm --filter @pokedrop/api build 2>&1 | grep -i error; pnpm --filter @pokedrop/api typecheck; pnpm exec eslint apps/api/src/admin
```

Expected: no errors.

- [ ] **Step 4: Verify (spec scenarios 1, 3, 4, 5, 6, 7 and 8).** Start the API, then:

```bash
source "$S/env82.sh"
mkuser a; admin a; signin a; mkuser m; mkuser n; T=$(today); Y=$(date -u -d yesterday +%F); M=$(uid m); N=$(uid n)
# 1 - access, validation, shape
echo "member $(req m GET /admin/metrics | grep -o '|[0-9]*$') anon $(req anon GET /admin/metrics | grep -o '|[0-9]*$') days=5 $(req a GET '/admin/metrics?days=5' | grep -o '|[0-9]*$')"
nocache; req a GET /admin/metrics | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s.replace(/ \|\d+$/,''));const d=j.series.map(r=>r.day);console.log(j.window, d.length, d[0], d.at(-1), j.series.at(-1).partial, j.series.slice(0,-1).some(r=>r.partial), j.summary.current.day, j.summary.previous.day)})"
nocache; req a GET '/admin/metrics?days=90' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s.replace(/ \|\d+$/,''));console.log(j.series.length)})"
# 4 - trades placed on today and yesterday by SQL, counted by the right column
$PSQL -c "insert into trades (id, \"initiatorId\", \"recipientId\", status, \"createdAt\", \"resolvedAt\") values
  ('pd82-t1', '$M', '$N', 'ACCEPTED', (now() at time zone 'utc') - interval '30 hours', (now() at time zone 'utc') - interval '1 minute'),
  ('pd82-t2', '$M', '$N', 'DECLINED', '$Y 12:00', '$Y 13:00'),
  ('pd82-t3', '$M', '$N', 'CANCELLED', '$Y 12:00', '$Y 23:59:59'),
  ('pd82-t4', '$M', '$N', 'PENDING', (now() at time zone 'utc'), null)"
nocache; row "$T"; row "$Y"
# Review Focus - a row on yesterday is yesterday's; a day with no counter keys reads 0
$PSQL -c "insert into user_activity (\"userId\", day) values ('$N', '$Y') on conflict do nothing"
nocache; row "$Y" | grep -o '"activeUsers":[0-9]*\|"requests":[0-9a-z]*\|"errorRate":[0-9.a-z]*'
# 6 - freshness and queues equal the sync status (AC2)
nocache; req a GET /admin/metrics | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s.replace(/ \|\d+$/,''));console.log(JSON.stringify({r:j.freshness.lastRuns,q:j.queues}))})" > "$S/m.json"
req a GET /admin/sync/status | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s.replace(/ \|\d+$/,''));console.log(JSON.stringify({r:j.runs,q:j.queues}))})" > "$S/s.json"
cmp "$S/m.json" "$S/s.json" && echo "AC2 identical"
# 7 - cache
nocache; g1=$(req a GET /admin/metrics | grep -o '"generatedAt":"[^"]*"'); g2=$(req a GET /admin/metrics | grep -o '"generatedAt":"[^"]*"'); nocache; g3=$(req a GET /admin/metrics | grep -o '"generatedAt":"[^"]*"'); echo "$g1 | $g2 | $g3"
# 8 - Redis stopped, then pack_openings unreadable
docker compose stop redis >/dev/null 2>&1; t=$(date +%s%N); req a GET /admin/metrics | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s.replace(/ \|\d+$/,''));const r=j.series.at(-1);console.log(r.activeUsers, r.requests, r.errorRate, j.queues, j.freshness && j.freshness.lastRuns !== undefined)})"; echo "$(( ($(date +%s%N) - t) / 1000000 )) ms"; docker compose start redis >/dev/null 2>&1; sleep 3
nocache; $PSQL -c "alter table pack_openings rename to pack_openings_pd82"; req a GET /admin/metrics | strip | cut -c1-240; $PSQL -c "alter table pack_openings_pd82 rename to pack_openings"
```

Expected:

**Scenario 1** (access, validation, shape):
- `member |403 anon |401 days=5 |400`;
- the 14-day window prints `{ days: 14, from, to: <today> } 14 <from> <today> true false <yesterday> <day before>`;
- the 90-day window prints `90`.

**Scenario 4** (trades placed on today and yesterday):
- the row for today has `tradesAccepted` ≥ 1 (`pd82-t1` resolved today, created yesterday) and `tradesProposed` ≥ 1 (`pd82-t4`);
- the row for yesterday has `tradesDeclined` ≥ 1, `tradesCancelled` ≥ 1 (`23:59:59` counts as yesterday) and `tradesProposed` ≥ 3 (`t1`, `t2`, `t3`).

**Review Focus** (a row on yesterday; a day with no counter keys):
- yesterday's `activeUsers` ≥ 1;
- `requests` is a number (`0` if nothing hit the API yesterday), never `null`;
- `errorRate` is `null` if `requests` is `0`, and otherwise a number ≥ 0.

**Scenario 6** (freshness and queues against the sync status):
- `AC2 identical`. If it differs only because a queue count changed between the two reads, run it again.

**Scenario 7** (cache):
- `g1` equals `g2`, and `g3` differs.

**Scenario 8** (Redis stopped, then `pack_openings` unreadable):
- with Redis stopped: a number, `null`, `null`, `null` (queues), and `true`, within about 2.5 s;
- with `pack_openings` renamed: `"series":null` and `"summary":null`, with `freshness` and `queues` present.

Scenario 3 (the pack counters in the response): open once more against `pd82-fb` (recreate it as in Task 3, Step 5 if `cleanup` removed it), then `nocache; row "$T"`. Expected: `packFallbacks` ≥ 1, and `requests` and `serverErrors` numbers.

Run `$PSQL -c "delete from trades where id like 'pd82-t%'"`, then `cleanup`, and stop the API.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/admin
git commit -m "[PD-82]: serve admin metrics by day, cached, each section nullable

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The budget and the hot path

**Files:**
- None changed, unless the numbers miss.

**Interfaces:**
- Consumes: the endpoint (Task 4), the dataset scripts and the Task 1 baseline.

- [ ] **Step 1: Load the dataset** (the migration now owns `user_activity` and the indexes)

```bash
source "$S/env82.sh"; time $PSQLF < "$S/dataset82.sql" | tail -6
$PSQLF < "$S/explain82.sql" > "$S/explain82-final.txt"; grep -E 'Scan|Execution Time' "$S/explain82-final.txt"
```

Expected: the four counts as in Task 1 and no `Seq Scan`.

- [ ] **Step 2: Measure the endpoint (AC1).** Start the API:

```bash
mkuser a; admin a; signin a
for i in $(seq 1 20); do nocache; curl -s -o /dev/null -w '%{time_total}\n' -b "$S/jar-a.txt" "$API/admin/metrics?days=90"; done | sort -n | awk '{a[NR]=$1} END {print "p50", a[int(NR*0.5)], "p95", a[int(NR*0.95)], "max", a[NR]}'
curl -s -o /dev/null -w 'cached %{time_total}\n' -b "$S/jar-a.txt" "$API/admin/metrics?days=90"
```

Expected: p50 and p95 ≤ 0.300 s; the cached read well under that. If p95 is over, profile with the explain output and the API log before changing anything, and ledger what you find.

- [ ] **Step 3: The hot path (spec scenario 10)**

```bash
mkuser base; for i in $(seq 1 200); do curl -s -o /dev/null -w '%{time_total}\n' -b "$S/jar-base.txt" $API/users/me; done | sort -n | awk '{a[NR]=$1} END {print "p50", a[int(NR*0.5)], "p95", a[int(NR*0.95)]}'
```

Expected: p50 within ~1 ms of Task 1's baseline. Record both.

- [ ] **Step 4: Undo the dataset**

```bash
$PSQLF < "$S/dataset82-drop.sql"; cleanup; $PSQL -c "select count(*) from users where id like 'pd82u%'"
```

Expected: `0`. Stop the API. Nothing to commit.

---

### Task 6: Documentation and Linear

**Files:**
- Modify: `docs/API.md` (the Admin / Sync table's metrics row; a new `## Admin / Metrics` section before `## Health`)
- Modify: `docs/DataModel.md` (a new `UserActivity` section; the indexes on PackOpening and Trade)
- Create: `apps/api/src/metrics/README.md`

- [ ] **Step 1: `docs/API.md`.**
  - In the `## Admin / Sync` table, change the metrics row's notes to `Daily activity, packs, trades, errors and freshness — see [Admin / Metrics](#admin--metrics)`.
  - Add `## Admin / Metrics` before `## Health`, covering:
    - the query and its 400;
    - the contract, as in the spec;
    - each field's definition — UTC days, `partial`, trade volume as `tradesAccepted` by `resolvedAt`, expired inside `tradesCancelled`, what `requests` counts and excludes, `packFallbacks` counted per opening, `null` against `0`;
    - why the cards are yesterday against the day before;
    - the 60 s cache and `generatedAt`;
    - the degradation table;
    - that `freshness.lastRuns` and `queues` are the sync status's own read;
    - a **Measured, <date>** list with the actual results of Tasks 1–5 — the explain times, p50/p95, the hot-path numbers, and every scenario's observed outcome.

- [ ] **Step 2: `docs/DataModel.md`.**
  - Add a `### UserActivity` section after `### AuditLog`'s block (or beside User, following the file's order): the fields, the primary key, the `(day)` index, `ON DELETE CASCADE`, who writes it and how often, and the growth estimate (no retention job).
  - Under PackOpening and Trade, add the new indexes and what reads them.

- [ ] **Step 3: `apps/api/src/metrics/README.md`.** One page covering:
  - **why activity skips Redis and `await`** (and what a failed insert costs);
  - **why a middleware in `main.ts` and not a Nest interceptor**, with the 404 and 401 cases;
  - **the counters:** key names, TTL, never awaited, the once-a-minute warning;
  - **the measured hot-path cost** from Task 5.

- [ ] **Step 4: Format check and commit**

```bash
npx prettier --check docs/API.md docs/DataModel.md apps/api/src/metrics/README.md
git add docs/API.md docs/DataModel.md apps/api/src/metrics/README.md
git commit -m "[PD-82]: document the metrics, their sources and what they measured

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Linear.** Mark PD-82 Done. Comment on PD-121 (the admin dashboard page) with the contract's location (`@pokedrop/shared` `AdminMetricsSchema`, `docs/API.md` Admin / Metrics) and that the cards read `summary`, the chart reads `series`, and both are UTC.
