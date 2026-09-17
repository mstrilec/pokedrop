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
