# PD-35 Session Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the session cookie configurable and safe by construction, give the application's own routes the Origin check the auth handler already has, and establish by measurement what a user can actually do about a stolen session.

**Architecture:** Three independent changes against an existing Better Auth installation. Cookie attributes move from library defaults into validated configuration, with a boot-time refusal for the one combination browsers discard silently. A new global guard applies an Origin check to mutating requests that carry the session cookie, mirroring what Better Auth does for `/api/auth/*` — this is what replaces `SameSite=Lax` once `SameSite` becomes configurable. Session revocation needs no code; the freshness gate on the neighbouring device-list endpoint does.

**Tech Stack:** NestJS 12 (ESM, `module: nodenext` — every relative import ends in `.js`), Better Auth 1.7.5, Zod 4, Express 5, Prisma 7, PostgreSQL 17 on host port 5433.

**Spec:** [`docs/superpowers/specs/2026-09-17-pd-35-session-hardening-design.md`](../specs/2026-09-17-pd-35-session-hardening-design.md)

---

## Global Constraints

- **Work directly on `dev`.** No feature branches, no pull requests.
- **Commit subjects are `[PD-35]: short lowercase description`.** Commit bodies end with the `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` line. A `docs:` or `feat:` prefix is rejected by the commit hook.
- **No automated tests in v1.** Do not add test files, test runners, test dependencies, or a CI test step. **This overrides the TDD structure the writing-plans skill normally imposes.** Every task below still has a red/green cycle — the "test" is an empirical measurement against the running stack: curl against the real handler, SQL against the real database. A claim is not made until a command has printed the evidence for it.
- **ESM imports.** Relative imports inside `apps/api` must carry the `.js` extension or the build fails.
- **No schema change in this ticket.** No Prisma migration is created. If a task seems to need one, stop — the spec is wrong.
- **`pnpm typecheck` and `pnpm lint` run from the repository root** and must pass before every commit. Both build `@pokedrop/shared` first; running `tsc` directly from `apps/api` on a clean checkout fails for that reason.
- **Verified claims only.** "Should work" is not a result. If a measurement contradicts the spec, report the contradiction rather than adjusting the claim to fit.

### Shared shell setup

Every measurement step assumes these, set once per shell:

```bash
cd /m/projects/pokedrop
SCRATCH="/c/Users/MaxSt/AppData/Local/Temp/claude/M--projects-pokedrop/c71988cc-2aa7-4705-933c-b8b1e0bc6ce1/scratchpad"
PSQL="docker compose exec -T postgres psql -U pokedrop -d pokedrop -tA"
API="http://localhost:4000"
WEB="http://localhost:3000"
```

Postgres and Redis must be up (`docker compose up -d --wait`). The API is started as a built binary, not through `nest start --watch`, because several measurements need it booted with a different environment:

```bash
pnpm --filter @pokedrop/api build
node apps/api/dist/main.js > "$SCRATCH/api.log" 2>&1 &
```

`ConfigModule` loads the root `.env` with dotenv, which does **not** overwrite variables already present in the process environment. A variable set on the command line therefore wins, which is what makes the boot measurements possible.

---

## File Structure

| Path | Responsibility | Task |
| --- | --- | --- |
| `apps/api/src/config/env.schema.ts` | three new variables, and the cross-field refusal | 1 |
| `apps/api/src/config/app.config.ts` | resolve the tri-state secure-cookie default into a boolean | 1 |
| `apps/api/src/auth/auth.factory.ts` | feed the attributes to Better Auth's `advanced` block | 1 |
| `.env.example` | document the three variables | 1 |
| `apps/api/src/auth/auth.factory.ts` | raise `session.freshAge` | 2 |
| `apps/api/src/common/guards/csrf.guard.ts` | **new** — the Origin check for the application's own routes | 3 |
| `apps/api/src/app.module.ts` | register the guard ahead of `SessionGuard` | 3 |
| `apps/api/src/auth/README.md` | session lifetime, cookie attributes, the rotation finding | 4 |
| `docs/API.md` | the four session-management endpoints and which gate applies | 4 |

---

## Task 1: Cookie attributes become configuration

**Files:**
- Modify: `apps/api/src/config/env.schema.ts` (add to the object, then chain a second `.refine`)
- Modify: `apps/api/src/config/app.config.ts:57-60` (the `auth` namespace)
- Modify: `apps/api/src/auth/auth.factory.ts:66-74` (the `advanced` block)
- Modify: `.env.example` (the `─── Auth ───` section)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `config.auth.cookieDomain: string | null`, `config.auth.cookieSameSite: 'lax' | 'strict' | 'none'`, `config.auth.secureCookies: boolean`. Task 3 does not read these; Task 4 documents them.

---

- [ ] **Step 1: Establish the baseline — what the cookie looks like today**

This is the "red" half of the cycle: capture the current behaviour before changing it, so the change is demonstrable rather than assumed.

```bash
docker compose up -d --wait
pnpm --filter @pokedrop/api build
node apps/api/dist/main.js > "$SCRATCH/api.log" 2>&1 &
sleep 4
curl -si -X POST "$API/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd35-a@example.com","password":"correct-horse-battery","name":"PD35 A"}' \
  | grep -i '^set-cookie:'
```

