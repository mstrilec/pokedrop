# PD-57 Weighted Rarity Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure, seedable, crypto-grade generator that turns a pack template's `slotConfig` and a card pool into the cards a pack contains, plus the pool loader and the `PackOpening.seed` column PD-58 will write.

**Architecture:** Three files in `apps/api/src/packs/`. `pack-rng.ts` is an HMAC-SHA256 counter-mode stream over a 32-byte seed with rejection sampling. `pack-generator.ts` is a pure function — no Prisma, no Nest — that rolls a rarity per card along a weight-ordered ladder, steps down (then up) past empty buckets, and picks a card uniformly. `pack-pool.ts` loads `rarity → sorted card ids` in one query.

**Tech Stack:** NestJS (ESM, `module: nodenext` — relative imports end in `.js`), `node:crypto`, Prisma 7.10.0, Zod 4 via `@pokedrop/shared`, PostgreSQL.

**Spec:** [`docs/superpowers/specs/2026-09-27-pd-57-rarity-generator-design.md`](../specs/2026-09-27-pd-57-rarity-generator-design.md)

## Global Constraints

- **Work directly on `dev`.** No branches, no pull requests.
- **Commit subjects are `[PD-57]: short lowercase description`**, 72 characters maximum (commitlint enforces it). Bodies end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **No automated tests in v1.** This overrides the TDD structure. Verification is by throwaway probe scripts; do not add test files, runners, dependencies or a CI step.
- **Minimal comments.** Only where a tidy-up would silently break something. Rationale lives in the spec and `docs/`.
- **`noUncheckedIndexedAccess` is on** (`tsconfig.base.json`): an indexed read is `T | undefined`. Handle it explicitly; do not use `!`.
- **ESM.** Relative imports carry `.js`.
- **The generator imports nothing from Prisma, Nest or Redis.** Only `@pokedrop/shared` types and `./pack-rng.js` types.
- **Never read order from a `weights` object.** The ladder is computed: weight descending, then rarity name ascending by code unit.
- **Two RNG draws per emitted card**, always: one for the rarity, one for the card.
- **Every commit compiles.** `pnpm typecheck`, `pnpm lint` and `pnpm format:check` pass from the repo root before each commit.
- **Probe files are never committed.** Scripts in the session scratchpad; the one probe that needs `@prisma/client` lives at `apps/api/probe-pd57.mjs` and is deleted at the end of Task 4.
- **Verified claims only.** If a measurement contradicts the spec, report it rather than adjusting the claim.

## Review Focus

Five inputs the spec implies but does not spell out, each pinned by a check in the owning task.

1. **A slot whose rolled rarity is the most common one and is empty** — nothing lies below it on the ladder. Expected: the walk goes up to the nearest non-empty rarer bucket, not straight to `EmptySlotError`. *Task 2, Step 3, case "most common empty".*
2. **A rarity present in `weights` with weight 0** — it must never be rolled and never serve as a fallback. Expected: excluded from the ladder entirely. *Task 2, Step 3, case "zero weight".*
3. **Ties in weight** — `{ "B": 5, "A": 5 }`. Expected: `A` before `B` on the ladder, whatever order the keys arrived in. *Task 2, Step 3, case "tie and key order".*
4. **A pool bucket present but empty** (`pool.get(r)` is `[]`, not `undefined`) — a catalog change could produce either. Expected: treated exactly like a missing bucket. *Task 2, Step 3, case "empty array bucket".*
5. **Rejection sampling actually rejecting** — a `max` just above 2³¹ rejects about half the raw draws; a bug in `limit` shows up as bias or an infinite loop. Expected: uniform, terminates. *Task 1, Step 3, the `3·2³⁰` and `2³¹ + 1` checks.*

### Shared shell setup

```bash
cd /m/projects/pokedrop
S="C:/Users/MaxSt/AppData/Local/Temp/claude/M--projects-pokedrop/11b1d497-e5dc-4deb-aa9d-c335df3810f9/scratchpad"
DIST="file:///M:/projects/pokedrop/apps/api/dist/packs"
PSQL="docker compose exec -T postgres psql -U pokedrop -d pokedrop -At"
```

Rebuild before any probe that imports `dist`: `pnpm --filter @pokedrop/api build`.

### Live values these steps assert against

Measured 2026-09-27; re-measure rather than edit an expectation.

