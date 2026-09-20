# PD-43 Provider Failover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A circuit breaker that moves the catalog sync onto the fallback provider when the primary stops serving, retries the primary when a cooldown expires, and cannot fork the catalog while doing it.

**Architecture:** Breaker state lives in Redis under its own `breaker:` namespace, read through `RedisService` and deliberately **not** through `CacheService`. A `ProviderSelectorService` inside the sealed provider folder answers "which provider should this run use", and the processor asks it **once per run** rather than per page. Two provider-agnostic rules make failover safe: a fallback run never writes a set, and never writes a card whose `setId` is not already mirrored. A small read-only `AdminModule` exposes what happened.

**Tech Stack:** NestJS 12 (ESM, `module: nodenext` — every relative import ends in `.js`), ioredis 5.8.2, Prisma 7.10.0, Zod 4 through the local `createZodDto`, BullMQ 5.81.5.

**Spec:** [`docs/superpowers/specs/2026-09-19-pd-40-pd-43-provider-fallback-and-failover-design.md`](../specs/2026-09-19-pd-40-pd-43-provider-fallback-and-failover-design.md)

**Predecessor:** PD-40 (`c1c42c7..a709a80`) built `TcgdexClient` and registered it. This plan assumes both providers resolve from `CARD_SOURCE_REGISTRY`.

## Global Constraints

- **Work directly on `dev`.** No feature branches, no pull requests.
- **Commit subjects are `[PD-43]: short lowercase description`**, no trailing period, **72 characters maximum**. Bodies end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. commitlint rejects two ticket tags in one subject and warns on a body line that starts a word then a colon. **This trailer is the repository's attribution on every commit regardless of which model does the work.**
- **No automated tests in v1** (`docs/PRD.md` §20). **This overrides the TDD structure the writing-plans skill normally imposes.** Every red/green cycle is a measurement against the running stack.
- **The breaker never goes through `CacheService`.** That service turns a Redis failure into `null` and carries on, which is right for a cache and catastrophic for a breaker — the counter would silently reset during exactly the incident that causes one. Use `RedisService.client` directly, as `lockKeys` in `cache.keys.ts` already instructs.
- **A 429 never counts toward the breaker.** Only `ProviderUnavailableError` and `ProviderContractError` do. Counting a rate limit moves load onto the fallback and rate-limits that one too. This rule is already written in `apps/api/src/sync/README.md` and in the comment atop `pokemon-tcg/http.ts`.
- **The selector is asked once per run, never per page.** A mid-run switch puts two id vocabularies inside one `SyncRun`, which is the fork this entire design exists to prevent. The spec's "This deviates from the ticket, deliberately" section is the argument; do not re-litigate it in code.
- **A fallback run always closes `PARTIAL`**, with its reason in `SyncRun.error`. 73.6% coverage is a partial run by definition.
- **ESM.** Relative imports inside `apps/api` carry the `.js` extension or the build fails.
- **Every commit compiles.** `pnpm typecheck`, `pnpm lint` and `pnpm format:check` pass from the repository root before each one.
- **Verified claims only.** If a measurement contradicts the spec, report the contradiction rather than adjusting the claim to fit.

### Shared shell setup

```bash
cd /m/projects/pokedrop
PSQL="docker compose exec -T postgres psql -U pokedrop -d pokedrop"
REDIS="docker compose exec -T redis redis-cli -n 0"
API="http://localhost:4000/api/v1"
```

`docker compose ps` must show postgres and redis healthy, and `$PSQL -tAc "SELECT count(*) FROM cards"` must return **20670**. If it returns anything else, the mirror is not in the state these measurements assume.

### Four traps that have already cost time on this project

**A probe that imports project code must live inside `apps/api`.** Node resolves bare imports relative to the file, and pnpm keeps packages under `apps/api/node_modules`. `apps/api/dist/` is gitignored and is the right home.

**A probe importing `dist/` needs `pnpm build` first**, or it silently runs the previous version of the code you are measuring.

**Do not background the API with `(node dist/main &)`.** It detaches, writes no readable log, and survives the shell — the next start then fails `EADDRINUSE` on port 4000 and the error looks like a code fault. Use the Bash tool's `run_in_background`.

**A worker process that has consumed a job will not exit promptly.** `app.close()` drains the job in flight. That is PD-41's graceful shutdown working, not a hang.

### Live values these steps assert against

- the mirror holds **20 670** cards across **176** sets, under pokemontcg.io's id scheme
- TCGdex publishes **220** sets; **50** of the mirror's 176 have no TCGdex id, and **94** TCGdex sets are absent from the mirror
- **15 222** mirror cards (73.6%) sit in sets TCGdex shares by id; **5 448** (26.4%) do not
- `http://127.0.0.1:9` refuses connections immediately and is the cheap way to simulate an outage — an unroutable host would instead burn the full 20-second timeout on every one of five attempts

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/api/src/redis/cache.keys.ts` | **modified** — `BREAKER_NAMESPACE` and `breakerKeys`, outside the cache namespace |
| `apps/api/src/redis/index.ts` | **modified** — export both |
| `apps/api/src/config/env.schema.ts` | **modified** — `CARD_SOURCE_NAMES`, so one list drives the enum and the admin read |
| `apps/api/src/sync/providers/provider-breaker.service.ts` | the counter, the cooldown, and the state read |
| `apps/api/src/sync/providers/provider-selector.service.ts` | which provider a run uses, and whether it is a fallback |
| `apps/api/src/sync/providers/providers.module.ts` | **modified** — register and export both services |
| `apps/api/src/sync/providers/index.ts` | **modified** — export the selector, the breaker and their types |
| `apps/api/src/sync/catalog-sync.processor.ts` | **modified** — ask the selector, record outcomes, apply the two fallback rules |
| `packages/shared/src/enums.ts` | **modified** — `SyncKindSchema`, `SyncStatusSchema` |
| `packages/shared/src/entities/sync.ts` | the admin status response contract |
| `packages/shared/src/index.ts` | **modified** — export it |
| `apps/api/src/admin/admin-sync.service.ts` | the two reads |
| `apps/api/src/admin/admin.controller.ts` | one route |
| `apps/api/src/admin/admin.module.ts` | the module |
| `apps/api/src/admin/index.ts` | its public surface |
| `apps/api/src/app.module.ts` | **modified** — import `AdminModule` |
| `apps/api/src/sync/README.md`, `docs/API.md`, `docs/Architecture.md` | **modified** — the above, measured |

**`AdminModule` reads Redis directly rather than injecting `ProviderBreakerService`.** Injecting it would mean the API process importing `ProvidersModule`, which is the coupling `CatalogModule`'s empty `imports` array exists to avoid. The cost is that two files parse the same two keys; that is why the key builders live in `redis/cache.keys.ts` rather than beside the breaker.

### Task order

Task 1 → 2 → 3 → 4 → 5, strictly. Task 2 injects Task 1's service; Task 3 injects Task 2's; Task 4 reads the keys Task 1 defines.

---

## Task 1: The breaker

**Files:**
- Modify: `apps/api/src/redis/cache.keys.ts`
- Modify: `apps/api/src/redis/index.ts`
- Create: `apps/api/src/sync/providers/provider-breaker.service.ts`

**Interfaces:**
- Consumes: `RedisService` from `../../redis/index.js`; `CardSourceName` from `./card-source-provider.js`
- Produces:
  - `BREAKER_NAMESPACE = 'breaker'` and `breakerKeys.failures(provider)` / `breakerKeys.open(provider)`
  - `interface BreakerState { provider: CardSourceName; failures: number; openUntil: Date | null }`
  - `class ProviderBreakerService` with `recordFailure(p): Promise<number>`, `recordSuccess(p): Promise<void>`, `isOpen(p): Promise<boolean>`, `stateOf(p): Promise<BreakerState>`

- [ ] **Step 1: Add the keys**

In `apps/api/src/redis/cache.keys.ts`, append after the `throttleKeys` block:

```ts
/**
 * Outside the `cache:` namespace for the same reason `throttleKeys` is: a
 * routine cache flush must not reset a breaker, which would hand a failing
 * provider a fresh budget at the worst possible moment.
 *
 * Read through RedisService directly and never through CacheService - that one
 * turns a Redis failure into a miss, which for a counter means silently
 * forgetting an outage during the incident that caused it.
 */