Expected: one `set-cookie:` line naming `better-auth.session_token`, carrying `Path=/`, `HttpOnly`, `SameSite=Lax`, and **no** `Domain` and **no** `Secure`. Record the exact line. If the email already exists from a previous run, delete it first:

```bash
$PSQL -c "delete from users where email like 'pd35-%';"
```

- [ ] **Step 2: Add the three variables to the environment schema**

In `apps/api/src/config/env.schema.ts`, immediately after the `AUTH_BASE_URL` entry:

```ts
    // Unset means a host-only cookie: the browser returns it only to the exact
    // host that set it, which is the right default. Set it to a parent domain
    // (".pokedrop.app") when the web app and the API are different subdomains
    // of one site and have to share the session.
    AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),

    // `none` is correct only when the web app and the API are on different
    // registrable domains. It also removes the browser-side CSRF protection
    // that `lax` provides for free — CsrfGuard is what replaces it.
    AUTH_COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),

    // Tri-state on purpose: unset resolves to `NODE_ENV === 'production'` in
    // buildAppConfig. The `Secure` attribute and the `__Secure-` name prefix
    // move together inside Better Auth, so this is the only switch for both.
    AUTH_SECURE_COOKIES: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === 'true')),
```

- [ ] **Step 3: Add the cross-field refusal**

In the same file, chain a second `.refine` onto the existing one (which ends at the `REDIS_QUEUE_DB` check, immediately before `export type Env`):

```ts
  .refine(
    (env) => {
      const secureCookies = env.AUTH_SECURE_COOKIES ?? env.NODE_ENV === 'production';
      return env.AUTH_COOKIE_SAME_SITE !== 'none' || secureCookies;
    },
    {
      message:
        'AUTH_COOKIE_SAME_SITE=none requires secure cookies. Every current browser ' +
        'silently discards a SameSite=None cookie that lacks Secure, so the symptom is ' +
        'a sign-in that returns 200 and leaves the user signed out, with no error in ' +
        'the browser or the server log. Set AUTH_SECURE_COOKIES=true and serve over ' +
        'https, or leave AUTH_COOKIE_SAME_SITE at lax.',
      path: ['AUTH_COOKIE_SAME_SITE'],
    },
  );
```

Note the trailing semicolon moves: the existing `.refine(...)` call currently ends the statement.

- [ ] **Step 4: Resolve the default in the typed config**

In `apps/api/src/config/app.config.ts`, replace the `auth` namespace:

```ts
    auth: {
      secret: env.AUTH_SECRET,
      baseUrl: env.AUTH_BASE_URL,
      /** Null is valid and is the default: a host-only cookie. */
      cookieDomain: env.AUTH_COOKIE_DOMAIN ?? null,
      cookieSameSite: env.AUTH_COOKIE_SAME_SITE,
      /**
       * The tri-state environment variable collapses here, so nothing
       * downstream has to know that "unset" ever meant anything.
       */
      secureCookies: env.AUTH_SECURE_COOKIES ?? env.NODE_ENV === 'production',
    },
```

- [ ] **Step 5: Feed them to Better Auth**

In `apps/api/src/auth/auth.factory.ts`, replace the whole `advanced` block:

```ts
    advanced: {
      /**
       * Secure cookies in production by default — a Secure cookie over plain
       * http is simply dropped, which would make local development look like a
       * broken login rather than a configuration choice. AUTH_SECURE_COOKIES
       * overrides it for a staging environment that does serve https.
       *
       * This is deliberately the only switch for `secure`. Better Auth ties the
       * attribute to the `__Secure-` name prefix in the same expression
       * (cookies/index.mjs:34), so setting `secure` through
       * defaultCookieAttributes below would let the prefix and the attribute
       * disagree with each other.
       */
      useSecureCookies: config.auth.secureCookies,

      /**
       * Spread into Better Auth's cookie defaults after its own `domain` and
       * before the per-cookie overrides (cookies/index.mjs:38), so these two
       * win while the session cookie's maxAge survives.
       *
       * `path` is deliberately absent and stays at the library's `/`. A cookie
       * path is not a security boundary — any document on the origin reaches a
       * sibling path through the DOM — and both /api/auth/* and /api/v1/* need
       * the cookie, so `/` is the only correct value. A configuration knob with
       * one admissible setting is not configuration.
       */
      defaultCookieAttributes: {
        ...(config.auth.cookieDomain === null ? {} : { domain: config.auth.cookieDomain }),
        sameSite: config.auth.cookieSameSite,
      },
    },
```

- [ ] **Step 6: Document the variables**

In `.env.example`, inside the `─── Auth ───` block, after `AUTH_BASE_URL`:

