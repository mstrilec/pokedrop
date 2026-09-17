# PD-31 Email Verification and Welcome Grant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make verification mandatory, make the link land somewhere useful, and credit 1,000 coins exactly once per account — provably, not hopefully.

**Architecture:** A unique constraint on `(userId, type, refId)` makes the grant idempotent against concurrency, which a read-then-write check cannot. The grant itself is one service in a new `economy` module, written inside `PrismaService.withTransaction` so the balance cannot move without a ledger row. Better Auth's `afterEmailVerification` hook triggers it; `requireEmailVerification` and `sendOnSignIn` turn verification into the gate `docs/UserFlows.md` §1 already describes. A per-address cooldown lives inside the delivery callback, the only layer where the address is readable.

**Tech Stack:** NestJS 12 (ESM, `module: nodenext` — every relative import ends in `.js`), Better Auth 1.7.5, Prisma 7.10.0, PostgreSQL 17 on host port 5433, Redis 7.4, Mailpit v1.31 on 8025.

**Spec:** [`docs/superpowers/specs/2026-09-18-pd-31-email-verification-design.md`](../specs/2026-09-18-pd-31-email-verification-design.md)

---

## Global Constraints

- **Work directly on `dev`.** No feature branches, no pull requests.
- **Commit subjects are `[PD-31]: short lowercase description`.** Bodies end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. A `feat:` or `docs:` prefix is rejected by the commit hook.
- **No automated tests in v1.** No test files, runners, dependencies, or CI test step. **This overrides the TDD structure the writing-plans skill normally imposes.** Every task runs a red/green cycle where the "test" is a measurement against the running stack.
- **ESM imports.** Relative imports inside `apps/api` carry the `.js` extension or the build fails.
- **One migration, and only one.** `@@unique([userId, type, refId])` on `CurrencyTransaction`. If a step seems to need a second, stop — the spec is wrong.
- **Write through `PrismaService.withTransaction`, not `$transaction`.** The service's own comment establishes that convention for anything that must not half-apply.
- **Sign-up keeps its 422.** The identical-response enumeration pattern was considered and declined, with reasoning in the spec. Do not add a `/api/v1/register`.
- **An expired token answers with a redirect, not a body.** `{callbackURL}?error=TOKEN_EXPIRED`. Measurements read the `Location` header.
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
MAILPIT="http://localhost:8025"
```

`stopapi` and `startapi` are in `$SCRATCH/env.sh` from PD-35 — `pkill` does not exist in this Git Bash, so `stopapi` kills the holder of port 4000 through `netstat` and `taskkill`, and `startapi VAR=value …` boots with overrides and waits for the health route. Source it:

```bash
source "$SCRATCH/env.sh"
```

A node probe that imports project packages must live **inside `apps/api`** — Node resolves bare imports relative to the file, not the working directory. `apps/api/dist/` is gitignored and is the right home. This cost commands in both PD-36 and PD-132; do not rediscover it.

Mailpit's API, confirmed against the running container in PD-132: `GET /api/v1/messages` returns `{messages: [{ID, Subject, From: {Address}, To: [{Address}]}]}`, a single message is `GET /api/v1/message/{ID}` with `Text` and `HTML` fields, and `DELETE /api/v1/messages` clears the box.

---

## File Structure

| Path | Responsibility | Task |
| --- | --- | --- |
| `apps/api/prisma/schema.prisma` | `@@unique([userId, type, refId])` | 1 |
| `apps/api/prisma/migrations/…` | the generated migration | 1 |
| `apps/api/src/common/errors/prisma-error.ts` | `isUniqueViolation` | 1 |
| `apps/api/src/economy/welcome-grant.service.ts` | the grant, and its idempotency | 2 |
| `apps/api/src/economy/economy.module.ts` | `@Global`, provides the service | 2 |
| `apps/api/src/economy/index.ts` | the module's public surface | 2 |
| `apps/api/src/app.module.ts` | import `EconomyModule` | 2 |
| `apps/api/src/config/env.schema.ts` | three variables | 3 |
| `apps/api/src/config/app.config.ts` | `app.webBaseUrl`, `auth.verificationTtlSeconds`, `mail.resendCooldownSeconds` | 3 |
| `apps/api/src/redis/cache.keys.ts` | `throttleKeys.resend` | 3 |
| `apps/api/src/auth/auth.factory.ts` | `AuthDependencies`, `withCallback`, the TTL | 3 |
| `apps/api/src/auth/auth.module.ts` | build the dependencies object | 3 |
| `apps/api/src/auth/auth.factory.ts` | mandatory verification, the grant hook, the cooldown | 4 |
| `apps/api/src/throttle/auth-throttle.middleware.ts` | `send-verification-email` joins `CREDENTIAL_PATHS` | 5 |
| `apps/api/src/auth/README.md` | the flow, the redirect-shaped error, the cooldown | 5 |
| `docs/API.md` | the verification flow and the accepted residual | 5 |
| `.env.example` | three variables | 3 |

---

## Task 1: The constraint that makes the grant idempotent

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (the `CurrencyTransaction` model)
- Create: `apps/api/prisma/migrations/<timestamp>_currency_transaction_idempotency/migration.sql` (generated)
- Modify: `apps/api/src/common/errors/prisma-error.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `isUniqueViolation(exception: unknown): boolean`, exported from `apps/api/src/common/errors/prisma-error.ts` and imported by Task 2.

---

- [ ] **Step 1: Measure that a duplicate grant is currently possible**

The defect, before the fix. Two identical grant rows for one user, which is the state the constraint must make unreachable.

```bash
source "$SCRATCH/env.sh"
docker compose up -d --wait > /dev/null
UID_A=$($PSQL -c "select id from users limit 1;" | tr -d '\r')
echo "using user: $UID_A"
$PSQL -c "delete from currency_transactions where \"refId\" = 'welcome';"
$PSQL -c "insert into currency_transactions (id, \"userId\", amount, type, \"refId\") values ('probe-1', '$UID_A', 1000, 'GRANT', 'welcome');"
$PSQL -c "insert into currency_transactions (id, \"userId\", amount, type, \"refId\") values ('probe-2', '$UID_A', 1000, 'GRANT', 'welcome');"
echo -n "grant rows for that user: "
$PSQL -c "select count(*) from currency_transactions where \"userId\" = '$UID_A' and \"refId\" = 'welcome';"
$PSQL -c "delete from currency_transactions where \"refId\" = 'welcome';"
```

Expected: both inserts succeed and the count is `2`. That is the double credit the ticket's first acceptance criterion forbids.

- [ ] **Step 2: Add the constraint**

In `apps/api/prisma/schema.prisma`, inside `model CurrencyTransaction`, above the existing `@@index`:

