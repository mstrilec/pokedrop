# Data Model

> PostgreSQL via Prisma — the source of truth. High-level entities, relationships, enums, and indexes.
> Consumed by [API.md](API.md), [UserFlows.md](UserFlows.md), and the sync layer in [Architecture.md](Architecture.md).

## Enums

| Enum | Values |
|---|---|
| `Role` | `MEMBER`, `ADMIN` |
| `Rarity` (tier) | `Common`, `Uncommon`, `Rare`, `Rare Holo`, `Rare Holo EX`, `Rare Ultra`, `Rare Secret` … (extensible; UI ramp maps to Common/Uncommon/Rare/Ultra Rare/Secret Rare) |
| `TradeStatus` | `PENDING`, `ACCEPTED`, `DECLINED`, `COUNTERED`, `CANCELLED`, `VOIDED` |
| `TradeItemSide` | `OFFERED`, `REQUESTED` |
| `PriceSource` | `TCGPLAYER`, `CARDMARKET` |
| `TransactionType` | `GRANT`, `PACK_SPEND`, `TRADE` |

## Entities

### User
`id, email, emailVerified, displayName, avatarUrl, role(MEMBER|ADMIN), currency, createdAt, updatedAt, showCollectionValue, showSetCompletion, showcaseCardIds, suspendedAt`
→ many `InventoryItem`, `Deck`, `Trade`, `PackOpening`, `CurrencyTransaction`, `Notification`.

**There is no `passwordHash`.** Better Auth stores the credential password hashed on `Account.password`; a column here would look like the real one and eventually be written to. Verified against the running adapter.

`emailVerified` and `updatedAt` are required by Better Auth's core schema. `displayName` and `avatarUrl` are the Better Auth fields `name` and `image` under our own names — the rename is declared once, in the `user.fields` block of the auth config, and the adapter fails to find its columns without it.

`role` and `currency` are ours, not Better Auth's. The adapter only learns of them through `user.additionalFields`, and both must be declared there with `input: false`. That flag is load-bearing: with `input: true` a sign-up body carrying `role: "ADMIN"` creates an administrator, which was confirmed by trying it.

`showCollectionValue`, `showSetCompletion` and `showcaseCardIds` are ours too, and deliberately **not** declared to Better Auth: nothing in its flows reads or writes them, and an undeclared field is one no auth endpoint can accept. Both toggles default to `false`. `showcaseCardIds` is an ordered `text[]` of at most six card ids with no foreign key — a card its owner trades away stays in the array and is filtered out on read, so it needs no cleanup on every trade. See [API.md](API.md) (Users / Profile).

`suspendedAt` is null for an active account and set while an admin has suspended it. Unlike the profile fields it **is** declared to Better Auth, with `input: false`: that puts it on `session.user`, so `SessionGuard` reads it without a query, and makes a sign-up body carrying it a 400. It is enforced three ways — the suspending transaction deletes the sessions, a session-creation hook refuses new ones, and the guard refuses any that slipped between; see [API.md](API.md) (Admin / Users).

### Session / Account / Verification
Better Auth core tables, taken verbatim from `@better-auth/core` rather than from prose, and regenerable with `npx auth@latest generate --adapter prisma`.

| Table | Fields |
|---|---|
| `Session` | `id, token(unique), expiresAt, ipAddress?, userAgent?, userId→User cascade, createdAt, updatedAt` |
| `Account` | `id, accountId, providerId, userId→User cascade, accessToken?, refreshToken?, idToken?, accessTokenExpiresAt?, refreshTokenExpiresAt?, scope?, password?, createdAt, updatedAt` |
| `Verification` | `id, identifier(indexed), value, expiresAt, createdAt, updatedAt` |

One row in `Account` per authentication method: the credential provider (`providerId = "credential"`) keeps its hash in `password`, OAuth providers keep their tokens. Deleting a user cascades to both tables.

### UserActivity — *operational*
`userId→User cascade, day(date, UTC)` — **primary key** `(userId, day)`, **index** `(day)`.

One row per user per UTC day on which they made an authenticated `/api/v1` request; the source of daily active users (`docs/API.md`, Admin / Metrics). Sessions cannot serve that purpose: they are deleted on sign-out, expiry and suspension, so they hold no history.

**Written by `SessionGuard`** for a valid session of a user who is not suspended, through `ActivityService.touch`: an in-memory set of today's ids per process means one `INSERT … ON CONFLICT DO NOTHING` per user per day per process, not awaited by the request; replicas each insert once and the primary key absorbs the rest. A failed insert is retried by that user's next request. A sign-in alone is not activity — `/api/auth/*` does not pass through `SessionGuard`.