```bash
# Unset means a host-only cookie, which is what you want in development and in
# any deployment where the web app and the API share a host. Set it to a parent
# domain (".pokedrop.app") only to share the session across subdomains.
# AUTH_COOKIE_DOMAIN=

# lax | strict | none. `none` is for a deployment where the web app and the API
# are on different registrable domains, and it requires AUTH_SECURE_COOKIES=true
# — the app refuses to boot otherwise, because browsers drop such a cookie
# without saying so.
AUTH_COOKIE_SAME_SITE=lax

# Unset means "on in production". Controls both the Secure attribute and the
# __Secure- cookie name prefix. Turn it on in staging only if it serves https.
# AUTH_SECURE_COOKIES=true
```

- [ ] **Step 7: Build, and confirm the defaults did not move**

```bash
pnpm typecheck && pnpm --filter @pokedrop/api build
pkill -f 'node apps/api/dist/main.js'
node apps/api/dist/main.js > "$SCRATCH/api.log" 2>&1 &
sleep 4
$PSQL -c "delete from users where email like 'pd35-%';"
curl -si -X POST "$API/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd35-a@example.com","password":"correct-horse-battery","name":"PD35 A"}' \
  | grep -i '^set-cookie:'
```

Expected: byte-identical to Step 1. The refactor is only allowed to change behaviour when a variable is set.

- [ ] **Step 8: Confirm `AUTH_COOKIE_DOMAIN` reaches the header**

```bash
pkill -f 'node apps/api/dist/main.js'
AUTH_COOKIE_DOMAIN=.localhost node apps/api/dist/main.js > "$SCRATCH/api.log" 2>&1 &
sleep 4
$PSQL -c "delete from users where email like 'pd35-%';"
curl -si -X POST "$API/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd35-a@example.com","password":"correct-horse-battery","name":"PD35 A"}' \
  | grep -i '^set-cookie:'
```

Expected: the same line, now carrying `Domain=.localhost`.

- [ ] **Step 9: Confirm `AUTH_SECURE_COOKIES=true` adds both `Secure` and the prefix**

```bash
pkill -f 'node apps/api/dist/main.js'
AUTH_SECURE_COOKIES=true node apps/api/dist/main.js > "$SCRATCH/api.log" 2>&1 &
sleep 4
$PSQL -c "delete from users where email like 'pd35-%';"
curl -si -X POST "$API/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd35-a@example.com","password":"correct-horse-battery","name":"PD35 A"}' \
  | grep -i '^set-cookie:'
```

Expected: the cookie is now named `__Secure-better-auth.session_token` and carries `Secure`. Both changed from one variable — that is the claim being verified.

- [ ] **Step 10: Confirm the dangerous pair is refused at boot**

This is the highest-value measurement in the task.

```bash
pkill -f 'node apps/api/dist/main.js'
AUTH_COOKIE_SAME_SITE=none node apps/api/dist/main.js 2>&1 | head -20
```

Expected: the process exits without listening, printing `Invalid environment configuration:` followed by a line naming `AUTH_COOKIE_SAME_SITE`. Confirm it does **not** start serving. Then confirm the pair is accepted when it is safe:

```bash
AUTH_COOKIE_SAME_SITE=none AUTH_SECURE_COOKIES=true node apps/api/dist/main.js > "$SCRATCH/api.log" 2>&1 &
sleep 4
curl -s -o /dev/null -w '%{http_code}\n' "$API/api/v1/health/live"
pkill -f 'node apps/api/dist/main.js'
```

Expected: `200`.

- [ ] **Step 11: Lint and commit**

```bash
pnpm lint
git add apps/api/src/config/env.schema.ts apps/api/src/config/app.config.ts \
        apps/api/src/auth/auth.factory.ts .env.example
git commit -F - <<'EOF'
[PD-35]: drive the session cookie's attributes from configuration

Domain, SameSite and the Secure switch were library defaults with no way
to change them. They are configuration now, and the one combination
browsers discard in silence -- SameSite=None without Secure -- is refused
at boot rather than surfacing later as a sign-in that returns 200 and
leaves the user signed out.

Path stays at / deliberately: a cookie path is not a security boundary,
and both /api/auth/* and /api/v1/* need the cookie.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 2: Move the freshness gate off the device list

**Files:**
- Modify: `apps/api/src/auth/auth.factory.ts` (the `session` block)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: nothing other tasks read.

---

- [ ] **Step 1: Measure that revocation works, and that two sessions exist to revoke**

Two cookie jars are two browsers.

```bash
pkill -f 'node apps/api/dist/main.js'
node apps/api/dist/main.js > "$SCRATCH/api.log" 2>&1 &
sleep 4
rm -f "$SCRATCH"/jar[AB].txt
$PSQL -c "delete from users where email like 'pd35-%';"

curl -s -c "$SCRATCH/jarA.txt" -X POST "$API/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd35-a@example.com","password":"correct-horse-battery","name":"PD35 A"}' > /dev/null
curl -s -c "$SCRATCH/jarB.txt" -X POST "$API/api/auth/sign-in/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd35-a@example.com","password":"correct-horse-battery"}' > /dev/null

