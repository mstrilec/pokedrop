# PD-52 On-Demand Price Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /cards/:id/price/refresh` — a signed-in caller asks for a fresher price, gets the current figure back immediately, and the actual provider call happens on the `price-sync` queue behind a per-card cooldown and a daily reserve.

**Architecture:** One new service in the existing `prices` module. It reads the current price through `PricesService.getLatest` (so the refresh response and the ordinary read cannot drift in shape, `Decimal` conversion or caching), takes a per-card cooldown with an atomic `SET NX EX`, checks the shared daily request counter, and enqueues `{ cardIds: [id] }` to `QUEUE.priceSync` — the queue PD-48 built a consumer for and which has never had a producer.

**Tech Stack:** NestJS 12 (ESM, `module: nodenext` — every relative import ends in `.js`), BullMQ 5.81.5 via `@nestjs/bullmq`, ioredis 5.8.2, Zod 4 via `@pokedrop/shared`, Redis 7.4 (db 0 cache/throttle, db 1 queues), PostgreSQL 17 on port 5433.

**Spec:** [`docs/superpowers/specs/2026-09-24-pd-52-on-demand-price-refresh-design.md`](../specs/2026-09-24-pd-52-on-demand-price-refresh-design.md)

## Global Constraints

- **Work directly on `dev`.** No feature branches, no pull requests.
- **Commit subjects are `[PD-52]: short lowercase description`**, no trailing period, **72 characters maximum**. Bodies end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **No automated tests in v1** (`docs/PRD.md` §20). **This overrides the TDD structure the writing-plans skill normally imposes.** Every verification step is a measurement against the running stack. Do not add test files, test runners, test dependencies, or a `test` step to CI.
- **ESM.** Relative imports inside `apps/api` carry the `.js` extension or the build fails.
- **Minimal comments.** Only load-bearing ones — the reason a line is the way it is, never a restatement of what it does. Rationale belongs in `docs/` and the module READMEs.
- **The route is NOT `@Public()`.** `PricesController` currently carries `@Public()` **at class level**, which would cover the new POST. Task 2 moves it onto the two `@Get` handlers. There is no "un-public" decorator — `SessionGuard` resolves `[handler, class]` and a class-level decorator wins for every handler that does not set its own.
- **The cooldown is `SET NX EX`, never read-then-write.** "Two concurrent requests enqueue one job" is the ticket's first acceptance criterion and the atomic form is what makes it an invariant instead of a probability.
- **A Redis failure taking the cooldown is a 503, not a free lock and not a fake cooldown.** `CacheService`'s failure-is-a-miss rule is for caches; this is a lock.
- **The budget counter is read through `RequestBudgetService`, never re-implemented.** All four consumers of the provider bid against one count.
- **Every commit compiles.** `pnpm typecheck`, `pnpm lint` and `pnpm format:check` pass from the repository root before each one.
- **Verified claims only.** If a measurement contradicts this plan or the spec, report the contradiction rather than editing the expectation to fit.

## Review Focus

Five input classes the spec implies but does not pin down. Each has a measurement in the task that owns the code.

1. **A card that exists but has never been priced** — 20 658 of the 20 670 cards in this database. This is the single most likely real request, and it is the one the spec never describes: `getLatest` returns `usd`, `eur` and `priceUpdatedAt` all null, and the refresh must still enqueue. Expected: `200`, three nulls, `queued: true`. *Task 2, Step 8.*
2. **The cooldown key expiring between the `SET` and the `TTL` read** — ioredis returns `-2` for a key that no longer exists and `-1` for one with no expiry. `PriceRefreshResultSchema` declares `retryAfterSeconds` non-negative, so a raw `-2` throws inside the response parse and a 200 becomes a 500. Expected: clamped to `0`. *Task 2, Step 6.*
3. **Card ids carrying `!` or `?`** — `ex10-!` and `ex10-?` are real ids in this catalog, recorded in `apps/api/src/sync/README.md`. PD-51 measured them on a `GET`; a `POST` reaches the same route parameter. `?` is the sharper of the two, since unencoded it is a query-string separator. Expected: both resolve and enqueue. *Task 2, Step 9.*
4. **The reserve boundary is strict.** `hasHeadroom` is `remaining > reserve`, not `>=`. At `used = limit - reserve` exactly, `remaining === reserve` and the request is **refused**. That is one request's difference between what `.env.example` says and what the code does, and nobody will notice it later. Expected: refused at exactly `950`, allowed at `949`. *Task 3, Step 5.*
5. **Redis unreachable** — the endpoint must answer `503`, not `500` and not a `200` claiming a cooldown, while `GET /cards/:id/price` beside it still answers `200` from the database. Note the envelope: `AllExceptionsFilter` replaces the message of any status `>= 500`, so the body reads `"message": "Internal server error"` with `"error": "Service Unavailable"`. That is the framework's shape, not a bug to chase. *Task 3, Step 7.*

---

## Measured before planning

Against the running stack, 2026-09-24, at `a693a78`. Re-measure if a step disagrees rather than editing the expectation.

| Probe | Result |
| --- | --- |
| cards total / with `latestPriceUsd` | **20 670** / **12** (`base1-15`, `base1-2`, `base1-4`, `base1-46`, `base1-58`, …), all stamped `2026-09-15 03:00:00` |
| cards with `latestPriceEur` | **0** |
| `throttle:price:*` keys in Redis db 0 | **none** |
| `budget:pokemontcg:2026-09-24` | unset |
| `bull:price-sync:id` (db 1) | **8** — a monotonic counter of jobs ever added |
| seeded users | `admin@pokedrop.test`, `ash@pokedrop.test`, … — **no credential accounts**, so sign up a fresh user rather than signing one of these in |
| `CORS_ORIGINS` | `http://localhost:3000` |
| route prefix | `/api/v1` — `GET /api/v1/cards/base1-4/price` answered `200` with `{"cardId":"base1-4","usd":312.45,"eur":null,"priceUpdatedAt":"2026-09-15T03:00:00.000Z"}` |

### The one measurement that changes how this plan is verified

**The API process consumes `price-sync`. `apps/api/src/queue/README.md` says it does not, and that sentence is wrong.**

`AppModule` has imported `SyncModule` since PD-39 (`bcd3964`), and `SyncModule` declares `PriceSyncProcessor`, `PriceSweepProcessor`, `PriceActiveProcessor` and `CatalogSyncProcessor`. `@nestjs/bullmq`'s explorer creates a worker for every `@Processor` class in the module graph, so the API is a worker for all four queues. The crons do not fire there — `ScheduleModule.forRoot()` is only in `WorkerModule` — but the consumers do run.

Measured: with **only** the API running and no worker process, a job added to `price-sync` moved from `waiting` to `completed` in under four seconds (`completed` 7 → 8, `waiting` 0 throughout).

Two consequences for this plan, and neither is a reason to change the design:

- **Do not verify "one job was enqueued" by looking at `waiting` or at `bull:price-sync:*` job hashes.** The job will already be gone. Use `GET bull:price-sync:id` in Redis db 1 — a monotonic counter incremented once per `add`, whose delta is exactly the number of jobs enqueued regardless of who consumed them.
- **A refresh triggered against a stack where the API is the only process running will make the provider call inside the API process**, spending real quota. Every measurement below that would reach the provider is bounded, and the two that enqueue against a real card are counted in the budget arithmetic in Task 2.

Correcting the README sentence is Task 4. Fixing the architecture is not in this ticket — it predates PD-52 by twelve tickets and affects all four queues.

---

## Where this plan differs from the spec

**The budget is checked before the cooldown is taken; the spec has it the other way round.**

The spec states two things that cannot both hold in its own ordering:

> The key is set only when a job is actually enqueued. A request refused for lack of budget does not start a cooldown […]
>
> […] the cooldown is taken first and its 503 ends the request before the budget is consulted.

Taking the cooldown first and *then* discovering there is no budget leaves a key that must be compensated with a `DEL`. That `DEL` can itself fail on the Redis blip that is the only reason to worry about ordering at all, and it would leave a ten-minute cooldown on a card nothing refreshed — a silent denial of the endpoint for that card.

Checking the budget first needs no compensation and produces the same observable behaviour in every case the spec enumerates, including the Redis-down one: `hasHeadroom` fails **open** by PD-49's design and never throws, so a dead Redis passes straight through it and the `SET NX EX` immediately afterwards is still what raises the 503. Verification point 8 of the spec is unaffected.

One combination the spec never enumerates does differ: a card that is both inside its cooldown and past the day's reserve. The spec's outcome table, read literally, would return the remaining cooldown for that case; this ordering returns seconds-to-midnight instead, because the budget check runs first and returns before the cooldown is ever read. The implementation's answer is the more useful of the two — the day's reserve is the longer wait and the one actually binding — so this is a difference worth keeping, not just tolerating.

Everything else follows the spec as written.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/shared/src/entities/price.ts` | **edit** — `PriceRefreshResultSchema`, the response contract |
| `apps/api/src/redis/cache.keys.ts` | **edit** — `throttleKeys.priceRefresh(cardId)` |
| `apps/api/src/config/env.schema.ts` | **edit** — `PRICE_REFRESH_COOLDOWN`, `PRICE_ONDEMAND_RESERVE` |
| `apps/api/src/config/app.config.ts` | **edit** — the `priceRefresh` block |
| `.env.example` | **edit** — both variables, documented |
| `apps/api/src/prices/price-refresh.service.ts` | **new** — the cooldown, the budget check, the enqueue |
| `apps/api/src/prices/prices.controller.ts` | **edit** — the `POST` route; `@Public()` moves to the two `@Get` handlers |
| `apps/api/src/prices/prices.module.ts` | **edit** — import `ProvidersModule` and `QueueModule`, register the service, **export `PricesService`** |
| `apps/api/src/prices/index.ts` | **edit** — export the new service |
| `docs/API.md` | **edit** — the endpoint and its three outcomes |
| `apps/api/src/sync/README.md` | **edit** — `price-sync` finally has a producer |
| `apps/api/src/queue/README.md` | **edit** — the producer/consumer table, and the false "the API is a producer only" |

No migration. Nothing here changes the schema.

### Task order

Task 1 → 2 → 3 → 4, strictly. Task 2 imports Task 1's schema, key and config; Task 3 adds a second layer to the service Task 2 writes; Task 4 documents what 1–3 measured.

---

## Shared shell setup

Every task's measurement steps assume this block has been run in the shell they are run from.

```bash
cd /m/projects/pokedrop
SCRATCH="$(mktemp -d)"
PSQL="docker compose exec -T postgres psql -U pokedrop -d pokedrop"
RCACHE="docker compose exec -T redis redis-cli -n 0"
RQUEUE="docker compose exec -T redis redis-cli -n 1"
API="http://localhost:4000/api/v1"
WEB="http://localhost:3000"
```

`docker compose ps` must show postgres and redis healthy.

**Start the API from `dist`, not from watch mode**, so a restart is a deliberate act and the log is a file you can grep:

```bash
pnpm --filter @pokedrop/api build
pkill -f 'node apps/api/dist/main.js'
node apps/api/dist/main.js > "$SCRATCH/api.log" 2>&1 &
sleep 8
curl -s -o /dev/null -w 'ready: %{http_code}\n' "$API/health/ready"
```

Expected: `ready: 200`.

**`pnpm build` deletes `apps/api/dist/`.** Anything written there for a probe goes after the build, not before.

### A session, and why the `Origin` header is not optional

`CsrfGuard` runs **before** `SessionGuard` and refuses any non-`GET`/`HEAD`/`OPTIONS` request that carries a session cookie without an `Origin` header listed in `CORS_ORIGINS`. Omit it and every measurement below returns `403 Cross-origin request rejected`, which looks nothing like the thing you are testing.

```bash
$PSQL -c "delete from users where email like 'pd52-%';"
curl -s -c "$SCRATCH/jar.txt" -X POST "http://localhost:4000/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd52-a@example.com","password":"correct-horse-battery","name":"PD52 A"}' > /dev/null
curl -s -b "$SCRATCH/jar.txt" "http://localhost:4000/api/auth/get-session" -H "Origin: $WEB" | head -c 60
```

Expected: a JSON object, not `null`.

From here on, an authenticated POST is:

```bash
curl -s -b "$SCRATCH/jar.txt" -X POST "$API/cards/base1-4/price/refresh" -H "Origin: $WEB"
```

### Counting enqueues

```bash
$RQUEUE get bull:price-sync:id
```

A monotonic counter, `8` before any of this work. **The delta across a measurement is the number of jobs enqueued**, and it is the only reliable instrument here because the API consumes the queue it produces to — see "Measured before planning".

---

## Task 1: The contract, the key and the configuration

Everything Task 2 needs to import, and nothing that behaves.

**Files:**
- Modify: `packages/shared/src/entities/price.ts`
- Modify: `apps/api/src/redis/cache.keys.ts`
- Modify: `apps/api/src/config/env.schema.ts`
- Modify: `apps/api/src/config/app.config.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `PriceRefreshResultSchema` / `PriceRefreshResult` from `@pokedrop/shared`; `throttleKeys.priceRefresh(cardId: string): string` from `../redis/index.js`; `config.priceRefresh.cooldownSeconds: number` and `config.priceRefresh.reserve: number` on `AppConfig`. Tasks 2 and 3 use all of them.

- [ ] **Step 1: Add the response contract**

Append to `packages/shared/src/entities/price.ts`, below `PriceHistoryQuerySchema`:

```ts
/**
 * What `POST /cards/:id/price/refresh` answers, always with 200.
 *
 * It extends CardPriceSchema rather than restating it because the endpoint
 * returns the card's current price through the same read `GET /cards/:id/price`
 * serves - the refresh is what happens beside the answer, not instead of it. A
 * separate shape here would be two contracts for one figure.
 *
 * `queued` and `retryAfterSeconds` together say which of three things happened:
 * a job was enqueued and the number is the cooldown just set; the card is inside
 * its cooldown and the number is what remains of it; or the day's reserve is
 * reached and the number is the seconds to 00:00 UTC, where the budget counter
 * resets. The third needs no separate flag - "try again in 7 hours" is the
 * literal truth, and a client rendering a countdown does not have to know which
 * of the two limits produced it.
 *
 * Non-negative, deliberately. A TTL read for a key that expired a millisecond
 * earlier comes back as -2, and a negative wait is not a thing a client can act
 * on; the service clamps it to zero before it reaches this schema.
 */
export const PriceRefreshResultSchema = CardPriceSchema.extend({
  queued: z.boolean(),
  retryAfterSeconds: z.number().int().nonnegative(),
});
export type PriceRefreshResult = z.infer<typeof PriceRefreshResultSchema>;
```

- [ ] **Step 2: Add the cooldown key**

In `apps/api/src/redis/cache.keys.ts`, add one entry to `throttleKeys`, after `resend`:

```ts
  priceRefresh: (cardId: string) => `${THROTTLE_NAMESPACE}:price:refresh:${cardId}`,
```

The namespace choice is already explained by the block comment above `throttleKeys` and needs no new comment: living outside `cache:` is what stops a routine cache flush handing every card in the catalog a fresh refresh window.

- [ ] **Step 3: Add the two settings to the environment schema**

In `apps/api/src/config/env.schema.ts`, immediately after `PRICE_ACTIVE_RESERVE`:

```ts
    PRICE_REFRESH_COOLDOWN: z.coerce.number().int().min(1).default(600),

    PRICE_ONDEMAND_RESERVE: z.coerce.number().int().min(0).default(50),
```

`min(1)` on the cooldown, not `min(0)`: a zero-second cooldown is a `SET NX EX 0`, which ioredis rejects outright, and there is no use for a cooldown that does not cool.

- [ ] **Step 4: Add the config block**

In `apps/api/src/config/app.config.ts`, after the `priceActive` block and before `queue`:

```ts
    priceRefresh: {
      // Shorter than PD-50's six-hour freshness window, or asking on demand
      // buys nothing the schedule was not about to do anyway; long enough that
      // reloading a card page does not spend the allowance twice. Chosen, not
      // measured.
      cooldownSeconds: env.PRICE_REFRESH_COOLDOWN,

      // Left unspent for the jobs that still have to run today. This is the
      // last consumer in the day and the only one behind it is the 23:00 active
      // refresh, which costs about 30 requests - so this reserve is the
      // smallest of the three for the same reason it is last.
      reserve: env.PRICE_ONDEMAND_RESERVE,
    },
```

- [ ] **Step 5: Document both in `.env.example`**

In `.env.example`, after `PRICE_ACTIVE_RESERVE=150` and before the `Queue` section:

```
# How long one card stays off limits after an on-demand refresh is enqueued for
# it, in seconds. Ten minutes: shorter than the six-hour window the active
# refresh already guarantees, so asking is worth something, and long enough that
# reloading a card page does not spend the allowance again.
PRICE_REFRESH_COOLDOWN=600

# Requests on-demand refreshes leave unspent for everything else. On-demand is
# the last consumer in the day, and the only job behind it is the 23:00 active
# refresh at roughly 30 requests - which is why this is the smallest of the
# three reserves.
PRICE_ONDEMAND_RESERVE=50
```

- [ ] **Step 6: Verify the key builder and the config**

```bash
pnpm typecheck && pnpm lint && pnpm format:check
pnpm --filter @pokedrop/api build
node -e "import('./apps/api/dist/redis/cache.keys.js').then(m => { console.log(m.throttleKeys.priceRefresh('base1-4')); console.log(m.throttleKeys.priceRefresh('ex10-?')); });"
```

Expected: `throttle:price:refresh:base1-4` then `throttle:price:refresh:ex10-?`. The second matters — the id is used raw, so a card id containing `:` would collide with the namespace separator, and none in this catalog do.

- [ ] **Step 7: Verify the API still boots with the new config**

```bash
pkill -f 'node apps/api/dist/main.js'
node apps/api/dist/main.js > "$SCRATCH/api.log" 2>&1 &
sleep 8
curl -s -o /dev/null -w 'ready: %{http_code}\n' "$API/health/ready"
grep -ci 'error' "$SCRATCH/api.log"
```

Expected: `ready: 200` and `0`.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/entities/price.ts apps/api/src/redis/cache.keys.ts apps/api/src/config/env.schema.ts apps/api/src/config/app.config.ts .env.example
git commit -m "$(cat <<'EOF'
[PD-52]: add the refresh contract, key and settings

The response shape extends CardPriceSchema because the endpoint answers with
the card's current price and two fields beside it, not with a different object.

PRICE_REFRESH_COOLDOWN is the per-card window and PRICE_ONDEMAND_RESERVE is the
third reserve against the shared daily request count, beside PRICE_SWEEP_RESERVE
and PRICE_ACTIVE_RESERVE.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: The refresh service, the route, and the cooldown

The endpoint in full, minus the daily reserve, which is Task 3.

**Files:**
- Create: `apps/api/src/prices/price-refresh.service.ts`
- Modify: `apps/api/src/prices/prices.controller.ts`
- Modify: `apps/api/src/prices/prices.module.ts`
- Modify: `apps/api/src/prices/index.ts`

**Interfaces:**
- Consumes: `PriceRefreshResultSchema` / `PriceRefreshResult` from `@pokedrop/shared`; `throttleKeys.priceRefresh` and `RedisService` from `../redis/index.js`; `config.priceRefresh.cooldownSeconds` from `APP_CONFIG`; `QUEUE` from `../queue/index.js`; `PriceSyncJob` (type only) from `../sync/index.js`; `PricesService` from `./prices.service.js`.
- Produces: `PriceRefreshService` with `refresh(cardId: string): Promise<PriceRefreshResult>`. Task 3 adds a second constructor parameter and one block to `refresh`.

### Budget arithmetic for this task

Six jobs reach the provider across this task: one each in Steps 5, 6 (the second half, after the key is expired by hand), 7 and 8, and two in Step 9. `PriceBatchService` asks once per batch and retries up to three times at this provider's ~30 % success rate, so budget **about 6 jobs × ~3 requests ≈ 18 requests** of today's 1 000. That is affordable, and it is the only spend in this task — the first half of Step 6 and the losing half of Step 7's race are refused by the cooldown and cost nothing.

- [ ] **Step 1: Write the service**

Create `apps/api/src/prices/price-refresh.service.ts`:

```ts
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  PriceRefreshResultSchema,
  type CardPrice,
  type PriceRefreshResult,
} from '@pokedrop/shared';
import type { Queue } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { QUEUE } from '../queue/index.js';
import { RedisService, throttleKeys } from '../redis/index.js';
import type { PriceSyncJob } from '../sync/index.js';
import { PricesService } from './prices.service.js';

/**
 * The first producer `price-sync` has ever had. PD-48 built the consumer and its
 * docblock has named this ticket since; PD-49 and PD-50 both declined to enqueue
 * here, each coordinating its own batches on its own queue, because a fan-out has
 * no good answer for which of many jobs closes a run. One card at a time has no
 * such question.
 */
@Injectable()
export class PriceRefreshService {
  private readonly logger = new Logger(PriceRefreshService.name);

  constructor(
    private readonly prices: PricesService,
    private readonly redis: RedisService,
    @InjectQueue(QUEUE.priceSync) private readonly queue: Queue<PriceSyncJob>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async refresh(cardId: string): Promise<PriceRefreshResult> {
    // First, and through PricesService rather than a query of its own: an id
    // that is not in the catalog must 404 before anything is spent or locked,
    // and reading the price the same way `GET /cards/:id/price` does is what
    // keeps the two responses from drifting apart in shape or conversion.
    const price = await this.prices.getLatest(cardId);

    const cooldown = this.config.priceRefresh.cooldownSeconds;
    const remaining = await this.takeCooldown(cardId, cooldown);

    if (remaining !== null) {
      return build(price, false, remaining);
    }

    const job = await this.queue.add('price-refresh', { cardIds: [cardId] });
    this.logger.log(`Enqueued a refresh of ${cardId} as job ${job.id}`);

    return build(price, true, cooldown);
  }

  /**
   * `SET NX EX` and, when it loses the race, the TTL of the key that won.
   *
   * Atomic on purpose. "Two requests inside the window enqueue one job" is this
   * ticket's first acceptance criterion, and a read-then-write sequence has a
   * gap between its two steps that both requests fit through - which would make
   * the criterion true most of the time rather than always.
   *
   * Returns null when the cooldown was taken, or the seconds remaining when it
   * was not.
   *
   * A Redis failure throws 503 rather than proceeding. This is a lock, and the
   * cache's failure-is-a-miss rule would let every request through at the moment
   * the system is least able to cope. Answering as though the cooldown were held
   * would be the other mistake: it would tell a caller their card was refreshed
   * recently when in fact nothing could be checked.
   */
  private async takeCooldown(cardId: string, ttlSeconds: number): Promise<number | null> {
    const key = throttleKeys.priceRefresh(cardId);

    try {
      const taken = await this.redis.client.set(key, '1', 'EX', ttlSeconds, 'NX');

      if (taken === 'OK') {
        return null;
      }

      // -2 for a key that expired between the two commands, -1 for one with no
      // expiry. Neither is a wait a client can act on, and the response schema
      // refuses a negative, so both become "ask again now" - which the next
      // request will win.
      const remaining = await this.redis.client.ttl(key);

      return remaining > 0 ? remaining : 0;
    } catch (error) {
      this.logger.warn(
        `Refresh cooldown unavailable for ${cardId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );

      throw new ServiceUnavailableException('Price refresh is unavailable');
    }
  }
}

function build(price: CardPrice, queued: boolean, retryAfterSeconds: number): PriceRefreshResult {
  return PriceRefreshResultSchema.parse({ ...price, queued, retryAfterSeconds });
}
```

- [ ] **Step 2: Add the route, and move `@Public()` off the class**

Replace `apps/api/src/prices/prices.controller.ts` in full:

```ts
import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CardPrice, PriceHistory, PriceRefreshResult } from '@pokedrop/shared';
import { Public } from '../common/decorators/public.decorator.js';
import { PriceRefreshService } from './price-refresh.service.js';
import { PriceHistoryQueryDto } from './prices.dto.js';
import { PricesService } from './prices.service.js';

/**
 * @Public() is on the two reads and not on the class, because the refresh is
 * not public and there is no decorator that undoes one. SessionGuard resolves
 * [handler, class] and a class-level @Public() would cover every handler under
 * it - so a route added later would be public by inheritance rather than by
 * decision, which is the opposite of the polarity PD-33 chose.
 */
@ApiTags('prices')
@Controller()
export class PricesController {
  constructor(
    private readonly prices: PricesService,
    private readonly refreshes: PriceRefreshService,
  ) {}

  @Public()
  @Get('cards/:id/price')
  getLatest(@Param('id') id: string): Promise<CardPrice> {
    return this.prices.getLatest(id);
  }

  @Public()
  @Get('cards/:id/price/history')
  getHistory(@Param('id') id: string, @Query() query: PriceHistoryQueryDto): Promise<PriceHistory> {
    return this.prices.getHistory(id, query.days);
  }

  /**
   * 200 rather than 202. A 202 describes a response about work that was queued;
   * this body is about the price, which is returned whether or not anything was
   * queued, and the two extra fields say what happened to the request beside it.
   * Splitting the code would make a client branch twice for one call - once on
   * the status and again on a body it has to read anyway.
   *
   * @HttpCode(HttpStatus.OK) because Nest answers 201 for a @Post by default,
   * which would say a resource was created - and none was.
   */
  @HttpCode(HttpStatus.OK)
  @Post('cards/:id/price/refresh')
  refresh(@Param('id') id: string): Promise<PriceRefreshResult> {
    return this.refreshes.refresh(id);
  }
}
```

- [ ] **Step 3: Wire the module**

Replace `apps/api/src/prices/prices.module.ts` in full:

```ts
import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/index.js';
import { PriceRefreshService } from './price-refresh.service.js';
import { PricesController } from './prices.controller.js';
import { PricesService } from './prices.service.js';

/**
 * QueueModule is imported for @InjectQueue, which resolves through the importing
 * module's own context - BullMQ's explorer discovers @Processor classes globally,
 * but a queue token does not travel that way.
 *
 * PrismaModule and RedisModule stay unnamed for the reason CatalogModule's empty
 * `imports` gives: both are @Global(), so their services inject without one.
 *
 * PricesService is exported here and was not before. PD-51 left the line out
 * deliberately rather than by oversight - an export with no consumer is a claim
 * about a boundary nobody has crossed. PriceRefreshService reads through it, and
 * although a provider in this same module needs no export to do that, the read
 * is now the module's answer to "what is this card worth" rather than one
 * controller's private helper.
 */
@Module({
  imports: [QueueModule],
  controllers: [PricesController],
  providers: [PricesService, PriceRefreshService],
  exports: [PricesService],
})
export class PricesModule {}
```

Note that `PriceRefreshService` and `PricesService` are in the same module, so the `exports` line is not what makes that injection work — it is the line the spec promised PD-51 would leave for this ticket, and it is what lets a later module reach the read. Keep it.

- [ ] **Step 4: Export the service**

Replace `apps/api/src/prices/index.ts`:

```ts
export { PriceRefreshService } from './price-refresh.service.js';
export { PricesModule } from './prices.module.js';
export { PricesService } from './prices.service.js';
```

- [ ] **Step 5: Build, restart, and measure the happy path**

```bash
pnpm typecheck && pnpm lint && pnpm format:check
pnpm --filter @pokedrop/api build
pkill -f 'node apps/api/dist/main.js'
node apps/api/dist/main.js > "$SCRATCH/api.log" 2>&1 &
sleep 8