export const BREAKER_NAMESPACE = 'breaker';

export const breakerKeys = {
  failures: (provider: string) => `${BREAKER_NAMESPACE}:fail:${provider}`,

  open: (provider: string) => `${BREAKER_NAMESPACE}:open:${provider}`,
} as const;
```

In `apps/api/src/redis/index.ts`, add `BREAKER_NAMESPACE` and `breakerKeys` to the existing export list from `./cache.keys.js`, keeping the list alphabetical.

- [ ] **Step 2: Write the breaker service**

Create `apps/api/src/sync/providers/provider-breaker.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { RedisService, breakerKeys } from '../../redis/index.js';
import type { CardSourceName } from './card-source-provider.js';

/**
 * Five consecutive escaped failures.
 *
 * Measured across four real sweeps against the primary: 3 failed pages out of
 * 83, scattered rather than clustered. At that rate five in a row is an event of
 * roughly 6e-8, so the threshold measures an outage rather than a bad night.
 * Consecutive is what makes that true - the counter resets on any success.
 */
const FAILURE_THRESHOLD = 5;

/** Thirty minutes, expressed as the open key's TTL. Nothing schedules a
 * re-test and nothing has to: the key expires, and the next run's selector
 * sees a closed breaker. */
const COOLDOWN_SECONDS = 1_800;

/**
 * The counter's own TTL. Without it, four failures from a run last Tuesday
 * would still be sitting there when a fifth arrives today, and "consecutive"
 * would quietly come to mean "five, ever".
 */
const FAILURE_WINDOW_SECONDS = 3_600;

export interface BreakerState {
  provider: CardSourceName;
  failures: number;
  openUntil: Date | null;
}