$PSQL -c "select count(*) from sessions;"
```

Expected: `2`.

- [ ] **Step 2: Measure that `revoke-sessions` kills both, and is not age-gated**

```bash
curl -s -b "$SCRATCH/jarA.txt" -X POST "$API/api/auth/revoke-sessions" -H "Origin: $WEB"
echo
curl -s -b "$SCRATCH/jarB.txt" "$API/api/auth/get-session" -H "Origin: $WEB"
echo
$PSQL -c "select count(*) from sessions;"
```

Expected: `{"status":true}`, then `null` from the second browser, then `0`.

- [ ] **Step 3: Measure `revoke-other-sessions` keeps the caller**

```bash
rm -f "$SCRATCH"/jar[AB].txt
curl -s -c "$SCRATCH/jarA.txt" -X POST "$API/api/auth/sign-in/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd35-a@example.com","password":"correct-horse-battery"}' > /dev/null
curl -s -c "$SCRATCH/jarB.txt" -X POST "$API/api/auth/sign-in/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd35-a@example.com","password":"correct-horse-battery"}' > /dev/null
curl -s -b "$SCRATCH/jarA.txt" -X POST "$API/api/auth/revoke-other-sessions" -H "Origin: $WEB"
echo
curl -s -b "$SCRATCH/jarA.txt" "$API/api/auth/get-session" -H "Origin: $WEB" | head -c 80
echo
curl -s -b "$SCRATCH/jarB.txt" "$API/api/auth/get-session" -H "Origin: $WEB"
echo
```

Expected: `{"status":true}`, then a session object for A, then `null` for B.

- [ ] **Step 4: Reproduce the freshness gate on the device list — the "red" state**

`freshSessionMiddleware` compares `Date.now() - session.createdAt` against `freshAge`, which defaults to one day. Backdate the row rather than waiting.

```bash
curl -s -b "$SCRATCH/jarA.txt" "$API/api/auth/list-sessions" -H "Origin: $WEB" | head -c 200
echo " <- fresh session, before backdating"
$PSQL -c "update sessions set \"createdAt\" = now() - interval '3 days';"
curl -s -b "$SCRATCH/jarA.txt" "$API/api/auth/list-sessions" -H "Origin: $WEB"
echo " <- after backdating"
```

Expected: a list of sessions first; then a 403 carrying `SESSION_NOT_FRESH`. That is the defect — the device list is the one call that makes a compromise visible, and it stops working after a day.

- [ ] **Step 5: Confirm revocation is still available on the same stale session**

This distinguishes the two middlewares and is what keeps AC2 safe.

```bash
curl -s -b "$SCRATCH/jarA.txt" -X POST "$API/api/auth/revoke-other-sessions" -H "Origin: $WEB"
echo " <- revocation on a 3-day-old session"
```

Expected: `{"status":true}`. `sensitiveSessionMiddleware` does not check age; it only forces the session to be read from the database instead of the signed cookie cache.

- [ ] **Step 6: Raise `freshAge` to the session lifetime**

In `apps/api/src/auth/auth.factory.ts`, extend the `session` block:

```ts
    session: {
      expiresIn: SESSION_LIFETIME_SECONDS,
      updateAge: SESSION_REFRESH_SECONDS,
      /**
       * Better Auth defaults this to one day, and in this configuration it
       * gates exactly two endpoints: list-sessions and unlink-account. The
       * second is unreachable — no social provider is configured — so the
       * default's only effect is that the device list stops working a day
       * into a seven-day session.
       *
       * That is the wrong endpoint to close. The three revoke-* calls, which
       * fix a compromise, are behind sensitiveSessionMiddleware and are not
       * age-gated at all; list-sessions is the one that makes a compromise
       * visible in the first place, by showing an IP and a user agent the
       * owner does not recognise. Measured in PD-35: a three-day-old session
       * could revoke every other session but could not list them.
       *
       * Matching the session lifetime keeps the list readable for as long as
       * the session it describes. Deliberately not 0, which disables the check
       * globally and for good, including for the re-authentication PD-32 and a
       * future account deletion will want.
       */
      freshAge: SESSION_LIFETIME_SECONDS,
    },
```

- [ ] **Step 7: Confirm the gate is lifted, and that it was this change that lifted it**

```bash
pnpm typecheck && pnpm --filter @pokedrop/api build
pkill -f 'node apps/api/dist/main.js'
node apps/api/dist/main.js > "$SCRATCH/api.log" 2>&1 &
sleep 4
$PSQL -c "update sessions set \"createdAt\" = now() - interval '3 days';"
curl -s -b "$SCRATCH/jarA.txt" "$API/api/auth/list-sessions" -H "Origin: $WEB" | head -c 200
echo
```

Expected: the session list, where Step 4 produced `SESSION_NOT_FRESH`. Same backdated row, same request, different configuration.

- [ ] **Step 8: Lint and commit**

```bash
pnpm lint
git add apps/api/src/auth/auth.factory.ts
git commit -F - <<'EOF'
[PD-35]: keep the device list readable for the life of the session

Better Auth's one-day freshAge gates list-sessions and nothing else this
application can reach. Measured: a three-day-old session could revoke
every other session but could not list them -- the call that fixes a
compromise stayed open while the call that makes one visible closed.

