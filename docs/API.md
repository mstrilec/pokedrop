# API Reference

> REST, JSON, versioned under `/api/v1`. Swagger served at `/docs`, the document at `/docs-json`.

**How the OpenAPI document is built.**

- **Each route carries one annotation**, `@Doc(summary, returns(name, schema))` from `apps/api/src/common/openapi.ts`. The schema is the shared Zod schema the service already parses its answer with, rendered as *output*, so a date is a `date-time` string.
- **Everything else is derived** from the route's own metadata by `applyOpenApiConventions`, so it cannot drift from what the guards enforce:
  - the `session` cookie requirement and a 401 on every route without `@Public()`;
  - `[Admin]`, `x-roles` and a 403 on every route under `@Roles`;
  - query parameters from the `@Query()` DTO's Zod schema;
  - one shared `Error` response — the envelope below — as every operation's `default`.
- **Request bodies** reference their Zod schemas by name.
- **The API refuses to start** if a route has no `@Doc`, or if the document holds an operation no handler explains, so a new route cannot ship undocumented.
- **Verified 2026-09-30** against the running API:
  - 55 operations, every one with a summary and a success description; 52 with a schema, and the rest are a 204, the health reports and the plain-text root;
  - every `$ref` resolves;
  - the route set matches the tables in this file exactly;
  - each operation called anonymously and as a member answered as documented — public never 401, protected 401 without a session, admin 403 for a member.
- **Not in the document:** Better Auth's `/api/auth/*` routes, which live outside the Nest router. They are described in [Auth](#auth).
> Entities in [DataModel.md](DataModel.md); auth details in [Architecture.md](Architecture.md) and [UserFlows.md](UserFlows.md).

## Conventions

- **Versioning:** all endpoints under `/api/v1` (auth handlers mounted under `/api/auth/*`).
- **Pagination:** list endpoints take `pageSize` and either `page` (offset, `pageOf`) or `cursor` (keyset, `cursorPageOf`). A list whose rows change while a user scrolls it — inventory — uses the cursor; the catalog uses pages. Validate bounds.
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
- **How the web app reaches the API** (PD-86). A browser only ever talks to the web app's origin: `/api/*` there is a
  Next rewrite to this API, so the session cookie is host-only on the web origin and CORS plays no part for browser
  traffic. Server renders call the API directly at `API_INTERNAL_URL`, forwarding the visitor's `cookie`, their
  `X-Forwarded-For`, and `Origin: WEB_ORIGIN` for `CsrfGuard`. Two settings follow:

  - **`AUTH_BASE_URL` is the web origin**, so verification and reset links go through the rewrite. Measured
    2026-09-30: the link is `http://localhost:3000/api/auth/verify-email?…` and its 302 lands on the web app's
    `/verify-email`.
  - **`TRUST_PROXY_HOPS` is 1 in production, and only behind an edge proxy.** Every request reaches the API from the
    Next server's socket, and Next never records a trustworthy address: measured with `next dev` and `next start`
    alike, the rewrite forwards a client's `X-Forwarded-For` untouched and adds nothing, and a server render sees one
    only when the client sent none. The address has to come from Caddy or Cloudflare Tunnel in front of Next, which
    set it from the real connection, with Next bound to `127.0.0.1`. With `TRUST_PROXY_HOPS=1` and curl standing in
    for the edge, two addresses drew from two buckets through the rewrite and through a server render alike. Leaving
    it at 0 in production would put every user behind the same sign-in limit — 10 attempts per 15 minutes for the
    whole site.

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

**Domain errors add a `code`.** Most failures carry only the four fields above. A failure a client is expected to act on — not a validation slip or a bug — also carries `code`, a stable `SCREAMING_SNAKE` discriminator; `message` is prose and may be reworded, so clients branch on `code`, never on `message`:

```json
{ "statusCode": 402, "error": "Payment Required", "message": "Not enough coins to open this pack", "code": "INSUFFICIENT_FUNDS", "requestId": "…" }
```

| `code` | Status | Meaning |
|---|---|---|
| `INSUFFICIENT_FUNDS` | 402 | the balance is below the price; also a trade whose payer cannot cover the coins, at proposal or settlement |
| `PACK_UNAVAILABLE` | 409 | a pack template cannot currently produce a card for one of its slots |
| `OPEN_ID_CONFLICT` | 409 | an `openId` was already used by another user, or by this user for another pack |
| `CARDS_UNAVAILABLE` | 409 | Not enough available copies — locked copies do not count. At a trade proposal or counter, or at settlement, where the message names the user and the card |
| `TRADE_NOT_PENDING` | 409 | The trade already left `PENDING`; the message names its status |
| `COUNTER_LIMIT` | 409 | A negotiation already holds 10 trades |
| `SYNC_IN_PROGRESS` | 409 | A catalog sync or price sweep is already queued or running — of the same kind, or the other of the two, which share a provider budget; the message names the job |
| `TRADE_NOT_REVERSIBLE` | 409 | An admin void of an `ACCEPTED` trade cannot be applied: a party no longer has available what they received, or the trade is no longer `ACCEPTED`; the message says which |

The codes are exported from `@pokedrop/shared` as `ERROR_CODES`. Every existing error is unchanged — the key is absent, not `null`, when there is no code.

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

**Sign-up does not say whether an email is registered.** With `requireEmailVerification` on, Better Auth answers a duplicate registration exactly like a new one — 200, `token: null` and a decoy user — and creates nothing. Measured 2026-10-04 (PD-102): signing up again with a verified account's address answered 200 with `emailVerified: false`, and the web app took the visitor to *check your inbox*, as for a new account. Earlier versions answered 422 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`; this document said so until PD-102 measured otherwise. PD-36's strict limit still caps how fast anyone can probe sign-up.

Note the contrast: `POST /auth/send-verification-email` **is** enumeration-safe, because the provider wrote it that way — decoy work for an unknown address and a 500 ms constant-time floor, always answering `{ status: true }`.

