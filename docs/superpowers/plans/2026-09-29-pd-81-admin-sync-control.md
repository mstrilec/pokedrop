# PD-81 Admin Sync Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin trigger a catalog sync or a full price sweep, and reset a provider breaker, without being able to queue a duplicate run or spend the provider budget twice; and make the sync status tell the truth about crashed runs and about Redis or Postgres being unreadable.

**Architecture:** One BullMQ deduplication key per queue, shared by the crons and the admin route. The admin route writes its audit row and then enqueues inside one Prisma transaction. A final job failure closes its `SyncRun` through a worker `failed` handler, and the status derives `stale` at read time. The status reads each section independently under a 2 s Redis timeout, with `null` meaning unknown.

**Tech Stack:** NestJS 12, `@nestjs/bullmq` 12 / BullMQ 5.81.5, Prisma 7 (PostgreSQL), ioredis, Zod 4 in `@pokedrop/shared`.

**Spec:** `docs/superpowers/specs/2026-09-29-pd-81-admin-sync-control-design.md`

## Global Constraints

- **No automated tests, runners or CI test steps during v1.** Every verification step below is a build or typecheck, plus a probe against the running stack (HTTP, `psql`, `redis-cli`, a small `node` script).
- Commit straight to `dev`. Subject is `[PD-81]: short lowercase description`, header ≤ 72 characters, and the message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Comments only where load-bearing; rationale belongs in `docs/`.
- `POST /admin/sync/catalog` → queue `catalog-sync`, job name `catalog-sync`, kind `CATALOG`. `POST /admin/sync/prices` → queue `price-sweep`, job name `price-sweep`, kind `PRICE`. Both answer **202** `{ jobId, kind }`.
- Refusal: **409** `SYNC_IN_PROGRESS`, message `<A catalog sync|A price sweep> is already queued or running (job <id>)`. A catalog trigger is refused while a price sweep holds its key, and the reverse.
- Audit actions: `sync.trigger` (entity `SyncJob`, `entityId` = the job id, `meta: { kind, queue }`) and `sync.breaker_reset` (entity `Provider`, `entityId` = the provider name, `meta: { failures, openUntil }` before the reset). The actor is the admin. The audit row is written first, then the Redis write, in one transaction.
- Redis unavailable on a trigger or a reset → **503** with no `code`. An unknown provider → **404** `Provider not found`.
- Every admin read or write against BullMQ or the breaker keys runs under a **2 000 ms** timeout.
- Status: `runs`, `queues` and `breakers` are each `null` when unreadable and `[]` when empty. `GET` never writes.
- **Provider budget:** at most one real catalog run end to end. Every other scenario runs against a paused queue, fails before its first request, or runs on the TCGdex fallback (TCGdex has no daily cap).

## Review Focus

- **An open breaker key with no TTL (`ttl = -1`).** `ProviderBreakerService.isOpen()` reads it as open, but a TTL-based reading would call it closed. The reset must treat any present open key as "something to reset", and must not answer a no-op 200 while the selector still refuses the provider. Pinned in Task 5, Step 4.
- **A trigger racing another trigger of the same kind.** Exactly one job and exactly one audit row, never two of either. Pinned in Task 5, Step 4.
- **Postgres wholly down is unreachable through HTTP.** `SessionGuard` needs Postgres to authenticate, so `runs: null` can only be shown with `sync_runs` unreadable while the rest of the database answers. The probe revokes `SELECT` on that one table rather than stopping Postgres. Pinned in Task 4, Step 5.
- **A paused queue must still hold the dedup key and count its job as waiting.** Otherwise the probes that rely on pausing prove nothing. Pinned in Task 1, Step 2 (0.1) and in every later task that pauses.
- **A trigger whose `add` is still in ioredis' offline queue when the 2 s timeout fires.** The transaction rolls back, but the `add` may reach Redis once it returns: a job with no audit row. Measured in Task 5, Step 4 (scenario 10). If it happens, it goes into `docs/DataModel.md` as part of the first accepted residual.

---

## Shared probe setup

Every task's verification uses this file. Create it once (Task 1, Step 1) at `$S/env81.sh`:

```bash
cd /m/projects/pokedrop
S="C:/Users/MaxSt/AppData/Local/Temp/claude/M--projects-pokedrop/a173296c-ebb8-4245-b075-03d2c93dd1ae/scratchpad"
PSQL="docker compose exec -T postgres psql -U pokedrop -d pokedrop -At"
RQ="docker compose exec -T redis redis-cli -n 1"
RC="docker compose exec -T redis redis-cli -n 0"
API=http://localhost:4000/api/v1; AUTH=http://localhost:4000/api/auth; WEB=http://localhost:3000
P=pd81
req(){ who=$1; shift; m=$1; shift; p=$1; shift; if [ "$who" = anon ]; then curl -s -w ' |%{http_code}' -X "$m" "$API$p" -H 'Content-Type: application/json' "$@"; else curl -s -w ' |%{http_code}' -b "$S/jar-$who.txt" -X "$m" "$API$p" -H 'Content-Type: application/json' -H "Origin: $WEB" "$@"; fi; echo; }
strip(){ sed -E 's/,"requestId":"[^"]*"//'; }
signin(){ curl -s -o /dev/null -w "sign-in $1 %{http_code}\n" -c "$S/jar-$1.txt" -X POST "$AUTH/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $WEB" -d "{\"email\":\"$P-$1@example.com\",\"password\":\"correct-horse-battery\"}"; }
mkuser(){ curl -s -o /dev/null -X POST "$AUTH/sign-up/email" -H 'Content-Type: application/json' -H "Origin: $WEB" -d "{\"email\":\"$P-$1@example.com\",\"password\":\"correct-horse-battery\",\"name\":\"PD81 $1\"}"; $PSQL -c "update users set \"emailVerified\" = true where email = '$P-$1@example.com'" >/dev/null; signin $1; }
admin(){ $PSQL -c "update users set role = 'ADMIN' where email = '$P-$1@example.com'" >/dev/null; }
uid(){ $PSQL -c "select id from users where email = '$P-$1@example.com'"; }
# BullMQ from apps/api, where the package resolves. $1 = queue, $2 = statements using `q`.
qjs(){ (cd /m/projects/pokedrop/apps/api && node --input-type=module -e "import { Queue } from 'bullmq'; const q = new Queue(process.argv[1], { connection: { url: 'redis://localhost:6379', db: 1 } }); try { $2 } finally { await q.close(); }" "$1"); }
qpause(){ qjs "$1" 'await q.pause(); console.log("paused", q.name);'; }
qresume(){ qjs "$1" 'await q.resume(); console.log("resumed", q.name);'; }
qcounts(){ qjs "$1" 'console.log(q.name, JSON.stringify(await q.getJobCounts("waiting", "paused", "active", "delayed", "failed")));'; }
qholder(){ qjs "$1" 'console.log(q.name, "holder", await q.getDeduplicationJobId(q.name));'; }
# Remove waiting jobs and the dedup key they held. Only for probe jobs on a paused queue.
qdrain(){ qjs "$1" 'await q.drain(true); await q.removeDeduplicationKey(q.name); console.log("drained", q.name);'; }
audits(){ $PSQL -c "select action||' '||entity||' '||\"entityId\"||' '||meta::text from audit_logs where action like 'sync.%' order by \"createdAt\""; }
cleanup(){
  $PSQL -c "delete from audit_logs where action like 'sync.%'"
  $PSQL -c "delete from sync_runs where \"jobId\" like 'pd81-%'"
  $PSQL -c "delete from users where email like '$P-%'"; rm -f "$S"/jar-*.txt
}
```

`$RQ` is the queue database (1) and `$RC` the cache database (0), where the breaker keys live.