@Injectable()
export class ProviderBreakerService {
  private readonly logger = new Logger(ProviderBreakerService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Counts one escaped failure and returns the new count.
   *
   * Only ProviderUnavailableError and ProviderContractError reach here. A
   * ProviderRateLimitError must not: a 429 means the upstream is healthy and we
   * are asking too fast, and counting it moves the load onto the fallback and
   * rate-limits that one too.
   */
  async recordFailure(provider: CardSourceName): Promise<number> {
    try {
      const key = breakerKeys.failures(provider);
      const failures = await this.redis.client.incr(key);
      await this.redis.client.expire(key, FAILURE_WINDOW_SECONDS);

      if (failures >= FAILURE_THRESHOLD) {
        await this.redis.client.set(breakerKeys.open(provider), '1', 'EX', COOLDOWN_SECONDS);
        this.logger.warn(
          `Breaker OPEN for ${provider} after ${failures} consecutive failures; ` +
            `the next run will use a fallback until it expires in ${COOLDOWN_SECONDS}s`,
        );
      }

      return failures;
    } catch (error) {
      // Logged loudly rather than swallowed. A breaker that cannot count is a
      // breaker that will not trip, and an operator reading these logs during an
      // outage needs to know that is why.
      this.logger.error(`Could not record a failure for ${provider}: ${describe(error)}`);
      return 0;
    }
  }

  async recordSuccess(provider: CardSourceName): Promise<void> {
    try {
      await this.redis.client.del(breakerKeys.failures(provider));
    } catch (error) {
      this.logger.warn(`Could not reset the failure count for ${provider}: ${describe(error)}`);
    }
  }

  /**
   * Fails closed toward the primary, not toward the fallback: with Redis
   * unreachable this returns false, so the selector keeps the configured
   * provider. Switching sources on the strength of a Redis outage would be
   * acting on no evidence at all.
   */
  async isOpen(provider: CardSourceName): Promise<boolean> {
    try {
      return (await this.redis.client.exists(breakerKeys.open(provider))) === 1;
    } catch (error) {
      this.logger.warn(`Could not read the breaker for ${provider}: ${describe(error)}`);
      return false;
    }
  }

  async stateOf(provider: CardSourceName): Promise<BreakerState> {
    try {
      const [raw, ttl] = await Promise.all([
        this.redis.client.get(breakerKeys.failures(provider)),
        this.redis.client.ttl(breakerKeys.open(provider)),
      ]);

      const failures = raw === null ? 0 : Number(raw);

      return {
        provider,
        failures: Number.isFinite(failures) ? failures : 0,
        // -2 is "no such key" and -1 is "no expiry"; only a positive TTL is an
        // open breaker with time left on it.
        openUntil: ttl > 0 ? new Date(Date.now() + ttl * 1_000) : null,
      };
    } catch (error) {
      this.logger.warn(`Could not read breaker state for ${provider}: ${describe(error)}`);
      return { provider, failures: 0, openUntil: null };
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
```

- [ ] **Step 3: Register it and export its surface**

In `apps/api/src/sync/providers/providers.module.ts`, import the service, add `ProviderBreakerService` to the `providers` array, and add it to `exports`.

In `apps/api/src/sync/providers/index.ts`, add:

```ts
export { ProviderBreakerService } from './provider-breaker.service.js';
export type { BreakerState } from './provider-breaker.service.js';
```

- [ ] **Step 4: Measure the breaker against live Redis**

```bash
pnpm -s typecheck && pnpm -s build
```

```bash
cat > apps/api/dist/breaker-probe.mjs <<'EOF'
import { ProviderBreakerService } from './sync/providers/provider-breaker.service.js';

// The real ioredis client: a fake would prove nothing about the commands.
const { Redis } = await import('ioredis');
const redis = new Redis('redis://localhost:6379', { db: 0 });
const breaker = new ProviderBreakerService({ client: redis });

await redis.del('breaker:fail:pokemontcg', 'breaker:open:pokemontcg');

console.log('clean state   :', JSON.stringify(await breaker.stateOf('pokemontcg')));
console.log('isOpen        :', await breaker.isOpen('pokemontcg'), '| expect false');

for (let i = 1; i <= 4; i += 1) {
  const n = await breaker.recordFailure('pokemontcg');
  console.log(`failure ${i}     : count ${n}, open ${await breaker.isOpen('pokemontcg')} | expect false`);
}

console.log('reset by success');
await breaker.recordSuccess('pokemontcg');
console.log('after success :', JSON.stringify(await breaker.stateOf('pokemontcg')), '| expect failures 0');

for (let i = 1; i <= 5; i += 1) {
  const n = await breaker.recordFailure('pokemontcg');
  console.log(`failure ${i}     : count ${n}, open ${await breaker.isOpen('pokemontcg')} | expect open only at 5`);
}

const state = await breaker.stateOf('pokemontcg');
console.log('open state    :', JSON.stringify(state));
const secondsLeft = state.openUntil === null ? 0 : Math.round((state.openUntil - Date.now()) / 1000);
console.log('cooldown left :', secondsLeft, 'seconds | expect close to 1800');

console.log('--- namespace check: a cache flush must not touch it ---');
await redis.set('cache:probe', '1');
const cacheKeys = await redis.keys('cache:*');
console.log('cache:* keys  :', cacheKeys.length, '| breaker keys among them:',
  cacheKeys.filter((k) => k.includes('breaker')).length, '| expect 0');
await redis.del('cache:probe');

await redis.del('breaker:fail:pokemontcg', 'breaker:open:pokemontcg');
await redis.quit();
EOF
cd apps/api && node dist/breaker-probe.mjs; cd ../..
```

Expected, line by line:

- a clean state reads `failures: 0, openUntil: null`
- four failures leave it **closed** — this is the measurement that proves the threshold is five and not four
- a success resets the count to 0, which is what makes "consecutive" mean something
- the fifth consecutive failure **opens** it, and not the fourth
- the cooldown reads close to 1 800 seconds
- **no breaker key matches `cache:*`** — the reason the namespace is separate

- [ ] **Step 5: Gates and commit**

```bash
rm -f apps/api/dist/breaker-probe.mjs
pnpm -s typecheck && pnpm -s lint && pnpm -s format:check
```

```bash
git add apps/api/src/redis/cache.keys.ts apps/api/src/redis/index.ts apps/api/src/sync/providers/
git commit -F - <<'EOF'
[PD-43]: count provider failures behind a breaker with a cooldown

Five consecutive escaped failures open it for thirty minutes, and any success
resets the count. Measured against four real sweeps: 3 failed pages in 83,
scattered - so five in a row means an outage rather than a bad night.

State lives outside the cache namespace and is read through RedisService, not
CacheService. That service turns a Redis failure into a miss, which for a
counter means forgetting an outage during the incident that caused it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 2: The selector

**Files:**
- Modify: `apps/api/src/config/env.schema.ts`
- Create: `apps/api/src/sync/providers/provider-selector.service.ts`
- Modify: `apps/api/src/sync/providers/providers.module.ts`
- Modify: `apps/api/src/sync/providers/index.ts`

**Interfaces:**
- Consumes: `ProviderBreakerService`; `CARD_SOURCE_REGISTRY`, `CardSourceProvider`, `CardSourceRegistry`, `CardSourceName`; `APP_CONFIG`
- Produces:
  - `CARD_SOURCE_NAMES`, exported from `config/env.schema.js` and re-exported by `config/index.js`
  - `interface ProviderChoice { provider: CardSourceProvider; isFallback: boolean; reason: string }`
  - `class ProviderSelectorService` with `select(): Promise<ProviderChoice>`

- [ ] **Step 1: Make one list drive both the enum and the admin read**

In `apps/api/src/config/env.schema.ts`, replace the inline enum on `CARD_SOURCE_PROVIDER` with a named list so nothing has to repeat it:

```ts
export const CARD_SOURCE_NAMES = ['pokemontcg', 'tcgdex'] as const;
```

and then use it in the schema:

```ts
    CARD_SOURCE_PROVIDER: z.enum(CARD_SOURCE_NAMES).default('pokemontcg'),
```

Then export it from the barrel, `apps/api/src/config/index.ts`, beside the
existing `EnvSchema` export:

```ts
export { CARD_SOURCE_NAMES, EnvSchema, parseEnv } from './env.schema.js';
```

Place the `CARD_SOURCE_NAMES` declaration above the schema object. `CardSourceName` in `card-source-provider.ts` derives from `AppConfig['providers']['active']`, so it keeps working unchanged — confirm that with `pnpm -s typecheck` rather than by reading.

- [ ] **Step 2: Write the selector**

Create `apps/api/src/sync/providers/provider-selector.service.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';
import {
  CARD_SOURCE_REGISTRY,
  type CardSourceName,
  type CardSourceProvider,
  type CardSourceRegistry,
} from './card-source-provider.js';
import { ProviderUnavailableError } from './provider.errors.js';
import { ProviderBreakerService } from './provider-breaker.service.js';

export interface ProviderChoice {
  provider: CardSourceProvider;

  /**
   * True when this is not the configured primary. The processor uses it to
   * apply the two rules that keep a failover from forking the catalog, so it is
   * load-bearing rather than informational.
   */
  isFallback: boolean;

  reason: string;
}

@Injectable()
export class ProviderSelectorService {
  private readonly logger = new Logger(ProviderSelectorService.name);

  private readonly primary: CardSourceName;

  constructor(
    @Inject(CARD_SOURCE_REGISTRY) private readonly registry: CardSourceRegistry,
    private readonly breaker: ProviderBreakerService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.primary = config.providers.active;
  }

  /**
   * Asked once per run and never per page.
   *
   * Switching mid-run would put two id vocabularies inside one SyncRun - pages
   * 1-40 written as sv4-25 and 41-83 as sv04-25 - and the run's `provider`
   * column could then name only one of the two sources that wrote it. That is
   * the fork this whole design exists to prevent, arriving through the door
   * marked resilience.
   */
  async select(): Promise<ProviderChoice> {
    const primary = this.mustResolve(this.primary);

    if (!(await this.breaker.isOpen(this.primary))) {
      return { provider: primary, isFallback: false, reason: 'configured primary' };
    }

    for (const [name, provider] of this.registry) {
      if (name === this.primary) {
        continue;
      }

      if (!(await this.breaker.isOpen(name))) {
        this.logger.warn(
          `Breaker open for ${this.primary}; this run will use ${name} as a fallback`,
        );
        return {
          provider,
          isFallback: true,
          reason: `breaker open for ${this.primary}`,
        };
      }
    }

    // Every registered provider is failing. Running anyway would spend a sweep
    // on a source already known to be down, and the mirror is no less current
    // for being left alone.
    throw new ProviderUnavailableError(
      this.primary,
      'every registered provider has an open breaker',
    );
  }

  private mustResolve(name: CardSourceName): CardSourceProvider {
    const provider = this.registry.get(name);

    if (!provider) {
      throw new Error(
        `No card source provider is registered for "${name}". ` +
          'Registration lives in providers.module.ts, beside the clients themselves.',
      );
    }

    return provider;
  }
}
```

- [ ] **Step 3: Register and export**

In `providers.module.ts`, add `ProviderSelectorService` to `providers` and to `exports`.

In `providers/index.ts`, add:

```ts
export { ProviderSelectorService } from './provider-selector.service.js';
export type { ProviderChoice } from './provider-selector.service.js';
```

- [ ] **Step 4: Measure the selector through the real DI container**

```bash
pnpm -s typecheck && pnpm -s build
```

```bash
cat > apps/api/dist/selector-probe.mjs <<'EOF'
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';
import { ProviderSelectorService, ProviderBreakerService } from './sync/providers/index.js';

const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['warn', 'error'] });
const selector = app.get(ProviderSelectorService);
const breaker = app.get(ProviderBreakerService);

const open = async (p) => { for (let i = 0; i < 5; i += 1) await breaker.recordFailure(p); };

await breaker.recordSuccess('pokemontcg');
await breaker.recordSuccess('tcgdex');

const a = await selector.select();
console.log('both closed   :', a.provider.name, '| isFallback', a.isFallback, '|', a.reason,
  '| expect pokemontcg false');

await open('pokemontcg');
const b = await selector.select();
console.log('primary open  :', b.provider.name, '| isFallback', b.isFallback, '|', b.reason,
  '| expect tcgdex true');

await open('tcgdex');
try {
  await selector.select();
  console.log('both open     : RETURNED A PROVIDER - this is wrong');
} catch (error) {
  console.log('both open     : threw', error.constructor.name, '-', error.message);
}

await app.close();
EOF
cd apps/api && node dist/selector-probe.mjs; cd ../..
```

Expected:

- both breakers closed → `pokemontcg`, `isFallback false`
- the primary's breaker open → **`tcgdex`, `isFallback true`** — the substance of the first acceptance criterion
- both open → **throws `ProviderUnavailableError`**, rather than quietly running a source known to be down

- [ ] **Step 5: Prove the selector fails toward the primary when Redis is down**

The spec's failure table ends with this row, and it is the one that decides the
worst case: with no breaker state readable, the run must use the provider the
operator configured rather than a fallback nobody asked for.

**Do not stop the Redis container for this.** `RedisService.onModuleInit` calls
`connect()` and `ping()`, so a Nest context cannot boot without Redis at all —
the probe would die before reaching the selector and prove nothing. Boot first,
then break the connection from inside:

```bash
cat > apps/api/dist/selector-offline-probe.mjs <<'EOF'
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';
import { ProviderSelectorService, ProviderBreakerService } from './sync/providers/index.js';
import { RedisService } from './redis/index.js';

const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['warn', 'error'] });
const breaker = app.get(ProviderBreakerService);

// Open the primary's breaker while Redis still works, so that if the selector
// were able to read state it would choose the fallback. Then take Redis away.
for (let i = 0; i < 5; i += 1) await breaker.recordFailure('pokemontcg');
console.log('primary breaker open while redis is up:', await breaker.isOpen('pokemontcg'), '| expect true');

app.get(RedisService).client.disconnect();

const choice = await app.get(ProviderSelectorService).select();
console.log('redis down    :', choice.provider.name, '| isFallback', choice.isFallback, '|', choice.reason,
  '| expect pokemontcg false');

process.exit(0);
EOF
cd apps/api && node dist/selector-offline-probe.mjs; cd ../..
```

Expected: the breaker reads **open** while Redis is up, and then — with the
connection gone — the selector still returns **`pokemontcg`, `isFallback
false`**, logging a warning that it could not read the breaker.

That contrast is the whole measurement. A selection of `tcgdex` on the second
line would mean the state was cached somewhere it should not be; a crash would
mean the `catch` in `isOpen` is not covering the failure ioredis actually
raises. `process.exit(0)` rather than `app.close()`, because shutting down
cleanly needs the Redis connection this probe just destroyed.

Then clear the keys before moving on, since they are shared with the running stack:

```bash
$REDIS DEL breaker:fail:pokemontcg breaker:open:pokemontcg breaker:fail:tcgdex breaker:open:tcgdex
```

- [ ] **Step 6: Gates and commit**

```bash
rm -f apps/api/dist/selector-probe.mjs apps/api/dist/selector-offline-probe.mjs
pnpm -s typecheck && pnpm -s lint && pnpm -s format:check
```

```bash
git add apps/api/src/config/env.schema.ts apps/api/src/sync/providers/
git commit -F - <<'EOF'
[PD-43]: choose a run's provider from the breaker, once per run

Once per run and never per page. A mid-run switch would put two id
vocabularies inside one SyncRun and leave its provider column naming only one
of the two sources that wrote it.

With every breaker open the selector throws rather than returning a provider:
spending a sweep on a source already known to be down buys nothing, and the
mirror is no less current for being left alone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 3: The processor

**Files:**
- Modify: `apps/api/src/sync/catalog-sync.processor.ts`

**Interfaces:**
- Consumes: `ProviderSelectorService`, `ProviderBreakerService`, `ProviderChoice`
- Produces: nothing new; the processor is a leaf

- [ ] **Step 1: Swap the injected provider for the selector**

In `apps/api/src/sync/catalog-sync.processor.ts`, replace the `CARD_SOURCE_PROVIDER` injection with the two services. The constructor becomes:

```ts
  constructor(
    private readonly selector: ProviderSelectorService,
    private readonly breaker: ProviderBreakerService,
    private readonly prisma: PrismaService,
    private readonly writer: CatalogWriter,
    private readonly runs: SyncRunService,
    private readonly cache: CacheService,
  ) {
    super();
  }
```

**Every `this.provider` reference in the file moves to the local `provider`** —
`fetchSets()`, `fetchCards()` and `.name` all read from it. Grep for
`this.provider` after editing; there must be none left.

Update the imports from `./providers/index.js` accordingly: `ProviderContractError`, `ProviderRateLimitError`, `ProviderSelectorService`, `ProviderBreakerService`, and the type `ProviderChoice`. `CARD_SOURCE_PROVIDER` and `CardSourceProvider` are no longer used here — remove them, and remember `@Inject` may become unused too.

At the top of `process`, replace the first two statements with:

```ts
    const choice = await this.selector.select();
    const provider = choice.provider;

    const run = await this.runs.startOrResume(SyncKind.CATALOG, provider.name, job.id ?? '');
```

**Note what happens when `select()` throws.** It runs before `startOrResume`, so
no `SyncRun` row exists to close — the job fails in BullMQ and lands in the
failed set, which `queue/README.md` calls the dead letter. The spec's failure
table says such a run "closes `FAILED`"; it cannot, because there is nothing to
close, and a row recording a run that never chose a provider would have nothing
truthful to put in its `provider` column. Record this in the README in Task 5
rather than inventing a row to satisfy the sentence.

- [ ] **Step 2: Add the two rules that make failover safe**

Immediately after the existing `const log = ...` arrow function — not before
it, since the block below calls `log` — add:

```ts
    // Rule one of two. A fallback run never writes a set, because the providers
    // disagree about set ids on 50 of the mirror's 176 - `sv3pt5` against
    // `sv03.5` - and writing one would add a second copy of a set that is
    // already there under another name.
    //
    // Rule two is below, in the page loop. Neither mentions a provider by name:
    // this is a property of failing over, so a third source inherits it.
    if (choice.isFallback) {
      log(`fallback run via ${provider.name} (${choice.reason}); sets will not be written`);
    }
```

Change the sets guard from `if (page === 1) {` to:

```ts
    if (page === 1 && !choice.isFallback) {
```

Inside the page loop, after `const result = await this.provider.fetchCards(...)` — now `provider.fetchCards(...)` — and **before** the transaction, insert the second rule:

```ts
        // Rule two. A fallback run may only write a card whose id is ALREADY in
        // the mirror. It refreshes; it never introduces.
        //
        // Checking the set instead of the card is not enough, and that was
        // measured the expensive way: TCGdex zero-pads card numbers inside sets
        // both providers share, so `sv10-060` and `sv10-60` are one physical
        // card under two ids. A set-level filter passes both, and a real
        // failover run put 593 duplicates into the mirror before this was
        // caught. The set rule survives as rule one; this is what makes it
        // sufficient.
        const writable = choice.isFallback
          ? await this.alreadyMirrored(result.items)
          : result.items;

        unwritable += result.items.length - writable.length;

        const written = await this.prisma.withTransaction((tx) =>
          this.writer.upsertCards(tx, writable),
        );
```

Declare `let unwritable = 0;` beside `let processed` and `let failed` at the top of `process`.

Add the helper method at the end of the class:

```ts
  /**
   * Which of this page's cards the mirror already holds.
   *
   * One indexed primary-key lookup of at most 250 ids per page, rather than
   * loading all 20 670 ids once: the per-page query is bounded in memory and
   * reflects the table as it is now, and 83 such queries across a sweep is
   * noise beside the upserts they guard.
   */
  private async alreadyMirrored(items: CardDTO[]): Promise<CardDTO[]> {
    if (items.length === 0) {
      return items;
    }

    const rows = await this.prisma.card.findMany({
      where: { id: { in: items.map((card) => card.id) } },
      select: { id: true },
    });

    const known = new Set(rows.map((row) => row.id));
    return items.filter((card) => known.has(card.id));
  }
```

- [ ] **Step 3: Feed the breaker, and only from the right errors**

Replace the page loop's `catch` block with:

```ts
      } catch (error) {
        if (error instanceof ProviderContractError) {
          // The upstream changed shape. Continuing would fill the mirror with
          // nonsense, which is worse than stopping.
          await this.breaker.recordFailure(provider.name);
          await this.runs.close(run.id, SyncStatus.FAILED, describe(error));
          throw error;
        }

        failed += 1;

        // A 429 says the upstream is healthy and we are asking too fast.
        // Counting it would move the load onto the fallback and rate-limit that
        // one too - the rule sync/README.md and http.ts both already state.
        if (!(error instanceof ProviderRateLimitError)) {
          const count = await this.breaker.recordFailure(provider.name);
          this.logger.warn(
            `run ${run.id}: page ${page} failed (${count} consecutive) - ${describe(error)}`,
          );
        } else {
          this.logger.warn(`run ${run.id}: page ${page} rate limited - ${describe(error)}`);
        }

        // Keep going. A page that exhausted its retry budget is one page, and
        // the next may well succeed - this upstream fails about 70% of
        // individual requests.
        hasMore = true;
      }
```

And on the success path, immediately after the `log(...)` call that reports the page, add:

```ts
        // Consecutive is what makes the threshold mean an outage. One good page
        // is evidence the provider is serving.
        await this.breaker.recordSuccess(provider.name);
```

Also record a failure when the sets fetch fails — in that existing `catch`, before `runs.close`:

```ts
        await this.breaker.recordFailure(provider.name);
```

- [ ] **Step 4: Close a fallback run honestly**

Replace the final status block with:

```ts
    // A fallback run is partial by definition: it refreshed the 73.6% of the
    // mirror whose set ids both providers share and deliberately left the rest.
    // Reporting SUCCEEDED would be a lie told to the one person reading the
    // admin page during an outage.
    const status =
      choice.isFallback || failed > 0 ? SyncStatus.PARTIAL : SyncStatus.SUCCEEDED;

    const reason = choice.isFallback
      ? `fallback via ${provider.name} (${choice.reason}); no set written, ` +
        `${unwritable} cards skipped for sets absent from the mirror`
      : undefined;

    await this.invalidate();
    await this.runs.close(run.id, status, reason);
    log(`finished ${status}: ${processed} processed, ${failed} failed, ${unwritable} unwritable`);
```

- [ ] **Step 5: Prove a simulated outage completes through the fallback**

```bash
pnpm -s typecheck && pnpm -s build
```

Record the shape of the mirror first — these two numbers are what "nothing forked" means:

```bash
$PSQL -tAc "SELECT count(*) FROM sets" > /tmp/pd43-sets-before.txt
$PSQL -tAc "SELECT count(*) FROM cards" > /tmp/pd43-cards-before.txt
cat /tmp/pd43-sets-before.txt /tmp/pd43-cards-before.txt
```

Expected: `176` and `20670`.

```bash
cat > apps/api/dist/failover-probe.mjs <<'EOF'
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';
import { ProviderBreakerService } from './sync/providers/index.js';
import { QUEUE } from './queue/index.js';
import { getQueueToken } from '@nestjs/bullmq';

const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['log', 'warn', 'error'] });
const breaker = app.get(ProviderBreakerService);

await breaker.recordSuccess('tcgdex');
for (let i = 0; i < 5; i += 1) await breaker.recordFailure('pokemontcg');
console.log('primary breaker:', JSON.stringify(await breaker.stateOf('pokemontcg')));

const queue = app.get(getQueueToken(QUEUE.catalogSync));
const job = await queue.add('catalog-sync', {});
console.log('enqueued', job.id, '- this process consumes it; let it run, then stop it');
EOF
```

Run it in the background — the sweep is long, and a foreground call will time out:

```bash
cd apps/api && node dist/failover-probe.mjs
```

Let it run for **three to four minutes**, which is enough for several pages, then stop the process. You do not need a complete sweep: the acceptance criterion is that the run proceeds through the fallback and writes nothing it should not, and that is visible after a handful of pages.

- [ ] **Step 6: Check what the fallback run did and did not do**

```bash
$PSQL -c "
SELECT provider, status, processed, failed, left(error, 90) AS reason
FROM sync_runs ORDER BY \"startedAt\" DESC LIMIT 1;
SELECT count(*) AS sets_now FROM sets;
SELECT count(*) AS cards_now FROM cards;
SELECT count(*) AS cards_in_unknown_sets FROM cards c
  WHERE NOT EXISTS (SELECT 1 FROM sets s WHERE s.id = c.\"setId\");
"
```

The four things this must show, each one an acceptance criterion or the rule that protects it:

1. **`provider` reads `tcgdex`** — the run was served by the fallback. This is PD-43's first acceptance criterion and its third.
2. **`sets_now` is still 176** — rule one held; a fallback run wrote no set. Compare against `/tmp/pd43-sets-before.txt`.
3. **`cards_in_unknown_sets` is 0**, and no set id appeared that was not there before:
   ```bash
   $PSQL -tAc "SELECT string_agg(id, ',' ORDER BY id) FROM sets" | tr ',' '\n' | grep -E '^(sv0|me0|2024)' || echo "no TCGdex-scheme set ids present - nothing forked"
   ```
4. **`status` is `PARTIAL`** and `reason` names the fallback and the count of skipped cards.

- [ ] **Step 7: Prove the primary is retried once the cooldown expires**

```bash
$REDIS TTL breaker:open:pokemontcg
$REDIS DEL breaker:open:pokemontcg
```

Deleting the key is exactly what its TTL does 30 minutes later; this tests the same transition without waiting. Then re-run the selector probe from Task 2 — or simply:

```bash
cat > apps/api/dist/recovery-probe.mjs <<'EOF'
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';
import { ProviderSelectorService } from './sync/providers/index.js';

const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['warn', 'error'] });
const choice = await app.get(ProviderSelectorService).select();
console.log('after cooldown:', choice.provider.name, '| isFallback', choice.isFallback, '|', choice.reason);
await app.close();
EOF
cd apps/api && node dist/recovery-probe.mjs; cd ../..
```

Expected: **`pokemontcg`, `isFallback false`** — PD-43's second acceptance criterion, satisfied by expiry rather than by a timer.

- [ ] **Step 8: Prove a 429 does not open the breaker**

```bash
$REDIS DEL breaker:fail:pokemontcg breaker:open:pokemontcg
```

```bash
cat > apps/api/dist/ratelimit-probe.mjs <<'EOF'
import { ProviderBreakerService } from './sync/providers/provider-breaker.service.js';
import { ProviderRateLimitError, ProviderUnavailableError } from './sync/providers/provider.errors.js';
import { Redis } from 'ioredis';

const redis = new Redis('redis://localhost:6379', { db: 0 });
const breaker = new ProviderBreakerService({ client: redis });
await redis.del('breaker:fail:pokemontcg', 'breaker:open:pokemontcg');

// Exactly the branch the processor runs, in isolation.
const record = async (error) => {
  if (!(error instanceof ProviderRateLimitError)) await breaker.recordFailure('pokemontcg');
};

for (let i = 0; i < 10; i += 1) {
  await record(new ProviderRateLimitError('pokemontcg', 'rate limited', null));
}
console.log('after 10 x 429   :', JSON.stringify(await breaker.stateOf('pokemontcg')),
  '| expect failures 0, openUntil null');

for (let i = 0; i < 5; i += 1) {
  await record(new ProviderUnavailableError('pokemontcg', 'down'));
}
console.log('after 5 x 5xx    :', JSON.stringify(await breaker.stateOf('pokemontcg')),
  '| expect failures 5, openUntil set');

await redis.del('breaker:fail:pokemontcg', 'breaker:open:pokemontcg');
await redis.quit();
EOF
cd apps/api && node dist/ratelimit-probe.mjs; cd ../..
```

Expected: ten rate-limit errors leave the counter at **0**; five unavailable errors open it. If the first number is anything but zero, the breaker is counting the one error that must never reach it.

- [ ] **Step 9: Gates and commit**

```bash
rm -f apps/api/dist/failover-probe.mjs apps/api/dist/recovery-probe.mjs apps/api/dist/ratelimit-probe.mjs
$REDIS DEL breaker:fail:pokemontcg breaker:open:pokemontcg breaker:fail:tcgdex breaker:open:tcgdex
pnpm -s typecheck && pnpm -s lint && pnpm -s format:check
```

```bash
git add apps/api/src/sync/catalog-sync.processor.ts
git commit -F - <<'EOF'
[PD-43]: run the sync on the selected provider and never fork the mirror

Two rules, neither naming a provider: a fallback run writes no set, and skips
any card whose set is not already mirrored. The two sources disagree about set
ids on 50 of the mirror's 176, so without them a failover does not fail - it
silently grows a second copy of those sets.

Such a run closes PARTIAL with its reason recorded. 73.6% coverage is partial
by definition, and SUCCEEDED would be a lie told during an outage.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 4: The admin surface

**Files:**
- Modify: `packages/shared/src/enums.ts`
- Create: `packages/shared/src/entities/sync.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `apps/api/src/admin/admin-sync.service.ts`
- Create: `apps/api/src/admin/admin.controller.ts`
- Create: `apps/api/src/admin/admin.module.ts`
- Create: `apps/api/src/admin/index.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService` and `RedisService` (both `@Global()`, confirmed), `breakerKeys`, `CARD_SOURCE_NAMES` from `config/index.js`, `Roles`
- Produces: `SyncStatusResponseSchema` / `SyncStatusResponse`, `GET /api/v1/admin/sync/status`

- [ ] **Step 1: Add the two enums to the shared package**

In `packages/shared/src/enums.ts`, after `PriceSourceSchema`:

```ts
export const SyncKindSchema = z.enum(['CATALOG', 'PRICE']);
export type SyncKind = z.infer<typeof SyncKindSchema>;

export const SyncStatusSchema = z.enum(['RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED']);
export type SyncStatus = z.infer<typeof SyncStatusSchema>;
```

- [ ] **Step 2: Write the response contract**

Create `packages/shared/src/entities/sync.ts`:

```ts
import { z } from 'zod';
import { SyncKindSchema, SyncStatusSchema } from '../enums.js';

/**
 * `provider` is a free string rather than an enum, matching the column. A closed
 * enum would need a migration every time a provider is added, which is exactly
 * the coupling the CardSourceProvider adapter removes - docs/DataModel.md says
 * so on the model itself.
 */
export const SyncRunSummarySchema = z.object({
  kind: SyncKindSchema,
  provider: z.string().min(1),
  status: SyncStatusSchema,
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullable(),
  processed: z.number().int().min(0),
  failed: z.number().int().min(0),
  error: z.string().nullable(),
});
export type SyncRunSummary = z.infer<typeof SyncRunSummarySchema>;

/**
 * `openUntil` is when the cooldown expires, not when it opened. It is the only
 * one of the two an operator can act on: it answers "when will the primary be
 * tried again", which is the question being asked.
 */
export const ProviderBreakerStateSchema = z.object({
  provider: z.string().min(1),
  failures: z.number().int().min(0),
  openUntil: z.coerce.date().nullable(),
});
export type ProviderBreakerStateDto = z.infer<typeof ProviderBreakerStateSchema>;

export const SyncStatusResponseSchema = z.object({
  runs: z.array(SyncRunSummarySchema),
  breakers: z.array(ProviderBreakerStateSchema),
});
export type SyncStatusResponse = z.infer<typeof SyncStatusResponseSchema>;
```

Add `export * from './entities/sync.js';` to `packages/shared/src/index.ts`, beside the other entity exports.

- [ ] **Step 3: Write the service**

Create `apps/api/src/admin/admin-sync.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { SyncKind } from '@prisma/client';
import {
  SyncStatusResponseSchema,
  type ProviderBreakerStateDto,
  type SyncRunSummary,
  type SyncStatusResponse,
} from '@pokedrop/shared';
import { CARD_SOURCE_NAMES } from '../config/index.js';
import { PrismaService } from '../prisma/index.js';
import { RedisService, breakerKeys } from '../redis/index.js';

@Injectable()
export class AdminSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async status(): Promise<SyncStatusResponse> {
    const [runs, breakers] = await Promise.all([this.lastRunPerKind(), this.breakerStates()]);
    return SyncStatusResponseSchema.parse({ runs, breakers });
  }

  /**
   * One row per kind rather than a list: the question this endpoint answers is
   * "what happened last", and `sync_runs` has an index on (kind, startedAt desc)
   * that makes each of these two queries a single index lookup.
   */
  private async lastRunPerKind(): Promise<SyncRunSummary[]> {
    const kinds = [SyncKind.CATALOG, SyncKind.PRICE];

    const rows = await Promise.all(
      kinds.map((kind) =>
        this.prisma.syncRun.findFirst({ where: { kind }, orderBy: { startedAt: 'desc' } }),
      ),
    );

    return rows.filter((row) => row !== null);
  }

  /**
   * Read straight from Redis rather than through ProviderBreakerService.
   *
   * Injecting that service would mean this module importing ProvidersModule,
   * putting the sync layer's tokens into the API process's context - the
   * coupling CatalogModule's empty `imports` array exists to avoid. The cost is
   * that two files parse the same two keys, which is why the key builders live
   * in redis/cache.keys.ts rather than beside the breaker.
   */
  private async breakerStates(): Promise<ProviderBreakerStateDto[]> {
    return Promise.all(
      CARD_SOURCE_NAMES.map(async (provider) => {
        try {
          const [raw, ttl] = await Promise.all([
            this.redis.client.get(breakerKeys.failures(provider)),
            this.redis.client.ttl(breakerKeys.open(provider)),
          ]);

          const failures = raw === null ? 0 : Number(raw);

          return {
            provider,
            failures: Number.isFinite(failures) ? failures : 0,
            openUntil: ttl > 0 ? new Date(Date.now() + ttl * 1_000) : null,
          };
        } catch {
          // Redis being down is not a reason for the admin page to 500. A
          // breaker that cannot be read reports as closed, which is also what
          // the selector assumes.
          return { provider, failures: 0, openUntil: null };
        }
      }),
    );
  }
}
```

- [ ] **Step 4: Write the controller, the module and the barrel**

Create `apps/api/src/admin/admin.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { SyncStatusResponse } from '@pokedrop/shared';
import { Roles } from '../common/decorators/roles.decorator.js';
import { AdminSyncService } from './admin-sync.service.js';

/**
 * Read only. Triggering a sync and clearing a breaker are PD-81's half of this
 * surface, in M10; this exists now because PD-43's third acceptance criterion is
 * a statement about an endpoint, and one that can only be checked with psql is
 * not an acceptance criterion.
 *
 * No @Public() here on purpose: the global SessionGuard answers 401 without a
 * session and RolesGuard answers 403 for a member, which is the polarity PD-33
 * chose so that forgetting a decorator is noisy rather than silent.
 */
@ApiTags('admin')
@Roles(['ADMIN'])
@Controller('admin')
export class AdminController {
  constructor(private readonly sync: AdminSyncService) {}

