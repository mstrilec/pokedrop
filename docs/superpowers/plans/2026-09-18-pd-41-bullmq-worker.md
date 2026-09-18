# PD-41 BullMQ and Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second process that consumes BullMQ queues, sharing this codebase and its logger configuration with the API, and failing without taking the API down.

**Architecture:** `worker.ts` boots `WorkerModule` through `createApplicationContext` — no HTTP adapter, no port. `QueueModule` is imported by both entrypoints: `registerQueue` makes producers, and a `@Processor` class makes a worker, so the API enqueues and never consumes purely because it declares no processor. Connection options carry `REDIS_URL` plus queue database 1, and BullMQ constructs and owns those connections. The logger's two genuinely shared fields are extracted so both entrypoints read one transport decision.

**Tech Stack:** NestJS 12 (ESM, `module: nodenext` — every relative import ends in `.js`), `bullmq@5.81.5`, `@nestjs/bullmq@12.0.0`, ioredis 5.8.2, Redis 7.4 on db 1. TypeScript 5.9.3 with `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `isolatedModules`.

**Spec:** [`docs/superpowers/specs/2026-09-18-pd-41-bullmq-worker-design.md`](../specs/2026-09-18-pd-41-bullmq-worker-design.md)

## Global Constraints

- **Work directly on `dev`.** No feature branches, no pull requests.
- **Commit subjects are `[PD-41]: short lowercase description`**, no trailing period. Bodies end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. A `feat:` or `docs:` prefix is rejected by the commit-msg hook.
- **No automated tests in v1** (`docs/PRD.md` §20). No test files, runners, dependencies, or CI test step. **This overrides the TDD structure the writing-plans skill normally imposes.** Every task's red/green cycle is a measurement against the running stack.
- **Every commit compiles.** `pnpm typecheck` and `pnpm lint` pass from the repository root before each one.
- **Exact version pins.** `bullmq` is `"5.81.5"` and `@nestjs/bullmq` is `"12.0.0"` — no caret, matching `prisma`, `ioredis`, `better-auth` and `@nestjs/throttler` in `apps/api/package.json`.
- **`bullmq@6` is not to be installed**, whatever `latest` says. The reason is in the spec; 6.3.7 was published the day this was designed.
- **No `@nestjs/schedule`.** Deferred to PD-42 — a deliberate departure from the ticket's scope list, with reasoning in the spec.
- **No processor is committed.** The only processor in this plan is temporary and is deleted before the task that introduced it commits.
- **ESM.** Relative imports inside `apps/api` carry the `.js` extension or the build fails.
- **Verified claims only.** If a measurement contradicts the spec, report the contradiction rather than adjusting the claim to fit.

### Shared shell setup

```bash
cd /m/projects/pokedrop
RCLI="docker compose exec -T redis redis-cli -n 1"
API="http://localhost:4000"
```

`docker compose ps` must show postgres, redis and mailpit healthy before starting. Redis **db 1** is the queue database; db 0 is the cache and nothing in this ticket touches it.

BullMQ prefixes its own keys with `bull:`, so everything this plan creates is at `bull:catalog-sync:*`, `bull:price-sync:*`, `bull:trade-expiry:*`.

**Probes live in `apps/api/dist/`,** which is gitignored, and must sit inside `apps/api` because Node resolves bare imports relative to the file. **Build before writing a probe, never after** — `nest build` has `deleteOutDir: true` and will delete it.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/api/src/queue/queue.constants.ts` | The three queue names and the `QueueName` union. Nothing else. |
| `apps/api/src/queue/queue.module.ts` | `forRootAsync` connection + `registerQueue` for the three. |
| `apps/api/src/queue/index.ts` | The module's public surface. |
| `apps/api/src/queue/README.md` | Measured defaults, the dead-letter note, the cron rule PD-42 must follow. |
| `apps/api/src/worker.module.ts` | Five imports. No controllers, no guards, no auth. |
| `apps/api/src/worker.ts` | The second entrypoint. |
| `apps/api/src/logging/logger.options.ts` | Gains `buildBaseLoggerOptions` and `buildWorkerLoggerOptions`. |
| `apps/api/src/logging/logging.module.ts` | Gains `WorkerLoggingModule`. |

`nest build` needs no configuration change: `tsconfig.build.json` has `"include": ["src"]`, so `worker.ts` is compiled to `dist/worker.js` automatically.

### Task order

Dependencies and constants first, because everything else imports them. The logger split is second and on its own, because it is the only task that edits working code — a regression there is silent, so it gets its own before-and-after measurement. The module, then the entrypoint, then the behaviour that needs both.

---

## Task 1: Dependencies, queue names, job defaults

**Files:**
- Modify: `apps/api/package.json` (dependencies, plus `start:worker` and `dev:worker`)
- Create: `apps/api/src/queue/queue.constants.ts`
- Modify: `apps/api/src/config/app.config.ts` (the `queue` block, around line 84)

**Interfaces:**
- Consumes: nothing.
- Produces: `QUEUE` and `QueueName` from `queue.constants.ts`; `AppConfig['queue']['defaults']`. Task 3 passes the defaults to `forRootAsync` and names the queues from `QUEUE`.

- [ ] **Step 1: Install both packages at exact versions**