```prisma
  /// Makes a credit idempotent on its own reference rather than on a
  /// read-then-write check, which at READ COMMITTED two concurrent writers
  /// both pass. `refId` is nullable and PostgreSQL treats NULL as distinct
  /// from NULL, so rows without a reference — every GRANT in the seed — are
  /// unaffected.
  ///
  /// It generalises: (userId, PACK_SPEND, openId) is the idempotency a
  /// retried pack open needs in PD-58, and (userId, TRADE, tradeId) the same
  /// for trade settlement.
  @@unique([userId, type, refId])
```

- [ ] **Step 3: Generate and apply the migration**

```bash
cd apps/api
pnpm exec prisma migrate dev --name currency_transaction_idempotency
cd ../..
cat apps/api/prisma/migrations/*currency_transaction_idempotency/migration.sql
```

Expected: a `CREATE UNIQUE INDEX` on `currency_transactions`. If the CLI reports drift or wants to reset, stop — the database is out of step with history and resetting would destroy the seed.

- [ ] **Step 4: Confirm the constraint is real, and that nulls still pass**

Both halves matter. The first is the fix; the second is the proof it did not break the seed.

```bash
source "$SCRATCH/env.sh"
UID_A=$($PSQL -c "select id from users limit 1;" | tr -d '\r')
$PSQL -c "delete from currency_transactions where id like 'probe-%';"
echo "-- two rows with the same refId --"
$PSQL -c "insert into currency_transactions (id, \"userId\", amount, type, \"refId\") values ('probe-1', '$UID_A', 1000, 'GRANT', 'welcome');" && echo "  first:  accepted"
$PSQL -c "insert into currency_transactions (id, \"userId\", amount, type, \"refId\") values ('probe-2', '$UID_A', 1000, 'GRANT', 'welcome');" 2>&1 | grep -qi "duplicate key" && echo "  second: REJECTED" || echo "  second: accepted — THE CONSTRAINT IS NOT WORKING"
echo "-- two rows with a null refId --"
$PSQL -c "insert into currency_transactions (id, \"userId\", amount, type, \"refId\") values ('probe-3', '$UID_A', 5, 'GRANT', null);" && echo "  first:  accepted"
$PSQL -c "insert into currency_transactions (id, \"userId\", amount, type, \"refId\") values ('probe-4', '$UID_A', 5, 'GRANT', null);" && echo "  second: accepted (NULL is distinct from NULL)"
$PSQL -c "delete from currency_transactions where id like 'probe-%';"
```

Expected: accepted / REJECTED, then accepted / accepted.

- [ ] **Step 5: Confirm the seed still applies**

The seed writes multiple `GRANT` rows per user with `refId: null`. If the null branch above were wrong, this is where it would surface.

```bash
pnpm db:seed 2>&1 | tail -5
```

Expected: the seed completes. Any unique-constraint error here means the constraint is wrong, not the seed.

- [ ] **Step 6: Add the predicate**

In `apps/api/src/common/errors/prisma-error.ts`, after `mapPrismaError` and before `conflict`:

```ts
/**
 * Whether a failure is a unique-constraint violation, in either shape.
 *
 * Callers use this to treat "already exists" as success — a grant that was
 * already credited, an operation retried with the same idempotency key. The
 * P2010 branch matters for the same reason it matters in mapPrismaError: a raw
 * query bypasses the engine's error translation and arrives with the real
 * cause buried in meta.
 */
export function isUniqueViolation(exception: unknown): boolean {
  if (!(exception instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (exception.code === 'P2002') {
    return true;
  }

  return exception.code === 'P2010' && driverErrorKind(exception) === 'UniqueConstraintViolation';
}
```

- [ ] **Step 7: Typecheck, lint and commit**

```bash
pnpm typecheck && pnpm lint
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/common/errors/prisma-error.ts
git commit -F - <<'EOF'
[PD-31]: make a referenced currency credit idempotent in the database

A read-then-write guard does not hold at READ COMMITTED: two concurrent
verifications both read "no grant yet" and both insert. A unique
constraint on (userId, type, refId) cannot be raced.

Measured: two rows with the same refId now fail, two with a null refId
still pass, so every GRANT in the seed is unaffected. It also gives a
retried pack open its idempotency for free in PD-58.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 2: The welcome grant

**Files:**
- Create: `apps/api/src/economy/welcome-grant.service.ts`
- Create: `apps/api/src/economy/economy.module.ts`
- Create: `apps/api/src/economy/index.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `isUniqueViolation` from `../common/errors/prisma-error.js` (Task 1); `PrismaService` from `../prisma/index.js`.
- Produces, exported from `./economy/index.js` and used by Task 4:
  - `WELCOME_GRANT_AMOUNT: 1000`
  - `WELCOME_GRANT_REF: 'welcome'`
  - `class WelcomeGrantService { grantIfFirstTime(userId: string): Promise<void> }`
  - `class EconomyModule`

---

- [ ] **Step 1: Write the service**

Create `apps/api/src/economy/welcome-grant.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { isUniqueViolation } from '../common/errors/prisma-error.js';
import { PrismaService } from '../prisma/index.js';

/** `docs/UserFlows.md` §1. Verification is what releases it. */
export const WELCOME_GRANT_AMOUNT = 1_000;

/**
 * The idempotency key, not a description. Together with (userId, type) it is
 * the unique constraint added in PD-31, which is what makes a second grant
 * impossible rather than merely unlikely.
 */
export const WELCOME_GRANT_REF = 'welcome';

/**
 * Credits the one-time welcome balance.
 *
 * Idempotent by database constraint, not by checking first. Two concurrent
 * verifications both pass a read-then-write guard at READ COMMITTED; neither
 * passes a unique index.
 */
@Injectable()
export class WelcomeGrantService {
  private readonly logger = new Logger(WelcomeGrantService.name);

  constructor(private readonly prisma: PrismaService) {}

  async grantIfFirstTime(userId: string): Promise<void> {
    try {
      // withTransaction rather than $transaction, per the convention
      // PrismaService's own comment sets for anything that must not half
      // apply. The ledger row and the balance move together or not at all —
      // a balance without a row to explain it is the defect this prevents.
      await this.prisma.withTransaction(async (tx) => {
        await tx.currencyTransaction.create({
          data: {
            userId,
            amount: WELCOME_GRANT_AMOUNT,
            type: 'GRANT',
            refId: WELCOME_GRANT_REF,
          },
        });

        await tx.user.update({
          where: { id: userId },
          data: { currency: { increment: WELCOME_GRANT_AMOUNT } },
        });
      });

      this.logger.log(`Welcome grant credited to ${userId}`);
    } catch (error) {
      if (isUniqueViolation(error)) {
        // The expected path on a replayed verification link. Not a failure.
        this.logger.debug(`Welcome grant already credited to ${userId}`);
        return;
      }

      throw error;
    }
  }
}
```

- [ ] **Step 2: Write the module and the barrel**