$RCACHE del throttle:price:refresh:base1-4
BEFORE=$($RQUEUE get bull:price-sync:id)
curl -s -b "$SCRATCH/jar.txt" -X POST "$API/cards/base1-4/price/refresh" \
  -H "Origin: $WEB" -w '\nstatus %{http_code} in %{time_total}s\n'
AFTER=$($RQUEUE get bull:price-sync:id)
echo "jobs enqueued: $((AFTER - BEFORE))"
$RCACHE ttl throttle:price:refresh:base1-4
```

Expected: status `200`; a body carrying `"usd":312.45`, `"queued":true` and `"retryAfterSeconds":600`; `jobs enqueued: 1`; a TTL near `600`. **`time_total` well under one second** — that is the claim that the caller is not waiting on the provider, and a provider round trip here takes seconds.

Record the `time_total`.

- [ ] **Step 6: Measure the same card again, inside the window**

```bash
curl -s -b "$SCRATCH/jar.txt" -X POST "$API/cards/base1-4/price/refresh" \
  -H "Origin: $WEB" -w '\nstatus %{http_code}\n'
AFTER2=$($RQUEUE get bull:price-sync:id)
echo "jobs enqueued since step 5: $((AFTER2 - AFTER))"
```

Expected: `200`, `"queued":false`, a `retryAfterSeconds` **below 600 and above 0**, and `jobs enqueued since step 5: 0`.

Then prove the clamp in *Review Focus 2* — the `-2` case — by racing the TTL read against an expiry directly:

```bash
$RCACHE set throttle:price:refresh:base1-4 1 EX 1
sleep 2
curl -s -b "$SCRATCH/jar.txt" -X POST "$API/cards/base1-4/price/refresh" -H "Origin: $WEB"
echo
```

Expected: `200` with `"queued":true` — the key had expired, so the `SET NX` won outright. The clamp itself is unreachable from outside by construction; confirm by reading the code that `remaining > 0 ? remaining : 0` is what guards `PriceRefreshResultSchema`'s `nonnegative()`, and record that as read rather than as measured. **Do not add a test.**

- [ ] **Step 7: Measure the race — two concurrent requests, one job**

This is the ticket's first acceptance criterion and **the only step that must be concurrent to mean anything**. Sequential requests would pass a check-then-set implementation too.

```bash
$RCACHE del throttle:price:refresh:base1-2
BEFORE=$($RQUEUE get bull:price-sync:id)
curl -s -b "$SCRATCH/jar.txt" -X POST "$API/cards/base1-2/price/refresh" -H "Origin: $WEB" -o "$SCRATCH/r1.json" &
curl -s -b "$SCRATCH/jar.txt" -X POST "$API/cards/base1-2/price/refresh" -H "Origin: $WEB" -o "$SCRATCH/r2.json" &
wait
AFTER=$($RQUEUE get bull:price-sync:id)
echo "jobs enqueued: $((AFTER - BEFORE))"
cat "$SCRATCH/r1.json"; echo
cat "$SCRATCH/r2.json"; echo
```

Expected: `jobs enqueued: 1`. Exactly one response carries `"queued":true`, the other `"queued":false` with a `retryAfterSeconds` at or just under 600.

If both say `true`, the implementation is not atomic — stop and fix it rather than re-running until it passes.

- [ ] **Step 8: Measure a card that exists but was never priced (Review Focus 1)**

`base1-1` is in the catalog and has no price — this is the shape 20 658 of 20 670 cards return.

```bash
$PSQL -c "select id, \"latestPriceUsd\", \"priceUpdatedAt\" from cards where id = 'base1-1';"
$RCACHE del throttle:price:refresh:base1-1 cache:price:card:base1-1
curl -s -b "$SCRATCH/jar.txt" -X POST "$API/cards/base1-1/price/refresh" -H "Origin: $WEB"
echo
```

Expected: `200` with `"usd":null,"eur":null,"priceUpdatedAt":null,"queued":true,"retryAfterSeconds":600`. Three nulls **and** a queued refresh — a card with no price is the case the endpoint exists for, not an error.

- [ ] **Step 9: Measure the awkward ids (Review Focus 3) and the 404**

```bash
$RCACHE del 'throttle:price:refresh:ex10-!' 'throttle:price:refresh:ex10-?'
curl -s -b "$SCRATCH/jar.txt" -X POST "$API/cards/ex10-%21/price/refresh" -H "Origin: $WEB" -w ' <- %{http_code}\n'
curl -s -b "$SCRATCH/jar.txt" -X POST "$API/cards/ex10-%3F/price/refresh" -H "Origin: $WEB" -w ' <- %{http_code}\n'
curl -s -b "$SCRATCH/jar.txt" -X POST "$API/cards/no-such-card/price/refresh" -H "Origin: $WEB" -w ' <- %{http_code}\n'
$RCACHE keys 'throttle:price:refresh:no-such-card'
```

Expected: `200` for both real ids with `"queued":true`; `404` with the standard envelope for the third; and **no key** for the unknown card — nothing was locked because nothing was enqueued.

- [ ] **Step 10: Measure that a session is required, and that CSRF still applies**

```bash
curl -s -o /dev/null -w 'no session: %{http_code}\n' -X POST "$API/cards/base1-4/price/refresh"
curl -s -o /dev/null -w 'session, no Origin: %{http_code}\n' -b "$SCRATCH/jar.txt" -X POST "$API/cards/base1-4/price/refresh"
curl -s -o /dev/null -w 'GET price, no session: %{http_code}\n' "$API/cards/base1-4/price"
curl -s -o /dev/null -w 'GET history, no session: %{http_code}\n' "$API/cards/base1-4/price/history"
```

Expected: `401`, then `403`, then `200`, then `200`. The last two are the regression check on moving `@Public()` off the class — the two reads must stay public.

- [ ] **Step 11: Measure that the job actually refreshed a card**

```bash
$PSQL -c "select id, \"latestPriceUsd\", \"priceUpdatedAt\" from cards where id in ('base1-4','base1-2','base1-1') order by id;"
$RCACHE keys 'cache:price:card:*'
grep -i 'price-sync\|PriceSyncProcessor\|PriceRefreshService' "$SCRATCH/api.log" | tail -10
$RQUEUE zcard bull:price-sync:completed
$RQUEUE zcard bull:price-sync:failed
```

Expected: `priceUpdatedAt` has moved to today for at least the cards the provider answered for; the log carries a `PriceSyncProcessor` line per job reporting asked/priced counts; `cache:price:card:*` holds no key for a card that was just written, because `PriceBatchService` deletes both keys after the commit.

**A `failed` count above zero is not automatically a defect** — this provider answers roughly 30 % of requests and the job has three attempts. Read the failure reason from the log before concluding anything. Report what you actually saw.

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/prices/
git commit -m "$(cat <<'EOF'
[PD-52]: add the on-demand refresh route and cooldown

POST /cards/:id/price/refresh answers 200 with the card's current price plus
what happened to the request. The per-card cooldown is taken with SET NX EX, so
"two concurrent requests enqueue one job" is an invariant rather than a
probability - a read-then-write sequence has a gap both requests fit through.

@Public() moves from the class onto the two reads. There is no decorator that
undoes a class-level one, and a route inheriting public access is the opposite
of the polarity PD-33 chose.

price-sync gets its first producer since PD-48 built its consumer.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: The daily reserve

The second layer, against a different thing: the cooldown stops duplicate work on one card, this stops on-demand traffic starving the scheduled jobs. A per-card cooldown does nothing about the quota, because there are 20 670 cards to spread across.

**Files:**
- Modify: `apps/api/src/prices/price-refresh.service.ts`
- Modify: `apps/api/src/prices/prices.module.ts`

**Interfaces:**
- Consumes: `RequestBudgetService` and `ProvidersModule` from `../sync/providers/index.js`; `config.priceRefresh.reserve` and `config.providers.active` from `APP_CONFIG`.
- Produces: no new exported names. `refresh` gains one outcome.

### Why `PricesModule` may import `ProvidersModule`

`AdminSyncService` reads breaker state straight from Redis with an explicit docblock saying that injecting `ProviderBreakerService` "would mean this module importing ProvidersModule, putting the sync layer's tokens into the API process's context". That precedent does not apply here, for two reasons worth stating because they look like a contradiction:

- **The tokens are already there.** `AppModule` imports `SyncModule`, which imports and re-exports `ProvidersModule`. Nest caches modules, so importing it into `PricesModule` creates **no new instance** of anything — the same `RequestBudgetService`, the same two provider clients. Confirm this in the boot log: `ProvidersModule dependencies initialized` appears exactly once.
- **The duplication is worse here than there.** Re-reading the budget key by hand would be a fourth place that has to agree about the key format, the UTC day boundary, the per-provider limit lookup and the fail-open rule. The breaker's duplication is two lines and was accepted as a cost; this one is a service. And the spec's whole argument is that all four consumers bid against **one honest count**.

Import `RequestBudgetService` from `'../sync/providers/index.js'` — the sealed folder's barrel. Importing the file directly is refused by ESLint.

- [ ] **Step 1: Import `ProvidersModule` into `PricesModule`**

Nest resolves a dependency through the importing module's own context, so the injection in Step 2 fails at boot without this. In `apps/api/src/prices/prices.module.ts`, add the import and extend the `imports` array:

```ts
import { ProvidersModule } from '../sync/providers/index.js';
```

```ts
  imports: [ProvidersModule, QueueModule],
