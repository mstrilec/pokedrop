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

`POST /api/auth/sign-up/email` · `POST /api/auth/sign-in/email` · `POST /api/auth/sign-out` · `GET /api/auth/get-session` · `GET /api/auth/verify-email` · `POST /api/auth/reset-password`

Note `sign-up/email` and `get-session` — not `sign-up` and `session`, which is what `docs/API.md` claimed until this was checked.

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