Create `apps/api/src/economy/economy.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { WelcomeGrantService } from './welcome-grant.service.js';

/**
 * Where currency is written. The welcome grant is the first tenant; PD-58's
 * pack spend and PD-68's trade settlement join it, and all three share the
 * ledger invariant that a balance never moves without a row to explain it.
 *
 * Global for the same reason RedisModule is — the auth module needs it, and
 * making each feature module declare the import would be noise.
 */
@Global()
@Module({
  providers: [WelcomeGrantService],
  exports: [WelcomeGrantService],
})
export class EconomyModule {}
```

Create `apps/api/src/economy/index.ts`:

```ts
export { EconomyModule } from './economy.module.js';
export {
  WELCOME_GRANT_AMOUNT,
  WELCOME_GRANT_REF,
  WelcomeGrantService,
} from './welcome-grant.service.js';
```

- [ ] **Step 3: Register it**

In `apps/api/src/app.module.ts`, add the import:

```ts
import { EconomyModule } from './economy/index.js';
```

and add `EconomyModule` to the `imports` array, after `MailModule`.

**The array is one entry per line** — prettier reformatted it during PD-36, and a single-line search-and-replace will silently miss. Edit the multi-line form.

- [ ] **Step 4: Build**

```bash
pnpm typecheck && pnpm --filter @pokedrop/api build 2>&1 | tail -2
```

- [ ] **Step 5: Drive the service directly — once, twice, and concurrently**

Nothing calls it yet. This is the red/green cycle for the task, and the concurrent case is the one the constraint exists for.

```bash
source "$SCRATCH/env.sh"
cat > apps/api/dist/grant-probe.mjs <<'EOF'
import { PrismaService } from './prisma/prisma.service.js';
import { WelcomeGrantService } from './economy/welcome-grant.service.js';

// PrismaService reads only config.db, so a stub standing in for APP_CONFIG is
// enough to drive it without booting Nest.
const prisma = new PrismaService({
  db: { url: process.env.DATABASE_URL, queryLogging: false },
});
await prisma.$connect();
const grant = new WelcomeGrantService(prisma);

const email = 'pd31-probe@example.com';
await prisma.user.deleteMany({ where: { email } });
const user = await prisma.user.create({
  data: { email, displayName: 'PD31 Probe', currency: 0 },
});

const report = async (label) => {
  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const rows = await prisma.currencyTransaction.count({
    where: { userId: user.id, refId: 'welcome' },
  });
  console.log(`${label.padEnd(28)} currency=${fresh.currency} grantRows=${rows}`);
};

await report('before any grant');
await grant.grantIfFirstTime(user.id);
await report('after one grant');
await grant.grantIfFirstTime(user.id);
await report('after a second grant');

await Promise.all([grant.grantIfFirstTime(user.id), grant.grantIfFirstTime(user.id)]);
await report('after two concurrent');

await prisma.user.deleteMany({ where: { email } });
await prisma.$disconnect();
EOF
cd apps/api && node dist/grant-probe.mjs; cd ../..
```

Expected, exactly:

```
before any grant             currency=0 grantRows=0
after one grant              currency=1000 grantRows=1
after a second grant         currency=1000 grantRows=1
after two concurrent         currency=1000 grantRows=1
```

Three things to check rather than tick past. The second line is the grant working. The third is the ticket's first acceptance criterion. The fourth is the reason for the migration — a read-then-write guard would produce `currency=2000` there, and would do it only sometimes, which is the worst kind of bug to own.

`grantRows` never exceeding 1 while `currency` never exceeds 1000 is also the third acceptance criterion: the two move together, because the transaction rolls back the balance when the row is rejected.

- [ ] **Step 6: Clean up and commit**

```bash
rm -f apps/api/dist/grant-probe.mjs
pnpm lint
git add apps/api/src/economy/ apps/api/src/app.module.ts
git commit -F - <<'EOF'
[PD-31]: add the welcome grant

Idempotent by the database constraint rather than by checking first, and
written through withTransaction so the balance cannot move without a
ledger row to explain it.

Measured: granting once credits 1000, granting again leaves it at 1000,
and two concurrent grants also leave it at 1000 -- which is the case a
read-then-write guard would have failed, intermittently.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 3: Configuration, the dependency object, and the link that lands somewhere

**Files:**
- Modify: `apps/api/src/config/env.schema.ts`
- Modify: `apps/api/src/config/app.config.ts`
- Modify: `apps/api/src/redis/cache.keys.ts`
- Modify: `apps/api/src/auth/auth.factory.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `WelcomeGrantService` from `../economy/index.js` (Task 2).
- Produces: `interface AuthDependencies { prisma: PrismaService; mail: MailService; welcomeGrant: WelcomeGrantService; redis: RedisService }` and `buildAuth(config: AppConfig, deps: AuthDependencies)`, both used by Task 4; `config.app.webBaseUrl: string`, `config.auth.verificationTtlSeconds: number`, `config.mail.resendCooldownSeconds: number`; `throttleKeys.resend(email: string): string`.

---

- [ ] **Step 1: Measure the 404 that PD-132 recorded**

The defect this task fixes, reproduced rather than taken on trust.

```bash
source "$SCRATCH/env.sh"
startapi
curl -s -X DELETE "$MAILPIT/api/v1/messages" > /dev/null
$PSQL -c "delete from users where email like 'pd31-%';" > /dev/null
curl -s -o /dev/null -X POST "$API/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd31-a@example.com","password":"correct-horse-battery","name":"PD31 A"}'
ID=$(curl -s "$MAILPIT/api/v1/messages" | python -c "import json,sys; print(json.load(sys.stdin)['messages'][0]['ID'])")
curl -s "$MAILPIT/api/v1/message/$ID" | python -c "
import json,sys,re
print(re.search(r'https?://[^\s\"<>]+verify-email[^\s\"<>]*', json.load(sys.stdin).get('Text','')).group(0))
"
```

Expected: a link ending in `&callbackURL=%2F`. That `/` is the API's root, which has no route — following it gives a 404 after a successful verification.

- [ ] **Step 2: Add the three variables**

In `apps/api/src/config/env.schema.ts`, after the `MAIL_FROM` entry and before the closing `})`:

```ts
    // Where the web application is served. Verification and reset links bounce
    // through the API and land here, so a wrong value produces a mail whose
    // link verifies the account and then shows an error page.
    WEB_BASE_URL: z.url().default('http://localhost:3000'),

    // How long a verification link is good for. Better Auth's default is an
    // hour; it is explicit here because the ticket asks for expiry to be
    // documented, and because a short value is what makes the expired-token
    // path measurable without forging a token.
    AUTH_VERIFICATION_TTL: z.coerce.number().int().min(1).default(3600),

    // Per-address floor between two verification mails. PD-36's limiter is
    // keyed by address of the *caller*; this one is keyed by the address of
    // the recipient, which is what stops a distributed flood of somebody
    // else's inbox.
    MAIL_RESEND_COOLDOWN: z.coerce.number().int().min(1).default(60),
```

