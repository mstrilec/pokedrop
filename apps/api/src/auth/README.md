# Auth module

Better Auth, mounted inside the API. Everything provider-specific is behind this folder so it can be replaced without touching the rest of the application.

## Why here and not in the frontend

Auth.js would have put session handling in the Next.js app, splitting the source of truth from the service that owns the data. With the handler inside NestJS, the same Prisma client writes `users`, `sessions` and `accounts` as writes `inventory_items` and `trades` — one connection pool, one transaction boundary, one place to look. Lucia, the other candidate, is deprecated.

See `docs/PRD.md` §12 for the full comparison.

## Shape

| File | Holds |
| --- | --- |
| `auth.factory.ts` | the entire provider configuration |
| `auth.module.ts` | builds the instance from `PrismaService` and `APP_CONFIG` |
| `auth.constants.ts` | the injection token and the mount path |

`buildAuth` takes `PrismaService` rather than constructing its own client. That is what makes "sessions and accounts are written by the same client as domain tables" true by construction — there is no second pool available to it.

## Four things that will break it

**`user.fields` renames two columns.** The schema calls them `displayName` and `avatarUrl`; Better Auth's core calls them `name` and `image`. Delete the mapping and every query goes looking for columns that do not exist.

**`input: false` on `role` is load-bearing.** Measured against the real database during PD-22:

```
input: false → role=MEMBER   (a sign-up body carrying role:"ADMIN" is ignored)
input: true  → role=ADMIN    (the sign-up body made itself an administrator)
```

One flag is the whole distance between a public registration form and an admin account. Verified again over HTTP here: a sign-up posting `role: "ADMIN"` and `currency: 999999` produced `MEMBER` and `0`.

**The handler needs the raw body, so `bodyParser: false` is set on `NestFactory.create`.** That disables parsing for *every* route, so `main.ts` re-adds `express.json()` immediately after mounting the handler and **before `app.init()`** — a parser registered after init sits behind the Nest router and leaves every controller with an empty body. Verified: a Nest route still receives both JSON and form-encoded bodies.

**It is registered as a route, not a mount.** `app.use('/api/auth', handler)` would strip the prefix from `req.url`, and Better Auth routes on the full path.

## Endpoints

Better Auth's own, outside the versioned prefix, verified against the running handler:

`POST /api/auth/sign-up/email` · `POST /api/auth/sign-in/email` · `POST /api/auth/sign-out` · `GET /api/auth/get-session` · `GET /api/auth/verify-email` · `POST /api/auth/send-verification-email` · `POST /api/auth/request-password-reset` · `POST /api/auth/reset-password`

Note `sign-up/email` and `get-session` — not `sign-up` and `session`, which is what `docs/API.md` claimed until this was checked.

## Mail

Two messages, both Better Auth's own flows. The provider generates the token, builds the URL and enforces expiry and single use; this module only delivers.

| Trigger | Template | What the link does |
| --- | --- | --- |
| sign-up | `verificationEmail` | `GET /api/auth/verify-email?token=…&callbackURL=…` — verifies, then redirects |
| `POST /api/auth/request-password-reset` | `passwordResetEmail` | `GET /api/auth/reset-password/{token}?callbackURL=…` — 302 to `{callbackURL}?token={token}` |

Note the asymmetry, verified against the running handler rather than transcribed: the verification token is a **query parameter** while the reset token is a **path segment**, and the reset link does not itself change anything — it bounces the browser to a page that then posts the new password to `POST /api/auth/reset-password`.

**`sendOnSignUp: true` is load-bearing.** Its default is `undefined`, which means "follow `requireEmailVerification`" — and that is `false`. Remove the line and no verification mail is ever sent, which looks exactly like a broken transport.

**Delivery failure is logged, not raised.** Better Auth writes the user row before calling the callback, so failing the response would report a failed sign-up for one that partly succeeded, and the caller's retry would then hit "that address is already taken". Measured with the relay unreachable: sign-up returns 200, the user row exists, and the log carries

```
Failed to deliver "Confirm your PokeDrop email": connect ECONNREFUSED 127.0.0.1:1099
```

The recovery path is `send-verification-email`, which is the provider's own and already existed — see below.

**The boot does not depend on the relay.** `MailService` does not call `transporter.verify()` at startup, unlike `RedisService`, which pings and fails the boot on a bad URL. Redis is on the path of every request — the cache, and the rate limiter since PD-36; mail is on two flows that already treat a delivery failure as non-fatal.

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

Note that the Prisma client logs the caught unique violation at `error` level, because its log configuration is warn+error. `WelcomeGrantService`'s `debug` line is the authoritative outcome — the expected path is not a failure.

### Password reset

Almost all of it is the provider's. `consumeVerificationValue` (`password.mjs:29`) consumes rather than reads, so a token is single-use by construction — a replay answers `INVALID_TOKEN`, measured. `revokeSessionsOnPasswordReset: true` is one flag and does the rest: two live sessions went to zero, and both cookies answered `null`.

`AUTH_RESET_TTL` is 15 minutes, deliberately shorter than the verification link's hour. A stolen reset token takes over an account; a stolen verification token only proves an address.

#### The request endpoint was a timing oracle, and the body had nothing to do with it

Both branches of `request-password-reset` already returned the same sentence, and the unknown-address branch already did decoy work. What it had no answer for was the clock. `runInBackgroundOrAwait` (`create-context.mjs:215`) **awaits** unless `advanced.backgroundTasks.handler` is configured, so the branch that found a user paid for a full SMTP exchange:

```
known    1081.0 ms
unknown     7.2 ms      (15 samples each, all 200)
```

Configuring a handler detaches the send:

```
known      12.5 ms
unknown     7.3 ms
```

**The residual, stated rather than rounded away:** roughly 5 ms still separates them — the real branch writes a verification row where the decoy branch reads one. That is a 200-fold reduction, not a closure. Removing it entirely would need a constant-time floor across *both* branches, and the only place to impose one is a wrapper around a route this application does not own, which means buffering a third-party handler's responses — rejected three times now, for the reasons in `docs/API.md`.

#### Detaching the send exposed a missing connection pool

`MailService` opened one SMTP connection per message. While sends were awaited one request at a time that was merely wasteful; detached, fifteen concurrent resets opened fifteen connections and **ten died** with `Greeting never received`. Ten mails lost, and nothing in the response said so — a detached send reports only to the log.

`pool: true` with `maxConnections: 3` fixed it: 15 of 15 delivered, zero failures. Worth knowing that this is the shape of every detached-send bug — the response is already 200 by the time the failure happens.

### Two limits on the resend path

`POST /api/auth/send-verification-email` is the provider's own, and is already enumeration-safe: decoy work for an unknown address plus a 500 ms constant-time floor, always answering `{ status: true }`.

It carries the strict rate limit, keyed by caller — it was missed when that list was written in PD-36 and ran under the default 100 per minute until this ticket. Measured before and after: ten calls all passed, then five passed and five were refused.

On top of it, `MAIL_RESEND_COOLDOWN` is keyed by *recipient*, inside the delivery callback, which is the first layer where the address can be read. That is what bounds a distributed flood of one person's inbox, which a per-IP limit cannot.

A suppressed mail is invisible to the caller: the provider's constant-time floor sits above the callback and answers identically either way. It also suppresses the `sendOnSignIn` mail while it holds, which is correct — a valid link is already in that inbox — and lets one through once it lapses. Both measured.

Local mail goes to Mailpit and nowhere else — read it at <http://localhost:8025>.

## Sessions

A session is one opaque token in `sessions.token`, sent as an httpOnly cookie. It lives seven days and its expiry is pushed forward at most once a day while the user is active.

| Attribute | Value | Controlled by |
| --- | --- | --- |
| `HttpOnly` | always on | Better Auth, not configurable |
| `Path` | `/` | not configurable — see below |
| `SameSite` | `Lax` | `AUTH_COOKIE_SAME_SITE` |
| `Domain` | absent (host-only) | `AUTH_COOKIE_DOMAIN` |
| `Secure` + the `__Secure-` name prefix | on in production | `AUTH_SECURE_COOKIES` |

Verified against the real `Set-Cookie` header, one variable at a time:

```
(nothing set)              better-auth.session_token=…; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax
AUTH_COOKIE_DOMAIN=.localhost   …; Domain=.localhost; Path=/; HttpOnly; SameSite=Lax
AUTH_SECURE_COOKIES=true   __Secure-better-auth.session_token=…; Path=/; HttpOnly; Secure; SameSite=Lax
```

Note that the last one moved two things. `secure` is deliberately driven only by `useSecureCookies`, never through `defaultCookieAttributes`, because Better Auth derives both the attribute and the name prefix from that one expression (`cookies/index.mjs:34`). Two switches could disagree; one cannot.

`SameSite=None` without `Secure` is refused at boot:

```
Error: Invalid environment configuration:
  · AUTH_COOKIE_SAME_SITE: AUTH_COOKIE_SAME_SITE=none requires secure cookies. …
```

Browsers discard such a cookie without reporting anything, so the symptom is a sign-in that returns 200 and leaves the user signed out — a failure with no error in the browser or the log. Refusing it at boot is worth more than any amount of documentation about it.

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

Better Auth defaults `freshAge` to one day, which put the gate on the wrong endpoint: the three calls that *fix* a compromise stayed open for the full seven days, while the one call that makes a compromise *visible* closed after twenty-four hours. Measured by backdating `sessions.createdAt` three days and issuing both requests from the same session:

```
list-sessions          {"message":"Session is not fresh","code":"SESSION_NOT_FRESH"}
revoke-other-sessions  {"status":true}
```

`freshAge` is therefore set to the session lifetime. Not to `0`, which disables the check globally and permanently, including for the re-authentication that PD-32 and a future account deletion will want.

## Regenerating the schema

The CLI moved to the `auth` package; `@better-auth/cli` is stranded two minors behind and would emit a stale schema.

```bash
npx auth@latest generate --adapter prisma --config ./auth.ts
```

It needs an importable `auth.ts` exporting the instance, which this module does not provide — the real one is built through DI. Write a throwaway harness that calls `buildAuth`, diff the output against `prisma/schema.prisma`, then delete it. Four differences are expected and deliberate: our `@@map` to plural snake_case, `@default(cuid())` on ids, the `Role` enum where the generator emits `String`, and the `prisma-client-js` generator.

## Replacing the provider

`AUTH_INSTANCE` is a token, not a class, so consumers depend on the shape rather than on Better Auth. A replacement needs to:

1. Provide something under `AUTH_INSTANCE` with a `handler` a Node adapter can mount.
2. Keep writing the four tables in `prisma/schema.prisma`, or migrate them.
3. Preserve `input: false` semantics for `role` and `currency`, or enforce the equivalent elsewhere — this is the part that is easy to lose in a migration and expensive to discover afterwards.

The guard and decorators are deliberately not here: they are the application's, not the provider's, so swapping providers does not touch them.