- seed template `seed-template-base`: `setFilter { setIds: [base1, base2] }`; pool buckets Common 48, Uncommon 48, Rare 32, Rare Holo 32; 6 cards without rarity
- 50 largest sets: 10 646 cards with a rarity over 30 rarities; the pool query takes ~23.5 ms
- `pack_openings`: 1 row (`seed` data), which will have `seed = null`

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/api/src/packs/pack-rng.ts` | **new** — `SEED_BYTES`, `newSeed`, `Rng`, `SeededRng` |
| `apps/api/src/packs/pack-generator.ts` | **new** — `generatePack`, `EmptySlotError`, `CardPool`, `PulledCard`, `Fallback`, `GeneratedPack` |
| `apps/api/src/packs/pack-pool.ts` | **new** — `loadPool` |
| `apps/api/prisma/schema.prisma` | **edit** — `PackOpening.seed String?` |
| `apps/api/prisma/migrations/<ts>_pack_opening_seed/migration.sql` | **new** — generated |
| `docs/API.md`, `docs/UserFlows.md`, `docs/DataModel.md` | **edit** — Task 5 |

### Task order

1 → 2 → 3 → 4 → 5. Task 2 consumes Task 1's `Rng`; Task 3 consumes Task 2's `CardPool`; Task 4 measures all three; Task 5 documents Task 4's numbers.

---

## Task 1: The seeded stream

**Files:**
- Create: `apps/api/src/packs/pack-rng.ts`

**Interfaces:**
- Produces: `SEED_BYTES = 32`; `newSeed(): Buffer`; `interface Rng { int(max: number): number }`; `class SeededRng implements Rng { constructor(seed: Buffer); nextUint32(): number; int(max: number): number }`.

- [ ] **Step 1: Write the stream**

Create `apps/api/src/packs/pack-rng.ts`:

```ts
import { createHmac, randomBytes } from 'node:crypto';

export const SEED_BYTES = 32;

const TWO_POW_32 = 2 ** 32;

export function newSeed(): Buffer {
  return randomBytes(SEED_BYTES);
}

export interface Rng {
  int(max: number): number;
}

/**
 * HMAC-SHA256(seed, counter) in counter mode: deterministic for a seed, and as
 * unpredictable as the seed is. The block layout is part of what a stored seed
 * reproduces - changing it silently changes every past pack's replay.
 */
export class SeededRng implements Rng {
  private readonly seed: Buffer;
  private counter = 0n;
  private block = Buffer.alloc(0);
  private offset = 0;

  constructor(seed: Buffer) {
    if (seed.length !== SEED_BYTES) {
      throw new RangeError(`A seed is ${SEED_BYTES} bytes, got ${seed.length}`);
    }
    this.seed = Buffer.from(seed);
  }