- [ ] **Step 3: Expose them typed**

In `apps/api/src/config/app.config.ts`, add to the `app` namespace, after `trustProxyHops`:

```ts
      webBaseUrl: env.WEB_BASE_URL,
```

to the `auth` namespace, after `secureCookies`:

```ts
      verificationTtlSeconds: env.AUTH_VERIFICATION_TTL,
```

and to the `mail` namespace:

```ts
      resendCooldownSeconds: env.MAIL_RESEND_COOLDOWN,
```

- [ ] **Step 4: Add the cooldown key**

In `apps/api/src/redis/cache.keys.ts`, add to `throttleKeys`:

```ts
  /**
   * Per-recipient floor between verification mails, keyed by address rather
   * than by caller — PD-36's limiter is per IP and does nothing against a
   * distributed flood of one person's inbox.
   */
  resend: (email: string) => `${THROTTLE_NAMESPACE}:resend:${email.toLowerCase()}`,
```

- [ ] **Step 5: Collapse the factory's arguments into one object**

In `apps/api/src/auth/auth.factory.ts`, replace the imports and the signature.

Imports become:

```ts
import { Logger } from '@nestjs/common';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import type { AppConfig } from '../config/index.js';
import type { WelcomeGrantService } from '../economy/index.js';
import type { MailService, RenderedMail } from '../mail/index.js';
import type { PrismaService } from '../prisma/index.js';
import type { RedisService } from '../redis/index.js';
import { passwordResetEmail, verificationEmail } from '../mail/index.js';
import { AUTH_BASE_PATH } from './auth.constants.js';
```

Add above `buildAuth`:

```ts
/**
 * Everything the factory needs from the application, as one named object.
 *
 * It was two positional parameters in PD-29 and three in PD-132, and this
 * ticket would have made it five. A list that grows by one per ticket is a
 * list that eventually gets its arguments in the wrong order; a field cannot
 * be transposed with its neighbour.
 */
export interface AuthDependencies {
  prisma: PrismaService;
  mail: MailService;
  welcomeGrant: WelcomeGrantService;
  redis: RedisService;
}
```

and change the signature:

```ts
export function buildAuth(config: AppConfig, deps: AuthDependencies) {
```

Inside, `prisma` becomes `deps.prisma` in the `prismaAdapter(...)` call, and `mail` becomes `deps.mail` inside `deliver`.

- [ ] **Step 6: Add the link repair**

Still in `apps/api/src/auth/auth.factory.ts`, beside `deliver`:

```ts
  /**
   * Fills in a `callbackURL` when the caller gave none.
   *
   * Better Auth builds the link from AUTH_BASE_URL and redirects to
   * `callbackURL` afterwards; sign-up supplies none, so it defaults to `/` —
   * the API's root, which has no route. Measured in PD-132: the account is
   * verified and the person is looking at a 404.
   *
   * The link is repaired rather than rebuilt. Constructing it here would
   * duplicate the provider's own URL shape and break silently the day it
   * changes, and it would also override a client that had supplied a
   * perfectly good callback of its own.
   */
  const withCallback = (url: string, fallback: string): string => {
    const parsed = new URL(url);
    const current = parsed.searchParams.get('callbackURL');

    if (current === null || current === '/') {
      parsed.searchParams.set('callbackURL', fallback);
    }

    return parsed.toString();
  };
```

Apply it in both callbacks, and set the token lifetime:

```ts
      sendResetPassword: async ({ user, url }) => {
        await deliver(
          user.email,
          passwordResetEmail({
            displayName: user.name,
            url: withCallback(url, `${config.app.webBaseUrl}/reset-password`),
          }),
        );
      },
```

```ts
    emailVerification: {
      expiresIn: config.auth.verificationTtlSeconds,
      sendOnSignUp: true,

      sendVerificationEmail: async ({ user, url }) => {
        await deliver(
          user.email,
          verificationEmail({
            displayName: user.name,
            url: withCallback(url, `${config.app.webBaseUrl}/verify-email`),
          }),
        );
      },
    },
```

- [ ] **Step 7: Build the dependency object**

Replace the provider in `apps/api/src/auth/auth.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { WelcomeGrantService } from '../economy/index.js';
import { MailService } from '../mail/index.js';
import { PrismaService } from '../prisma/index.js';
import { RedisService } from '../redis/index.js';
import { AUTH_INSTANCE } from './auth.constants.js';
import { buildAuth } from './auth.factory.js';

/**
 * Global because the guard in PD-33 needs the instance on every request, and
 * making each feature module import this one would be noise.
 */
@Global()
@Module({
  providers: [
    {
      provide: AUTH_INSTANCE,
      inject: [APP_CONFIG, PrismaService, MailService, WelcomeGrantService, RedisService],
      useFactory: (
        config: AppConfig,
        prisma: PrismaService,
        mail: MailService,
        welcomeGrant: WelcomeGrantService,
        redis: RedisService,
      ) => buildAuth(config, { prisma, mail, welcomeGrant, redis }),
    },
  ],
  exports: [AUTH_INSTANCE],
})
export class AuthModule {}
```

- [ ] **Step 8: Document the variables**

Append to `.env.example`, after `MAIL_FROM`:

```bash

# Where the web app is served. Verification and reset links bounce through the
# API and land here; a wrong value produces a mail whose link verifies the
# account and then shows an error page.
WEB_BASE_URL=http://localhost:3000

# Seconds a verification link is good for.
AUTH_VERIFICATION_TTL=3600

# Seconds between two verification mails to the SAME address. The rate limit
# above is per caller; this one is per recipient, which is what stops a
# distributed flood of somebody else's inbox.
MAIL_RESEND_COOLDOWN=60
```

- [ ] **Step 9: Confirm the link now lands on the web app**

```bash
source "$SCRATCH/env.sh"
pnpm typecheck && pnpm --filter @pokedrop/api build 2>&1 | tail -2
startapi
curl -s -X DELETE "$MAILPIT/api/v1/messages" > /dev/null
$PSQL -c "delete from users where email like 'pd31-%';" > /dev/null
curl -s -o /dev/null -X POST "$API/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd31-a@example.com","password":"correct-horse-battery","name":"PD31 A"}'
ID=$(curl -s "$MAILPIT/api/v1/messages" | python -c "import json,sys; print(json.load(sys.stdin)['messages'][0]['ID'])")
LINK=$(curl -s "$MAILPIT/api/v1/message/$ID" | python -c "
import json,sys,re
print(re.search(r'https?://[^\s\"<>]+verify-email[^\s\"<>]*', json.load(sys.stdin).get('Text','')).group(0))
")
echo "link: $LINK"
curl -s -o /dev/null -w 'following it: %{http_code}, redirect_url: %{redirect_url}\n' "$LINK"
```