**Starting the API.** Stop any previous one (PowerShell tool), then build and start it (Bash):

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'apps[/\\]api[/\\]dist[/\\]main\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }
```

```bash
source "C:/Users/MaxSt/AppData/Local/Temp/claude/M--projects-pokedrop/a173296c-ebb8-4245-b075-03d2c93dd1ae/scratchpad/env81.sh"
pnpm build:shared >/dev/null && pnpm --filter @pokedrop/api build 2>&1 | grep -i error
(node apps/api/dist/main.js > "$S/api81.log" 2>&1 &)
for i in $(seq 1 40); do c=$(curl -s -o /dev/null -w '%{http_code}' $API/health/ready); [ "$c" = 200 ] && break; sleep 1; done; echo "ready: $c"
```

End every task by resuming any queue you paused, running `cleanup`, and stopping the API.

---

### Task 1: Probe 0 — measure BullMQ before depending on it

**Files:**
- Create: `$S/env81.sh`, `$S/probe0.mjs`, `$S/probe0-down.mjs`, `$S/probe0-fail.mjs` (throwaway, never committed)
- Modify, only if a result contradicts the spec: `docs/superpowers/specs/2026-09-29-pd-81-admin-sync-control-design.md`

**Interfaces:**
- Produces: three recorded facts that later tasks rely on — (0.1) what `add` returns and whether defaults survive when a dedup key is held; (0.2) what a `Queue` call does with Redis stopped; (0.3) the `failed` event and `getState()` for an exhausted job.

- [ ] **Step 1: Write the probe helper file.** Create `$S/env81.sh` with the content of [Shared probe setup](#shared-probe-setup).

- [ ] **Step 2: Probe 0.1 — dedup on a paused queue.** Write `$S/probe0.mjs`:

```js
import { Queue } from 'bullmq';
const connection = { url: 'redis://localhost:6379', db: 1 };
const q = new Queue('pd81-probe', {
  connection,
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
});
await q.pause();
const a = await q.add('x', {}, { jobId: 'pd81-a', deduplication: { id: 'pd81' } });
const b = await q.add('x', {}, { jobId: 'pd81-b', deduplication: { id: 'pd81' } });
console.log('first', a.id, '| second returned', b.id);
console.log('holder', await q.getDeduplicationJobId('pd81'));
console.log('pd81-b stored', (await q.getJob('pd81-b')) !== undefined);
console.log('opts', JSON.stringify((await q.getJob('pd81-a'))?.opts));
console.log('state', await a.getState(), 'counts', JSON.stringify(await q.getJobCounts('waiting', 'paused', 'active', 'delayed', 'failed')));
console.log('missing job state', await q.getJobState('no-such-job'));
await q.obliterate({ force: true });
await q.close();
```

Run it:

```bash
source "$S/env81.sh"
(cd apps/api && node --input-type=module < "$S/probe0.mjs")
```

Record every printed line. The code in Tasks 2 and 5 assumes three things:
- `holder` is `pd81-a`;
- `pd81-b stored` is `false`;
- `opts` still carries `attempts: 3` and the backoff.

Also record whether `state` is `waiting` or `paused`, and under which key the job is counted. That tells Task 4 which counts make up `waiting`. What `second returned` shows does not matter to the code: Task 5 decides a race by reading the holder, not by `add`'s return value.

- [ ] **Step 3: Probe 0.2 — a `Queue` call with Redis stopped.** Write `$S/probe0-down.mjs`:

```js
import { Queue } from 'bullmq';
const q = new Queue('pd81-probe', { connection: { url: 'redis://localhost:6379', db: 1 } });
q.on('error', (e) => console.log('queue error event', e.message));
await q.waitUntilReady();
console.log('ready; stop redis now');
await new Promise((r) => setTimeout(r, 8000));
for (const [label, call] of [
  ['getDeduplicationJobId', () => q.getDeduplicationJobId('pd81')],
  ['getJobCounts', () => q.getJobCounts('waiting')],
  ['add', () => q.add('x', {}, { jobId: 'pd81-down', deduplication: { id: 'pd81-down' } })],
]) {
  const t = Date.now();
  const settled = await Promise.race([
    call().then(() => 'resolved', (e) => `rejected: ${e.message}`),
    new Promise((r) => setTimeout(() => r('still pending after 5 s'), 5000)),
  ]);
  console.log(label, settled, `${Date.now() - t} ms`);
}
console.log('start redis now; waiting 15 s for queued commands to flush');
await new Promise((r) => setTimeout(r, 15000));
console.log('pd81-down exists after recovery', (await q.getJob('pd81-down')) !== undefined);
await q.obliterate({ force: true }).catch(() => {});
await q.close();
```

Run it and stop Redis in the first 8 s. Start it again once the script prints `start redis now`:

```bash
(cd apps/api && node --input-type=module < "$S/probe0-down.mjs") &
sleep 3; docker compose stop redis
# wait for "start redis now" in the output, then:
docker compose start redis; wait
```

Record each line. The `pd81-down exists after recovery` line is the Review Focus item "`add` still in the offline queue". If it prints `true`, a timed-out trigger can leave an unaudited job behind.

- [ ] **Step 4: Probe 0.3 — the `failed` event for an exhausted job.** Write `$S/probe0-fail.mjs`:

```js
import { Queue, Worker } from 'bullmq';
const connection = { url: 'redis://localhost:6379', db: 1 };
const q = new Queue('pd81-probe', { connection });
const w = new Worker('pd81-probe', async () => { throw new Error('probe failure'); }, { connection });
w.on('failed', async (job, err) => {
  console.log('failed event', job?.id, 'attemptsMade', job?.attemptsMade, 'state', await job?.getState(), err.message);
});
await q.add('x', {}, { jobId: 'pd81-fail', attempts: 3, backoff: { type: 'fixed', delay: 200 } });
await new Promise((r) => setTimeout(r, 3000));
await w.close();
await q.obliterate({ force: true });
await q.close();
```

```bash
(cd apps/api && node --input-type=module < "$S/probe0-fail.mjs")
```

Expected: three `failed event` lines. The first two carry a non-`failed` state (`delayed` or `waiting`) and the last carries `failed` with `attemptsMade 3`. If every event reports `failed`, the "final" test in Task 3 is wrong: stop and amend the spec before continuing.

- [ ] **Step 5: Reconcile with the spec.** If any result contradicts the spec, edit the spec's affected section and commit it. Otherwise commit nothing.

```bash
git add docs/superpowers/specs/2026-09-29-pd-81-admin-sync-control-design.md
git commit -m "[PD-81]: amend the design with what probe 0 measured

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: One dedup key per sync queue, used by the crons

**Files:**
- Create: `apps/api/src/queue/sync-dedup.ts`
- Modify: `apps/api/src/queue/index.ts`
- Modify: `apps/api/src/sync/catalog-sync.scheduler.ts`
- Modify: `apps/api/src/sync/price-sweep.scheduler.ts`

**Interfaces:**
- Produces: `type DedupedSyncQueue = 'catalog-sync' | 'price-sweep'`; `SYNC_DEDUP_ID: Record<DedupedSyncQueue, string>`; `syncJobOptions(queue: DedupedSyncQueue, jobId?: string): JobsOptions`. All exported from `apps/api/src/queue/index.ts`.

- [ ] **Step 1: The dedup module.** Create `apps/api/src/queue/sync-dedup.ts`:

```ts
import type { JobsOptions } from 'bullmq';
import { QUEUE } from './queue.constants.js';

export type DedupedSyncQueue = typeof QUEUE.catalogSync | typeof QUEUE.priceSweep;

/**
 * One key per queue, held while a job is waiting, delayed or running. The cron
 * and the admin route both enqueue through it, so neither can queue a second
 * run beside the first.
 */
export const SYNC_DEDUP_ID: Record<DedupedSyncQueue, string> = {
  [QUEUE.catalogSync]: 'catalog-sync',
  [QUEUE.priceSweep]: 'price-sweep',
};

export function syncJobOptions(queue: DedupedSyncQueue, jobId?: string): JobsOptions {
  return {
    ...(jobId === undefined ? {} : { jobId }),
    deduplication: { id: SYNC_DEDUP_ID[queue] },
  };
}
```

