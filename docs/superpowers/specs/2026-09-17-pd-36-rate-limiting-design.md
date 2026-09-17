# PD-36 — Rate limiting

Design, 2026-09-17. Milestone M2 · Auth & RBAC.

Ticket: [PD-36](https://linear.app/mstrilec/issue/PD-36/rate-limiting-with-nestjsthrottler-on-auth-pack-open-and-trade) ·
Reference: `docs/PRD.md` §17 (rate limiting & abuse) · `docs/API.md` (conventions).

---

## What this is for

Three things want a limiter, for three different reasons.

**Sign-up is the enumeration control.** PD-30 established that a duplicate registration necessarily reveals the address is taken — any status distinct from success is the oracle, so no wording change closes it. One 422 discloses one address. A limit is what stops someone walking a list of a million.

**Sign-in is the credential-stuffing control.** Sign-in itself does not leak: a wrong password and an unknown address return byte-identical responses with indistinguishable timings, 81.7 ms against 80.0 ms over 15 samples each, because the provider hashes a dummy password rather than returning early. The limiter must not undo that — see "Keying" below.

**Pack-open and trade creation are the economy controls.** Both mutate currency and inventory. Neither route exists yet, so this ticket defines their policy and the tickets that build them apply it.

### Honest about the strength

Ten attempts per fifteen minutes per IP turns an unbounded walk into roughly 960 addresses a day from one address. That stops a script. It does not stop a botnet, and nothing at this layer does. The docs will say that rather than "enumeration is closed".

---

## Architecture

### One storage, two enforcement points

```
                    ┌──────────────────────────────┐
  /api/auth/*  ───▶ │ authThrottleMiddleware       │──┐
  (Express, before  │ keyed by IP + path           │  │
   the auth handler)└──────────────────────────────┘  │
                                                      ├──▶ RedisThrottlerStorage
                    ┌──────────────────────────────┐  │    (one Lua script,
  /api/v1/*    ───▶ │ ThrottlerGuard (Nest)        │──┘     throttle: namespace)
                    │ keyed by user id, else IP    │
                    └──────────────────────────────┘
```

The second enforcement point exists because the Better Auth handler is registered on the Express instance in `main.ts`, outside the Nest router. A global `ThrottlerGuard` never sees those routes — which is a problem, because they are the ones most worth limiting.

Sharing one storage is the point of the design. Two limiters with two algorithms and two key namespaces drift: a change to the window in one place quietly does not apply in the other, and nobody notices until an incident. One storage means one algorithm, one namespace, and one answer to "what happens when Redis is down".

### `RedisThrottlerStorage`

Implements `ThrottlerStorage`, which is a single method:

```ts
increment(key, ttl, limit, blockDuration, throttlerName): Promise<{
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}>
```

It takes `RedisService` — the client that already exists, with its connection lifecycle, its error listener and its deliberate absence of `keyPrefix`. No second connection.

**The counter and its expiry are set in one Lua script, not two commands.** `INCR` followed by `PEXPIRE` has a window between them: a process that dies in that window, or a Redis failover, leaves a counter with no TTL. That counter never resets, and the caller is rate-limited permanently with no way to tell why. A script is atomic and removes the window.

> **Units are asymmetric, and getting it wrong is silent.** `ttl` and `blockDuration` arrive in **milliseconds**; `timeToExpire` and `timeToBlockExpire` must be returned in **seconds**. Confirmed against the reference implementation, which names its parameter `ttlMilliseconds` and computes `Math.ceil((expiresAt - Date.now()) / 1000)` for the return. Treat the input as seconds and every window is a thousand times too short — which looks like a limiter that never fires, not like a bug.

### The key namespace

`throttle:`, never under `cache:`.

`cache.keys.ts` already carries this warning for `lockKeys`: `CacheService.invalidate` deletes by pattern, and anything sharing the `cache:` prefix goes with it. A cache flush that also resets every rate-limit counter is a gift to an attacker — and cache flushes are routine, which is what makes it dangerous. The same note is repeated for the throttle keys, in the same file, because that is where someone will look.

### Redis failure is fail-open

A Redis error inside `increment` is logged at `warn` and returned as `{ totalHits: 1, timeToExpire: ttl / 1000, isBlocked: false, timeToBlockExpire: 0 }` — a first hit against a fresh window, which no limit refuses. The request proceeds.

This is a deliberate availability trade, not an oversight. A rate limiter is an abuse mitigation, not an access control: authorization is held by `SessionGuard` and `RolesGuard`, which read Postgres and are unaffected. Failing closed would make Redis a single point of failure for the entire API, so a brief cache-tier blip would take down sign-in, pack opening and trading at once. `CacheService` already made the same call for the same reason.

The cost is stated plainly rather than hidden: while Redis is down, there are no limits.

---

## Keying

| Layer | Tracker |
| --- | --- |
| `ThrottlerGuard` on `/api/v1/*` | the authenticated user's id, falling back to `req.ip` |
| `authThrottleMiddleware` on `/api/auth/*` | `req.ip` and the matched path |

**Never the email from the request body.** Two reasons, and the second makes the first moot.

A limiter keyed on the submitted address, or one that behaves differently for addresses that exist, reintroduces exactly the oracle Better Auth goes out of its way to avoid — the dummy-password hash exists so that a known and an unknown account are indistinguishable, and a limiter that treats them differently gives that away for free.

It is also impossible here. The Better Auth handler needs the raw body, which is why `bodyParser: false` is set on `NestFactory.create`; the middleware runs before the handler and therefore before any parser. There is no body to key on.

**User-id keying needs the session, so `ThrottlerGuard` runs after `SessionGuard`.** The cost is one database round-trip spent on a flood that carries a valid cookie before it is cut off. Accepted, for two reasons: `SessionGuard` performs no lookup when there is no cookie, so an anonymous flood stays cheap; and IP-only keying would punish everyone behind one corporate NAT collectively for one user's behaviour.

### `trust proxy`

`main.ts` currently never calls `app.set('trust proxy', …)`, and both possible mistakes are severe.

Leaving it unset behind a proxy makes `req.ip` the proxy's address — one key for every user on earth. The first few requests exhaust the limit for everybody, which is a self-inflicted outage.

Setting it to `true` trusts any `X-Forwarded-For` the client sends, so the client picks its own key: it evades its own limit and can exhaust someone else's.

The correct value is a hop count, and it differs per environment. `TRUST_PROXY_HOPS`, an integer, default `0`. Zero is correct for direct exposure and for local development. Behind exactly one proxy it is `1`.

---

## Policies

### The trap that shapes the auth policy

`GET /api/auth/get-session` is called by the frontend on every page load. A strict limit applied to the whole `/api/auth/*` prefix would throttle it first and hardest, and the application would appear to log people out at random.

So the middleware carries an explicit list of credential paths and applies the strict limit only to those:

```
/api/auth/sign-in/email
/api/auth/sign-up/email
/api/auth/reset-password
/api/auth/request-password-reset
```

Everything else under `/api/auth/*` gets the default limit.

### Values

| Name | Variable | Default | Applies to |
| --- | --- | --- | --- |
| strict | `THROTTLE_AUTH_LIMIT` / `THROTTLE_AUTH_WINDOW` | 10 per 900 s | the credential paths above |
| default | `THROTTLE_DEFAULT_LIMIT` / `THROTTLE_DEFAULT_WINDOW` | 100 per 60 s | every other route |
| moderate | `THROTTLE_MODERATE_LIMIT` / `THROTTLE_MODERATE_WINDOW` | 30 per 60 s | pack-open and trade creation, when those routes exist |

Windows are configured in **seconds** and converted to milliseconds in `buildAppConfig`, so that the unit asymmetry noted above is resolved in exactly one place and no `.env` file ever contains `900000`.

`app.config.ts` argues against environment variables for cache TTLs — "six variables nobody will ever set in any environment are just surface to keep in sync". This is not that case, on both counts: AC3 requires the values to come from config, and unlike a cache TTL a rate limit genuinely differs between development, staging and production.

### Exemptions

`@SkipThrottle()` on `HealthController`. `GET /health/live` and `/health/ready` are polled every few seconds from a single source, so under a per-IP limit they throttle themselves. A 429 from a liveness probe reads to an orchestrator as a dead process: it restarts a healthy instance, and then does it again.

`AppController`'s `GET /` keeps the default limit. It is not a probe.

---

## The 429 response

`ThrottlerException` is an `HttpException` carrying 429, so `AllExceptionsFilter` wraps it in the standard envelope with its request id — no new code. The guard sets `Retry-After` and the `X-RateLimit-*` headers itself (`throttler.guard.js:124,138-140`).

The Express middleware has no filter behind it, so it writes its own response: the same envelope shape, built with the same `buildErrorEnvelope` helper from PD-18, plus `Retry-After`. Using the helper rather than a hand-written object is what keeps the two layers from drifting into two different 429 bodies.

---

## Risk to retire first

`@nestjs/throttler` 6.7.0 ships CommonJS with no `exports` map (`main: dist/index.js`, no `type` field). `apps/api` is ESM with `module: nodenext`. This project has already lost time to exactly this class of problem — `nestjs-zod` in PD-19 — so the first implementation step is a throwaway import and typecheck, before any other code is written. If it fails, the design is unaffected but the plan gains a shim task.

Its peer range accepts `@nestjs/core` and `@nestjs/common` `^12`, so the package itself is current. The Redis storage adapter is not: `@nest-lab/throttler-storage-redis@1.2.0` stops at `^11` and would need a pnpm override, which is one reason the storage here is hand-written rather than installed.

---

## Verification plan

Every row is a command against the running stack.

| # | Claim | Method |
| --- | --- | --- |
| 1 | The throttler imports and typechecks under ESM | a throwaway import, `pnpm typecheck` |
| 2 | Exceeding the sign-in limit returns 429, not 401 (**AC2**) | 11 wrong-password posts, read the status of each |
| 3 | The 429 body is the standard envelope and carries `Retry-After` | read the last response in full |
| 4 | Limits are shared across two API instances (**AC1**) | boot a second process on port 4001 against the same Redis, exhaust on 4000, request on 4001 |
| 5 | Values come from config (**AC3**) | boot with `THROTTLE_AUTH_LIMIT=3`, confirm the fourth request is refused |
| 6 | The counter expires | exhaust, `PTTL` the key, confirm it is positive and bounded by the window |
| 7 | A counter is never left without a TTL | `PTTL` immediately after the very first hit, confirm it is not `-1` |
| 8 | `get-session` is not throttled by the strict policy | 30 calls in a row, all 200 |
| 9 | Health probes are exempt | 200 calls to `/health/live`, all 200 |
| 10 | Keyed by user, not IP, when authenticated | exhaust as user A, confirm user B from the same IP is unaffected |
| 11 | Keyed by IP when anonymous | exhaust anonymously, confirm a second anonymous caller from the same IP is refused |
| 12 | `TRUST_PROXY_HOPS` changes which address is used | boot with `1`, send `X-Forwarded-For`, confirm the key follows the header; boot with `0`, confirm it does not |
| 13 | Redis failure fails open | stop the Redis container, confirm requests still succeed and a warning is logged |

**The route these run against.** Measurements 5, 6, 7, 10 and 11 need a throttled route under the Nest router. `GET /api/v1` — `AppController.getHello`, the only Nest route that is neither a health probe nor absent — carries the default policy and serves. To keep the loops short they run with `THROTTLE_DEFAULT_LIMIT=3` in the environment, which is measurement 5's evidence as well: the threshold moves because the variable moved.

No throwaway route is added for this ticket. Unlike PD-35's CSRF guard, which only acts on mutating methods, the throttler acts on every method, so a route that already exists is enough.

Measurement 13 requires stopping a container the rest of the stack uses. It runs last, and `docker compose up -d --wait` restores it.

---

## Files

| Path | Change |
| --- | --- |
| `apps/api/package.json` | add `@nestjs/throttler` |
| `apps/api/src/redis/cache.keys.ts` | `THROTTLE_NAMESPACE` and `throttleKeys`, with the same warning `lockKeys` carries |
| `apps/api/src/throttle/redis-throttler.storage.ts` | **new** — the `ThrottlerStorage` implementation and its Lua script |
| `apps/api/src/throttle/throttle.module.ts` | **new** — `ThrottlerModule.forRootAsync` wired to the storage and the config |
| `apps/api/src/throttle/auth-throttle.middleware.ts` | **new** — the Express-layer limiter for `/api/auth/*` |
| `apps/api/src/throttle/index.ts` | **new** — the module's public surface |
| `apps/api/src/config/env.schema.ts` | seven variables |
| `apps/api/src/config/app.config.ts` | a `throttle` namespace; seconds converted to milliseconds here |
| `apps/api/src/app.module.ts` | import the module; register `ThrottlerGuard` after `SessionGuard` |
| `apps/api/src/main.ts` | `app.set('trust proxy', …)`; mount the middleware before the auth handler |
| `apps/api/src/health/health.controller.ts` | `@SkipThrottle()` |
| `.env.example` | the seven variables |
| `docs/API.md` | the limits, the 429 contract, and what the limit does and does not stop |

No schema change, so no migration.

## Out of scope

Applying the moderate policy to pack-open and trade routes, which do not exist — the named throttler is defined here and the decorator goes on with the route, recorded as a forward note on the tickets that build them. Idempotency keys for money operations, which PRD §17 lists beside rate limiting but which are a different mechanism and a different ticket. Per-account lockout after repeated failures, which is a product decision about locking people out of their own accounts, not a limiter setting. Any limiter tuned per user role.
