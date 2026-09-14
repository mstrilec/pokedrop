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
`id, email, passwordHash?, displayName, avatarUrl, role(MEMBER|ADMIN), currency, createdAt`
→ many `InventoryItem`, `Deck`, `Trade`, `PackOpening`, `CurrencyTransaction`, `Notification`.

### Session / Account
Managed by the **Better Auth** adapter (sessions, OAuth accounts, verification tokens). Shares the same Prisma client.

### Set — *mirrored from API*
`id, name, series, releaseDate, printedTotal, total, symbolUrl, logoUrl`
→ many `Card`.

### Card — *mirrored + price-synced*
`id, setId, name, supertype, subtypes[], hp, types[], rarity, retreatCost, weaknesses(json), resistances(json), attacks(json), abilities(json), nationalPokedexNumbers[], imageSmall, imageLarge, legalities(json), tcgplayerId?, cardmarketId?, latestPriceUsd?, latestPriceEur?, priceUpdatedAt`
**Indexes:** `name`, `setId`, `rarity`, `types`.
→ many `InventoryItem`, `DeckCard`, `TradeItem`, `PriceSnapshot`.

### PriceSnapshot — *time-series*
`id, cardId, source(TCGPLAYER|CARDMARKET), currency, market, low, mid, high, capturedAt`
**Index:** `(cardId, capturedAt)`. Throttled to ≤ 1 snapshot/card/day. Fastest-growing table → partition by time / downsample old data.

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
**Unique** `(deckId, cardId)`. Enforces max-copies legality.

### Trade
`id, initiatorId, recipientId, status(TradeStatus), currencyFromInitiator, currencyFromRecipient, createdAt, resolvedAt`
→ many `TradeItem`.

### TradeItem
`id, tradeId, side(OFFERED|REQUESTED), cardId, quantity`

### CurrencyTransaction — *audit trail for balances*
`id, userId, amount, type(GRANT|PACK_SPEND|TRADE), refId, createdAt`

### AuditLog — *admin & sensitive actions*
`id, actorId, action, entity, entityId, meta(json), createdAt`

### Notification
`id, userId, type, payload(json), readAt, createdAt`

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
- The catalog (Set/Card/PriceSnapshot) is re-syncable from source; the irreplaceable data is **users / inventory / decks / trades** — prioritize for backups.
