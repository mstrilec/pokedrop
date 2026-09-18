# M0 · Foundation & Tooling

What the first milestone built, why each piece looks the way it does, and where the sharp edges are. Twelve tickets, PD-10 through PD-21, all closed.

This is the orientation for anyone opening the repository — including a later you. [Architecture.md](Architecture.md) says how the finished system is meant to be shaped; this says what actually exists today, and what it will do to you if you touch it carelessly.

---

## What exists

No feature works yet. There are no models, no auth, no endpoints beyond health. What M0 produced is the layer everything else stands on: an application that boots, validates its environment, talks to Postgres and Redis, shapes every failure identically, logs in a queryable form, reports its own health, and is checked by CI on every push.

```
apps/
  api/          NestJS 12, ESM, Express 5
    src/
      common/   error envelope, Prisma error mapping, request ids, Zod DTOs, validation pipe
      config/   Zod-validated environment, typed AppConfig
      health/   liveness and readiness probes
      logging/  pino configuration
      prisma/   PrismaService with lifecycle and transactions
      redis/    ioredis client, CacheService, key builders
  web/          Next.js 16 App Router, React 19 — scaffolding only
packages/
  shared/       47 Zod schemas, the contract both apps import
```

| Service | Port | Notes |
| --- | --- | --- |
| API | 4000 | `/api/v1`, Swagger at `/docs` |
| Web | 3000 | scaffold only |
| PostgreSQL 17 | **5433** | not 5432 — see below |
| Redis 7.4 | 6379 | db **0** cache, db **1** queues |

```bash
cp .env.example .env
docker compose up -d --wait
pnpm install
pnpm dev
```

---

## The subsystems

### Workspace (PD-10)

A pnpm workspace of three packages. Node 22 and pnpm 10 are both pinned in the root `package.json` (`engines`, `packageManager`) — and CI reads its versions from those same two fields rather than repeating them.

The API is ESM (`"type": "module"`, `module: nodenext`), so relative imports carry a `.js` extension even in TypeScript source. That is not a style choice: Node resolves the emitted path, not the source one.

Cross-package imports are policed by `no-restricted-imports`: `apps/web` may not reach into `apps/api` and vice versa, and both go through `@pokedrop/shared`. The rule lists both the package form and the relative form, because it matches the import specifier **as written**, not the resolved path — `../../api/src/...` contains no `apps/api` and would otherwise pass.

### Local services (PD-11)

Docker Compose runs `postgres:17-alpine` and `redis:7.4-alpine`, both with healthchecks, so `docker compose up -d --wait` means the database is actually accepting connections rather than merely started.

**Postgres is published on 5433, not 5432.** A natively installed PostgreSQL already owned 5432 on the development machine, and Docker Desktop published over it without raising an error — so `localhost:5432` silently reached the wrong server. Migrations landing in the wrong database is a failure you discover much later. Both ports are settable in `.env`.

Redis is split by logical database rather than by instance: **db 0** is the read cache, **db 1** will be the BullMQ queues. The environment schema refuses to boot if the two are equal.

### Quality toolchain (PD-12)

ESLint 9 flat config in a single root file, Prettier, Husky. The pre-commit hook runs lint-staged; the commit-msg hook runs commitlint against a custom rule — `[PD-NN]: short lowercase description`, no trailing period.

`apps/api` and `packages/shared` use `recommendedTypeChecked` — type-aware linting. It is slower, and it earns that: it caught four real defects in PD-14's first draft, including two enum comparisons against raw numbers.

### Shared contracts (PD-13)

47 Zod schemas — six enums, the entities from [DataModel.md](DataModel.md), pagination, the error envelope, fourteen branded ids. Every type is inferred with `z.infer`; nothing is declared twice. The only dependency is `zod`.

Four deliberate departures from the data model:

- **`Rarity` is a string, not an enum.** The list is extensible; a closed enum would turn the next new set into a failed catalog sync. `RarityTier` is the closed five-step ramp the UI renders.
- **`Set` is exported as `CardSet`.** A type named `Set` shadows the global one for every importer, turning an ordinary `Set<string>` annotation into a type error.
- **`User` omits `passwordHash`.** Storage, not contract — it should not be expressible in a response body.
- **Dates use `z.coerce.date()`**, accepting both the ISO string that crosses the wire and the `Date` Prisma returns, so one schema serves both sides.

The apps resolve this package through its compiled `dist`. That matters more than it looks — see [Known gaps](#known-gaps-and-risks).

### Configuration (PD-15)

One Zod schema over the raw environment, parsed once at boot. Failure names the offending variables instead of dumping a stack. The parsed result becomes `AppConfig`: a namespaced, already-interpreted object injected through the `APP_CONFIG` token.

`ConfigService` is deliberately unused. Its `get()` returns `T | undefined`, which is exactly the leak this module exists to prevent. `process.env` appears nowhere in `apps/api/src` outside this module.

`DB_QUERY_LOGGING` defaults to off. Logging every statement throughout development trains you to ignore the output on the day you need it to hunt an N+1.

### Database access (PD-16)

A global `PrismaModule`. `PrismaService extends PrismaClient`, connects on module init, disconnects on shutdown, and exposes `withTransaction(fn)` — the primitive both transactional cores (pack open, trade settle) will build on. Nothing else should call `$transaction` directly.

Prisma 7 changed two things worth knowing before touching it:

- **The datasource block no longer accepts `url`.** The CLI reads it from `prisma.config.ts`, which loads the root `.env` explicitly through `process.loadEnvFile` — Prisma 7 stopped doing that itself. Without that line, `prisma migrate` fails with _"datasource.url property is required"_.
- **The client needs a driver adapter.** `PrismaService` builds `PrismaPg` from the validated config, so the connection string still comes from exactly one place.

### Cache (PD-17)

A thin `CacheService` over `ioredis` — not `cache-manager`, despite the ticket title. Three reasons, heaviest first: `invalidate(pattern)` needs `SCAN` on a raw client and no `cache-manager`/Keyv layer can delete by pattern; the ioredis store for `cache-manager` is deprecated by its own maintainer as of v6's move to Keyv; and the supported Keyv store speaks node-redis, which would put a second Redis client library in the process alongside the ioredis BullMQ needs.

Surface: `get` · `set` · `del` · `getOrSet` · `invalidate`, plus `CacheService.ttl` carrying the TTL table, so reaching for a configured value is easier than writing a number.

Three properties that are easy to destroy while "simplifying":

- **The `cache:` prefix is part of the key, built in `cache.keys.ts` — not ioredis' `keyPrefix` option.** `keyPrefix` is not applied to `SCAN`'s `MATCH` pattern, and keys returned by `SCAN` already carry it. Feeding those to `del` on the same client prefixes them a second time and deletes nothing, **without raising an error** — a pattern invalidation would report success and do nothing.
- **`invalidate` refuses any pattern outside the `cache:` namespace.** The queues have their own logical database, but that separation is one edited line of `.env` away from vanishing.
- **`getOrSet` takes an optional Zod schema.** JSON has no date type, so a cached `Date` reads back as a string while TypeScript goes on insisting it is a `Date`. Pass the schema for anything carrying dates.

`lockKeys` is exported separately from `cacheKeys` on purpose. `CacheService` treats a Redis failure as a miss and carries on — correct for a cache, catastrophic for a lock. The pack-open idempotency lock must be taken with `SET NX PX` directly.

### Errors and request correlation (PD-18)

Every failure leaves as `{ statusCode, error, message, requestId }`. `error` is always the HTTP reason phrase, never a framework class name. Responses at 500 and above carry a fixed message; the real cause and its stack go to the log under the same request id.

- **Unmatched routes** never enter the Nest pipeline, so a terminal handler is mounted after `app.init()`, behind the router. It builds the envelope through the same function the filter uses, so the two cannot drift. Express 5 with path-to-regexp 8 rejects `@All('*')`, which rules out a catch-all controller anyway.
- **Request ids** come from middleware registered before the router. An inbound `X-Request-Id` is adopted only if it matches `[A-Za-z0-9._-]{1,128}` — the value reaches both the log and the response body, where a newline would let a caller forge a log record.
- **Prisma failures map to real statuses,** on both paths: `P2002` from model operations, and `P2010` from raw queries, whose real cause hides at `meta.driverAdapterError.cause.kind`. Mapping only `P2002` would return 500 on every raw-path conflict. Messages stay generic, because a constraint name identifies a table and a column.

### Logging (PD-19)

`nestjs-pino` over `pino-http`. `app.useLogger` routes Nest's own `Logger` through it, so every existing `new Logger(SomeService.name)` became a pino child with `context` as a field — without a single service changing. All options live in one exported `buildLoggerOptions(config)`, which the future worker entrypoint imports rather than reimplements.

Four settings that are not defaults:

- **`genReqId` returns the id the middleware already set.** Letting pino mint its own would put a different id in the log from the one in the envelope and the header.
- **`customLogLevel` maps status to level.** Without it, `pino-http` writes _every_ completion line at `useLevel` — `info`. A 500 would be recorded at the same level as a successful read, and an alert on `level >= error` would never fire.
- **Request headers are an allowlist, not a redaction list.** The default serializer logs every header, so any future bearer-style header would be logged in full from the day it is introduced. `redact` paths remain as a second layer.
- **The response serializer emits the status code alone.** The default includes response headers, and `Set-Cookie` on a sign-in response is a session handed to whoever can read the log.

Request bodies are never serialized, so a password in a sign-up payload does not reach the log at all. Liveness probes are excluded from logging; readiness is not, because a failing readiness probe is the signal that an instance stopped serving.

A 5xx produces **two** lines by design: the completion line with `responseTime`, and the filter's record with the real cause, correlated on `req.id`. The filter answers the request itself, so Express never sees the exception and `pino-http` can only report "failed with status code 500".

### Health probes (PD-20)

`/health/live` is dependency-free on purpose. A liveness probe that fails because Postgres is down has an orchestrator restart a healthy process — which does nothing for Postgres and drops every request in flight. Only `/health/ready` reports dependencies, so traffic is withheld while the instance stays alive to recover.

Measured healthy: ready 23ms, live 2ms.

- **A controller-scoped filter is load-bearing here.** Terminus signals failure by throwing `ServiceUnavailableException` whose body _is_ the report. The global filter reshaped it into the envelope and, since 503 clears the server-error floor, replaced the message with "Internal server error" — leaving no indication of which dependency was down, on the one endpoint whose job is to say. The scoped filter catches only 503; anything else from these routes still returns the documented envelope.
- **The Redis indicator checks `client.status` before pinging.** ioredis keeps `enableOfflineQueue` on by default, so with the server stopped `ping()` does not reject — it queues and waits for a reconnection. The probe would have hung to its timeout instead of failing.

### CI (PD-21)

Three parallel jobs — typecheck, lint (plus `format:check`), build — on every push to `dev` and `main`, sharing a composite setup action. A warm run is 25–30s per job.

Versions are never repeated in YAML: `pnpm/action-setup` reads `packageManager` and `actions/setup-node` reads `engines.node`, both from the root `package.json`, so CI cannot drift from the local toolchain through a line somebody forgot to update.

**CI earned its keep on the first run.** It failed — not on the workflow, but on a defect invisible locally: `pnpm typecheck` and `pnpm lint` did not work from a clean checkout, because both resolve `@pokedrop/shared` through a `dist` that existed on the development machine only as a leftover. The `build` job passed throughout, since `pnpm -r run build` compiles the shared package first by topological order — which is precisely why the gap had stayed hidden. Both scripts now build it first.

---

## Known gaps and risks

### Deliberate, and tracked

| Gap | Consequence | Closes in |
| --- | --- | --- |
| **No automated tests during v1** | CI checks types, lint and build — nothing checks behaviour. A refactor that compiles and lints clean can still be wrong. Every claim in this repository was verified by running it once, by hand, at the time it was written. | PD-124, PD-125 |
| **Health routes carry no `@Public()`** | The day a global auth guard merges, both probes return 401. An orchestrator reads that as a dead process and restarts a healthy instance, repeatedly. | PD-33 |
| **Health routes are not exempt from throttling** | The same failure shape with 429: probes arrive from one source IP every few seconds. | PD-36 |
| **No worker process** | PD-19's third criterion — worker and API sharing logger configuration — is true by construction (one exported factory) but has never been observed. | PD-41 |
| **Prisma schema has zero models** | Nothing persists yet; all current database access is raw SQL. | PD-22 |
| **`AppController` returns "Hello World!"** | `GET /api/v1` is scaffolding. `AppService` deliberately imports from `@pokedrop/shared` to exercise the contract boundary from the API side; delete both once real modules exist. | first feature ticket |

### Traps that will not announce themselves

- **`pnpm up prisma` will break the build.** The `latest` dist-tag for `prisma` is an 8.0 release candidate while `@prisma/client` is on stable 7.10.0, so a naive upgrade installs mismatched majors. Both are pinned to exactly `7.10.0` and must move together.
- **Anything token-bearing in a query string will be logged.** The URL is logged whole, which is worth having for catalog searches. A password-reset token added as a query parameter would land in the logs — redact it in `logger.options.ts` before introducing one.
- **`getOrSet` cannot cache `null`.** A stored `null` reads back as a miss, so a loader that legitimately returns `null` re-runs on every request. None of the current entries can be null; represent absence some other way if that changes.
- **`packages/shared/dist` is a build input, not only an output.** `typecheck` and `lint` build it first. A new script that lints or typechecks without that step will pass locally and fail in CI.
- **ESLint is held at 9.** ESLint 10 crashes `eslint-plugin-react` (`contextOrFilename.getFilename is not a function`) through `eslint-config-next`. npm now marks ESLint 9 deprecated; the upgrade waits on the plugin, not on us.
- **ioredis is held at 5.8.2, and there are now two copies of it.** The revisit promised here happened in PD-41, and the premise was wrong: bullmq 5 declares no `ioredis` peer at all — it pins an exact `ioredis: 5.11.1` as a direct dependency, so there is no version negotiation to get wrong. The `>=5.0.0` peer is bullmq **6**, where ioredis became pluggable. We are on bullmq 5.81.5, so `node_modules/.pnpm` holds both 5.8.2 (ours) and 5.11.1 (bullmq's) — verified. The duplication is accepted: BullMQ never shares a connection with the cache anyway, because a blocking read needs `maxRetriesPerRequest: null` and the cache needs the opposite. The condition for moving to bullmq 6 is that it earns a maintenance dist-tag of its own, the way 3, 4 and 5 each did.

### Platform

- **No signal runs shutdown hooks on Windows.** Node has no real POSIX signal delivery there, so the process is killed before `onModuleDestroy`. PD-41 assumed SIGINT was the exception and measured otherwise: `kill -INT` from Git Bash left the worker running with no hook firing at all. A real Ctrl+C in an interactive console does deliver it; a script cannot. The mechanism itself is sound — `app.close()` drains BullMQ and closes Redis and Postgres cleanly, measured in PD-41 — and SIGTERM behaves in Docker. Do not read a missing shutdown log on Windows as a bug.
- **Line endings.** Git reports CRLF normalisation on `docs/*.md` for every commit made from Windows. Harmless, but it makes diffs noisier than they need to be.

---

## What M1 inherits

A booting application with typed configuration, a database client with transactions, a namespaced cache, uniform errors, correlated structured logs, health probes and a green pipeline — and no domain whatsoever.

The first thing M1 does is give Prisma some models. Everything above was built to be indifferent to what they turn out to be.
