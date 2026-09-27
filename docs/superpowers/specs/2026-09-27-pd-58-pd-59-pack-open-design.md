# PD-58 + PD-59 — Opening a pack, once

Design, 2026-09-27. Milestone M6 · Pack Opening.

Tickets:
[PD-58](https://linear.app/mstrilec/issue/PD-58/transactional-pack-open-debit-currency-record-opening-mint-inventory) (the transaction) ·
[PD-59](https://linear.app/mstrilec/issue/PD-59/pack-open-idempotency-via-openid-unique-constraint-and-redis-lock) (idempotency) ·
the open route from [PD-60](https://linear.app/mstrilec/issue/PD-60/packs-api-templates-open-and-history-endpoints).
Reference: `docs/UserFlows.md` §5 · `docs/Architecture.md` §8–9 · `docs/API.md`
(Packs, including "How a pack is drawn" from PD-57) · PD-54's invalidation
contract · PD-36's throttle note on PD-60.

The first of the two transactional cores in Architecture §9: money leaves a
balance and cards enter a collection, together or not at all, exactly once per
`openId`. The integration tests that would prove it (PD-62) are deferred with
every other automated test in v1, so this spec carries its own verification.

One spec for two tickets because they are one code path: the idempotency guard
is the transaction's first write, and a replay returns what the transaction
recorded.

---

## Measured before designing

Against the local stack, 2026-09-27.

| Probe | Result |
| --- | --- |
| `users` with `currency < 0` | 0 of 8 |
| users whose `currency` ≠ the sum of their `currency_transactions` | 0 of 8 |
| CHECK on `users.currency` | none |
| `ErrorEnvelope` machine-readable code | none — `statusCode`, `error`, `message`, `requestId` |
| `PackOpeningCard` order | no column; rows carry only `cardId` and `rarity` |
| shared `PackOpeningCardSchema.rarity` | nullable, though the column is `NOT NULL` |
| Better Auth sessions in Redis | no — Redis only backs the resend throttle |
| unique guards already in the schema | `PackOpening.openId`; `CurrencyTransaction (userId, type, refId)` |

Two facts shape everything below.

- **The database already serialises duplicates.** A second transaction inserting
  the same `openId` blocks on the unique index until the first ends, then fails
  and rolls back entirely — its debit included. Redis is therefore an
  optimisation, never the correctness boundary, which is what PD-59 says.
- **The debit is a per-user mutex.** A conditional `UPDATE` on the user's row
  holds that row until commit, so two openings by one user serialise there and
  their inventory writes cannot interleave into a deadlock. Different users share
  no inventory rows.

---

## Decisions

Taken during brainstorming, 2026-09-27:

| Question | Decision |
| --- | --- |
| How "insufficient funds" is distinguishable | **An optional `code` in the error envelope** |
| A duplicate arriving while the first is in flight | **Wait and return the same result** |
| `acquiredAt` when a pulled card is already owned | **Set to `now()`** |
| Transaction shape | **Generate outside; a short transaction whose first write claims the `openId`** |

Rejected, with reasons:

- **HTTP 402 alone** — the next domain error sharing a status (two different
  409s in trading) could only be told apart by parsing `message`.
- **A distinct string in `error`** — one field would be both prose for people and
  a key for code; rewording it would break clients.
- **409 `OPEN_IN_PROGRESS` for an in-flight duplicate** — pushes a retry loop onto
  every client, and nine of the ticket's ten simultaneous requests would fail.
- **Keeping the first `acquiredAt`** — the default inventory sort (PD-53,
  `acquired_desc`) would hide a pack's duplicates below older cards right after
  opening it. The first acquisition stays recoverable from opening history.
- **Debit first, claim second** — equally correct, but a duplicate then waits on
  the user's row before meeting the unique index, holding locks longer for
  nothing.
- **SERIALIZABLE isolation** — the conditional update and the unique index
  already hold at READ COMMITTED; serialisation failures would add retries and a
  new class of error.

---

## `POST /packs/:templateId/open`

Member route in `PacksController`. Body `{ openId }` — a UUID the client
generates once per intended opening (`OpenPackRequestSchema`, already in the
shared package). `@HttpCode(200)`, and throttled per PD-36's note on PD-60:

```ts
@Throttle({ default: { limit: config.throttle.moderateLimit, ttl: config.throttle.moderateWindowMs } })
```

— overriding `default` rather than registering a `moderate` throttler, which
would silently limit the health probes. The throttle bounds how fast someone can
try; it is not the idempotency mechanism.

### Response — `PackOpenResultSchema`

```json
{
  "openingId": "clx…",
  "openId": "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
  "templateId": "seed-template-base",
  "createdAt": "2026-09-27T19:02:11.412Z",
  "balance": 700,
  "cards": [
    {
      "position": 0,
      "cardId": "base1-68",
      "rarity": "Common",
      "card": { "id": "base1-68", "setId": "base1", "name": "Voltorb", "…": "InventoryCard" }
    }
  ]
}
```

- `cards` is in pull order, `position` 0…n−1 — the reveal animation's order.
- `card` is PD-53's slim `InventoryCardSchema`: image, name, rarity, price.
- `balance` is the user's balance when the response is built: after the debit
  for a new opening, the current balance for a replay.
- **200 for a new opening and for a replay alike.** An idempotent POST answers
  the same body; a client has no use for telling the two apart.
- **The seed is never in a response.** `PackOpening` rows are mapped, never
  returned raw.

### Errors

| Case | Status | `code` |
| --- | --- | --- |
| no session | 401 | — |
| `openId` not a UUID | 400 | — |
| template missing **or inactive** | 404 | — |
| balance below `cost` | 402 | `INSUFFICIENT_FUNDS` |
| a slot with no cards at all (`EmptySlotError`) | 409 | `PACK_UNAVAILABLE` |
| `openId` already used by another user, or by this user for another template | 409 | `OPEN_ID_CONFLICT` |
| over the moderate throttle | 429 | — |

An inactive template answers 404, not 403: a member cannot see inactive
templates (PD-56), so the route does not confirm they exist. That closes PD-56's
third acceptance criterion — members cannot open inactive templates.

---

## The error envelope gains `code`

```ts
export const ErrorEnvelopeSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.string(),
  code: z.string().optional(),
  requestId: z.string(),
});
```

`buildErrorEnvelope` copies `code` from an `HttpException`'s response body when it
is a string, and omits the key otherwise — every existing error is byte-for-byte
unchanged. A small helper builds domain errors:

```ts
domainError(HttpStatus.PAYMENT_REQUIRED, 'INSUFFICIENT_FUNDS', 'Not enough coins to open this pack')
```

Codes are `SCREAMING_SNAKE`, stable, and documented in `docs/API.md`'s
conventions; `message` stays free to change.

---

## The flow

`apps/api/src/packs/pack-opening.service.ts`, `open(userId, templateId, openId)`.

### 1. The fast replay

`packOpening.findUnique({ where: { openId } })` before anything else. Found → the
replay rules below. A replay an hour later touches no generator and no lock.

### 2. The lock — an optimisation

Through `RedisService.client` directly, never `CacheService` (which turns a Redis
failure into a miss, correct for a cache and wrong for a lock):

```
SET lock:open:{openId} <token> NX PX 10000        token = randomUUID()
```

- **Acquired** → steps 3–6, then release in `finally` with a compare-and-delete
  script — `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end` —
  so an expired lock taken over by someone else is never deleted.
- **Not acquired** → a duplicate is in flight. Poll `findUnique({ openId })` every
  100 ms for up to 10 s:
  - the opening appears → the replay rules;
  - the lock disappears and no opening exists (the first attempt failed — say,
    insufficient funds) → run steps 3–6 without the lock;
  - 10 s pass → run steps 3–6 without the lock.
- **Redis unavailable** → log a warning and run steps 3–6 without the lock.
  Concurrent duplicates are then serialised by the unique index and the losers
  reach the replay rules through step 4's unique violation — the path that makes
  "correct with Redis down" true.

### 3. Template and generation — outside the transaction

- `packTemplate.findUnique`; missing or `active: false` → 404. Parsed through
  `PackTemplateSchema` (as PD-56's `toTemplate` does) — PD-57 requires the
  generator to receive a Zod-parsed `slotConfig`.
- `seed = newSeed()`; `pool = loadPool(prisma, template.setFilter)`;
  `pack = generatePack(template.slotConfig, pool, new SeededRng(seed))`.
- `EmptySlotError` → `logger.error` naming the template and slot, then 409
  `PACK_UNAVAILABLE`. Nothing has been written.
- `pack.fallbacks` non-empty → `logger.warn` naming the template and each
  `{ slot, rolled, used }`: the template has drifted from the catalog.

### 4. The transaction

`prisma.withTransaction`, READ COMMITTED:

| # | Write | Why it is here |
| --- | --- | --- |
| a | `INSERT pack_openings { userId, templateId, openId, seed: hex }` | the claim — a duplicate blocks on the unique index here, before touching the balance |
| b | `UPDATE users SET currency = currency − $cost WHERE id = $user AND currency >= $cost RETURNING currency` | the debit and the per-user mutex; no row → 402 `INSUFFICIENT_FUNDS`, and the claim rolls back with it |
| c | `INSERT currency_transactions { amount: −cost, type: PACK_SPEND, refId: openId }` | the ledger; written even for a free template (`amount 0`) so the ledger is complete |
| d | `INSERT pack_opening_cards` (`createMany`) with `position` 0…n−1 | the record of what was given, in reveal order |
| e | one `INSERT … ON CONFLICT ("userId","cardId") DO UPDATE SET quantity = inventory_items.quantity + EXCLUDED.quantity, "acquiredAt" = now()` | the mint — duplicates summed per card first, rows sorted by `cardId`, new ids from `randomUUID()` because `@default(cuid())` is filled by Prisma, not by the database |

**A unique violation anywhere in the transaction** (`isUniqueViolation`, which
already understands the driver adapter's `P2010`) means a concurrent duplicate
committed first: the transaction has rolled back; read the opening by `openId`
and apply the replay rules.

Any other error propagates as it is — a 500 — with nothing written.

### 5. After commit

`inventoryService.invalidateSummary(userId)` — PD-54's contract: after commit,
never inside the transaction, or a concurrent read could re-cache the pre-commit
state. `InventoryModule` starts exporting `InventoryService`; this is its first
consumer outside the module. Then the lock is released (step 2's `finally`).

### 6. The response

Built from the pack and the `RETURNING currency` of step 4b; the cards' slim data
from one `card.findMany({ where: { id: { in } } })`.

### Replay rules

Applied wherever an existing opening is found — fast path, waiting, or unique
violation:

| Found opening | Answer |
| --- | --- |
| same user, same template | **200**, the original body: `PackOpeningCard` rows by `position`, slim card data, the current balance |
| another user | **409 `OPEN_ID_CONFLICT`**, no detail — another user's cards must not leak |
| same user, another template | **409 `OPEN_ID_CONFLICT`** — the client reused an `openId` for a different pack |

---

## Schema changes

Two migrations.

**`users_currency_non_negative`** — hand-written, like PD-24's inventory checks:

```sql
ALTER TABLE "users" ADD CONSTRAINT users_currency_non_negative CHECK ("currency" >= 0);
```

The backstop behind step 4b's conditional update, for every other code path that
will ever touch a balance (trades, admin grants). Safe today: no user is below
zero.

**`pack_opening_cards.position`**:

```prisma
model PackOpeningCard {
  …
  /// Pull order, 0-based. A replay must reveal the cards in the order they
  /// were first revealed.
  position Int
}
```

Added with `DEFAULT 0`, the four existing seed rows numbered by their `id` order
within their opening, then the default dropped, so every future row must state
its position.

Shared contracts: `PackOpeningCardSchema` gains `position` and a non-nullable
`rarity`; `PackOpenResultSchema` is new.

---

## Verification plan

No automated tests in v1. A one-off probe against the running API and the
database — the stand-in for PD-62 — not committed; its results go into
`docs/API.md`. Two probe users, one signed in per scenario, balances set by SQL
through the ledger (a `GRANT` row plus the matching `currency`) so the invariant
holds throughout.

1. **One opening.** Balance falls by `cost`; one `PACK_SPEND` row with
   `refId = openId`; one opening with a 64-hex `seed`; `cardCount` rows with
   positions 0…n−1; inventory quantities rise by exactly the pulled counts,
   duplicates summed; `acquiredAt` moved to now on a card already owned;
   `cache:inv:summary:{userId}` deleted; no `seed` anywhere in the body.
2. **Replay.** The same request again: the same body except `balance`; no new
   rows; balance unchanged. Repeated after the lock's 10 s have passed — PD-59's
   "an hour later" without waiting an hour.
3. **Ten simultaneous requests, one `openId`.** Ten 200s with identical `cards`;
   one opening, one ledger row, one debit.
4. **N simultaneous openings, distinct `openId`s, a balance for k of them.**
   Exactly k 200s and N − k 402 `INSUFFICIENT_FUNDS`; balance ≥ 0.
5. **Failure mid-transaction.** A temporary trigger raising on insert into
   `pack_opening_cards` for the probe user: the open answers 500 and balance,
   ledger, openings and inventory are all unchanged. The trigger is dropped.
6. **Redis down.** `docker compose stop redis`, then scenario 3 again: one
   opening, one debit. `docker compose start redis` afterwards.
7. **Conflicts.** The first user's `openId` sent by the second user → 409
   `OPEN_ID_CONFLICT` with no cards in the body; the same user's `openId` against
   another template → 409 `OPEN_ID_CONFLICT`.
8. **Refusals.** An inactive template and an unknown one → 404; `openId: "x"` →
   400; nothing written by any of them.
9. **`PACK_UNAVAILABLE`.** A template inserted by SQL, bypassing PD-56's pool
   check, whose only slot names a rarity absent from its set → 409
   `PACK_UNAVAILABLE`; nothing charged. Deleted afterwards.
10. **The ledger invariant.** For every user in the database, after every
    scenario: `currency` = the sum of their `currency_transactions`.
11. `typecheck`, `lint` and `format:check` pass.

Everything the probe creates — users, templates, openings, trigger — is removed
afterwards.

---

## Files

| File | Change |
| --- | --- |
| `packages/shared/src/primitives/error.ts` | optional `code` |
| `packages/shared/src/entities/pack.ts` | `PackOpeningCardSchema` (`position`, non-null `rarity`), `PackOpenResultSchema` |
| `apps/api/src/common/errors/error-envelope.ts` | copy `code` from an `HttpException` body |
| `apps/api/src/common/errors/domain-error.ts` | new — `domainError(status, code, message)` |
| `apps/api/src/packs/pack-opening.service.ts` | new — the flow |
| `apps/api/src/packs/pack-open.lock.ts` | new — acquire, compare-and-delete release, wait-for-opening |
| `apps/api/src/packs/packs.controller.ts` | `POST :templateId/open` |
| `apps/api/src/packs/packs.dto.ts` | `OpenPackRequestDto` |
| `apps/api/src/packs/packs.module.ts` | imports `InventoryModule` |
| `apps/api/src/inventory/inventory.module.ts` | exports `InventoryService` |
| `apps/api/prisma/schema.prisma` | `PackOpeningCard.position` |
| `apps/api/prisma/migrations/…` | the CHECK; `position` with backfill |
| `docs/API.md` | conventions (`code`), the open route, replay rules, the lock, the measurements; the PD-57 section's future-tense fixes |
| `docs/DataModel.md` | the CHECK, `position` |

---

## Out of scope

- **`GET /packs/history`** and the confirm dialog's guarantee text: PD-60.
- **Automated tests**: PD-62, deferred; this spec's probe is its stand-in and its
  scenarios are the natural first cases.
- **A replay or dispute endpoint** for a seed: PD-57 settled that a script is
  enough for now.
- **Metrics for fallbacks and `PACK_UNAVAILABLE`**: logged now; counted when the
  admin metrics endpoint lands (PD-82).