Append to `apps/api/src/queue/index.ts`:

```ts
export { SYNC_DEDUP_ID, syncJobOptions } from './sync-dedup.js';
export type { DedupedSyncQueue } from './sync-dedup.js';
```

- [ ] **Step 2: The catalog cron.** In `apps/api/src/sync/catalog-sync.scheduler.ts`, change the import to `import { QUEUE, SYNC_DEDUP_ID, syncJobOptions } from '../queue/index.js';` and replace `enqueue()`:

```ts
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'catalog-sync', timeZone: 'UTC' })
  async enqueue(): Promise<void> {
    const holder = await this.queue.getDeduplicationJobId(SYNC_DEDUP_ID[QUEUE.catalogSync]);
    if (holder !== null) {
      this.logger.warn(`Skipped the catalog sync: job ${holder} is still queued or running`);
      return;
    }
    const job = await this.queue.add('catalog-sync', {}, syncJobOptions(QUEUE.catalogSync));
    this.logger.log(`Enqueued catalog sync as job ${job.id}`);
  }
```

Keep the doc comment above the method.

- [ ] **Step 3: The sweep cron.** In `apps/api/src/sync/price-sweep.scheduler.ts`, the same import change, and replace the body of `enqueue()`. Keep both of its comments and the `@Cron` line exactly as they are:

```ts
  async enqueue(): Promise<void> {
    const holder = await this.queue.getDeduplicationJobId(SYNC_DEDUP_ID[QUEUE.priceSweep]);
    if (holder !== null) {
      this.logger.warn(`Skipped the price sweep: job ${holder} is still queued or running`);
      return;
    }
    const job = await this.queue.add('price-sweep', {}, syncJobOptions(QUEUE.priceSweep));
    this.logger.log(`Enqueued price sweep as job ${job.id}`);
  }
```

- [ ] **Step 4: Verify.** Build, then drive the real scheduler twice against a paused queue. Write `$S/cron81.mjs`:

```js
import { NestFactory } from '@nestjs/core';
const { WorkerModule } = await import('./dist/worker.module.js');
const { CatalogSyncScheduler } = await import('./dist/sync/catalog-sync.scheduler.js');
const app = await NestFactory.createApplicationContext(WorkerModule);
await app.get(CatalogSyncScheduler).enqueue();
await app.get(CatalogSyncScheduler).enqueue();
await app.close();
```

```bash
source "$S/env81.sh"
pnpm build:shared >/dev/null && pnpm --filter @pokedrop/api build 2>&1 | grep -i error; pnpm --filter @pokedrop/api typecheck
qpause catalog-sync
(cd apps/api && node --input-type=module < "$S/cron81.mjs") 2>&1 | grep -E 'Enqueued catalog|Skipped the catalog'
qcounts catalog-sync; qholder catalog-sync
qdrain catalog-sync; qresume catalog-sync; qholder catalog-sync
```

Expected:
- one `Enqueued catalog sync as job N` line, followed by one `Skipped the catalog sync: job N is still queued or running`;
- the counts show exactly one job, as `waiting` or `paused` (whichever Task 1 recorded);
- the holder is `N` before the drain and `null` after it.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/queue apps/api/src/sync/catalog-sync.scheduler.ts apps/api/src/sync/price-sweep.scheduler.ts
git commit -m "[PD-81]: deduplicate the catalog and sweep crons on one key per queue

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Close a run whose job finally failed

**Files:**
- Modify: `apps/api/src/sync/sync-run.service.ts`
- Modify: `apps/api/src/sync/catalog-sync.processor.ts`
- Modify: `apps/api/src/sync/price-sweep.processor.ts`
- Modify: `apps/api/src/sync/price-active.processor.ts`

**Interfaces:**
- Produces: `SyncRunService.closeIfFinallyFailed(kind: SyncKind, job: Job | undefined, error: Error): Promise<void>`, and an `onFailed` worker-event handler on each of the three processors.

- [ ] **Step 1: The service method.** In `apps/api/src/sync/sync-run.service.ts`, add `import type { Job } from 'bullmq';` and, after `close()`:

```ts
  /**
   * Closes the run a job left open when BullMQ gave up on it. BullMQ emits
   * `failed` on every attempt, so only a job whose state is now `failed` is
   * final; a stalled job is failed with attempts to spare, which is why this
   * does not count them. The RUNNING condition leaves a run the processor
   * closed itself untouched.
   */
  async closeIfFinallyFailed(kind: SyncKind, job: Job | undefined, error: Error): Promise<void> {
    if (job?.id === undefined) {
      return;
    }
    try {
      if ((await job.getState()) !== 'failed') {
        return;
      }
      const { count } = await this.prisma.syncRun.updateMany({
        where: { kind, jobId: job.id, status: SyncStatus.RUNNING },
        data: {
          status: SyncStatus.FAILED,
          finishedAt: new Date(),
          error: `job failed after ${job.attemptsMade} attempts: ${error.message}`,
        },
      });
      if (count > 0) {
        this.logger.warn(`job ${job.id}: closed its ${kind} run as FAILED - ${error.message}`);
      }
    } catch (closeError) {
      this.logger.error(
        `job ${job.id}: could not close its ${kind} run - ${closeError instanceof Error ? closeError.message : String(closeError)}`,
      );
    }
  }
```

- [ ] **Step 2: The handlers.** In each of the three processors:
- change `import { Processor, WorkerHost } from '@nestjs/bullmq';` to `import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';`;
- add this method directly after `process()`, substituting `SyncKind.CATALOG`, `SyncKind.PRICE` or `SyncKind.PRICE_ACTIVE` respectively.

`CatalogSyncProcessor`:

```ts
  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, error: Error): Promise<void> {
    await this.runs.closeIfFinallyFailed(SyncKind.CATALOG, job, error);
  }
```

`PriceSweepProcessor`:

```ts
  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, error: Error): Promise<void> {
    await this.runs.closeIfFinallyFailed(SyncKind.PRICE, job, error);
  }
```

`PriceActiveProcessor`:

```ts
  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, error: Error): Promise<void> {
    await this.runs.closeIfFinallyFailed(SyncKind.PRICE_ACTIVE, job, error);
  }
```

- [ ] **Step 3: Build and typecheck**

```bash
pnpm build:shared >/dev/null && pnpm --filter @pokedrop/api build 2>&1 | grep -i error; pnpm --filter @pokedrop/api typecheck
```

Expected: no output from the build grep; typecheck exits 0.

