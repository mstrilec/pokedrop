# PD-57 — The weighted rarity generator

Design, 2026-09-27. Milestone M6 · Pack Opening.

Ticket: [PD-57](https://linear.app/mstrilec/issue/PD-57/weighted-rarity-generator-using-crypto-grade-randomness) ·
Reference: `docs/UserFlows.md` §5 (server algorithm, fairness & integrity) ·
`docs/PRD.md` §13 · `docs/API.md` (Packs, from PD-56) · consumer:
[PD-58](https://linear.app/mstrilec/issue/PD-58/transactional-pack-open-debit-currency-record-opening-mint-inventory).

Which cards a pack contains. A generator that is subtly wrong is invisible in a
handful of packs and obvious over a thousand, and the ticket that would catch it
(PD-61, statistical tests) is deferred with every other automated test in v1.
This spec therefore carries its own statistical verification.

---

## Measured before designing

Against the local database, 2026-09-27.

| Probe | Result |
| --- | --- |
| distinct `cards.rarity` values | **45**, plus **303** cards with no rarity |
| seed template pool (`base1` + `base2`) | Common 48, Uncommon 48, Rare 32, Rare Holo 32, 6 without rarity |
| largest possible pool (50 biggest sets, `SetFilter`'s maximum) | 10 646 cards over 30 rarities, `SELECT … ORDER BY rarity, id` in **23.5 ms** |
| `pack_openings` / `pack_opening_cards` | 1 / 4 (seed data) |
| `crypto.randomInt` seedable | no |
| rarity ordering in the backend | none — `RarityTier` mapping belongs to the frontend (M12) |
| `weights` key order after a save | `jsonb`'s own order, not the admin's (PD-56) |

Three of these shape the design.

- **`crypto.randomInt` cannot be seeded**, yet the ticket asks that a fixed
  seed reproduce a pack. The randomness has to come from a deterministic,
  cryptographically strong stream keyed by a random seed.
- **There is no rarity order to "step down" along.** 45 free-form rarity
  strings, and a mapping onto tiers is a presentation concern owned by M12.
- **Key order in `weights` is not the admin's.** Nothing may depend on it:
  not the cumulative walk, not the fallback.

---

## Decisions

Taken during brainstorming, 2026-09-27:

| Question | Decision |
| --- | --- |
| Meaning of "next-lower rarity" | **The more common rarity within the same slot**, by weight |
| Where the seed lives | **A `seed` column on `PackOpening`**, written by PD-58 |
| Duplicate cards within one pack | **Allowed** — every card is an independent draw |
| Random stream | **HMAC-SHA256 in counter mode** over a 32-byte random seed |

Rejected, with reasons:

- **A global rarity ladder in the backend** — a second source of truth beside
  M12's `RarityTier`, and every new set's new rarity would need a place on it.
- **Renormalising the weights over non-empty buckets** — not what the docs
  describe, and it raises the odds of every other rarity in the slot, the best
  ones included.
- **Drawing without replacement** — needs a second fallback path for a bucket
  exhausted mid-pack and bends the realised odds away from the configured
  weights. With independent draws, four Commons from the seed template's 48
  contain a pair in about 12% of packs; PD-58 aggregates them.
- **ChaCha20 as the stream** — equally sound, but the `createCipheriv` API with
  a 16-byte IV carrying the counter is less obvious and buys nothing for at most
  40 draws a pack.
- **`crypto.randomInt` in production and a seeded RNG only for verification** —
  a stored seed would then reproduce nothing.
- **Logging the seed instead of storing it** — logs rotate; a dispute about an
  old pack would find nothing.

---

## Units

Three files in `apps/api/src/packs/`, each with one job.

### `pack-rng.ts` — the random stream

```ts
export const SEED_BYTES = 32;
export function newSeed(): Buffer;            // crypto.randomBytes(32)

export interface Rng {
  int(max: number): number;                   // uniform in [0, max)
}

export class SeededRng implements Rng {
  constructor(seed: Buffer);                  // exactly 32 bytes, else throws
  nextUint32(): number;
  int(max: number): number;
}
```

- **Stream.** Block `i` is `HMAC-SHA256(key = seed, message = i as an 8-byte
  big-endian integer)`, `i` starting at 0. Each 32-byte block yields eight
  big-endian `uint32`s, consumed in order.
- **`int(max)`** accepts integers `1 ≤ max ≤ 2³²` and throws otherwise. It
  draws by rejection: `limit = 2³² − (2³² mod max)`; draw `x = nextUint32()`
  until `x < limit`; return `x mod max`. No modulo bias — the same technique
  `crypto.randomInt` uses.
- The largest `max` the generator passes is a slot's weight total: at most 45
  rarities × 1 000 000 (PD-56's cap) = 4.5 × 10⁷, well under 2³².

### `pack-generator.ts` — the pure function

```ts
export type CardPool = ReadonlyMap<string, readonly string[]>; // rarity → card ids, sorted
export type PulledCard = { cardId: string; rarity: string };
export type Fallback = { slot: number; rolled: string; used: string };
export type GeneratedPack = { cards: PulledCard[]; fallbacks: Fallback[] };

export class EmptySlotError extends Error {}   // carries the slot index

export function generatePack(slotConfig: SlotConfig, pool: CardPool, rng: Rng): GeneratedPack;
```

It imports nothing from Prisma, Nest or Redis. Given the same `slotConfig`, the
same pool and a `SeededRng` on the same seed, it returns the same pack.

For every slot, in order, `count` times:

1. **The slot's ladder.** Rarities with a weight above zero, sorted by weight
   descending, ties by rarity name ascending (code-unit order). Index 0 is the
   most common. This order is computed, never read from the object — it is what
   makes a pack independent of `jsonb`'s key order.
2. **Roll a rarity** — one draw: `r = rng.int(sum of weights)`, then the first
   ladder entry whose cumulative weight exceeds `r`.
3. **If that rarity's bucket is empty, fall back.** Walk **down** the ladder
   towards index 0 — more common rarities — and take the first non-empty bucket.
   If every more common bucket is empty too, walk **up** from the rolled rarity
   and take the nearest non-empty one: a rarer card is handed out only when no
   commoner card exists. Record `{ slot, rolled, used }` in `fallbacks`.
4. **If every bucket in the slot is empty**, throw `EmptySlotError`. PD-58 turns
   it into a 409 and charges nothing — the ticket's "cannot 500".
5. **Pick a card** — the second draw: `bucket[rng.int(bucket.length)]`.
6. **Emit `{ cardId, rarity }`**, where `rarity` is the bucket the card came
   from, not the rolled one. That is what `PackOpeningCard.rarity` stores.

Exactly two draws per card, whatever happens in steps 3–4. Duplicates are
allowed.

PD-56 already refuses a template naming a rarity absent from its pool, so a
fallback happens only when the catalog changes after a template was saved. It
is a signal that the template needs attention, which is why it is returned
rather than swallowed.

### `pack-pool.ts` — loading a pool

```ts
export async function loadPool(client: TransactionClient, setFilter: SetFilter): Promise<CardPool>;
```

One query:

```sql
SELECT id, rarity FROM cards
WHERE "setId" IN (…) AND rarity IS NOT NULL
ORDER BY rarity, id
```

grouped into the `Map`. Cards without a rarity cannot be pulled — there is no
slot that could name them. The `ORDER BY id` inside each bucket is load-bearing:
reproduction indexes into the bucket, so its order must not depend on how the
database happened to return rows.

**Not cached.** The largest pool a template can name reads in 23.5 ms. A cache
would need invalidating on every catalog sync; it earns its place only if the
measurement below misses its budget.

---

## The seed column

```prisma
model PackOpening {
  …
  /// Hex of the 32-byte seed the pack was drawn from. Null only for openings
  /// that predate PD-57.
  seed String?
}
```

A migration adds the nullable column; the existing seed opening keeps `null`.
PD-58 writes `seed.toString('hex')` in the same transaction as the opening. The
generator itself never writes — the third acceptance criterion.

**Reproducing an opening** takes its template's `slotConfig` and `setFilter`,
the pool loaded now, and its seed. It reproduces the original pack exactly
**while the pool is unchanged**. A catalog sync that adds or reclassifies a card
in those sets changes the pool, and with it the result; the pulled cards in
`PackOpeningCard` remain the record of what was actually given. No endpoint for
this is built now — a script is enough until a dispute process exists.

The seed is never sent to a client. Knowing a seed after the fact reveals
nothing useful, but there is no reason to expose it either.

---

## How PD-58 uses it

```ts
const seed = newSeed();
const pool = await loadPool(tx, template.setFilter);
const pack = generatePack(template.slotConfig, pool, new SeededRng(seed));
// pack.fallbacks.length > 0 → log a warning naming the template
// EmptySlotError → 409, nothing charged
// write PackOpening { seed: seed.toString('hex'), … } and pack.cards
```

Whether generation runs inside or before the transaction is PD-58's decision.

---

## Verification plan

No automated tests in v1. A one-off probe in the session scratchpad, not
committed, with fixed seeds so its outcome is deterministic and cannot flake.
Its numbers go into the documentation.

### Statistics — PD-61's job, done by hand

χ² goodness of fit at **α = 0.001**. The critical value comes from the
Wilson–Hilferty approximation, `k · (1 − 2/(9k) + z·√(2/(9k)))³` with
`z = 3.0902`, so no statistics library is needed.

1. **Rarity distribution.** 100 000 packs of a synthetic template — a
   `{ count: 4, Common }` slot, a `{ count: 1, weights 72/20/5/2/1 }` slot and a
   `{ count: 2, weights 3/1 }` slot — over a synthetic pool. For each weighted
   slot, observed rarity counts against the weights: must pass.
2. **Sensitivity.** The same observations against weights with one entry
   corrupted by 10% (`72 → 79.2`, the rest scaled to keep the total): must
   fail. This is PD-61's first acceptance criterion, and it shows check 1 can
   fail at all.
3. **Uniformity within a bucket.** Card counts inside one bucket against
   uniform: must pass.
4. **The stream itself.** `int(3 · 2³⁰)` over 1 000 000 draws, binned into 64
   bins, against uniform — this `max` rejects about 25% of raw draws, so the
   rejection path is exercised: must pass. Bounds: `int(1)` is always 0;
   `int(2³²)` works; `int(0)`, `int(2³² + 1)`, `int(1.5)` throw; a seed of any
   length other than 32 bytes throws.

### Behaviour

5. **Reproducibility.** Two `SeededRng`s on one seed produce identical packs;
   two different seeds produce different packs.
6. **Independence from key order.** The same slot with its `weights` keys
   inserted in reverse order produces the identical pack from the same seed.
7. **Fallback.** Empty rolled bucket → the next more common non-empty one;
   everything more common empty → the nearest rarer one; the whole slot empty →
   `EmptySlotError`. Each fallback appears in `fallbacks`, and every emitted
   `rarity` is the bucket its card came from.
8. **No database writes.** The generator module imports nothing from Prisma,
   and the probe runs it with no database connection at all.

### Pool and performance

9. **`loadPool` on the seed template** yields buckets 48 / 48 / 32 / 32 and no
   card without a rarity; every bucket is sorted by id.
10. **The largest pool** (50 biggest sets): `loadPool` plus one
    `generatePack`, median of five, **≤ 50 ms**. If it misses, the cache
    question is reopened before anything else changes.
11. **Migration** applies cleanly with `prisma migrate dev`; the existing
    opening has `seed = null`.
12. `typecheck`, `lint` and `format:check` pass.

---

## Files

| File | Change |
| --- | --- |
| `apps/api/src/packs/pack-rng.ts` | new — `newSeed`, `Rng`, `SeededRng` |
| `apps/api/src/packs/pack-generator.ts` | new — `generatePack`, `EmptySlotError`, types |
| `apps/api/src/packs/pack-pool.ts` | new — `loadPool` |
| `apps/api/prisma/schema.prisma` | `PackOpening.seed String?` |
| `apps/api/prisma/migrations/…_pack_opening_seed/` | new migration |
| `docs/API.md` (Packs) | the algorithm, the fallback ladder, the seed and its limits, the probe's numbers |
| `docs/UserFlows.md` §5 | "next-lower rarity" made precise |
| `docs/DataModel.md` (PackOpening) | the `seed` column |

---

## Out of scope

- **Opening a pack** — the transaction, the debit, writing `seed` and the
  cards, mapping `EmptySlotError` to 409, logging fallbacks: PD-58.
- **Idempotency**: PD-59.
- **A replay or dispute endpoint** — the seed is stored; a script reproduces.
- **Caching the pool**, unless check 10 misses its budget.
- **`RarityTier`** — still the frontend's, M12.
- **The statistical test suite** — PD-61, deferred; this spec's probe is its
  stand-in until testing resumes, and its checks are the natural first cases.
