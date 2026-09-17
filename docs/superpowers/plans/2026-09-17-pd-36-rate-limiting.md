# PD-36 Rate Limiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a shared, Redis-backed rate limit in front of the credential routes, the economy routes and everything else, so that abuse is bounded and the limits hold across API replicas.

**Architecture:** One hand-written `ThrottlerStorage` over the Redis client the application already owns, driven by a single Lua script so the counter and its expiry can never separate. Two enforcement points share it: `ThrottlerGuard` for `/api/v1/*`, keyed by user id and falling back to IP, and a small Express middleware for `/api/auth/*`, keyed by IP, which exists because the Better Auth handler is mounted outside the Nest router where no guard can reach it.

**Tech Stack:** NestJS 12 (ESM, `module: nodenext` — every relative import ends in `.js`), `@nestjs/throttler` 6.7.0 (CommonJS), ioredis 5.8.2, Express 5, Redis 7.4 on 6379 db 0.

**Spec:** [`docs/superpowers/specs/2026-09-17-pd-36-rate-limiting-design.md`](../specs/2026-09-17-pd-36-rate-limiting-design.md)

---

## Global Constraints

- **Work directly on `dev`.** No feature branches, no pull requests.
- **Commit subjects are `[PD-36]: short lowercase description`.** Commit bodies end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. A `feat:` or `docs:` prefix is rejected by the commit hook.
- **No automated tests in v1.** Do not add test files, test runners, test dependencies, or a CI test step. **This overrides the TDD structure the writing-plans skill normally imposes.** Every task still runs a red/green cycle — the "test" is an empirical measurement against the running stack, and a claim is not made until a command has printed the evidence.
- **ESM imports.** Relative imports inside `apps/api` carry the `.js` extension or the build fails.
- **`ttl` and `blockDuration` arrive in milliseconds. `timeToExpire` and `timeToBlockExpire` are returned in seconds.** Getting this backwards makes every window a thousand times too short, which looks like a limiter that never fires rather than like a bug.
- **The guard rejects on `isBlocked` alone.** It never compares `totalHits` to `limit`. A storage that only counts throttles nothing.
- **Only one throttler is registered with the module, named `default`.** The guard applies every registered throttler to every route, and `@SkipThrottle()` with no arguments skips only `default`. Registering `strict` and `moderate` globally would silently apply them everywhere, health probes included.
- **No schema change.** No Prisma migration. If a task seems to need one, stop — the spec is wrong.
- **`pnpm typecheck` and `pnpm lint` run from the repository root** and must pass before every commit.
- **Verified claims only.** If a measurement contradicts the spec, report the contradiction rather than adjusting the claim to fit.

### Shared shell setup

```bash
cd /m/projects/pokedrop
SCRATCH="/c/Users/MaxSt/AppData/Local/Temp/claude/M--projects-pokedrop/c71988cc-2aa7-4705-933c-b8b1e0bc6ce1/scratchpad"
PSQL="docker compose exec -T postgres psql -U pokedrop -d pokedrop -tA"
RCLI="docker compose exec -T redis redis-cli -n 0"
API="http://localhost:4000"
WEB="http://localhost:3000"
```

`stopapi` and `startapi` already exist in `$SCRATCH/env.sh` from PD-35 — `pkill` does not exist in this Git Bash, so `stopapi` kills whatever holds port 4000 via `netstat` and `taskkill`, and `startapi VAR=value …` boots with overrides and waits for the health route. Source that file rather than rewriting them:

```bash
source "$SCRATCH/env.sh"
```

`ConfigModule` loads the root `.env` with dotenv, which does not overwrite variables already in the process environment, so a variable set on the command line wins. That is what makes the configuration measurements possible.

---

## File Structure

| Path | Responsibility | Task |
| --- | --- | --- |
| `apps/api/package.json` | the `@nestjs/throttler` dependency | 1 |
| `apps/api/src/redis/cache.keys.ts` | `THROTTLE_NAMESPACE`, `throttleKeys`, and why they are not under `cache:` | 1 |
| `apps/api/src/throttle/redis-throttler.storage.ts` | the `ThrottlerStorage` implementation and its Lua script | 2 |
| `apps/api/src/config/env.schema.ts` | seven variables | 3 |
| `apps/api/src/config/app.config.ts` | the `throttle` namespace; seconds become milliseconds here | 3 |
| `apps/api/src/throttle/throttle.module.ts` | `ThrottlerModule.forRootAsync`, the tracker, the storage provider | 3 |
| `apps/api/src/throttle/index.ts` | the module's public surface | 3 |
| `apps/api/src/app.module.ts` | import the module; `ThrottlerGuard` after `SessionGuard` | 3 |
| `apps/api/src/main.ts` | `trust proxy`; mount the auth middleware before the handler | 3, 4 |
| `apps/api/src/health/health.controller.ts` | `@SkipThrottle()` | 3 |
| `apps/api/src/throttle/auth-throttle.middleware.ts` | the Express limiter for `/api/auth/*` | 4 |
| `.env.example` | the seven variables | 3 |
| `docs/API.md` | the limits, the 429 contract, what the limit does and does not stop | 5 |

---

## Task 1: The dependency, the ESM risk, and the key namespace

This task exists to retire one risk before any code depends on it. `@nestjs/throttler` ships CommonJS with no `exports` map; `apps/api` is ESM with `module: nodenext`. This project already lost time to that exact combination with `nestjs-zod` in PD-19.

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/redis/cache.keys.ts` (append after `lockKeys`)

**Interfaces:**
- Consumes: nothing.
- Produces: `THROTTLE_NAMESPACE: 'throttle'` and `throttleKeys: { counter(key: string): string; block(key: string): string }`, both imported by Task 2 from `../redis/index.js`.

---

- [ ] **Step 1: Install the package**

```bash
pnpm --filter @pokedrop/api add @nestjs/throttler@6.7.0
grep -n "throttler" apps/api/package.json
```

Expected: the dependency is listed, and pnpm reports no peer warning — its peer range accepts `@nestjs/core` and `@nestjs/common` `^12.0.0`.

- [ ] **Step 2: Prove the import works under ESM before building anything on it**

```bash
cat > apps/api/src/throttle-import-probe.ts <<'EOF'
// TEMPORARY - PD-36 ESM probe. Removed in step 4.
import { ThrottlerGuard, ThrottlerModule, ThrottlerStorage, SkipThrottle } from '@nestjs/throttler';
import type { ThrottlerStorageRecord, ThrottlerModuleOptions } from '@nestjs/throttler';

export const probe = (): string =>
  [ThrottlerGuard.name, ThrottlerModule.name, typeof ThrottlerStorage, typeof SkipThrottle].join(' ');