Matching freshAge to the session lifetime fixes that without setting it
to 0, which would disable the check globally.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 3: An Origin check for the application's own routes

**Files:**
- Create: `apps/api/src/common/guards/csrf.guard.ts`
- Modify: `apps/api/src/app.module.ts:26-32` (the providers array and its comment)

**Interfaces:**
- Consumes: `AUTH_INSTANCE` and `AuthInstance` from `../../auth/index.js`; `APP_CONFIG` and `AppConfig` from `../../config/index.js`. Both are already exported and already injected elsewhere — `SessionGuard` takes the first, the logger module takes the second.
- Produces: `CsrfGuard`, registered via `APP_GUARD` ahead of `SessionGuard`. No other task imports it.

---

- [ ] **Step 1: Add a throwaway mutating route to measure against**

`AppController` has a single `@Get()`, and the guard only acts on mutating methods, so there is currently nothing to exercise it. This route exists for the measurement and is removed in Step 8 — it must not reach the commit.

In `apps/api/src/app.controller.ts`, add `Post` to the import from `@nestjs/common` and add:

```ts
  // TEMPORARY — PD-35 measurement only. Removed before commit.
  @Post('csrf-probe')
  probe(): { ok: true } {
    return { ok: true };
  }
```

- [ ] **Step 2: Measure the gap — the "red" state**

```bash
pnpm --filter @pokedrop/api build
pkill -f 'node apps/api/dist/main.js'
node apps/api/dist/main.js > "$SCRATCH/api.log" 2>&1 &
sleep 4
rm -f "$SCRATCH/jarA.txt"
$PSQL -c "delete from users where email like 'pd35-%';"
curl -s -c "$SCRATCH/jarA.txt" -X POST "$API/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd35-a@example.com","password":"correct-horse-battery","name":"PD35 A"}' > /dev/null

curl -s -o /dev/null -w 'cross-origin POST with session cookie: %{http_code}\n' \
  -b "$SCRATCH/jarA.txt" -X POST "$API/api/v1/csrf-probe" -H 'Origin: https://evil.example'
```

Expected: `200`. The application accepts a forged cross-origin write today; `SameSite=Lax` stops the browser from sending the cookie, but the service itself has no opinion. That is what the guard adds.

- [ ] **Step 3: Write the guard**

Create `apps/api/src/common/guards/csrf.guard.ts`:

```ts
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH_INSTANCE } from '../../auth/index.js';
import type { AuthInstance } from '../../auth/index.js';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';

/** Methods that cannot change state, and so cannot be worth forging. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The Origin check for this application's own routes.
 *
 * Better Auth applies one to everything under /api/auth/*, but that handler is
 * mounted on the Express instance outside the Nest router, so its protection
 * stops exactly where our routes begin.
 *
 * What stands in today is `sameSite: 'lax'`: the browser declines to attach the
 * session cookie to a cross-site POST, so a forged request arrives
 * unauthenticated. That is real, but it lives in the browser rather than in the
 * service, and PD-35 made SameSite configurable — a deployment that needs
 * `none` loses it entirely. This is what replaces it.
 *
 * CORS is not an alternative. It governs whether the browser lets the caller
 * read the response; a forger does not need to read anything, because the write
 * has already happened by then.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  /**
   * Resolved once and reused. `$context` is a promise, so this cannot be a
   * constructor assignment, and doing it here rather than in onModuleInit keeps
   * the guard independent of when Nest decides to instantiate it.
   */
  private cookieName: Promise<string> | null = null;

  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: AuthInstance,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    if (SAFE_METHODS.has(request.method)) {
      return true;
    }

    // No ambient credential, nothing to forge. This is what keeps curl, health
    // probes and future server-to-server callers out of a 403 they could never
    // fix, and it is the same condition Better Auth documents for its own
    // check: "Origin header validation when cookies are present".
    //
    // The converse is a real constraint on the frontend: anything that forwards
    // a user's session cookie from a server -- a Next.js server component or
    // route handler acting as a BFF -- has to send an Origin header too, or it
    // is refused here. That is not a new burden. Better Auth already imposes it
    // on /api/auth/*, where a sign-out without an Origin is answered with
    // MISSING_OR_NULL_ORIGIN (measured in PD-30), so a frontend that can sign a
    // user in already satisfies it.
    if (!(await this.hasSessionCookie(request))) {
      return true;
    }

    const origin = request.headers.origin;

    if (origin === undefined || origin === 'null' || !this.isTrusted(origin)) {
      throw new ForbiddenException('Cross-origin request rejected');
    }

    return true;
  }

  private isTrusted(origin: string): boolean {
    return this.config.app.corsOrigins.includes(origin);
  }

  /**
   * Reads the raw Cookie header rather than `request.cookies`: cookie-parser is
   * not registered, so that property does not exist.
   *
   * The name is taken from Better Auth instead of being written here, so it
   * follows `cookiePrefix` and the `__Secure-` prefix on its own. The prefix
   * match catches the chunked form (`name.0`, `name.1`) Better Auth falls back
   * to for a large cookie.
   */
  private async hasSessionCookie(request: Request): Promise<boolean> {
    const header = request.headers.cookie;

    if (header === undefined) {
      return false;
    }

    this.cookieName ??= this.auth.$context.then(
      (context) => context.authCookies.sessionToken.name,
    );
    const name = await this.cookieName;

    return header.split(';').some((pair) => {
      const separator = pair.indexOf('=');
      const key = (separator === -1 ? pair : pair.slice(0, separator)).trim();
      return key === name || key.startsWith(`${name}.`);
    });
  }
}
```