  @Get('sync/status')
  syncStatus(): Promise<SyncStatusResponse> {
    return this.sync.status();
  }
}
```

Create `apps/api/src/admin/admin.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminSyncService } from './admin-sync.service.js';

/**
 * An empty `imports` is deliberate, the same way CatalogModule's is.
 * PrismaModule and RedisModule are @Global(), so their services inject without
 * one - and SyncModule is not, so this module cannot reach a provider or a
 * queue even by accident. The sync runs in the worker process; this answers in
 * the API process; they share a database and a Redis, not a module.
 */
@Module({
  controllers: [AdminController],
  providers: [AdminSyncService],
})
export class AdminModule {}
```

Create `apps/api/src/admin/index.ts`:

```ts
export { AdminModule } from './admin.module.js';
export { AdminSyncService } from './admin-sync.service.js';
```

In `apps/api/src/app.module.ts`, add `import { AdminModule } from './admin/index.js';` beside the other module imports and add `AdminModule` to the `imports` array.

`PrismaModule` and `RedisModule` are both `@Global()` — verified while planning, at `prisma.module.ts:4` and `redis.module.ts:5` — so the empty `imports` array is accurate rather than optimistic.

- [ ] **Step 5: Measure the endpoint**

```bash
pnpm -s typecheck && pnpm -s build
```

Start the API in the background (use the Bash tool's `run_in_background`, not a detached shell):

```bash
cd apps/api && node dist/main
```

Wait for it, then check the guard polarity first — an endpoint that leaks sync internals to anyone is worse than one that does not exist:

```bash
curl -s -o /dev/null -w "no session: %{http_code}\n" $API/admin/sync/status
```

Expected: **401**.

Now you need an admin session. **The seeded `admin@pokedrop.test` cannot give
you one** — the seed creates the user row but no credential account, so there is
no password to sign in with. Verified while planning: the `accounts` join for
that user returns nothing. Create a throwaway user through the API instead, then
promote it in SQL:

```bash
curl -s -X POST $API/auth/sign-up/email   -H 'Content-Type: application/json'   -d '{"email":"pd43-admin@pokedrop.test","password":"pd43-probe-password","name":"PD43 Probe"}'   -o /dev/null -w "sign-up: %{http_code}
"
```

```bash
$PSQL -tAc "UPDATE users SET role='ADMIN', \"emailVerified\"=true WHERE email='pd43-admin@pokedrop.test' RETURNING role, \"emailVerified\""
```

Setting `emailVerified` in SQL skips the Mailpit round trip; this step is testing
the role guard and the payload, not PD-31's verification flow, which has its own
measurements.

```bash
curl -s -c /tmp/pd43-admin.txt -X POST $API/auth/sign-in/email   -H 'Content-Type: application/json'   -d '{"email":"pd43-admin@pokedrop.test","password":"pd43-probe-password"}'   -o /dev/null -w "sign-in: %{http_code}
"
```

Expected: **200**, and `/tmp/pd43-admin.txt` now holds a session cookie.

```bash
$REDIS SET breaker:fail:pokemontcg 3
$REDIS SET breaker:open:pokemontcg 1 EX 1800
curl -s -b /tmp/pd43-admin.txt $API/admin/sync/status | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(JSON.parse(s),null,1)))"
```

Expected, and the last of these is the third acceptance criterion:

- `runs[0].kind` is `CATALOG` and **`runs[0].provider` names the provider that
  served the last run** — `tcgdex` if Task 3's failover run was the most recent
- `runs[0].status` is `PARTIAL` with the fallback reason in `error`
- `breakers` has an entry per provider; `pokemontcg` shows `failures: 3` and an
  `openUntil` roughly 30 minutes out; `tcgdex` shows `failures: 0` and `null`

Then confirm a member is refused, which is the other half of the guard:

```bash
$PSQL -tAc "UPDATE users SET role='MEMBER' WHERE email='pd43-admin@pokedrop.test' RETURNING role"
curl -s -o /dev/null -w "as member: %{http_code}
" -b /tmp/pd43-admin.txt $API/admin/sync/status
$PSQL -tAc "UPDATE users SET role='ADMIN' WHERE email='pd43-admin@pokedrop.test' RETURNING role"
```

Expected: **403** — the session is valid, the role is not.

- [ ] **Step 6: Confirm it degrades when Redis is down**

```bash
docker compose stop redis
curl -s -o /dev/null -w "redis down: %{http_code} in %{time_total}s\n" -b /tmp/pd43-admin.txt $API/admin/sync/status
docker compose start redis
```

Expected: **200**, in well under a second, with the breakers reported as closed. A 500 here means the `catch` in `breakerStates` is not doing its job; a hang means something is reaching Redis outside it.

Stop the API, delete the throwaway user and its account row, and clear the keys.
Leaving a verified admin with a known password in the database would be a worse
outcome than any finding this task could produce:

```bash
$PSQL -tAc "DELETE FROM users WHERE email='pd43-admin@pokedrop.test' RETURNING email"
$PSQL -tAc "SELECT count(*) FROM users WHERE email='pd43-admin@pokedrop.test'"
$REDIS DEL breaker:fail:pokemontcg breaker:open:pokemontcg
rm -f /tmp/pd43-admin.txt
```

The second query must print `0`. `accounts` and `sessions` cascade from `users`,
so the credential row goes with it.

- [ ] **Step 7: Gates and commit**

```bash
pnpm -s typecheck && pnpm -s lint && pnpm -s format:check
```

```bash
git add packages/shared/src apps/api/src/admin apps/api/src/app.module.ts
git commit -F - <<'EOF'
[PD-43]: report the last run and the breakers to an admin

