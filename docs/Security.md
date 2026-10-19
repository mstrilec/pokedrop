# Security

Who a request is, what it may do, and what stops it doing more — on one page. Each section names the code that enforces it and the document that holds the detail and the measurements. Nothing here is new behaviour; it collects what [API.md](API.md), [`apps/api/src/auth/README.md`](../apps/api/src/auth/README.md), [Frontend.md](Frontend.md) and [Deployment.md](Deployment.md) already establish.

---

## The request path

```
Browser ──HTTPS──▶ Tailscale Funnel ──▶ Next.js (127.0.0.1:3000)
                                          ├─ proxy.ts         sign-in redirect, session renewal, /admin check
                                          ├─ server renders   → API_INTERNAL_URL, forwarding cookie + X-Forwarded-For + Origin
                                          └─ /api/* rewrite   → api:4000
                                                                 ├─ /api/auth/*  auth limiter → Better Auth handler
                                                                 └─ /api/v1/*    CsrfGuard → SessionGuard → ThrottlerGuard → RolesGuard
                                                                                 → ZodValidationPipe → controller → service (assertOwner)
```

- **The browser talks to one origin.** Every API call goes through the web app's `/api/*` rewrite, so the session cookie is host-only on the web origin and CORS plays no part for browser traffic. `CORS_ORIGINS` still matters: it is the trusted-origin list for CSRF on both halves.
- **Only the web server is reachable.** In production the API, Postgres and Redis publish no port, and the web server is bound to `127.0.0.1` — Docker's port publishing bypasses `ufw`, so `0.0.0.0` would be open to the LAN ([Deployment.md](Deployment.md)).
- **`proxy.ts` is not access control.** It redirects a visitor without a session cookie and keeps non-admins out of `/admin` renders; the API refuses everything the session does not allow, whatever the web app rendered.

## Authentication

**Better Auth 1.7, inside the API** (`apps/api/src/auth/auth.factory.ts`), mounted on Express at `/api/auth/*` ahead of the Nest router and writing through the same `PrismaService` as the domain. Email and password only — no OAuth provider is configured.

| Concern | As built |
|---|---|
| Passwords | Hashed by Better Auth on `accounts.password`; there is no `passwordHash` on `users`. 12–128 characters (`PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_LENGTH` in `@pokedrop/shared`, the same bounds given to Better Auth) |
| Registration | `role`, `currency` and `suspendedAt` are `input: false` — a sign-up body carrying `role: "ADMIN"` produces a `MEMBER`. Display name and avatar URL are validated with `ProfileIdentitySchema` (avatar must be `https`) |
| Email verification | Mandatory: an unverified sign-in is 403 `EMAIL_NOT_VERIFIED` and mails a fresh link. Link lifetime `AUTH_VERIFICATION_TTL` (1 h). Verification grants 1,000 coins once |
| Password reset | Single-use token, `AUTH_RESET_TTL` (15 min), revokes every session. The request endpoint answers identically for known and unknown addresses, and its mail is sent in the background so timing does not reveal which (about 5 ms residual, measured) |
| Profile changes | Only through `PATCH /api/v1/users/me`; Better Auth's `update-user` is disabled |
| Password change | `POST /api/auth/change-password`, checks the current password, strict rate limit |
| Suspension | A session-creation hook refuses a suspended account; `SessionGuard` deletes any session that slipped through; the suspending transaction deletes the rest |

### Sessions and tokens

- **One opaque token** in `sessions.token`, sent as the httpOnly cookie `better-auth.session_token` — `__Secure-better-auth.session_token` with `Secure` when `AUTH_SECURE_COOKIES` is on (the default in production).
- **No JWT and no refresh token.** A session lives 7 days and Better Auth pushes its expiry forward at most once a day while it is used; the token stays the same, so there is nothing to rotate. Theft is therefore not detectable, but it is visible and revocable: `list-sessions`, `revoke-session`, `revoke-other-sessions`, `revoke-sessions`.
- **Cookie attributes:** `HttpOnly`, `Path=/`, `SameSite=Lax` (`AUTH_COOKIE_SAME_SITE`), host-only unless `AUTH_COOKIE_DOMAIN` is set. `SameSite=None` without secure cookies is refused at boot, because browsers drop such a cookie silently.
- **The web app renews the cookie.** `/api/v1` extends a session in the database but does not return a refreshed cookie, so `proxy.ts` calls `/api/auth/get-session` once every 12 hours per browser (the `pokedrop.session-refreshed` marker cookie) and passes its `Set-Cookie` on.
- **`AUTH_SECRET`** (≥ 32 characters) signs cookies and verification tokens; rotating it signs everyone out.

## Authorization

- **Protected by default.** The global `SessionGuard` resolves the session on every `/api/v1` request; `@Public()` is the explicit exception. A forgotten decorator is a 401, never a leak.
- **Two roles,** `MEMBER` and `ADMIN`, checked by `RolesGuard` from `@Roles(Role.ADMIN)`. The role is read from the database on every request, so a promotion or demotion applies on the next request. The last active admin cannot be demoted, and an admin cannot change their own role.
- **Identity comes from the session only.** Handlers take the caller from `@CurrentUser()`, never from a body, query or path.
- **Ownership is not a role.** `assertOwner` (`apps/api/src/common/ownership.ts`) has no admin bypass; every admin power is its own route behind `@Roles`, and every admin write is audited ([DataModel.md](DataModel.md), AuditLog).
- **Not-yours reads as not-found.** Another member's private deck or trade answers 404, not 403, so ids cannot be probed.
- **The first admin** is promoted by SQL on the host; there is no path to `ADMIN` through the API ([Deployment.md](Deployment.md)).