```bash
pnpm --filter @pokedrop/api add bullmq@5.81.5 @nestjs/bullmq@12.0.0
```

Then open `apps/api/package.json` and **remove the `^` from both** if pnpm added one, so the entries read `"bullmq": "5.81.5"` and `"@nestjs/bullmq": "12.0.0"`, matching the neighbouring pins. Re-run `pnpm install` after editing.

- [ ] **Step 2: Record the ioredis duplication the spec predicted**

```bash
pnpm --filter @pokedrop/api list ioredis --depth 0
ls -d node_modules/.pnpm/ioredis@* 
```

Expected: the direct dependency is `ioredis 5.8.2`, and `.pnpm` now holds **two** ioredis directories — `ioredis@5.8.2` and `ioredis@5.11.1`, the second being bullmq's own pin.

This is the accepted cost from the spec, not a problem to solve. If only one directory exists, the spec's premise was wrong — stop and report it rather than continuing.

- [ ] **Step 3: Write the queue names**

Create `apps/api/src/queue/queue.constants.ts`:

```ts
/**
 * Every queue name, in one place.
 *
 * The same reason cache keys live only in cache.keys.ts: a mistyped literal
 * does not fail. It silently creates a second queue that no worker consumes and
 * no producer fills, which presents as jobs that vanish.
 */
export const QUEUE = {
  catalogSync: 'catalog-sync',
  priceSync: 'price-sync',
  tradeExpiry: 'trade-expiry',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];
```

- [ ] **Step 4: Add the default job options**

In `apps/api/src/config/app.config.ts`, replace the existing `queue` block:

```ts
    queue: {
      concurrency: env.QUEUE_CONCURRENCY,

      /**
       * Applied to every job on every queue unless a producer overrides them.
       *
       * Literals rather than environment variables, for the reason already
       * recorded above for the cache TTLs: the point of the rule is that no
       * call site writes 5_000, and this is already the typed configuration
       * layer. Four variables nobody will ever set are surface to keep in sync.
       */
      defaults: {
        /**
         * Three, then stop. A fourth attempt against a provider that has failed
         * three times is not information.
         */
        attempts: 3,
        /** 5s, 10s, 20s. Long enough for a rate limit to lift, short enough
         * that a nightly sweep is not still retrying at breakfast. */
        backoff: { type: 'exponential', delay: 5_000 },
        /** Success is only "did it run", and PD-42's SyncRun answers that durably. */
        removeOnComplete: { age: 86_400, count: 1_000 },
        /**
         * BullMQ has no dead-letter queue. A job that exhausts its attempts
         * stays in the `failed` set, and that set is the dead letter.
         *
         * `true` would delete the evidence at the moment it became
         * interesting; `false` would keep every failure for ever in the same
         * Redis database as the queues, which is a memory leak with a slow
         * fuse. Seven days is the window somebody would actually look in.
         */
        removeOnFail: { age: 604_800 },
      },
    },
```

- [ ] **Step 5: Add the worker scripts**

In `apps/api/package.json`, after `"start:prod"`:

```json
    "start:worker": "node dist/worker",
    "dev:worker": "nest start --watch --entryFile worker",
```

- [ ] **Step 6: Gates and commit**

```bash
pnpm typecheck && pnpm lint
git add apps/api/package.json apps/api/src/queue/queue.constants.ts apps/api/src/config/app.config.ts pnpm-lock.yaml
git commit -F - <<'EOF'
[PD-41]: add bullmq and the queue job defaults

bullmq 5.81.5 rather than 6.3.7, which was published the same day this was
designed. Version 5 pins its own ioredis 5.11.1 as a direct dependency, so the
tree now holds two copies alongside our 5.8.2 - measured, and accepted: BullMQ
never shares a connection with the cache anyway, because the two need opposite
maxRetriesPerRequest settings.

removeOnFail keeps failures for seven days. BullMQ has no dead-letter queue -
the failed set is the dead letter, and erasing it would delete the evidence at
the moment it became interesting.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 2: Split the logger configuration

The only task that edits code the API already depends on. A regression here is silent — the API would keep running and quietly log differently — so it is measured before and after.

**Files:**
- Modify: `apps/api/src/logging/logger.options.ts`
- Modify: `apps/api/src/logging/logging.module.ts`
- Modify: `apps/api/src/logging/index.ts`

**Interfaces:**
- Consumes: `AppConfig` (existing).
- Produces: `buildBaseLoggerOptions(config)`, `buildWorkerLoggerOptions(config)`, `WorkerLoggingModule`. Task 4's `WorkerModule` imports `WorkerLoggingModule`. `buildLoggerOptions` keeps its existing signature and behaviour.

- [ ] **Step 1: Capture the API's current log output**

```bash
pnpm --filter @pokedrop/api build
( cd apps/api && node dist/main.js > /tmp/pd41-log-before.txt 2>&1 & echo $! > /tmp/pd41-api.pid )
sleep 8
curl -s -o /dev/null "$API/api/v1/health/ready"
curl -s -o /dev/null "$API/api/v1/nope"
sleep 1
kill "$(cat /tmp/pd41-api.pid)"
cat /tmp/pd41-log-before.txt
```

Capture the pid rather than using `kill %1`: job control is unreliable in a
non-interactive shell, and every later step needs a pid it can signal.

Keep this file. Expected in it: colourised single-line pino-pretty output, a `Nest application successfully started` line, one `info` line for the ready probe, and one `warn` line for the 404 — `customLogLevel` is what makes that a warn rather than an info.

- [ ] **Step 2: Extract the shared base**

In `apps/api/src/logging/logger.options.ts`, add above `buildLoggerOptions`:

```ts
/**
 * What both entrypoints share: the level, and where output goes.
 *
 * Everything else in buildLoggerOptions is about HTTP — genReqId reads an id a
 * middleware put on a request, autoLogging silences a route, customLogLevel
 * maps a status code, the serializers shape request and response objects, and
 * every redact path starts with req.headers or res.headers. A worker has none
 * of those. It has jobs.
 *
 * Two fields is a small thing to extract and still worth extracting: they are
 * exactly what makes output readable in development and parseable in
 * production, and duplicating them across two entrypoints is how they drift.
 */