- [ ] **Step 4: Verify the stranded-run path (spec scenario 6).** This spends no requests: the processor throws in `resume()` before it asks any provider. Start the API (see [Shared probe setup](#shared-probe-setup)), then:

```bash
$PSQL -c "insert into sync_runs (id, kind, provider, status, \"jobId\", \"startedAt\") values ('pd81-run-ghost', 'PRICE', 'ghost', 'RUNNING', 'pd81-ghost', now())"
qjs price-sweep "await q.add('price-sweep', {}, { jobId: 'pd81-ghost' }); console.log('added');"
sleep 25
$PSQL -c "select status, \"finishedAt\" is not null, error from sync_runs where id = 'pd81-run-ghost'"
grep -E 'pd81-ghost' "$S/api81.log" | tail -3
```

Expected:
- the row is `FAILED|t|job failed after 3 attempts: A run recorded provider "ghost", which is not registered. …`;
- the log shows `job pd81-ghost: closed its PRICE run as FAILED`.

- [ ] **Step 5: Verify a kill mid-run and a second stall (spec scenario 7).** Force the TCGdex fallback, so the sweep runs long and spends no capped budget, by opening the primary's breaker for 20 minutes:

```bash
$RC SET breaker:open:pokemontcg 1 EX 1200
qjs price-sweep "await q.add('price-sweep', {}, { jobId: 'pd81-kill', deduplication: { id: 'price-sweep' } }); console.log('added');"
sleep 20; $PSQL -c "select id, status, provider, processed from sync_runs where \"jobId\" = 'pd81-kill'"
```

Expected: one `RUNNING` row with provider `tcgdex` and `processed` > 0. Now stop the API with the PowerShell command from [Shared probe setup](#shared-probe-setup) (a hard kill), start it again, and wait ~70 s: 30 s for the lock to lapse, and up to 30 s more for the stalled check.

```bash
sleep 70; $PSQL -c "select id, status, processed from sync_runs where \"jobId\" = 'pd81-kill'"; grep -c 'Resuming sync run' "$S/api81.log"
```

Expected: **still one row**, with the same id, `RUNNING` and `processed` growing, and the log shows `Resuming sync run`. Kill and restart a second time, wait ~70 s again:

```bash
sleep 70; $PSQL -c "select status, error from sync_runs where \"jobId\" = 'pd81-kill'"
```

Expected: `FAILED|job failed after N attempts: job stalled more than allowable limit`. If it is instead `RUNNING` and resumed again, BullMQ's `maxStalledCount` allows more than one stall. Record the count, and kill once more until it fails. Then:

```bash
$RC DEL breaker:open:pokemontcg; qholder price-sweep
```

Expected: the holder is `null` — the failed job released the key. Resume nothing, run `cleanup`, and stop the API.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/sync/sync-run.service.ts apps/api/src/sync/catalog-sync.processor.ts apps/api/src/sync/price-sweep.processor.ts apps/api/src/sync/price-active.processor.ts
git commit -m "[PD-81]: close a sync run as FAILED when its job finally fails

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The status contract, read section by section

**Files:**
- Modify: `packages/shared/src/entities/sync.ts`
- Modify: `packages/shared/src/primitives/error.ts`
- Create: `apps/api/src/sync/providers/provider-choice.ts`
- Modify: `apps/api/src/sync/providers/index.ts`
- Modify: `apps/api/src/sync/providers/provider-selector.service.ts` (`select()`)
- Create: `apps/api/src/admin/with-timeout.ts`
- Modify: `apps/api/src/admin/admin-sync.service.ts`
- Modify: `apps/api/src/admin/admin.module.ts`

**Interfaces:**
- Produces (shared):
  - `SyncRunSummary` gains `jobId: string | null`, `durationMs: number | null` and `stale: boolean | null`;
  - `QueueDepth = { queue, waiting, active, delayed, failed }`;
  - `SyncStatusResponse = { runs | null, queues | null, breakers | null, primaryProvider, nextProvider | null }`;
  - `SyncTriggerKindSchema` / `SyncTriggerKind = 'CATALOG' | 'PRICE'`;
  - `SyncTriggerResultSchema` / `SyncTriggerResult = { jobId, kind }`;
  - `ERROR_CODES.SYNC_IN_PROGRESS`.
- Produces (api):
  - `chooseProvider<T extends string>(primary: T, names: readonly T[], open: ReadonlySet<T>): { name: T; isFallback: boolean } | null`, exported from `sync/providers/index.ts`;
  - `withTimeout<T>(promise: Promise<T>, label: string, ms?: number): Promise<T>` and `ADMIN_REDIS_TIMEOUT_MS = 2_000` in `admin/with-timeout.ts`.

- [ ] **Step 1: The shared contract.** Replace the body of `packages/shared/src/entities/sync.ts`, keeping its two existing doc comments on the schemas they describe:

```ts
import { z } from 'zod';
import { SyncKindSchema, SyncStatusSchema } from '../enums.js';

/**
 * `provider` is a free string rather than an enum, matching the column. A closed
 * enum would need a migration every time a provider is added - the coupling the
 * CardSourceProvider adapter removes.
 *
 * `stale` is true for a RUNNING row whose job is gone or finished, null when
 * the queue could not be read, and false for every closed run.
 */
export const SyncRunSummarySchema = z.object({
  kind: SyncKindSchema,
  provider: z.string().min(1),
  status: SyncStatusSchema,
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullable(),
  durationMs: z.number().int().min(0).nullable(),
  processed: z.number().int().min(0),
  failed: z.number().int().min(0),
  error: z.string().nullable(),
  jobId: z.string().nullable(),
  stale: z.boolean().nullable(),
});
export type SyncRunSummary = z.infer<typeof SyncRunSummarySchema>;

/**
 * `openUntil` is when the cooldown expires, not when it opened: it answers
 * "when will the primary be tried again", which is the question being asked.
 */
export const ProviderBreakerStateSchema = z.object({
  provider: z.string().min(1),
  failures: z.number().int().min(0),
  openUntil: z.coerce.date().nullable(),
});
export type ProviderBreakerStateDto = z.infer<typeof ProviderBreakerStateSchema>;

export const QueueDepthSchema = z.object({
  queue: z.string().min(1),
  waiting: z.number().int().min(0),
  active: z.number().int().min(0),
  delayed: z.number().int().min(0),
  failed: z.number().int().min(0),
});
export type QueueDepth = z.infer<typeof QueueDepthSchema>;

/** Each section is null when it could not be read and [] when it is empty. */
export const SyncStatusResponseSchema = z.object({
  runs: z.array(SyncRunSummarySchema).nullable(),
  queues: z.array(QueueDepthSchema).nullable(),
  breakers: z.array(ProviderBreakerStateSchema).nullable(),
  primaryProvider: z.string().min(1),
  nextProvider: z.string().min(1).nullable(),
});
export type SyncStatusResponse = z.infer<typeof SyncStatusResponseSchema>;

export const SyncTriggerKindSchema = z.enum(['CATALOG', 'PRICE']);
export type SyncTriggerKind = z.infer<typeof SyncTriggerKindSchema>;

export const SyncTriggerResultSchema = z.object({
  jobId: z.string().min(1),
  kind: SyncTriggerKindSchema,
});
export type SyncTriggerResult = z.infer<typeof SyncTriggerResultSchema>;
```

In `packages/shared/src/primitives/error.ts`, add `SYNC_IN_PROGRESS: 'SYNC_IN_PROGRESS',` after `GRANT_ID_CONFLICT`.

- [ ] **Step 2: The selection rule, made pure.** Create `apps/api/src/sync/providers/provider-choice.ts`:

```ts
export interface ChosenProvider<T extends string> {
  name: T;
  isFallback: boolean;
}

/**
 * The primary unless its breaker is open, then the first other provider in
 * registration order whose breaker is closed, else none. Pure so the admin
 * status can report what the next run would choose without importing the
 * providers module.
 */
export function chooseProvider<T extends string>(
  primary: T,
  names: readonly T[],
  open: ReadonlySet<T>,
): ChosenProvider<T> | null {
  if (!open.has(primary)) {
    return { name: primary, isFallback: false };
  }
  const fallback = names.find((name) => name !== primary && !open.has(name));
  return fallback === undefined ? null : { name: fallback, isFallback: true };
}
```

In `apps/api/src/sync/providers/index.ts`, after the `ProviderSelectorService` exports:

```ts
export { chooseProvider } from './provider-choice.js';
export type { ChosenProvider } from './provider-choice.js';
```

In `apps/api/src/sync/providers/provider-selector.service.ts`, add `import { chooseProvider } from './provider-choice.js';` and replace the body of `select()`. Keep its doc comment.

```ts
  async select(): Promise<ProviderChoice> {
    const names = [...this.registry.keys()];
    const open = new Set<CardSourceName>();
    for (const name of names) {
      if (await this.breaker.isOpen(name)) {
        open.add(name);
      }
    }

    const chosen = chooseProvider(this.primary, names, open);

    // Every registered provider is failing. Running anyway would spend a sweep
    // on a source already known to be down, and the mirror is no less current
    // for being left alone.
    if (chosen === null) {
      throw new ProviderUnavailableError(
        this.primary,
        'every registered provider has an open breaker',
      );
    }

    const provider = this.mustResolve(chosen.name);

    if (!chosen.isFallback) {
      return { provider, isFallback: false, reason: 'configured primary' };
    }

    this.logger.warn(
      `Breaker open for ${this.primary}; this run will use ${chosen.name} as a fallback`,
    );
    return { provider, isFallback: true, reason: `breaker open for ${this.primary}` };
  }
```

- [ ] **Step 3: The timeout.** Create `apps/api/src/admin/with-timeout.ts`:

```ts
/**
 * BullMQ's connection waits for Redis rather than giving up, so an admin read
 * against a dead Redis would hang the request. Two seconds is past any healthy
 * round trip and short enough for a page an operator is waiting on.
 */
export const ADMIN_REDIS_TIMEOUT_MS = 2_000;

export function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  ms = ADMIN_REDIS_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
```

- [ ] **Step 4: The status reader.** Replace `apps/api/src/admin/admin-sync.service.ts`:

```ts
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SyncKind, SyncStatus, type SyncRun } from '@prisma/client';
import {
  SyncStatusResponseSchema,
  type ProviderBreakerStateDto,
  type QueueDepth,
  type SyncRunSummary,
  type SyncStatusResponse,
} from '@pokedrop/shared';
import type { Queue } from 'bullmq';
import { APP_CONFIG, CARD_SOURCE_NAMES, type AppConfig, type CardSourceName } from '../config/index.js';
import { PrismaService } from '../prisma/index.js';
import { QUEUE } from '../queue/index.js';
import { RedisService, breakerKeys } from '../redis/index.js';
import { chooseProvider } from '../sync/providers/index.js';
import { withTimeout } from './with-timeout.js';

type StatusQueue =
  | typeof QUEUE.catalogSync
  | typeof QUEUE.priceSweep
  | typeof QUEUE.priceActive
  | typeof QUEUE.priceSync;

const DEPTH_QUEUES: readonly StatusQueue[] = [
  QUEUE.catalogSync,
  QUEUE.priceSweep,
  QUEUE.priceActive,
  QUEUE.priceSync,
];

const RUN_QUEUE: Record<SyncKind, StatusQueue> = {
  [SyncKind.CATALOG]: QUEUE.catalogSync,
  [SyncKind.PRICE]: QUEUE.priceSweep,
  [SyncKind.PRICE_ACTIVE]: QUEUE.priceActive,
};

const FINISHED_STATES = new Set(['completed', 'failed', 'unknown']);

@Injectable()
export class AdminSyncService {
  private readonly logger = new Logger(AdminSyncService.name);
  private readonly primary: CardSourceName;
  private readonly queues: Record<StatusQueue, Queue>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) config: AppConfig,
    @InjectQueue(QUEUE.catalogSync) catalogSync: Queue,
    @InjectQueue(QUEUE.priceSweep) priceSweep: Queue,
    @InjectQueue(QUEUE.priceActive) priceActive: Queue,
    @InjectQueue(QUEUE.priceSync) priceSync: Queue,
  ) {
    this.primary = config.providers.active;
    this.queues = {
      [QUEUE.catalogSync]: catalogSync,
      [QUEUE.priceSweep]: priceSweep,
      [QUEUE.priceActive]: priceActive,
      [QUEUE.priceSync]: priceSync,
    };
  }

  /**
   * Each section is read on its own, so one dependency down costs that section
   * and not the page - the page an operator reads during exactly that incident.
   */
  async status(): Promise<SyncStatusResponse> {
    const [runs, queues, breakers] = await Promise.all([
      this.section('runs', () => this.lastRunPerKind()),
      this.section('queues', () => this.depths()),
      this.section('breakers', () => this.breakerStates()),
    ]);

    // With the breakers unreadable the selector treats every breaker as closed,
    // so the primary is what the next run would really choose.
    const open = new Set(
      (breakers ?? [])
        .filter((breaker) => breaker.openUntil !== null)
        .map((breaker) => breaker.provider as CardSourceName),
    );
    const next = chooseProvider(this.primary, CARD_SOURCE_NAMES, open);

    return SyncStatusResponseSchema.parse({
      runs,
      queues,
      breakers,
      primaryProvider: this.primary,
      nextProvider: next?.name ?? null,
    });
  }

  private async section<T>(name: string, read: () => Promise<T>): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      this.logger.warn(`sync status: ${name} unreadable - ${describe(error)}`);
      return null;
    }
  }

  private async lastRunPerKind(): Promise<SyncRunSummary[]> {
    const rows = await Promise.all(
      Object.values(SyncKind).map((kind) =>
        this.prisma.syncRun.findFirst({ where: { kind }, orderBy: { startedAt: 'desc' } }),
      ),
    );

    return Promise.all(
      rows
        .filter((row) => row !== null)
        .map(async (row) => ({
          kind: row.kind,
          provider: row.provider,
          status: row.status,
          startedAt: row.startedAt,
          finishedAt: row.finishedAt,
          durationMs:
            row.finishedAt === null ? null : row.finishedAt.getTime() - row.startedAt.getTime(),
          processed: row.processed,
          failed: row.failed,
          error: row.error,
          jobId: row.jobId,
          stale: row.status === SyncStatus.RUNNING ? await this.isStale(row) : false,
        })),
    );
  }

  /**
   * True when nothing will ever close this row: its job is gone, finished, or
   * was never recorded. A job that is waiting, delayed or running will close
   * it, or its final failure will.
   */
  private async isStale(row: SyncRun): Promise<boolean | null> {
    if (row.jobId === null) {
      return true;
    }
    try {
      const state = await withTimeout(
        this.queues[RUN_QUEUE[row.kind]].getJobState(row.jobId),
        `job ${row.jobId} state`,
      );
      return FINISHED_STATES.has(state);
    } catch (error) {
      this.logger.warn(`sync status: job ${row.jobId} unreadable - ${describe(error)}`);
      return null;
    }
  }

  private async depths(): Promise<QueueDepth[]> {
    return Promise.all(
      DEPTH_QUEUES.map(async (name) => {
        const counts = await withTimeout(
          this.queues[name].getJobCounts('waiting', 'paused', 'active', 'delayed', 'failed'),
          `${name} counts`,
        );
        return {
          queue: name,
          waiting: (counts['waiting'] ?? 0) + (counts['paused'] ?? 0),
          active: counts['active'] ?? 0,
          delayed: counts['delayed'] ?? 0,
          failed: counts['failed'] ?? 0,
        };
      }),
    );
  }

  /**
   * Read straight from Redis rather than through ProviderBreakerService, which
   * would pull the sync layer's providers into the API's admin module. An open
   * key without a TTL still counts as open, as isOpen() reads it.
   */
  private async breakerStates(): Promise<ProviderBreakerStateDto[]> {
    return Promise.all(
      CARD_SOURCE_NAMES.map(async (provider) => {
        const [raw, ttl] = await withTimeout(
          Promise.all([
            this.redis.client.get(breakerKeys.failures(provider)),
            this.redis.client.ttl(breakerKeys.open(provider)),
          ]),
          `breaker ${provider}`,
        );
        const failures = raw === null ? 0 : Number(raw);
        return {
          provider,
          failures: Number.isFinite(failures) ? failures : 0,
          openUntil: openUntilOf(ttl),
        };
      }),
    );
  }
}

/**
 * -2 is no key, a closed breaker. -1 is a key with no expiry: open, with no
 * end, reported a cooldown from now so the page shows it open.
 */
export function openUntilOf(ttl: number): Date | null {
  if (ttl === -2) {
    return null;
  }
  return new Date(Date.now() + (ttl > 0 ? ttl : 1_800) * 1_000);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

If Task 1 recorded that a paused queue counts its job under `waiting` only, and `getJobCounts` rejects `'paused'` as a type, drop `'paused'` from the call and from the sum. Typecheck will tell.

- [ ] **Step 5: The module.** Replace `apps/api/src/admin/admin.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/index.js';
import { AdminController } from './admin.controller.js';
import { AdminSyncService } from './admin-sync.service.js';

/**
 * QueueModule and nothing else. It brings producers only; SyncModule, which
 * holds the providers and processors, stays out, as it does for PricesModule.
 * PrismaModule, RedisModule and AuditModule are global.
 */
@Module({
  imports: [QueueModule],
  controllers: [AdminController],
  providers: [AdminSyncService],
})
export class AdminModule {}
```

- [ ] **Step 6: Verify.** Build, typecheck and lint, start the API, create an admin and a member, then read the status in the healthy and degraded cases:

```bash
source "$S/env81.sh"
pnpm build:shared >/dev/null && pnpm --filter @pokedrop/api build 2>&1 | grep -i error; pnpm --filter @pokedrop/api typecheck; pnpm lint 2>&1 | tail -3
# start the API
mkuser a; admin a; signin a; mkuser m
req a GET /admin/sync/status | strip
req m GET /admin/sync/status | grep -o '|[0-9]*$'; req anon GET /admin/sync/status | grep -o '|[0-9]*$'   # |403 |401
# A RUNNING row with an invented job (spec scenario 8)
$PSQL -c "insert into sync_runs (id, kind, provider, status, \"jobId\", \"startedAt\") values ('pd81-run-stale', 'CATALOG', 'pokemontcg', 'RUNNING', 'pd81-nosuchjob', now())"
req a GET /admin/sync/status | grep -o '"kind":"CATALOG"[^}]*'
# An open breaker, and one with no TTL (Review Focus)
$RC SET breaker:open:pokemontcg 1 EX 600; req a GET /admin/sync/status | strip
$RC PERSIST breaker:open:pokemontcg; req a GET /admin/sync/status | strip
$RC DEL breaker:open:pokemontcg
# sync_runs unreadable while auth still works (Review Focus: Postgres)
$PSQL -c "revoke select on sync_runs from pokedrop"; req a GET /admin/sync/status | strip; $PSQL -c "grant select on sync_runs to pokedrop"
# Redis stopped (spec scenario 10, status half)
docker compose stop redis; time (req a GET /admin/sync/status | strip); docker compose start redis
```

Expected, in order:
- The healthy status has four `runs`-kinds-or-fewer entries, each with `durationMs` and `stale: false` for closed runs. It also has four `queues` entries, two `breakers`, `"primaryProvider":"pokemontcg"` and `"nextProvider":"pokemontcg"`.
- Member `|403`, signed-out `|401`.
- The `pd81-run-stale` row is reported with `"stale":true` and `"durationMs":null`.
- With the breaker open, `pokemontcg` shows an `openUntil` and `"nextProvider":"tcgdex"`. With `PERSIST` (no TTL), still `"nextProvider":"tcgdex"`.
- With `SELECT` revoked, `"runs":null` alongside readable `queues` and `breakers`, with status `|200`.
- With Redis stopped: `|200`, `"queues":null`, `"breakers":null`, `"nextProvider":"pokemontcg"`, and wall time under 2.5 s. A `RUNNING` row, if any, shows `"stale":null`.

Run `cleanup` and stop the API.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/entities/sync.ts packages/shared/src/primitives/error.ts apps/api/src/sync/providers apps/api/src/admin
git commit -m "[PD-81]: report runs, queues and breakers, each null when unreadable

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Triggers and breaker reset, audited

**Files:**
- Create: `apps/api/src/admin/admin-sync-control.service.ts`
- Modify: `apps/api/src/admin/admin.controller.ts`
- Modify: `apps/api/src/admin/admin.module.ts` (providers)

**Interfaces:**
- Consumes: `SYNC_DEDUP_ID`, `syncJobOptions`, `DedupedSyncQueue` (Task 2); `withTimeout`, `openUntilOf` (Task 4); `SyncTriggerKind`, `SyncTriggerResult`, `SyncTriggerResultSchema`, `ProviderBreakerStateSchema`, `ERROR_CODES.SYNC_IN_PROGRESS` (Task 4); `AuditService.record(tx, entry)`; `domainError(status, code, message)`.
- Produces: `AdminSyncControlService.trigger(admin: AuthUser, kind: SyncTriggerKind): Promise<SyncTriggerResult>`, `AdminSyncControlService.resetBreaker(admin: AuthUser, provider: string): Promise<ProviderBreakerStateDto>`, and three routes.

- [ ] **Step 1: The control service.** Create `apps/api/src/admin/admin-sync-control.service.ts`:

```ts
import { InjectQueue } from '@nestjs/bullmq';
import {
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  type HttpException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  ProviderBreakerStateSchema,
  SyncTriggerResultSchema,
  type ProviderBreakerStateDto,
  type SyncTriggerKind,
  type SyncTriggerResult,
} from '@pokedrop/shared';
import type { Queue } from 'bullmq';
import { AuditService } from '../audit/index.js';
import { domainError } from '../common/errors/domain-error.js';
import type { AuthUser } from '../common/request-auth.js';
import { CARD_SOURCE_NAMES } from '../config/index.js';
import { PrismaService } from '../prisma/index.js';
import {
  QUEUE,
  SYNC_DEDUP_ID,
  syncJobOptions,
  type DedupedSyncQueue,
} from '../queue/index.js';
import { RedisService, breakerKeys } from '../redis/index.js';
import { openUntilOf } from './admin-sync.service.js';
import { withTimeout } from './with-timeout.js';

/**
 * A catalog sync and a price sweep share one provider budget and one rate
 * ceiling; the crons keep them an hour apart, and a button would not. So each
 * trigger is refused while the other one holds its key.
 */
const TRIGGERS: Record<SyncTriggerKind, { queue: DedupedSyncQueue; blocker: DedupedSyncQueue }> = {
  CATALOG: { queue: QUEUE.catalogSync, blocker: QUEUE.priceSweep },
  PRICE: { queue: QUEUE.priceSweep, blocker: QUEUE.catalogSync },
};

const LABEL: Record<DedupedSyncQueue, string> = {
  [QUEUE.catalogSync]: 'A catalog sync',
  [QUEUE.priceSweep]: 'A price sweep',
};

@Injectable()
export class AdminSyncControlService {
  private readonly queues: Record<DedupedSyncQueue, Queue>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUE.catalogSync) catalogSync: Queue,
    @InjectQueue(QUEUE.priceSweep) priceSweep: Queue,
  ) {
    this.queues = { [QUEUE.catalogSync]: catalogSync, [QUEUE.priceSweep]: priceSweep };
  }

  /**
   * The audit row goes first and the enqueue second, inside one transaction:
   * Redis cannot join it, so the order decides what a failure leaves behind.
   * A failed or refused enqueue rolls the row back; only a failed COMMIT after
   * a successful add leaves a job unaudited.
   */
  async trigger(admin: AuthUser, kind: SyncTriggerKind): Promise<SyncTriggerResult> {
    const { queue, blocker } = TRIGGERS[kind];

    for (const name of [queue, blocker]) {
      const holder = await this.redisCall(this.holderOf(name), 'dedup read');
      if (holder !== null) {
        throw inProgress(name, holder);
      }
    }

    const jobId = randomUUID();

    await this.prisma.withTransaction(async (tx) => {
      await this.audit.record(tx, {
        actorId: admin.id,
        action: 'sync.trigger',
        entity: 'SyncJob',
        entityId: jobId,
        meta: { kind, queue },
      });
      await this.redisCall(
        this.queues[queue].add(queue, {}, syncJobOptions(queue, jobId)),
        'enqueue',
      );
      // Another trigger may have taken the key between the read above and this
      // add. The holder, not add's return value, says whose job it is; a null
      // holder means ours has already run to its end.
      const holder = await this.redisCall(this.holderOf(queue), 'dedup read');
      if (holder !== null && holder !== jobId) {
        throw inProgress(queue, holder);
      }
    });

    return SyncTriggerResultSchema.parse({ jobId, kind });
  }

  async resetBreaker(admin: AuthUser, provider: string): Promise<ProviderBreakerStateDto> {
    if (!(CARD_SOURCE_NAMES as readonly string[]).includes(provider)) {
      throw new NotFoundException('Provider not found');
    }

    const failuresKey = breakerKeys.failures(provider);
    const openKey = breakerKeys.open(provider);
    const [raw, ttl] = await this.redisCall(
      Promise.all([this.redis.client.get(failuresKey), this.redis.client.ttl(openKey)]),
      'breaker read',
    );
    const counted = raw === null ? 0 : Number(raw);
    const failures = Number.isFinite(counted) ? counted : 0;
    const openUntil = openUntilOf(ttl);

    if (raw === null && openUntil === null) {
      return ProviderBreakerStateSchema.parse({ provider, failures: 0, openUntil: null });
    }

    await this.prisma.withTransaction(async (tx) => {
      await this.audit.record(tx, {
        actorId: admin.id,
        action: 'sync.breaker_reset',
        entity: 'Provider',
        entityId: provider,
        meta: { failures, openUntil: openUntil?.toISOString() ?? null },
      });
      await this.redisCall(this.redis.client.del(failuresKey, openKey), 'breaker reset');
    });

    return ProviderBreakerStateSchema.parse({ provider, failures: 0, openUntil: null });
  }

  private holderOf(queue: DedupedSyncQueue): Promise<string | null> {
    return this.queues[queue].getDeduplicationJobId(SYNC_DEDUP_ID[queue]);
  }

  private async redisCall<T>(promise: Promise<T>, label: string): Promise<T> {
    try {
      return await withTimeout(promise, label);
    } catch {
      throw new ServiceUnavailableException('The job queue is unavailable');
    }
  }
}

function inProgress(queue: DedupedSyncQueue, jobId: string): HttpException {
  return domainError(
    HttpStatus.CONFLICT,
    ERROR_CODES.SYNC_IN_PROGRESS,
    `${LABEL[queue]} is already queued or running (job ${jobId})`,
  );
}
```

Two notes on this code:
- The job name equals the queue name, which is what the crons use (`'catalog-sync'`, `'price-sweep'`).
- The no-op test for the reset is "no failures key **and** no open key" (`raw === null && openUntil === null`). A failures key holding `0`, or an open key with no TTL, is something to reset (Review Focus).

In `admin.module.ts`, add `AdminSyncControlService` to `providers` and import it from `./admin-sync-control.service.js`.

- [ ] **Step 2: The routes.** Replace `apps/api/src/admin/admin.controller.ts`:

```ts
import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  ProviderBreakerStateDto,
  SyncStatusResponse,
  SyncTriggerResult,
} from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { AdminSyncControlService } from './admin-sync-control.service.js';
import { AdminSyncService } from './admin-sync.service.js';