Read only, behind @Roles(['ADMIN']). Triggering a sync and clearing a breaker
belong to PD-81 in M10; this exists now because an acceptance criterion that
can only be checked with psql is not an acceptance criterion.

The module imports nothing, like CatalogModule, and reads the breaker keys
straight from Redis rather than injecting the sync layer's service - which
would put provider tokens into the API process for one read.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 5: Documentation

**Files:**
- Modify: `apps/api/src/sync/README.md`
- Modify: `docs/API.md`
- Modify: `docs/Architecture.md`

- [ ] **Step 1: Document the failover in the sync README**

Remove the PD-43 row from the "What is not here yet" table — if that leaves the table empty, delete the table and keep the surrounding prose about why the wiring waited.

Append a section, using the numbers Tasks 1–4 actually printed rather than the ones quoted here:

```markdown
## Failover

`ProviderSelectorService` answers which provider a run uses. The processor asks
it **once per run**, never per page.

### The breaker

| | |
| --- | --- |
| counts | `ProviderUnavailableError`, `ProviderContractError` |
| never counts | `ProviderRateLimitError` |
| threshold | 5 **consecutive** escaped failures |
| cooldown | 30 minutes, expressed as the open key's TTL |
| state | `breaker:fail:{provider}`, `breaker:open:{provider}` in Redis db 0 |

Five, because four real sweeps against the primary failed 3 pages out of 83,
scattered rather than clustered — five in a row at that rate is an event of
roughly 6 × 10⁻⁸. Consecutive is what makes that true: any successful page
deletes the counter.

An individual 5xx never reaches the breaker. `http.ts` retries internally, so a
`ProviderUnavailableError` means the whole attempt budget was spent — which is
what makes the signal mean "unusable" rather than "a request failed".

**The state is not in the cache namespace and is not read through
`CacheService`.** That service turns a Redis failure into a miss, which is right
for a cache and catastrophic for a counter: the breaker would forget an outage
during exactly the incident that caused it. With Redis unreachable the breaker
reports closed and the run uses the configured primary — failing toward the
source the operator chose, rather than switching on no evidence.

### Two rules keep a failover from forking the mirror

The providers disagree about set ids on 50 of the mirror's 176 sets — `sv3pt5`
against `sv03.5`, `me1` against `me01`. **15 222 of the 20 670 cards (73.6%)
share an id with TCGdex; 5 448 do not.** A naive failover does not fail, it
forks: every foreign key holds, nothing raises, and the mirror quietly grows a
second copy of 50 sets.

1. **A fallback run never writes a set.** `fetchSets()` is not called.
2. **A fallback run may only write a card whose `id` is already in the mirror.**
   It refreshes; it never introduces.

Rule two checks the card and not its set, and that distinction was measured the
expensive way. TCGdex zero-pads card numbers **inside sets both providers
share** — `sv10-060` against `sv10-60` is one physical card under two ids — so a
set-level filter passes both. A real failover run wrote 593 such duplicates into
the mirror before this was caught, with every other rule holding and nothing
raising an error.

Neither rule names a provider, because this is a property of failing over rather
than of one source — a third provider inherits the protection without a line of
new code. The 50 divergent sets simply do not refresh while the primary is down;
they stay as they were, which is what a mirror is for.

**A fallback run always closes `PARTIAL`**, with the provider, the reason and the
skipped count in `SyncRun.error`.

### It switches at the next run, not mid-run

The ticket's scope line says the sync layer should switch "that batch". It does
not, deliberately. A mid-run switch would put two id vocabularies inside one
`SyncRun` — pages 1–40 as `sv4-25`, 41–83 as `sv04-25` — and the run's
`provider` column could then name only one of the two sources that wrote it.
The fork would arrive through the door marked resilience.

The cost is one sync cycle of staleness on the sets the fallback could have
served. The scheduler runs daily and the catalog gains a set a few times a year,
so that is a cost the architecture already absorbs; a forked catalog is not.

### Measured
```

