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
| `price-sync` | PD-50, PD-52 | PD-48 |
| `price-sweep` | PD-49's nightly cron | PD-49 |
| `trade-expiry` | PD-74 | PD-74 |

`price-sweep` is not `price-sync` filled by a fourth producer. PD-49's sweep is
its own coordinator job on its own queue, calling `PriceBatchService` directly
rather than enqueuing 83 `price-sync` jobs — see `apps/api/src/sync/README.md`,
"The nightly price sweep".

Names live in `queue.constants.ts` and nowhere else. A mistyped literal does not
fail — it creates a second queue that nothing consumes, and the jobs appear to
vanish.

## Default job options

From `config.queue.defaults`.

| Option | Value |
| --- | --- |
| `attempts` | 3 |
| `backoff` | exponential, 5 000 ms base |
| `removeOnComplete` | 24 h, or 1 000 jobs |
| `removeOnFail` | 7 days |

Measured 2026-09-18 against the running stack, with a processor that always
throws:

```
17:36:10.271  job 1 attempt 1
17:36:15.343  job 1 attempt 2     +5.07s
17:36:25.384  job 1 attempt 3    +10.04s
```

Then the job stopped and stayed in `failed` with `failedReason` = `probe failure`.

## `defaultJobOptions` is applied by the producer, not the queue

The trap this module has. These defaults live on the `Queue` instance that
`BullModule` builds — they are **not** stored in Redis and they are **not**
applied by the worker.

A producer that constructs its own `new Queue('catalog-sync', { connection })`
gets BullMQ's bare defaults instead: `attempts: 1`, no backoff, no retention
policy. The job runs once, fails once, and no retry ever happens. Nothing warns
about it.

Measured: the first attempt at this measurement enqueued through a hand-built
`Queue` and saw exactly one attempt where three were expected.

**So anything that enqueues must use the injected queue:**

```ts
constructor(@InjectQueue(QUEUE.catalogSync) private readonly queue: Queue) {}
```

Verified by reading `job.opts` back after an injected-queue `add`:

```json
{ "attempts": 3, "backoff": { "type": "exponential", "delay": 5000 },
  "removeOnComplete": { "age": 86400, "count": 1000 },
  "removeOnFail": { "age": 604800 } }
```

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
Doing the work in the callback would lose every retry, backoff and failure
record this module provides.

**Correlate on the job id.** The worker's equivalent of a request id is
`job.id`:

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

The worker holds no port — verified: with both processes up, one PID owns 4000
and it is the API's. With no processors registered the worker still stays alive,
because the Redis and Postgres sockets its modules open keep the event loop
busy.

## Shutdown

`app.close()` drains: `@nestjs/bullmq` closes its workers in `onModuleDestroy`,
and BullMQ's `close()` waits for the job in flight. Measured — `close()` called
3 s into a 10 s job resolved 7.05 s later, immediately after the job finished:

```
14:40:14.026  app.close() called, job mid-flight
14:40:21.048  job finished
14:40:21.094  close() resolved
```

**The "connection closed" lines are misleading and harmless.** `PrismaService`
and `RedisService` log their disconnect as soon as `onModuleDestroy` runs, which
is before the drain completes. A query issued by the still-running job after
that line succeeds anyway — measured, a `SELECT 1` seven seconds later returned
`[{"ok":1}]`, because Prisma reconnects transparently. Do not reorder anything
on the strength of those log lines.

### Signals do not reach this process on Windows

`docs/Foundation.md` records that SIGTERM is not delivered to Node on Windows.
**SIGINT is no better from a non-interactive shell:** `kill -INT` from Git Bash
was measured to leave the process running with no hook firing at all. A real
Ctrl+C in an interactive console does deliver it; a script cannot.

So on Windows the drain is exercised through `app.close()` directly, which is
what a signal would call anyway. In Docker, SIGTERM behaves, and PD-128 is where
that gets confirmed on the platform that will actually run it.