export type Probe = [ThrottlerStorageRecord, ThrottlerModuleOptions];
EOF
pnpm typecheck 2>&1 | tail -5
```

Expected: `Done` for both apps. A failure here means named imports do not resolve from this CommonJS package under `nodenext`, and the fix is a namespace import (`import pkg from '@nestjs/throttler'; const { ThrottlerGuard } = pkg;`) applied consistently everywhere the package is used. Report which of the two happened before continuing.

- [ ] **Step 3: Prove it also works at runtime, not only to the typechecker**

Type resolution and runtime resolution are different mechanisms, and CommonJS-from-ESM can pass one and fail the other.

```bash
pnpm --filter @pokedrop/api build 2>&1 | tail -2
node --input-type=module -e "
  const m = await import('@nestjs/throttler');
  console.log('ThrottlerGuard:', typeof m.ThrottlerGuard);
  console.log('ThrottlerModule:', typeof m.ThrottlerModule);
  console.log('ThrottlerStorage:', typeof m.ThrottlerStorage);
  console.log('SkipThrottle:', typeof m.SkipThrottle);
  console.log('normalizeIp:', typeof m.normalizeIp);
"
```

Expected: `function`, `function`, `symbol`, `function`, `function`. Any `undefined` means that name is not reachable as a named export and the namespace-import fallback from Step 2 applies.

- [ ] **Step 4: Remove the probe**

```bash
rm apps/api/src/throttle-import-probe.ts
git status --porcelain
```

Expected: `apps/api/src/throttle-import-probe.ts` is gone; only `package.json` and the lockfile are modified.

- [ ] **Step 5: Add the throttle key namespace**

Append to `apps/api/src/redis/cache.keys.ts`, after the `lockKeys` block:

```ts
/**
 * Also not a cache key, and for the same reason the lock above is not.
 *
 * CacheService.invalidate deletes by glob under `cache:`. A rate-limit counter
 * living there would be reset by every routine cache flush — a catalog sync
 * would hand an attacker a fresh budget, repeatedly and silently.
 *
 * The storage prepends these itself, so both enforcement points — the Nest
 * guard and the Express middleware in front of the auth handler — land in the
 * same namespace without either of them knowing the prefix.
 */
export const THROTTLE_NAMESPACE = 'throttle';

export const throttleKeys = {
  counter: (key: string) => `${THROTTLE_NAMESPACE}:${key}`,
  /** Separate key, so that clearing a block does not also clear the count. */
  block: (key: string) => `${THROTTLE_NAMESPACE}:block:${key}`,
} as const;
```

- [ ] **Step 6: Export them**

In `apps/api/src/redis/index.ts`, extend the first export:

```ts
export {
  CACHE_NAMESPACE,
  THROTTLE_NAMESPACE,
  cacheKeys,
  cachePatterns,
  lockKeys,
  throttleKeys,
} from './cache.keys.js';
```

- [ ] **Step 7: Confirm the namespace cannot be reached by a cache invalidation**

`cachePatterns.everything` is the widest glob `CacheService.invalidate` accepts. Prove it does not match a throttle key.

```bash
source "$SCRATCH/env.sh"
$RCLI SET 'throttle:probe' 1 EX 60
$RCLI SET 'cache:probe' 1 EX 60
echo -n "keys matching the widest cache pattern: "
$RCLI --scan --pattern 'cache:*' | tr '\n' ' '
echo
echo -n "throttle key still present: "
$RCLI EXISTS 'throttle:probe'
$RCLI DEL 'throttle:probe' 'cache:probe'
```

Expected: the scan lists `cache:probe` and not `throttle:probe`; `EXISTS` returns `1`.

- [ ] **Step 8: Lint and commit**

```bash
pnpm typecheck && pnpm lint
git add apps/api/package.json pnpm-lock.yaml apps/api/src/redis/cache.keys.ts apps/api/src/redis/index.ts
git commit -F - <<'EOF'
[PD-36]: add the throttler dependency and its own key namespace

Rate-limit counters get `throttle:`, not `cache:`. CacheService
invalidates by glob under `cache:`, so a counter living there would be
reset by every routine flush -- a catalog sync handing an attacker a
fresh budget, silently and on a schedule.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 2: The Redis storage

**Files:**
- Create: `apps/api/src/throttle/redis-throttler.storage.ts`

**Interfaces:**
- Consumes: `throttleKeys` from `../redis/index.js`; `RedisService` from `../redis/index.js`.
- Produces: `class RedisThrottlerStorage implements ThrottlerStorage`, constructor `(redis: RedisService)`, method `increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord>`. Task 3 provides it under the `ThrottlerStorage` token; Task 4 calls `increment` directly.

---

- [ ] **Step 1: Write the storage**

Create `apps/api/src/throttle/redis-throttler.storage.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { RedisService, throttleKeys } from '../redis/index.js';

/**
 * Counter and block in one round trip, atomically.
 *
 * INCR followed by a separate PEXPIRE has a window between the two commands. A
 * process that dies there, or a failover, leaves a counter with no expiry — and
 * a counter that never resets is a permanent ban with nothing to explain it.
 * The `ttl < 0` branch also repairs such a key if one is ever found, so a
 * counter orphaned by some other means heals on its next hit instead of
 * lasting forever.
 *
 * Returns: { totalHits, ttlMilliseconds, isBlocked, blockTtlMilliseconds }.
 */
const THROTTLE_SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  return { tonumber(ARGV[2]) + 1, 0, 1, blockTtl }
end

local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end

if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  redis.call('DEL', KEYS[1])
  return { hits, 0, 1, tonumber(ARGV[3]) }
end

return { hits, ttl, 0, 0 }
`;

const COMMAND = 'pokedropThrottle';

type ThrottleResult = [totalHits: number, ttlMs: number, blocked: number, blockTtlMs: number];

/**
 * ioredis attaches custom commands to the client at runtime, so the type has to
 * be widened at the call site. A local intersection rather than a global
 * `declare module` for the same reason request-auth.ts avoids one: a global
 * augmentation is owned by whoever declares it first and collides with everyone
 * after.
 */
type RedisWithThrottle = Redis & {
  [COMMAND]: (
    counterKey: string,
    blockKey: string,
    ttlMs: string,
    limit: string,
    blockMs: string,
  ) => Promise<ThrottleResult>;
};

const MS_PER_SECOND = 1000;

/**
 * The throttler's own units are asymmetric: `ttl` and `blockDuration` arrive in
 * milliseconds, while `timeToExpire` and `timeToBlockExpire` are read as
 * seconds. Every conversion happens in this file so no caller has to remember.
 */