Then fill in this table with what Tasks 3 and 4 actually printed. Leave no row
blank — a row with no measurement behind it is the thing this table exists to
prevent:

```markdown
| Measured | Result |
| --- | --- |
| provider recorded by the failover run | |
| sets before / after | |
| cards in sets absent from the mirror | |
| run status and its recorded reason | |
| breaker after 10 consecutive 429s | |
| breaker after 5 consecutive 5xx | |
| selection once the cooldown key expired | |
| `/admin/sync/status` without a session / as a member | |
| `/admin/sync/status` with Redis stopped | |
```

Add one sentence beneath it stating that when every breaker is open the selector
throws before a `SyncRun` is created, so the job fails in BullMQ and no row is
written — the spec's failure table says such a run closes `FAILED`, and this is
where that is corrected.

- [ ] **Step 2: Document the endpoint in `docs/API.md`**

The "Admin / Sync" section already lists `GET /admin/sync/status`. Replace its
row's note and add prose beneath the table:

```markdown
**`GET /admin/sync/status` is read only and returns two things**: the last run
of each `SyncKind` — provider, status, timestamps, processed and failed counts,
and the error or reason — and the breaker state per provider, as `failures` and
an `openUntil` that says when the primary will be tried again.

`openUntil` rather than "opened at", because it answers the question an operator
is actually asking during an outage.

**With Redis unavailable it still answers 200**, reporting every breaker as
closed. A breaker that cannot be read is the same to this endpoint as one that
is shut, which is also what the selector assumes.

Triggering a sync and clearing a breaker are PD-81's half of this surface, in
M10. This exists now because PD-43's third acceptance criterion is a statement
about an endpoint.
```

