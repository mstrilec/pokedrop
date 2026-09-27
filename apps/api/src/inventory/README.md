# Inventory module

A user's cards, and the one place that decides how many of them they can use.
The read API is documented in `docs/API.md` (Inventory); this file is the
contract for the modules that will change quantities — decks (M7) and trades
(M8).

## `availableQuantity`

`availableQuantity = quantity − lockedQuantity`, defined once in `quantity.ts`.
The inventory read reports it through that function, and every consumer should
either call it or call `InventoryService.availableQuantities` — never subtract
the two columns itself. A second definition is how escrow gets circumvented from
a feature that forgot the lock.

## Locking and releasing

`lock(tx, userId, changes)` and `release(tx, userId, changes)` take the
caller's transaction client. They are meant to run inside the same transaction
as the status change that justifies them: a trade raising a lock as it is
proposed, lowering it as it leaves PENDING by any route — accept, decline,
cancel, counter, void, expire. A lock whose trade no longer exists is stranded
forever, and nothing in the schema can notice.

**`lock` refuses with a 409 and leaves the transaction usable.** It is one
conditional `UPDATE … WHERE quantity - "lockedQuantity" >= n` per card, and zero
rows updated means not enough copies are available. The caller decides what to
do; throwing out of the transaction callback rolls back every lock already
taken in it. Verified: a proposal that locked one card and was refused on the
next left no lock behind.

**Why not let the CHECK constraint refuse it.** `inventory_locked_within_quantity`
does refuse an over-lock — verified: a direct `UPDATE` past `quantity` fails
with `23514`. But a constraint violation aborts the whole PostgreSQL
transaction, so the caller cannot recover inside it, and `prisma-error.ts` does
not map it, so the user sees a 500. The constraint is the backstop for every
other code path; the conditional update is the path.

**`release` of more than is locked throws a plain `Error`** — a 500 with a log
line. It means a lock and a release disagree, which is a bug, not a user error.

**Changes are sorted by `cardId` before any row is touched.** Two proposals
locking the same two cards in opposite order would otherwise take row locks in
opposite order and deadlock. Verified: two concurrent transactions locking
`[A, B]` and `[B, A]` over a single copy of `B` finished with one success and
one 409, and no deadlock.

**Quantities must be positive integers and a card may appear once per call.**
Anything else throws before a row is touched. Aggregate duplicates before
calling.

**Concurrency.** Verified: two transactions each locking 2 of the last 3
copies of one card — exactly one succeeded, the other got a 409, and
`lockedQuantity` ended at 2. The conditional update is atomic per row; no
`SELECT … FOR UPDATE` is needed.

## Reading availability

`availableQuantities(userId, cardIds, client?)` returns a `Map` from card id to
available copies. A card the user does not own is absent from the map, not
present as `0`. Pass the transaction client when the answer must be consistent
with writes in the same transaction; strict-mode deck validation (PD-64) can use
the default client.

## Not exported yet

`InventoryModule` does not export `InventoryService`. The first module that
needs it — decks or trades — adds the export along with the import, the way
PD-51 left `PricesService` unexported until something crossed that boundary.