Expected: the link now carries `callbackURL=http%3A%2F%2Flocalhost%3A3000%2Fverify-email`, and following it gives a `302` whose `redirect_url` is `http://localhost:3000/verify-email`. Where Step 1 produced `%2F`.

- [ ] **Step 10: Confirm a client-supplied callback still wins**

The repair must fill a gap, not override a choice.

```bash
source "$SCRATCH/env.sh"
curl -s -X DELETE "$MAILPIT/api/v1/messages" > /dev/null
$PSQL -c "delete from users where email like 'pd31-b%';" > /dev/null
curl -s -o /dev/null -X POST "$API/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d "{\"email\":\"pd31-b@example.com\",\"password\":\"correct-horse-battery\",\"name\":\"PD31 B\",\"callbackURL\":\"$WEB/welcome\"}"
ID=$(curl -s "$MAILPIT/api/v1/messages" | python -c "import json,sys; print(json.load(sys.stdin)['messages'][0]['ID'])")
curl -s "$MAILPIT/api/v1/message/$ID" | python -c "
import json,sys,re
u = re.search(r'https?://[^\s\"<>]+verify-email[^\s\"<>]*', json.load(sys.stdin).get('Text','')).group(0)
print('welcome' in u and 'the client callback survived' or 'OVERRIDDEN — the repair is too eager')
"
```

Expected: `the client callback survived`.

- [ ] **Step 11: Lint and commit**

```bash
pnpm lint
git add apps/api/src/config/env.schema.ts apps/api/src/config/app.config.ts \
        apps/api/src/redis/cache.keys.ts apps/api/src/auth/auth.factory.ts \
        apps/api/src/auth/auth.module.ts .env.example
git commit -F - <<'EOF'
[PD-31]: land the verification link on the web app

PD-132 measured a verified account looking at a 404: better auth
redirects to callbackURL after verifying, and sign-up supplies none, so
it defaulted to the API's root. The link is now repaired rather than
rebuilt -- a client that supplied its own callback keeps it, measured
both ways.

The factory's positional arguments become one named object on the way
past. Two in PD-29, three in PD-132, five here; a list that grows by one
per ticket eventually gets them in the wrong order.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 4: Mandatory verification, the grant, and the cooldown

**Files:**
- Modify: `apps/api/src/auth/auth.factory.ts`

**Interfaces:**
- Consumes: `AuthDependencies` and `withCallback` (Task 3); `WelcomeGrantService.grantIfFirstTime` (Task 2); `throttleKeys.resend` (Task 3).
- Produces: nothing other tasks read.

---

- [ ] **Step 1: Measure the current state — unverified accounts sign in freely**

```bash
source "$SCRATCH/env.sh"
startapi
$PSQL -c "delete from users where email like 'pd31-%';" > /dev/null
curl -s -o /dev/null -X POST "$API/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd31-a@example.com","password":"correct-horse-battery","name":"PD31 A"}'
echo -n "emailVerified: "; $PSQL -c "select \"emailVerified\" from users where email='pd31-a@example.com';"
echo -n "currency:      "; $PSQL -c "select currency from users where email='pd31-a@example.com';"
echo -n "sign-in without verifying: "
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/api/auth/sign-in/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd31-a@example.com","password":"correct-horse-battery"}'
```

Expected: `f`, `0`, and `200`. Nobody has to prove they own the address, and the balance has nothing to release.

- [ ] **Step 2: Turn verification into the gate**

In `apps/api/src/auth/auth.factory.ts`, replace `requireEmailVerification: false` and its comment:

```ts
      /**
       * Verification is the gate, as `docs/UserFlows.md` §1 describes. Without
       * it the welcome grant hangs from an event nobody has to reach, and
       * anyone can register against an address they do not own.
       *
       * It does not add an enumeration oracle. The 403 this produces sits
       * after the password check — a wrong password is still 401 — so it is
       * only visible to someone who already holds valid credentials and
       * therefore already knows the account exists. Checked in the provider
       * rather than assumed, because otherwise it would have cost the property
       * PD-30 measured.
       *
       * In production this couples sign-in to deliverability: with no working
       * relay, nobody can sign in at all. SPF, DKIM, DMARC and a sending
       * domain are a release blocker, not a nicety — noted on PD-126.
       */
      requireEmailVerification: true,
```

and add to the `emailVerification` block, beside `sendOnSignUp`:

```ts
      /**
       * What makes mandatory verification survivable. When an unverified user
       * tries to sign in, the provider sends a fresh link before refusing —
       * so "my link expired" is solved by trying again, and no separate
       * recovery flow has to exist.
       */
      sendOnSignIn: true,
```

- [ ] **Step 3: Release the grant on verification**

Add to the `emailVerification` block:

```ts
      /**
       * Runs after `emailVerified` is already written, so an exception escaping
       * here would show an error to someone who is in fact verified — and the
       * link cannot be retried, because the token is spent. Hence catch and
       * log.
       *
       * The residual is real: a user whose grant failed is verified with a
       * zero balance, and nothing retries it. The unique constraint makes any
       * later retry safe, but the trigger for one belongs with the admin
       * tooling in M10.
       */
      afterEmailVerification: async (user) => {
        try {
          await deps.welcomeGrant.grantIfFirstTime(user.id);
        } catch (error) {
          logger.error(
            `Welcome grant failed for ${user.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      },
```

- [ ] **Step 4: Add the per-address cooldown**

Beside `deliver` in the same file:

```ts
  /**
   * Whether enough time has passed to mail this address again.
   *
   * PD-36's limiter is keyed by the caller's address, which does nothing
   * against a distributed flood of one person's inbox. This is keyed by the
   * recipient, and it has to live here because it is the first layer where the
   * address is readable — the handler needs the raw body, so the Express
   * middleware runs before any parser.
   *
   * Nothing leaks by suppressing a send. The provider's own constant-time
   * floor sits above this callback and answers `{ status: true }` after the
   * same 500 ms either way.
   *
   * Fails open, like the rate limiter: a mail not sent is worse than a mail
   * sent twice.
   */
  const cooldownAllows = async (email: string): Promise<boolean> => {
    try {
      const result = await deps.redis.client.set(
        throttleKeys.resend(email),
        '1',
        'EX',
        config.mail.resendCooldownSeconds,
        'NX',
      );

      return result === 'OK';
    } catch (error) {
      logger.warn(
        `Resend cooldown check failed, sending anyway: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return true;
    }
  };
```

Add the import for the key builder:

```ts
import { throttleKeys } from '../redis/index.js';
```

and apply it in `sendVerificationEmail`:

```ts
      sendVerificationEmail: async ({ user, url }) => {
        if (!(await cooldownAllows(user.email))) {
          logger.log('Verification mail suppressed by the resend cooldown');
          return;
        }

        await deliver(
          user.email,
          verificationEmail({
            displayName: user.name,
            url: withCallback(url, `${config.app.webBaseUrl}/verify-email`),
          }),
        );
      },
```

- [ ] **Step 5: Confirm the gate, the automatic resend, and the grant — AC1 and the flow**

```bash
source "$SCRATCH/env.sh"
pnpm typecheck && pnpm --filter @pokedrop/api build 2>&1 | tail -2
startapi
curl -s -X DELETE "$MAILPIT/api/v1/messages" > /dev/null
$RCLI --scan --pattern 'throttle:resend:*' | tr -d '\r' | xargs -r $RCLI DEL > /dev/null
$PSQL -c "delete from users where email like 'pd31-%';" > /dev/null

curl -s -o /dev/null -X POST "$API/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd31-a@example.com","password":"correct-horse-battery","name":"PD31 A"}'