/**
 * No @Public() here on purpose: the global SessionGuard answers 401 without a
 * session and RolesGuard answers 403 for a member, which is the polarity PD-33
 * chose so that forgetting a decorator is noisy rather than silent.
 */
@ApiTags('admin')
@Roles(['ADMIN'])
@Controller('admin/sync')
export class AdminController {
  constructor(
    private readonly sync: AdminSyncService,
    private readonly control: AdminSyncControlService,
  ) {}

  @Get('status')
  status(): Promise<SyncStatusResponse> {
    return this.sync.status();
  }

  /** 202: the run is queued, not done. */
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('catalog')
  triggerCatalog(@CurrentUser() admin: AuthUser): Promise<SyncTriggerResult> {
    return this.control.trigger(admin, 'CATALOG');
  }

  @HttpCode(HttpStatus.ACCEPTED)
  @Post('prices')
  triggerPrices(@CurrentUser() admin: AuthUser): Promise<SyncTriggerResult> {
    return this.control.trigger(admin, 'PRICE');
  }

  @HttpCode(HttpStatus.OK)
  @Post('breakers/:provider/reset')
  resetBreaker(
    @CurrentUser() admin: AuthUser,
    @Param('provider') provider: string,
  ): Promise<ProviderBreakerStateDto> {
    return this.control.resetBreaker(admin, provider);
  }
}
```

The status route is unchanged: `@Controller('admin/sync')` plus `@Get('status')` is still `/admin/sync/status`.

- [ ] **Step 3: Build, typecheck and lint**

```bash
pnpm build:shared >/dev/null && pnpm --filter @pokedrop/api build 2>&1 | grep -i error; pnpm --filter @pokedrop/api typecheck; pnpm lint 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 4: Verify (spec scenarios 2, 3, 5, 9, 10, 12, 13).** Start the API, then:

```bash
source "$S/env81.sh"
mkuser a; admin a; signin a; mkuser b; admin b; signin b; mkuser m
qpause catalog-sync; qpause price-sweep
# 2 - a trigger, then a second one while the first waits
req a POST /admin/sync/catalog | strip; req a POST /admin/sync/catalog | strip
qcounts catalog-sync; audits
# 3 - the other kind is refused while catalog holds its key
req a POST /admin/sync/prices | strip
qdrain catalog-sync
req a POST /admin/sync/prices | strip; req a POST /admin/sync/catalog | strip
qdrain price-sweep; cleanup_audits(){ $PSQL -c "delete from audit_logs where action like 'sync.%'" >/dev/null; }; cleanup_audits
# 5 - two admins at once, five times
for i in 1 2 3 4 5; do
  req a POST /admin/sync/catalog > "$S/r1.txt" & req b POST /admin/sync/catalog > "$S/r2.txt" & wait
  echo "$(grep -o '|[0-9]*$' "$S/r1.txt") $(grep -o '|[0-9]*$' "$S/r2.txt") audits=$($PSQL -c "select count(*) from audit_logs where action = 'sync.trigger'") $(qcounts catalog-sync)"
  qdrain catalog-sync >/dev/null; cleanup_audits
done
# 13 - member and signed-out on every new route
for p in /admin/sync/catalog /admin/sync/prices /admin/sync/breakers/pokemontcg/reset; do echo "$p $(req m POST $p | grep -o '|[0-9]*$') $(req anon POST $p | grep -o '|[0-9]*$')"; done
# 9 - breaker reset: open, again, a counter at zero, no TTL, unknown
$RC SET breaker:fail:pokemontcg 5; $RC SET breaker:open:pokemontcg 1 EX 900
req a POST /admin/sync/breakers/pokemontcg/reset | strip; $RC EXISTS breaker:fail:pokemontcg breaker:open:pokemontcg; audits
req a POST /admin/sync/breakers/pokemontcg/reset | strip; audits
$RC SET breaker:open:tcgdex 1; req a POST /admin/sync/breakers/tcgdex/reset | strip; $RC EXISTS breaker:open:tcgdex
req a POST /admin/sync/breakers/ghost/reset | strip
cleanup_audits
# 12 - a failing audit insert leaves no job
$PSQL -c "create function pd81_fail() returns trigger language plpgsql as \$\$ begin if new.action = 'sync.trigger' then raise exception 'pd81 injected'; end if; return new; end \$\$; create trigger pd81_fail before insert on audit_logs for each row execute function pd81_fail();"
req a POST /admin/sync/catalog | strip; qcounts catalog-sync; qholder catalog-sync
$PSQL -c "drop trigger pd81_fail on audit_logs; drop function pd81_fail();"
# 10 - Redis stopped, trigger half; then look for an orphaned job once it is back
docker compose stop redis; time (req a POST /admin/sync/catalog | strip); docker compose start redis
sleep 15; qcounts catalog-sync; qholder catalog-sync; audits
qdrain catalog-sync; qresume catalog-sync; qresume price-sweep
```

