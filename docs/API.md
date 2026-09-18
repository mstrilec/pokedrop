# API Reference

> REST, JSON, versioned under `/api/v1`. Swagger served at `/docs`.
> Entities in [DataModel.md](DataModel.md); auth details in [Architecture.md](Architecture.md) and [UserFlows.md](UserFlows.md).

## Conventions

- **Versioning:** all endpoints under `/api/v1` (auth handlers mounted under `/api/auth/*`).
- **Pagination:** all list endpoints take `page`, `pageSize` (cursor optional). Validate bounds.
- **Auth:** **protected by default.** A global `SessionGuard` resolves the Better Auth session on every request; `@Public()` is the deliberate exception. Forgetting the decorator produces a 401, which is noisy and cheap to fix — the opposite polarity would leak a route silently. `@Roles(Role.ADMIN)` + `RolesGuard` protect admin routes.
- **Identity:** handlers take the caller from `@CurrentUser()`, never from a body, query or path parameter. An id sent by the client is a claim; the one on the session is a fact.
- **Validation:** every DTO validated with Zod through the local `createZodDto` helper (`apps/api/src/common/zod-dto.ts`), which also feeds `components.schemas` in the OpenAPI document; unknown fields rejected.
- **Ownership:** `assertOwner(resourceOwnerId, user)` in services — never trust client-supplied user IDs.

  **Ownership is not a role check, and `assertOwner` has no admin bypass.** The obvious-looking `|| user.role === 'ADMIN'` would hand administrators every member capability over every user's data — editing anyone's deck, reading anyone's private inventory — none of which appears in the capability matrix in [PRD.md](PRD.md) §4. What that matrix grants admins is a short, specific list, and each item is its own route behind `@Roles`, where the power is visible and auditable. Verified: an ADMIN session is refused on another user's resource.

  The role is read from the database on every request rather than baked into the session, so a demotion takes effect immediately — verified by promoting a user mid-session without re-authenticating.
- **Idempotency:** mutating money/item operations accept an idempotency key (e.g. `openId`).
- **Rate limiting:** two enforcement points sharing one Redis store, so the limits hold across replicas — verified by exhausting a budget on one instance and being refused by a second that had served nothing.

  | Policy | Default | Applies to | Variables |
  |---|---|---|---|
  | strict | 10 per 15 min | `sign-in/email`, `sign-up/email`, `reset-password`, `request-password-reset`, `send-verification-email` | `THROTTLE_AUTH_LIMIT` / `THROTTLE_AUTH_WINDOW` |
  | default | 100 per min | every other route | `THROTTLE_DEFAULT_LIMIT` / `THROTTLE_DEFAULT_WINDOW` |
  | moderate | 30 per min | pack-open and trade creation, when those routes exist | `THROTTLE_MODERATE_LIMIT` / `THROTTLE_MODERATE_WINDOW` |

  `/api/v1/*` is limited by a Nest guard keyed on the authenticated user, falling back to the address; `/api/auth/*` is limited by an Express middleware keyed on the address, because the Better Auth handler is mounted outside the Nest router where no guard reaches. Health probes are exempt: a 429 from a liveness probe reads to an orchestrator as a dead process, and it would restart a healthy instance on a loop.

  Refusals carry `Retry-After` and the standard envelope — identical from both halves, `{"statusCode":429,"error":"Too Many Requests","message":"Too many requests","requestId":"…"}`. Successful responses carry `X-RateLimit-Limit`, `-Remaining` and `-Reset`.

  **What the strict limit does and does not do.** It is the control that blunts account enumeration, since a duplicate registration necessarily reveals that an address is taken. Ten attempts per quarter hour turns an unbounded walk into roughly 960 addresses a day from one source. That stops a script; it does not stop a botnet, and nothing at this layer does.

  **When Redis is unavailable there are no limits.** Requests are allowed and a warning is logged. A limiter is an abuse mitigation, not an access control — authorization reads Postgres and is unaffected — and failing closed would make Redis a single point of failure for the whole API.

  **`TRUST_PROXY_HOPS` must match the real number of proxies.** It decides which entry of `X-Forwarded-For` counts as the client. Too low and every caller shares one bucket, so the first few requests exhaust the limit for everybody; too high and a client can pick its own bucket by sending the header itself. Both were measured.
- **Request correlation:** every response carries `X-Request-Id`. An inbound `X-Request-Id` is adopted when it matches `[A-Za-z0-9._-]{1,128}`, and replaced with a generated one otherwise — the value reaches both the log and the response body, so it is not allowed to carry newlines or unbounded length.

### Standard error envelope