const toSeconds = (milliseconds: number): number => Math.ceil(milliseconds / MS_PER_SECOND);

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  private readonly client: RedisWithThrottle;

  constructor(redis: RedisService) {
    // defineCommand registers the script once and uses EVALSHA per call, so the
    // script body is not resent on every request.
    redis.client.defineCommand(COMMAND, { numberOfKeys: 2, lua: THROTTLE_SCRIPT });
    this.client = redis.client as RedisWithThrottle;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const namespaced = `${throttlerName}:${key}`;

    try {
      const [totalHits, ttlMs, blocked, blockTtlMs] = await this.client[COMMAND](
        throttleKeys.counter(namespaced),
        throttleKeys.block(namespaced),
        String(ttl),
        String(limit),
        String(blockDuration),
      );

      return {
        totalHits,
        timeToExpire: toSeconds(ttlMs),
        isBlocked: blocked === 1,
        timeToBlockExpire: toSeconds(blockTtlMs),
      };
    } catch (error) {
      // Fail open, deliberately. A limiter is an abuse mitigation, not an access
      // control — SessionGuard and RolesGuard read Postgres and are unaffected.
      // Failing closed would make Redis a single point of failure for the whole
      // API, so a brief cache-tier blip would take down sign-in, pack opening
      // and trading at once. CacheService made the same call for the same
      // reason. The cost is real and is documented: while Redis is down there
      // are no limits.
      this.logger.warn(
        `Rate limit check failed, allowing the request: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return {
        totalHits: 1,
        timeToExpire: toSeconds(ttl),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }
}
```

- [ ] **Step 2: Build, then drive the storage directly**

No route uses it yet, so exercise it as a library. This is the whole red/green cycle for this task.

```bash
source "$SCRATCH/env.sh"
pnpm typecheck && pnpm --filter @pokedrop/api build 2>&1 | tail -2

cat > "$SCRATCH/storage-probe.mjs" <<'EOF'
import { Redis } from 'ioredis';
import { RedisThrottlerStorage } from '/m/projects/pokedrop/apps/api/dist/throttle/redis-throttler.storage.js';

const client = new Redis('redis://localhost:6379', { db: 0 });
// The storage only ever touches `.client`, so a stub standing in for
// RedisService is enough to drive it without booting Nest.
const storage = new RedisThrottlerStorage({ client });

const show = (label, r) => console.log(label, JSON.stringify(r));

await client.del('throttle:probe:k', 'throttle:block:probe:k');

// limit 3, window 10s, block 10s
for (let i = 1; i <= 5; i += 1) {
  show(`hit ${i}`, await storage.increment('k', 10_000, 3, 10_000, 'probe'));
}

console.log('counter PTTL after block:', await client.pttl('throttle:probe:k'));
console.log('block   PTTL after block:', await client.pttl('throttle:block:probe:k'));

await client.del('throttle:probe:k', 'throttle:block:probe:k');
show('first hit of a fresh window', await storage.increment('k', 10_000, 3, 10_000, 'probe'));
console.log('TTL on the very first hit:', await client.pttl('throttle:probe:k'));

await client.quit();
EOF
node "$SCRATCH/storage-probe.mjs"
```

Expected, precisely:

```
hit 1 {"totalHits":1,"timeToExpire":10,"isBlocked":false,"timeToBlockExpire":0}
hit 2 {"totalHits":2,"timeToExpire":10,"isBlocked":false,"timeToBlockExpire":0}
hit 3 {"totalHits":3,"timeToExpire":10,"isBlocked":false,"timeToBlockExpire":0}
hit 4 {"totalHits":4,"timeToExpire":0,"isBlocked":true,"timeToBlockExpire":10}
hit 5 {"totalHits":4,"timeToExpire":0,"isBlocked":true,"timeToBlockExpire":10}
```

Three points to check rather than tick past. Hit 4 is the first refusal, so a limit of 3 permits exactly 3 — off by one here is off by one in production. Hit 5 reports `totalHits` 4 and not 5, which is the block holding a fixed duration instead of extending itself on every further request. And the last two lines: `counter PTTL after block` is `-2` (the counter was deleted) while `block PTTL` is positive.

- [ ] **Step 3: Confirm the counter is never left without a TTL**

This is the failure the Lua script exists to prevent, and it is invisible when it happens.

```bash
echo "TTL on the very first hit must not be -1:"
node "$SCRATCH/storage-probe.mjs" | tail -1
```

Expected: a positive number close to `10000`. `-1` means a key with no expiry — a permanent ban — and `-2` means the key vanished.

- [ ] **Step 4: Confirm fail-open**

```bash
source "$SCRATCH/env.sh"
cat > "$SCRATCH/failopen-probe.mjs" <<'EOF'
import { Redis } from 'ioredis';
import { RedisThrottlerStorage } from '/m/projects/pokedrop/apps/api/dist/throttle/redis-throttler.storage.js';

// A port nothing listens on: every command fails the way a dead Redis does.
const client = new Redis('redis://localhost:6399', {
  db: 0,
  lazyConnect: true,
  maxRetriesPerRequest: 0,
  retryStrategy: () => null,
});
client.on('error', () => {});
const storage = new RedisThrottlerStorage({ client });

for (let i = 1; i <= 3; i += 1) {
  console.log(`hit ${i}`, JSON.stringify(await storage.increment('k', 10_000, 1, 10_000, 'probe')));
}
client.disconnect();
EOF
node "$SCRATCH/failopen-probe.mjs"
```

Expected: three identical records, each `{"totalHits":1,"timeToExpire":10,"isBlocked":false,"timeToBlockExpire":0}`, with a `Rate limit check failed` warning logged before each. A limit of 1 would normally refuse the second — that it does not is the fail-open behaviour, measured rather than asserted.

- [ ] **Step 5: Clean up and commit**

```bash
rm -f "$SCRATCH/storage-probe.mjs" "$SCRATCH/failopen-probe.mjs"
pnpm lint
git add apps/api/src/throttle/redis-throttler.storage.ts
git commit -F - <<'EOF'
[PD-36]: add a redis throttler storage on the existing client

The counter and its expiry are set by one Lua script. INCR followed by a
separate PEXPIRE leaves a window where a dying process or a failover
strands a counter with no TTL, and a counter that never resets is a
permanent ban with nothing to explain it.

Fails open on a Redis error: a limiter is an abuse mitigation, not an
access control, and failing closed would make Redis a single point of
failure for the whole API.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 3: Configuration, the guard, and `trust proxy`

**Files:**
- Modify: `apps/api/src/config/env.schema.ts`
- Modify: `apps/api/src/config/app.config.ts` (after the `queue` namespace)
- Create: `apps/api/src/throttle/throttle.module.ts`
- Create: `apps/api/src/throttle/index.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/health/health.controller.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `RedisThrottlerStorage` from Task 2.
- Produces: `config.throttle.{ defaultLimit, defaultWindowMs, authLimit, authWindowMs, moderateLimit, moderateWindowMs }` and `config.app.trustProxyHops`, all read by Task 4; `ThrottleModule` exported from `./throttle/index.js`.

---

- [ ] **Step 1: Add the variables**

In `apps/api/src/config/env.schema.ts`, after the `QUEUE_CONCURRENCY` entry and before the closing `})`:

```ts
    // How many proxies sit in front of this process. Express uses it to decide
    // which entry of X-Forwarded-For is the real client.
    //
    // 0 is correct for direct exposure and for local development. Behind one
    // load balancer it is 1. Never `true`: trusting every proxy lets a client
    // send its own X-Forwarded-For and therefore choose its own rate-limit key,
    // which both evades its limit and lets it exhaust somebody else's.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

    // Windows are seconds here and milliseconds in buildAppConfig. The
    // throttler wants milliseconds; no .env file should contain 900000.
    THROTTLE_DEFAULT_LIMIT: z.coerce.number().int().min(1).default(100),
    THROTTLE_DEFAULT_WINDOW: z.coerce.number().int().min(1).default(60),

    // Sign-in, sign-up and the reset routes. Ten attempts a quarter of an hour
    // is generous for a person and ruinous for a script walking a list.
    THROTTLE_AUTH_LIMIT: z.coerce.number().int().min(1).default(10),
    THROTTLE_AUTH_WINDOW: z.coerce.number().int().min(1).default(900),

    // Pack opening and trade creation, applied when those routes exist.
    THROTTLE_MODERATE_LIMIT: z.coerce.number().int().min(1).default(30),
    THROTTLE_MODERATE_WINDOW: z.coerce.number().int().min(1).default(60),
```

- [ ] **Step 2: Expose them typed, converting seconds to milliseconds once**

In `apps/api/src/config/app.config.ts`, add `trustProxyHops` to the `app` namespace, immediately after `corsOrigins`:

```ts
      trustProxyHops: env.TRUST_PROXY_HOPS,
```

and add a `throttle` namespace after `queue`:

```ts
    throttle: {
      /**
       * Milliseconds, converted here and only here. The throttler takes
       * milliseconds for a window but reports the remainder in seconds, so the
       * asymmetry is worth confining to two files: this one and
       * redis-throttler.storage.ts.
       */
      defaultLimit: env.THROTTLE_DEFAULT_LIMIT,
      defaultWindowMs: env.THROTTLE_DEFAULT_WINDOW * 1000,
      authLimit: env.THROTTLE_AUTH_LIMIT,
      authWindowMs: env.THROTTLE_AUTH_WINDOW * 1000,
      moderateLimit: env.THROTTLE_MODERATE_LIMIT,
      moderateWindowMs: env.THROTTLE_MODERATE_WINDOW * 1000,
    },
```

- [ ] **Step 3: Write the module**

Create `apps/api/src/throttle/throttle.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerStorage, normalizeIp } from '@nestjs/throttler';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { RedisService } from '../redis/index.js';
import { getAuthContext } from '../common/request-auth.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

/**
 * Exactly one throttler is registered, and it is named `default`.
 *
 * ThrottlerGuard applies every registered throttler to every route, and
 * `@SkipThrottle()` with no arguments skips only the one called `default`.
 * Registering `strict` and `moderate` here would apply them to all routes,
 * health probes included, and the decorator would not lift them.
 *
 * So the other two policies live elsewhere: `strict` is enforced by the Express
 * middleware in front of the auth handler, and `moderate` is applied per route
 * with `@Throttle({ default: { limit, ttl } })` when pack-open and trade
 * creation are built.
 */
@Global()
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG, RedisService],
      useFactory: (config: AppConfig, redis: RedisService) => ({
        storage: new RedisThrottlerStorage(redis),
        throttlers: [
          {
            name: 'default',
            limit: config.throttle.defaultLimit,
            ttl: config.throttle.defaultWindowMs,
          },
        ],
        /**
         * The authenticated caller, falling back to the address.
         *
         * IP alone would punish everyone behind one corporate NAT for one
         * user's behaviour. normalizeIp groups an IPv6 client by subnet rather
         * than by address, so rotating within an allocation does not reset the
         * count.
         */
        /**
         * Overridden so both halves of the API answer a 429 identically. The
         * library's default is "ThrottlerException: Too Many Requests", which
         * names its own class and would differ from the Express middleware's
         * body for the very same condition.
         */
        errorMessage: 'Too many requests',
        getTracker: (req: Record<string, unknown>) => {
          const user = getAuthContext(req as unknown as Request)?.user;
          return user ? `user:${user.id}` : `ip:${normalizeIp((req as Request).ip)}`;
        },
      }),
    }),
  ],
  exports: [ThrottlerModule],
})
export class ThrottleModule {}

export { ThrottlerStorage };
```

- [ ] **Step 4: Write the barrel**

Create `apps/api/src/throttle/index.ts`:

```ts
export { RedisThrottlerStorage } from './redis-throttler.storage.js';
export { ThrottleModule } from './throttle.module.js';
```

- [ ] **Step 5: Register the guard after `SessionGuard`**

In `apps/api/src/app.module.ts`, add the imports:

```ts
import { ThrottlerGuard } from '@nestjs/throttler';
import { ThrottleModule } from './throttle/index.js';
```

Add `ThrottleModule` to the `imports` array, after `RedisModule`. Then replace the guard block:

```ts
    // Order is load-bearing: global guards run in the order they are provided.
    // CsrfGuard is first so a forged request is refused on a header check
    // rather than after SessionGuard has spent a database round-trip resolving
    // the session it was trying to abuse. ThrottlerGuard comes after
    // SessionGuard because it keys on the authenticated user, who is not on the
    // request until SessionGuard puts them there — the cost is one lookup spent
    // on a flood that carries a valid cookie, and SessionGuard does no lookup
    // at all when there is no cookie. RolesGuard is last because it reads the
    // caller SessionGuard resolved; reversed, it sees nobody and rejects
    // everything.
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
```

- [ ] **Step 6: Set `trust proxy`**

In `apps/api/src/main.ts`, immediately after `const config = app.get<AppConfig>(APP_CONFIG);`:

```ts
  // Decides what req.ip is, and therefore what the rate limiter keys on.
  //
  // Unset behind a proxy, every request appears to come from the proxy: one key
  // for every user, and the first few requests exhaust the limit for everybody.
  // Set to `true`, any client can send its own X-Forwarded-For and pick its own
  // key. A hop count is the only answer that is wrong in neither direction, and
  // it differs per environment.
  app.set('trust proxy', config.app.trustProxyHops);
```

- [ ] **Step 7: Exempt the health probes**

In `apps/api/src/health/health.controller.ts`, add to the import from `@nestjs/throttler`:

```ts
import { SkipThrottle } from '@nestjs/throttler';
```

and add the decorator to the class, directly above `@Controller('health')`:

```ts
/**
 * Exempt: an orchestrator polls these every few seconds from one address, so a
 * per-IP limit throttles them by design. A 429 from a liveness probe reads as a
 * dead process — the orchestrator restarts a healthy instance, then does it
 * again.
 */
@SkipThrottle()
```

- [ ] **Step 8: Document the variables**

Append to `.env.example`, after the `QUEUE_CONCURRENCY` line:

```bash

# ─── Rate limiting ───────────────────────────────────────────────────────────
# How many proxies sit in front of the API. 0 for direct exposure and local
# development; 1 behind a single load balancer. Never set this to a value
# higher than the real hop count: the extra hops are read from a header the
# client controls, which lets it choose its own rate-limit key.
TRUST_PROXY_HOPS=0

# Every route that is not a health probe. Windows are in SECONDS.
THROTTLE_DEFAULT_LIMIT=100
THROTTLE_DEFAULT_WINDOW=60

# Sign-in, sign-up and the password reset routes. This is the control that
# blunts account enumeration: one duplicate registration reveals one address,
# and this is what stops someone walking a list of a million.
THROTTLE_AUTH_LIMIT=10
THROTTLE_AUTH_WINDOW=900

# Pack opening and trade creation, applied when those routes exist.
THROTTLE_MODERATE_LIMIT=30
THROTTLE_MODERATE_WINDOW=60
```

- [ ] **Step 9: Measure the baseline — a 429 that is the standard envelope**

`GET /api/v1` is `AppController.getHello`, the only Nest route that is neither a health probe nor yet unbuilt. A limit of 3 keeps the loop short and is also the evidence that the value comes from configuration.

```bash
source "$SCRATCH/env.sh"
pnpm typecheck && pnpm --filter @pokedrop/api build 2>&1 | tail -2
startapi THROTTLE_DEFAULT_LIMIT=3 THROTTLE_DEFAULT_WINDOW=60
$RCLI --scan --pattern 'throttle:*' | xargs -r $RCLI DEL > /dev/null

for i in 1 2 3 4 5; do
  printf 'request %d: ' "$i"
  curl -s -o /dev/null -w '%{http_code}\n' "$API/api/v1"
done
echo "--- body and headers of the refusal ---"
curl -si "$API/api/v1" | grep -iE '^(HTTP|retry-after|x-ratelimit)' 
curl -s "$API/api/v1"
echo
```

Expected: `200 200 200 429 429`, then `HTTP/1.1 429`, a `Retry-After` header, and this body:

```json
{"statusCode":429,"error":"Too Many Requests","message":"Too many requests","requestId":"…"}
```

`error` is `Too Many Requests` because `buildErrorEnvelope` derives it from `HttpStatus`'s reverse mapping rather than from the exception's class name. `message` is `Too many requests` because `errorMessage` was overridden in Step 3; without that override the library would say `ThrottlerException: Too Many Requests`, naming its own class to anyone probing the API and disagreeing with the Express half. Task 4 Step 6 checks the two bodies match.

- [ ] **Step 10: Confirm the limit is configuration, not a constant**

```bash
source "$SCRATCH/env.sh"
startapi THROTTLE_DEFAULT_LIMIT=1 THROTTLE_DEFAULT_WINDOW=60
$RCLI --scan --pattern 'throttle:*' | xargs -r $RCLI DEL > /dev/null
for i in 1 2; do printf 'request %d: ' "$i"; curl -s -o /dev/null -w '%{http_code}\n' "$API/api/v1"; done
```

Expected: `200 429`. The threshold moved because the variable moved — this is AC3.

- [ ] **Step 11: Confirm health probes are exempt**

```bash
source "$SCRATCH/env.sh"
$RCLI --scan --pattern 'throttle:*' | xargs -r $RCLI DEL > /dev/null
echo -n "distinct status codes over 50 liveness probes: "
for i in $(seq 1 50); do curl -s -o /dev/null -w '%{http_code}\n' "$API/api/v1/health/live"; done | sort -u | tr '\n' ' '
echo
```

Expected: `200` alone. With `THROTTLE_DEFAULT_LIMIT=1` still in force, anything else means `@SkipThrottle()` is not taking effect — and in production that is an orchestrator restart loop against a healthy process.

- [ ] **Step 12: Confirm the key follows the user, not the address**

```bash
source "$SCRATCH/env.sh"
startapi THROTTLE_DEFAULT_LIMIT=2 THROTTLE_DEFAULT_WINDOW=60
$RCLI --scan --pattern 'throttle:*' | xargs -r $RCLI DEL > /dev/null
$PSQL -c "delete from users where email like 'pd36-%';" > /dev/null
rm -f "$SCRATCH"/pd36-[ab].txt

curl -s -c "$SCRATCH/pd36-a.txt" -X POST "$API/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd36-a@example.com","password":"correct-horse-battery","name":"PD36 A"}' > /dev/null
curl -s -c "$SCRATCH/pd36-b.txt" -X POST "$API/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd36-b@example.com","password":"correct-horse-battery","name":"PD36 B"}' > /dev/null

echo "--- user A exhausts their own budget ---"
for i in 1 2 3; do printf '  A request %d: ' "$i"; curl -s -o /dev/null -w '%{http_code}\n' -b "$SCRATCH/pd36-a.txt" "$API/api/v1"; done
echo "--- user B, same address, untouched ---"
printf '  B request 1: '; curl -s -o /dev/null -w '%{http_code}\n' -b "$SCRATCH/pd36-b.txt" "$API/api/v1"
echo "--- anonymous, same address, its own budget ---"
printf '  anon  request 1: '; curl -s -o /dev/null -w '%{http_code}\n' "$API/api/v1"
```

Expected: `200 200 429` for A, then `200` for B, then `200` for the anonymous caller. All three share one source address, so three different outcomes is the proof that the tracker is the user and not the address.

- [ ] **Step 13: Confirm `TRUST_PROXY_HOPS` decides which address is used**

```bash
source "$SCRATCH/env.sh"
startapi THROTTLE_DEFAULT_LIMIT=1 THROTTLE_DEFAULT_WINDOW=60 TRUST_PROXY_HOPS=0
$RCLI --scan --pattern 'throttle:*' | xargs -r $RCLI DEL > /dev/null
echo "hops=0, header ignored (two different forged addresses must still collide):"
printf '  first : '; curl -s -o /dev/null -w '%{http_code}\n' -H 'X-Forwarded-For: 203.0.113.1' "$API/api/v1"
printf '  second: '; curl -s -o /dev/null -w '%{http_code}\n' -H 'X-Forwarded-For: 203.0.113.2' "$API/api/v1"

startapi THROTTLE_DEFAULT_LIMIT=1 THROTTLE_DEFAULT_WINDOW=60 TRUST_PROXY_HOPS=1
$RCLI --scan --pattern 'throttle:*' | xargs -r $RCLI DEL > /dev/null
echo "hops=1, header trusted (the same two addresses must now be separate keys):"
printf '  first : '; curl -s -o /dev/null -w '%{http_code}\n' -H 'X-Forwarded-For: 203.0.113.1' "$API/api/v1"
printf '  second: '; curl -s -o /dev/null -w '%{http_code}\n' -H 'X-Forwarded-For: 203.0.113.2' "$API/api/v1"
```

Expected: with `hops=0`, `200` then `429` — the header was ignored and both requests shared one key. With `hops=1`, `200` then `200` — each forged address got its own bucket.

The second result is the reason the variable must never be set higher than the real hop count. It is not a bug; it is the mechanism, and it is what a client would exploit to evade its own limit.

- [ ] **Step 14: Lint and commit**

```bash
pnpm lint
git add apps/api/src/config/env.schema.ts apps/api/src/config/app.config.ts \
        apps/api/src/throttle/throttle.module.ts apps/api/src/throttle/index.ts \
        apps/api/src/app.module.ts apps/api/src/main.ts \
        apps/api/src/health/health.controller.ts .env.example
git commit -F - <<'EOF'
[PD-36]: throttle the api's own routes and set trust proxy

One throttler is registered, named default, because the guard applies
every registered throttler to every route and @SkipThrottle() lifts only
that one -- registering the stricter policies globally would have limited
the health probes and the decorator would not have helped.

trust proxy was never set. Unset behind a proxy every request shares one
key and the first few exhaust the limit for everyone; set to true a
client picks its own key. It is a hop count from config, measured both
ways.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 4: The Express limiter for `/api/auth/*`

**Files:**
- Create: `apps/api/src/throttle/auth-throttle.middleware.ts`
- Modify: `apps/api/src/throttle/index.ts`
- Modify: `apps/api/src/main.ts`

**Interfaces:**
- Consumes: `RedisThrottlerStorage` (Task 2), `config.throttle.*` (Task 3), `buildErrorEnvelope` from `../common/errors/error-envelope.js`, `getRequestId` from `../common/request-id.js`, `AUTH_BASE_PATH` from `../auth/index.js`.
- Produces: `createAuthThrottleMiddleware(storage: RedisThrottlerStorage, config: AppConfig): RequestHandler`.

---

- [ ] **Step 1: Measure the gap — credential routes are unlimited**

```bash
source "$SCRATCH/env.sh"
startapi
$RCLI --scan --pattern 'throttle:*' | xargs -r $RCLI DEL > /dev/null
echo "20 wrong-password sign-ins, BEFORE the middleware:"
for i in $(seq 1 20); do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/api/auth/sign-in/email" \
    -H 'Content-Type: application/json' -H "Origin: $WEB" \
    -d '{"email":"pd36-a@example.com","password":"wrong-password-here"}'
done | sort | uniq -c
```

Expected: `20` responses of `401`. Not one 429 — the guard cannot see these routes.

- [ ] **Step 2: Write the middleware**

Create `apps/api/src/throttle/auth-throttle.middleware.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AUTH_BASE_PATH } from '../auth/index.js';
import { buildErrorEnvelope } from '../common/errors/error-envelope.js';
import { getRequestId } from '../common/request-id.js';
import type { AppConfig } from '../config/index.js';
import type { RedisThrottlerStorage } from './redis-throttler.storage.js';

/**
 * The routes that spend a password, create an account, or mail a reset link.
 *
 * An explicit list rather than the whole prefix, because GET
 * /api/auth/get-session is called by the frontend on every page load. A strict
 * limit over all of /api/auth/* would throttle that first and hardest, and the
 * application would appear to sign people out at random.
 */
const CREDENTIAL_PATHS = new Set([
  `${AUTH_BASE_PATH}/sign-in/email`,
  `${AUTH_BASE_PATH}/sign-up/email`,
  `${AUTH_BASE_PATH}/reset-password`,
  `${AUTH_BASE_PATH}/request-password-reset`,
]);

/**
 * The same text ThrottleModule passes as `errorMessage`, so a 429 reads
 * identically whichever half of the API produced it.
 */
const TOO_MANY_REQUESTS_MESSAGE = 'Too many requests';

/**
 * Rate limiting for the Better Auth handler, which `main.ts` mounts on the
 * Express instance outside the Nest router — where no guard can reach it.
 *
 * Keyed by address and path, never by the email in the body. Two reasons, and
 * the second makes the first moot: a limiter that behaves differently for
 * addresses that exist would hand back exactly the oracle the provider avoids
 * by hashing a dummy password (PD-30 measured 81.7 ms against 80.0 ms), and the
 * handler needs the raw body, so this runs before any parser and has no body to
 * read.
 */
export function createAuthThrottleMiddleware(
  storage: RedisThrottlerStorage,
  config: AppConfig,
): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    const isCredentialPath = CREDENTIAL_PATHS.has(request.path);

    const limit = isCredentialPath ? config.throttle.authLimit : config.throttle.defaultLimit;
    const windowMs = isCredentialPath
      ? config.throttle.authWindowMs
      : config.throttle.defaultWindowMs;

    // `auth` rather than a throttler name the guard also uses, so that a
    // credential attempt and a call to the same-named Nest route cannot share a
    // bucket.
    const key = `${request.ip ?? 'unknown'}:${request.path}`;

    void storage
      .increment(key, windowMs, limit, windowMs, 'auth')
      .then((record) => {
        if (!record.isBlocked) {
          response.setHeader('X-RateLimit-Limit', limit);
          response.setHeader('X-RateLimit-Remaining', Math.max(0, limit - record.totalHits));
          response.setHeader('X-RateLimit-Reset', record.timeToExpire);
          next();
          return;
        }

        response.setHeader('Retry-After', record.timeToBlockExpire);

        // The same helper the Nest filter uses, so the two halves cannot drift
        // into two different 429 bodies.
        //
        // It must be given a real HttpException, not a plain object shaped like
        // one: buildErrorEnvelope reads the status via `instanceof
        // HttpException` and falls back to 500 "Internal server error" for
        // anything else. A rate-limited caller being told the server broke is
        // both wrong and alarming.
        const envelope = buildErrorEnvelope(
          new HttpException(TOO_MANY_REQUESTS_MESSAGE, HttpStatus.TOO_MANY_REQUESTS),
          getRequestId(request) ?? randomUUID(),
        );

        response.status(HttpStatus.TOO_MANY_REQUESTS).json(envelope);
      })
      .catch(() => {
        // The storage already fails open and logs; this is the guard against a
        // programming error in the branch above hanging the request forever.
        next();
      });
  };
}
```

- [ ] **Step 3: Export it**

In `apps/api/src/throttle/index.ts`:

```ts
export { createAuthThrottleMiddleware } from './auth-throttle.middleware.js';
export { RedisThrottlerStorage } from './redis-throttler.storage.js';
export { ThrottleModule } from './throttle.module.js';
```

- [ ] **Step 4: Mount it in front of the handler**

In `apps/api/src/main.ts`, add the import:

```ts
import { RedisThrottlerStorage, createAuthThrottleMiddleware } from './throttle/index.js';
```

Then, in the block that registers the auth route, insert the middleware **before** `toNodeHandler`, on the same route pattern:

```ts
  const auth = app.get<AuthInstance>(AUTH_INSTANCE);
  const authRoute = `${AUTH_BASE_PATH}/*splat`;
  const expressApp = app.getHttpAdapter().getInstance();

  // Registered on the same pattern and before the handler, so Express runs it
  // first and it can refuse without the handler ever seeing the request.
  // Deliberately not app.use(AUTH_BASE_PATH, …): mounting strips the prefix
  // from req.url, and this middleware routes on the full path.
  expressApp.all(
    authRoute,
    createAuthThrottleMiddleware(app.get(RedisThrottlerStorage), config),
  );
  expressApp.all(authRoute, toNodeHandler(auth));
```

`RedisThrottlerStorage` must be resolvable from the container for `app.get` to work, so add it to `ThrottleModule`'s providers and exports in `apps/api/src/throttle/throttle.module.ts`:

```ts
  providers: [RedisThrottlerStorage],
  exports: [ThrottlerModule, RedisThrottlerStorage],
```

- [ ] **Step 5: Confirm 429 and not 401 — this is AC2**

```bash
source "$SCRATCH/env.sh"
pnpm typecheck && pnpm --filter @pokedrop/api build 2>&1 | tail -2
startapi THROTTLE_AUTH_LIMIT=5 THROTTLE_AUTH_WINDOW=900
$RCLI --scan --pattern 'throttle:*' | xargs -r $RCLI DEL > /dev/null

echo "10 wrong-password sign-ins:"
for i in $(seq 1 10); do
  printf '  attempt %2d: ' "$i"
  curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/api/auth/sign-in/email" \
    -H 'Content-Type: application/json' -H "Origin: $WEB" \
    -d '{"email":"pd36-a@example.com","password":"wrong-password-here"}'
done
```

Expected: five `401`, then five `429`. The transition is the criterion: a caller who has exhausted the limit is told they are rate-limited, not that their password is wrong.

- [ ] **Step 6: Confirm the 429 body matches the Nest half**

```bash
curl -si -X POST "$API/api/auth/sign-in/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd36-a@example.com","password":"wrong-password-here"}' \
  | grep -iE '^(HTTP|retry-after|x-ratelimit)'