Expected, in order:

**Scenario 2** (a trigger, then a second one while the first waits):
- first `{"jobId":"<uuid>","kind":"CATALOG"} |202`;
- second `{"statusCode":409,…,"message":"A catalog sync is already queued or running (job <same uuid>)","code":"SYNC_IN_PROGRESS"} |409`;
- counts show one job, and exactly one `sync.trigger SyncJob <uuid> {"kind": "CATALOG", "queue": "catalog-sync"}`.

**Scenario 3** (the other kind while catalog holds its key):
- prices is 409 `A catalog sync is already queued or running`;
- after draining the catalog queue, prices is 202, and the next catalog trigger is 409 `A price sweep is already queued or running`.

**Scenario 5** (two admins at once, ×5):
- each line is one `|202` and one `|409` in either order, with `audits=1` and one job.

**Scenario 13** (member and signed-out on every new route):
- `|403 |401` on each route.

**Scenario 9** (breaker reset):
- first reset `{"provider":"pokemontcg","failures":0,"openUntil":null} |200`, `EXISTS` prints `0`, one `sync.breaker_reset Provider pokemontcg {"failures": 5, "openUntil": "…"}`;
- second reset `|200` with no new row;
- the no-TTL `tcgdex` key is reset: `|200`, `EXISTS` prints `0`, one row;
- `ghost` gives `{"statusCode":404,…,"message":"Provider not found"} |404`.