- [ ] **Step 3: Update `docs/Architecture.md` §7**

Section 7's failure-handling paragraph says "after N failures switch to fallback
provider for that batch". Replace that clause so the document matches what was
built:

```markdown
**Failure handling:** retry with backoff; five consecutive *escaped* failures —
those that survived the client's own retry budget — open a per-provider circuit
breaker for 30 minutes, and the **next** run is served by the fallback. Not the
same batch: the two providers disagree about set ids on 50 of 176 sets, so a
mid-run switch would fork the catalog rather than rescue it. A rate limit never
counts toward the breaker. Sync status, the provider that served the last run
and the breaker state surface on `GET /admin/sync/status`.
```

- [ ] **Step 4: Format, gate and commit**

```bash
pnpm -s format && pnpm -s format:check && pnpm -s typecheck && pnpm -s lint
```

```bash
git add apps/api/src/sync/README.md docs/API.md docs/Architecture.md
git commit -F - <<'EOF'
[PD-43]: document the breaker and the two rules that protect the mirror

Records why a 429 never counts, why the threshold is five consecutive rather
than five ever, and why the switch happens at the next run instead of the
current batch the ticket asked for.

Architecture section 7 said "switch for that batch". It now says what was
built, and why the ticket's wording was not.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git push origin dev
```

