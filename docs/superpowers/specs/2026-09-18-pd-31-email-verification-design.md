# PD-31 — Email verification and the welcome grant

Design, 2026-09-18. Milestone M2 · Auth & RBAC.

Ticket: [PD-31](https://linear.app/mstrilec/issue/PD-31/email-verification-flow-with-the-1000-coin-welcome-grant) ·
Reference: `docs/UserFlows.md` §1 (onboarding, welcome grant) · `docs/DataModel.md` (CurrencyTransaction).

Depends on [PD-132](https://linear.app/mstrilec/issue/PD-132/email-transport-mailservice-smtp-and-mailpit), which put the transport in place.

---

## What the provider already does

Reading the provider before designing cut roughly half of this ticket's stated scope. Three of its scope items need no code.

**The resend endpoint exists.** `POST /api/auth/send-verification-email` takes `{ email, callbackURL? }`.

**It is already enumeration-safe**, and more carefully than the ticket asks (`email-verification.mjs:97-118`):

```js
const MINIMUM_MS = 500;
const start = Date.now();
const user = await ctx.context.internalAdapter.findUserByEmail(email);
if (!user || user.user.emailVerified) await createEmailVerificationToken(...);  // decoy work
else try { await sendVerificationEmailFn(ctx, user.user); } catch (e) { error = e; }
const remaining = MINIMUM_MS - (Date.now() - start);
if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
return ctx.json({ status: true });
```

Identical response, decoy work for an address that does not exist, and a constant-time floor on top so the difference between a local JWT signature and an external mail send cannot be timed.

**Token expiry is enforced**, and its failure shape is not what the ticket implies — see *The error arrives as a redirect* below.

What is left is the grant, mandatory verification, a per-address cooldown, and one hole this project left behind.

---

## The grant

### Why a read-then-write check is not enough

The ticket suggests guarding on transaction existence inside a transaction. At PostgreSQL's default READ COMMITTED that does not hold: two concurrent verifications both read "no grant yet", both insert, and the balance doubles. Raising the isolation level or taking a row lock would work, and so would the thing the database is already for.

```prisma
@@unique([userId, type, refId])
```

with `refId: 'welcome'` on the grant. A unique constraint cannot be raced.

**Safe for existing data.** Every `GRANT` row in `prisma/seed.ts` carries `refId: null`, and PostgreSQL treats `NULL` as distinct from `NULL`, so the two rows Ash already has do not collide.

**Useful beyond this ticket.** `(userId, PACK_SPEND, openId)` becomes unique for free, which is the idempotency PD-58 needs for a retried pack open, and `(userId, TRADE, tradeId)` likewise.

This is the only migration in the ticket.

### The write

```ts
await prisma.$transaction([
  prisma.currencyTransaction.create({
    data: { userId, amount: WELCOME_GRANT_AMOUNT, type: 'GRANT', refId: WELCOME_GRANT_REF },
  }),
  prisma.user.update({
    where: { id: userId },
    data: { currency: { increment: WELCOME_GRANT_AMOUNT } },
  }),
]);
```

The array form is one transaction: a unique violation on the first statement aborts the second, so the balance cannot move without a ledger row to explain it. That is the ticket's third acceptance criterion by construction rather than by care.

`P2002` is caught and treated as "already granted". `prisma-error.ts` has no predicate for that today — `isUniqueViolation(exception): boolean` is added there, beside `mapPrismaError`, rather than duplicated in a service.

### Where it lives

`apps/api/src/economy/`, not `apps/api/src/auth/`. Currency is not the authentication provider's business, and the folder is where PD-58's pack spend and PD-68's trade settlement will write their own ledger rows.

```
economy/welcome-grant.service.ts   grantIfFirstTime(userId: string): Promise<void>
economy/economy.module.ts          @Global, provides WelcomeGrantService
economy/index.ts
```

### When the grant fails

`afterEmailVerification` runs **after** `emailVerified` is already written (`email-verification.mjs:229`). Letting an exception escape would show an error to someone who is, in fact, verified — and the link cannot be retried, because the token is spent.

So the hook catches, logs at `error`, and does not rethrow.

**The residual is real and is recorded rather than hidden:** a user whose grant failed is verified with a zero balance, and nothing in this ticket retries it. The unique constraint makes a later retry safe from any trigger, but no such trigger exists yet. A repair path belongs with the admin tooling in M10.

---

## Mandatory verification

`requireEmailVerification: true` together with `sendOnSignIn: true`.

Without it the grant hangs from an event nobody has to reach, and anyone can register against an address they do not own. `docs/UserFlows.md` §1 already documents the flow this turns on.

`sendOnSignIn` is what makes it survivable. `sign-in.mjs:336-348`: when verification is required and the account is unverified, the provider sends a fresh verification mail and then refuses with 403 `EMAIL_NOT_VERIFIED`. "My link expired" is solved by trying to sign in again — no separate recovery UX is needed.

**It does not add an enumeration oracle.** The 403 sits *after* the password check — `sign-in.mjs:334` throws 401 for a wrong password first — so it can only be seen by someone who already holds valid credentials and therefore already knows the account exists. This was checked rather than assumed, because turning it on would otherwise have cost the property PD-30 measured and protected.

**The token lifetime becomes configuration.** `emailVerification.expiresIn` defaults to one hour and is currently implicit. `AUTH_VERIFICATION_TTL` makes it explicit and documented, which the ticket's "token expiry enforced" wants — and it is also what makes measurement 5 below possible without forging a JWT by hand.

**It couples sign-in to deliverability in production.** With `requireEmailVerification: true` and no working relay, nobody can ever sign in. SPF, DKIM, DMARC and a sending domain are out of scope here (PD-132 recorded that), which makes them a release blocker rather than a nicety. Flagged to PD-126.

---

## `buildAuth` stops growing an argument

This ticket would take the factory from three parameters to five — `prisma`, `config`, `mail`, the grant service, and Redis for the cooldown. It was two in PD-29 and three in PD-132; a positional list that grows by one per ticket is a list that will eventually be passed in the wrong order.

So the dependencies become one object, and the configuration stays where it is:

```ts
export interface AuthDependencies {
  prisma: PrismaService;
  mail: MailService;
  welcomeGrant: WelcomeGrantService;
  redis: RedisService;
}

export function buildAuth(config: AppConfig, deps: AuthDependencies) { … }
```

A targeted change to code this ticket already has to edit, not a refactor for its own sake: the next dependency is then a named field rather than a fourth thing to count.

---

## The verification link, and the 404 PD-132 measured

Better Auth redirects to `callbackURL` after verifying, and sign-up supplies none, so it defaults to `/` — the API's root, which has no route. Measured in PD-132: the account is verified and the person is looking at a 404.

`WEB_BASE_URL` arrives here, where something finally reads it. But the link is not rebuilt from scratch — that would duplicate the provider's URL construction and break silently if it ever changes. Instead only the missing part is filled in:

```ts
const withCallback = (url: string, fallback: string): string => {
  const parsed = new URL(url);
  const current = parsed.searchParams.get('callbackURL');
  if (current === null || current === '/') parsed.searchParams.set('callbackURL', fallback);
  return parsed.toString();
};
```

A client that supplied its own `callbackURL` keeps it; one that supplied nothing stops landing on an error page. The same helper applies to the reset mail, which has the same gap whenever `redirectTo` is omitted.

### The error arrives as a redirect, not as a body

The ticket's second acceptance criterion says an expired token "returns a clear error". It does not return one. `email-verification.mjs:43-49`:

```js
function redirectOnError(error) {
  if (ctx.query.callbackURL) {
    const params = new URLSearchParams({ error: error.code });
    throw ctx.redirect(appendQueryParams(ctx.query.callbackURL, params));
  }
  throw APIError.from("UNAUTHORIZED", error);
}
```

With a `callbackURL` — which `withCallback` now guarantees — an expired token is a **302 to `{callbackURL}?error=TOKEN_EXPIRED`**. The codes are `TOKEN_EXPIRED`, `INVALID_TOKEN`, `USER_NOT_FOUND` and `INVALID_USER`.

Two consequences. The measurement reads the `Location` header rather than the response body. And the frontend's `/verify-email` page must read `?error=` from its own URL to say anything useful — recorded for M13.

---

## The cooldown, and where it has to live

PD-36 limits by IP. Against a botnet flooding one person's inbox that does nothing, so the ticket's cooldown has to be keyed on the address.

The address cannot be read at the Express layer: the Better Auth handler needs the raw body, which is why `bodyParser: false` is set, so the throttle middleware runs before any parser. That constraint is already recorded in PD-36.

It can be read one layer deeper, inside `sendVerificationEmail`, where the callback receives `user`. So the cooldown lives in the delivery path: `SET throttle:resend:{email} NX EX <cooldown>`, and if the key is taken, the mail is simply not sent.

Nothing leaks. The caller still receives `{ status: true }` after the same 500 ms, because the provider's constant-time floor sits above our callback and is unaffected by what the callback decides to do.

`MAIL_RESEND_COOLDOWN`, seconds, default 60.

The key goes under `throttle:`, using the namespace PD-36 established — not under `cache:`, for the reason already written in `cache.keys.ts`: a routine cache flush must not hand anyone a fresh budget.

---

## The hole PD-36 left

`POST /api/auth/send-verification-email` is unauthenticated, takes an arbitrary address, and is **not** in `CREDENTIAL_PATHS`. It therefore carries the default limit of 100 per minute rather than the strict 10 per 15 minutes — a mail cannon pointed at any address, at a hundred a minute from one source.

This was an omission in PD-36, not a decision. One line fixes it, and the cooldown above bounds the rest.

---

## Decisions taken, and their reasons

### Sign-up keeps its 422

The ticket leaves open whether registration should answer identically for a new and an existing address. It will not.

Implementing it is expensive in a way the ticket does not anticipate. Sign-up is Better Auth's route, so answering identically means either rewriting the provider's response in middleware — the approach PD-30 rejected because it breaks OAuth redirects and costs the frontend the machine-readable `code` — or standing our own `/api/v1/register` in front and duplicating a route that already exists, with its own constant-time floor to write and maintain.

The benefit is bounded: PD-36's strict limit already caps a walk at roughly 960 addresses a day from one source. The cost falls on honest users, who are the overwhelming majority — someone who forgot they had registered would see "check your email" instead of a plain answer.

Recorded as an accepted residual in `docs/API.md`, which already carries PD-30's measurement of the same oracle.

### No separate resend route of our own

The provider's is better than one written here: decoy work plus a constant-time floor. Wrapping it would add a second path to keep in step with the first.

---

## Verification plan

| # | Claim | Method |
| --- | --- | --- |
| 1 | Verifying once grants exactly 1,000 | verify, then read `users.currency` and count `GRANT` rows |
| 2 | Verifying twice leaves the balance at 1,000 (**AC1**) | replay the same link, re-read both |
| 3 | Two *concurrent* verifications also leave it at 1,000 | fire two requests at once; this is what the constraint exists for |
| 4 | Balance and ledger move together (**AC3**) | call `grantIfFirstTime` twice from a probe script against the built service; expect one ledger row, one balance move, and no error escaping the second call |
| 5 | An expired token gives a clear error (**AC2**) | sign a token with a past expiry, follow the link, read the `Location` header for `error=TOKEN_EXPIRED` |
| 6 | …and can be re-requested | `send-verification-email`, confirm a fresh mail, follow it, expect success |
| 7 | An unverified account cannot sign in | expect 403 `EMAIL_NOT_VERIFIED` |
| 8 | …and gets a fresh mail automatically | confirm a new message in Mailpit after that 403 |
| 9 | A verified account signs in | expect 200 |
| 10 | The verification link no longer lands on a 404 | follow it, confirm the redirect target is `WEB_BASE_URL` |
| 11 | The resend cooldown holds | two resends in quick succession produce one mail |
| 12 | `send-verification-email` is strictly limited | exceed the strict limit, expect 429 |

Measurement 5 needs a token that is already expired. Booting with `AUTH_VERIFICATION_TTL` set to a couple of seconds and waiting is simpler and more faithful than forging a JWT by hand, so the token lifetime becomes configuration — which the ticket's "token expiry enforced" wants documented anyway.

---

## Files

| Path | Change |
| --- | --- |
| `apps/api/prisma/schema.prisma` | `@@unique([userId, type, refId])` on `CurrencyTransaction` |
| `apps/api/prisma/migrations/…` | the generated migration |
| `apps/api/src/common/errors/prisma-error.ts` | export `isUniqueViolation` |
| `apps/api/src/economy/welcome-grant.service.ts` | **new** |
| `apps/api/src/economy/economy.module.ts` | **new** |
| `apps/api/src/economy/index.ts` | **new** |
| `apps/api/src/app.module.ts` | import `EconomyModule` |
| `apps/api/src/auth/auth.factory.ts` | `requireEmailVerification`, `sendOnSignIn`, `afterEmailVerification`, `withCallback`, the cooldown |
| `apps/api/src/auth/auth.module.ts` | build the `AuthDependencies` object |
| `apps/api/src/config/env.schema.ts` | `WEB_BASE_URL`, `MAIL_RESEND_COOLDOWN`, `AUTH_VERIFICATION_TTL` |
| `apps/api/src/config/app.config.ts` | the three values |
| `apps/api/src/redis/cache.keys.ts` | `throttleKeys.resend` |
| `apps/api/src/throttle/auth-throttle.middleware.ts` | `send-verification-email` joins `CREDENTIAL_PATHS` |
| `.env.example` | the three variables |
| `apps/api/src/auth/README.md` | mandatory verification, the redirect-shaped error, the cooldown |
| `docs/API.md` | the verification flow and the accepted enumeration residual |

## Out of scope

The frontend `/verify-email` page that reads `?error=TOKEN_EXPIRED` — M13. A repair path for a grant that failed after verification — M10 admin tooling; the constraint makes any such retry safe. Deliverability, which mandatory verification now makes a release blocker — PD-126. The identical-response pattern on sign-up, declined above with its reasoning.
