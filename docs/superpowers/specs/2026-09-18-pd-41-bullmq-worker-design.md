# PD-41 — BullMQ and the worker entrypoint

Design, 2026-09-18. Milestone M3 · Catalog Mirror & Sync.

Ticket: [PD-41](https://linear.app/mstrilec/issue/PD-41/bullmq-infrastructure-and-a-separate-worker-entrypoint) ·
Reference: `docs/Architecture.md` §7 (background sync) · `docs/PRD.md` §19 (workers scale independently).

Carries the third acceptance criterion of
[PD-19](https://linear.app/mstrilec/issue/PD-19/structured-logging-with-nestjs-pino-and-request-correlation) —
"worker processes use the same logger configuration as the API" — which could
not be observed there because no worker existed.

Taken before PD-39 deliberately: this ticket has no provider dependency, and
pokemontcg.io's card endpoint was answering 500 when M3 opened.

---

## What this is for

`docs/Architecture.md` §7 states the rule that shapes the whole sync layer:
prices are never fetched on the user request path. Something else has to fetch
them, and that something must fail without taking the API with it.

This ticket builds the second process and the queues between them. It fetches
nothing, writes nothing to the database, and registers no processors. What it
produces is the place PD-42's catalog sync, PD-48's price sync and PD-74's trade
expiry get to run.

---

## The dependency decision, and the measurement that inverted it

`@nestjs/bullmq@12.0.0` (published 2026-08-27) accepts
`bullmq ^3 || ^4 || ^5 || ^6`, so the choice is ours. Both lines are alive:

| | bullmq 5.81.5 | bullmq 6.3.7 |
| --- | --- | --- |
| Published | 2026-09-10 | **2026-09-18** — the day this was written |
| Releases in the line | 318, with its own `release-v5.x` dist-tag | 26 |
| ioredis | direct dependency, exactly `5.11.1` | optional peer |

The ioredis row is the surprise, and it corrects something this repository
already believes.

`docs/Foundation.md` holds ioredis at 5.8.2 and gives this reason: "BullMQ
declares only `ioredis >=5.0.0` — which admits it without testing it. Revisit at
PD-41, with BullMQ, together." That reads the wrong package. Measured:

```
$ npm view bullmq@5.81.5 dependencies
{ "tslib": "2.8.1", "semver": "7.8.5", "ioredis": "5.11.1",
  "msgpackr": "2.0.5", "cron-parser": "4.9.0", "node-abort-controller": "3.1.1" }

$ npm view bullmq@6.3.7 peerDependenciesMeta
{ "pg": {"optional": true}, "redis": {"optional": true},
  "ioredis": {"optional": true}, "bullmq-otel": {"optional": true} }
```

bullmq **5** does not declare a peer at all — it pins an exact ioredis of its
own. There is no version negotiation to get wrong, and no possibility of it
running against an ioredis it was not built against. The `>=5.0.0` peer
Foundation worried about is bullmq **6**, where ioredis became pluggable.

So the trade is the opposite of what it looked like:

- **bullmq 5** brings a second copy of ioredis (5.11.1) alongside ours (5.8.2).
- **bullmq 6** would run on our single copy.

### The decision: bullmq 5.81.5, pinned exactly

Two copies of ioredis cost about a megabyte and nothing else. They cannot
conflict, because BullMQ never shares a connection with the cache anyway — see
*Connections* below, where the two need contradictory settings. The duplication
is cosmetic.

A major released the same day is not cosmetic. This repository has no automated
tests (`docs/PRD.md` §20), so the only thing standing between a behavioural
regression and production is someone noticing. That is exactly the situation in
which the newest major is the wrong default, and this repository already behaves
that way on purpose: Prisma is pinned because `latest` points at an 8.0 release
candidate, and ESLint is held at 9 because 10 crashes a plugin.

The queue this ticket builds will later carry pack opening and trade settlement.
It is the wrong place to be first.

bullmq 6 is the upgrade path, and the condition for taking it is that it earns a
maintenance dist-tag of its own the way 3, 4 and 5 each did. Until then 5 is
actively released — 5.81.5 landed six weeks *after* 6.0.0 — so staying is not
the same as being stranded.

Pinned exactly, the way `prisma`, `ioredis`, `better-auth` and
`@nestjs/throttler` already are in `apps/api/package.json`.

### `@nestjs/schedule` is deferred to PD-42

A deliberate departure from the ticket's scope list.

There is no cron job to schedule. The nightly catalog sweep is PD-42, the price
sweep is PD-49, and trade expiry is PD-74. Installing a scheduler now would add
a dependency with zero call sites.

The comparison worth making is with PD-38, which shipped the provider registry
early even though PD-43 is its only consumer. That was right because retrofitting
the registry would have meant editing every site that had injected the single
token. `ScheduleModule.forRoot()` is not like that: adding it later is one line
in `worker.module.ts`, and the decorator that uses it lives in the processor
that needs it. Nothing has to be retrofitted, so nothing is bought by early
installation.

What does carry forward is the architectural rule — **a cron trigger enqueues,
it never executes inline** — and that goes in `queue/README.md`, where PD-42
will read it.

---

## Architecture

### Two processes, one codebase

```
apps/api/src/
  main.ts          → NestFactory.create(AppModule)                 HTTP, port 4000
  worker.ts        → NestFactory.createApplicationContext(WorkerModule)   no server
  worker.module.ts
  queue/
    queue.constants.ts   the three names, and nothing else
    queue.module.ts      forRootAsync + registerQueue
    index.ts
    README.md
```

`worker.ts` uses `createApplicationContext`, not `create`. The worker accepts no
requests, so it has no HTTP adapter, no port, and nothing listening.

### `WorkerModule` is not `AppModule`

`AppModule` imports the auth module, the mail module, the health controller, the
throttler, and registers four global guards. A process that answers no requests
needs none of it, and booting Better Auth inside it would mean a second process
holding session-signing capability for no reason.

`WorkerModule` imports exactly five things:

```
AppConfigModule · WorkerLoggingModule · PrismaModule · RedisModule · QueueModule
```

`PrismaModule` and `RedisModule` are `@Global()` and carry their own lifecycle
hooks, so the worker gets a connected database client and a cache client with no
extra wiring — and disconnects both on shutdown for the same reason.

### How the split actually works

This is the mechanism behind "API and worker run as separate processes", and it
is worth stating because it is not obvious from the `@nestjs/bullmq` surface.

`BullModule.registerQueue(...)` creates **producers**. A `@Processor(name)` class
creates a **worker**. They are independent: a process that registers a queue but
declares no processor can enqueue and never consumes.

So the API process imports `QueueModule` and gets three producers — that is what
PD-81's admin "sync now" endpoint will call. The worker process imports the same
`QueueModule` plus the processor classes, and consumes. One module definition,
two roles, decided by which process declares a `@Processor`.

---

## The queues

Three, from the ticket: `catalog-sync`, `price-sync`, `trade-expiry`.

Names live in `queue/queue.constants.ts` and nowhere else, for the reason
already written into `cache.keys.ts`: a mistyped literal does not fail, it
silently creates a second queue that nothing consumes.

```ts
export const QUEUE = {
  catalogSync: 'catalog-sync',
  priceSync: 'price-sync',
  tradeExpiry: 'trade-expiry',
} as const;
```

### Default job options

In `buildAppConfig` under `queue.defaults`, as literals — the same reasoning
already recorded there for the cache TTLs: the point of the rule is that no
call site writes `5000`, and these are already the typed configuration layer.
Environment variables nobody will ever set are surface to keep in sync.

| Option | Value | Why |
| --- | --- | --- |
| `attempts` | 3 | Enough to ride out a restart or a brief upstream blip. A fourth attempt against a provider that has failed three times is not information. |
| `backoff` | exponential, 5 000 ms | 5s, 10s, 20s. Long enough that a rate-limited upstream has a chance to recover; short enough that a nightly sweep is not still retrying at breakfast. |
| `removeOnComplete` | `{ age: 24h, count: 1000 }` | Successful jobs are only useful for "did it run"; PD-42's `SyncRun` table answers that durably. |
| `removeOnFail` | `{ age: 7d }` | See below. |

`QUEUE_CONCURRENCY` already exists in `env.schema.ts` from PD-15, defaulting to
4, and is the worker-side concurrency. It needs no change.

### There is no dead-letter queue, and that is not an omission

The ticket asks for "dead-letter handling per queue". BullMQ has no dead-letter
queue and does not need one: a job that exhausts `attempts` moves to the `failed`
set and stays there. That set **is** the dead letter — provided `removeOnFail`
does not erase it.

Hence `{ age: 7d }` rather than the two obvious wrong answers. `removeOnFail:
true` would delete the evidence at the moment it became interesting; a job you
cannot inspect is a failure you cannot diagnose. `removeOnFail: false` keeps
every failure for ever, which is an unbounded Redis key set — a memory leak with
a slow fuse, in the same database as the queues themselves.

Seven days is the window in which somebody would actually look.

This is written down because "dead-letter" is a term from other brokers, and
reading it in the ticket could reasonably lead someone to build a fourth queue
that nothing would ever produce to.

---

## Connections

`BullModule.forRootAsync` receives connection **options**, not the `RedisService`
instance.

```ts
BullModule.forRootAsync({
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig) => ({
    connection: { url: config.redis.url, db: config.redis.queueDb },
    defaultJobOptions: config.queue.defaults,
  }),
});
```

**`url` here is BullMQ's field, not ioredis's, and that is worth knowing before
someone "corrects" it.** ioredis' own `RedisOptions` has no `url` — it takes a
URL as the first constructor argument instead — so reading the ioredis types
alone leads to the conclusion that this cannot work. BullMQ adds it
(`dist/esm/interfaces/redis-options.d.ts` in 5.81.5):

```ts
export interface BaseOptions {
  skipVersionCheck?: boolean;
  url?: string;
}
export type RedisOptions = IORedis.RedisOptions & BaseOptions;
```

That is what keeps `REDIS_URL` the single source of truth for both databases,
with no host/port parsing anywhere.

Two reasons for passing options rather than an instance, and the second is a
hard constraint rather than a preference.

**BullMQ opens several connections per queue and per worker.** Blocking commands
need a connection of their own, because a client parked in `BRPOPLPUSH` cannot
serve anything else. Handing it one instance to share would fight its own
design.

**A worker's connection needs `maxRetriesPerRequest: null`; the cache's must not
have it.** BullMQ's blocking reads have no meaningful retry ceiling — the whole
point is to wait. `CacheService`, by contrast, exists to give up quickly and
report a miss, because "a cache that throws turns a degraded dependency into an
outage" (`docs/Architecture.md` §8). The two requirements are opposites on the
same setting.

Passing options rather than an instance is what lets BullMQ apply what it needs.
Read from `dist/cjs/classes/redis-connection.js` in 5.81.5, the two branches are
not symmetric:

```js
if (this.extraOptions.blocking) {
  this.opts.maxRetriesPerRequest = null;   // given options: BullMQ fixes it
}
...
checkBlockingOptions(msg, options, throwError) {
  if (this.extraOptions.blocking && options && options.maxRetriesPerRequest) {
    throwError ? throw new Error(msg) : console.error(msg);   // given an instance: it can only complain
  }
}
```

Given options it owns, BullMQ sets `maxRetriesPerRequest = null` itself for
blocking connections. Given an instance, it cannot reconfigure what it did not
create — it only warns, and the warning is the kind that scrolls past. Handing
it `RedisService.client` would therefore mean a worker whose blocking reads
retry-limit themselves, which presents as a queue that stops consuming for no
visible reason.

Queues live in Redis **db 1**, reserved for them since M0. `EnvSchema` already
refuses to boot when `REDIS_CACHE_DB` equals `REDIS_QUEUE_DB`, so the separation
cannot be undone by an edited `.env` without a loud failure. BullMQ's own `bull:`
key prefix keeps it disjoint from the `cache:` namespace even if that guard were
ever removed.

---

## The logger, split rather than copied

PD-41's note asks for thought here rather than a copy, and the request is right.

`buildLoggerOptions(config)` returns `{ pinoHttp: … }`, and almost everything
inside it is about HTTP: `genReqId` reads the id PD-18's middleware put on a
request, `autoLogging` silences a liveness route, `customLogLevel` maps a status
code to a level, the `req` and `res` serializers shape request and response
objects, and every path in `redact` starts with `req.headers` or `res.headers`.

A worker has none of those. It has jobs.

What the two genuinely share is two fields: **`level`** and **`transport`**.
That is small, and it is still worth extracting, because those two are exactly
what makes the worker's output usable — pino-pretty in development, JSON in
production, at the configured level — and duplicating them is how they drift.

```
buildBaseLoggerOptions(config)  →  { level, transport }
buildLoggerOptions(config)      →  { pinoHttp: { ...base, genReqId, autoLogging,
                                                 customLogLevel, serializers, redact } }
buildWorkerLoggerOptions(config)→  { pinoHttp: { ...base } }
```

`nestjs-pino` takes its options under `pinoHttp` in both cases; with
`createApplicationContext` there is no HTTP adapter, so its middleware is never
mounted and the key is simply where pino's own options live.

This is what makes PD-19's third criterion true by construction rather than by
discipline: there is one transport decision in the repository, and both
entrypoints read it.

**Job correlation is the processor's job, not the options'.** The worker
equivalent of a request id is the job id, and it belongs on a child logger
created inside a processor — `new Logger(...)` with the job id as a field. PD-41
records the pattern in `queue/README.md`; PD-42 is the first to use it. Putting
it in the options would mean inventing a `genJobId` hook that pino-http does not
have.

---

## Shutdown

`app.enableShutdownHooks()` on the worker context. `@nestjs/bullmq` closes its
workers in `onModuleDestroy`, and BullMQ's `close()` waits for the job in flight
before resolving, so a job already running finishes rather than being abandoned
mid-transaction. `PrismaService` and `RedisService` then disconnect through their
own hooks.

### The Windows caveat, and how it is measured anyway

`docs/Foundation.md` records that SIGTERM does not reach a Node process on
Windows — there is no real POSIX signal delivery, so the process is killed
before `onModuleDestroy` runs.

That would make the third scope item unobservable on the development machine,
which is not acceptable for a repository whose claims are all measured. The way
around it is that **Node does deliver SIGINT on Windows**, and Nest's shutdown
hooks listen for SIGINT alongside SIGTERM. So the drain is measured with SIGINT:
enqueue a job that sleeps, signal the worker mid-job, and watch the job complete
before the process exits.

What that demonstrates is the mechanism — hooks fire, BullMQ drains, connections
close. Whether the orchestrator's SIGTERM reaches the process is a platform
question, and in Docker it does. PD-128 builds the production image and is where
that gets confirmed on the platform that will actually run it.

---

## Out of scope

| Not here | Where |
| --- | --- |
| `@nestjs/schedule` and any cron trigger | PD-42 |
| The catalog sync processor | PD-42 |
| The price sync processor | PD-48 |
| The trade expiry processor | PD-74 |
| Enqueueing from an HTTP route | PD-81 (admin sync endpoints) |
| `SyncRun` and any run metrics | PD-42 |
| A worker container or Dockerfile | PD-128 |
| Queue depth and job counts on a dashboard | PD-82 |

No processor of any kind is committed by this ticket. The third acceptance
criterion — a failed job retries with backoff and lands in a dead-letter state —
is a property of the queue configuration rather than of any processor, and is
measured with a temporary one that is removed afterwards, the same way PD-38
measured its boot refusal by temporarily wiring `SyncModule`. The repository is
left with the verified defaults and no dead code.

---

## Verification plan

No automated tests. Each item is run once, by hand, against the real stack.

1. **Two processes, one Redis.** Start the API and the worker. Both report a
   Redis connection; `redis-cli -n 1 KEYS 'bull:*'` shows the three queues' keys
   once a job has been enqueued.
2. **The worker is not a server.** `netstat` shows the worker holding no port,
   and the API still answers `GET /api/v1/health/ready` with 200.
3. **Killing the worker leaves the API responsive.** Kill the worker process;
   `health/ready` still returns 200 and a subsequent enqueue still succeeds —
   the job simply waits.
4. **Retry, backoff and the failed set.** Register a processor that throws,
   temporarily. Enqueue one job. Observe three attempts with roughly 5s, 10s and
   20s between them, then the job in the `failed` set via
   `redis-cli -n 1 ZRANGE bull:catalog-sync:failed 0 -1`. Confirm it is still
   there afterwards — that is the dead letter.
5. **Graceful drain.** With a processor that sleeps 10 seconds, enqueue a job and
   send SIGINT two seconds in. The job's completion is logged before the process
   exits, and the exit is clean.
6. **One logger configuration.** The worker's output is pino-pretty in
   development and the level honours `LOG_LEVEL`; setting `LOG_LEVEL=warn`
   silences its info lines exactly as it does the API's.
7. **Both entrypoints build.** `pnpm build` emits `dist/main.js` and
   `dist/worker.js`; `pnpm typecheck`, `pnpm lint` and `pnpm format:check` pass.

Remove the temporary processor before committing, and confirm `git status` is
clean.

---

## Files

**New**

| Path | Holds |
| --- | --- |
| `apps/api/src/worker.ts` | the second entrypoint |
| `apps/api/src/worker.module.ts` | the five imports and nothing else |
| `apps/api/src/queue/queue.constants.ts` | the three queue names |
| `apps/api/src/queue/queue.module.ts` | `forRootAsync` + `registerQueue` |
| `apps/api/src/queue/index.ts` | the module's public surface |
| `apps/api/src/queue/README.md` | the defaults, the dead-letter note, the cron rule |

**Edited**

| Path | Change |
| --- | --- |
| `apps/api/src/logging/logger.options.ts` | extract `buildBaseLoggerOptions`, add `buildWorkerLoggerOptions` |
| `apps/api/src/logging/logging.module.ts` | add `WorkerLoggingModule` |
| `apps/api/src/logging/index.ts` | export both |
| `apps/api/src/config/app.config.ts` | `queue.defaults` |
| `apps/api/src/app.module.ts` | import `QueueModule`, so the API can enqueue |
| `apps/api/package.json` | `bullmq`, `@nestjs/bullmq`; `start:worker`, `dev:worker` |
| `README.md` | how to run the worker |

Two dependencies, both pinned exactly: `bullmq` at `5.81.5`,
`@nestjs/bullmq` at `12.0.0`. No migration.

---

## Forward notes

**`docs/Foundation.md` has a line to correct.** Its "Traps that will not
announce themselves" section says ioredis is held at 5.8.2 because "BullMQ
declares only `ioredis >=5.0.0` — which admits it without testing it. Revisit at
PD-41, with BullMQ, together." The revisit happened here, and the premise turned
out to describe bullmq 6 rather than 5. The entry should be updated to say what
is now true: bullmq 5 pins its own ioredis, the duplication is accepted, and the
condition for moving to 6 is a maintenance dist-tag. This edit belongs to this
ticket and is part of the documentation task.

**PD-42 inherits three things from here.** The `catalog-sync` queue and its
producer; the rule that a cron trigger enqueues rather than executes; and the
job-id child logger pattern. All three are in `queue/README.md`.

**Queue depth is already reachable.** `Queue.getJobCounts()` gives PD-82 its
numbers without anything further being built here.