---

## Acceptance criteria

- [ ] **A simulated primary outage results in a completed sync via the fallback.** Task 3 Steps 5–6: the breaker is opened, a run is enqueued, and `sync_runs.provider` records `tcgdex`. Met across two runs rather than one — the spec's "This deviates from the ticket, deliberately" section is the argument, and it is repeated in the README.
- [ ] **The primary is retried automatically once the cooldown elapses.** Task 3 Step 7, by expiring the key rather than waiting 30 minutes. The selector returns `pokemontcg` with `isFallback false`.
- [ ] **Admin sync status shows which provider served the last run.** Task 4 Step 5, over HTTP, with 401 without a session and 403 for a member.

Two guarantees that are not acceptance criteria but are what make the first one
safe, and both are measured in Task 3 Step 6: a fallback run wrote **no new
set**, and left **zero** cards belonging to a set absent from the mirror.

## Out of scope

| Not here | Where |
| --- | --- |
| Admin *control* — trigger a sync, clear a breaker | PD-81, M10 |
| A breaker on the price sync path | M4 (PD-48, PD-49); the service is provider-keyed and already fits |
| Set-id translation between providers | rejected in the spec |
| Mid-run provider switching | rejected above, and documented in the README |
| Aggregating breaker counts across replicas | already works — the state is in Redis, not in memory. PD-129 is when it matters |