- [ ] **Step 4: Register it ahead of `SessionGuard`**

In `apps/api/src/app.module.ts`, add the import:

```ts
import { CsrfGuard } from './common/guards/csrf.guard.js';
```

and replace the two guard entries and the comment above them:

```ts
    // Order is load-bearing: global guards run in the order they are provided.
    // CsrfGuard is first so a forged request is refused on a header check
    // rather than after SessionGuard has spent a database round-trip resolving
    // the session it was trying to abuse. RolesGuard is last because it reads
    // the caller SessionGuard put on the request; reversed, it sees nobody and
    // rejects everything.
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
```

- [ ] **Step 5: Measure all four branches**

```bash
pnpm typecheck && pnpm --filter @pokedrop/api build
pkill -f 'node apps/api/dist/main.js'
node apps/api/dist/main.js > "$SCRATCH/api.log" 2>&1 &
sleep 4

curl -s -o /dev/null -w 'foreign Origin + cookie   : %{http_code}\n' \
  -b "$SCRATCH/jarA.txt" -X POST "$API/api/v1/csrf-probe" -H 'Origin: https://evil.example'
curl -s -o /dev/null -w 'trusted Origin + cookie   : %{http_code}\n' \
  -b "$SCRATCH/jarA.txt" -X POST "$API/api/v1/csrf-probe" -H "Origin: $WEB"
curl -s -o /dev/null -w 'foreign Origin, no cookie : %{http_code}\n' \
  -X POST "$API/api/v1/csrf-probe" -H 'Origin: https://evil.example'
curl -s -o /dev/null -w 'no Origin at all + cookie : %{http_code}\n' \
  -b "$SCRATCH/jarA.txt" -X POST "$API/api/v1/csrf-probe"
curl -s -o /dev/null -w 'cross-origin GET + cookie : %{http_code}\n' \
  -b "$SCRATCH/jarA.txt" "$API/api/v1/csrf-probe" -H 'Origin: https://evil.example'
```

Expected, in order: `403`, `200`, `401`, `403`, `404`.

Two of these deserve a second look rather than a tick. The third is `401`, not `200` — no cookie means no session, so `CsrfGuard` passes it through and `SessionGuard` refuses it; the guard's branch is still the one being exercised, and the 401 proves the request got past it. The fifth is `404` because the probe route only answers `POST`; what matters is that it is not `403`, which is what proves safe methods are not gated.

- [ ] **Step 6: Confirm the rejection uses the project's error envelope**

```bash
curl -s -b "$SCRATCH/jarA.txt" -X POST "$API/api/v1/csrf-probe" -H 'Origin: https://evil.example'
echo
```

Expected: `{"statusCode":403,"error":"Forbidden","message":"Cross-origin request rejected","requestId":"..."}`. A `ForbiddenException` travels through `AllExceptionsFilter` from PD-18, so this needs no special handling — but it needs confirming, because the claim in the docs is that every `/api/v1` failure has this shape.

- [ ] **Step 7: Confirm `/api/auth/*` still works**

The guard is a global Nest guard and the auth handler sits outside the Nest router, so it should never see those routes. Verify rather than assume — a mistake here logs everyone out.

```bash
rm -f "$SCRATCH/jarC.txt"
curl -s -o /dev/null -w 'sign-in through the auth handler: %{http_code}\n' \
  -c "$SCRATCH/jarC.txt" -X POST "$API/api/auth/sign-in/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd35-a@example.com","password":"correct-horse-battery"}'
```

Expected: `200`.

- [ ] **Step 8: Remove the probe route**

Revert `apps/api/src/app.controller.ts` to its committed state — both the `@Post('csrf-probe')` handler and the `Post` import.

```bash
git checkout -- apps/api/src/app.controller.ts
git diff --stat apps/api/src/app.controller.ts
```

Expected: no output from the second command. Then rebuild and confirm the route is gone:

```bash
pnpm --filter @pokedrop/api build
pkill -f 'node apps/api/dist/main.js'
node apps/api/dist/main.js > "$SCRATCH/api.log" 2>&1 &
sleep 4
curl -s -o /dev/null -w 'probe route after removal: %{http_code}\n' \
  -b "$SCRATCH/jarA.txt" -X POST "$API/api/v1/csrf-probe" -H "Origin: $WEB"
```

Expected: `404`.

- [ ] **Step 9: Lint and commit**