```

Add one line to the module's docblock, above the `QueueModule` sentence:

```
 * ProvidersModule is imported for RequestBudgetService, and it adds no instance
 * to this process - SyncModule already puts that module in AppModule's graph, and
 * Nest caches modules. AdminSyncService reads breaker state straight from Redis
 * to avoid this import; the duplication that buys is two lines, where duplicating
 * the budget read would be a whole service and a fourth place that has to agree
 * about the UTC day boundary and the fail-open rule.
```

- [ ] **Step 2: Inject the budget service and add the reserve check**

In `apps/api/src/prices/price-refresh.service.ts`, add to the imports:

```ts
import { RequestBudgetService } from '../sync/providers/index.js';
```

Add a constructor parameter, after `prices` and before `redis`:

```ts
    private readonly budget: RequestBudgetService,
```

Insert this block in `refresh`, between the `getLatest` call and the `const cooldown = …` line:

```ts
    // Before the cooldown, not after it. Taking the lock first and then finding
    // there is no budget would leave a key that has to be compensated with a
    // DEL - and that DEL can fail on exactly the Redis blip worth worrying
    // about, leaving a ten-minute cooldown on a card nothing refreshed.
    //
    // Checked against the configured provider rather than the one the job will
    // actually select. The selector runs when the job does and may fall back to
    // TCGdex, which has no ceiling at all; refusing on the primary's exhausted
    // budget is the conservative direction, and a producer has no stable answer
    // to a choice made later.
    const headroom = await this.budget.hasHeadroom(
      this.config.providers.active,
      this.config.priceRefresh.reserve,
    );

    if (!headroom) {
      return build(price, false, secondsUntilUtcMidnight(new Date()));
    }
```

- [ ] **Step 3: Add the countdown to midnight**

Append, beside `build` at the bottom of the file:

```ts
/**
 * UTC, because the budget counter is keyed on the UTC day and resets there -
 * `budget:{provider}:{YYYY-MM-DD}`. "Come back after midnight" is then the
 * literal truth rather than an approximation, and a client rendering a
 * countdown against a cooldown renders one against an exhausted day without
 * knowing the difference.
 *
 * Date.UTC with the day incremented handles the month and year rollover; adding
 * 86 400 000 milliseconds to a floored timestamp would too, but this says what
 * it means.
 */
function secondsUntilUtcMidnight(at: Date): number {
  const nextMidnight = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1);

  return Math.ceil((nextMidnight - at.getTime()) / 1000);
}
```

- [ ] **Step 4: Build, restart, and confirm nothing regressed**

```bash
pnpm typecheck && pnpm lint && pnpm format:check
pnpm --filter @pokedrop/api build
pkill -f 'node apps/api/dist/main.js'
node apps/api/dist/main.js > "$SCRATCH/api.log" 2>&1 &
sleep 8
grep -c 'ProvidersModule dependencies initialized' "$SCRATCH/api.log"
```

Expected: `1`. More than one would mean a second instance of the provider clients and the budget service, which is the thing `AdminSyncService`'s docblock warns about — stop and report it.

- [ ] **Step 5: Measure the reserve boundary (Review Focus 4)**

`POKEMONTCG_DAILY_REQUEST_BUDGET` is 1 000 and `PRICE_ONDEMAND_RESERVE` is 50, so `hasHeadroom` is `1000 - used > 50`. The boundary is therefore `used = 949` allowed, `used = 950` refused — strict, not inclusive.

```bash
DAY=$(date -u +%F)
REAL_SPEND=$($RCACHE get "budget:pokemontcg:$DAY")
echo "real spend before this step: ${REAL_SPEND:-unset}"
$RCACHE del "throttle:price:refresh:base1-46"

$RCACHE set "budget:pokemontcg:$DAY" 949
curl -s -b "$SCRATCH/jar.txt" -X POST "$API/cards/base1-46/price/refresh" -H "Origin: $WEB"
echo " <- at 949"

