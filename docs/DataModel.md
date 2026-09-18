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
`id, email, emailVerified, displayName, avatarUrl, role(MEMBER|ADMIN), currency, createdAt, updatedAt`
→ many `InventoryItem`, `Deck`, `Trade`, `PackOpening`, `CurrencyTransaction`, `Notification`.

**There is no `passwordHash`.** Better Auth stores the credential password hashed on `Account.password`; a column here would look like the real one and eventually be written to. Verified against the running adapter.

`emailVerified` and `updatedAt` are required by Better Auth's core schema. `displayName` and `avatarUrl` are the Better Auth fields `name` and `image` under our own names — the rename is declared once, in the `user.fields` block of the auth config, and the adapter fails to find its columns without it.

`role` and `currency` are ours, not Better Auth's. The adapter only learns of them through `user.additionalFields`, and both must be declared there with `input: false`. That flag is load-bearing: with `input: true` a sign-up body carrying `role: "ADMIN"` creates an administrator, which was confirmed by trying it.

### Session / Account / Verification
Better Auth core tables, taken verbatim from `@better-auth/core` rather than from prose, and regenerable with `npx auth@latest generate --adapter prisma`.

| Table | Fields |
|---|---|
| `Session` | `id, token(unique), expiresAt, ipAddress?, userAgent?, userId→User cascade, createdAt, updatedAt` |
| `Account` | `id, accountId, providerId, userId→User cascade, accessToken?, refreshToken?, idToken?, accessTokenExpiresAt?, refreshTokenExpiresAt?, scope?, password?, createdAt, updatedAt` |
| `Verification` | `id, identifier(indexed), value, expiresAt, createdAt, updatedAt` |

One row in `Account` per authentication method: the credential provider (`providerId = "credential"`) keeps its hash in `password`, OAuth providers keep their tokens. Deleting a user cascades to both tables.

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
**Index:** `(cardId, capturedAt)`. Cascades from `Card` — snapshots are derived data. Fastest-growing table → partition by time / downsample old data.

The **≤ 1 snapshot/card/day** cap is enforced by the price sync job, not by the schema. Expressing it needs a unique index over `capturedAt::date`, and Prisma cannot declare expression indexes; adding one by hand would read as schema drift and Prisma would try to drop it on every subsequent migration.


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
`id, userId, templateId, openId(unique), createdAt`
**Unique** `openId` → idempotency guard. → many `PackOpeningCard` (`cardId`, rarity pulled).

### Deck
`id, userId, name, format, isPublic, createdAt`
→ many `DeckCard`.

### DeckCard
`id, deckId, cardId, count`
**Unique** `(deckId, cardId)`, and `count >= 1`.

The **max-copies rule is not a check constraint.** Basic energy is exempt from it, and `deck_cards` cannot see the card's `supertype` — a `count <= 4` here would simply be wrong. That rule belongs to the deck validation engine. A card that appears in any deck cannot be deleted from the catalog; deleting the deck takes its rows with it.

### Trade
`id, initiatorId, recipientId, status(TradeStatus), currencyFromInitiator, currencyFromRecipient, createdAt, resolvedAt, counteredTradeId?`
→ many `TradeItem`.

`counteredTradeId` is a **unique** self-reference to the trade this one replaces. Unique on purpose: a trade can be countered at most once, which makes the chain a list rather than a tree and turns a race between two counter-offers into a constraint violation instead of a fork. Walk it with a recursive CTE — verified over a three-link chain.

Both user relations are **Restrict**, unlike everything else a user owns. A trade belongs to two people, so cascading from one party would silently erase the other party's record of their own completed trade. Verified: a user who has traded cannot be deleted, one who never has can. Account deletion, when it is built, must anonymise rather than delete.

**Indexes:** `(recipientId, status)` and `(initiatorId, status)`. Measured over 20 000 trades: both inbox views plan as a bitmap scan of their own composite index.

> **A PENDING trade holds escrow** — `lockedQuantity` on inventory rows. Nothing in the schema can enforce that removing or voiding such a trade releases those locks. Cards locked by a trade that no longer exists stay locked forever, and only the settlement and expiry jobs can prevent that.

### TradeItem
`id, tradeId, side(OFFERED|REQUESTED), cardId, quantity`

### CurrencyTransaction — *audit trail for balances*
`id, userId, amount, type(GRANT|PACK_SPEND|TRADE), refId, createdAt`

### AuditLog — *admin & sensitive actions*
`id, actorId?, action, entity, entityId, meta(json), createdAt`

**`actorId` is nullable.** Not every audited action has a human behind it — the trade-expiry job cancels trades on its own, and that is exactly the kind of event worth recording. Null therefore means *the system*.

The foreign key is **Restrict**, not SetNull, so that meaning stays honest: deleting a user can never quietly convert their recorded actions into system actions. The two must remain distinguishable.

Append-only by convention; nothing in application code updates or deletes these rows. The schema cannot enforce that — a trigger could, at the cost of a hand-written object Prisma does not model.

**Indexes:** `(entity, entityId)` for one object's history, `(actorId, createdAt)` for one admin's. Measured over 40 000 rows: an entity lookup is an index scan returning in 0.07 ms.

### Notification
`id, userId, type, payload(json), readAt, createdAt`

Cascades from the user — ephemeral and theirs alone. **Index:** `(userId, readAt)`, which serves the unread badge.

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
| `trade_not_self` | `initiatorId <> recipientId` |
| `trade_not_self_counter` | `counteredTradeId IS NULL OR counteredTradeId <> id` |
| `trade_currency_from_initiator_non_negative` | `currencyFromInitiator >= 0` |
| `trade_currency_from_recipient_non_negative` | `currencyFromRecipient >= 0` |
| `trade_item_quantity_positive` | `quantity >= 1` |
| `deck_card_count_positive` | `count >= 1` |

The third is the one that stops a card being promised to two trades at once, and it holds on `UPDATE` as well as `INSERT` — which is the path escrow actually takes. The first is logically implied by the other two and is kept as an explicit statement of intent. The fourth is not in the original specification; a negative cost would pay a user for opening a pack.

> **Editing a `--create-only` migration:** Prisma writes its placeholder comment with no trailing newline, so appending to the file turns your first statement into part of that comment and it is skipped in silence.

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