**Scenario 12** (failing audit insert):
- `|500`, counts zero jobs, holder `null`.

**Scenario 10** (Redis stopped):
- `|503` with `"message":"The job queue is unavailable"`, well under 2.5 s + the transaction;
- after recovery, no `sync.trigger` row. Record whether a job appeared: that is the offline-queue residual from the Review Focus.

Then run `cleanup` and stop the API.

- [ ] **Step 5: One real run, and the cron over a manual job (spec scenarios 1 and 4).** This is the one run allowed to spend budget. Start the API with the queue **not** paused:

```bash
source "$S/env81.sh"; mkuser a; admin a; signin a
t=$(date +%s%N); R=$(req a POST /admin/sync/catalog); echo "$R $(( ($(date +%s%N) - t) / 1000000 )) ms"
J=$(echo "$R" | sed -E 's/.*"jobId":"([^"]+)".*/\1/')
sleep 10; $PSQL -c "select status, provider, processed from sync_runs where \"jobId\" = '$J'"; audits
(cd apps/api && node --input-type=module < "$S/cron81.mjs") 2>&1 | grep -E 'Enqueued catalog|Skipped the catalog'
req a GET /admin/sync/status | grep -o '"kind":"CATALOG"[^}]*'
```

Expected:
- the trigger answers `|202` in well under a second;
- a `RUNNING` `SyncRun` carries the same `jobId`, with one `sync.trigger` row naming it;
- the cron script prints **two** `Skipped the catalog sync: job <J> …` lines;
- the status shows the run with `"stale":false`.

Leave it to finish (11–15 min), then read the status once more:

```bash
req a GET /admin/sync/status | grep -o '"kind":"CATALOG"[^}]*'; qholder catalog-sync
```

Expected: `"status":"SUCCEEDED"` or `"PARTIAL"`, `durationMs` set, `"stale":false`, and the holder `null`. Run `cleanup` (it keeps this real run, whose `jobId` is a UUID and not `pd81-…`) and stop the API.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/admin
git commit -m "[PD-81]: trigger syncs and reset breakers, audited and deduplicated

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Documentation and Linear

**Files:**
- Modify: `docs/API.md` (error-code table; `## Admin / Sync`)
- Modify: `docs/DataModel.md` (AuditLog → What is audited; the "arrive with PD-81" line)
- Modify: `apps/api/src/queue/README.md`
- Modify: `apps/api/src/sync/README.md`

- [ ] **Step 1: `docs/API.md`.**
  - In the domain error-code table, add a row: `| \`SYNC_IN_PROGRESS\` | 409 | A catalog sync or price sweep is already queued or running — the same kind, or the other of the two, which share a provider budget; the message names the job |`.
  - Replace the `## Admin / Sync` table:

```markdown
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/admin/sync/catalog` | admin | Enqueue a catalog sync — 202 `{ jobId, kind }` |
| POST | `/admin/sync/prices` | admin | Enqueue a full price sweep — 202 `{ jobId, kind }` |
| POST | `/admin/sync/breakers/:provider/reset` | admin | Clear a provider's breaker |
| GET | `/admin/sync/status` | admin | Last run per `SyncKind`, queue depth, breakers, the provider the next run would use |
| GET | `/admin/metrics` | admin | DAU, packs opened, trade volume, freshness |
```

  - Replace the prose below the table (from `**\`GET /admin/sync/status\` is read only` through the paragraph ending `about an endpoint.`) with sections in the style of `## Admin / Users`, covering:
    - **the triggers:** 202, no body, the job name and queue for each; the dedup key shared with the crons; the cross-kind refusal and why (one budget, one rate ceiling, a schedule a button does not respect); `SYNC_IN_PROGRESS` and its message; 503 when the queue is unavailable; the `sync.trigger` row, written first; and both accepted residuals;
    - **the breaker reset:** what it clears, the no-op, a key with no TTL, 404, and the `sync.breaker_reset` row;
    - **the status:** the contract field by field; `null` versus `[]`; `stale`, and the four ways a run is closed or reported (from the spec's Run lifecycle); `nextProvider` and why it names the primary when Redis is down; the 2 s timeout;
    - that Postgres wholly down cannot be shown, because authentication needs it;
    - **Measured, <date>:** the actual results of Tasks 1–5's probes — codes, counts and timings as observed, not as expected. This includes the offline-queue result from scenario 10 and the stall count from Task 3.

- [ ] **Step 2: `docs/DataModel.md`.**
  - In the "What is audited" table, add `| \`sync.trigger\` | \`SyncJob\` | \`POST /admin/sync/catalog\` · \`/prices\` | the admin |` and `| \`sync.breaker_reset\` | \`Provider\` | \`POST /admin/sync/breakers/:provider/reset\` | the admin |`.
  - Add a paragraph: why `SyncJob` and not `SyncRun` (no run row exists at trigger time; `sync_runs."jobId"` joins them); why the audit row comes before the enqueue; both accepted residuals, adding the offline-queue case if scenario 10 showed one.
  - Replace the line beginning "Sync triggers (`POST /admin/sync/…`) arrive with PD-81" with: `Every admin route that mutates is audited — checked route by route on <date>, after PD-81.`

- [ ] **Step 3: `apps/api/src/queue/README.md`.**
  - In the queue table, change `catalog-sync`'s filler to `PD-42's cron, PD-81's admin trigger` and `price-sweep`'s to `PD-49's nightly cron, PD-81's admin trigger`.
  - Under "Rules the next ticket inherits", add: **A sync is enqueued only through `syncJobOptions`.** One dedup key per queue, held while a job waits or runs, is what stops the cron and the admin route queueing a second run; an `add` without it slips past both. Include what Task 1 measured about a held key and about a paused queue.

- [ ] **Step 4: `apps/api/src/sync/README.md`.** Add a section, "A run nobody will close", covering:
  - the `failed` handler, and why "final" is `getState() === 'failed'` (Task 1's measurement);
  - the stall path and how many stalls BullMQ allowed (Task 3's measurement);
  - the unregistered-provider case closing after the backoff;
  - the read-time `stale`;
  - the argument that no live worker also means no API.

- [ ] **Step 5: Format check and commit**

```bash
npx prettier --check docs/API.md docs/DataModel.md apps/api/src/queue/README.md apps/api/src/sync/README.md
git add docs/API.md docs/DataModel.md apps/api/src/queue/README.md apps/api/src/sync/README.md
git commit -m "[PD-81]: document sync control, its guard and what it measured

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Linear.** Mark PD-81 Done. Add a comment to PD-82: the status now carries queue depth through `AdminSyncService`'s `getJobCounts` read, and freshness must agree with `runs` as defined here.