$RCACHE del "throttle:price:refresh:base1-46"
$RCACHE set "budget:pokemontcg:$DAY" 950
curl -s -b "$SCRATCH/jar.txt" -X POST "$API/cards/base1-46/price/refresh" -H "Origin: $WEB"
echo " <- at 950"
$RCACHE keys 'throttle:price:refresh:base1-46'
```

Expected: at 949, `"queued":true` with `retryAfterSeconds` 600. At 950, `"queued":false` with a `retryAfterSeconds` in the **thousands or tens of thousands** — the seconds to 00:00 UTC — and **no cooldown key**, because nothing was spent and nothing is in flight.

Sanity-check the countdown against the clock:

```bash
date -u
```

The number must be roughly `86400 - (seconds since UTC midnight)`. A number near 600 means the cooldown branch answered instead of the reserve branch.

- [ ] **Step 6: Restore the counter**

```bash
$RCACHE set "budget:pokemontcg:$DAY" "${REAL_SPEND:-0}" EX 172800
$RCACHE get "budget:pokemontcg:$DAY"
$RCACHE del "throttle:price:refresh:base1-46"
```

**Restore, do not delete.** The hand-set 950 must not be left where tonight's sweep will read it — but deleting the key would understate the real spend instead, and this plan's own measurements have already put roughly twenty requests on it. Put back the value Step 5 recorded, with the same two-day TTL `RequestBudgetService` uses, and confirm what the key holds afterwards.

- [ ] **Step 7: Measure Redis unreachable (Review Focus 5)**

```bash
docker compose stop redis
sleep 2
curl -s -b "$SCRATCH/jar.txt" -X POST "$API/cards/base1-4/price/refresh" \
  -H "Origin: $WEB" -w '\nrefresh: %{http_code}\n'
curl -s -o /dev/null -w 'GET price: %{http_code} in %{time_total}s\n' "$API/cards/base1-4/price"
docker compose start redis
sleep 6
curl -s -o /dev/null -w 'ready again: %{http_code}\n' "$API/health/ready"
```

Expected:

- `refresh: 503`, **not** 500 and **not** a 200 claiming a cooldown.
- The body is the standard envelope, and its `message` reads `"Internal server error"` with `"error": "Service Unavailable"`. `AllExceptionsFilter` replaces the message of any status at or above 500 — the service's own string never reaches the client. That is the framework's shape; do not "fix" it here.
- `GET price: 200`, in the tens of milliseconds. PD-51 measured 68 ms in this state. The read degrades to the database; the refresh cannot, because it is a lock.
- `ready again: 200`.

Note that `hasHeadroom` was consulted first and returned `true` by failing open, exactly as PD-49 designed it — so the 503 came from the `SET NX EX`, which is the intended source.

- [ ] **Step 8: Measure a short cooldown expiring**

```bash
pkill -f 'node apps/api/dist/main.js'
PRICE_REFRESH_COOLDOWN=20 node apps/api/dist/main.js > "$SCRATCH/api-short.log" 2>&1 &
sleep 8

$RCACHE del throttle:price:refresh:base1-58
BEFORE=$($RQUEUE get bull:price-sync:id)
curl -s -b "$SCRATCH/jar.txt" -X POST "$API/cards/base1-58/price/refresh" -H "Origin: $WEB"; echo ' <- first'
curl -s -b "$SCRATCH/jar.txt" -X POST "$API/cards/base1-58/price/refresh" -H "Origin: $WEB"; echo ' <- second, inside'
sleep 22
curl -s -b "$SCRATCH/jar.txt" -X POST "$API/cards/base1-58/price/refresh" -H "Origin: $WEB"; echo ' <- third, after'
AFTER=$($RQUEUE get bull:price-sync:id)
echo "jobs enqueued: $((AFTER - BEFORE))"

pkill -f 'node apps/api/dist/main.js'
node apps/api/dist/main.js > "$SCRATCH/api.log" 2>&1 &
sleep 8
```

Expected: first `"queued":true,"retryAfterSeconds":20`; second `"queued":false` with a remainder under 20; third `"queued":true` again; `jobs enqueued: 2`. This also proves the setting is read from configuration rather than hard-coded.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/prices/price-refresh.service.ts apps/api/src/prices/prices.module.ts
git commit -m "$(cat <<'EOF'
[PD-52]: bound on-demand refreshes by the daily reserve

The cooldown stops duplicate work on one card; it does nothing about the quota,
because there are 20 670 cards to spread across. The reserve is what stops
on-demand traffic starving the scheduled jobs, through the same counter PD-49
built and PD-50 already shares.

Checked before the cooldown is taken, so a refusal leaves no key behind that a
compensating DEL would have to remove - and that DEL could fail on exactly the
Redis blip worth worrying about.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: The documentation

What Tasks 1–3 measured, written where the next person will look for it.

**Files:**
- Modify: `docs/API.md`
- Modify: `apps/api/src/sync/README.md`
- Modify: `apps/api/src/queue/README.md`

**Interfaces:**
- Consumes: the recorded numbers from Tasks 2 and 3 — the `time_total` from Task 2 Step 5, the job-count deltas, the reserve boundary from Task 3 Step 5, and the two status codes from Step 7.
- Produces: nothing importable.

- [ ] **Step 1: Add the endpoint to `docs/API.md`**

In the `## Prices` table, add a third row after the two `GET` rows:

```
| POST | `/cards/:id/price/refresh` | member | Enqueue a refresh behind a per-card cooldown and a daily reserve. Always 200 |
```

Then add this below the `GET /cards/:id/price/history` section, before `## Admin / Sync`:

````markdown
**`POST /cards/:id/price/refresh`**

```json
{
  "cardId": "base1-4",
  "usd": 312.45,
  "eur": null,
  "priceUpdatedAt": "2026-09-15T03:00:00.000Z",
  "queued": true,
  "retryAfterSeconds": 600
}
```

**Always 200, and always the card's current price.** A 202 describes a response
about work that was queued; this body is about the price, which is returned
whether or not anything was queued. Splitting the status code would make a client
branch twice for one call — once on the code and again on a body it has to read
anyway.

`queued` and `retryAfterSeconds` together say which of three things happened:

| Outcome | `queued` | `retryAfterSeconds` |
|---|---|---|
| a job was enqueued | `true` | the cooldown just set, 600 by default |
| the card is inside its cooldown | `false` | what remains of it |
| the day's reserve is reached | `false` | seconds until 00:00 UTC |

The third needs no separate flag. The request counter is keyed on the UTC day and
resets there, so a client rendering "try again in 4 minutes" against a cooldown
renders "try again in 7 hours" against an exhausted day without knowing which
limit produced it.

**Two concurrent requests for the same card enqueue exactly one job.** The
cooldown is taken with an atomic `SET NX EX` on `throttle:price:refresh:{cardId}`,
so the guarantee is an invariant rather than a probability — a read-then-write
sequence has a gap between its two steps that both requests fit through.
Measured: two `curl` calls raced against `base1-2` produced one increment of
BullMQ's job counter, one `queued: true` and one `queued: false`.

**A 404 means the card does not exist, and leaves no cooldown behind.** The
existence check runs first, through the same read `GET /cards/:id/price` serves.
A card that exists but was never priced is a 200 with `usd`, `eur` and
`priceUpdatedAt` all null **and** `queued: true` — that card is precisely what
the endpoint is for.

**The response can be up to an hour stale, by design.** It is the cached read,
and the refresh it triggers has not happened yet. `priceUpdatedAt` is what a
client watches to see the new figure arrive; `PriceBatchService` deletes
`cache:price:card:{id}` after the write, so the next read is fresh.