  nextUint32(): number {
    if (this.offset === this.block.length) {
      const message = Buffer.alloc(8);
      message.writeBigUInt64BE(this.counter);
      this.counter += 1n;
      this.block = createHmac('sha256', this.seed).update(message).digest();
      this.offset = 0;
    }

    const value = this.block.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  int(max: number): number {
    if (!Number.isInteger(max) || max < 1 || max > TWO_POW_32) {
      throw new RangeError(`int(max) needs an integer in [1, 2^32], got ${max}`);
    }

    const limit = TWO_POW_32 - (TWO_POW_32 % max);
    let value = this.nextUint32();
    while (value >= limit) {
      value = this.nextUint32();
    }
    return value % max;
  }
}
```

- [ ] **Step 2: Build**

```bash
pnpm typecheck && pnpm lint && pnpm --filter @pokedrop/api build
```

Expected: all pass.

- [ ] **Step 3: Probe the stream**

Create `$S/probe-rng.mjs`:

```js
import { createHash } from 'node:crypto';
const { SeededRng, newSeed, SEED_BYTES } = await import(`${process.env.DIST}/pack-rng.js`);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
const seedOf = (label) => createHash('sha256').update(label).digest();
const critical = (k) => k * (1 - 2 / (9 * k) + 3.0902 * Math.sqrt(2 / (9 * k))) ** 3;
const chi2 = (observed, expected) => observed.reduce((sum, o, i) => sum + (o - expected[i]) ** 2 / expected[i], 0);

check('newSeed is 32 bytes and random', newSeed().length === SEED_BYTES && !newSeed().equals(newSeed()));
check('seed of 31 bytes throws', throws(() => new SeededRng(Buffer.alloc(31))));
check('seed of 33 bytes throws', throws(() => new SeededRng(Buffer.alloc(33))));

const a = new SeededRng(seedOf('one'));
const b = new SeededRng(seedOf('one'));
const c = new SeededRng(seedOf('two'));
const seqA = Array.from({ length: 50 }, () => a.nextUint32());
const seqB = Array.from({ length: 50 }, () => b.nextUint32());
const seqC = Array.from({ length: 50 }, () => c.nextUint32());
check('same seed, same stream', seqA.every((v, i) => v === seqB[i]));
check('different seed, different stream', seqA.some((v, i) => v !== seqC[i]));

const r = new SeededRng(seedOf('bounds'));
check('int(1) is always 0', Array.from({ length: 1000 }, () => r.int(1)).every((v) => v === 0));
check('int(2^32) works', Number.isInteger(r.int(2 ** 32)));
for (const bad of [0, -1, 1.5, 2 ** 32 + 1, Number.NaN]) {
  check(`int(${bad}) throws`, throws(() => r.int(bad)));
}

for (const [label, max] of [['3·2^30 (~25% rejected)', 3 * 2 ** 30], ['2^31 + 1 (~50% rejected)', 2 ** 31 + 1]]) {
  const rng = new SeededRng(seedOf(label));
  const bins = 64;
  const draws = 1_000_000;
  const observed = new Array(bins).fill(0);
  for (let i = 0; i < draws; i += 1) {
    observed[Math.floor((rng.int(max) / max) * bins)] += 1;
  }
  const value = chi2(observed, new Array(bins).fill(draws / bins));
  check(`int(${label}) uniform over ${bins} bins`, value < critical(bins - 1), `χ² ${value.toFixed(1)} < ${critical(bins - 1).toFixed(1)}`);
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
```

Run:

```bash
DIST="$DIST" node "$S/probe-rng.mjs"
```

Expected: every line `PASS`, ending `ALL PASS`. Keep the two χ² lines for Task 5.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/packs/pack-rng.ts
git commit -m "[PD-57]: add a seeded hmac stream with unbiased integers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: The generator

**Files:**
- Create: `apps/api/src/packs/pack-generator.ts`

**Interfaces:**
- Consumes: `Rng` (Task 1); `SlotConfig` from `@pokedrop/shared` (`{ slots: { count: number; weights: Record<string, number> }[] }`).
- Produces: `type CardPool = ReadonlyMap<string, readonly string[]>`; `type PulledCard = { cardId: string; rarity: string }`; `type Fallback = { slot: number; rolled: string; used: string }`; `type GeneratedPack = { cards: PulledCard[]; fallbacks: Fallback[] }`; `class EmptySlotError extends Error { readonly slot: number }`; `generatePack(slotConfig: SlotConfig, pool: CardPool, rng: Rng): GeneratedPack`.

- [ ] **Step 1: Write the generator**

Create `apps/api/src/packs/pack-generator.ts`:

```ts
import type { SlotConfig } from '@pokedrop/shared';
import type { Rng } from './pack-rng.js';

export type CardPool = ReadonlyMap<string, readonly string[]>;
export type PulledCard = { cardId: string; rarity: string };
export type Fallback = { slot: number; rolled: string; used: string };
export type GeneratedPack = { cards: PulledCard[]; fallbacks: Fallback[] };

export class EmptySlotError extends Error {
  constructor(readonly slot: number) {
    super(`Slot ${slot} has no cards in any of its rarities`);
    this.name = 'EmptySlotError';
  }
}

type Rung = { rarity: string; weight: number };

export function generatePack(slotConfig: SlotConfig, pool: CardPool, rng: Rng): GeneratedPack {
  const cards: PulledCard[] = [];
  const fallbacks: Fallback[] = [];

  for (const [slot, config] of slotConfig.slots.entries()) {
    const ladder = ladderOf(config.weights);
    const total = ladder.reduce((sum, rung) => sum + rung.weight, 0);

    for (let n = 0; n < config.count; n += 1) {
      const rolled = roll(ladder, rng.int(total));
      const found = resolve(ladder, rolled.index, pool);
      if (found === null) {
        throw new EmptySlotError(slot);
      }
      if (found.rarity !== rolled.rarity) {
        fallbacks.push({ slot, rolled: rolled.rarity, used: found.rarity });
      }
      cards.push({ cardId: pick(found.bucket, rng), rarity: found.rarity });
    }
  }

  return { cards, fallbacks };
}

// Index 0 is the most common rarity. Computed, never read from key order:
// jsonb stores object keys in its own order.
function ladderOf(weights: Record<string, number>): Rung[] {
  return Object.entries(weights)
    .filter(([, weight]) => weight > 0)
    .map(([rarity, weight]) => ({ rarity, weight }))
    .sort((a, b) => b.weight - a.weight || compare(a.rarity, b.rarity));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function roll(ladder: readonly Rung[], r: number): { index: number; rarity: string } {
  let cumulative = 0;
  for (const [index, rung] of ladder.entries()) {
    cumulative += rung.weight;
    if (r < cumulative) {
      return { index, rarity: rung.rarity };
    }
  }
  throw new RangeError(`Roll ${r} is beyond the slot's weight total ${cumulative}`);
}

// Down the ladder towards more common rarities first, then up to the nearest
// rarer one: a rarer card only when no commoner card exists.
function resolve(
  ladder: readonly Rung[],
  rolled: number,
  pool: CardPool,
): { rarity: string; bucket: readonly string[] } | null {
  const order = [...ladder.slice(0, rolled + 1).reverse(), ...ladder.slice(rolled + 1)];
  for (const rung of order) {
    const bucket = pool.get(rung.rarity);
    if (bucket !== undefined && bucket.length > 0) {
      return { rarity: rung.rarity, bucket };
    }
  }
  return null;
}

function pick(bucket: readonly string[], rng: Rng): string {
  const cardId = bucket[rng.int(bucket.length)];
  if (cardId === undefined) {
    throw new RangeError('Picked outside a non-empty bucket');
  }
  return cardId;
}
```

- [ ] **Step 2: Build**

```bash
pnpm typecheck && pnpm lint && pnpm --filter @pokedrop/api build
grep -n "import" apps/api/dist/packs/pack-generator.js
```

Expected: checks pass; `grep` prints **no import lines at all** — both imports in the source are type-only and erased — so certainly no `@prisma/client`, `@nestjs/*` or `../prisma`.

- [ ] **Step 3: Probe behaviour**

Create `$S/probe-generator.mjs`:

```js
import { createHash } from 'node:crypto';
const { SeededRng } = await import(`${process.env.DIST}/pack-rng.js`);
const { generatePack, EmptySlotError } = await import(`${process.env.DIST}/pack-generator.js`);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const seedOf = (label) => createHash('sha256').update(label).digest();
const bucket = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}-${String(i).padStart(3, '0')}`);
const pool = (entries) => new Map(entries);
const counting = (rng) => { let calls = 0; return { int: (max) => { calls += 1; return rng.int(max); }, calls: () => calls }; };
const fixed = (values) => { let i = 0; return { int: (max) => { const v = values[i++ % values.length]; if (v >= max) throw new Error('fixed value out of range'); return v; } }; };

const full = pool([['Common', bucket('C', 10)], ['Uncommon', bucket('U', 10)], ['Rare', bucket('R', 5)], ['Rare Holo', bucket('H', 5)]]);
const config = { slots: [
  { count: 4, weights: { Common: 100 } },
  { count: 3, weights: { Uncommon: 100 } },
  { count: 1, weights: { Rare: 75, 'Rare Holo': 25 } },
] };

// reproducibility and shape
const p1 = generatePack(config, full, new SeededRng(seedOf('repro')));
const p2 = generatePack(config, full, new SeededRng(seedOf('repro')));
const p3 = generatePack(config, full, new SeededRng(seedOf('other')));
check('8 cards', p1.cards.length === 8);
check('same seed, same pack', JSON.stringify(p1) === JSON.stringify(p2));
check('different seed, different pack', JSON.stringify(p1) !== JSON.stringify(p3));
check('slot rarities in order', p1.cards.slice(0, 4).every((c) => c.rarity === 'Common') && p1.cards.slice(4, 7).every((c) => c.rarity === 'Uncommon'));
check('every card from its own bucket', p1.cards.every((c) => full.get(c.rarity).includes(c.cardId)));
check('no fallbacks on a full pool', p1.fallbacks.length === 0);

// two draws per card
const counter = counting(new SeededRng(seedOf('count')));
generatePack(config, full, counter);
check('exactly two draws per card', counter.calls() === 16, String(counter.calls()));

// case "tie and key order": ladder independent of key insertion order
const forward = { slots: [{ count: 50, weights: { A: 5, B: 5, C: 1 } }] };
const reverse = { slots: [{ count: 50, weights: { C: 1, B: 5, A: 5 } }] };
const abc = pool([['A', bucket('A', 3)], ['B', bucket('B', 3)], ['C', bucket('C', 3)]]);
check('tie and key order: identical packs', JSON.stringify(generatePack(forward, abc, new SeededRng(seedOf('ko')))) === JSON.stringify(generatePack(reverse, abc, new SeededRng(seedOf('ko')))));
// ladder is A(5), B(5), C(1): r in [0,5) → A, [5,10) → B, 10 → C
const tie = generatePack({ slots: [{ count: 3, weights: { B: 5, C: 1, A: 5 } }] }, abc, fixed([0, 0, 5, 0, 10, 0]));
check('tie broken by name: A before B', tie.cards.map((c) => c.rarity).join() === 'A,B,C', tie.cards.map((c) => c.rarity).join());

// case "zero weight": never rolled, never a fallback
const zero = { slots: [{ count: 200, weights: { Common: 10, 'Rare Secret': 0 } }] };
const zp = generatePack(zero, pool([['Common', bucket('C', 5)], ['Rare Secret', bucket('S', 5)]]), new SeededRng(seedOf('zero')));
check('zero weight never rolled', zp.cards.every((c) => c.rarity === 'Common'));
const outcome = (fn) => { try { return fn(); } catch (error) { return error; } };
const zeroOnly = outcome(() => generatePack({ slots: [{ count: 1, weights: { Common: 10, 'Rare Secret': 0 } }] }, pool([['Rare Secret', bucket('S', 5)]]), new SeededRng(seedOf('z2'))));
check('zero weight never a fallback', zeroOnly instanceof EmptySlotError, zeroOnly instanceof Error ? zeroOnly.message : JSON.stringify(zeroOnly));

// fallback ladder: C(72) R(20) E(5) U(2) S(1); r picks the rolled rung
const ladderConfig = (count) => ({ slots: [{ count, weights: { S: 1, U: 2, E: 5, R: 20, C: 72 } }] });
const at = { C: 0, R: 72, E: 92, U: 97, S: 99 };
const only = (...rarities) => pool(rarities.map((r) => [r, bucket(r, 3)]));
const one = (rolled, p) => outcome(() => generatePack(ladderConfig(1), p, fixed([at[rolled], 0])));

let g = one('E', only('C', 'R', 'U', 'S'));
check('empty rolled bucket steps down to the next commoner', g.cards?.[0]?.rarity === 'R' && JSON.stringify(g.fallbacks) === JSON.stringify([{ slot: 0, rolled: 'E', used: 'R' }]), JSON.stringify(g));
g = one('E', only('C', 'U', 'S'));
check('steps down past two empties', g.cards?.[0]?.rarity === 'C', JSON.stringify(g.cards));
g = one('E', only('U', 'S'));
check('everything commoner empty: nearest rarer', g.cards?.[0]?.rarity === 'U' && g.fallbacks[0]?.used === 'U', JSON.stringify(g.cards));
g = one('C', only('R', 'S'));
check('case "most common empty": goes up, not an error', g.cards?.[0]?.rarity === 'R', JSON.stringify(g));
g = one('C', pool([['C', []], ['R', bucket('R', 3)]]));
check('case "empty array bucket": same as missing', g.cards?.[0]?.rarity === 'R', JSON.stringify(g));
g = one('E', pool([]));
check('whole slot empty: EmptySlotError with slot index', g instanceof EmptySlotError && g.slot === 0, String(g));
const second = outcome(() => generatePack({ slots: [{ count: 1, weights: { C: 1 } }, { count: 1, weights: { X: 1 } }] }, only('C'), new SeededRng(seedOf('s2'))));
check('EmptySlotError names the right slot', second instanceof EmptySlotError && second.slot === 1, String(second));
g = generatePack(ladderConfig(5), only('C'), new SeededRng(seedOf('many')));
check('emitted rarity is the bucket used', g.cards.every((c) => c.rarity === 'C' && c.cardId.startsWith('C-')));
g = generatePack(ladderConfig(5), only('C'), fixed([at.C, 0, at.R, 0, at.E, 0, at.C, 0, at.S, 0]));
check('one fallback entry per fallen-back card', JSON.stringify(g.fallbacks.map((f) => f.rolled)) === JSON.stringify(['R', 'E', 'S']) && g.fallbacks.every((f) => f.used === 'C'), JSON.stringify(g.fallbacks));

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
```

Run:

```bash
DIST="$DIST" node "$S/probe-generator.mjs"
```

Expected: every line `PASS`, ending `ALL PASS`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/packs/pack-generator.ts
git commit -m "[PD-57]: generate a pack from weighted slots with a fallback ladder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: The pool loader and the seed column

**Files:**
- Create: `apps/api/src/packs/pack-pool.ts`
- Modify: `apps/api/prisma/schema.prisma` (`model PackOpening`)
- Create (generated): `apps/api/prisma/migrations/<timestamp>_pack_opening_seed/migration.sql`

**Interfaces:**
- Consumes: `CardPool` (Task 2); `SetFilter` from `@pokedrop/shared`; `TransactionClient` from `../prisma/index.js`.
- Produces: `loadPool(client: TransactionClient, setFilter: SetFilter): Promise<CardPool>`; `PackOpening.seed: string | null` on the Prisma client, for PD-58 to write.

- [ ] **Step 1: Write the loader**

Create `apps/api/src/packs/pack-pool.ts`:

```ts
import type { SetFilter } from '@pokedrop/shared';
import type { TransactionClient } from '../prisma/index.js';
import type { CardPool } from './pack-generator.js';

// The id order inside each bucket is part of what a stored seed reproduces:
// the generator indexes into it.
export async function loadPool(client: TransactionClient, setFilter: SetFilter): Promise<CardPool> {
  const rows = await client.card.findMany({
    where: { setId: { in: setFilter.setIds }, rarity: { not: null } },
    select: { id: true, rarity: true },
    orderBy: [{ rarity: 'asc' }, { id: 'asc' }],
  });

  const pool = new Map<string, string[]>();
  for (const row of rows) {
    if (row.rarity === null) {
      continue;
    }
    const bucket = pool.get(row.rarity);
    if (bucket === undefined) {
      pool.set(row.rarity, [row.id]);
    } else {
      bucket.push(row.id);
    }
  }
  return pool;
}
```

- [ ] **Step 2: Add the column**

In `apps/api/prisma/schema.prisma`, inside `model PackOpening`, after the `openId` field, add:

```prisma
  /// Hex of the 32-byte seed the pack was drawn from. Null only for openings
  /// that predate PD-57.
  seed       String?
```

Then generate and apply the migration:

```bash
(cd apps/api && pnpm exec prisma migrate dev --name pack_opening_seed)
cat apps/api/prisma/migrations/*_pack_opening_seed/migration.sql
$PSQL -c "select id, seed is null from pack_openings;"
```

Expected: the migration is a single `ALTER TABLE "pack_openings" ADD COLUMN "seed" TEXT;`; the seed opening reports `t` (null). If `migrate dev` reports drift or offers a reset, **stop** — do not reset the database.

- [ ] **Step 3: Build**

```bash
pnpm typecheck && pnpm lint && pnpm --filter @pokedrop/api build
```

Expected: all pass.

- [ ] **Step 4: Probe the loader against the seed template**

Create `apps/api/probe-pd57.mjs` (deleted in Task 4, Step 4):

```js
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loadPool } from './dist/packs/pack-pool.js';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const pool = await loadPool(prisma, { setIds: ['base1', 'base2'] });
const sizes = Object.fromEntries([...pool].map(([rarity, ids]) => [rarity, ids.length]));
check('seed template buckets 48/48/32/32', JSON.stringify(sizes) === JSON.stringify({ Common: 48, Rare: 32, 'Rare Holo': 32, Uncommon: 48 }), JSON.stringify(sizes));
check('no card without a rarity', ![...pool.keys()].some((k) => k === null || k === ''));
const sortedByDb = await prisma.$queryRaw`SELECT rarity, array_agg(id ORDER BY id) AS ids FROM cards WHERE "setId" IN ('base1','base2') AND rarity IS NOT NULL GROUP BY rarity`;
check('every bucket in database id order', sortedByDb.every((row) => JSON.stringify(pool.get(row.rarity)) === JSON.stringify(row.ids)));

await prisma.$disconnect();
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
```

Run:

```bash
(cd apps/api && DATABASE_URL="postgresql://pokedrop:pokedrop_local_dev@localhost:5433/pokedrop" node probe-pd57.mjs)
```

Expected: `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/packs/pack-pool.ts apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "[PD-57]: load a card pool by rarity and store each pack's seed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Statistics and performance

**Files:**
- Create (never committed): `$S/probe-stats.mjs`
- Modify (never committed, deleted in Step 4): `apps/api/probe-pd57.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1–3 via `dist`.
- Produces: the numbers Task 5 records.

- [ ] **Step 1: The statistical probe**

Create `$S/probe-stats.mjs`:

```js
import { createHash } from 'node:crypto';
const { SeededRng } = await import(`${process.env.DIST}/pack-rng.js`);
const { generatePack } = await import(`${process.env.DIST}/pack-generator.js`);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const seedOf = (label) => createHash('sha256').update(label).digest();
const critical = (k) => k * (1 - 2 / (9 * k) + 3.0902 * Math.sqrt(2 / (9 * k))) ** 3;
const chi2 = (observed, expected) => observed.reduce((sum, o, i) => sum + (o - expected[i]) ** 2 / expected[i], 0);
const bucket = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}-${String(i).padStart(3, '0')}`);

const hits = { S: 1, U: 2, E: 5, R: 20, C: 72 };
const config = { slots: [
  { count: 4, weights: { Common: 1 } },
  { count: 1, weights: { 'Rare Secret': hits.S, 'Rare Ultra': hits.U, 'Rare Holo EX': hits.E, 'Rare Holo': hits.R, Rare: hits.C } },
  { count: 2, weights: { Uncommon: 3, 'Rare Shiny': 1 } },
] };
const pool = new Map([
  ['Common', bucket('C', 48)], ['Rare', bucket('R', 10)], ['Rare Holo', bucket('H', 10)],
  ['Rare Holo EX', bucket('E', 10)], ['Rare Ultra', bucket('U', 10)], ['Rare Secret', bucket('S', 10)],
  ['Uncommon', bucket('N', 10)], ['Rare Shiny', bucket('Y', 10)],
]);

const PACKS = 100_000;
const slot1 = new Map();
const slot2 = new Map();
const commons = new Map();
const started = performance.now();
for (let i = 0; i < PACKS; i += 1) {
  const pack = generatePack(config, pool, new SeededRng(seedOf(`pack-${i}`)));
  pack.cards.slice(0, 4).forEach((c) => commons.set(c.cardId, (commons.get(c.cardId) ?? 0) + 1));
  slot1.set(pack.cards[4].rarity, (slot1.get(pack.cards[4].rarity) ?? 0) + 1);
  pack.cards.slice(5).forEach((c) => slot2.set(c.rarity, (slot2.get(c.rarity) ?? 0) + 1));
}
const elapsed = performance.now() - started;
console.log(`generated ${PACKS} packs in ${elapsed.toFixed(0)} ms`);

const fit = (label, counts, weights) => {
  const keys = Object.keys(weights);
  const total = keys.reduce((s, k) => s + (counts.get(k) ?? 0), 0);
  const weightSum = keys.reduce((s, k) => s + weights[k], 0);
  const observed = keys.map((k) => counts.get(k) ?? 0);
  const expected = keys.map((k) => (total * weights[k]) / weightSum);
  const value = chi2(observed, expected);
  return { value, limit: critical(keys.length - 1), observed: Object.fromEntries(keys.map((k, i) => [k, observed[i]])) };
};

const weights1 = { 'Rare Secret': 1, 'Rare Ultra': 2, 'Rare Holo EX': 5, 'Rare Holo': 20, Rare: 72 };
let r = fit('slot 1', slot1, weights1);
check('rarity slot 72/20/5/2/1 fits its weights', r.value < r.limit, `χ² ${r.value.toFixed(2)} < ${r.limit.toFixed(2)} ${JSON.stringify(r.observed)}`);

const corrupted = { 'Rare Secret': 1 * 20.8 / 28, 'Rare Ultra': 2 * 20.8 / 28, 'Rare Holo EX': 5 * 20.8 / 28, 'Rare Holo': 20 * 20.8 / 28, Rare: 79.2 };
r = fit('slot 1 corrupted', slot1, corrupted);
check('the same draws REJECT weights corrupted by 10%', r.value > r.limit, `χ² ${r.value.toFixed(0)} > ${r.limit.toFixed(2)}`);

r = fit('slot 2', slot2, { Uncommon: 3, 'Rare Shiny': 1 });
check('two-card slot 3/1 fits', r.value < r.limit, `χ² ${r.value.toFixed(2)} < ${r.limit.toFixed(2)}`);

const ids = pool.get('Common');
const observed = ids.map((id) => commons.get(id) ?? 0);
const expected = ids.map(() => (PACKS * 4) / ids.length);
const value = chi2(observed, expected);
check('cards uniform within a 48-card bucket', value < critical(ids.length - 1), `χ² ${value.toFixed(2)} < ${critical(ids.length - 1).toFixed(2)}`);

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
```

Run:

```bash
DIST="$DIST" node "$S/probe-stats.mjs" | tee "$S/stats.txt"
```

Expected: four `PASS`, ending `ALL PASS`. Keep `$S/stats.txt` for Task 5.

- [ ] **Step 2: Performance on the largest pool**

Overwrite `apps/api/probe-pd57.mjs` with:

```js
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loadPool } from './dist/packs/pack-pool.js';
import { SeededRng, newSeed } from './dist/packs/pack-rng.js';
import { generatePack } from './dist/packs/pack-generator.js';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const largest = await prisma.$queryRaw`SELECT "setId" AS id FROM cards GROUP BY "setId" ORDER BY count(*) DESC LIMIT 50`;
const setIds = largest.map((row) => row.id);
const probePool = await loadPool(prisma, { setIds });
const rarities = [...probePool.entries()].sort((a, b) => b[1].length - a[1].length).map(([r]) => r);
const bigConfig = { slots: [
  { count: 6, weights: { [rarities[0]]: 1 } },
  { count: 3, weights: { [rarities[1]]: 1 } },
  { count: 1, weights: Object.fromEntries(rarities.slice(2, 7).map((r, i) => [r, 50 - i * 10])) },
] };
const runs = [];
for (let i = 0; i < 5; i += 1) {
  const start = performance.now();
  const p = await loadPool(prisma, { setIds });
  generatePack(bigConfig, p, new SeededRng(newSeed()));
  runs.push(performance.now() - start);
}
runs.sort((a, b) => a - b);
const cards = [...probePool.values()].reduce((s, b) => s + b.length, 0);
check('largest pool: load + generate median <= 50 ms', runs[2] <= 50, `${runs[2].toFixed(1)} ms (min ${runs[0].toFixed(1)}, max ${runs[4].toFixed(1)}), ${cards} cards, ${probePool.size} rarities`);

await prisma.$disconnect();
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
```

Run:

```bash
pnpm --filter @pokedrop/api build
(cd apps/api && DATABASE_URL="postgresql://pokedrop:pokedrop_local_dev@localhost:5433/pokedrop" node probe-pd57.mjs) | tee "$S/perf.txt"
```

Expected: `ALL PASS`; the performance line reports ~10 646 cards over ~30 rarities. **If it misses 50 ms, stop** and report the numbers — the spec reopens the cache question rather than letting this plan decide it.

- [ ] **Step 3: Confirm no database dependency in the generator**

```bash
grep -n "import" apps/api/src/packs/pack-generator.ts apps/api/src/packs/pack-rng.ts
```

Expected: only `@pokedrop/shared` (type), `./pack-rng.js` (type) and `node:crypto`. Steps 1 of Tasks 2 and 4 already ran the generator with no database connection.

- [ ] **Step 4: Clean up**

```bash
rm apps/api/probe-pd57.mjs
git status --short
```

Expected: nothing from this task in `git status`. Keep `$S/stats.txt`, `$S/perf.txt` and the Task 1 χ² lines until Task 5 is committed.

---

## Task 5: Documentation

**Files:**
- Modify: `docs/API.md` (Packs section, after the "Every create and update writes one `AuditLog` row" paragraph)
- Modify: `docs/UserFlows.md` §5, "Fairness & integrity" — the empty-bucket bullet
- Modify: `docs/DataModel.md` — `### PackOpening`

**Interfaces:**
- Consumes: `$S/stats.txt`, `$S/perf.txt`, Task 1's χ² lines.

- [ ] **Step 1: API.md — how a pack is drawn**

Append to the Packs section of `docs/API.md` a subsection **"How a pack is drawn"** covering, in the voice of the surrounding paragraphs (bold lead sentence, then the measured fact):

- **The stream**: HMAC-SHA256 in counter mode over a 32-byte random seed, integers by rejection sampling; why not `crypto.randomInt` (not seedable).
- **The ladder**: weights > 0, weight descending, ties by name; never the key order (`jsonb`).
- **Per card, two draws**: rarity by cumulative weight, then a card uniformly from the bucket; duplicates allowed, with the ~12% figure for four Commons from 48.
- **Fallback**: down the ladder to more common, then up to the nearest rarer, then `EmptySlotError` → 409 with nothing charged (PD-58); fallbacks returned for logging; why they happen only after a catalog change (PD-56's pool check).
- **The seed**: stored hex in `PackOpening.seed`, never sent to a client; replay reproduces a pack exactly while the pool is unchanged; `PackOpeningCard` stays the record of what was given.
- **Measured**: the four lines of `$S/stats.txt` (with the χ² values and limits), the two χ² lines from Task 1, the time for 100 000 packs, and the `$S/perf.txt` performance line; the date.

- [ ] **Step 2: UserFlows.md §5**

Replace

```
- Guard against empty rarity buckets (fall back to next-lower rarity) so a misconfigured template can't 500.
```

with

```
- Guard against empty rarity buckets so a misconfigured template can't 500: fall back to the next **more common** rarity in the same slot (by weight), then to the nearest rarer one; a slot with no cards at all refuses the open without charging. See [API.md](API.md) (Packs, "How a pack is drawn").
```

- [ ] **Step 3: DataModel.md**

In `### PackOpening`, change the field list to `id, userId, templateId, openId(unique), seed?, createdAt` and add one line: `seed` is the hex of the 32-byte generator seed — null only for openings before PD-57; it reproduces a pack while the card pool is unchanged.

- [ ] **Step 4: Verify and commit**

```bash
grep -n "How a pack is drawn\|more common" docs/API.md docs/UserFlows.md
pnpm format:check
git add docs/API.md docs/UserFlows.md docs/DataModel.md
git commit -m "[PD-57]: document how a pack is drawn and what it measured

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
rm -f "$S"/probe-*.mjs "$S/stats.txt" "$S/perf.txt"
```

Expected: both greps hit; formatting passes; every number in the new section appears in the probe outputs.

---

## Self-review notes

- **Spec coverage.** Stream and bounds → Task 1. Ladder, roll, fallback down/up, `EmptySlotError`, emitted rarity, two draws, duplicates, key-order independence → Task 2. `loadPool`, id order, no rarity-less cards, `seed` column and migration → Task 3. Statistics (fit, sensitivity, bucket uniformity), stream uniformity with rejection (Task 1), performance budget, no DB writes → Tasks 1, 2, 4. Docs → Task 5. Out-of-scope items have no task, by design.
- **Type names across tasks.** `Rng`, `SeededRng`, `newSeed`, `SEED_BYTES` (Task 1); `CardPool`, `PulledCard`, `Fallback`, `GeneratedPack`, `EmptySlotError`, `generatePack` (Task 2); `loadPool` (Task 3) — used with these exact names in Tasks 2–4.
