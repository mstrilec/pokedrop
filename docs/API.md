# API Reference

> REST, JSON, versioned under `/api/v1`. Swagger served at `/docs`.
> Entities in [DataModel.md](DataModel.md); auth details in [Architecture.md](Architecture.md) and [UserFlows.md](UserFlows.md).

## Conventions

- **Versioning:** all endpoints under `/api/v1` (auth handlers mounted under `/api/auth/*`).
- **Pagination:** all list endpoints take `page`, `pageSize` (cursor optional). Validate bounds.
- **Auth:** session cookie or JWT validated by a global `JwtAuthGuard`/`SessionGuard`; `@Public()` opts out. `@Roles(Role.ADMIN)` + `RolesGuard` protect admin routes.
- **Validation:** every DTO validated with Zod (`nestjs-zod`); unknown fields rejected.
- **Ownership:** service-level assertions — never trust client-supplied user IDs.
- **Idempotency:** mutating money/item operations accept an idempotency key (e.g. `openId`).
- **Rate limiting:** `@nestjs/throttler` on auth, pack-open, and trade endpoints.
- **Request correlation:** every response carries `X-Request-Id`. An inbound `X-Request-Id` is adopted when it matches `[A-Za-z0-9._-]{1,128}`, and replaced with a generated one otherwise — the value reaches both the log and the response body, so it is not allowed to carry newlines or unbounded length.

### Standard error envelope

```json
{ "statusCode": 400, "error": "Bad Request", "message": "…", "requestId": "…" }
```

Every failure uses this shape, including requests that match no route — those are answered by a handler mounted behind the Nest router rather than by Express' own HTML page. `error` is always the HTTP reason phrase, never a framework class name. `requestId` matches the `X-Request-Id` response header and the correlated log line.

Responses at 500 and above carry a fixed `"Internal server error"` message; the real cause and its stack go to the log under the same request id. A unique-constraint violation that reaches the filter becomes a 409 with a generic message — services that need a field-specific message ("that email is taken") catch the failure themselves and throw a `ConflictException`.

---

## Auth
> Delegated to Better Auth handlers, mounted under `/api/auth/*`.

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/sign-up` | Register |
| POST | `/auth/sign-in` | Sign in → session/JWT |
| POST | `/auth/sign-out` | Current session |
| POST | `/auth/verify-email` | Activate account (+ welcome grant) |
| POST | `/auth/reset-password` | With reset token |
| GET | `/auth/session` | Current session/user |

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
| GET | `/health/live` | Liveness (`@nestjs/terminus`) |
| GET | `/health/ready` | Readiness (DB + Redis) |