**Redis unreachable answers 503.** The cooldown is a lock, not a cache: a failure
to take it must not be read as "the lock is free", and refusing *as though the
cooldown were held* would tell a caller their card was refreshed recently when in
fact nothing could be checked. `GET /cards/:id/price` beside it still answers 200
from the database — measured at 68 ms in that state by PD-51 — so a client that
wants the figure has somewhere to get it. Note the envelope: `AllExceptionsFilter`
replaces the message of any status at or above 500, so the body reads
`"error": "Service Unavailable"` with `"message": "Internal server error"`.

**Authentication is required and no per-route rate limit is added.** The `default`
throttler tier — 100 requests a minute per caller — already applies and already
bounds a single caller. The `THROTTLE_MODERATE_*` values in configuration are
registered under no tier, and `@nestjs/throttler` 6.7.0 applies every registered
tier to every route, so registering one would tighten the whole service from 100
to 30 a minute to bound one endpoint. The daily reserve is what protects the
quota, and it does so however many callers there are.
````

Replace the numbers in the example body and the measured claims with what you actually recorded in Tasks 2 and 3.

- [ ] **Step 2: Update `apps/api/src/sync/README.md`**

Two edits.

First, in "The price write path", replace the sentence beginning "It is handed card ids and does not choose them — PD-52 will enqueue a single card at a time" with the present tense and the producer's name:

```markdown
`price-sync.processor.ts` on `QUEUE.priceSync`. It is handed card ids and does
not choose them: `PriceRefreshService` (PD-52) enqueues one card at a time from
`POST /cards/:id/price/refresh`. One producer, one consumer.
```

Second, in the paragraph beginning "**PD-51 is `cache:price:card:{id}`'s first reader.**", replace the sentence "The third has never run at all — `price-sync` is registered and consumed, but nothing enqueues to it, since PD-52, its producer, is not built." with what is now true:

```markdown
The third ran for the first time in PD-52, which gave `price-sync` the producer
its docblock had named since PD-48 — every measurement recorded against that
processor before then came from a probe enqueuing by hand.
```

Then add a short section after "The active refresh", recording this ticket:

```markdown
## The on-demand refresh

`POST /cards/:id/price/refresh`, in `apps/api/src/prices/price-refresh.service.ts` —
outside this folder, because it is a producer and the endpoint that owns it lives
in `prices/`.

Two layers, each against a different thing. The per-card cooldown
(`throttle:price:refresh:{cardId}`, 600 s) stops duplicate work on one card; the
daily reserve (`PRICE_ONDEMAND_RESERVE`, 50) stops on-demand traffic starving the
scheduled jobs. The cooldown does nothing for the quota on its own — there are
20 670 cards to spread a day's allowance across.

The reserve is the third against the shared counter, beside `PRICE_SWEEP_RESERVE`
(300) and `PRICE_ACTIVE_RESERVE` (150). It is the smallest because on-demand is
the last consumer in the day and the only job behind it is the 23:00 active
refresh, at roughly 30 requests. `hasHeadroom` is strict — `remaining > reserve` —
so with a 1 000 budget the boundary is 949 allowed and 950 refused.

**M4's budget, whole:** catalog sync ~250, nightly sweep ~250, active refresh
~120, on-demand bounded by its reserve. Roughly 620 of 1 000 committed, against a
provider that is deprecated and stops serving keys on 2027-03-01. The next ticket
that wants a scheduled provider call has to take it from one of these four, and
`RequestBudgetService` is where it will find that out.
```

- [ ] **Step 3: Correct `apps/api/src/queue/README.md`**

The `price-sync` row of the queue table is already right (`Filled by PD-52`, `Consumed by PD-48`) — leave it.

The sentence under "The split, in one sentence" is **wrong** and this ticket is what made it matter. Replace:

```markdown
`BullModule.registerQueue` creates **producers**; a `@Processor` class creates a
**worker**. Both entrypoints import this module, and the API is a producer only
because it declares no processor. Nothing else distinguishes them.
```

with:

```markdown
`BullModule.registerQueue` creates **producers**; a `@Processor` class creates a
**worker**. Both entrypoints import this module, so what distinguishes them is
only which processors are in their module graph.

**The API is not a producer only, and this README claimed it was until PD-52.**
`AppModule` has imported `SyncModule` since PD-39 (`bcd3964`), and `SyncModule`
declares all four price and catalog processors — so the API process is a worker
for every queue as well as a producer to them. Measured in PD-52: with only the
API running and no worker process, a job added to `price-sync` completed in under
four seconds.

The schedulers are the part that really is split. `ScheduleModule.forRoot()` is
in `WorkerModule` alone, so the crons fire in one process, which is what stops a
nightly sweep being enqueued twice.

A consequence worth knowing before you measure anything on these queues: **a job
you enqueue against a running API will usually be consumed before you can see it
waiting.** Count `GET bull:{queue}:id` in Redis db 1 — a monotonic counter
incremented once per `add` — rather than reading the `waiting` list.
```

- [ ] **Step 4: Verify the docs against the code one last time**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
grep -n 'price/refresh' docs/API.md | head
grep -n 'PRICE_REFRESH_COOLDOWN\|PRICE_ONDEMAND_RESERVE' .env.example apps/api/src/config/env.schema.ts apps/api/src/config/app.config.ts
```

Every number written in Step 1 and Step 2 must be one you recorded, not one copied from this plan. If a measurement disagreed with the plan, the document records what you measured and says so.

- [ ] **Step 5: Commit**

```bash
git add docs/API.md apps/api/src/sync/README.md apps/api/src/queue/README.md
git commit -m "$(cat <<'EOF'
[PD-52]: document the refresh endpoint and correct the queue split

The queue README claimed the API is a producer only. It is not: AppModule has
imported SyncModule since PD-39, so every processor runs in both processes.
Measured with the worker stopped - a price-sync job completed anyway. Only the
schedulers are actually split, by ScheduleModule.forRoot() living in
WorkerModule alone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## When the plan is done

M4 closes here. Before marking PD-52 Done, confirm against the ticket's own acceptance criteria:

1. **Two refresh requests for the same card inside the cooldown enqueue only one job** — Task 2, Step 7, run concurrently.
2. **The window is configurable** — Task 3, Step 8, with `PRICE_REFRESH_COOLDOWN=20`.
3. **The caller is answered immediately rather than waiting on the provider** — Task 2, Step 5, the recorded `time_total`.

Two things this ticket surfaced and deliberately did not fix, each worth its own ticket:

- **The API process consumes every queue.** Predates PD-52 by twelve tickets, affects all four queues, and means a provider HTTP call can run on the API's event loop. Task 4 documents it; fixing it means a module split in `AppModule`.
- **`THROTTLE_MODERATE_LIMIT` and `_WINDOW` are registered under no tier.** Unused configuration that reads like a feature. Either register a tier deliberately — which retunes every route — or delete the values.