Sign-*in* does not leak either: a wrong password and an unknown address return byte-identical responses, and their timings are indistinguishable (81.7 ms against 80.0 ms over 15 samples each), because the provider hashes a dummy password rather than returning early. Requiring verification does not change that — the 403 `EMAIL_NOT_VERIFIED` sits after the password check.

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/sign-up/email` | Register. `role`, `currency` and `suspendedAt` in the body are refused; `name` and `image` are validated as `PATCH /users/me` validates them |
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

**A session rolls forward in the database, but only `/api/auth/*` rolls the cookie.** Sessions last seven days and are
renewed once a day of use (`updateAge`). `SessionGuard` resolves the session for `/api/v1/*` without returning Better
Auth's headers, so the renewal there extends the row and drops the refreshed `Set-Cookie`: the cookie would still expire
seven days after sign-in, signing out an active user weekly. Measured 2026-09-30 with a session's `expiresAt` moved to
five days ahead: `GET /api/v1/users/me` answered 200 with no `Set-Cookie` and moved the row to seven days;
`GET /api/auth/get-session` did the same and carried `Set-Cookie … Max-Age=604800`. The web app's proxy calls
`/api/auth/get-session` before rendering, at most every 12 hours per browser, and passes the cookie on (`docs/Frontend.md`).
Any other client must do the same, and must do it before any `/api/v1` call spends the renewal.

## Users / Profile

**Sign-up validates the name and image** with `ProfileIdentitySchema`, the rules `PATCH /users/me` uses: a display name trimmed to 1–64 characters, an optional `https` avatar URL. Better Auth's own body schema takes any string for both, so `databaseHooks.user.create.before` checks them and refuses with 400 `INVALID_PROFILE`, creating nothing; it also stores the trimmed name. Measured 2026-09-29: an empty name, a blank one, 65 characters, an `x` image and an `http` image each 400 with no user created; `"  Ash K  "` with an `https` image 200, stored as `Ash K`. Accounts created before this check may still hold such values, so `GET /users/me` reads name and avatar as stored — measured: a user with an empty name and `x` avatar read their own profile, 200.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/users/me` | member | Own profile + currency |
| PATCH | `/users/me` | member | Edit profile / privacy toggles |
| GET | `/users/:id` | public | Public profile |
| GET | `/users/:id/decks` | public | That user's public decks, page-paged — see [Decks](#decks) |
| GET | `/admin/users` | admin | Search and page every account — see [Admin / Users](#admin--users) |
| POST | `/admin/users/:id/currency` | admin | Grant or adjust currency, once per `grantId` |
| PATCH | `/admin/users/:id/role` | admin | Promote/demote; never the last active admin |
| POST | `/admin/users/:id/suspend` | admin | Suspend, ending every session and voiding pending trades |
| POST | `/admin/users/:id/unsuspend` | admin | Lift a suspension |

**Two shapes of a user, built separately.** `GET /users/me` is the owner's: `id, email, displayName, avatarUrl, role, currency, createdAt`, `privacy: { showCollectionValue, showSetCompletion }` and `showcase`. `GET /users/:id` is everyone's, signed in or not, and is assembled field by field rather than by removing fields from the full user, so nothing added to `User` later can reach it by accident:

```json
{
  "id": "…", "displayName": "Ash", "avatarUrl": null, "joinedAt": "…",
  "showcase": [{ "id": "base1-4", "name": "Charizard", "…": "…" }],
  "publicDeckCount": 1,
  "collection": { "collectionValueUsd": 1166.87, "pricedCards": 2 },
  "completion": { "uniqueCards": 2, "setCompletion": [{ "setId": "base1", "name": "Base", "owned": 2, "total": 102 }] }
}
```

- **`collection` and `completion` are absent — not `null`, not zero — unless their owner turned them on** (`showCollectionValue`, `showSetCompletion`, both off by default). They come from the cached inventory summary (PD-54), which is only read when one of them is on. The toggles are read from the row on every request, so a change shows on the next one.
- **Never in the public shape:** email, balance, role, the toggles themselves, private decks. Query parameters change nothing about it. An unknown id is 404 `User not found`.
- **`showcase`** is up to six cards the owner chose, in their order, as the inventory's slim card. Only cards still owned appear — a copy locked in a pending trade is still owned; a card traded away drops out on the next read, with no write needed.
- **`publicDeckCount`** — the decks themselves are [`GET /users/:id/decks`](#decks), which the deck module owns.

**`PATCH /users/me`** takes any of:

| Field | Rule |
|---|---|
| `displayName` | trimmed, 1–64 characters |
| `avatarUrl` | an `https` URL up to 2 048 characters, or `null` to clear it |
| `showCollectionValue` / `showSetCompletion` | boolean |
| `showcaseCardIds` | up to 6 distinct card ids, each one the caller holds at least one copy of — otherwise 400 `Not in your collection: …` |

The body is strict: `role`, `currency`, `email` or any other key is a 400 `Unrecognized key`, so there is no route by which a member changes their own role or balance. An empty body changes nothing and returns the profile. The answer is the updated `GET /users/me`.

**This is the only way to change a profile.** Better Auth's own `POST /api/auth/update-user` would write `name` and `image` without this validation, so it is switched off (`disabledPaths` in the auth config) and answers 404.

**Measured, 2026-09-29**, through HTTP with the database checked after each step:

- a new member's `GET /users/me`: email, balance, `role: MEMBER`, both toggles `false`, an empty showcase
- a showcase of two owned cards and a padded name: saved in order, the name trimmed; a card not held, a duplicate, seven ids, `role`, `currency`, `email`, an `http` avatar, a `javascript:` avatar, a blank name, a non-boolean toggle: 400 each, and the row's role, balance and email unchanged; an `https` avatar and `null` both accepted
- `GET /users/:id` signed out and as another member, with and without `?email=true` and similar parameters: the same keys — no email, balance or role anywhere in the body — and no `collection` or `completion` while both toggles were off
- value on: `collection` present, `completion` absent; completion on: both; value off again: `collection` gone from the very next response, not merely emptied
- a showcased card locked in a pending trade still shown; one traded away gone from both shapes while its id stayed in the array; saving it again → 400; the new owner could showcase it
- one public and one private deck: `publicDeckCount: 1`; an unknown id: 404; `GET /users/me` signed out: 401
- `POST /api/auth/update-user` with a name and a `javascript:` image: 404, the row untouched; sign-up, sign-in and `get-session` unaffected
- the public profile with the summary cached: 5 ms through HTTP

## Catalog

Served entirely from the mirror. No route here can reach an external API — `CatalogModule` imports nothing, and the provider tokens live in `SyncModule`, which it does not import. Verified by pointing `POKEMONTCG_BASE_URL` at an unroutable host and watching every route answer 200 in single-digit milliseconds.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/cards` | public | `q`, `set`, `rarity`, `type`, `supertype`, `sort`, `page`, `pageSize` |
| GET | `/cards/:id` | public | 404 when absent |
| GET | `/sets` | public | all 176, unpaginated |
| GET | `/sets/:id` | public | the set plus `cardCount` |
| GET | `/facets` | public | selectable values for every filter, with counts |

**Sorting is `name_asc` or `name_desc`, and `id` always rides along.** 16 216 of the 20 670 cards share a name — `Pikachu` alone appears 134 times — so an order by name alone lets PostgreSQL return ties differently between requests, and offset pagination then shows one row twice and another never. `ORDER BY name, id` plans as an `Incremental Sort` with `Presorted Key: name`, so the btree still does the work. Verified: two pages of 50 share no ids and cover 100 distinct cards.

**`q` matches `%`, `_` and `\` literally.** Prisma's `contains` hands its value to `ILIKE` unescaped, so the service escapes them first (`common/escape-like.ts`, shared with the inventory and admin user searches). Measured 2026-09-29: `q=_` found the two cards whose names hold an underscore ("_____'s Pikachu") where it had matched all 20 670; `q=%` and `q=\` found none.

**`q` is a case-insensitive substring match and is not index-backed.** The database uses a `C` collation, under which only a case-*sensitive* prefix gets an index condition; every case-insensitive form degrades to a filter. Measured on the full catalog: 0.84 ms for a matching query, and 9.0 ms worst case for one matching nothing, which is the only shape that reads all 20 670 rows. `pg_trgm` is the recorded upgrade and is deliberately not taken, because the operator-class index it needs is one Prisma cannot declare — see `DataModel.md` on why a hand-added index reads as schema drift.

`set` and `rarity` are index-backed, and the two together plan as a `BitmapAnd` of both btrees — confirmed against the SQL Prisma actually generates, not a hand-written approximation. `type` matches with array containment and the planner treats it as a filter, because a common type covers a sixth of the table.

**`pageSize` above 100 is rejected, not clamped** — a 400 naming the field. `total` and `totalPages` are always present, and the count that produces them costs about as much as the search itself.

**Card detail, the set list and a set detail are cached for 24 hours**; search is not. The TTL table in `Architecture.md` §8 names no search key, because a filter combination has high cardinality and a low hit rate, so caching one mostly fills Redis with entries nobody asks for twice. The catalog sync invalidates all three on every run that writes.

**Prices are numbers, not strings.** Prisma returns `Decimal` for `latestPriceUsd` and `latestPriceEur`, which `JSON.stringify` turns into a string; the service converts at the boundary so the response matches `CardSchema`. `Decimal(10,2)` fits a JS number exactly, so nothing is lost. This was caught by PD-46's cold-versus-warm check — before it, `CardSchema` rejected every cached card and the cache silently never served one.

**With Redis unavailable every route still answers from the database.** Measured by stopping the container: all four returned 200 in under 70 ms, each logging one warning. That needs `enableOfflineQueue: false` on the client — ioredis otherwise queues commands while disconnected and waits for a reconnection, so the read hangs instead of degrading.

**`/facets` returns the selectable values for every filter, with counts.** Four arrays — `sets`, `rarities`, `types`, `supertypes` — each of `{ value, label, count }`. `label` differs from `value` only for sets, where the value is an id like `base1`; carrying the field on all four costs a duplicated string and saves a consumer one special case. Sets are ordered by release date, the rest by count descending with the value as a tiebreak.

**Every value the endpoint advertises is one search accepts, and the counts agree.** Verified exhaustively rather than by sample: all 234 values were sent back through `/cards`, all 234 were accepted, and every `count` matched that search's `total`. Three consequences follow from holding that property:

- A set with no mirrored cards is omitted. The facet is grouped over cards, not listed from sets, because a set the mirror holds nothing for is a filter that returns an empty page. All 176 sets qualify today.
- Cards with no rarity are excluded from the rarity facet — 303 of them. `CardSearchQuerySchema` cannot express "no rarity", so a null facet would name a value the filter rejects.
- `supertype` was added to `/cards` by this ticket. The facet was in scope and a facet nobody can filter by is a list of values the API advertises and then refuses.

**Facet counts are global, not narrowed by the filters already applied.** Conditional facets would be keyed by a filter combination and could not live under the single `facets` key `Architecture.md` §8 gives a 24-hour TTL.

**The four aggregates are cheap and run about once a day.** Measured against the full catalog: 7.2 ms for rarities (an `Index Only Scan` on `cards_rarity_idx`), 15.5 ms for types, 5.0 ms for supertypes, 9.0 ms for sets. Only the rarity facet is index-backed; the other three read every row, which is correct for an aggregate over the whole table. Cold 24 ms, warm 6 ms, byte-identical.

**The types facet is the only raw SQL outside the sync writer.** `types` is a `text[]` and a facet needs one row per element, which Prisma's query layer has no way to express; the alternative is reading 20 670 arrays into the process to count them. The `count(*)::int` cast is load-bearing — a bare `count(*)` is a bigint, Prisma returns a BigInt, and `JSON.stringify` throws on one.

**A newly synced set appears without a manual flush**, because the catalog sync deletes `cache:facets` at the end of every run that wrote. Verified end to end: inserting a set alone left the facet at 176 even after invalidation, adding a card to it and invalidating again produced 177 with the right count, and the `Fire` count moved 1 589 → 1 590 with it.

**`cardCount` on a set detail is what the mirror holds**, which is not necessarily `total`, what the provider says the set contains. They differ while a sync is still filling in pages that failed.

## Inventory

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/inventory` | member | The caller's cards — filtered, sorted, keyset-paged. Aggregates are `/inventory/summary` |
| GET | `/inventory/summary` | member | Value, completion, counts (cached 5m) |

**`GET /inventory`**

| Parameter | Rule |
|---|---|
| `cursor` | optional, opaque, 1–512 chars; the previous page's `nextCursor` |
| `pageSize` | 1–100, default 24 |
| `q` | optional, 1–100 chars; case-insensitive contains on the card name, `%`, `_` and `\` matched literally |
| `set` / `rarity` / `type` | optional; exact `setId`, exact rarity, one type by array containment — the catalog's rules |
| `minQuantity` | optional integer ≥ 1; rows with `quantity >= N` (2 = duplicates, 4 = a playset) |
| `sort` | `acquired_desc` (default) · `acquired_asc` · `name_asc` · `name_desc` · `price_desc` · `price_asc` |

```json
{
  "items": [
    {
      "id": "clx…", "cardId": "base1-4",
      "quantity": 2, "lockedQuantity": 1, "availableQuantity": 1,
      "acquiredAt": "2026-09-27T13:35:50.807Z",
      "card": {
        "id": "base1-4", "setId": "base1", "name": "Charizard",
        "supertype": "Pokémon", "subtypes": ["Stage 2"], "types": ["Fire"], "hp": 120,
        "rarity": "Rare Holo", "imageSmall": "https://…",
        "latestPriceUsd": 944.53, "latestPriceEur": 1531, "priceUpdatedAt": "2026-09-27T10:04:21.588Z"
      }
    }
  ],
  "pageSize": 24,
  "total": 1,
  "nextCursor": null
}
```

**The caller is the only user this route can read.** It takes no user parameter; `userId` comes from the session and is its own `AND` clause that no filter or cursor branch can widen. `userId` is not echoed on the rows. Verified: a second user sees only their own three rows, and a cursor forged around the first user's item id still returns only the second user's rows. No session is a 401.

**`card` is a slim projection**, not the catalog's full `Card`: what a tile, a dense table and client-side search need. Attacks, abilities and the rest are on the cached `GET /cards/:id`.

**The cursor carries the last row's sort value and id, never a reference to the row.** A settled trade deletes a row whose quantity reaches zero, and a cursor that pointed at that row would break mid-scroll. Verified: deleting the row a cursor was built from, then asking for the next page, continues from the right place. The cursor is tied to the `sort` it was issued under — another sort, a value of the wrong kind or anything that does not decode is a 400 `Invalid cursor`. It is **not** tied to the filters: a client drops it whenever a filter or the sort changes.

**Price means `latestPriceUsd`, and unpriced cards sort last in both directions.** "Cheapest first" should not open on thousands of cards with no price — 16 of 20 670 mirrored cards carry one today, so on real data a price sort is almost entirely the unpriced tail.

**Three SQL statements per request, whatever the page size**: the page, the cards for that page in one batched `SELECT … WHERE id IN (…)`, and the count. Prisma 7.10 loads a nested `select` as that batched second statement rather than as a `JOIN`. Measured at `pageSize` 1, 24 and 100: three each time.

**Measured against 5 000 rows** (2026-09-27; 1 116 distinct names, 50 rows per `acquiredAt` minute, 36 priced cards including 20 with deliberately equal prices). Service time, median of five, `pageSize=100`, first page and a page 40 deep, unfiltered and with `q=a&minQuantity=2`:

| Sort | Unfiltered first / deep | Filtered first / deep |
|---|---|---|
| `acquired_desc` | 4.1 / 4.2 ms | 9.4 / 7.2 ms |
| `acquired_asc` | 3.7 / 3.7 ms | 9.3 / 7.4 ms |
| `name_asc` | 10.0 / 17.0 ms | 13.1 / 17.5 ms |
| `name_desc` | 10.7 / 19.1 ms | 13.6 / 15.2 ms |
| `price_desc` | 10.0 / 6.6 ms | 12.4 / 7.2 ms |
| `price_asc` | 11.2 / 6.8 ms | 14.4 / 7.2 ms |

The budget was 100 ms; the worst case is 19.1 ms, so no index was added. Over HTTP, including session resolution, the six first pages took 18–32 ms. Walking every sort to the end at `pageSize=7` covered all 5 000 rows once, in database order, with unpriced rows strictly last.

**The plan is a hash join and a top-N heapsort.** `EXPLAIN ANALYZE` for `price_asc` and `name_desc`: `Hash Right Join` of `cards` onto the user's rows, then `Sort Method: top-N heapsort`, 12.5 ms and 11.3 ms. The scan of `inventory_items` is sequential because the probe user owned 4 999 of 5 009 rows; at that selectivity the planner is right to skip the `(userId, cardId)` index, and with many users it will not be. `(userId, acquiredAt)` is the first index to add if a real collection ever misses the budget.

**Not cached.** Six sorts times every filter combination per user is high cardinality with a low repeat rate, on the most volatile data a user owns.

**`GET /inventory/summary`**

```json
{
  "totalCards": 14, "uniqueCards": 7,
  "collectionValueUsd": 1967.58, "pricedCards": 3,
  "setCompletion": [
    { "setId": "sv4pt5", "name": "Paldean Fates", "owned": 1, "total": 91 },
    { "setId": "base1", "name": "Base", "owned": 3, "total": 102 }
  ]
}
```

**The totals count locked copies.** A card promised to a pending trade is still owned. `totalCards` sums `quantity`; `uniqueCards` counts distinct cards; rows at quantity 0 count toward neither. `setCompletion` lists only sets the caller owns cards in, newest release first.

**`collectionValueUsd` is informational and unrelated to the pack economy.** It is the sum of `latestPriceUsd × quantity`, summed in cents so per-set decimals do not drift. **`pricedCards` says how much of the collection that value covers** — 16 of 20 670 mirrored cards carry a USD price today, so a value without it reads as a valuation it is not.

**Completion is against `printedTotal`, and never above 100%.** A card counts when the number after `{setId}-` in its id is an integer within `printedTotal`; secret rares and subsets numbered past the printed set do not. 107 of 176 mirrored sets hold more cards than they print — `sv4pt5` holds 245 against 91 — so capping a raw count would call any 91 of those 245 "complete". Sets whose cards carry no integer number at all, promos such as `SM01`, count every card, and `LEAST(owned, printedTotal)` is the backstop. Measured over the whole mirror: this rule puts 160 sets at exactly `printedTotal` and none above it. Verified by owning every card of a set: `sv4pt5` 91/91, `base1` 102/102, `g1` 83/83 (117 cards, `RC` subset excluded), `smp` 248/248 (251 promos, capped).

**One SQL statement, cached for five minutes** under `cache:inv:summary:{userId}`. Measured: one statement cold, none warm; 19.9 ms median cold over 5 000 rows in 50 sets. **Any code that changes a user's quantities calls `InventoryService.invalidateSummary(userId)`** after its transaction commits — pack opening (PD-58) and trade settlement. Raising or lowering a lock does not change the summary and does not invalidate it. A price sync does not invalidate it either: the value can lag prices by up to the TTL.

## Packs

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/packs/templates` | member | Active templates, with contents, odds and the confirm-dialog guarantee |
| POST | `/packs/:templateId/open` | member | Body `{ openId }` — **idempotent**, transactional |
| GET | `/packs/history` | member | The caller's openings with their cards, newest first, keyset-paged |
| GET | `/admin/pack-templates` | admin | Every template, inactive included |
| POST | `/admin/pack-templates` | admin | Create; validated against the card pool; audited |
| PATCH | `/admin/pack-templates/:id` | admin | Partial update, including `active`; audited |

**A template is `{ name, setFilter, cost, slotConfig, active }`.** `setFilter` is `{ "setIds": [...] }` (1–50 sets, no other keys). `slotConfig` is the shape in [UserFlows.md](UserFlows.md) §5: `{ "slots": [{ "count", "weights" }] }`, 1–10 slots, at most 20 cards per pack, integer weights ≥ 0 with at least one positive weight per slot. Unknown keys are rejected at every level.

**Validation has two layers, and both run on save.** The shape is checked by the Zod pipe — the example in UserFlows §5 passes it unchanged. The **pool** is checked by the service: every set in `setFilter` must exist, and every rarity named in any slot's weights must occur among that set's cards, or the save is a 400 naming the missing rarities. Verified: the UserFlows example saves against `bw4` + `bw5`, and the same config against `base1` + `base2` is refused for `"Rare Holo EX", "Rare Ultra", "Rare Secret"`. A `PATCH` that changes neither `setFilter` nor `slotConfig` skips the pool check, so a template whose sets later lose a rarity can still be renamed or deactivated.

**Weights are an unordered map.** The column is `jsonb`, which stores object keys in its own order (shorter keys first), so `weights` reads back with the same entries in a different order. Slot order is preserved. Nothing may depend on the order of a slot's weights — including a fallback from an empty rarity bucket, which needs its own ordering.

**There is no delete.** Openings reference their template with `Restrict`, and a player's history has to keep saying which pack they opened. Retire a template with `PATCH { "active": false }`; members stop seeing it at once.

**Every create and update writes one `AuditLog` row in the same transaction** — `pack_template.create` / `pack_template.update`, entity `PackTemplate`, the submitted body in `meta`. A refused save writes none. Verified: eleven refused saves, zero rows. The writer is `AuditService.record(tx, entry)` in `apps/api/src/audit`; PD-79 wires the remaining admin actions to it.

### How a pack is drawn

`apps/api/src/packs`: `pack-rng.ts`, `pack-generator.ts`, `pack-pool.ts`. The generator is a pure function of `(slotConfig, pool, rng)` — it imports nothing from Prisma or Nest and writes nothing.

**The randomness is HMAC-SHA256 in counter mode over a 32-byte random seed.** `crypto.randomInt` cannot be seeded, and a stored seed has to reproduce the pack. Integers come from rejection sampling (`limit = 2³² − 2³² mod max`), so there is no modulo bias. Measured over 1 000 000 draws in 64 bins: χ² 65.0 at `max = 3·2³⁰` (about 25% of raw draws rejected) and 81.5 at `max = 2³¹ + 1` (about 50%), against a limit of 103.5 at α = 0.001.

**Each slot's rarities form a ladder: weights above zero, weight descending, ties by name.** It is computed, never read from the order of `weights`, which `jsonb` does not keep. A weight of 0 takes no part — it is never rolled and never a fallback.

**Every card is two draws**: a rarity by cumulative weight, then a card uniformly from that rarity's bucket. Draws are independent, so duplicates within a pack are allowed — four Commons from the seed template's 48 contain a pair in about 12% of packs.

**An empty bucket falls back down the ladder, then up.** The next more common non-empty rarity in the same slot first; if every commoner bucket is empty, the nearest rarer one — a rarer card only when no commoner card exists. A slot with no cards at all throws `EmptySlotError`, which `POST /packs/:templateId/open` answers with 409 `PACK_UNAVAILABLE`, nothing charged. The emitted `rarity` is the bucket the card came from, and every fallback is returned; the open logs each one as a warning naming the template. Because PD-56 refuses a template naming a rarity absent from its sets, a fallback means the catalog changed after the template was saved.

**The pool is one query**: cards in the template's sets that have a rarity, grouped by rarity, **each bucket sorted by id in code-unit order in JavaScript** — the generator indexes into that order, so it is part of what a seed reproduces, and it must not follow the database's collation, which could differ on another server. The 303 cards without a rarity can never be pulled. Not cached: the largest pool a template can name (the 50 biggest sets, 10 646 cards over 30 rarities) loads and yields a pack in 20.3 ms median (18.9–23.3).

**The seed is stored as hex in `PackOpening.seed`, never sent to a client.** Replaying `(slotConfig, pool, seed)` reproduces a pack exactly while the pool is unchanged; a catalog sync that adds or reclassifies a card in those sets changes the pool and the replay with it. `PackOpeningCard` stays the record of what was actually given.

**Measured, 2026-09-27**, 100 000 packs from fixed seeds (810 ms), χ² at α = 0.001:

| Check | χ² | Limit |
|---|---|---|
| a `72/20/5/2/1` rarity slot against its weights — observed 71 879 / 20 059 / 5 066 / 1 960 / 1 036 | 3.34 | 18.72 |
| the same draws against weights with one entry corrupted by 10% — must fail | 3 257 | 18.72 |
| a two-card `3/1` slot | 0.04 | 11.16 |
| card counts inside a 48-card bucket against uniform | 43.24 | 82.80 |

Critical values are the Wilson–Hilferty approximation. These checks stand in for PD-61's statistical suite until automated tests resume.

### What a member sees of a template

`GET /packs/templates` returns each active template with two derived fields, so the confirm dialog renders from this response alone:

```json
{
  "id": "seed-template-base", "name": "Base Set Booster", "cost": 300, "…": "the template",
  "contents": {
    "cardCount": 8,
    "slots": [
      { "count": 4, "odds": [{ "rarity": "Common", "percent": 100 }] },
      { "count": 3, "odds": [{ "rarity": "Uncommon", "percent": 100 }] },
      { "count": 1, "odds": [{ "rarity": "Rare", "percent": 75 }, { "rarity": "Rare Holo", "percent": 25 }] }
    ]
  },
  "guarantee": "8 cards: 4 Common, 3 Uncommon, 1 Rare or better."
}
```

**`odds` follow the generator's ladder** — weight descending, ties by name — so the first entry of a slot is its most common rarity, and `percent` is its share of the slot's weight, rounded to 0.1. Publishing the odds is deliberate: they are exactly what the draw uses.

**`guarantee` reads each slot's floor off that ladder.** A single-rarity slot is "4 Common"; a slot with several rarities is "1 Rare or better", because every other rarity in it is rarer by the same rule the draw's fallback uses. "This action can't be undone" is interface copy and stays in the frontend. Verified on the seed template: exactly the sentence above, and 75 / 25 in that order.

### Opening history

`GET /packs/history?cursor=…&pageSize=…` — the caller's openings only; no parameter names a user. `pageSize` 1–100, default 24.

```json
{
  "items": [
    {
      "openingId": "clx…", "openId": "1b4e28ba-…", "templateId": "seed-template-base",
      "templateName": "Base Set Booster", "createdAt": "2026-09-27T19:02:11.412Z",
      "cards": [{ "position": 0, "cardId": "base1-68", "rarity": "Common", "card": { "…": "the inventory's slim card" } }]
    }
  ],
  "pageSize": 24, "total": 6, "nextCursor": null
}
```

**Newest first, by a keyset cursor over `(createdAt, id)`,** for the same reason as the inventory: openings arrive at the top while someone scrolls, and offsets would repeat one. The cursor is opaque; one that does not decode, names a year-zero date or an id outside `[A-Za-z0-9_-]` is a 400. `openId` is any string here, because openings made before PD-58 were not keyed by a UUID. The seed is never returned.

Verified, 2026-09-27: five openings walked two at a time came back once each, newest first, with a sixth opened in the middle of the walk shifting nothing; every entry's cards matched the database in pull order; another user saw none of them, including through a cursor forged around one of them; no session is a 401.

### Opening a pack

`POST /packs/:templateId/open` with `{ "openId": "<uuid>" }` — a UUID the client generates once per intended opening and sends again on every retry of it. Member-only, throttled at the moderate policy (30 per minute per user).

```json
{
  "openingId": "clx…", "openId": "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
  "templateId": "seed-template-base", "createdAt": "2026-09-27T19:02:11.412Z",
  "balance": 700,
  "cards": [
    { "position": 0, "cardId": "base1-68", "rarity": "Common", "card": { "id": "base1-68", "name": "Voltorb", "…": "the inventory's slim card" } }
  ]
}
```

**Always 200, for a new opening and a replay alike.** `cards` is in pull order — `position` 0…n−1, the order the reveal plays them — and `card` is the same slim projection `GET /inventory` returns. `balance` is the balance after this opening, or the current balance on a replay. The pack's seed is never in a response.

| Case | Status | `code` |
|---|---|---|
| no session | 401 | — |
| `openId` not a UUID | 400 | — |
| template missing **or inactive** | 404 | — |
| balance below the price | 402 | `INSUFFICIENT_FUNDS` |
| a slot with no cards at all | 409 | `PACK_UNAVAILABLE` |
| `openId` used by another user, or for another template | 409 | `OPEN_ID_CONFLICT` |
| over the throttle | 429 | — |

An inactive template answers 404 rather than 403: members cannot see inactive templates, so the route does not confirm they exist.

**Generation happens outside the transaction; the transaction only writes, and its first write claims the `openId`.** In order: insert the opening (with its seed) → debit with `UPDATE users SET currency = currency - cost WHERE id = … AND currency >= cost RETURNING currency` (no row means 402, and everything rolls back) → one `PACK_SPEND` ledger row with `refId = openId`, written even for a free pack → the pulled cards with their positions → one `INSERT … ON CONFLICT DO UPDATE` into the inventory, duplicates summed per card, rows sorted by card id. Claiming first means a duplicate blocks on the unique index before it ever touches the balance.

**Correctness rests on two unique indexes, not on Redis.** `PackOpening.openId` and `CurrencyTransaction (userId, type, refId)`: a second transaction with the same `openId` waits on the index until the first ends, then fails and rolls back whole, debit included, and is answered from what the first recorded. The debit's row lock serialises one user's concurrent openings, so their inventory writes cannot interleave; different users share no rows. `users_currency_non_negative` backs the conditional debit for every other path that will ever touch a balance.

**The Redis lock only makes duplicates cheap.** `SET lock:open:{openId} <token> NX PX 10000` through `RedisService` directly; released after commit by a compare-and-delete script, so an expired lock taken over by another request is never deleted. A request that finds the lock held polls for the opening every 100 ms and answers with it — a double click or a network retry gets the same 200. If the lock disappears with no opening (the first attempt was refused) or 10 s pass, it runs its own attempt; if Redis is unreachable, every request runs without the lock and the unique index does the serialising.

**A replay is answered by the rules below**, wherever the existing opening is found — before the lock, while waiting, or from a unique violation:

| Found opening | Answer |
|---|---|
| same user, same template | 200, the original cards in their original order |
| another user | 409 `OPEN_ID_CONFLICT`, with no cards — another user's pulls never leak |
| same user, another template | 409 `OPEN_ID_CONFLICT` |

**A pulled card already owned gets `acquiredAt = now()`**, so `GET /inventory`'s default `acquired_desc` shows a whole pack at the top, duplicates included. After commit the inventory summary cache is deleted (PD-54's contract).

**Measured, 2026-09-27**, through HTTP against the running API with the database checked after every scenario — these stand in for PD-62's integration suite until automated tests resume:

- one opening: 200; eight cards at positions 0–7; a 64-hex seed stored and absent from the body; the balance down by exactly the price; one `-300` ledger row; every pulled card's quantity up by exactly its pull count and its `acquiredAt` moved to now, no other row touched; the summary cache key deleted
- the same card pulled three times in one pack: one inventory row, quantity +3, three card rows at positions 0–2
- a replay, a replay after the lock's 10 s, and a replay after the template was deactivated: 200 with the original cards, nothing written
- ten simultaneous requests with one `openId`: ten 200s with identical cards; one opening, one ledger row, one debit
- six simultaneous openings with a balance for three: exactly three 200s and three 402 `INSUFFICIENT_FUNDS`; balance 0, never negative
- three simultaneous requests with one `openId` and no funds: three 402s — none hangs waiting for an opening that will not appear, none 500s
- a failure injected into the transaction (a trigger raising on the card insert): 500, and balance, ledger, openings and inventory byte-identical to before
- Redis stopped: ten simultaneous requests with one `openId` — ten 200s, one opening, one debit
- another user's `openId`, and an `openId` reused for another template: 409 `OPEN_ID_CONFLICT`, no cards in the body
- an inactive template, an unknown one: 404; a malformed `openId`: 400; nothing written
- a template whose only slot names a rarity absent from its set: 409 `PACK_UNAVAILABLE`, nothing charged
- after every scenario, for every user in the database: `currency` equals the sum of their ledger rows

## Decks

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET / POST | `/decks` | member | The caller's decks, page-paged / create |
| GET | `/decks/:id` | public | A public deck, or the caller's own; anything else is 404 |
| GET | `/decks/:id/stats` | public | Chart data for a deck the caller can see |
| PATCH / DELETE | `/decks/:id` | member (owner) | Edit / delete |
| POST | `/decks/:id/clone` | member | Copy a visible deck into a private one the caller owns |
| POST | `/decks/:id/validate` | member (owner) | The deck's validation verdict; writes nothing |

**`POST /decks`** and **`PATCH /decks/:id`**

| Field | Rule |
|---|---|
| `name` | 1–64 chars after trimming |
| `format` | `standard` · `expanded` · `unlimited` — the keys of a card's `legalities` |
| `isPublic` | boolean; `false` on create when absent |
| `ownedOnly` | boolean; `false` on create when absent — see *Validation* |
| `cards` | up to 100 `{ cardId, count }`, `count` 1–100, each `cardId` once; `[]` on create when absent |

A PATCH takes any non-empty subset. **`cards` replaces the whole decklist** — the builder saves its draft, not a diff. The bounds are request limits, not deck rules: deck size, the four-copy limit and format legality belong to the validation engine, which reports on every save rather than refusing it — see *Validation* — so an unfinished deck can be saved. An unknown `cardId` is a 400 naming it, and nothing is written; unknown fields are a 400.

```json
{
  "id": "cmul1g1xo…", "userId": "riaTB3…", "name": "Fire", "format": "unlimited", "isPublic": false, "ownedOnly": false,
  "cards": [
    { "cardId": "base1-4", "count": 2, "card": { "id": "base1-4", "name": "Charizard", "supertype": "Pokémon", "…": "…" } }
  ],
  "ownerDisplayName": "Ash",
  "createdAt": "2026-09-28T09:21:38.508Z", "updatedAt": "2026-09-28T09:21:38.508Z",
  "validation": { "valid": false, "…": "…" }
}
```

`validation` is on the owner's save responses only — `POST`, `PATCH` and clone — never on `GET /decks/:id`; its shape is under *Validation*.

`ownerDisplayName` is there for the shareable page; with `userId` it is all a deck says about its owner — never their email. `card` is the inventory's slim projection, so the builder renders a decklist without a request per card. Entries are ordered by `cardId`. `GET /decks` returns `pageOf` summaries: the same fields without `cards`, plus `cardCount` — the sum of copies, not distinct cards — newest `updatedAt` first.

**A private deck is indistinguishable from a missing one.** A read, edit or delete of a private deck by anyone but its owner — signed in or not — gets the same 404 as an id that never existed. A public deck exists for anyone to see, so a stranger's edit or delete of it is an honest 403 from `assertOwner`. `GET /decks/:id` is `@Public()` because the shareable deck page renders signed out.

**Two saves of one deck do not interleave.** The deck row is updated before its cards are replaced, so its row lock makes a second save wait and then replace the first whole; a save always bumps `updatedAt`, a cards-only one included.

**Deleting a deck** removes its `DeckCard` rows by cascade, and nothing else — the catalog cards and the owner's inventory are untouched.

**Measured, 2026-09-28**, through HTTP with the database checked after each step:

- create with `"  Fire  "` and three cards: 201, name stored trimmed, `cardCount` 9 in the list; `pageSize=1&page=2` returned the second deck with `totalPages` 2; another user's list was empty
- a private deck read by another member, read signed out, and an id that does not exist: byte-identical 404 bodies apart from `requestId`
- another member's PATCH and DELETE on a private deck: 404; on a public one, including a cards-only PATCH: 403; signed out: 401 — `decks` and `deck_cards` hashed identical before and after
- a rename, then a cards-only PATCH: 200 both, `updatedAt` advanced each time, the old `DeckCard` rows gone
- a duplicate `cardId`, an unknown card, format `glc`, a blank name, `count` 0 and 101, a client-sent `userId`, an empty PATCH: 400 each, nothing written
- ten simultaneous PATCHes of one deck with different decklists: ten 200s, and the deck ended holding exactly one of the ten lists whole, no mix of two and no error in the log
- delete: 204, then 404 on repeat; the deck and its three `DeckCard` rows gone; the `cards` count, every inventory row and every other deck's rows unchanged

**`POST /decks/:id/clone`** copies any deck the caller can see — their own, or anyone's public one — into a new deck the caller owns. It takes no body and answers 201 with the new deck in the shape above, `validation` included — judged against the cloner's copies. The copy keeps `format`, `ownedOnly` and every `{ cardId, count }`, is always private, and is named `"<name> (copy)"`, the original cut short so the result still fits 64 characters. A private deck that is not the caller's is the same 404 as a missing one, so a clone cannot probe for it either.

**Cloning asks nothing of the caller's inventory.** Owning the cards is a question for `/decks/:id/validate`, in whatever mode it runs, not a precondition of the copy — a planned deck is the point of cloning someone else's.

**The decklist is one INSERT.** The copy is a single `deck.create` whose cards are a nested `createMany`, so a 60-card deck costs one `decks` insert and one multi-row `deck_cards` insert, not a row per card.

**Visibility is `isPublic` on `PATCH /decks/:id`.** Nothing caches a deck, so turning it private takes effect on the next request: the public read, its stats, a stranger's clone and the owner's public shelf (`GET /users/:id/decks`) all stop seeing it at once. Copies already taken stay with whoever took them.

**Measured, 2026-09-28**, through HTTP with Prisma's query log on:

- a member cloning another member's public deck of 15 cards × 4: 201, owned by the cloner, private, named `Sixty (copy)`; identical `(cardId, count)` list; the log showed exactly one `INSERT INTO "public"."decks"` and one `INSERT INTO "public"."deck_cards"`; the cloner owned none of the 60 cards
- another member cloning a private deck, and a missing id: identical 404s; signed out: 401
- the owner cloning their own private deck with a 63-character name: 201, private, a 64-character name ending ` (copy)`
- the source turned private: its public read by the other member and signed out, and a second clone, each 404 at once; the earlier copy still 200 for its new owner

**`GET /decks/:id/stats`** — the numbers behind the builder's charts, for any deck `GET /decks/:id` would show, under the same 404 rule.

```json
{
  "totalCards": 20, "energyCount": 10,
  "supertypes": [{ "name": "Pokémon", "value": 6 }, { "name": "Trainer", "value": 4 }, { "name": "Energy", "value": 10 }],
  "types": [{ "name": "Lightning", "value": 5 }, { "name": "Metal", "value": 2 }, { "name": "Fire", "value": 1 }],
  "rarities": [{ "name": "Common", "value": 13 }, { "name": "Unknown", "value": 4 }, { "name": "Rare Holo", "value": 3 }]
}
```

Every value counts copies. Each series is `{ name, value }` rows — Recharts' `data` as it arrives, with `dataKey="value"` and `nameKey="name"`. `supertypes` always has the three supertypes in that order, zeros included, so a chart keeps its bars in place as a deck fills; `types` and `rarities` hold only what the deck has, largest first, ties by name. `types` is the Pokémon's types — energy cards carry none in the mirror (381 of 394) — and a dual-type Pokémon counts once under each, so it can sum past the Pokémon count. A card with no rarity (303 in the mirror) is `Unknown`.

**One query over the decklist, whatever its length.** After the visibility check, the deck's cards are read in a single `deck_cards ⋈ cards` query and tallied in code; no card is fetched on its own.

**`GET /users/:id/decks`** — a user's public decks, as `pageOf` summaries with the same `page`/`pageSize` as `GET /decks`, newest `updatedAt` first. It is the public shelf, so the owner asking sees exactly what a stranger does; their private decks are `GET /decks`. An unknown user is a 404 `User not found`; a user without public decks is an empty page. It lives in `DecksModule` because it is a deck query — the users module (M9) owns the profile, not its decks.

**A private deck is in no public response.** `GET /decks/:id`, `/decks/:id/stats` and `/users/:id/decks` read `isPublic` from the row on every request; nothing is cached, so a deck turned private leaves all three at once.

**Measured, 2026-09-28**, through HTTP with Prisma's query log on:

- a public deck of 2 × a Lightning/Metal Pokémon, 4 × a Trainer with no rarity, 10 × a basic energy, 1 × Charizard and 3 × a Lightning Pokémon, read signed out: the response above, `totalCards` and `energyCount` matching a hand-written SQL sum; the log showed one `decks` read for visibility and one `deck_cards` query for the stats
- an empty public deck: zeros, the three supertypes present, empty `types` and `rarities`
- a private deck's stats signed out, by another member, and a missing id: identical 404s; by its owner: 200
- the public deck's detail signed out: `ownerDisplayName` present; no `@example.com` in it or in the shelf
- the shelf signed out and as its owner: the same two public decks, `cardCount` 20 and 0, the private one absent; `pageSize=1&page=2`: the second; a user whose only deck is a private clone: empty; an unknown user: 404; `pageSize=500`: 400
- the public deck turned private: gone from the shelf and its stats 404 on the next request, still in its owner's `GET /decks`

### Validation

**`POST /decks/:id/validate`** takes no body and answers 200 with the verdict on the deck as saved. The same verdict rides on every save: `POST /decks`, `PATCH /decks/:id` and `POST /decks/:id/clone` return the deck plus `validation`, computed inside the save's transaction. **A save never fails on a deck rule** — an unfinished deck is a normal state of a builder — and validity is never stored, so nothing can claim a deck is valid after it stopped being so.

```json
{
  "valid": false, "format": "unlimited", "ownedOnly": false,
  "deckSize": { "expected": 60, "actual": 5 },
  "rules": [
    { "rule": "DECK_SIZE", "ok": false, "errors": 1, "warnings": 0 },
    { "rule": "COPY_LIMIT", "ok": false, "errors": 1, "warnings": 0 },
    { "rule": "FORMAT_LEGALITY", "ok": true, "errors": 0, "warnings": 0 },
    { "rule": "OWNERSHIP", "ok": true, "errors": 0, "warnings": 1 }
  ],
  "issues": [
    { "severity": "error", "rule": "DECK_SIZE", "code": "DECK_SIZE_MISMATCH", "cardIds": [], "params": { "expected": 60, "actual": 5 }, "message": "The deck has 5 cards; it needs exactly 60" },
    { "severity": "error", "rule": "COPY_LIMIT", "code": "COPY_LIMIT_EXCEEDED", "cardIds": ["base1-4"], "params": { "name": "Charizard", "count": 5, "max": 4 }, "message": "Charizard has 5 copies; at most 4 are allowed" },
    { "severity": "warning", "rule": "OWNERSHIP", "code": "CARD_NOT_OWNED", "cardIds": ["base1-4"], "params": { "name": "Charizard", "needed": 5, "available": 0 }, "message": "Charizard (base1-4) needs 5 copies; 0 available" }
  ]
}
```

`rules` is always the four rules in this order — the builder's checklist; a warning never fails a rule. `issues` are sorted by rule, then first `cardId`, then `code`. **Clients branch on `code` and read `params`**; `message` is an English fallback and may be reworded. `cardIds` names the decklist rows an issue is about; `[]` means the whole deck.

| `code` | Severity | Raised when |
| --- | --- | --- |
| `DECK_SIZE_MISMATCH` | error | total copies ≠ `DECK_SIZE` (env, default 60) |
| `COPY_LIMIT_EXCEEDED` | error | more than 4 copies share a card **name**, across printings; basic energy exempt; a trailing subtitle and letter case do not make a new name |
| `CARD_BANNED` | error | the card's `legalities[format]` is `Banned` |
| `CARD_NOT_LEGAL` | error | it is present and neither `Legal` nor `Banned` — `params.status` says what |
| `CARD_LEGALITY_UNKNOWN` | warning | the card records no legality for the format — every such card today is from a set released 2026-09-16 |
| `CARD_NOT_OWNED` | error when `ownedOnly`, else warning | the deck holds more copies than the owner has available |

**Basic energy is `supertype = Energy` with the `Basic` subtype**, and it is set aside before copies are counted by name — `Metal Energy` names both a basic and a special card, and only the special one is limited. **Available copies are `quantity − lockedQuantity`**: copies promised to a pending trade do not count, and a card the owner does not hold has 0. A deck never reserves copies itself; two decks may use the same cards.

**A name is compared without its subtitle and without case.** The mirror prints a subtitle into some names — `Professor's Research (Professor Turo)`, `Boss's Orders (Ghetsis)` — and spells `Ho-Oh` as `Ho-oh` on four cards. Under the game's rules those are one name each, so they share one limit; `params.name` is the name without the subtitle. Those are the only three such groups in the mirror, all found by grouping on the normalised name.

**The verdict is the owner's only.** It states how many copies of each card the owner has, which is their private inventory. `validate` refuses anyone else like `PATCH` does — 404 for a private deck, 403 for a public one, 401 signed out — and no public or list response carries `validation`.

**`ownedOnly`** is the deck's mode — theorycrafting when false, strict when true. Toggling it changes one column; the decklist is not touched, and the verdict on the next save or validate reflects the new mode. A clone keeps its source's mode and is judged against the cloner's copies.

**Measured, 2026-09-28**, the engine directly and then through HTTP with the database checked after each step:

- the engine, called directly: 5 × Charizard → `COPY_LIMIT_EXCEEDED`; 5 × a basic energy → none; 5 × Double Colorless Energy → one; 4 + 1 Pikachu from two sets → one issue naming both printings; 10 basic + 4 special `Metal Energy` → none, 10 + 5 → one on the special card; an empty deck → only `DECK_SIZE_MISMATCH`, four `rules` rows; the same cards in reverse order → a byte-identical result
- through HTTP, every save answered 200/201 with the rows written and a `validation` in the body, including decks breaking each rule; the same five cases as above gave the same issues
- 60 copies → `DECK_SIZE` ok; 59 and 61 → `DECK_SIZE_MISMATCH` with `actual` 59 / 61; with the API started under `DECK_SIZE=40`, 40 copies → ok and 60 → `DECK_SIZE_MISMATCH` with `expected` 40
- a one-card deck: `The deck has 1 card; it needs exactly 60` and `Charizard (base1-4) needs 1 copy; 0 available`
- a deck deleted between the owner check and the validation read: 404 `Deck not found`, the same message as a missing id (checked against the service with a client that finds nothing)
- in `expanded`, Archeops → `CARD_BANNED`; in `standard`, Erika's Oddish → `CARD_NOT_LEGAL` with `status` `Not Legal` and the rule failed, and a `me55` card → `CARD_LEGALITY_UNKNOWN` as a warning
- an owner holding 2 Charizard with 1 locked, deck of 2: `CARD_NOT_OWNED` with `available` 1, a warning; a card not held at all: `available` 0; after `PATCH {ownedOnly: true}` both errors and `valid: false`, `deck_cards` hashed identical before and after
- a save's `validation` and an immediate `POST /validate`: identical; two `POST /validate` in a row: byte-identical, and `decks`, `deck_cards` and `inventory_items` hashed identical before and after
- another member validating a private deck: 404, a public one: 403; signed out: 401; `GET /decks/:id` (owner, stranger, signed out), the public shelf and `GET /decks` carry no `validation`
- 4 × `Professor's Research` (`pgo-78`) + 4 × `Professor's Research (Professor Turo)` (`sv1-190`) in a 60-card `standard` deck: one `COPY_LIMIT_EXCEEDED` naming both printings, `name` `Professor's Research`, `count` 8 — found by the final review, before the fix it passed as valid
- another member cloning that strict public deck: 201, `ownedOnly` true, `CARD_NOT_OWNED` computed from the cloner's copies (`available` 0 where the source's owner had 1); no error in the API log across the run

## Trades

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/trades` | member | Propose; locks the offered copies — throttled like pack opening |
| GET | `/trades` | member | The caller's trades by tab, newest first, keyset-paged |
| GET | `/trades/:id` | member (party) | Detail, timeline and counter chain; 404 to anyone else |
| GET | `/admin/trades/:id` | admin | The same detail for any trade |
| POST | `/trades/:id/accept` | member (recipient) | Atomic settlement |
| POST | `/trades/:id/decline` | member (recipient) | Releases the initiator's locks |
| POST | `/trades/:id/counter` | member (recipient) | A new `PENDING` trade; the original `COUNTERED`; locks move in one transaction — throttled |
| POST | `/trades/:id/cancel` | member (initiator) | Releases the locks |
| POST | `/admin/trades/:id/void` | admin | `{ reason }`; closes a `PENDING` trade, or reverses an `ACCEPTED` one where it still can |

**`POST /trades`** and **`POST /trades/:id/counter`**

| Field | Rule |
|---|---|
| `recipientId` | required on propose; absent on counter — the recipient is fixed by the trade being countered |
| `offered` / `requested` | up to 20 lines each, `{ cardId, quantity }`, quantity 1–100; a card at most once per side, never on both |
| `currencyFromInitiator` / `currencyFromRecipient` | integer, 0–1,000,000, default 0 |

All four collections default empty; a trade with nothing in any of them is 400 "A trade must move at least one card or coin".

**A trade locks exactly what its initiator offered.** Proposing raises `lockedQuantity` on those copies in the same transaction that creates the trade; every way out of `PENDING` lowers it in the transaction that changes the status; accepting consumes it with the copies it guarded. The recipient's cards are not reserved and not checked at proposal — an inventory is private, and a refusal would disclose it — so settlement checks them. The invariant and its reconciliation query are in [DataModel.md](DataModel.md) (Trade).

**Every transition is one guarded update.** `UPDATE … WHERE status = 'PENDING'` takes the trade's row lock, so simultaneous accepts, declines, cancels, counters and voids of one trade resolve to exactly one; the others answer 409 `TRADE_NOT_PENDING`.

**Settlement is one transaction:** the guarded update, then coins — both user rows locked in id order, the payer debited only if they still have it (402 otherwise), one `TRADE` ledger row per user — then cards, every row in `(userId, cardId)` order, rows it empties deleted. Any failure leaves the trade `PENDING` and every balance and row as it was. Both users' inventory summaries are invalidated after commit.

**Counters** close the original as `COUNTERED` and create the new trade with the roles swapped in one transaction: the original initiator's locks are released and the counter's taken, ordered by user id. A negotiation stops at 10 trades.

**Wrong party, wrong role.** A trade you are not a party to is 404 `Trade not found`, like one that does not exist. A party using the other party's route gets 403.

**Notifications** are written after the transaction commits — one per recipient per transition — and a failure to write one is logged without affecting the trade.

**Measured, 2026-09-28**, through HTTP with the database checked after every scenario:

- a proposal: 201, one lock, one `trade.propose` audit row, one notification to the recipient; the same copy offered again → 409 `CARDS_UNAVAILABLE`; a proposal whose second card was not held → 409 and no lock on the first
- self, unknown user, unknown card, empty trade, coins beyond the balance, signed out → 400, 404, 400, 400, 402, 401, nothing written
- a trigger failing every notification insert: the proposal still 201 and committed, the failure logged
- 31 proposals in a minute: 30 answered, the 31st 429
- decline, cancel and an admin void each released exactly the proposal's lock, wrote one audit row with `from`/`to` (the void with its reason) and notified the counterparty (both for a void); a repeat → 409; voiding the seed's `ACCEPTED` trade → 409 and nothing changed
- five declines and five cancels of one trade at once: one 200, nine 409, one terminal status, one audit row
- an accept with cards and coins both ways: the initiator's emptied row deleted, `-70`/`+70` ledger rows, both summary cache keys gone; a coins-only side; a receive into a row with a lock kept the lock
- the recipient lacking a requested card, or holding it only locked: 409, database byte-identical; the payer short of coins: 402, byte-identical
- five accepts and five declines at once: one 200, nine 409; cards and coins conserved
- a pack open and an accept by the same user at once, five times: ten 200s, no deadlock in the log
- a trigger failing the ledger insert: 500 and the database byte-identical; the same accept after dropping it: 200
- a counter: roles swapped, original `COUNTERED`, the initiator's lock gone and the counter's taken; a chain of 10 refused an 11th with 409 `COUNTER_LIMIT`, byte-identical; a counter offering cards not held → 409, the original still `PENDING`
- after every scenario: cards per card and total coins unchanged, every balance equal to its ledger, the lock reconciliation empty, nothing negative


### Reading trades

**`GET /trades`** — `tab`, `cursor`, `pageSize` (1–100, default 24):

| `tab` | Rows |
|---|---|
| `all` (default) | every trade the caller is a party to |
| `incoming` | `PENDING`, the caller is the recipient — waiting on them |
| `sent` | `PENDING`, the caller is the initiator — waiting on the other party |
| `completed` | any status but `PENDING`, either side — history |

Newest first by a keyset cursor over `(createdAt, id)`, the same opaque cursor as the pack history; one that does not decode is a 400 `Invalid cursor`, an unknown tab a 400. `total` is the tab's count. Each tab is one index-backed query: `incoming` and `sent` are an equality on `(recipientId, status)` / `(initiatorId, status)`, and `completed` and `all` are a `BitmapOr` of both composite indexes — `completed` lists the five closed statuses explicitly rather than `<> 'PENDING'`, so status stays an index condition.

Every row carries both parties as `{ id, displayName, avatarUrl }`, the caller's `role` (`initiator` or `recipient`), the coins on each side, `counteredTradeId`, and the items with the inventory's slim card, so the inbox renders without a request per card:

```json
{
  "id": "cmulk3d9i…", "status": "COUNTERED", "role": "initiator",
  "initiator": { "id": "…", "displayName": "Ash", "avatarUrl": null },
  "recipient": { "id": "…", "displayName": "Misty", "avatarUrl": null },
  "currencyFromInitiator": 0, "currencyFromRecipient": 0, "counteredTradeId": null,
  "items": [{ "id": "…", "side": "OFFERED", "cardId": "base1-4", "quantity": 1, "card": { "name": "Charizard", "…": "…" } }],
  "createdAt": "…", "resolvedAt": "…"
}
```

**`GET /trades/:id`** adds `timeline` and `chain`. A trade the caller is not a party to is 404 `Trade not found`, the same as an id that does not exist. Admins read any trade through **`GET /admin/trades/:id`** — the same body with `role: null` — rather than through a bypass on the member route, which still answers an admin who is not a party with 404.

- **`timeline`** is the trade's audit rows, oldest first: `{ action, status, at, by }`, where `status` is what the transition moved the trade to and `by` is `initiator`, `recipient`, `admin` or `system` — the side that acted, never a user id, so a member never learns which admin voided their trade. The void's reason stays in the audit log. Trades created before the trade core (the seed's) have no audit rows and an empty timeline.
- **`chain`** is the whole negotiation this trade belongs to — every trade it replaced and every trade that replaced it, via `counteredTradeId` — oldest first, this trade included: `{ id, status, createdAt, resolvedAt }`.

**Measured, 2026-09-28**, through HTTP, then with `EXPLAIN ANALYZE`:

- six trades between three users — pending both ways, declined, countered with its counter, accepted: each user's four tabs returned exactly the expected trades with the right `role`, newest first (A: all 6, incoming 2, sent 1, completed 3; B: 5, 1, 2, 2; the third user only the trade they declined)
- `pageSize=2` over A's six: three pages, every trade once, `nextCursor` null on the last
- the countered trade's detail: timeline `trade.propose → PENDING by initiator`, `trade.counter → COUNTERED by recipient`; chain `[countered, its counter]`, the same chain from the counter's own detail; the accepted and declined trades' timelines end in `trade.accept` / `trade.decline` by the recipient
- another member, a missing id: identical 404s; signed out: 401; a member on the admin route: 403; an admin on the member route for a trade they are not in: 404, on the admin route: 200 with `role: null`
- after an admin void, the initiator's detail showed `trade.void → VOIDED by admin` and contained neither the admin's id nor the reason
- an unknown tab, a malformed cursor, `pageSize=101`: 400 each
- with 2 000 users and 20 000 trades inserted in a rolled-back transaction: every tab planned as a bitmap scan of its composite index — `completed` and `all` a `BitmapOr` of both, `status = ANY(…)` in the index condition — executing in 0.05–0.11 ms


### Expiry

**A `PENDING` trade older than `TRADE_EXPIRY_DAYS` (default 7) is cancelled by the worker**, hourly at :15 UTC, so its initiator's cards come back within the hour. Age is `createdAt`: a counter is a new trade and restarts the clock. Each stale trade is closed in its own transaction through the same guarded update as a user's cancel — status `CANCELLED`, the initiator's lock released — and audited as `trade.expire` with no actor, which the timeline shows as `by: system`. Both parties get `trade.expired` after commit.

**A trade someone else closes first is skipped, not re-closed.** If an accept, decline or cancel commits while the job holds that trade in its batch, the guarded update finds it no longer `PENDING` and the job counts it as closed by someone else; nothing is released twice. A trade that fails for any other reason stays `PENDING` with its lock, the rest of the batch still expires, and the job ends failed so BullMQ records it and retries — safe, because a run that finds nothing to do changes nothing.

**Every run ends with the lock reconciliation** from [DataModel.md](DataModel.md) (Trade) and logs an error naming how many inventory rows hold a lock no pending trade accounts for. It detects a leak; it does not repair one.

The job runs in the worker process only — `TradeExpiryModule` is imported by `WorkerModule` and not by `AppModule` — so with no worker running, nothing expires.

**Measured, 2026-09-29**, with the API and the worker running and jobs enqueued by hand:

- two trades backdated eight days, one fresh, one old but already accepted: one run expired the two stale ones — and the seed's own pending trade, eleven days old — leaving the fresh one `PENDING` and the accepted one `ACCEPTED`; each expired trade's lock released and nothing else — one initiator's lock from 2 to 1 (the fresh trade still held its copy), the other's from 1 to 0 — a `trade.expire` audit row with no actor for each, two `trade.expired` notifications each, and the timeline reading `trade.expire → CANCELLED by system`; cards, coins and the reconciliation unchanged
- a second run straight after: `Expired 0`, database byte-identical
- an accept racing a run over thirty stale trades, twice: the run closed all thirty and the accept got 409 `TRADE_NOT_PENDING` — one terminal state each time
- a trade declined in another transaction that held its row while the run reached it: the run logged `1 closed first by someone else`, wrote no expiry row and released nothing, and the reconciliation stayed at zero
- an injected failure on one of two stale trades' audit insert: the other expired, the failing one stayed `PENDING` with its lock, the job ended failed (`1 trades could not be expired`), and the next run expired it
- one lock raised by hand without a trade: the run logged `1 inventory rows hold a lock no pending trade accounts for`
- the hourly cron is registered like PD-50's; it was not observed firing


### Voiding an accepted trade

**`POST /admin/trades/:id/void` on an `ACCEPTED` trade runs the settlement backwards in one transaction:** the guarded update from `ACCEPTED` to `VOIDED`, then the coins back — each user row locked in id order, the party who received coins debited only if they still have them — then every card back, taken from the receiver's **available** copies only, in `(userId, cardId)` order. Copies locked in another pending trade are not available: a void never breaks someone's escrow to undo a trade. Any shortfall answers 409 `TRADE_NOT_REVERSIBLE` naming the user and what they lack, and rolls back whole — **a void either fully reverses the swap or changes nothing.** Both inventory summaries are invalidated after commit; both parties get `trade.voided`.

The ledger records the reversal as `TRADE_REVERSAL` rows under the trade's id, the opposite of its `TRADE` rows. The audit row is `trade.void` with the admin as actor, `from: ACCEPTED` and the reason; the timeline shows it as `by: admin` without the reason or the admin's id.

Leaving `ACCEPTED` never releases a lock. A settled trade's own lock was consumed at settlement, so "releasing" it would lower one belonging to another of the initiator's pending trades — `TradeCloseService` makes that combination impossible at the type level.

A `PENDING` trade is voided as before, its lock released. Any other status answers 409 `TRADE_NOT_PENDING` naming it. Two admins voiding at once: one reversal, the other 409.

**Measured, 2026-09-29**, through HTTP with the database checked after each step:

- a settled trade with cards and coins both ways (A gave Charizard and 100, B gave Pikachu and 30): the void returned both cards to their first owners — A's deleted row recreated, B's emptied row deleted — and the balances to 500 and 300; `TRADE_REVERSAL` rows `+70`/`-70` beside the `TRADE` rows; one `trade.void` audit row `ACCEPTED → VOIDED` with the admin and reason; two notifications; both summary keys gone; the timeline `propose → accept → void by admin`; cards, coins and the lock reconciliation unchanged
- the receiver's card locked in their own new proposal: 409 `TRADE_NOT_REVERSIBLE` naming them and the card, database byte-identical; after they cancelled it, the void went through
- the coins' receiver having spent them: 409 naming the amount, byte-identical; after a top-up, the void went through
- two admins voiding one accepted trade at once: one 200, one 409, one audit row
- a declined trade: 409 `TRADE_NOT_PENDING` "already DECLINED"; a second void of a voided trade: 409; a member on the route: 403
- the initiator voided out of one settled trade while another of their trades still held the same card: that lock untouched (3 held, 1 locked afterwards), the other trade still `PENDING`, the reconciliation empty

## Notifications

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/notifications` | member | The caller's notifications, newest first, keyset-paged; `unread=true` for unread only |
| GET | `/notifications/unread-count` | member | `{ count }` for the bell |
| PATCH | `/notifications/:id/read` | member (owner) | 204; idempotent — an already-read one keeps its first `readAt` |
| PATCH | `/notifications/read-all` | member | `{ updated }`, the number it marked |

**Kinds in v1:** `trade.proposed`, `trade.accepted`, `trade.declined`, `trade.countered`, `trade.cancelled`, `trade.expired`, `trade.voided` — payload `{ tradeId }` — and `currency.granted`, payload `{ amount }`, signed, emitted by PD-80's admin grants. The writer is `NotificationsService.notify(entries)`, typed so a kind can only be written with its own payload; it runs after the triggering transaction commits and logs a failure instead of throwing, so a notification never undoes the action it reports.

**No actor id in any payload.** Who acted follows from the kind — the counterparty for most trade kinds, an admin for `trade.voided`, the system for `trade.expired` — and an admin's user id is not a member's to see, the same rule as the trade timeline. Trade notifications written before this (with an `actorId`) are safe to read: see below.

**`GET /notifications`** — `unread` (`true` / `false`, default `false`), `cursor`, `pageSize` (1–100, default 24). Newest first by the same `(createdAt, id)` cursor as the trade inbox; one that does not decode is a 400. `total` counts the filter. Each row:

```json
{
  "id": "…", "type": "trade.accepted", "payload": { "tradeId": "…" },
  "counterparty": { "id": "…", "displayName": "Misty", "avatarUrl": null },
  "readAt": null, "createdAt": "…"
}
```

- **`payload` is the stored JSON parsed through its kind's schema**, so a key the schema does not name never reaches a client — including the `actorId` older rows carry. A kind the API does not know, or a payload that does not fit its kind, reads as `{}` rather than failing the page.
- **`counterparty`** is the other party of the trade a trade notification is about, read live with the page — one query for all of it — so the row can say who without a request per notification, and a renamed user reads correctly. Only trades the reader is a party to are looked up; any other `tradeId` gives `null`, as does every non-trade kind.

**Mark-as-read is scoped to the caller.** Another user's notification is the same 404 `Notification not found` as a missing one. Both writes are a single `UPDATE … WHERE "userId" = … AND "readAt" IS NULL`.

The unread count and the list are both served by the single `(userId, readAt)` index; see [DataModel.md](DataModel.md) (Notification).

**Measured, 2026-09-29**, through HTTP with the database checked after each step:

- a proposal, a counter and an admin void of the counter: the recipient got `trade.proposed`, the initiator `trade.countered`, both `trade.voided` — four rows, each payload exactly `{ tradeId }`; the list showed the other party as `counterparty` on every one
- rows inserted by hand: a `trade.voided` payload carrying an admin's `actorId` and an extra key read as `{ tradeId }` alone; an unknown kind and a malformed `currency.granted` read as `{}`; a trade notification naming a trade the reader is not in read with `counterparty: null`
- six rows, four sharing one `createdAt`, paged by two and by four: every row once, `nextCursor` null on the last page
- a malformed cursor, `unread=yes`: 400 each; signed out: 401 on both reads; a `PATCH` without an `Origin`: 403 from the CSRF guard
- mark-as-read: 204, and again 204 with `readAt` unchanged; another user's notification and a missing id: identical 404s, the other user's row still unread
- read-all: `{ "updated": 5 }`, then `{ "updated": 0 }`; the unread count 0 for that user and unchanged for the other
- a trigger failing every notification insert: a proposal still 201 and `PENDING`, no notification, `Notification write failed (trade.proposed to …)` in the log; the next transition after dropping it notified normally
- 40 000 notifications over three users: the unread count a bitmap scan of `(userId, readAt)`, 1.4 ms for 1 335 unread; the first page a bitmap scan of the same index and a top-N heapsort, 4.4 ms over 13 335 rows (1.5 ms unread-only); the HTTP page in 66 ms

## Wallet

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/wallet` | member | The caller's balance and ledger, newest first, keyset-paged |

**`GET /wallet`** — `type` (`GRANT`, `PACK_SPEND`, `TRADE`; absent for all), `cursor`, `pageSize` (1–100, default 24). `TRADE` also matches `TRADE_REVERSAL`: a void is part of the trade it undoes. Newest first by the same `(createdAt, id)` cursor as the trade inbox; `total` counts the filter. There is no user parameter — the ledger is the session user's and nobody else's, admins included.

```json
{
  "balance": 600,
  "items": [
    { "id": "…", "type": "TRADE_REVERSAL", "amount": -30, "balanceAfter": 600,
      "source": { "kind": "trade", "tradeId": "…", "counterparty": { "id": "…", "displayName": "Misty", "avatarUrl": null } },
      "createdAt": "…" },
    { "id": "…", "type": "PACK_SPEND", "amount": -300, "balanceAfter": 700,
      "source": { "kind": "pack", "openingId": "…", "templateName": "Base Set Booster" }, "createdAt": "…" },
    { "id": "…", "type": "GRANT", "amount": 1000, "balanceAfter": 1000, "source": { "kind": "welcome" }, "createdAt": "…" }
  ],
  "pageSize": 24, "total": 3, "nextCursor": null
}
```

- **`balanceAfter`** is the ledger's running total up to and including the row — a window sum over the caller's whole ledger in `(createdAt, id)` order, taken before the filter, so a filtered page still shows the real balance after each row. It costs one pass over the caller's ledger per request.
- **`source`** is what caused the row: `welcome` (the verification grant), `grant` (any other — the seed's, and PD-80's admin grants), `pack` with the opening's id for [`GET /packs/history`](#opening-history), or `trade` with the trade's id and the other party. `null` when the reference no longer resolves. Rows join their source in the same query.
- **`balance`** is the stored `User.currency`, the figure every debit is guarded against.

**Every balance change writes a ledger row in the transaction that changes it** — the welcome grant, a pack open (a zero row for a free pack), both sides of a settlement and of a reversal; there is no other write to `users.currency`. **The ledger is checked on every read:** the stored balance and the ledger's sum are read in one statement, so a write landing between two reads cannot pass for a disagreement, and a disagreement is logged as `Ledger mismatch for <user>: balance …, ledger …`. It is not repaired and not shown to the member. The same check across every user:

```sql
SELECT id FROM users u
WHERE currency <> COALESCE((SELECT SUM(amount) FROM currency_transactions t WHERE t."userId" = u.id), 0);
```

**Measured, 2026-09-29**, through HTTP with the database checked after each step:

- a welcome grant of 1 000, a 300-coin pack, a trade paying 100, a trade receiving 30 and an admin void of it: five rows newest first with `balanceAfter` 600, 630, 600, 700, 1 000 and `balance` 600; sources `trade` (twice with the same `tradeId`, the reversal included), `trade`, `pack` with the opening and template name, `welcome`
- `type=TRADE` gave the three trade rows including the reversal with the same `balanceAfter` as unfiltered; `PACK_SPEND` and `GRANT` one each; `balance` unchanged by the filter
- paged by 2 and, filtered, by 1: every row once, `nextCursor` null at the end
- the counterparty's wallet showed only their own four rows — the grant as `grant`, the mirrored trade rows — and nothing of the first user's
- `type=TRADE_REVERSAL`, a malformed cursor, `pageSize=101`: 400 each; signed out: 401
- the stored balance raised by 5 without a ledger row: the response showed 605 and the log `Ledger mismatch … balance 605, ledger 600`; restored, the next read logged nothing
- the check above over every user in the database (the seed's five included): no mismatch
- one user with 5 005 ledger rows: the page in 5.4 ms (`WindowAgg` over a sequential scan — the user owned nearly every row — then a top-N heapsort), 15–31 ms through HTTP

## Prices

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/cards/:id/price` | public | Latest USD and EUR, cached 1h |
| GET | `/cards/:id/price/history` | public | Windowed per-source series for a sparkline. `days` 1–365, default 30 |
| POST | `/cards/:id/price/refresh` | member | Enqueue a refresh behind a per-card cooldown and a daily reserve. Always 200 |

**`GET /cards/:id/price`**

```json
{ "cardId": "base1-15", "usd": 142, "eur": null, "priceUpdatedAt": "2026-09-15T03:00:00.000Z" }
```

**`eur: null` is present in the body, not omitted, and it is still the ordinary case.** A EUR price is rare rather than nonexistent: 8 of the mirror's 20 670 cards carry one, all of them priced by this ticket's own on-demand refreshes against the live provider, so the count is small and growing rather than fixed — most priced cards in the mirror still return `eur: null` today.

**404 means the card does not exist; a card that exists but was never priced is a 200 with `usd`, `eur` and `priceUpdatedAt` all null.** `priceUpdatedAt: null` is the field a client reads to tell the two apart — a separate boolean would be a second way of saying the same fact, and two sources of truth for one fact is how they drift. A 404 leaves no cache key behind: the loader throws before `getOrSet` writes anything, so a scan for missing ids cannot be used to fill the cache.

A non-null `priceUpdatedAt` with `usd` and `eur` both null is a fourth, distinct state: the card was synced and the marketplace published no price that time, which the shape already permits — `PriceDTO.market` is nullable — and is different from a null `priceUpdatedAt`, which means the card has never been synced at all.

**`priceUpdatedAt` is an absolute timestamp, never a computed age.** The response is cached for an hour, and a relative "updated 300 seconds ago" served from that cache forty minutes later is wrong by forty minutes — least accurate exactly when the data is most stale, which is the case the field exists to expose.

Measured: cold and warm reads were byte-identical, the key's TTL at 3599. With Redis stopped the endpoint still answered 200, in 68 ms — the same cache-failure-is-a-miss behaviour the Catalog routes rely on. `ex10-!` and `ex10-?` — the only two ids in the catalog carrying `!` or `?` — both resolved 200 once percent-encoded; `ex10-?` is the sharper of the two, since an unencoded `?` in a path is a query-string separator.

**`GET /cards/:id/price/history`**

```json
{
  "cardId": "base1-1",
  "windowDays": 60,
  "series": {
    "TCGPLAYER": {
      "currency": "USD",
      "points": [
        { "capturedOn": "2026-08-24", "market": 1.1 },
        { "capturedOn": "2026-09-03", "market": 1.5 },
        { "capturedOn": "2026-09-21", "market": 2 }
      ]
    },
    "CARDMARKET": { "currency": "EUR", "points": [{ "capturedOn": "2026-08-09", "market": 0.9 }] }
  }
}
```

`days` defaults to 30 and is bounded to 365. The ceiling is a year because the once-a-day snapshot cap makes that at most 730 points for one card — still one small response — and nothing in the product looks further back. `days` of 1 and 365 both answer 200; `0`, `366`, `abc`, `1.5` and `-5` all answer 400.

**A gap in the history is an absent point, never an interpolated or null one, and both series are always present with `currency` fixed by source.** A card with no snapshots in the window is a 200 with both series present and empty, told apart from a card that does not exist by a separate existence check the service runs before it queries snapshots — both would otherwise be zero rows and the same response. A card not in the catalog is a 404.

The absent-point rule is enforced in SQL (`market: { not: null }`), not left to the response schema, and that placement is load-bearing: remove the filter and `Number(null)` evaluates to `0`, so a snapshot carrying no market value would enter the series as a phantom point priced at zero — and `PricePointSchema` would accept it, because `nonnegative()` allows zero. The gap rule holds because the query never hands the schema a null to reject, not because the schema would catch one if it did. Measured: a fifth seeded row carrying a null `market`, dated one day before the request, appeared in none of the 30-day, 60-day or 5-day reads.

Measured: a 60-day window returned 3 TCGplayer points and 1 Cardmarket point (the body above); a 5-day window returned 1. Both windows had slack against their seed data, which is what makes them the evidence for the no-interpolation property. A 30-day read against a fixture seeded at exactly `now() - interval '30 days'` returned 2 TCGplayer points rather than the 3 the fixture intended, because by the time the request ran the row had aged to `30 days 00:00:15.6s` and the service computes its cutoff at request time, not at seed time — a property of that fixture's timing, not of the endpoint. The 60-day and 5-day reads are the ones to cite for the window's behaviour.

**`POST /cards/:id/price/refresh`**

```json
{
  "cardId": "base1-4",
  "usd": 944.53,
  "eur": 1531,
  "priceUpdatedAt": "2026-09-27T09:57:28.888Z",
  "queued": true,
  "retryAfterSeconds": 600
}
```

**Always 200, and always the card's current price.** A 202 describes a response
about work that was queued; this body is about the price, which is returned
whether or not anything was queued. Splitting the status code would make a client
branch twice for one call — once on the code and again on a body it has to read
anyway.

`queued` and `retryAfterSeconds` together say which of three things happened:

| Outcome | `queued` | `retryAfterSeconds` |
|---|---|---|
| a job was enqueued | `true` | the cooldown just set, 600 by default |
| the card is inside its cooldown | `false` | what remains of it |
| the day's reserve is reached | `false` | seconds until 00:00 UTC |

The third needs no separate flag. The request counter is keyed on the UTC day and
resets there, so a client rendering "try again in 4 minutes" against a cooldown
renders "try again in 7 hours" against an exhausted day without knowing which
limit produced it.

**Two concurrent requests for the same card enqueue exactly one job.** The
cooldown is taken with an atomic `SET NX EX` on `throttle:price:refresh:{cardId}`,
so the guarantee is an invariant rather than a probability — a read-then-write
sequence has a gap between its two steps that both requests fit through.
Measured: two `curl` calls raced against `base1-2` produced one increment of
BullMQ's job counter, one `queued: true` and one `queued: false`.

**A 404 means the card does not exist, and leaves no cooldown behind.** The
existence check runs first, through the same read `GET /cards/:id/price` serves.
A card that exists but was never priced is a 200 with `usd`, `eur` and
`priceUpdatedAt` all null **and** `queued: true` — that card is precisely what
the endpoint is for.

**The response can be up to an hour stale, by design.** It is the cached read,
and the refresh it triggers has not happened yet. `priceUpdatedAt` is what a
client watches to see the new figure arrive, but that promise holds only for a
card the provider actually prices. `PriceBatchService.refreshBatch` builds its
updates from the provider's response, and a card the provider returns no price
for is not touched at all — no column, no timestamp, no snapshot — and
`cache:price:card:{id}` is deleted only for the ids it did price. Most cards in
the mirror are in exactly that position: 20 654 of 20 670 carry no
`latestPriceUsd` today. For one of those, `priceUpdatedAt` never moves and the
cache key is never invalidated, so a caller watching the field for the queued
refresh to land is watching for a change that will not come, locked out by the
cooldown for ten minutes with no signal that this is why.

**A failed job looks identical to a pending one from the caller's side.** The
spec deliberately does not clear the cooldown when the job fails — clearing it
would turn a bad provider minute into a spending loop — so whether the refresh
is still in flight or already failed, the response a client polls stays the same
unchanged shape either way. That is a correct, deliberate property of the
design, not a bug, but it means a client cannot distinguish "still working" from
"already gave up" without a longer wait than either case actually needs.

**Redis unreachable answers 503.** The cooldown is a lock, not a cache: a failure
to take it must not be read as "the lock is free", and refusing *as though the
cooldown were held* would tell a caller their card was refreshed recently when in
fact nothing could be checked. `GET /cards/:id/price` beside it still answers 200
from the database — measured again in this ticket at about 5 ms, a different
run from PD-51's 68 ms above — so a client that wants the figure has somewhere
to get it. Note the
envelope: `AllExceptionsFilter` replaces the message of any status at or above
500, so the body reads `"error": "Service Unavailable"` with `"message":
"Internal server error"`.

**Authentication is required and no per-route rate limit is added.** The `default`
throttler tier — 100 requests a minute per caller — already applies and already
bounds a single caller. The `THROTTLE_MODERATE_*` values in configuration are
registered under no tier, and `@nestjs/throttler` 6.7.0 applies every registered
tier to every route, so registering one would tighten the whole service from 100
to 30 a minute to bound one endpoint. The daily reserve is what protects the
quota, and it does so however many callers there are.

## Admin / Users

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/admin/users` | admin | Every account, searchable, page-paged |
| POST | `/admin/users/:id/currency` | admin | `{ grantId, amount, reason }` — grant or adjust, once per `grantId` |
| PATCH | `/admin/users/:id/role` | admin | `{ role }` — never the last active admin, never oneself |
| POST | `/admin/users/:id/suspend` | admin | `{ reason }` — ends every session and voids pending trades |
| POST | `/admin/users/:id/unsuspend` | admin | Lifts a suspension |

**`GET /admin/users`** — `q` (1–100), `role` (`MEMBER` / `ADMIN`), `suspended` (`true` / `false`), `page`, `pageSize`; newest account first. Each row is `id, email, displayName, avatarUrl, role, currency, emailVerified, suspendedAt, createdAt`, validated only as far as the table constrains it: Better Auth's sign-up accepts any name and image, and one account that sent `name: ""` and `image: "x"` once made this page a 500 — an admin must be able to see, and suspend, exactly that account. `q` matches email or display name case-insensitively, and matches `%`, `_` and `\` literally: Prisma's `contains` hands its value to `ILIKE` unescaped — measured, `_` matched every user — so the service escapes them first. Reads are not audited.

**Grants.** `grantId` is a UUID the client generates, `amount` a non-zero integer from −1 000 000 to 1 000 000 (negative adjusts down), `reason` 1–500 characters. One transaction, in this order: the target must exist (404); the `GRANT` ledger row is inserted with `refId = grantId` — the first write, so a replay stops on the ledger's unique `(userId, type, refId)` before it touches the balance; `UPDATE users SET currency = currency + amount WHERE … AND currency + amount >= 0` — no row is 409 `INSUFFICIENT_FUNDS` and everything rolls back; the `user.currency_grant` audit row `{ grantId, amount, reason }`. After commit the user gets `currency.granted { amount }`. The answer is `{ userId, balance, transaction: { id, amount, createdAt } }` with 200, for the first request and a replay alike. A replay with the same amount returns the original row and the current balance and writes nothing; with a different amount it is 409 `GRANT_ID_CONFLICT`. An admin may grant to themselves — the audit row says so — and to a suspended user.

**Role changes.** Targeting oneself is 403 `SELF_TARGET`; the same role is 200 and writes nothing. Otherwise the change and its `user.role_change` audit row `{ from, to }` are one transaction, and the target's next request sees the new role — the session loads its user from the database every time.

**The last active admin.** Demoting or suspending an active admin (`role = ADMIN` and not suspended) first runs `SELECT id FROM users WHERE role = 'ADMIN' AND "suspendedAt" IS NULL ORDER BY id FOR NO KEY UPDATE`, and refuses with 409 `LAST_ADMIN` if the target is the only row. Because nobody can target themselves, a lone admin is never reachable; the lock is for two admins acting on each other at once. The second waits on the first's locks, and when the first commits PostgreSQL re-checks the waiting rows against the `WHERE` and drops the one that no longer matches, so the second counts what is really left. Id order keeps two of them from deadlocking on each other. The mode is `NO KEY UPDATE`, not `UPDATE`: it still conflicts with itself, which is all the rule needs, but not with the `KEY SHARE` that any insert referencing a user takes on that row — an audit row, a session, a ledger row. With `FOR UPDATE`, a suspension that had already written an audit row as admin A could deadlock against another admin's lock waiting on A's row; reproduced in psql as `deadlock detected`, gone with `NO KEY UPDATE`.

**Suspension.** Targeting oneself is 403 `SELF_TARGET`; an already suspended user is 200 and nothing is written. Otherwise, in one transaction and in this order:

1. every `PENDING` trade the user is on either side of is voided as an admin void — status `VOIDED`, the initiator's lock released, a `trade.void` audit row with `reason: "account suspended"`; one that a concurrent accept, decline or cancel closed first is skipped. This is `TradeCloseService.voidAllPendingOf`: one `UPDATE … WHERE id IN (SELECT … ORDER BY id FOR UPDATE) RETURNING`, one read of the offered lines, one release per initiator and card, one `createMany` of audit rows — a fixed number of statements however many trades there are, so a user who has spammed proposals can still be suspended inside the transaction timeout
2. the last-admin lock, if the target is an active admin
3. `suspendedAt` set — by a guarded `UPDATE … WHERE "suspendedAt" IS NULL`, so of two simultaneous suspensions one writes and the other rolls back as a no-op
4. every session of the user deleted
5. the `user.suspend` audit row `{ reason, voidedTradeIds }`

Both parties of each voided trade get `trade.voided` after commit. Trades come first because an accept locks the trade and then the users; taking them in the same order makes a suspension and an accept queue rather than deadlock.

**What a suspended user meets:**

- **On their next request, 401** — their sessions are gone, so nothing identifies them.
- **Signing in, 403 `ACCOUNT_SUSPENDED`** — Better Auth's `databaseHooks.session.create.before` refuses a session for a suspended user on every path that creates one.
- **A session that survived anyway, 403 `ACCOUNT_SUSPENDED` — once.** A sign-in whose hook ran just before the suspension committed can insert its session just after the suspension deleted the others. `SessionGuard` refuses any session whose user is suspended, serves it as anonymous on `@Public()` routes, and deletes it, so it cannot come back. Better Auth's own `get-session` would report such a session until its first `/api/v1` use.
- **Their public profile stays up.** Suspension withdraws access; it erases nothing.

**Unsuspending** clears `suspendedAt` with a `user.unsuspend` audit row, deletes any session the user still has — a suspended account holds no legitimate one, so whatever is left slipped in during the suspension and was never used — and restores only the ability to sign in: voided trades stay voided. Not suspended → 200, nothing written.

**Accepted boundary:** a trade proposal already in flight when a suspension commits can commit just after it, leaving one `PENDING` trade from a suspended user. The trade core does not re-check suspension; an admin void or the expiry job closes it.

**Measured, 2026-09-29**, through HTTP with the database checked after every scenario and the ledger and lock reconciliations at zero after each:

- the list: `q=PD80-M` found the three probe members by email, `q=waterFLOWER` the one renamed "Misty Waterflower"; `q=%` and `q=pd80_` found nothing; a display name `back\slash` was found by `q=\` alone among the probe accounts (PD-133); `role=ADMIN` two; page 3 of 3 at `pageSize=2`; `suspended=maybe` 400; a member 403, signed out 401
- a member promoted reached an admin route on their next request; demoted, the same cookie was 403 on the next; the same role again wrote no audit row; self 403 `SELF_TARGET`, unknown id 404, `role: "OWNER"` 400
- two admins demoting each other at once, with the seed admin out of the count: 5 of 5 one 200 and one 409 `LAST_ADMIN`; then with a psql transaction holding the admin locks for 2 s so both requests provably queued: 3 of 3 the same, one active admin left each time. The same for two admins suspending each other: 3 of 3, each order winning at least once
- a grant of 500: 200, one ledger row carrying the `grantId`, one audit row, one `currency.granted { amount: 500 }`, the wallet showing it as `grant`; the same body again: an identical 200 and still one of each; the same `grantId` for 900: 409 `GRANT_ID_CONFLICT`; −10 000 against 500: 409 `INSUFFICIENT_FUNDS`, ledger and balance byte-identical; −200: balance 300; a self-grant 200; a grant of 50 to a suspended user: 200 and notified; an unknown id 404; a bad `grantId`, a zero amount, a blank reason, an extra key, 1 000 001: 400 each
- a trigger failing `audit_logs` inserts: a grant 500 with no ledger row and the balance unchanged; a suspension 500 with the user still active, their session kept and their pending trade still `PENDING` with its lock
- a member signed in twice, with one pending trade they proposed and one they received: suspended → both cookies 401, `get-session` null, sign-in 403 `ACCOUNT_SUSPENDED`, the public profile 200; both trades `VOIDED`, both locks released (1/1 → 1/0), a `trade.void` row each, one `user.suspend` row listing both, four `trade.voided` notifications; suspended again → 200, no second row; self 403, unknown 404, an empty body 400; unsuspended → signed in again, the trades still `VOIDED`, a second unsuspend wrote nothing
- a session left in place for a user suspended directly in the database — the race-created session — was 403 `ACCOUNT_SUSPENDED` on `/users/me` and `/wallet` and served anonymously on `GET /users/:id`; after PD-133 the first such request also deleted it, and the same cookie was 401 once the account was unsuspended; two such sessions left unused were both deleted by the unsuspension, both cookies 401 afterwards; a sign-up body carrying `suspendedAt` was 400 `FIELD_NOT_ALLOWED` and created nothing
- a user with 4 000 pending trades, each locking one copy: suspended in 1.25 s, all 4 000 `VOIDED`, the lock 4 000 → 0, 4 000 `trade.void` rows, 8 000 notifications, one `user.suspend` row listing 4 000 ids. Voiding them one at a time, as first built, ran past Prisma's 5 s interactive-transaction timeout: 500, and the account stayed unsuspended
- an account created through sign-up with `name: ""` and `image: "x"`: listed with those values and suspended, both 200 (a 500 before the admin row stopped requiring a form-valid name and URL)
- an accept of the member's pending trade racing their suspension, five times: once the accept won (200, then the suspension found nothing pending), four times the suspension won (the accept 409 `TRADE_NOT_PENDING`, the trade `VOIDED`); never a deadlock, never a lock or balance out of reconciliation

## Admin / Sync

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/admin/sync/catalog` | admin | Enqueue a catalog sync — 202 `{ jobId, kind }` |
| POST | `/admin/sync/prices` | admin | Enqueue a full price sweep — 202 `{ jobId, kind }` |
| POST | `/admin/sync/breakers/:provider/reset` | admin | Clear a provider's breaker |
| GET | `/admin/sync/status` | admin | Last run per `SyncKind`, queue depth, breakers, the provider the next run would use |
| GET | `/admin/metrics` | admin | Daily activity, packs, trades, errors and freshness — see [Admin / Metrics](#admin--metrics) |

### Triggers

`POST /admin/sync/catalog` queues `catalog-sync` (kind `CATALOG`), the job the 3 am cron runs; `POST /admin/sync/prices` queues `price-sweep` (kind `PRICE`), the full sweep the 4 am cron runs. The active refresh has no button — it already runs four times a day. Neither takes a body. The answer is **202** `{ jobId, kind }`: the run is queued, not done, and a processor picks it up in the worker or the API process.

**One run at a time, from either side.** Each queue has a BullMQ deduplication key, held while a job waits, is delayed, runs or retries, and released when it completes or finally fails. The crons enqueue under the same key, so a cron firing over a manual run is skipped and logged, and a trigger over a cron's run is refused. The refusal is **409 `SYNC_IN_PROGRESS`**, naming the job: `A catalog sync is already queued or running (job 680e…)`.

**A catalog trigger is also refused while a price sweep holds its key, and the reverse.** The two share one daily budget of 1 000 requests and a ceiling of 30 a minute; the crons keep them an hour apart, and a button would not. One code covers both refusals, since a client does the same thing either way — waits — and the message says which job is in the way.

**The audit row is written first, then the job is queued, in one transaction.** Redis cannot join a Postgres transaction, so the order decides what a failure leaves: a failed or refused enqueue rolls the `sync.trigger` row back. The job id is generated before the enqueue so the row can name it, and the `SyncRun` the processor later opens carries the same id. A deduplicated `add` stores nothing and returns the holder's id, from the same atomic script that checked the key, so a trigger that lost a race between its first read and its `add` rolls back its row and answers 409. Accepted: a job with no audit row if the `COMMIT` fails after the `add`, or if Redis fails between the trigger's first read and its `add` (the `add` waits in ioredis' offline queue and lands when Redis returns); and two admins triggering a catalog sync and a price sweep at the same instant both getting a job. See [DataModel.md](DataModel.md), AuditLog.

**With Redis unavailable a trigger is 503** and nothing is written: after 2 s when Redis is down before the request, since both keys are read in one parallel call, and after at most 4 s when it fails between that read and the `add` — the one Redis call inside the transaction, which leaves Prisma's 5 s transaction limit room to commit. BullMQ's connection waits for Redis rather than failing — measured, every call stayed pending past 5 s — so every admin call to the queue or the breaker keys runs under a 2 s timeout. The body carries the fixed `"Internal server error"` message every response at 500 and above carries; the status is the signal.

### Breaker reset

`POST /admin/sync/breakers/:provider/reset` deletes the provider's failure counter and its open key, and answers 200 with the state after: `{ provider, failures: 0, openUntil: null }`. With every breaker open, a trigger's run fails with `every registered provider has an open breaker` until a cooldown expires; this is the operator's way out. An open key with no expiry counts as open, as the selector reads it. A provider with neither key answers 200 and writes nothing; an unknown provider is 404 `Provider not found`. Otherwise a `sync.breaker_reset` row records the state before the reset, written before the `DEL` in one transaction.

### Status

```ts
{
  runs: SyncRunSummary[] | null,          // null: sync_runs unreadable
  queues: QueueDepth[] | null,            // null: the queue Redis unreadable
  breakers: ProviderBreakerState[] | null,// null: the breaker keys unreadable
  primaryProvider: string,                // configured
  nextProvider: string | null,            // what the next run would choose; null: every breaker open
}
SyncRunSummary = { kind, provider, status, startedAt, finishedAt, durationMs, processed, failed, error, jobId, stale }
QueueDepth = { queue, waiting, active, delayed, failed }  // catalog-sync, price-sweep, price-active, price-sync
ProviderBreakerState = { provider, failures, openUntil }
```

**Each section is read on its own**, so one dependency down costs its section and not the page, and the answer is always 200. `null` means unknown; `[]` means none. `durationMs` is null while a run is open. `waiting` includes jobs on a paused queue, which BullMQ counts separately.

`openUntil` rather than "opened at", because it answers the question an operator is actually asking during an outage.

**`stale`** is true for a `RUNNING` row that nothing will ever close — its job is missing, `completed` or `failed`, or the row has no job id — null when the queue cannot be read, and false for every closed run. The worker closes a run as `FAILED` when BullMQ gives up on its job, including a job that stalled twice after its process was killed; `stale` reports what escapes even that. A stale row harms nothing, and the next run of its kind replaces it here. See `apps/api/src/sync/README.md`, "A run nobody will close".

**`nextProvider`** applies the selector's own rule — the primary unless its breaker is open, then the first registered provider whose breaker is closed. With Redis unreadable it names the primary, because the selector then treats every breaker as closed; `breakers: null` says the breakers themselves are unknown.

**Postgres wholly down cannot be shown here**: signing in and loading the session need it, so the request fails before it reaches this endpoint. `runs: null` is for `sync_runs` being unreadable while the rest of the database answers.

**The last run is reported for three kinds: `CATALOG`, `PRICE`
and `PRICE_ACTIVE`.** `PRICE_ACTIVE` is PD-50's addition — the row for the
job that refreshes prices for cards someone owns, has in a deck, or has
traded recently, four times a day. It is a separate row rather than folded
into `PRICE` because the two price jobs share nothing but a provider and a
budget: PD-49's nightly sweep measured 874.6 s (about 14.6 minutes) end to end
over the whole catalog, while PD-50's active refresh is bounded to at most
`PRICE_ACTIVE_MAX_CARDS` (2 500) cards a run by construction — a small
fraction of the catalog, and shorter for it; the only real run measured so far
priced the entire active set of 8 cards in 3.6 s, which is too small a sample
to generalise from but is consistent with the shape. One row cannot describe
both without either losing which job the numbers belong to or overwriting one
job's last run with the other's every time they interleave — and against a
four-times-a-day cadence next to a once-nightly one, they interleave
constantly.

**Measured, 2026-09-29**, through HTTP against the running stack, with the queues paused for every scenario but one so no provider request was spent:

- a trigger: 202 in 79 ms; one `sync.trigger` row naming the job; the processor's `SyncRun` carrying the same `jobId` 10 s later
- a second trigger while the first waited: 409 `SYNC_IN_PROGRESS` naming it, no second row, one job; a price trigger while the catalog job waited: 409; the reverse, after draining: 409
- two admins triggering at once, five times: each time one 202 and one 409, one audit row, one job
- the real catalog cron, driven twice over a manual run: both times `Skipped the catalog sync: job e05d… is still queued or running`
- a `sync.trigger` insert made to fail: 500, no job queued, the key free
- Redis stopped: a trigger 503 in 2 073 ms, no row, and no job once Redis was back; the status 200 in 2 067 ms with `queues`, `breakers` and a running row's `stale` null and `nextProvider` the primary
- `sync_runs` renamed away: the status 200 with `runs: null` and the rest readable
- a `RUNNING` row naming a job that does not exist: `stale: true`
- a breaker at 5 failures and open for 900 s: reset 200, both keys gone, a row with `{ failures: 5, openUntil }`; again: 200 and no row; an open key with no TTL: shown open, `nextProvider` the fallback, reset 200; `ghost`: 404
- a member on every new route 403, signed out 401
- the one real run, triggered from the endpoint: `PARTIAL`, 19 670 processed, 4 failed, its row's `jobId` the trigger's, `stale: false` throughout. The host slept during it, so it lost its BullMQ lock: the processor closed its run, BullMQ refused to mark the job finished (`Missing lock … moveToFinished`) and ran it again under the same job id, which opened a second run from page 1. The key stayed held the whole time, so no trigger or cron could add a third. That run was stopped by hand; with its job removed, its `RUNNING` row read `stale: true`. See `apps/api/src/sync/README.md`, "A run nobody will close"

## Admin / Metrics

`GET /admin/metrics?days=14` — admin only. `days` is `7`, `14` (the default, the dashboard's chart) or `30`; anything else, `90` included, is 400. The answer is always 200: each section is read on its own and is `null` when it cannot be.

```ts
{
  generatedAt: Date,
  window: { days, from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' },   // UTC; to = today, inclusive
  series: MetricsDay[] | null,          // exactly `days` rows, oldest first, zero-filled
  summary: { current: MetricsDay, previous: MetricsDay } | null,   // yesterday, the day before
  freshness: { oldestPriceUpdatedAt, cardsWithoutPrice, lastRuns: SyncRunSummary[] | null } | null,
  queues: QueueDepth[] | null,
}
MetricsDay = {
  day, partial,                         // partial: true for today only
  activeUsers, packsOpened,
  tradesProposed, tradesAccepted, tradesDeclined, tradesCancelled, tradesCountered, tradesVoided,
  requests, serverErrors, errorRate,    // null when Redis is unreadable
  packFallbacks, packUnavailable,       // null when Redis is unreadable
}
```

**What each field counts.** Every day is a UTC day.

| Field | Counts | Source |
|---|---|---|
| `activeUsers` | users with at least one authenticated `/api/v1` request that day | `user_activity`, written by `SessionGuard` |
| `packsOpened` | pack openings, by `createdAt` | `pack_openings` |
| `tradesProposed` | trades created that day, counters included, by `createdAt` | `trades` |
| `tradesAccepted` | **trade volume** — trades that settled that day, by `resolvedAt` | `trades` |
| `tradesDeclined` · `tradesCancelled` · `tradesCountered` · `tradesVoided` | trades closed without a deal that day, by `resolvedAt`. An expired trade is `CANCELLED` (with a `trade.expire` audit row), so it counts here | `trades` |
| `requests` | every `/api/v1` response except `/api/v1/health/*` and CORS preflights (`OPTIONS`), whatever its status — 401 and 404 included | Redis `metrics:requests:{day}` |
| `serverErrors` | those responses at 500 and above | Redis `metrics:server_errors:{day}` |
| `errorRate` | `serverErrors / requests`, capped at 1; `null` on a day with no requests. Both counters of one response are written in one `MULTI` on one day, and the cap guards a day where one of them was lost | computed |
| `packFallbacks` | openings in which a slot fell back to another rarity because the template has drifted from the catalog — one per opening, however many slots | Redis, from `PackOpeningService` |
| `packUnavailable` | opens refused with 409 `PACK_UNAVAILABLE` | Redis, from `PackOpeningService` |

**`0` and `null` are different.** A day with no traffic reads `requests: 0`; only an unreadable Redis gives `null`. Counters are kept 100 days, beyond the longest window.

**The cards read `summary`, the chart reads `series`.** Activity is recorded per day, so a rolling 24 h DAU cannot exist, and putting a day's DAU beside a rolling 24 h of packs would compare two periods. The cards therefore show the last complete day against the day before; today stays in `series`, flagged `partial`. `summary` is taken from the same rows as `series` and cannot disagree with it.

**Freshness is the sync status's own read.** `freshness.lastRuns` and `queues` come from the same `AdminSyncService.status()` that serves `GET /admin/sync/status`, so the two pages cannot disagree. `oldestPriceUpdatedAt` and `cardsWithoutPrice` are read from the `cards (priceUpdatedAt)` index.

**Cached 60 s** under `cache:admin:metrics:{days}`; `generatedAt` says when the numbers were computed. Nothing invalidates it.

**Degradation**, each section on its own:

| Unreadable | `series` | counter fields | `summary` | `freshness` | `queues` |
|---|---|---|---|---|---|
| the aggregate tables | `null` | — | `null` | present if `cards` answers | from the sync status |
| Redis | present | `null` | present | present; `lastRuns` from the sync status | `null` |

**No 90-day window.** The design first offered one. Measured over the budget dataset, a 90-day window covers nearly every row: `pack_openings` alone took 353 ms to count a million openings, from the table or from its index alike, and the four aggregates summed to 685 ms. A 90-day view needs a daily rollup table, when one is wanted.

**Measured, 2026-09-30**, against the running stack:

- **the budget (AC1)**, over 50 000 users, 1 000 000 pack openings, 200 000 trades and 477 000 activity rows:
  - uncached at `days=30`: p50 107 ms, p95 118 ms, max 120 ms over 20 requests, all 200;
  - at `days=14`: p50 53 ms, p95 66 ms;
  - cached: 6 ms;
  - every aggregate an index-only scan — 29, 107, 22 and 35 ms at 30 days, run in parallel
- **the hot path**: `/users/me` p50 5.7 ms after against 5.6 ms before (p95 6.5 against 7.0) — activity and counting both happen off the response path
- **access and shape**:
  - member 403; signed out 401; `days=5` 400; `days=90` 400;
  - the default gave 14 rows ending today, only the last `partial`, with `summary` yesterday against the day before; `days=30` gave 30 rows
- **activity**:
  - five requests by one user wrote one `user_activity` row, and a restart and one more request still one;
  - an anonymous request to a public route none;
  - a suspended user's surviving session was refused with 403 and wrote none
- **request counters**: a 401 and a 404 each counted and a health probe not; a forced 500 counted in `serverErrors`
- **pack counters**: three opens of a drifted template counted 3 fallbacks; a template with no card for its only rarity was 409 `PACK_UNAVAILABLE` and counted 1
- **trade bucketing**: a trade created yesterday and accepted today counted as proposed yesterday and accepted today; one cancelled at `23:59:59` yesterday counted as yesterday's
- **freshness (AC2)**: `freshness.lastRuns` and `queues` byte-identical to `GET /admin/sync/status` with the cache cleared
- **cache**: two requests returned the same `generatedAt`; after deleting the key, a new one
- **degradation**:
  - Redis stopped: 200 in 2 089 ms, counter fields and `queues` null, `activeUsers` and freshness present;
  - `pack_openings` renamed away: `series` and `summary` null, `freshness` and `queues` present

## Health

| Method | Path | Notes |
|---|---|---|
| GET | `/` | The API root — a plain-text greeting that proves the process answers; public |
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
