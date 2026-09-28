# PD-68 – PD-71 — The trade core: propose, close, settle, counter

Design, 2026-09-28. Milestone M8 · Trading System.

Tickets:
[PD-68](https://linear.app/mstrilec/issue/PD-68/trade-proposal-with-escrow-quantity-locking) (propose + escrow) ·
[PD-69](https://linear.app/mstrilec/issue/PD-69/trade-state-machine-accept-decline-cancel-transitions) (transitions) ·
[PD-70](https://linear.app/mstrilec/issue/PD-70/atomic-trade-settlement-the-swap-transaction) (settlement) ·
[PD-71](https://linear.app/mstrilec/issue/PD-71/counter-offers-linked-proposal-with-lock-transfer) (counter).
It also fixes the decisions [PD-73](https://linear.app/mstrilec/issue/PD-73/admin-void-of-a-fraudulent-accepted-trade)
(void of an accepted trade) and [PD-74](https://linear.app/mstrilec/issue/PD-74/trade-expiry-job-auto-cancel-stale-pending-trades-and-release-locks)
(expiry) build on, and pulls the write side of
[PD-78](https://linear.app/mstrilec/issue/PD-78/notifications-module-and-api) (notifications) forward.
Reference: `docs/UserFlows.md` §6 · `docs/PRD.md` §14 · `docs/Architecture.md` §9 ·
`docs/DataModel.md` (Trade, TradeItem, AuditLog, Notification) ·
`apps/api/src/inventory/README.md` (PD-55's escrow contract) · the PD-58 spec
(the first transactional core, whose lock order this one must respect).

The second transactional core. Cards and coins move between two people, together
or not at all, and a card promised to one trade cannot be promised to another.
The integration suite that would prove it (PD-75) is deferred with every other
automated test in v1, so this spec carries its own verification, and its
scenarios are PD-75's.

One spec for four tickets because they are one mechanism: every way out of
`PENDING` is the same guarded status change plus the same lock release, and
accept and counter are that change with more work inside the transaction.

---

## Measured before designing

Against the local stack, 2026-09-28.

| Probe | Result |
| --- | --- |
| Trades in the seed | 6, one per status; one `PENDING` (`seed-ash` → `seed-misty`, offering 1 × `base1-4`) |
| Inventory rows with `lockedQuantity > 0` | 1 — `seed-ash` / `base1-4`, quantity 2, locked 1 |
| Lock reconciliation (below) | **0 rows** — every lock is accounted for by a `PENDING` trade's `OFFERED` items |
| Trade constraints (`20260916213023`) | no self-trade; no self-counter; both currencies ≥ 0; item quantity ≥ 1 |
| Inventory constraints (`20260916183839`) | `quantity ≥ 0`, `lockedQuantity ≥ 0`, `lockedQuantity ≤ quantity` |
| `CurrencyTransaction` unique | `(userId, type, refId)` |
| `TransactionType` | `GRANT`, `PACK_SPEND`, `TRADE` |
| Pack open's lock order | the user's row (conditional debit), then inventory rows sorted by `cardId` in one statement |
| `QUEUE.tradeExpiry` | already registered; `WorkerModule` names PD-74 as its processor's owner |
| Modules | `PrismaModule`, `RedisModule`, `AuditModule` are `@Global`; `InventoryModule` exports `InventoryService`; no notifications module exists |

---

## Decisions

Agreed with the owner in brainstorming, 2026-09-28.

1. **A `PENDING` trade locks exactly its initiator's `OFFERED` items — nothing
   else.** The recipient has agreed to nothing, so nothing of theirs is
   reserved; their `REQUESTED` items are checked at settlement. A counter is a
   new proposal by the other party: in one transaction it releases the
   original's locks and takes its own. PD-71's "at no instant are the cards
   unlocked" is met as "no committed state has them in between" — the release
   and the new lock commit together or not at all. The payoff is an invariant
   one query can check (below), which is the only leak detector a v1 without
   tests has.
2. **Notifications are written in M8.** A minimal `NotificationsService` — one
   insert per recipient after the transaction commits, a failure logged and
   swallowed. PD-78 later adds the read API, mark-as-read and the unread badge;
   it does not revisit any trade code.
3. **Admin void covers both states.** Voiding a `PENDING` trade is a close like
   any other, by an admin with a reason — in this spec. Voiding an `ACCEPTED`
   trade is a reverse settlement — PD-73, with its decisions fixed here.
4. **Coins are checked, not reserved.** Proposal checks the initiator's balance
   softly (402 if short); settlement debits conditionally, as the pack open
   does, and a party who has spent the coins since gets a clean 402 with the
   trade still `PENDING`. No hold, no new ledger type, no migration.

Fixed by the design, not asked:

5. **One guarded status change.** Every route out of `PENDING` is
   `UPDATE trades SET status = $to, "resolvedAt" = now() WHERE id = $id AND
   status = 'PENDING' RETURNING …`. Its row lock serialises all transitions of
   one trade; the loser of a race sees zero rows and gets 409
   `TRADE_NOT_PENDING`. That is the whole of "exactly one terminal state".
6. **The timeline is the audit log.** Each transition writes exactly one
   `AuditLog` row (`entity 'Trade'`, `{ from, to, … }`), inside its
   transaction. PD-72 reads those rows — no timestamp columns, no event table.
7. **A settlement deletes the inventory rows it empties** — `quantity = 0` and
   `lockedQuantity = 0` — as `docs/PRD.md` §14 says and `docs/API.md`'s
   inventory cursor already anticipates.
8. **A card may not appear on both sides of one trade**, and at most once per
   side. So a settlement moves each `(user, card)` exactly once, in one
   direction.
9. **Counter chains stop at 10 trades** — `COUNTER_LIMIT`.
10. **For PD-73:** a void of an `ACCEPTED` trade writes ledger rows of a new
    type `TRADE_REVERSAL` (the unique `(userId, TRADE, tradeId)` already holds
    the settlement's rows), and is feasible only when everyone who received
    cards still has them *available* (not locked) and everyone who received
    coins still has them.
11. **For PD-74:** the trade services live in a module with no controllers, so
    the worker can import them without Better Auth or the HTTP guards.

---

## The lock invariant

> For every `(userId, cardId)`: `inventory_items.lockedQuantity` equals the sum
> of `trade_items.quantity` over `OFFERED` items of `PENDING` trades whose
> `initiatorId` is that user.

The reconciliation query — zero rows means no leak:

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

Every route preserves it:

| Route | Status change | Locks |
| --- | --- | --- |
| propose | new `PENDING` | `+ OFFERED` of the initiator |
| decline · cancel · void (pending) · expire | `PENDING →` terminal | `− OFFERED` of the initiator |
| counter | original `→ COUNTERED`, new `PENDING` | `− OFFERED` of the original's initiator, `+ OFFERED` of the counter's |
| accept | `PENDING → ACCEPTED` | the initiator's `OFFERED` lock is consumed with the quantity it guarded |

---

## Lock order

Two transactions that take the same rows in opposite orders deadlock. The pack
open takes a user's row, then that user's inventory rows by `cardId`. Every
transaction in this spec takes rows in this order, skipping what it does not
touch:

1. the trade row (the guarded status change);
2. `users` rows, ascending `id` — only when coins move;
3. `inventory_items` rows, ascending `(userId, cardId)`, across both parties
   and across locks, releases and moves alike.

A counter touches two users' inventory rows (the original initiator's release,
the counter-initiator's lock); it issues them in `(userId, cardId)` order, not
release-then-lock.

---

## Components

| Unit | Does | Depends on |
| --- | --- | --- |
| `notifications/notifications.service.ts` | `notify(entries: NotificationEntry[])` — one `createMany`, outside any transaction; logs and swallows a failure | Prisma |
| `notifications/notifications.module.ts` | provides and exports it | — |
| `inventory/inventory.service.ts` | `lock` throws `CARDS_UNAVAILABLE`; new `applyMoves(tx, moves)` | — |
| `trades/trade-close.service.ts` | `close(tx, trade, to, actor, meta)` — guarded status change, release, audit | Inventory, Audit |
| `trades/trade-settlement.service.ts` | `settle(tx, trade)` — coins, then card moves, inside the accept transaction | Inventory |
| `trades/trades-core.module.ts` | provides and exports the two above; **no controllers** | Inventory, Notifications |
| `trades/trades.service.ts` | `propose`, `accept`, `decline`, `cancel`, `counter`, `voidPending` — each one transaction, then notifications and summary invalidation after commit | the core |
| `trades/trades.controller.ts` | `POST /trades`, `POST /trades/:id/{accept,decline,cancel,counter}` | — |
| `trades/admin-trades.controller.ts` | `POST /admin/trades/:id/void` behind `@Roles(['ADMIN'])` | — |
| `trades/trades.module.ts` | imports the core module; the controllers and `TradesService` | — |
| `common/throttle.ts` | `MODERATE_THROTTLE`, moved from `packs/pack-open.throttle.ts` | — |

### `InventoryService.applyMoves(tx, moves)`

```ts
type Move = {
  userId: string;
  cardId: string;
  quantity: number;          // positive: receive; negative: give
  fromLock?: boolean;        // giving copies this user had locked for the trade
};
```

Sorted by `(userId, cardId)`, one statement per move:

- **give from lock:** `quantity −= q, lockedQuantity −= q WHERE lockedQuantity ≥ q`. Zero rows is an escrow bug: log it and answer 409 `CARDS_UNAVAILABLE` rather than 500, so the trade fails cleanly and stays `PENDING`.
- **give from available:** `quantity −= q WHERE quantity − lockedQuantity ≥ q`. Zero rows → 409 `CARDS_UNAVAILABLE`.
- **receive:** `INSERT … ON CONFLICT ("userId","cardId") DO UPDATE SET quantity = quantity + q, "acquiredAt" = now()` — the pack open's upsert.

Then one `DELETE FROM inventory_items WHERE ("userId","cardId") IN (the givers' pairs) AND quantity = 0 AND "lockedQuantity" = 0`.

It lives in `InventoryService` because the README's rule is that quantity arithmetic has one home. It does not invalidate the summary; the caller does, after commit.

### `TradeCloseService.close(tx, trade, to, actor, meta)`

1. The guarded status change to `to`. Zero rows → re-read the status; 409
   `TRADE_NOT_PENDING` naming it.
2. `inventory.release(tx, trade.initiatorId, offeredItems)` — skipped for
   `ACCEPTED`, whose settlement consumes the lock.
3. `audit.record(tx, { actorId: actor ?? null, action: 'trade.<verb>', entity: 'Trade', entityId, meta: { from: 'PENDING', to, …meta } })`.

`close` does not check who the actor is; `TradesService` does that before
calling it.

---

## Routes

All under `/api/v1`, member-only unless marked. `:id` of a trade the caller is
not a party to is **404 `Trade not found`** — the same as an id that does not
exist, like a private deck. A party calling a route that belongs to the other
role is **403** — the trade is visible to them, so the refusal is honest.

| Route | Actor | Result |
| --- | --- | --- |
| `POST /trades` | anyone | 201, the new trade |
| `POST /trades/:id/accept` | recipient | 200, the trade `ACCEPTED` |
| `POST /trades/:id/decline` | recipient | 200, `DECLINED` |
| `POST /trades/:id/cancel` | initiator | 200, `CANCELLED` |
| `POST /trades/:id/counter` | recipient | 201, the new trade; the original `COUNTERED` |
| `POST /admin/trades/:id/void` | admin | 200, `VOIDED` — `PENDING` here; `ACCEPTED` in PD-73, until then 409 `TRADE_NOT_PENDING` |

`POST /trades` and `POST /trades/:id/counter` run under `MODERATE_THROTTLE`
(30 per minute per user by default) — PD-36's policy, named for exactly these
routes.

### Request — `ProposeTradeSchema`

```ts
{
  recipientId: UserId,                        // POST /trades only
  offered:   { cardId, quantity: 1..100 }[],  // 0..20 entries
  requested: { cardId, quantity: 1..100 }[],  // 0..20 entries
  currencyFromInitiator: 0..1_000_000,        // default 0
  currencyFromRecipient: 0..1_000_000,        // default 0
}
```

Refused with 400: an empty trade (no items and no coins on either side), a
`cardId` twice on one side or on both sides, an unknown card (named), an unknown
field. `recipientId` equal to the caller → 400; an unknown recipient → 404
`User not found`.

`POST /admin/trades/:id/void` takes `{ reason: string 1..500 }`.

### Response — `TradeSchema`

The existing contract gains `counteredTradeId: TradeId | null`. The mutation
routes return the trade row with its items; the inbox, the detail and the
timeline are PD-72's.

### Error codes

Added to `ERROR_CODES`:

| `code` | Status | Meaning |
| --- | --- | --- |
| `CARDS_UNAVAILABLE` | 409 | not enough available copies — at proposal, counter or settlement; the message names the card and whose it is |
| `TRADE_NOT_PENDING` | 409 | the trade already left `PENDING`; the message names its status |
| `COUNTER_LIMIT` | 409 | the chain already holds 10 trades |

`INSUFFICIENT_FUNDS` (402) is reused for coins, at proposal and at settlement.
A second counter racing the first may also surface as PD-63's generic 409 from
the unique `counteredTradeId`; both mean "already countered".

---

## The flows

### Propose (PD-68)

Outside the transaction: validate the body; the recipient exists; the offered
and requested cards exist; the initiator's `currency ≥ currencyFromInitiator`,
else 402.

The recipient's holdings are **not** checked: an inventory is private, and a
proposal that failed on "they do not have it" would disclose it. Settlement
checks.

Transaction: create the `Trade` with its `TradeItem`s; `inventory.lock(tx,
initiator, offered)` — not enough copies → 409 `CARDS_UNAVAILABLE`, and the
rollback takes the trade and every lock already raised with it; audit
`trade.propose`.

After commit: notify the recipient `trade.proposed`.

### Decline · cancel · void a pending trade (PD-69)

Load the trade; not a party → 404; wrong role → 403 (void: the route's
`@Roles`). Transaction: `close(tx, trade, DECLINED | CANCELLED | VOIDED, actor,
{ reason? })`. After commit: notify the counterparty — both parties for a void —
with `trade.declined | trade.cancelled | trade.voided`.

### Accept (PD-70)

Load the trade; not a party → 404; the initiator → 403.

Transaction:

1. `close(tx, trade, ACCEPTED, recipient)` — the guarded change takes the trade
   row first; a concurrent decline, cancel, counter or expiry has either
   finished (→ 409) or waits.
2. **Coins.** Net delta per user:
   `initiator = currencyFromRecipient − currencyFromInitiator`, the recipient
   the negative. If non-zero, lock both `users` rows in ascending `id`
   (`SELECT … FOR UPDATE`), debit the payer conditionally
   (`currency ≥ owed`, else 402 `INSUFFICIENT_FUNDS` naming the payer), credit
   the payee, and write one `CurrencyTransaction(TRADE, refId = tradeId)` per
   user with that user's signed delta.
3. **Cards.** `inventory.applyMoves(tx, moves)`:
   - each `OFFERED` item: the initiator gives `fromLock`, the recipient receives;
   - each `REQUESTED` item: the recipient gives from available, the initiator receives.
   A shortfall → 409 `CARDS_UNAVAILABLE` naming the card and the party.

Any failure rolls the whole transaction back: the trade is `PENDING` again, the
initiator's lock intact, no coins or cards moved.

After commit: `invalidateSummary` for both users; notify the initiator
`trade.accepted`.

### Counter (PD-71)

Load the original; not a party → 404; its initiator → 403. The chain length —
a recursive CTE over `counteredTradeId`, as `docs/DataModel.md` verified — is
checked inside the transaction; 10 already → 409 `COUNTER_LIMIT`. The body is
validated like a proposal; the counter's recipient is the original's initiator.

Transaction:

1. `close(tx, original, COUNTERED, recipient, { counterTradeId })` — but with
   the release deferred to step 3 so it can be ordered.
2. Create the counter trade, `counteredTradeId = original.id`.
3. Release the original initiator's `OFFERED` locks and lock the counter
   initiator's `OFFERED` items, in `(userId, cardId)` order.
4. Audit `trade.counter` on the new trade (the original's row is step 1's).

After commit: notify the original's initiator `trade.countered`.

`TradeCloseService.close` therefore takes an option to skip its own release;
only counter uses it.

---

## Notifications

```ts
type NotificationEntry = { userId: string; type: TradeNotificationType; payload: { tradeId: string; actorId: string | null } };
```

Types: `trade.proposed`, `trade.accepted`, `trade.declined`, `trade.cancelled`,
`trade.countered`, `trade.voided`, `trade.expired` (the last written by PD-74).
One transition writes one notification per recipient, after commit. A failure
is logged with the trade id and does not change the response — PD-78's
"a notification failure does not roll back the trade".

---

## Schema and contract changes

- **No migration in this spec.** `TRADE_REVERSAL` is PD-73's migration.
- `packages/shared`: `ProposeTradeSchema`, `CounterTradeSchema` (the same
  without `recipientId`), `VoidTradeSchema`; `TradeSchema.counteredTradeId`;
  three `ERROR_CODES`; `TRADE_NOTIFICATION_TYPES`.
- `apps/api/src/inventory/README.md`: `applyMoves` and the lock invariant join
  the contract.

---

## Verification plan

Through HTTP against the running API, the database checked after every
scenario, probe users deleted at the end — the method PD-58 and PD-63 used.
No test files. These are PD-75's scenarios.

**After every scenario, four checks:**

1. **Cards conserved** — `SELECT "cardId", SUM(quantity)` over every user is
   identical before and after, except where a scenario intentionally mints
   nothing (none here does).
2. **Coins conserved** — `SUM(currency)` over all users unchanged, and every
   user's `currency` equals the sum of their ledger rows.
3. **Locks reconcile** — the query above returns 0 rows.
4. **Nothing negative** — no `quantity`, `lockedQuantity` or `currency` below 0.

Scenarios (users A, B, C; A holds 1 × card X):

1. A offers X to B; A offers X again to C → 409 `CARDS_UNAVAILABLE`, no second trade, one lock.
2. A proposal whose second offered card A lacks → 409, no trade row, no lock on the first card.
3. B accepts with coins on both sides and cards on both sides → 200; cards and coins moved; A's emptied row deleted; two ledger rows; summaries invalidated (the cache key gone).
4. B accepts a trade requesting a card B no longer has → 409 naming it; trade `PENDING`; everything byte-identical.
5. B accepts when A has since spent the offered coins → 402; trade `PENDING`; nothing moved.
6. Ten simultaneous requests on one trade, five accepts and five declines → exactly one 200, nine 409 `TRADE_NOT_PENDING`; one terminal status; the checks hold.
7. Counter racing an accept on the same trade → one wins, the other 409.
8. A counter chain: B counters A's trade → original `COUNTERED`, A's lock gone, B's lock present in the same commit; A counters back … the 11th trade → 409 `COUNTER_LIMIT`.
9. Decline, cancel and an admin void of `PENDING` trades → locks released exactly; one audit row each with `from`/`to`; void carries the admin and the reason.
10. Wrong actor: A accepts own trade → 403; C reads or acts on A–B's trade → 404; an admin who is not a party voids → 200 only on the admin route.
11. A failure injected inside settlement — a trigger raising on the `currency_transactions` insert → 500; trades, inventory, users and ledger byte-identical to before.
12. A notification failure injected (the `notifications` table renamed for the probe) → the trade transition still 200 and committed; the error logged.
13. Throttle: 31 proposals in a minute → the 31st 429.

---

## Files

| Path | Change |
| --- | --- |
| `packages/shared/src/entities/trade.ts`, `primitives/error.ts` | contracts, codes |
| `apps/api/src/common/throttle.ts`, `packs/pack-open.throttle.ts` (removed), `packs/packs.controller.ts` | the moved throttle |
| `apps/api/src/notifications/*` | new — writer module |
| `apps/api/src/inventory/inventory.service.ts`, `README.md` | `CARDS_UNAVAILABLE`, `applyMoves`, the invariant |
| `apps/api/src/trades/*` | new — core module, service, controllers |
| `apps/api/src/app.module.ts` | `TradesModule` |
| `docs/API.md` (Trades), `docs/DataModel.md` (Trade) | contract, invariant, measured results |

---

## Out of scope

- The inbox, the detail page and the timeline read — PD-72.
- Voiding an `ACCEPTED` trade and the `TRADE_REVERSAL` migration — PD-73 (decided above).
- The expiry job and its scheduler — PD-74 (decided above: it calls `close` with `actor = null` from the worker).
- Reading notifications, the unread count, mark-as-read — PD-78.
- Reserving coins at proposal (decision 4).
- Checking the recipient's holdings at proposal (privacy; settlement checks).