curl -s -X POST "$API/api/auth/sign-in/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd36-a@example.com","password":"wrong-password-here"}'
echo
```

Expected: `HTTP/1.1 429`, a `Retry-After` header, and a body byte-identical to the Nest-side 429 from Task 3 Step 9 apart from `requestId`:

```json
{"statusCode":429,"error":"Too Many Requests","message":"Too many requests","requestId":"…"}
```

If `error` reads `Internal Server Error` here, `buildErrorEnvelope` was handed something that is not an `HttpException` and fell back to 500.

- [ ] **Step 7: Confirm `get-session` survives — the trap this design exists to avoid**

```bash
source "$SCRATCH/env.sh"
$RCLI --scan --pattern 'throttle:*' | xargs -r $RCLI DEL > /dev/null
rm -f "$SCRATCH/pd36-a.txt"
curl -s -c "$SCRATCH/pd36-a.txt" -X POST "$API/api/auth/sign-in/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd36-a@example.com","password":"correct-horse-battery"}' > /dev/null
echo -n "distinct status codes over 40 get-session calls: "
for i in $(seq 1 40); do
  curl -s -o /dev/null -w '%{http_code}\n' -b "$SCRATCH/pd36-a.txt" "$API/api/auth/get-session" -H "Origin: $WEB"