```json
{ "statusCode": 400, "error": "Bad Request", "message": "…", "requestId": "…" }
```

Every failure **from `/api/v1/*`** uses this shape, including requests that match no route — those are answered by a handler mounted behind the Nest router rather than by Express' own HTML page. `error` is always the HTTP reason phrase, never a framework class name. `requestId` matches the `X-Request-Id` response header and the correlated log line.

**`/api/auth/*` is the exception, deliberately.** Those routes are Better Auth's contract, mounted inside the API but not owned by it — the same reason they sit outside the versioned prefix. Their failures carry Better Auth's own shape:

```json
{ "message": "Invalid email or password", "code": "INVALID_EMAIL_OR_PASSWORD" }
```

A client has to handle both. That is a feature rather than an oversight: `code` is a stable machine-readable discriminator (`INVALID_EMAIL_OR_PASSWORD`, `PASSWORD_TOO_SHORT`, `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, `INVALID_ORIGIN`), and flattening it into our envelope would cost the frontend exactly the information it needs to write a useful message. Reshaping a third-party handler's responses would also mean buffering them, which breaks the moment an OAuth redirect flow is added.

Responses at 500 and above carry a fixed `"Internal server error"` message; the real cause and its stack go to the log under the same request id. A unique-constraint violation that reaches the filter becomes a 409 with a generic message — services that need a field-specific message ("that email is taken") catch the failure themselves and throw a `ConflictException`.

---

## Auth
> Delegated to Better Auth handlers, mounted under `/api/auth/*`.

Paths below are Better Auth's own, verified against the running handler rather than transcribed — several differ from what this document originally claimed.

**State-changing routes require an `Origin` header** matching the trusted list, on both sides of the mount.

Under `/api/auth/*` this is Better Auth's own check: `POST /auth/sign-out` without one is refused with `MISSING_OR_NULL_ORIGIN`, and with a foreign one, `INVALID_ORIGIN` — CSRF protection, not a bug. Sign-up and sign-in do not require it.

Under `/api/v1/*` this is `CsrfGuard`, which Better Auth's middleware cannot reach: the auth handler is mounted on the Express instance, outside the Nest router, so its protection stopped exactly where ours began. The guard refuses any `POST`, `PUT`, `PATCH` or `DELETE` that carries the session cookie without a trusted `Origin`, and answers in the standard envelope. Requests *without* the session cookie pass — CSRF needs an ambient credential, and refusing them would break every non-browser caller for no gain. Measured:

| Request | Result |
|---|---|
| foreign `Origin`, session cookie | 403 `Cross-origin request rejected` |
| trusted `Origin`, session cookie | passes |
| foreign `Origin`, no cookie | passes |
| no `Origin` at all, session cookie | 403 |
| cross-origin `GET`, session cookie | passes |

`SameSite=Lax` also stops the browser sending the cookie cross-site, but that protection lives in the browser rather than in the service, and it disappears entirely if `AUTH_COOKIE_SAME_SITE` is set to `none`. The guard is what replaces it.

One consequence for the frontend: anything that forwards a user's session cookie from a server — a Next.js server component or route handler acting as a BFF — must send an `Origin` header too. Better Auth already requires that of `/api/auth/*`, so a frontend that can sign a user in already satisfies it.

**Sign-up leaks whether an email is registered**, and this is a measured, accepted residual. A duplicate registration answers 422 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`. Softening the wording would not close it: any status distinct from success is itself the oracle.

Closing it properly means answering identically either way and letting a mail tell the real person which case it was. PD-31 considered that and declined it. Sign-up is Better Auth's route, so an identical answer needs either a middleware that rewrites the provider's response — rejected in PD-30, because it breaks OAuth redirects and costs the frontend the machine-readable `code` — or a second registration route of our own, duplicating one that exists and needing its own constant-time floor. The cost lands on honest users, who would see "check your email" instead of a plain answer, and PD-36's strict limit already caps a walk at roughly 960 addresses a day from one source.

Note the contrast: `POST /auth/send-verification-email` **is** enumeration-safe, because the provider wrote it that way — decoy work for an unknown address and a 500 ms constant-time floor, always answering `{ status: true }`.

Sign-*in* does not leak either: a wrong password and an unknown address return byte-identical responses, and their timings are indistinguishable (81.7 ms against 80.0 ms over 15 samples each), because the provider hashes a dummy password rather than returning early. Requiring verification does not change that — the 403 `EMAIL_NOT_VERIFIED` sits after the password check.

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/sign-up/email` | Register. `role` and `currency` in the body are ignored |
| POST | `/auth/sign-in/email` | Sign in → session cookie |
| POST | `/auth/sign-out` | Current session |
| GET | `/auth/list-sessions` | Active sessions with IP and user agent |
| POST | `/auth/revoke-session` | One session, by token |
| POST | `/auth/revoke-other-sessions` | Every session except the caller's |
| POST | `/auth/revoke-sessions` | Every session, including the caller's |
| GET | `/auth/verify-email` | Activate account and release the 1,000-coin grant. A bad token is a 302 to `{callbackURL}?error=TOKEN_EXPIRED` — never a body |
| POST | `/auth/send-verification-email` | Resend. Enumeration-safe by the provider; strict rate limit plus a per-recipient cooldown |
| POST | `/auth/request-password-reset` | Always answers identically. Single-use token, `AUTH_RESET_TTL` (15 min) |
| POST | `/auth/reset-password` | Consumes the token, sets the password, revokes every session |
| GET | `/auth/get-session` | Current session/user |

These are **not** under `/api/v1`. They are Better Auth's contract, and versioning someone else's URLs buys nothing. The handler owns everything under `/api/auth/*` and answers 404 for anything it does not recognise.

The endpoint that *requests* a reset email does not exist yet — it appears once a mail transport is configured.

## Users / Profile

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/users/me` | member | Own profile + currency |
| PATCH | `/users/me` | member | Edit profile / privacy toggles |
| GET | `/users/:id` | public | Public profile |
| GET | `/users/:id/decks` | public | Public decks |
| POST | `/admin/users/:id/currency` | admin | Grant/adjust currency |
| PATCH | `/admin/users/:id/role` | admin | Promote/demote |

## Catalog

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/cards` | public | Search/filter/sort (`set`, `rarity`, `type`, `q`) |
| GET | `/cards/:id` | public | Detail (from mirror + cached price) |
| GET | `/sets` | public | Set list |
| GET | `/sets/:id` | public | Set detail |

## Inventory

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/inventory` | member | Owned cards + quantities + aggregates |
| GET | `/inventory/summary` | member | Value, completion, counts (cached 5m) |

## Packs

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/packs/templates` | member | Available templates |
| POST | `/packs/:templateId/open` | member | Body `{ openId }` — **idempotent**, transactional |
| GET | `/packs/history` | member | Past openings |

## Decks

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET / POST | `/decks` | member | List / create |
| GET / PATCH / DELETE | `/decks/:id` | member (owner) | Read / edit / delete |
| POST | `/decks/:id/clone` | member | Clone a deck |
| POST | `/decks/:id/validate` | member | Legality check |

## Trades

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/trades` | member | Propose (offered + requested + optional coins) |
| GET | `/trades` | member | Inbox (All / Incoming / Sent / Completed) |
| GET | `/trades/:id` | member (party) | Detail + status timeline |
| POST | `/trades/:id/accept` | member (recipient) | Atomic swap |
| POST | `/trades/:id/decline` | member (recipient) | — |
| POST | `/trades/:id/counter` | member (recipient) | Links a new proposal; original → COUNTERED |
| POST | `/trades/:id/cancel` | member (initiator) | Release locks |
| POST | `/admin/trades/:id/void` | admin | Reverse fraudulent accepted trade |

## Prices

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/cards/:id/price` | public | Latest (cached 1–6h) |
| GET | `/cards/:id/price/history` | public | Sparkline series from `PriceSnapshot` |

## Admin / Sync

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/admin/sync/catalog` | admin | Enqueue catalog sync |
| POST | `/admin/sync/prices` | admin | Enqueue price sync |
| GET | `/admin/sync/status` | admin | Last-run metrics, queue depth |
| GET | `/admin/metrics` | admin | DAU, packs opened, trade volume, freshness |

## Health

| Method | Path | Notes |
|---|---|---|
| GET | `/health/live` | Liveness (`@nestjs/terminus`) — process only, no dependency checks |
| GET | `/health/ready` | Readiness — Postgres and Redis, 200 or 503 |

Health responses are the Terminus report, **not** the standard error envelope:

```json
{
  "status": "error",
  "info": { "redis": { "status": "up", "responseTime": 3 } },
  "error": { "database": { "status": "down", "message": "…" } },
  "details": { "…": "info and error merged" }
}
```

A controller-scoped filter keeps the global exception filter from flattening this into the envelope, which would replace the per-dependency detail with `"Internal server error"` — untrue of a healthy process with a dead dependency. Any other failure from these routes still returns the normal envelope.

Liveness stays dependency-free on purpose: a liveness probe that fails because Postgres is down would have an orchestrator restart a healthy process, which does nothing for Postgres and drops every request in flight. Only readiness reports dependencies, so traffic is withheld while the instance stays alive to recover.