## CSRF

- **`/api/v1/*`:** `CsrfGuard`, first in the guard chain, refuses a `POST`, `PUT`, `PATCH` or `DELETE` that carries the session cookie without an `Origin` in `CORS_ORIGINS`. Requests without the cookie pass — there is no ambient credential to abuse.
- **`/api/auth/*`:** Better Auth's own origin check (`MISSING_OR_NULL_ORIGIN`, `INVALID_ORIGIN`).
- **Server renders** send `Origin: WEB_ORIGIN`, which must therefore be in `CORS_ORIGINS`.
- `SameSite=Lax` is the second layer.

## Rate limits

Two enforcement points sharing one Redis store (`throttle:*` keys, outside the cache namespace so a cache flush cannot reset them):

| Policy | Default | Applies to |
|---|---|---|
| strict | 10 per 15 min, per address | `sign-in/email`, `sign-up/email`, `request-password-reset`, `reset-password`, `send-verification-email`, `change-password` |
| moderate | 30 per min | pack open, trade propose / accept / counter, `POST /decks/random`, `GET /users?q=` |
| default | 100 per min, per user (else address) | every other `/api/v1` route; health probes are exempt |

On top: a per-recipient cooldown on verification mail (`MAIL_RESEND_COOLDOWN`), a per-card cooldown on price refresh (`PRICE_REFRESH_COOLDOWN`), and, in production only, Better Auth's in-memory limiter — three failed sign-ins within ten seconds answer 429.

**`TRUST_PROXY_HOPS` decides which address is the client.** It is `1` in production, where Funnel sets `X-Forwarded-For` from the real connection and Next passes it on. Too low and everyone shares one bucket; too high and a client picks its own. **When Redis is down there are no limits** — a limiter is abuse mitigation, not access control, and failing closed would make Redis a single point of failure ([API.md](API.md), Conventions).

## Input and output

- Every body and query is parsed by a Zod schema through `ZodValidationPipe`; unknown fields are rejected. The OpenAPI document is generated from the same schemas, and the API refuses to start with an undocumented route.
- Every `/api/v1` failure is the envelope `{ statusCode, error, message, code?, requestId }`; 5xx answers carry a fixed message, the cause goes to the log under the same request id. A unique violation becomes a generic 409 so constraint names do not leak.
- The web client parses every response with the shared schema too; a mismatch is a `contract` error rather than bad data on screen.
- `helmet()` sets the API's response headers.

## Money and items

Correctness here is a security property: a race that mints a card or spends a coin twice is an exploit.

- Pack opens and trade settlements run in one transaction each, taking rows in a fixed order so they cannot deadlock each other ([DataModel.md](DataModel.md), Trade).
- Idempotency is a unique index, never a read-then-write check: `PackOpening.openId`, `CurrencyTransaction (userId, type, refId)`. The Redis pack-open lock is an optimisation on top.
- Check constraints are the backstop: no negative balance, no negative or over-locked inventory, no self-trade ([DataModel.md](DataModel.md), Check constraints).
- Escrow: offered copies are locked while a trade is pending; available = quantity − locked.

## Secrets

| Secret | Where it lives |
|---|---|
| `AUTH_SECRET` | `.env.production` on the host, mode 600, never committed |
| `POSTGRES_PASSWORD` (and in `DATABASE_URL`) | the same file |
| `MAIL_SMTP_URL` — a Gmail app password | the same file |
| `POKEMONTCG_API_KEY` | unset: the keyless budget is used |

The API reads its environment through `env.schema.ts` and nothing else; the one `process.env` outside `config/` is `common/throttle.ts`, which runs the same parser because a decorator cannot inject `APP_CONFIG`. The frontend never calls a Pokémon API from the browser and holds no secret — PokéAPI, its one request-time call, is keyless and server-side.

**Logs** carry an allowlist of request headers, never request bodies, and only the status of a response; `cookie`, `authorization` and `set-cookie` are also redacted as a second layer. The URL is logged with its query string, so nothing token-bearing may go into one without a redaction rule first ([Architecture.md](Architecture.md), Logging).

## Known gaps

Accepted for v1 and recorded so nobody mistakes them for oversights:

- **No detection of a stolen session** — no rotation to detect reuse; sessions are revocable instead.
- **The web app sends no security headers of its own** — no Content-Security-Policy, no HSTS, `X-Powered-By` left on. HTTPS is Funnel's.
- **No account deletion** — trades are `Restrict` on both users, so deletion will have to anonymise ([DataModel.md](DataModel.md), Trade).
- **No backups** — a lost volume is lost accounts ([Deployment.md](Deployment.md), Data).
- **Card images are hotlinked** from provider CDNs, some on `images.scrydex.com` ([Architecture.md](Architecture.md) §3).
- **`pnpm audit --prod` reports two highs** pinned by the Prisma CLI and unreachable here ([Foundation.md](Foundation.md), Traps).
- **No automated tests** — every claim above was verified by hand when it was built ([PRD.md](PRD.md) §20).