export function buildBaseLoggerOptions(config: AppConfig) {
  return {
    level: config.logging.level,

    // pino-pretty is a devDependency: production emits JSON and never loads it.
    transport: config.app.isProduction
      ? undefined
      : {
          target: 'pino-pretty',
          options: {
            colorize: true,
            singleLine: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
  };
}
```

Then in `buildLoggerOptions`, replace the `level:` line and the whole trailing `transport:` block with a spread of the base, so the function begins:

```ts
export function buildLoggerOptions(config: AppConfig): Params {
  return {
    pinoHttp: {
      ...buildBaseLoggerOptions(config),

      // Adopt the id the request-id middleware already set...
      genReqId: (request) => {
```

and ends after `redact` — the `transport` block that used to sit at the bottom is gone, now coming from the spread.

Finally add at the end of the file:

```ts
/**
 * The worker's options: the shared base and nothing else.
 *
 * nestjs-pino takes pino's options under `pinoHttp` in both cases. With
 * createApplicationContext there is no HTTP adapter, so its middleware is never
 * mounted and the key is simply where pino's own configuration lives.
 *
 * The worker's equivalent of a request id is the job id, and that belongs on a
 * child logger inside a processor rather than here — pino-http has no hook to
 * generate one. See apps/api/src/queue/README.md.
 */
export function buildWorkerLoggerOptions(config: AppConfig): Params {
  return { pinoHttp: buildBaseLoggerOptions(config) };
}
```

- [ ] **Step 3: Add the worker's logging module**

In `apps/api/src/logging/logging.module.ts`, import `buildWorkerLoggerOptions` alongside `buildLoggerOptions` and append:

```ts
/**
 * The same wrapper for the worker entrypoint, differing only in which options
 * factory it calls. Both read one transport decision, which is what makes
 * PD-19's third criterion true by construction rather than by discipline.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => buildWorkerLoggerOptions(config),
    }),
  ],
  exports: [LoggerModule],
})
export class WorkerLoggingModule {}
```

- [ ] **Step 4: Export both**

`apps/api/src/logging/index.ts`:

```ts
export { AppLoggingModule, WorkerLoggingModule } from './logging.module.js';
export {
  buildBaseLoggerOptions,
  buildLoggerOptions,
  buildWorkerLoggerOptions,
} from './logger.options.js';
```

- [ ] **Step 5: Prove the API's logging did not change**

```bash
pnpm typecheck && pnpm lint
pnpm --filter @pokedrop/api build
( cd apps/api && node dist/main.js > /tmp/pd41-log-after.txt 2>&1 & echo $! > /tmp/pd41-api.pid )
sleep 8
curl -s -o /dev/null "$API/api/v1/health/ready"
curl -s -o /dev/null "$API/api/v1/nope"
sleep 1
kill "$(cat /tmp/pd41-api.pid)"
diff <(sed -E 's/[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]+//g' /tmp/pd41-log-before.txt) \
     <(sed -E 's/[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]+//g' /tmp/pd41-log-after.txt)
```

Expected: no differences other than request ids and durations. Timestamps are stripped by the `sed`; anything else that differs is a regression in the refactor, not an acceptable variation.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/logging/
git commit -F - <<'EOF'
[PD-41]: split the shared logger options from the http ones

Everything in buildLoggerOptions except the level and the transport is about
HTTP - genReqId reads an id from a request, the serializers shape request and
response objects, and every redact path starts with req.headers or res.headers.
A worker has jobs instead, so it takes the base and nothing else.

Two fields is small and still worth extracting: they are what makes output
readable in development and parseable in production, and a second copy is how
they drift.

Verified by diffing the API's own output across the refactor: identical apart
from request ids and durations.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 3: The queue module

**Files:**
- Create: `apps/api/src/queue/queue.module.ts`, `apps/api/src/queue/index.ts`
- Modify: `apps/api/src/app.module.ts` (import `QueueModule`)

**Interfaces:**
- Consumes: `QUEUE` (Task 1), `APP_CONFIG` / `AppConfig` (existing).
- Produces: `QueueModule`, exporting `BullModule` so any importer can `@InjectQueue(QUEUE.catalogSync)`. Task 4's `WorkerModule` imports it.

- [ ] **Step 1: Write the module**

Create `apps/api/src/queue/queue.module.ts`:

```ts
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { QUEUE } from './queue.constants.js';

/**
 * The queues, and the connection they share.
 *
 * Imported by both entrypoints, and the difference between them is not in this
 * file: `registerQueue` creates producers, while a `@Processor` class creates a
 * worker. The API imports this module and declares no processor, so it can
 * enqueue and never consumes. The worker declares processors and does both.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        // `url` is BullMQ's own field, added on top of ioredis' RedisOptions —
        // ioredis itself takes a URL as a constructor argument and has no such
        // option, so reading its types alone suggests this cannot work. It is
        // what keeps REDIS_URL the single source of truth for both databases.
        //
        // Options rather than RedisService's client, deliberately. BullMQ sets
        // maxRetriesPerRequest to null on connections it constructs, because a
        // blocking read has no meaningful retry ceiling. Handed an instance it
        // can only warn, and the cache's client is configured for the opposite
        // purpose — to give up quickly and report a miss.
        connection: { url: config.redis.url, db: config.redis.queueDb },
        defaultJobOptions: config.queue.defaults,
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE.catalogSync },
      { name: QUEUE.priceSync },
      { name: QUEUE.tradeExpiry },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
```

Create `apps/api/src/queue/index.ts`:

```ts
export { QUEUE } from './queue.constants.js';
export type { QueueName } from './queue.constants.js';
export { QueueModule } from './queue.module.js';
```

- [ ] **Step 2: Let the API enqueue**

In `apps/api/src/app.module.ts`, add `import { QueueModule } from './queue/index.js';` beside the other module imports and `QueueModule,` to the `imports` array, after `HealthModule`.

This is permanent, unlike PD-38's `SyncModule`: a queue producer has nothing to refuse at boot, and PD-81's admin sync endpoints enqueue from the API process.

- [ ] **Step 3: Build and prove the producer reaches db 1**

```bash
pnpm typecheck && pnpm lint
pnpm --filter @pokedrop/shared build && pnpm --filter @pokedrop/api build
```

Create `apps/api/dist/probe-queue.mjs`:

```js
import { Queue } from 'bullmq';

const connection = { url: 'redis://localhost:6379', db: 1 };
const q = new Queue('catalog-sync', { connection });

const id = (await q.add('probe', { hello: 'pd-41' })).id;
console.log('enqueued job', id);
console.log('counts      :', await q.getJobCounts('waiting', 'failed', 'completed'));

await q.close();
```

```bash
node apps/api/dist/probe-queue.mjs
$RCLI KEYS 'bull:catalog-sync:*'
$RCLI --scan --pattern 'bull:*' | head
docker compose exec -T redis redis-cli -n 0 KEYS 'bull:*'
```

Expected: the job is enqueued with an id, `counts` shows `waiting: 1`, and `KEYS` on **db 1** lists `bull:catalog-sync:meta`, `bull:catalog-sync:id`, `bull:catalog-sync:waiting` and the job hash. `KEYS` on **db 0** returns nothing — the cache database is untouched.

Nothing consumes yet, so the job stays in `waiting`. That is the correct state after this task.

- [ ] **Step 4: Prove the API boots with the producers registered**

```bash
cd apps/api && node dist/main.js > /tmp/pd41-api-queue.txt 2>&1 &
sleep 8
curl -s -o /dev/null -w "ready %{http_code}\n" "$API/api/v1/health/ready"
kill %1
cd /m/projects/pokedrop
grep -ci "error" /tmp/pd41-api-queue.txt
```

Expected: `ready 200`, and zero lines matching `error`. A `MaxRetriesPerRequestError` or a warning about `maxRetriesPerRequest` here would mean the connection was built from an instance rather than from options — re-read Step 1.

- [ ] **Step 5: Clean the probe job out of Redis, then commit**

```bash
$RCLI DEL bull:catalog-sync:meta bull:catalog-sync:id bull:catalog-sync:waiting
$RCLI --scan --pattern 'bull:catalog-sync:*' | while read -r k; do $RCLI DEL "$k"; done
$RCLI KEYS 'bull:*'
```

Expected: empty. Task 5 needs a clean queue to measure attempt timings against.

```bash
git add apps/api/src/queue/queue.module.ts apps/api/src/queue/index.ts apps/api/src/app.module.ts
git commit -F - <<'EOF'
[PD-41]: add the queue module and register the three queues

Connection options rather than RedisService's client: BullMQ sets
maxRetriesPerRequest to null on connections it constructs, and given an instance
it can only warn. The cache client is configured for the opposite purpose - to
give up quickly and call it a miss - so sharing it would produce a worker whose
blocking reads retry-limit themselves.

The API imports this module and declares no processor, which is the whole of
being a producer and not a consumer.

Verified: an enqueued job lands in db 1 under bull:catalog-sync, db 0 is
untouched, and the API boots clean with the producers registered.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 4: The worker entrypoint

**Files:**
- Create: `apps/api/src/worker.module.ts`, `apps/api/src/worker.ts`

**Interfaces:**
- Consumes: `AppConfigModule`, `WorkerLoggingModule` (Task 2), `PrismaModule`, `RedisModule`, `QueueModule` (Task 3).
- Produces: `WorkerModule` and the `dist/worker.js` entrypoint. Task 5 registers a temporary processor in `WorkerModule`.

- [ ] **Step 1: Write the module**

Create `apps/api/src/worker.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/index.js';
import { WorkerLoggingModule } from './logging/index.js';
import { PrismaModule } from './prisma/index.js';
import { QueueModule } from './queue/index.js';
import { RedisModule } from './redis/index.js';

/**
 * The worker's root module. Deliberately not AppModule.
 *
 * AppModule brings controllers, four global guards, Better Auth, the mail
 * module and the health routes. A process that answers no requests needs none
 * of it, and booting the auth module here would mean a second process holding
 * session-signing capability for no reason at all.
 *
 * PrismaModule and RedisModule are @Global() and own their lifecycle, so the
 * worker gets a connected database client and a cache client with no wiring —
 * and closes both on shutdown for the same reason.
 *
 * Processors arrive with the tickets that own them: PD-42 (catalog sync),
 * PD-48 (price sync), PD-74 (trade expiry).
 */
@Module({
  imports: [AppConfigModule, WorkerLoggingModule, PrismaModule, RedisModule, QueueModule],
})
export class WorkerModule {}
```

- [ ] **Step 2: Write the entrypoint**

Create `apps/api/src/worker.ts`:

```ts
import { Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module.js';

/**
 * The second entrypoint. Same codebase, no HTTP.
 *
 * createApplicationContext rather than create: this process accepts no
 * requests, so it has no adapter, no port and nothing listening. Everything it
 * does is driven by jobs arriving on the queues.
 *
 * What keeps the process alive with no processors registered is the open Redis
 * and Postgres sockets their modules hold. That is worth knowing before PD-42
 * adds the first processor, because "the worker exited immediately" would
 * otherwise look like a bug in the new code.
 */
async function bootstrap(): Promise<void> {
  // bufferLogs for the same reason main.ts uses it: Nest's startup lines are
  // held until pino is swapped in, so the boot sequence is not split across two
  // formats.
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  // BullMQ closes its workers in onModuleDestroy, and its close() waits for the
  // job in flight — so a processor halfway through a transaction finishes
  // rather than being abandoned.
  //
  // On Windows this is reachable through SIGINT only: Node has no real POSIX
  // signal delivery there and SIGTERM kills the process before the hooks run.
  // See docs/Foundation.md. In Docker, SIGTERM behaves.
  app.enableShutdownHooks();

  new NestLogger('Worker').log('Worker started');
}

await bootstrap();
```

- [ ] **Step 3: Build both entrypoints**

```bash
pnpm typecheck && pnpm lint
pnpm --filter @pokedrop/api build
ls apps/api/dist/main.js apps/api/dist/worker.js
```

Expected: both files exist. `tsconfig.build.json` includes all of `src`, so no nest-cli configuration was needed.

- [ ] **Step 4: Run both processes and confirm the worker holds no port**

```bash
( cd apps/api && node dist/main.js   > /tmp/pd41-api.txt    2>&1 & echo $! > /tmp/pd41-api.pid )
( cd apps/api && node dist/worker.js > /tmp/pd41-worker.txt 2>&1 & echo $! > /tmp/pd41-worker.pid )
sleep 10
cat /tmp/pd41-worker.txt
curl -s -o /dev/null -w "api ready %{http_code}\n" "$API/api/v1/health/ready"
netstat -ano | grep -c ":4000.*LISTENING"
```

Capture the pids rather than relying on `kill %1`: job control is unreliable in
a non-interactive shell, and the steps below need something they can signal.

Expected: the worker's log shows `Database connection established`, `Redis connection established` and `Worker started`; the API answers 200; exactly **one** process listens on 4000. The worker stays running rather than exiting — if it exits immediately, re-read the note in Step 2.

- [ ] **Step 5: Confirm the worker honours `LOG_LEVEL` the same way the API does**

The fourth acceptance criterion is PD-19's — one logger configuration, two
entrypoints. Task 2 proved the API's output survived the refactor; this proves
the worker actually reads the same knob.

```bash
kill "$(cat /tmp/pd41-worker.pid)"
sleep 2
( cd apps/api && LOG_LEVEL=warn node dist/worker.js > /tmp/pd41-worker-warn.txt 2>&1 & echo $! > /tmp/pd41-worker.pid )
sleep 8
cat /tmp/pd41-worker-warn.txt
```

Expected: **empty, or near it.** `Worker started`, `Redis connection established` and `Database connection established` are all `info` lines, so raising the floor to `warn` silences them — exactly as it does for the API. If they still appear, the worker is not reading `buildBaseLoggerOptions`.

Restore a normally-configured worker for the next step:

```bash
kill "$(cat /tmp/pd41-worker.pid)"
sleep 2
( cd apps/api && node dist/worker.js > /tmp/pd41-worker.txt 2>&1 & echo $! > /tmp/pd41-worker.pid )
sleep 6
```

- [ ] **Step 6: Kill the worker and confirm the API is untouched**

The build in Step 3 emptied `dist/`, so the probe written in Task 3 is gone.
Write it again — that is what "build before writing a probe, never after" means
once a probe has to survive a task boundary.

Create `apps/api/dist/probe-queue.mjs`:

```js
import { Queue } from 'bullmq';

const q = new Queue('catalog-sync', { connection: { url: 'redis://localhost:6379', db: 1 } });
const id = (await q.add('probe', { hello: 'pd-41' })).id;
console.log('enqueued job', id);
console.log('counts      :', await q.getJobCounts('waiting', 'failed', 'completed'));
await q.close();
```

```bash
kill "$(cat /tmp/pd41-worker.pid)"
sleep 2
curl -s -o /dev/null -w "api ready after worker death %{http_code}\n" "$API/api/v1/health/ready"
node apps/api/dist/probe-queue.mjs
```

Expected: the API still answers 200, and enqueueing still succeeds with `waiting: 1` — the job simply waits, because nothing is consuming. That is the second acceptance criterion.

Stop the API too, and clear the probe job:

```bash
kill "$(cat /tmp/pd41-api.pid)"
$RCLI --scan --pattern 'bull:catalog-sync:*' | while read -r k; do $RCLI DEL "$k"; done
$RCLI KEYS 'bull:*'
```

Expected: empty.



- [ ] **Step 7: Commit**

```bash
pnpm typecheck && pnpm lint
git status --short
git add apps/api/src/worker.module.ts apps/api/src/worker.ts
git commit -F - <<'EOF'
[PD-41]: add the worker entrypoint

createApplicationContext, not create: the worker accepts no requests, so it has
no adapter and no port. WorkerModule is not AppModule - a process answering no
requests has no use for controllers, four global guards or Better Auth, and
booting auth here would mean a second process holding session-signing
capability for nothing.

Verified: both processes run against one Redis, only the API listens on 4000,
and killing the worker leaves the API answering 200 while enqueued jobs simply
wait. LOG_LEVEL=warn silences the worker's info lines the same way it silences
the API's, which is PD-19's third criterion finally observable.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 5: Measure retry, backoff, the dead letter and the drain

The third acceptance criterion is a property of the queue configuration, not of any processor. It is measured with a processor that exists only for the measurement and is deleted before this task commits.

**Files:**
- Create then delete: `apps/api/src/queue/probe.processor.ts`
- Modify then revert: `apps/api/src/worker.module.ts`
- Create: `apps/api/src/queue/README.md`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: `queue/README.md`, carrying the measured numbers and the rules PD-42 inherits.

- [ ] **Step 1: Write the temporary processor**

Create `apps/api/src/queue/probe.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE } from './queue.constants.js';

/** TEMPORARY — PD-41 measurement only. Deleted before this task commits. */
@Processor(QUEUE.catalogSync)
export class ProbeProcessor extends WorkerHost {
  private readonly logger = new Logger(ProbeProcessor.name);

  async process(job: Job): Promise<void> {
    const data = job.data as { mode?: string };
    this.logger.log(
      `job ${job.id} attempt ${job.attemptsMade + 1} at ${new Date().toISOString()}`,
    );

    if (data.mode === 'fail') {
      throw new Error('probe failure');
    }

    if (data.mode === 'sleep') {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      this.logger.log(`job ${job.id} finished its sleep`);
    }
  }
}
```

Add it to `apps/api/src/worker.module.ts` as `providers: [ProbeProcessor]` with the matching import.

- [ ] **Step 2: Measure retry, backoff and the failed set**

```bash
pnpm --filter @pokedrop/api build
( cd apps/api && node dist/worker.js > /tmp/pd41-retry.txt 2>&1 & echo $! > /tmp/pd41-worker.pid )
sleep 6
```

Create `apps/api/dist/probe-add.mjs`:

```js
import { Queue } from 'bullmq';

const q = new Queue('catalog-sync', { connection: { url: 'redis://localhost:6379', db: 1 } });
const job = await q.add('probe', { mode: process.argv[2] ?? 'fail' });
console.log('enqueued', job.id, 'mode', process.argv[2] ?? 'fail');
await q.close();
```

```bash
node apps/api/dist/probe-add.mjs fail
sleep 45
grep "attempt" /tmp/pd41-retry.txt
$RCLI ZRANGE bull:catalog-sync:failed 0 -1
```

Expected: three `attempt` lines, numbered 1, 2 and 3, with roughly 5 and 10 seconds between the first pair and the second (exponential from a 5 000 ms base; the third gap would be 20 s but there is no fourth attempt). The job id then appears in the `failed` sorted set.

Record the three timestamps — they go into the README in Step 5.

- [ ] **Step 3: Confirm the dead letter persists**

```bash
sleep 5
$RCLI ZRANGE bull:catalog-sync:failed 0 -1
$RCLI HGET "bull:catalog-sync:$($RCLI ZRANGE bull:catalog-sync:failed 0 -1 | head -1)" failedReason
```

Expected: the job is still in `failed`, and its `failedReason` is `probe failure`. `removeOnFail: { age: 604800 }` is what keeps it there — this is the dead letter the ticket asks for, and it needs no fourth queue.

- [ ] **Step 4: Measure the graceful drain with SIGINT**

The worker started in Step 2 wrote its pid to `/tmp/pd41-worker.pid`.

```bash
node apps/api/dist/probe-add.mjs sleep
sleep 2
kill -INT "$(cat /tmp/pd41-worker.pid)"
sleep 15
tail -20 /tmp/pd41-retry.txt
```

SIGINT rather than SIGTERM, and not as a preference: Node has no real POSIX
signal delivery on Windows, so SIGTERM kills the process before the shutdown
hooks run. SIGINT is delivered, and Nest listens for both.

Expected, in this order: `finished its sleep` for the sleeping job, then `Redis connection closed` and `Database connection closed`, then the process exits. The job completed rather than being abandoned — that is the drain.

If the process dies before `finished its sleep`, the shutdown hooks did not run. Check `app.enableShutdownHooks()` is present in `worker.ts` before concluding anything about the platform.

- [ ] **Step 5: Write the module README with the measured numbers**

Create `apps/api/src/queue/README.md`. Replace the bracketed intervals in the "Measured" section with the real gaps from Step 2:

```markdown
# Queue module

Background work, and the process that runs it. The API enqueues; the worker
consumes. Neither can take the other down.

## The split, in one sentence

`BullModule.registerQueue` creates **producers**; a `@Processor` class creates a
**worker**. Both entrypoints import this module, and the API is a producer only
because it declares no processor. Nothing else distinguishes them.

## The queues

| Name | Filled by | Consumed by |
| --- | --- | --- |
| `catalog-sync` | PD-42's cron, PD-81's admin endpoint | PD-42 |
| `price-sync` | PD-49's nightly sweep, PD-50, PD-52 | PD-48 |
| `trade-expiry` | PD-74 | PD-74 |

Names live in `queue.constants.ts` and nowhere else. A mistyped literal does not
fail — it creates a second queue that nothing consumes, and the jobs appear to
vanish.

## Default job options

From `config.queue.defaults`. Measured on 2026-09-18 against the running stack.

| Option | Value |
| --- | --- |
| `attempts` | 3 |
| `backoff` | exponential, 5 000 ms base |
| `removeOnComplete` | 24 h, or 1 000 jobs |
| `removeOnFail` | 7 days |

A job that throws is retried at roughly +5 s and +15 s from the first attempt,
then stops.

<!-- Replace the line below with the three timestamps from the measurement in
     PD-41 Task 5 Step 2, in the form:
     Measured 2026-09-18: attempt 1 at 12:00:00.0, attempt 2 at 12:00:05.1,
     attempt 3 at 12:00:15.2.
     Do not commit this file with the instruction still in it. -->
Measured gaps: REPLACE-WITH-MEASURED-TIMESTAMPS.

## There is no dead-letter queue

BullMQ does not have one, and does not need one. A job that exhausts `attempts`
moves to the `failed` sorted set and stays there — that set **is** the dead
letter.

What makes it work is `removeOnFail: { age: 7d }`. The two obvious alternatives
are both wrong: `true` deletes the evidence at the moment it becomes
interesting, and `false` keeps every failure for ever in the same Redis database
as the queues, which is a memory leak with a slow fuse.

To read it:

```bash
docker compose exec -T redis redis-cli -n 1 ZRANGE bull:catalog-sync:failed 0 -1
docker compose exec -T redis redis-cli -n 1 HGET bull:catalog-sync:<id> failedReason
```

## Rules the next ticket inherits

**A cron trigger enqueues; it never executes inline.** `@nestjs/schedule` is not
installed yet — PD-42 adds it, because that is the first ticket with a schedule
to keep. When it does, the scheduled method's entire body is a `queue.add(...)`.
Doing the work in the cron callback would run it inside the API process if the
decorator ever landed in a module the API imports, and would lose every retry,
backoff and failure record this module provides.

**Correlate on the job id.** The worker's equivalent of a request id is
`job.id`. Put it on a child logger inside the processor:

```ts
this.logger.log(`job ${job.id} attempt ${job.attemptsMade + 1}`);
```

It cannot live in the logger options — `pino-http` has a `genReqId` hook and no
equivalent for jobs, which is why `buildWorkerLoggerOptions` carries only the
level and the transport.

**Do not hand BullMQ `RedisService.client`.** It sets `maxRetriesPerRequest` to
`null` on connections it constructs, because a blocking read has no meaningful
retry ceiling. Given an instance it can only print a warning. The cache's client
is configured for the opposite purpose — to give up quickly and report a miss —
so sharing it produces a worker whose blocking reads retry-limit themselves,
which presents as a queue that silently stops consuming.

## Running it

```bash
pnpm --filter @pokedrop/api dev:worker    # watch mode
pnpm --filter @pokedrop/api start:worker  # from dist
```

The worker holds no port. With no processors registered it still stays alive,
because the Redis and Postgres sockets its modules open keep the event loop
busy.

## Shutdown

`enableShutdownHooks` lets `@nestjs/bullmq` close its workers, and BullMQ's
`close()` waits for the job in flight — a processor halfway through a
transaction finishes rather than being abandoned.

**On Windows, use SIGINT to test this.** Node has no real POSIX signal delivery
there, so SIGTERM kills the process before the hooks run; SIGINT is delivered
and Nest listens for it. In Docker, SIGTERM behaves. PD-128 confirms it on the
platform that will actually run it.
```

- [ ] **Step 6: Remove the temporary processor and everything it left behind**

```bash
rm apps/api/src/queue/probe.processor.ts
git checkout apps/api/src/worker.module.ts
rm -f apps/api/dist/probe-queue.mjs apps/api/dist/probe-add.mjs
$RCLI --scan --pattern 'bull:*' | while read -r k; do $RCLI DEL "$k"; done
$RCLI KEYS 'bull:*'
pnpm typecheck && pnpm lint
git status --short
```

```bash
grep -n "REPLACE-WITH-MEASURED-TIMESTAMPS" apps/api/src/queue/README.md
```

Expected: Redis db 1 is empty, both gates pass, `git status` shows only the new `queue/README.md`, and the `grep` finds **nothing** — if it matches, the measured timestamps from Step 2 were never substituted and the file is not ready to commit. If `worker.module.ts` still differs, the `providers` entry was not reverted.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/queue/README.md
git commit -F - <<'EOF'
[PD-41]: document the queue defaults and what they were measured to do

A job that throws is retried three times with exponential backoff and then stays
in the failed set, which is the dead letter BullMQ does not have a separate
queue for. Measured with a temporary processor, since the behaviour belongs to
the queue configuration rather than to any processor; the processor is gone.

The README also carries the two rules PD-42 inherits: a cron trigger enqueues
rather than executing inline, and correlation in a worker is the job id.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 6: Correct Foundation.md, document the worker, and push

**Files:**
- Modify: `docs/Foundation.md` (the ioredis entry under "Traps that will not announce themselves")
- Modify: `README.md` (local development)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing importable.

- [ ] **Step 1: Correct the ioredis trap**

`docs/Foundation.md` currently reads:

```markdown
- **ioredis is held at 5.8.2.** Version 6 is recent, and BullMQ declares only `ioredis >=5.0.0` — which admits it without testing it. Revisit at PD-41, with BullMQ, together.
```

The revisit happened, and the premise described the wrong major. Replace it with:

```markdown
- **ioredis is held at 5.8.2, and there are now two copies of it.** The revisit promised here happened in PD-41, and the premise was wrong: bullmq 5 declares no `ioredis` peer at all — it pins an exact `ioredis: 5.11.1` as a direct dependency, so there is no version negotiation to get wrong. The `>=5.0.0` peer is bullmq **6**, where ioredis became pluggable. We are on bullmq 5.81.5, so `node_modules/.pnpm` holds both 5.8.2 (ours) and 5.11.1 (bullmq's). That duplication is accepted: BullMQ never shares a connection with the cache anyway, because a blocking read needs `maxRetriesPerRequest: null` and the cache needs the opposite. The condition for moving to bullmq 6 is that it earns a maintenance dist-tag of its own, the way 3, 4 and 5 each did.
```

- [ ] **Step 2: Document running the worker**

In `README.md`, after the "Bring the stack up" section's seed paragraph and before the services table, add:

````markdown
### Run the API and the worker

```bash
pnpm --filter @pokedrop/api dev          # API on 4000
pnpm --filter @pokedrop/api dev:worker   # background worker, no port
```

The worker is a second entrypoint into the same codebase (`src/worker.ts`). It
consumes the BullMQ queues in Redis db 1 and holds no port of its own, so
killing it leaves the API serving — enqueued jobs simply wait. It registers no
processors yet; PD-42 adds the first.
````

- [ ] **Step 3: Full gates and a clean build**

```bash
npx prettier --write docs/Foundation.md README.md apps/api/src/queue/README.md
npx prettier --check .
pnpm typecheck && pnpm lint && pnpm build
git status --short
```

Expected: all pass.

- [ ] **Step 4: Commit and push**

```bash
git add docs/Foundation.md README.md
git commit -F - <<'EOF'
[PD-41]: correct the ioredis trap and document the worker

Foundation.md promised a revisit at PD-41 and named the wrong major: the
ioredis >=5.0.0 peer it worried about is bullmq 6. Version 5 pins an exact
ioredis of its own, so the real consequence is two copies in the tree, not a
version negotiation. Recorded with the condition for moving to 6.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git push origin dev
```

---

## Acceptance criteria

Checked against the ticket after Task 6.

- [ ] **API and worker run as separate processes against one Redis.** Task 4 Step 4 — both running, only the API listening on 4000, queue keys in db 1.
- [ ] **Killing the worker leaves the API fully responsive.** Task 4 Step 5 — `health/ready` still 200, enqueueing still succeeds, the job waits.
- [ ] **A failed job retries with backoff and lands in a dead-letter state after N attempts.** Task 5 Steps 2 and 3 — three attempts at roughly +5 s and +15 s, then the `failed` set, still there afterwards.
- [ ] **PD-19's third criterion: the worker shares the API's logger configuration.** Task 2 — one `buildBaseLoggerOptions`, read by both entrypoints; the API's output verified unchanged across the refactor.

## Out of scope

`@nestjs/schedule` and any cron trigger (PD-42) · the catalog sync processor (PD-42) · the price sync processor (PD-48) · the trade expiry processor (PD-74) · enqueueing from an HTTP route (PD-81) · `SyncRun` and run metrics (PD-42) · a worker container or Dockerfile (PD-128) · queue depth on a dashboard (PD-82).