echo -n "sign-in before verifying:  "
curl -s -X POST "$API/api/auth/sign-in/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd31-a@example.com","password":"correct-horse-battery"}' | head -c 120
echo
echo -n "mails in the box now:      "
curl -s "$MAILPIT/api/v1/messages" | python -c "import json,sys; print(len(json.load(sys.stdin).get('messages',[])))"
```

Expected: a 403 carrying `EMAIL_NOT_VERIFIED`, and **2** messages — the sign-up mail plus the one `sendOnSignIn` produced. The second number is the whole argument for `sendOnSignIn`: the recovery path fires without anyone asking for it.

- [ ] **Step 6: Verify, and confirm the grant lands exactly once — AC1**

```bash
source "$SCRATCH/env.sh"
ID=$(curl -s "$MAILPIT/api/v1/messages" | python -c "import json,sys; print(json.load(sys.stdin)['messages'][-1]['ID'])")
LINK=$(curl -s "$MAILPIT/api/v1/message/$ID" | python -c "
import json,sys,re
print(re.search(r'https?://[^\s\"<>]+verify-email[^\s\"<>]*', json.load(sys.stdin).get('Text','')).group(0))
")
show() { printf '%-26s verified=%s currency=%s rows=%s\n' "$1" \
  "$($PSQL -c "select \"emailVerified\" from users where email='pd31-a@example.com';" | tr -d '\r')" \
  "$($PSQL -c "select currency from users where email='pd31-a@example.com';" | tr -d '\r')" \
  "$($PSQL -c "select count(*) from currency_transactions c join users u on u.id=c.\"userId\" where u.email='pd31-a@example.com' and c.\"refId\"='welcome';" | tr -d '\r')"; }

show "before"
curl -s -o /dev/null "$LINK"
show "after following once"
curl -s -o /dev/null "$LINK"
show "after replaying the link"

echo -n "sign-in after verifying: "
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/api/auth/sign-in/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd31-a@example.com","password":"correct-horse-battery"}'
```

Expected:

```
before                     verified=f currency=0 rows=0
after following once       verified=t currency=1000 rows=1
after replaying the link   verified=t currency=1000 rows=1
sign-in after verifying: 200
```

The third line is the acceptance criterion. Note the replay may itself be refused as an already-used token — what matters is that the balance did not move either way.

- [ ] **Step 7: Confirm the expired-token path — AC2**

An expired token answers with a **redirect carrying an error code**, not a body. Boot with a two-second lifetime rather than forging a token.

```bash
source "$SCRATCH/env.sh"
startapi AUTH_VERIFICATION_TTL=2
curl -s -X DELETE "$MAILPIT/api/v1/messages" > /dev/null
$RCLI --scan --pattern 'throttle:resend:*' | tr -d '\r' | xargs -r $RCLI DEL > /dev/null
$PSQL -c "delete from users where email like 'pd31-c%';" > /dev/null
curl -s -o /dev/null -X POST "$API/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd31-c@example.com","password":"correct-horse-battery","name":"PD31 C"}'
ID=$(curl -s "$MAILPIT/api/v1/messages" | python -c "import json,sys; print(json.load(sys.stdin)['messages'][0]['ID'])")
LINK=$(curl -s "$MAILPIT/api/v1/message/$ID" | python -c "
import json,sys,re
print(re.search(r'https?://[^\s\"<>]+verify-email[^\s\"<>]*', json.load(sys.stdin).get('Text','')).group(0))
")
python -c "import time; time.sleep(4)"
curl -s -o /dev/null -w 'expired link: %{http_code}, redirect_url: %{redirect_url}\n' "$LINK"
echo -n "still unverified: "; $PSQL -c "select \"emailVerified\" from users where email='pd31-c@example.com';"
```

Expected: `302` with a `redirect_url` of `http://localhost:3000/verify-email?error=TOKEN_EXPIRED`, and `f`. The error code is in the query string of the redirect target, which is what a frontend page has to read — it is not in any response body.

- [ ] **Step 8: Confirm it can be re-requested — AC2's second half**

```bash
source "$SCRATCH/env.sh"
startapi
$RCLI --scan --pattern 'throttle:resend:*' | tr -d '\r' | xargs -r $RCLI DEL > /dev/null
curl -s -X DELETE "$MAILPIT/api/v1/messages" > /dev/null
echo -n "send-verification-email: "
curl -s -X POST "$API/api/auth/send-verification-email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd31-c@example.com"}'
echo
ID=$(curl -s "$MAILPIT/api/v1/messages" | python -c "import json,sys; print(json.load(sys.stdin)['messages'][0]['ID'])")
LINK=$(curl -s "$MAILPIT/api/v1/message/$ID" | python -c "
import json,sys,re
print(re.search(r'https?://[^\s\"<>]+verify-email[^\s\"<>]*', json.load(sys.stdin).get('Text','')).group(0))
")
curl -s -o /dev/null "$LINK"
echo -n "verified now: "; $PSQL -c "select \"emailVerified\" from users where email='pd31-c@example.com';"
echo -n "currency:     "; $PSQL -c "select currency from users where email='pd31-c@example.com';"
```

Expected: `{"status":true}`, then `t` and `1000`. A fresh link from the resend endpoint completes the flow the expired one could not.

- [ ] **Step 9: Confirm the cooldown suppresses the second mail**

```bash
source "$SCRATCH/env.sh"
$RCLI --scan --pattern 'throttle:resend:*' | tr -d '\r' | xargs -r $RCLI DEL > /dev/null
curl -s -X DELETE "$MAILPIT/api/v1/messages" > /dev/null
$PSQL -c "delete from users where email like 'pd31-d%';" > /dev/null
curl -s -o /dev/null -X POST "$API/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd31-d@example.com","password":"correct-horse-battery","name":"PD31 D"}'
for i in 1 2 3; do
  curl -s -o /dev/null -X POST "$API/api/auth/send-verification-email" \
    -H 'Content-Type: application/json' -H "Origin: $WEB" \
    -d '{"email":"pd31-d@example.com"}'
done
echo -n "mails after sign-up plus three resends: "
curl -s "$MAILPIT/api/v1/messages" | python -c "import json,sys; print(len(json.load(sys.stdin).get('messages',[])))"
echo -n "the cooldown key exists: "
$RCLI EXISTS "throttle:resend:pd31-d@example.com"
```

Expected: `1` mail — the sign-up one — and `1` for the key. Three resends produced nothing because the cooldown was already held.

Then confirm the caller cannot tell:

```bash
curl -s -X POST "$API/api/auth/send-verification-email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd31-d@example.com"}'
echo
```

Expected: `{"status":true}` — identical to the response when a mail is actually sent.

- [ ] **Step 10: Lint and commit**

```bash
pnpm lint
git add apps/api/src/auth/auth.factory.ts
git commit -F - <<'EOF'
[PD-31]: require verification and release the welcome grant

Verification becomes the gate docs/UserFlows.md already describes, with
sendOnSignIn making it survivable: an unverified sign-in gets a fresh
link before it is refused, so an expired token needs no separate
recovery flow.

The grant hangs off afterEmailVerification and is caught rather than
raised -- the hook runs after emailVerified is written and the token is
spent, so an escaping error would show a failure to someone who is
verified.

The resend cooldown is keyed by recipient and lives in the delivery
callback, the first layer where the address is readable.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 5: The rate-limit hole, documentation, and close-out

**Files:**
- Modify: `apps/api/src/throttle/auth-throttle.middleware.ts`
- Modify: `apps/api/src/auth/README.md`
- Modify: `docs/API.md`

**Interfaces:**
- Consumes: the measured results from Tasks 1-4.

---

- [ ] **Step 1: Measure the hole PD-36 left**

`send-verification-email` is unauthenticated, takes an arbitrary address, and is not in `CREDENTIAL_PATHS` — so it carries the default limit of 100 per minute rather than the strict one.

```bash
source "$SCRATCH/env.sh"
startapi THROTTLE_AUTH_LIMIT=5 THROTTLE_DEFAULT_LIMIT=100
$RCLI --scan --pattern 'throttle:*' | tr -d '\r' | xargs -r $RCLI DEL > /dev/null
echo -n "10 calls, BEFORE the fix: "
for i in $(seq 1 10); do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/api/auth/send-verification-email" \
    -H 'Content-Type: application/json' -H "Origin: $WEB" -d '{"email":"nobody@example.com"}'
done | sort | uniq -c | tr '\n' ' '
echo
```

Expected: ten `200`s. With the strict limit at 5, none was refused — because the strict limit does not apply to this route.

- [ ] **Step 2: Close it**

In `apps/api/src/throttle/auth-throttle.middleware.ts`, add to `CREDENTIAL_PATHS`:

```ts
  `${AUTH_BASE_PATH}/send-verification-email`,
```

and extend the comment above the set:

```ts
/**
 * The routes that spend a password, create an account, or mail a link.
 *
 * An explicit list rather than the whole prefix, because GET
 * /api/auth/get-session is called by the frontend on every page load. A strict
 * limit over all of /api/auth/* would throttle that first and hardest, and the
 * application would appear to sign people out at random.
 *
 * send-verification-email was missed when this list was written in PD-36. It
 * is unauthenticated and takes an arbitrary address, so under the default
 * limit it was a mail cannon pointed at anybody at a hundred a minute. The
 * per-recipient cooldown in auth.factory.ts bounds the rest.
 */
```

- [ ] **Step 3: Confirm it is closed**

```bash
source "$SCRATCH/env.sh"
pnpm typecheck && pnpm --filter @pokedrop/api build 2>&1 | tail -2
startapi THROTTLE_AUTH_LIMIT=5 THROTTLE_DEFAULT_LIMIT=100
$RCLI --scan --pattern 'throttle:*' | tr -d '\r' | xargs -r $RCLI DEL > /dev/null
echo "10 calls, AFTER the fix:"
for i in $(seq 1 10); do
  printf '  %2d: ' "$i"
  curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/api/auth/send-verification-email" \
    -H 'Content-Type: application/json' -H "Origin: $WEB" -d '{"email":"nobody@example.com"}'
done
```

Expected: five `200`s, then five `429`s.

- [ ] **Step 4: Document the flow**

In `apps/api/src/auth/README.md`, replace the `### The verification link currently lands nowhere` section — the gap it describes is closed — with:

```markdown
### Verification is mandatory

`requireEmailVerification: true`. An unverified sign-in is refused with 403 `EMAIL_NOT_VERIFIED`, and `sendOnSignIn: true` means the provider mails a fresh link *before* refusing. "My link expired" is therefore solved by trying to sign in again, and no separate recovery flow exists.

This does not add an enumeration oracle: the 403 sits after the password check, so only someone who already holds valid credentials can see it.

It does couple sign-in to deliverability in production. With no working relay nobody can sign in at all, which makes SPF, DKIM, DMARC and a sending domain a release blocker rather than a nicety.

`AUTH_VERIFICATION_TTL` is the link's lifetime, one hour by default.

### An expired link answers with a redirect, not a body

`email-verification.mjs:43-49`. When a `callbackURL` is present — and one always is, see below — a bad token is a **302 to `{callbackURL}?error=CODE`**, where the code is `TOKEN_EXPIRED`, `INVALID_TOKEN`, `USER_NOT_FOUND` or `INVALID_USER`. Measured:

```
expired link: 302, redirect_url: http://localhost:3000/verify-email?error=TOKEN_EXPIRED
```

The frontend's `/verify-email` page has to read `?error=` from its own URL. Nothing appears in any response body.

### The link is repaired, not rebuilt

Better Auth redirects to `callbackURL` after verifying, and sign-up supplies none, so it used to default to `/` — the API's root, which has no route, so a verified account landed on a 404. `withCallback` fills in `WEB_BASE_URL` when the caller gave nothing or gave `/`, and leaves a real one alone. Both directions are measured.

Rebuilding the URL here instead would duplicate the provider's own shape and break silently the day it changes.

### The welcome grant

`afterEmailVerification` credits 1,000 coins through `WelcomeGrantService`, once per account. Idempotent by a unique constraint on `(userId, type, refId)` rather than by checking first — two concurrent verifications both pass a read-then-write guard at READ COMMITTED, and neither passes a unique index. Measured: one grant, a replayed link, and two concurrent grants all leave the balance at 1,000 with one ledger row.

The hook catches and logs rather than raising, because it runs after `emailVerified` is written and the token is already spent. **The residual:** a user whose grant failed is verified with a zero balance and nothing retries it. Any later retry is safe; the trigger belongs with M10's admin tooling.

### Two limits on the resend path

`POST /api/auth/send-verification-email` is the provider's own, and is already enumeration-safe: decoy work for an unknown address plus a 500 ms constant-time floor, always answering `{ status: true }`.

It carries the strict rate limit, keyed by caller — it was missed when that list was written in PD-36 and ran under the default 100 per minute until this ticket. On top of it, `MAIL_RESEND_COOLDOWN` is keyed by *recipient*, inside the delivery callback, which is the first layer where the address can be read. That is what bounds a distributed flood of one person's inbox, which a per-IP limit cannot.

A suppressed mail is invisible to the caller: the provider's constant-time floor sits above the callback and answers identically either way.
```

- [ ] **Step 5: Record the accepted residual in the API docs**

In `docs/API.md`, replace the paragraph beginning `**Sign-up leaks whether an email is registered**` with:

```markdown
**Sign-up leaks whether an email is registered**, and this is a measured, accepted residual. A duplicate registration answers 422 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`. Softening the wording would not close it: any status distinct from success is itself the oracle.

Closing it properly means answering identically either way and letting a mail tell the real person which case it was. PD-31 considered that and declined it. Sign-up is Better Auth's route, so an identical answer needs either a middleware that rewrites the provider's response — rejected in PD-30, because it breaks OAuth redirects and costs the frontend the machine-readable `code` — or a second registration route of our own, duplicating one that exists and needing its own constant-time floor. The cost lands on honest users, who would see "check your email" instead of a plain answer, and PD-36's strict limit already caps a walk at roughly 960 addresses a day from one source.

Note the contrast: `POST /auth/send-verification-email` **is** enumeration-safe, because the provider wrote it that way — decoy work for an unknown address and a 500 ms constant-time floor, always answering `{ status: true }`.

Sign-*in* does not leak either: a wrong password and an unknown address return byte-identical responses, and their timings are indistinguishable (81.7 ms against 80.0 ms over 15 samples each), because the provider hashes a dummy password rather than returning early. Requiring verification does not change that — the 403 `EMAIL_NOT_VERIFIED` sits after the password check.
```

- [ ] **Step 6: Format, lint and commit**

```bash
pnpm format:check || pnpm format
pnpm typecheck && pnpm lint
git add apps/api/src/throttle/auth-throttle.middleware.ts apps/api/src/auth/README.md docs/API.md
git commit -F - <<'EOF'
[PD-31]: close the resend rate-limit hole and document the flow

send-verification-email was missed when CREDENTIAL_PATHS was written in
PD-36. It is unauthenticated and takes an arbitrary address, so under the
default limit it was a mail cannon at a hundred a minute. Measured before
and after: ten calls all passed, now five pass and five are refused.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 7: Clean up and push**

```bash
source "$SCRATCH/env.sh"
stopapi
$PSQL -c "delete from users where email like 'pd31-%';"
$PSQL -c "delete from currency_transactions where id like 'probe-%';"
curl -s -X DELETE "$MAILPIT/api/v1/messages" > /dev/null
$RCLI --scan --pattern 'throttle:*' | tr -d '\r' | xargs -r $RCLI DEL > /dev/null
rm -f apps/api/dist/grant-probe.mjs
git status --porcelain
git push
```

Expected: `git status --porcelain` prints nothing before the push.

Then confirm CI. The `migrations` job matters this time — it applies the new migration into an empty database and diffs the schema against history, which is the only check that the constraint replays from scratch.

- [ ] **Step 8: Write the forward notes**

Comment on **PD-126**:

> **PD-31 note.** `requireEmailVerification` is now `true`, which makes email deliverability a **release blocker** rather than a nicety: with no working relay, nobody can sign in at all — not just new accounts, since `sendOnSignIn` refuses an unverified session regardless of age. SPF, DKIM, DMARC and a sending domain must be verified working before launch, and the verification link must be followed end to end from a real mailbox, not from Mailpit.

Comment on **PD-113** or whichever M13 ticket owns the auth pages — find it with a search for the verify-email page:

> **PD-31 note.** The `/verify-email` page must read `?error=` from its own URL. A bad token is a 302 to `{callbackURL}?error=CODE`, never a response body; the codes are `TOKEN_EXPIRED`, `INVALID_TOKEN`, `USER_NOT_FOUND` and `INVALID_USER`. `TOKEN_EXPIRED` should offer the resend action, which is `POST /api/auth/send-verification-email` with `{ email }`.
>
> Note also that a user who simply tries to sign in again is mailed a fresh link automatically, so the page does not have to be the only way out.

- [ ] **Step 9: Close PD-31**

Set it to Done, recording each criterion against its measurement: AC1 the replayed and concurrent grants both leaving the balance at 1,000, AC2 the `302 … ?error=TOKEN_EXPIRED` and the successful re-request, AC3 the ledger row and balance moving together under `withTransaction`.

---

## Self-Review

**Spec coverage.** The unique constraint and `isUniqueViolation` → Task 1. The grant service, its placement in `economy/`, and `withTransaction` → Task 2. `AuthDependencies` → Task 3 Steps 5 and 7. `withCallback` and `WEB_BASE_URL` → Task 3 Steps 6, 9, 10. `AUTH_VERIFICATION_TTL` → Task 3 Step 2, used in Task 4 Step 7. `requireEmailVerification` and `sendOnSignIn` → Task 4 Step 2. `afterEmailVerification` and its catch → Task 4 Step 3. The cooldown and `throttleKeys.resend` → Task 3 Step 4 and Task 4 Steps 4 and 9. The PD-36 hole → Task 5 Steps 1-3. The declined enumeration pattern → Task 5 Step 5. Verification rows 1-12 all appear: 1-4 → Task 2 Step 5 and Task 4 Step 6; 5-6 → Task 4 Steps 7 and 8; 7-9 → Task 4 Steps 5 and 6; 10 → Task 3 Step 9; 11 → Task 4 Step 9; 12 → Task 5 Step 3.

**One deviation from the spec, decided while planning.** The spec sketched the grant as `prisma.$transaction([...])`. The plan uses `prisma.withTransaction(async (tx) => …)` instead, because `PrismaService`'s own comment establishes that convention for anything that must not half-apply and names this exact class of write. Same guarantee, existing idiom.

**Placeholder scan.** Clean. One step names a ticket it cannot resolve in advance — Task 5 Step 8's M13 auth-page ticket — and says to find it by search rather than guessing a number.

**Type consistency.** `WELCOME_GRANT_AMOUNT`, `WELCOME_GRANT_REF`, `WelcomeGrantService.grantIfFirstTime`, `EconomyModule`, `isUniqueViolation`, `AuthDependencies`, `withCallback`, `cooldownAllows`, `throttleKeys.resend`, `config.app.webBaseUrl`, `config.auth.verificationTtlSeconds` and `config.mail.resendCooldownSeconds` are spelled identically everywhere they appear. `buildAuth(config, deps)` in Task 3 Step 5 matches the call in Task 3 Step 7, and Task 4 reads `deps.welcomeGrant` and `deps.redis`, both of which Task 3 defined.
