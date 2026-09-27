# API Reference

> REST, JSON, versioned under `/api/v1`. Swagger served at `/docs`.
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

Served entirely from the mirror. No route here can reach an external API — `CatalogModule` imports nothing, and the provider tokens live in `SyncModule`, which it does not import. Verified by pointing `POKEMONTCG_BASE_URL` at an unroutable host and watching every route answer 200 in single-digit milliseconds.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/cards` | public | `q`, `set`, `rarity`, `type`, `supertype`, `sort`, `page`, `pageSize` |
| GET | `/cards/:id` | public | 404 when absent |
| GET | `/sets` | public | all 176, unpaginated |
| GET | `/sets/:id` | public | the set plus `cardCount` |
| GET | `/facets` | public | selectable values for every filter, with counts |

**Sorting is `name_asc` or `name_desc`, and `id` always rides along.** 16 216 of the 20 670 cards share a name — `Pikachu` alone appears 134 times — so an order by name alone lets PostgreSQL return ties differently between requests, and offset pagination then shows one row twice and another never. `ORDER BY name, id` plans as an `Incremental Sort` with `Presorted Key: name`, so the btree still does the work. Verified: two pages of 50 share no ids and cover 100 distinct cards.

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
| `q` | optional, 1–100 chars; case-insensitive contains on the card name |
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
| GET | `/packs/templates` | member | Active templates only |
| POST | `/packs/:templateId/open` | member | Body `{ openId }` — **idempotent**, transactional |
| GET | `/packs/history` | member | Past openings |
| GET | `/admin/pack-templates` | admin | Every template, inactive included |
| POST | `/admin/pack-templates` | admin | Create; validated against the card pool; audited |
| PATCH | `/admin/pack-templates/:id` | admin | Partial update, including `active`; audited |

**A template is `{ name, setFilter, cost, slotConfig, active }`.** `setFilter` is `{ "setIds": [...] }` (1–50 sets, no other keys). `slotConfig` is the shape in [UserFlows.md](UserFlows.md) §5: `{ "slots": [{ "count", "weights" }] }`, 1–10 slots, at most 20 cards per pack, integer weights ≥ 0 with at least one positive weight per slot. Unknown keys are rejected at every level.

**Validation has two layers, and both run on save.** The shape is checked by the Zod pipe — the example in UserFlows §5 passes it unchanged. The **pool** is checked by the service: every set in `setFilter` must exist, and every rarity named in any slot's weights must occur among that set's cards, or the save is a 400 naming the missing rarities. Verified: the UserFlows example saves against `bw4` + `bw5`, and the same config against `base1` + `base2` is refused for `"Rare Holo EX", "Rare Ultra", "Rare Secret"`. A `PATCH` that changes neither `setFilter` nor `slotConfig` skips the pool check, so a template whose sets later lose a rarity can still be renamed or deactivated.

**Weights are an unordered map.** The column is `jsonb`, which stores object keys in its own order (shorter keys first), so `weights` reads back with the same entries in a different order. Slot order is preserved. Nothing may depend on the order of a slot's weights — including a fallback from an empty rarity bucket, which needs its own ordering.

**There is no delete.** Openings reference their template with `Restrict`, and a player's history has to keep saying which pack they opened. Retire a template with `PATCH { "active": false }`; members stop seeing it at once.

**Every create and update writes one `AuditLog` row in the same transaction** — `pack_template.create` / `pack_template.update`, entity `PackTemplate`, the submitted body in `meta`. A refused save writes none. Verified: eleven refused saves, zero rows. The writer is `AuditService.record(tx, entry)` in `apps/api/src/audit`; PD-79 wires the remaining admin actions to it.

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

## Admin / Sync

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/admin/sync/catalog` | admin | Enqueue catalog sync |
| POST | `/admin/sync/prices` | admin | Enqueue price sync |
| GET | `/admin/sync/status` | admin | Last run per `SyncKind`, plus breaker state per provider |
| GET | `/admin/metrics` | admin | DAU, packs opened, trade volume, freshness |

**`GET /admin/sync/status` is read only and returns two things**: the last run
of each `SyncKind` — provider, status, timestamps, processed and failed counts,
and the error or reason — and the breaker state per provider, as `failures` and
an `openUntil` that says when the primary will be tried again.

`openUntil` rather than "opened at", because it answers the question an operator
is actually asking during an outage.

**The last run is now reported for three kinds, not two: `CATALOG`, `PRICE`
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

**With Redis unavailable it still answers 200**, reporting every breaker as
closed. A breaker that cannot be read is the same to this endpoint as one that
is shut, which is also what the selector assumes.

Triggering a sync and clearing a breaker are PD-81's half of this surface, in
M10. This exists now because PD-43's third acceptance criterion is a statement
about an endpoint.

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