**Read** as `count(*) … WHERE day >= $from GROUP BY day`, an index-only scan on `(day)`. **No retention job:** at 5 000 daily users it grows by about 1.8 million rows a year.

### Set — *mirrored from API*
`id, name, series, releaseDate, printedTotal, total, symbolUrl, logoUrl, updatedAt`
→ many `Card`.

The Prisma model is named **`CardSet`**, mapped to table `sets`. Two reasons: `set` is a reserved word in PostgreSQL, and a generated TypeScript type named `Set` shadows the global one for every file that imports it — the same reason @pokedrop/shared exports `CardSetSchema`.

`Card.setId` is **`onDelete: Restrict`**, not cascade. A cascade from a set would delete its cards, and cards cascade into `InventoryItem` — deleting one catalog row would destroy user property. Verified: deleting a set holding 400 cards raises a foreign-key error and every card survives. A mirrored set should never be deleted anyway; sync only upserts.

### Card — *mirrored + price-synced*
`id, setId, name, supertype, subtypes[], hp, types[], rarity, retreatCost, weaknesses(json), resistances(json), attacks(json), abilities(json), nationalPokedexNumbers[], imageSmall, imageLarge, legalities(json), tcgplayerId?, cardmarketId?, latestPriceUsd?, latestPriceEur?, priceUpdatedAt`
**Indexes:** `name`, `setId`, `rarity`; `types` is **GIN**, since a btree over an array cannot serve a containment query. Prices are `Decimal(10,2)`, not float — they are summed into collection valuations.

Measured on 20 000 synthetic cards: a `setId + rarity` filter plans as a `BitmapAnd` of both btrees, and `setId + types` as a `BitmapAnd` of the btree and the GIN index. A containment query alone uses the GIN index when the type is selective; at ~17% of rows the planner may prefer a sequential scan, which is the correct choice rather than a fault.
→ many `InventoryItem`, `DeckCard`, `TradeItem`, `PriceSnapshot`.

### PriceSnapshot — *time-series*
`id, cardId, source(TCGPLAYER|CARDMARKET), currency, market, low, mid, high, capturedAt`
**Indexes:** `(cardId, capturedAt)`, and a unique index on `(cardId, source, capturedOn)`. Cascades from `Card` — snapshots are derived data. Fastest-growing table, now bounded at two rows per card per day by a constraint rather than by a job behaving correctly → partition by time / downsample old data.

The **≤ 1 snapshot/card/day** cap is a unique index on
`(cardId, source, capturedOn)`, where `capturedOn` is the UTC day of
`capturedAt`, materialised as a `date` column.

This section used to say the cap could not live in the schema, because
expressing it needs a unique index over `capturedAt::date` and Prisma cannot
declare expression indexes. The premise is true; the conclusion was not.
Materialising the day makes the index an ordinary composite one, which Prisma
declares natively — no hand-written SQL, no drift, nothing for a later
`migrate dev` to try to drop.

Prisma has no generated columns, so nothing in the database forces `capturedOn`
to agree with `capturedAt`. The price sync processor is the only writer and
derives both from one instant per job. **In UTC** — local time would make a day
mean different things on different machines, and the cap would admit a second
row the first time a clock crossed a DST boundary.

The cap is on history, not on freshness: a second run the same day writes no
snapshot and still refreshes `latestPriceUsd`, `latestPriceEur` and
`priceUpdatedAt`.


### SyncRun — *operational*

`id, kind(CATALOG|PRICE), provider, status(RUNNING|SUCCEEDED|PARTIAL|FAILED), jobId?, startedAt, finishedAt?, processed, failed, cursor(json)?, error?`
**Index:** `(kind, startedAt DESC)` — every consumer asks for the most recent run of a kind.

One row per execution of a background sync. Redis and BullMQ job state were both considered and rejected: Redis loses the history on `docker compose down -v` and its keys would have to live outside the `cache:` namespace or a routine invalidation would sweep them, and BullMQ's retention is bounded so "the last successful catalog run" is a scan there rather than a query.

`cursor` is the resume point — `{ "page": 12 }` for a catalog run. `jobId` is what makes resuming safe: a `RUNNING` row is only continued when the BullMQ job now executing is the one that created it, so a retry resumes and a new job starts clean.

`provider` is a plain string on purpose. A closed enum would need a migration every time a provider is added, which is exactly the coupling the `CardSourceProvider` adapter removes.

### InventoryItem
`id, userId, cardId, quantity, lockedQuantity, acquiredAt`
**Unique** `(userId, cardId)`. `lockedQuantity` supports trade escrow; `availableQuantity = quantity − lockedQuantity`.