```bash
pnpm lint
git status --porcelain
git add apps/api/src/common/guards/csrf.guard.ts apps/api/src/app.module.ts
git commit -F - <<'EOF'
[PD-35]: reject forged cross-origin writes on the api's own routes

Better Auth checks Origin for everything under /api/auth/*, but that
handler is mounted outside the Nest router and its protection stops where
our routes start. SameSite=Lax was covering the gap from inside the
browser, and this ticket made SameSite configurable, so a deployment that
needs `none` would have had nothing left.

The guard only acts when the request carries the session cookie: without
an ambient credential there is nothing to forge, which keeps curl and
server-to-server callers out of a 403 they could not fix.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

`git status --porcelain` must show no modification to `app.controller.ts` before the commit. If it does, Step 8 did not take.

---

## Task 4: Documentation and ticket hygiene

**Files:**
- Modify: `apps/api/src/auth/README.md` (new section before "Regenerating the schema")
- Modify: `docs/API.md:47` and the endpoint table at lines 53-58

**Interfaces:**
- Consumes: the measured results from Tasks 1-3. Every number written here must come from a command that actually ran.
- Produces: nothing code-facing.

---

- [ ] **Step 1: Add the session section to the auth README**

In `apps/api/src/auth/README.md`, insert before `## Regenerating the schema`:

```markdown
## Sessions

A session is one opaque token in `sessions.token`, sent as an httpOnly cookie. It lives seven days and its expiry is pushed forward at most once a day while the user is active.

| Attribute | Value | Controlled by |
| --- | --- | --- |
| `HttpOnly` | always on | Better Auth, not configurable |
| `Path` | `/` | not configurable — see below |
| `SameSite` | `Lax` | `AUTH_COOKIE_SAME_SITE` |
| `Domain` | absent (host-only) | `AUTH_COOKIE_DOMAIN` |
| `Secure` + the `__Secure-` name prefix | on in production | `AUTH_SECURE_COOKIES` |

`SameSite=None` without `Secure` is refused at boot. Browsers discard such a cookie without reporting anything, so the symptom is a sign-in that returns 200 and leaves the user signed out — a failure with no error in the browser or the log.

`Path` is deliberately not configurable. A cookie path is not a security boundary: any document on the origin reaches a sibling path through the DOM. Both `/api/auth/*` and `/api/v1/*` need the cookie, so `/` is the only correct value.

### There is no refresh token, and no rotation

PD-35 asked for refresh-token rotation with reuse detection. This installation has nothing to rotate. `better-auth/dist/api/routes/session.mjs:198` is the whole refresh path:

```js
await ctx.context.internalAdapter.updateSession(session.session.token, {
  expiresAt: getDate(ctx.context.sessionConfig.expiresIn, 'sec'),
  updatedAt: new Date(),
});
```

The token is the lookup key, not a value being replaced. No new token is issued, so no old token can be replayed, so there is no family to invalidate.

Rotation was considered and rejected rather than overlooked. It would mean adding `familyId` to `sessions` and swapping the token inside `SessionGuard` — but Better Auth's own `getSession` knows nothing about that column and would keep honouring a rotated token on every path that does not run through the guard, including the auth handler's own routes. Two session systems disagreeing about which tokens are live is worse than one system without rotation.

The residual risk is explicit: theft is not *detectable* here. It is still revocable and visible, which is what the endpoints below are for.

### Two middlewares that are easy to confuse

| Endpoint | Middleware | Age-gated |
| --- | --- | --- |
| `POST /api/auth/revoke-sessions` | `sensitiveSessionMiddleware` | no |
| `POST /api/auth/revoke-other-sessions` | `sensitiveSessionMiddleware` | no |
| `POST /api/auth/revoke-session` | `sensitiveSessionMiddleware` | no |
| `GET /api/auth/list-sessions` | `freshSessionMiddleware` | **yes** |

`sensitiveSessionMiddleware` forces the session to be read from the database rather than the signed cookie cache. It does not look at age. `freshSessionMiddleware` is the one that compares `createdAt` against `session.freshAge`.

Better Auth defaults `freshAge` to one day, which put the gate on the wrong endpoint: the three calls that *fix* a compromise stayed open for the full seven days, while the one call that makes a compromise *visible* closed after twenty-four hours. Measured during PD-35 by backdating `sessions.createdAt` three days — revocation succeeded, `list-sessions` returned `SESSION_NOT_FRESH`.

`freshAge` is therefore set to the session lifetime. Not to `0`, which disables the check globally and permanently, including for the re-authentication that PD-32 and a future account deletion will want.
```

- [ ] **Step 2: Correct the CSRF paragraph in the API docs**

`docs/API.md:47` currently says state-changing **auth** routes require an `Origin` header. That is still true, and now incomplete. Replace that paragraph with:

```markdown
**State-changing routes require an `Origin` header** matching the trusted list, on both sides of the mount.

Under `/api/auth/*` this is Better Auth's own check: `POST /auth/sign-out` without an `Origin` is refused with `MISSING_OR_NULL_ORIGIN`, and with a foreign one, `INVALID_ORIGIN`. Sign-up and sign-in do not require it.

Under `/api/v1/*` this is `CsrfGuard`, which Better Auth's middleware cannot reach — the auth handler is mounted on the Express instance, outside the Nest router. It refuses any `POST`, `PUT`, `PATCH` or `DELETE` that carries the session cookie without a trusted `Origin`, and answers in the standard envelope. Requests without the session cookie pass: CSRF needs an ambient credential, and refusing them would break every non-browser caller for no gain. `SameSite=Lax` also stops the browser sending the cookie cross-site, but that protection lives in the browser and disappears if `AUTH_COOKIE_SAME_SITE` is set to `none`.
```

- [ ] **Step 3: Add the session-management endpoints to the table**

In the auth endpoint table at `docs/API.md:53-58`, after the `POST /auth/sign-out` row:

```markdown
| GET | `/auth/list-sessions` | Active sessions with IP and user agent |
| POST | `/auth/revoke-session` | One session, by token |
| POST | `/auth/revoke-other-sessions` | Every session except the caller's |
| POST | `/auth/revoke-sessions` | Every session, including the caller's |
```

- [ ] **Step 4: Verify every documented path against the running handler**

The existing note in this file says paths were "verified against the running handler rather than transcribed — several differ from what this document originally claimed". Hold the new rows to the same standard.

```bash
for p in list-sessions revoke-session revoke-other-sessions revoke-sessions; do
  printf '%-24s ' "$p"
  curl -s -o /dev/null -w '%{http_code}\n' -b "$SCRATCH/jarC.txt" \
    -X POST "$API/api/auth/$p" -H "Origin: $WEB" -H 'Content-Type: application/json' -d '{}'
done
```

Expected: no `404` on any row. `list-sessions` answers `405` to a POST because it is a GET route, which still proves the path exists. Check it properly:

```bash
curl -s -o /dev/null -w 'list-sessions GET: %{http_code}\n' \
  -b "$SCRATCH/jarC.txt" "$API/api/auth/list-sessions" -H "Origin: $WEB"
```

Expected: `200`.

- [ ] **Step 5: Format, lint and commit**

```bash
pnpm format:check || pnpm format
pnpm lint
git add apps/api/src/auth/README.md docs/API.md
git commit -F - <<'EOF'
[PD-35]: document the session model and the two freshness middlewares

Records what a stolen cookie costs here and what shortens it, which
variable controls each cookie attribute, and why there is no refresh
token to rotate. Also corrects API.md, which described the Origin check
as an auth-route feature when it now applies on both sides of the mount.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 6: Clean up the measurement state**

```bash
pkill -f 'node apps/api/dist/main.js'
$PSQL -c "delete from users where email like 'pd35-%';"
rm -f "$SCRATCH"/jar[ABC].txt
git status --porcelain
```

Expected: `git status --porcelain` prints nothing.

- [ ] **Step 7: Push and confirm CI**

```bash
git push
```

Then confirm all four CI jobs pass (typecheck, lint, build, migrations). The `migrations` job should be unaffected — this ticket changes no schema — but a green run is the claim, not the expectation.

- [ ] **Step 8: Write the forward notes into Linear**

Add a comment to **PD-32** (password reset):

> PD-35 note: `changePassword` accepts a `revokeOtherSessions` body parameter. A credential change that leaves old sessions alive is the closest this architecture gets to the reuse detection PD-35's AC1 asked for and could not deliver — there is no refresh token to rotate (evidence in `apps/api/src/auth/README.md`). This is where that belongs.

Add a comment to **PD-36** (rate limiting):

> PD-35 note: `/api/auth/*` is mounted on the Express instance, outside the Nest router, so a global `ThrottlerGuard` will never see it. Those routes need throttling at the Express layer. `CsrfGuard` in `apps/api/src/common/guards/csrf.guard.ts` has the same blind spot and is the reference for it.

- [ ] **Step 9: Close PD-35**

Set PD-35 to Done. In the ticket, record the disposition of each acceptance criterion: AC1 not achievable in this architecture with the evidence, AC2 measured, AC3 measured and extended to `/api/v1/*`.

---

## Self-Review

**Spec coverage.** Component 1 → Task 1. Component 2 → Task 3. Component 3 → Task 2. Verification plan rows 1-4 → Task 1 Steps 7-10; rows 5-8b → Task 2 Steps 1-5 and 7; rows 9-12 → Task 3 Step 5. Documentation table → Task 4 Steps 1-3. Forward notes → Task 4 Step 8. The spec's `.env.example` row is in Task 1 Step 6 rather than Task 4, because the variables and their documentation belong in the same commit.

**Type consistency.** `config.auth.cookieDomain` is `string | null` in Task 1 Step 4 and is compared against `null` in Step 5. `config.auth.secureCookies` and `config.auth.cookieSameSite` are used under those exact names in both. `AuthInstance` and `AUTH_INSTANCE` in Task 3 match the existing imports in `session.guard.ts`. `CsrfGuard` is spelled the same in the guard file, the module import and the documentation.

**Known deviation from the skill.** The TDD cycle is replaced by a measurement cycle throughout, under the standing no-tests constraint. Each task still establishes a failing observation before the change (Task 1 Step 1, Task 2 Step 4, Task 3 Step 2) and re-runs it afterwards.