done | sort -u | tr '\n' ' '
echo
```

Expected: `200` alone, with `THROTTLE_AUTH_LIMIT=5` still in force. Forty calls is eight times the strict limit; if the strict policy were applied to the whole prefix this would be a wall of 429s and the frontend would look like it was logging people out.

- [ ] **Step 8: Confirm sign-up is limited too**

Sign-up is the enumeration control, so it must be in the strict set rather than only sign-in.

```bash
source "$SCRATCH/env.sh"
$RCLI --scan --pattern 'throttle:*' | xargs -r $RCLI DEL > /dev/null
echo "8 sign-ups with fresh addresses:"
for i in $(seq 1 8); do
  printf '  attempt %d: ' "$i"
  curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/api/auth/sign-up/email" \
    -H 'Content-Type: application/json' -H "Origin: $WEB" \
    -d "{\"email\":\"pd36-walk-$i@example.com\",\"password\":\"correct-horse-battery\",\"name\":\"W$i\"}"
done
$PSQL -c "delete from users where email like 'pd36-%';" > /dev/null
```

Expected: five successes (`200`), then `429`. The walk stops at the configured limit.

- [ ] **Step 9: Lint and commit**

```bash
pnpm lint
git add apps/api/src/throttle/auth-throttle.middleware.ts apps/api/src/throttle/index.ts \
        apps/api/src/throttle/throttle.module.ts apps/api/src/main.ts
git commit -F - <<'EOF'
[PD-36]: rate limit the credential routes at the express layer

The Better Auth handler is mounted outside the Nest router, so the global
guard never sees the routes most worth limiting. This middleware sits on
the same route pattern, ahead of the handler, and shares the guard's Redis
storage so both halves use one algorithm and one namespace.

It limits an explicit list of credential paths rather than the whole
prefix: GET /api/auth/get-session is called on every page load, and a
strict limit over all of /api/auth/* would throttle that first.

Keyed by address and path, never by the email in the body -- a limiter
that treated known and unknown accounts differently would hand back the
oracle the provider avoids by hashing a dummy password.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 5: Cross-instance proof, documentation, and close-out

**Files:**
- Modify: `docs/API.md`

**Interfaces:**
- Consumes: everything above. Every number written here comes from a command that ran.

---

- [ ] **Step 1: Prove limits are shared across two instances — this is AC1**

The claim the whole Redis design exists for. Two processes, one Redis.

```bash
source "$SCRATCH/env.sh"
startapi THROTTLE_DEFAULT_LIMIT=3 THROTTLE_DEFAULT_WINDOW=60
PORT=4001 THROTTLE_DEFAULT_LIMIT=3 THROTTLE_DEFAULT_WINDOW=60 \
  node apps/api/dist/main.js > "$SCRATCH/api-4001.log" 2>&1 &
until curl -s -o /dev/null http://localhost:4001/api/v1/health/live; do sleep 1; done
$RCLI --scan --pattern 'throttle:*' | xargs -r $RCLI DEL > /dev/null

echo "exhausting the budget on port 4000:"
for i in 1 2 3; do printf '  4000 request %d: ' "$i"; curl -s -o /dev/null -w '%{http_code}\n' "$API/api/v1"; done
echo "now asking port 4001, which has served nothing:"
printf '  4001 request 1: '; curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4001/api/v1
```

Expected: `200 200 200` on 4000, then `429` on 4001. The second instance has handled no requests of its own; it refuses because the count lives in Redis rather than in either process.

Then stop the second instance:

```bash
pid=$(netstat -ano -p tcp | grep LISTENING | grep ':4001 ' | awk '{print $5}' | head -1)
[ -n "$pid" ] && taskkill //PID "$pid" //F > /dev/null 2>&1
```

- [ ] **Step 2: Prove fail-open end to end, through HTTP**

Task 2 measured this at the library level. This measures it through the whole stack, which is where it matters.

```bash
source "$SCRATCH/env.sh"
startapi THROTTLE_DEFAULT_LIMIT=1 THROTTLE_DEFAULT_WINDOW=60
$RCLI --scan --pattern 'throttle:*' | xargs -r $RCLI DEL > /dev/null
printf 'with redis up, second request: '
curl -s -o /dev/null -w '%{http_code}\n' "$API/api/v1" > /dev/null
curl -s -o /dev/null -w '%{http_code}\n' "$API/api/v1"

docker compose stop redis > /dev/null 2>&1
printf 'with redis down, five requests: '
for i in $(seq 1 5); do curl -s -o /dev/null -w '%{http_code}\n' "$API/api/v1"; done | sort -u | tr '\n' ' '
echo
echo "--- the warning it logged ---"
grep -o 'Rate limit check failed[^"]*' "$SCRATCH/api.log" | tail -1

docker compose up -d --wait redis > /dev/null 2>&1
```

Expected: `429` while Redis is up, then `200` alone for all five while it is down, with `Rate limit check failed, allowing the request` in the log. The limiter disappears rather than the API doing so — the trade, measured.

- [ ] **Step 3: Write the limits into the API documentation**

In `docs/API.md`, replace the existing rate-limiting line in the conventions list — `- **Rate limiting:** \`@nestjs/throttler\` on auth, pack-open, and trade endpoints.` — with:

```markdown
- **Rate limiting:** two enforcement points sharing one Redis store, so the limits hold across replicas — verified by exhausting a budget on one instance and being refused by a second that had served nothing.

  | Policy | Default | Applies to | Variables |
  |---|---|---|---|
  | strict | 10 per 15 min | `sign-in/email`, `sign-up/email`, `reset-password`, `request-password-reset` | `THROTTLE_AUTH_LIMIT` / `THROTTLE_AUTH_WINDOW` |
  | default | 100 per min | every other route | `THROTTLE_DEFAULT_LIMIT` / `THROTTLE_DEFAULT_WINDOW` |
  | moderate | 30 per min | pack-open and trade creation, when those routes exist | `THROTTLE_MODERATE_LIMIT` / `THROTTLE_MODERATE_WINDOW` |

  `/api/v1/*` is limited by a Nest guard keyed on the authenticated user, falling back to the address; `/api/auth/*` is limited by an Express middleware keyed on the address, because the Better Auth handler is mounted outside the Nest router where no guard reaches. Health probes are exempt: a 429 from a liveness probe reads to an orchestrator as a dead process.

  Refusals carry `Retry-After` and the standard envelope. Successful responses carry `X-RateLimit-Limit`, `-Remaining` and `-Reset`.

  **What the strict limit does and does not do.** It is the control that blunts account enumeration, since a duplicate registration necessarily reveals that an address is taken. Ten attempts per quarter hour turns an unbounded walk into roughly 960 addresses a day from one source. That stops a script; it does not stop a botnet, and nothing at this layer does.

  **When Redis is unavailable there are no limits.** Requests are allowed and a warning is logged. A limiter is an abuse mitigation, not an access control — authorization reads Postgres and is unaffected — and failing closed would make Redis a single point of failure for the whole API.

  **`TRUST_PROXY_HOPS` must match the real number of proxies.** It decides which entry of `X-Forwarded-For` is treated as the client. Too low and every caller shares one bucket; too high and a client can choose its own bucket by sending the header itself. Both were measured.
```

- [ ] **Step 4: Format, lint and commit**

```bash
source "$SCRATCH/env.sh"
pnpm format:check || pnpm format
pnpm typecheck && pnpm lint
git add docs/API.md
git commit -F - <<'EOF'
[PD-36]: document the rate limits and what they do not stop

Records the three policies and their variables, which layer enforces
which prefix and why there are two, and two properties that are easy to
assume wrongly: there are no limits while redis is down, and
TRUST_PROXY_HOPS set too high lets a client choose its own bucket.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 5: Clean up the measurement state**

```bash
source "$SCRATCH/env.sh"
stopapi
$PSQL -c "delete from users where email like 'pd36-%';"
$RCLI --scan --pattern 'throttle:*' | xargs -r $RCLI DEL > /dev/null
rm -f "$SCRATCH"/pd36-[ab].txt "$SCRATCH/api-4001.log"
docker compose up -d --wait > /dev/null
git status --porcelain
```

Expected: `git status --porcelain` prints nothing.

- [ ] **Step 6: Push and confirm CI**

```bash
git push
```

Confirm all four jobs pass — typecheck, lint, build, migrations. `migrations` should be unaffected; this ticket changes no schema, but a green run is the claim rather than the expectation.

- [ ] **Step 7: Write the forward note for the economy routes**

The `moderate` policy is defined but applied nowhere, because neither route exists. Find the tickets that build pack opening and trade creation:

```bash
# in Linear: the M4/M5 tickets for pack opening and trade creation
```

Comment on each:

> **PD-36 note.** The `moderate` rate-limit policy is configured and unused, waiting for this route. Apply it with `@Throttle({ default: { limit: config.throttle.moderateLimit, ttl: config.throttle.moderateWindowMs } })` on the handler.
>
> Use the name `default` rather than registering a `moderate` throttler: `ThrottlerGuard` runs every registered throttler against every route, and `@SkipThrottle()` with no arguments only lifts the one called `default` — a second global throttler would silently limit the health probes, which is an orchestrator restart loop.

- [ ] **Step 8: Close PD-36**

Set PD-36 to Done, recording each criterion against its measurement: AC1 the two-instance result, AC2 the five-401s-then-five-429s transition, AC3 the threshold moving with `THROTTLE_DEFAULT_LIMIT`.

---

## Self-Review

**Spec coverage.** "One storage, two enforcement points" → Tasks 2, 3, 4. `RedisThrottlerStorage` and the Lua script → Task 2. The unit asymmetry → Task 2 Step 1, `toSeconds`, and the Global Constraints. The key namespace → Task 1 Steps 5-7. Fail-open → Task 2 Step 4 and Task 5 Step 2. Keying, including "never the email" → Task 3 Step 3 and Task 4 Step 2, measured in Task 3 Step 12. `trust proxy` → Task 3 Steps 6 and 13. The `get-session` trap → Task 4 Steps 2 and 7. Values from config → Task 3 Steps 1, 2, 8, measured in Step 10. Exemptions → Task 3 Steps 7 and 11. The 429 contract → Task 3 Step 9 and Task 4 Step 6. The ESM risk → Task 1 Steps 2 and 3. Verification rows 1-13 all appear. Documentation → Task 5 Step 3.

**One deviation from the spec, decided while planning.** The spec describes three named throttlers. Only `default` is registered with the module, because `ThrottlerGuard` applies every registered throttler to every route and `@SkipThrottle()` lifts only `default` — registering all three would have limited the health probes with no way to exempt them. The three policies still exist as configuration; `strict` is consumed by the Express middleware and `moderate` by a per-route `@Throttle({ default: … })`. Recorded in the Global Constraints, in Task 3 Step 3's comment, and in the forward note.

**Placeholder scan.** Clean. One conditional was removed during review rather than left for the implementer: `buildErrorEnvelope(exception, requestId)` reads the status through `exception instanceof HttpException` and answers 500 `Internal server error` for anything else, so the middleware passes `new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS)`. The first draft passed a plain object and would have answered every rate-limited caller with a 500.

**Type consistency.** `RedisThrottlerStorage`, `throttleKeys.counter`/`.block`, `THROTTLE_NAMESPACE`, `createAuthThrottleMiddleware`, `ThrottleModule`, `config.throttle.{defaultLimit, defaultWindowMs, authLimit, authWindowMs, moderateLimit, moderateWindowMs}` and `config.app.trustProxyHops` are spelled identically everywhere they appear. The storage's `increment` signature in Task 2 matches both call sites: the guard's via the `ThrottlerStorage` token, and the middleware's direct call in Task 4.