### PackTemplate — *admin-managed*
`id, name, setFilter(json), cost, slotConfig(json), active`
`slotConfig` = ordered slots each with a rarity-weight distribution (see [UserFlows.md](UserFlows.md#5-pack-opening--state-machine--algorithm)).

### PackOpening
`id, userId, templateId, openId(unique), seed?, createdAt`
**Unique** `openId` → idempotency guard. → many `PackOpeningCard` (`cardId`, rarity pulled, `position`).
`position` is the 0-based pull order, so a replay reveals the cards in the order they were first revealed.
`seed` is the hex of the 32-byte generator seed — null only for openings before PD-57; it reproduces a pack while the card pool is unchanged.
**Indexes:** `(userId, createdAt)` for a user's history, and `(createdAt)` for the admin metrics' packs opened per day — an index-only range scan, 107 ms over 329 000 openings in a 30-day window.

### Deck
`id, userId, name, format, isPublic, ownedOnly, createdAt`
→ many `DeckCard`.

`ownedOnly` is the deck's mode: when true, validation treats a card beyond the owner's available copies as an error rather than a warning. It is read by the validation engine and nothing else; changing it never touches the decklist. Validity itself is never stored — it depends on inventory and on legalities a sync can change, so a stored verdict would go stale.

### DeckCard
`id, deckId, cardId, count`
**Unique** `(deckId, cardId)`, and `count >= 1`.

The **max-copies rule is not a check constraint.** Basic energy is exempt from it, and `deck_cards` cannot see the card's `supertype` — a `count <= 4` here would simply be wrong. That rule belongs to the deck validation engine. A card that appears in any deck cannot be deleted from the catalog; deleting the deck takes its rows with it.

### Trade
`id, initiatorId, recipientId, status(TradeStatus), currencyFromInitiator, currencyFromRecipient, createdAt, resolvedAt, counteredTradeId?`
→ many `TradeItem`.

`counteredTradeId` is a **unique** self-reference to the trade this one replaces. Unique on purpose: a trade can be countered at most once, which makes the chain a list rather than a tree and turns a race between two counter-offers into a constraint violation instead of a fork. Walk it with a recursive CTE — verified over a three-link chain.

Both user relations are **Restrict**, unlike everything else a user owns. A trade belongs to two people, so cascading from one party would silently erase the other party's record of their own completed trade. Verified: a user who has traded cannot be deleted, one who never has can. Account deletion, when it is built, must anonymise rather than delete.

**Indexes:** `(recipientId, status)` and `(initiatorId, status)`. Measured over 20 000 trades: both inbox views plan as a bitmap scan of their own composite index. `(createdAt)` and `(resolvedAt, status)` serve the admin metrics — trades proposed per day, and outcomes per day and status — both index-only over a 30-day window (22 and 35 ms over 200 000 trades).

> **A PENDING trade holds escrow** — `lockedQuantity` on inventory rows. Nothing in the schema can enforce that removing or voiding such a trade releases those locks. Cards locked by a trade that no longer exists stay locked forever, and only the settlement and expiry jobs can prevent that.

**The lock invariant.** For every `(userId, cardId)`, `lockedQuantity` equals the sum of `OFFERED` quantities over `PENDING` trades that user initiated — the recipient's cards are never locked. Proposing adds, every way out of `PENDING` subtracts in the same transaction, and accepting consumes the lock with the copies. Zero rows from this query means no lock has leaked:

```sql
WITH promised AS (
  SELECT t."initiatorId" AS u, ti."cardId" AS c, SUM(ti.quantity) AS q
  FROM trades t JOIN trade_items ti ON ti."tradeId" = t.id
  WHERE t.status = 'PENDING' AND ti.side = 'OFFERED'
  GROUP BY 1, 2
)
SELECT i."userId", i."cardId", i."lockedQuantity", COALESCE(p.q, 0) AS promised
FROM inventory_items i
FULL JOIN promised p ON p.u = i."userId" AND p.c = i."cardId"
WHERE COALESCE(i."lockedQuantity", 0) <> COALESCE(p.q, 0);
```

**Lock order.** A transaction that touches trades takes the trade row, then `users` rows by ascending id (only when coins move), then `inventory_items` rows by ascending `(userId, cardId)` — the pack open's order, so neither can deadlock the other.

**The timeline is the audit log.** Every transition writes one `AuditLog` row (`entity 'Trade'`, `meta.from`/`meta.to`); a trade's first is always `trade.propose`, and a counter's carries `meta.counteredTradeId`.

### TradeItem
`id, tradeId, side(OFFERED|REQUESTED), cardId, quantity`

### CurrencyTransaction — *audit trail for balances*
`id, userId, amount, type(GRANT|PACK_SPEND|TRADE|TRADE_REVERSAL), refId, createdAt`

`TRADE_REVERSAL` is its own type because the unique `(userId, type, refId)` already holds a settled trade's `TRADE` rows: an admin void of that trade writes the opposite amounts under the same `refId`, and the pair stays readable as a settlement and its reversal. The key also makes a second reversal of one trade impossible.

### AuditLog — *admin & sensitive actions*
`id, actorId?, action, entity, entityId, meta(json), createdAt`

**`actorId` is nullable.** Not every audited action has a human behind it — the trade-expiry job cancels trades on its own, and that is exactly the kind of event worth recording. Null therefore means *the system*.

The foreign key is **Restrict**, not SetNull, so that meaning stays honest: deleting a user can never quietly convert their recorded actions into system actions. The two must remain distinguishable.

Append-only by convention; nothing in application code updates or deletes these rows. The schema cannot enforce that — a trigger could, at the cost of a hand-written object Prisma does not model.

**Indexes:** `(entity, entityId)` for one object's history, `(actorId, createdAt)` for one admin's. Measured over 40 000 rows: an entity lookup is an index scan returning in 0.07 ms.

**The writer** is `AuditService.record(tx, entry)` (`apps/api/src/audit`, a global module). It takes the caller's transaction, so an action that rolls back leaves no row — measured for a refused pack-template save, a grant and a suspension whose audit insert was made to fail. `TradeCloseService.voidAllPendingOf` writes a suspension's trade rows with one `createMany` in the same transaction. One object's history is `WHERE entity = … AND "entityId" = … ORDER BY "createdAt", id` on the first index; the trade timeline reads it exactly that way.

**What is audited** — every admin action that changes something, and the trade transitions:

| Action | Entity | Written by | `actorId` |
|---|---|---|---|
| `pack_template.create` · `pack_template.update` | `PackTemplate` | `POST` / `PATCH /admin/pack-templates` | the admin |
| `user.currency_grant` · `user.role_change` · `user.suspend` · `user.unsuspend` | `User` | `/admin/users/:id/…` | the admin |
| `trade.void` | `Trade` | `POST /admin/trades/:id/void`, and each trade a suspension voids | the admin |
| `trade.propose` · `trade.accept` (the settlement) · `trade.decline` · `trade.cancel` · `trade.counter` | `Trade` | the member routes | the member |
| `trade.expire` | `Trade` | the expiry job | null — the system |
| `sync.trigger` | `SyncJob` | `POST /admin/sync/catalog` · `/prices` | the admin |
| `sync.breaker_reset` | `Provider` | `POST /admin/sync/breakers/:provider/reset` | the admin |

**Not audited, deliberately:**

- **Admin reads** — `GET /admin/sync/status`, `/admin/pack-templates`, `/admin/trades/:id`, `/admin/users`. They change nothing, and a row per page view would bury the rows that matter.
- **Admin writes that change nothing** — a role set to the role already held, a suspension of a suspended account, an unsuspension of an active one, a replayed `grantId`, a sync trigger refused with `SYNC_IN_PROGRESS`, a reset of a breaker with nothing to clear. The row records a change; there was none.

**Sync triggers are the one audited action whose effect lives outside Postgres.** `sync.trigger` names a `SyncJob` by its BullMQ job id, not a `SyncRun`: no run row exists when the job is queued, and the processor later writes one with the same id, so `sync_runs."jobId" = audit_logs."entityId"` joins them. The audit row is written first and the enqueue second, inside one transaction, because Redis cannot join it and the order decides what a failure leaves: a failed or refused enqueue rolls the row back. Two outcomes are accepted rather than prevented — a job with no audit row, when the `COMMIT` fails after the `add`, or when Redis fails in the moment between the trigger's first read and its `add` (the `add` waits in ioredis' offline queue and lands once Redis returns — measured); and two admins triggering a catalog sync and a price sweep at the same instant both getting a job, which costs only contention for the shared rate limit. `sync.breaker_reset` is written before the `DEL` of the breaker keys, so a failed `DEL` leaves no row. A reset of a breaker that has nothing to clear writes nothing.

Every admin route that mutates is audited — checked route by route on 2026-09-29, after PD-81.

### Notification
`id, userId, type, payload(json), readAt, createdAt`

Cascades from the user — ephemeral and theirs alone. **Index:** `(userId, readAt)`, which serves the unread badge.

`type` stays an open string, but each kind the application writes has a payload schema in `@pokedrop/shared` (`NOTIFICATION_PAYLOAD_SCHEMAS`), and reads go through it — see [API.md](API.md) (Notifications). No payload carries an actor's user id.

Deliberately **only that one index.** Measured over 40 000 notifications, the notification-list query (`userId`, newest first, limit 20) uses the same index for the lookup and finishes the ordering with a top-N heapsort in 0.2 ms, so a second index on `(userId, createdAt)` would cost writes and buy nothing at this size.

## Relationships

```
User 1─N InventoryItem
User 1─N Deck
User 1─N Trade (as initiator | recipient)
User 1─N PackOpening
User 1─N CurrencyTransaction
User 1─N Notification
Set  1─N Card
Card 1─N InventoryItem | DeckCard | TradeItem | PriceSnapshot
Trade 1─N TradeItem
Deck 1─N DeckCard
PackTemplate 1─N PackOpening 1─N PackOpeningCard
```

## Integrity rules

- Currency / item / trade mutations run inside **DB transactions**.
- **Unique constraints** back idempotency (`PackOpening.openId`) and prevent duplicate rows (`InventoryItem (userId,cardId)`, `DeckCard (deckId,cardId)`).
- `lockedQuantity` prevents over-promising the same card across trades.

### Check constraints

Prisma has no syntax for them, so they live in a hand-written migration. That is safe: Prisma models tables, columns, indexes and foreign keys, and has no concept of a check constraint — it neither reports these as drift nor drops them. Confirmed by replaying the migration history into an empty database, which is what a deployment does.

| Constraint | Rule |
|---|---|
| `inventory_quantity_non_negative` | `quantity >= 0` |
| `inventory_locked_non_negative` | `lockedQuantity >= 0` |
| `inventory_locked_within_quantity` | `lockedQuantity <= quantity` |
| `pack_template_cost_non_negative` | `cost >= 0` |
| `users_currency_non_negative` | `currency >= 0` |
| `trade_not_self` | `initiatorId <> recipientId` |
| `trade_not_self_counter` | `counteredTradeId IS NULL OR counteredTradeId <> id` |
| `trade_currency_from_initiator_non_negative` | `currencyFromInitiator >= 0` |
| `trade_currency_from_recipient_non_negative` | `currencyFromRecipient >= 0` |
| `trade_item_quantity_positive` | `quantity >= 1` |
| `deck_card_count_positive` | `count >= 1` |

The third is the one that stops a card being promised to two trades at once, and it holds on `UPDATE` as well as `INSERT` — which is the path escrow actually takes. The first is logically implied by the other two and is kept as an explicit statement of intent. The fourth is not in the original specification; a negative cost would pay a user for opening a pack. `users_currency_non_negative` (PD-58) is the backstop behind the pack open's conditional debit and every later path that touches a balance: a bug can refuse a spend, never overdraw.

> **Editing a `--create-only` migration:** Prisma writes its placeholder comment with no trailing newline, so appending to the file turns your first statement into part of that comment and it is skipped in silence.

> **`prisma migrate dev` refuses to run in a non-interactive shell.** It exits
> before any prompt with "environment is non-interactive", so an agent or a CI
> step cannot use it at all. The working path is to generate the SQL with
> `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`,
> write it into a timestamped folder under `prisma/migrations/`, and apply it
> with `prisma migrate deploy`. Verified equivalent: `_prisma_migrations`
> bookkeeping is consistent afterwards and `prisma migrate status` reports
> "Database schema is up to date!".

### Deletes

Everything a user owns cascades from the user; nothing cascades from the catalog.

| Relation | Rule | Why |
|---|---|---|
| `InventoryItem.cardId → Card` | Restrict | deleting a catalog row must not empty a collection |
| `PackOpeningCard.cardId → Card` | Restrict | the same, for pull history |
| `PackOpening.templateId → PackTemplate` | Restrict | `active` exists so templates are retired, not deleted |
| `Card.setId → CardSet` | Restrict | a set delete would reach inventory through its cards |
| `InventoryItem/PackOpening/CurrencyTransaction.userId → User` | Cascade | the user's own data |
| `PackOpeningCard → PackOpening`, `PriceSnapshot → Card` | Cascade | derived data |

Verified: deleting a user leaves zero inventory rows, openings and transactions, and the catalog untouched.

### Balance

`User.currency` is a denormalised balance beside the `CurrencyTransaction` ledger, and **nothing in the schema keeps them in agreement**. That invariant belongs to the transaction that writes both.
- The catalog (Set/Card/PriceSnapshot) is re-syncable from source; the irreplaceable data is **users / inventory / decks / trades** — prioritize for backups.
