# PD-137 Random Legal Deck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A *Random deck* action in the deck builder (and *New deck*) that fills the draft with a legal deck of whole evolution lines, Trainers and basic Energy, from any card or only the member's available copies.

**Architecture:** The catalog mirror gains `evolvesFrom` (both providers, the guarded writer, one backfill sync). The API gains `POST /decks/random` and `GET /decks/random/types`: a pool read in SQL, a pure seeded generator, `validateDeck` before answering, a `shortfall` answer when a collection is too small. The web app gets a dialog that replaces the draft's cards through a new store action.

**Tech Stack:** NestJS + Prisma 7 (API), Zod 4 (shared), Next 16.3, React 19.2, TanStack Query 5, Zustand.

**Spec:** `docs/superpowers/specs/2026-10-08-pd-137-random-deck-design.md`

## Global Constraints

- No automated tests in v1; nothing test-like is committed. Gates: shared `pnpm --filter @pokedrop/shared build`; api `pnpm --filter @pokedrop/api typecheck` and `pnpm exec eslint <touched api folders> --max-warnings=0`; web `pnpm --filter @pokedrop/web typecheck` and `pnpm exec eslint <touched web folders> --max-warnings=0`; `pnpm exec prettier --check` on touched files. Behaviour is measured with `curl`/`psql`, a throwaway generator script in the session scratchpad, and headless Chrome over CDP (scratchpad `cdp.mjs`).
- After any Prisma schema change: `cd apps/api && pnpm exec prisma migrate dev --name <name>` **and** `pnpm exec prisma generate` (Prisma 7 does not generate on migrate), then restart the API (touch a file under `apps/api/src`).
- API routes live under `/api/v1`. Signed-in checks use the test account in the session scratchpad (`pd134-user.txt`, jar `jar-admin.txt`); promote it with `psql` only for admin calls and demote it after.
- The pool is cards with `legalities->>format = 'Legal'`, no `V-UNION`, Pokémon only with a type. *Owned only*: `available = quantity − "lockedQuantity"` > 0.
- Shape: Pokémon 16–18 copies in 2–4 whole lines (shapes 3-2-2 or 4-3-3, 3-2, 2 or 3); Trainers 12–14 (fill up to 15), Supporters 4–6, Stadiums ≤ 2 copies, ≤ 1 ACE SPEC; ≤ 1 Radiant; the rest basic Energy of the chosen types split evenly (odd copy to the first type). Copy limit by `copyLimitKey`, `DECK_MAX_COPIES` 4. Deck size is `config.decks.size` (60).
- Shortfall minimums: Pokémon 12 copies, Trainers 8, Energy to fill the rest. Messages exactly: *You own {have} {Type} Pokémon; a deck needs at least 12*, *You own {have} Trainers; a deck needs at least 8*, *You own {have} basic {Type} Energy; this deck needs {need}*.
- `seed` (1–64 chars) only when `config.app.isProduction` is false; otherwise 400 *seed is only accepted in development*. A type with no legal basic Energy: 400 *No basic {type} Energy is legal in {format}*.
- Generatable types: basic Energy types with a `Legal` printing in the format, among `BASIC_ENERGY_TYPES` = Grass, Fire, Water, Lightning, Psychic, Fighting, Darkness, Metal, Fairy. A basic Energy's type is its name without `Basic ` and ` Energy`.
- Commits on `dev`, header `[PD-137]: …` ≤ 72 characters, body ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Comments only where a tidy-up would silently break something. Python edit scripts open files with `newline=''`.

## Review Focus

1. **The writer's guarded tuple without `evolvesFrom`**: a sync would leave every existing row without it and nobody would notice. Pinned in Task 1, Step 4 (the column in all three places) and measured in Task 1, Step 7 (counts after the backfill).
2. **A name at the copy limit through another printing** (Charizard from two sets): a line must shrink or be dropped, never push the name past 4. Pinned in Task 3 (`byName` counts by `copyLimitKey`) and measured in Task 3, Step 4 (G1 runs `validateDeck`).
3. **A line whose lower stage exists only in the wrong format or not owned**: the top must not be chosen. Pinned in Task 3 (`resolveLine` walks the pool only) and measured in G3.
4. **Owned only with *Surprise me* on a collection that fits one type but not another**: the answer is a deck of the type that fits, not a shortfall. Pinned in Task 3 (types tried in random order until one fits) and measured in Task 3, Step 4 (G2 with the top-up member).
5. **Replacing a draft the member edited**: the dialog asks before replacing, and *Save* stores exactly the generated cards. Pinned in Task 5 (`replaceCards`, the confirm) and measured in Task 5, Step 8 (B1, B2).

---

### Task 1: `evolvesFrom` in the mirror, and the backfill  *(subagent-suitable)*

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `Card`)
- Create: `apps/api/prisma/migrations/<timestamp>_card_evolves_from/migration.sql` (generated)
- Modify: `apps/api/src/sync/providers/provider.dto.ts`
- Modify: `apps/api/src/sync/providers/pokemon-tcg/pokemon-tcg.schema.ts`, `pokemon-tcg.mapper.ts`
- Modify: `apps/api/src/sync/providers/tcgdex/tcgdex.schema.ts`, `tcgdex.mapper.ts`
- Modify: `apps/api/src/sync/catalog.writer.ts`
- Modify: `apps/api/src/sync/README.md`
- Modify: `packages/shared/src/entities/card.ts`

**Interfaces:**
- Produces: column `cards."evolvesFrom" text NULL` (+ index); `CardDTO.evolvesFrom: string | null`; shared `Card.evolvesFrom: string | null`.

- [ ] **Step 1: Schema and migration**

In `model Card`, after `nationalPokedexNumbers Int[]`:

```prisma
  /// The name of the card this one evolves from, as the provider prints it.
  evolvesFrom String?
```

and beside the other indexes `@@index([evolvesFrom])`. Then `cd apps/api && pnpm exec prisma migrate dev --name card_evolves_from && pnpm exec prisma generate`. Check the SQL: one `ADD COLUMN "evolvesFrom" TEXT`, one `CREATE INDEX`, nothing else. If `prisma format` realigned unrelated blocks, restore them.

- [ ] **Step 2: DTO and shared**

`provider.dto.ts`, in the card DTO beside `nationalPokedexNumbers`: `evolvesFrom: z.string().min(1).nullable(),`.
`packages/shared/src/entities/card.ts`, in `CardSchema` beside `nationalPokedexNumbers`: `evolvesFrom: z.string().nullable().default(null),`.

- [ ] **Step 3: Both mappers**

`pokemon-tcg.schema.ts` `RawCardSchema`: `evolvesFrom: z.string().optional(),`; the mapper: `evolvesFrom: raw.evolvesFrom ?? null,`.
`tcgdex.schema.ts` (the card schema with `stage`): `evolveFrom: z.string().optional(),`; the mapper: `evolvesFrom: raw.evolveFrom ?? null,`.

- [ ] **Step 4: The writer, in three places**

In `CatalogWriter.upsertCards`: add `${c.evolvesFrom}` to each `VALUES` row after `${c.nationalPokedexNumbers}`; `"evolvesFrom"` to the `INSERT` column list after `"nationalPokedexNumbers"`; `"evolvesFrom" = excluded."evolvesFrom",` to `UPDATE SET`; and `cards."evolvesFrom"` / `excluded."evolvesFrom"` to **both** sides of the `IS DISTINCT FROM` tuple, in the same position. In the class comment's list of rules, add a fourth: *A column written by the upsert is in the comparison tuple too; one left out is never updated on an existing row.*

- [ ] **Step 5: README**

`apps/api/src/sync/README.md`: one line under *Shape* or *Three things that will bite* that `CardDTO.evolvesFrom` is the provider's `evolvesFrom` (pokemontcg.io) / `evolveFrom` (TCGdex) and that the writer's tuple must hold every written column.

- [ ] **Step 6: Gate**

Shared build, API typecheck, `pnpm exec eslint apps/api/src/sync --max-warnings=0`, prettier on touched files. Restart the API; `GET /api/v1/cards/base1-4` answers with `"evolvesFrom": null` (not backfilled yet).

- [ ] **Step 7: Backfill and measure**

Promote the test account (`psql`), `POST /api/v1/admin/sync/catalog` with the admin jar, demote it after. Poll `GET /api/v1/admin/sync/status` (or `sync_runs`) until the run finishes (about 15 minutes). Then:

```sql
select unnest(subtypes) s, count(*) total, count("evolvesFrom") with_from
from cards where supertype = 'Pokémon' group by 1
having unnest(subtypes) in ('Basic','Stage 1','Stage 2','VMAX','VSTAR','MEGA','ex') order by 1;
select id, name, "evolvesFrom" from cards where id in ('base1-4','base1-24','base1-6','swsh4-20');
```

Expected: `base1-4` → *Charmeleon*, `base1-24` → *Charmander*, `base1-6` → *Magikarp*; Stage 1 / Stage 2 / VMAX / VSTAR nearly all with an `evolvesFrom`, Basic none. Record the counts for the docs (Task 6).

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma apps/api/src/sync packages/shared/src/entities/card.ts
git commit -F - <<'EOF'
[PD-137]: mirror each card's evolvesFrom from both providers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 2: Shared contract and the pool

**Files:**
- Create: `packages/shared/src/decks/random.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `apps/api/src/decks/random-deck/random-deck.types.ts`
- Create: `apps/api/src/decks/random-deck/random-deck.pool.ts`

**Interfaces:**
- Consumes: Task 1's `cards."evolvesFrom"`.
- Produces (shared): `BASIC_ENERGY_TYPES`, `BasicEnergyTypeSchema`, `BasicEnergyType`, `basicEnergyTypeOf(name: string): BasicEnergyType | null`, `RandomDeckRequestSchema`, `RandomDeckRequest`, `RandomDeckResponseSchema`, `RandomDeckResponse`, `RandomDeckTypesSchema` (`Record<DeckFormat, BasicEnergyType[]>`), `SHORTFALL_CODES`.
- Produces (api): `PoolCard`, `GenerateOptions`, `GenerateResult`, `loadPool(db, { format, userId }): Promise<PoolCard[]>`, `generatableTypes(pool: PoolCard[]): BasicEnergyType[]`.

- [ ] **Step 1: Shared**

`packages/shared/src/decks/random.ts`:

```ts
import { z } from 'zod';
import { PlayableCardSchema } from '../entities/inventory.js';
import { DECK_FORMATS, DeckFormatSchema } from '../entities/deck.js';
import { CardIdSchema } from '../primitives/id.js';

export const BASIC_ENERGY_TYPES = [
  'Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Fairy',
] as const;
export const BasicEnergyTypeSchema = z.enum(BASIC_ENERGY_TYPES);
export type BasicEnergyType = z.infer<typeof BasicEnergyTypeSchema>;

/** `Basic Fire Energy` and `Fire Energy` are Fire; a basic Energy's `types` is often empty. */
export function basicEnergyTypeOf(name: string): BasicEnergyType | null {
  const type = name.replace(/^Basic /, '').replace(/ Energy$/, '');
  return BasicEnergyTypeSchema.safeParse(type).success ? (type as BasicEnergyType) : null;
}

export const RandomDeckRequestSchema = z.strictObject({
  format: DeckFormatSchema,
  ownedOnly: z.boolean(),
  types: z
    .array(BasicEnergyTypeSchema)
    .max(2)
    .refine((types) => new Set(types).size === types.length, 'A type is chosen twice'),
  seed: z.string().min(1).max(64).optional(),
});
export type RandomDeckRequest = z.infer<typeof RandomDeckRequestSchema>;

export const SHORTFALL_CODES = ['NOT_ENOUGH_POKEMON', 'NOT_ENOUGH_TRAINERS', 'NOT_ENOUGH_ENERGY'] as const;

export const RandomDeckResponseSchema = z.discriminatedUnion('result', [
  z.object({
    result: z.literal('deck'),
    format: DeckFormatSchema,
    types: z.array(BasicEnergyTypeSchema),
    cards: z.array(
      z.object({ cardId: CardIdSchema, count: z.number().int().min(1), card: PlayableCardSchema }),
    ),
  }),
  z.object({
    result: z.literal('shortfall'),
    code: z.enum(SHORTFALL_CODES),
    type: BasicEnergyTypeSchema.nullable(),
    have: z.number().int().min(0),
    need: z.number().int().min(1),
    message: z.string().min(1),
  }),
]);
export type RandomDeckResponse = z.infer<typeof RandomDeckResponseSchema>;

/** The types each format can generate: a basic Energy of the type is Legal in it. */
export const RandomDeckTypesSchema = z.object(
  Object.fromEntries(DECK_FORMATS.map((f) => [f, z.array(BasicEnergyTypeSchema)])) as Record<
    (typeof DECK_FORMATS)[number],
    z.ZodArray<typeof BasicEnergyTypeSchema>
  >,
);
export type RandomDeckTypes = z.infer<typeof RandomDeckTypesSchema>;
```

If the import of `PlayableCardSchema` / `DeckFormatSchema` creates a cycle the build reports, import from the files that define them directly (they are `entities/inventory.ts` and `entities/deck.ts`). `index.ts`: `export * from './decks/random.js';`. Run prettier on the file (the arrays above are compressed for the plan).

- [ ] **Step 2: Generator types**

`apps/api/src/decks/random-deck/random-deck.types.ts`:

```ts
import type { BasicEnergyType, DeckFormat } from '@pokedrop/shared';

export type PoolCard = {
  id: string;
  name: string;
  supertype: string;
  subtypes: string[];
  types: string[];
  evolvesFrom: string | null;
  /** Copies the deck may use: available copies for Owned only, Infinity for Any card. */
  available: number;
};

export type GenerateOptions = {
  format: DeckFormat;
  /** Empty: pick one or two at random among the generatable types that fit. */
  types: BasicEnergyType[];
  deckSize: number;
};

export type Shortfall = {
  result: 'shortfall';
  code: 'NOT_ENOUGH_POKEMON' | 'NOT_ENOUGH_TRAINERS' | 'NOT_ENOUGH_ENERGY';
  type: BasicEnergyType | null;
  have: number;
  need: number;
  message: string;
};

export type GenerateResult =
  | { result: 'deck'; types: BasicEnergyType[]; cards: { cardId: string; count: number }[] }
  | Shortfall;
```

- [ ] **Step 3: The pool**

`apps/api/src/decks/random-deck/random-deck.pool.ts`:

```ts
import { Prisma } from '@prisma/client';
import { basicEnergyTypeOf, type BasicEnergyType, type DeckFormat } from '@pokedrop/shared';
import type { PoolCard } from './random-deck.types.js';

type Db = { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> };
type Row = Omit<PoolCard, 'available'> & { available: number | null };

/** Every card Legal in the format, or for Owned only the member's available copies of them. */
export async function loadPool(
  db: Db,
  { format, userId }: { format: DeckFormat; userId: string | null },
): Promise<PoolCard[]> {
  const owned = userId === null
    ? Prisma.sql`NULL::int AS available`
    : Prisma.sql`(i.quantity - i."lockedQuantity") AS available`;
  const join = userId === null
    ? Prisma.empty
    : Prisma.sql`JOIN inventory_items i ON i."cardId" = c.id AND i."userId" = ${userId}
                 AND i.quantity - i."lockedQuantity" > 0`;
  const rows = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT c.id, c.name, c.supertype, c.subtypes, c.types, c."evolvesFrom", ${owned}
    FROM cards c ${join}
    WHERE c.legalities->>${format} = 'Legal'
      AND NOT ('V-UNION' = ANY(c.subtypes))
      AND (c.supertype <> 'Pokémon' OR cardinality(c.types) > 0)
  `);
  return rows.map((row) => ({ ...row, available: row.available ?? Number.POSITIVE_INFINITY }));
}

export function isBasicEnergy(card: Pick<PoolCard, 'supertype' | 'subtypes'>): boolean {
  return card.supertype === 'Energy' && card.subtypes.includes('Basic');
}

/** The basic Energy types the pool can supply, in BASIC_ENERGY_TYPES order. */
export function generatableTypes(pool: PoolCard[]): BasicEnergyType[] {
  const types = new Set(
    pool.filter(isBasicEnergy).map((card) => basicEnergyTypeOf(card.name)).filter((t) => t !== null),
  );
  return [...types].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
}
const ORDER: readonly string[] = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Fairy'];
```

(Use `BASIC_ENERGY_TYPES` from shared for `ORDER` instead of the literal; the literal is here only to show the order.) `generatableTypes` on an *Any card* pool gives the format's types; on an *Owned only* pool, the types the member holds basic Energy of.

- [ ] **Step 4: Gate and measure**

Shared build; API typecheck; eslint `apps/api/src/decks`. Measure with `psql` that the pool query's `WHERE` gives for standard about 7 193 rows minus V-UNION, and that the basic Energy names of standard map to eight types (no Fairy):

```sql
select count(*) from cards c where c.legalities->>'standard' = 'Legal' and not ('V-UNION' = any(c.subtypes));
select distinct regexp_replace(regexp_replace(name, '^Basic ', ''), ' Energy$', '') from cards
where supertype = 'Energy' and 'Basic' = any(subtypes) and legalities->>'standard' = 'Legal';
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared apps/api/src/decks/random-deck
git commit -F - <<'EOF'
[PD-137]: share the random deck contract and read the legal pool

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 3: The generator, and the 1 200-deck check  *(subagent-suitable)*

**Files:**
- Create: `apps/api/src/decks/random-deck/random-deck.generator.ts`
- Scratchpad only (not committed): `gen-check.mjs`

**Interfaces:**
- Consumes: Task 2's `PoolCard`, `GenerateOptions`, `GenerateResult`, `Shortfall`, `isBasicEnergy`, `generatableTypes`, `loadPool`; shared `copyLimitKey`, `DECK_MAX_COPIES`, `basicEnergyTypeOf`, `validateDeck`; `Rng` from `apps/api/src/packs/pack-rng.ts` (`int(max): number`, 0 ≤ n < max).
- Produces: `generateDeck(pool: PoolCard[], options: GenerateOptions, rng: Rng): GenerateResult`.

- [ ] **Step 1: The generator**

`random-deck.generator.ts`. The rules are the spec's *The generator* and Global Constraints. Structure:

```ts
import { basicEnergyTypeOf, copyLimitKey, DECK_MAX_COPIES, type BasicEnergyType } from '@pokedrop/shared';
import type { Rng } from '../../packs/pack-rng.js';
import { generatableTypes, isBasicEnergy } from './random-deck.pool.js';
import type { GenerateOptions, GenerateResult, PoolCard, Shortfall } from './random-deck.types.js';

const POKEMON_TARGET = [16, 18] as const;
const POKEMON_MIN = 12;
const TRAINER_TARGET = [12, 14] as const;
const TRAINER_FILL_MAX = 15;
const TRAINER_MIN = 8;
const SUPPORTERS = [4, 6] as const;
const STADIUM_MAX = 2;

/** A deck under construction: counts by card id, and copies used by copy-limit key. */
class Draft {
  readonly counts = new Map<string, number>();
  private readonly byName = new Map<string, number>();
  constructor(private readonly pool: Map<string, PoolCard>) {}
  room(card: PoolCard): number { /* min(available − used, DECK_MAX_COPIES − byName, Infinity for basic Energy) */ }
  add(card: PoolCard, n: number): void { /* counts and byName (skip byName for copyLimitKey === null) */ }
  total(predicate: (card: PoolCard) => boolean): number { /* sum of counts of matching cards */ }
}

export function generateDeck(pool: PoolCard[], options: GenerateOptions, rng: Rng): GenerateResult {
  // 1. candidate type sets: options.types, or for [] the generatable types shuffled, each alone
  //    and paired (one or two at even odds), tried in that random order until one builds.
  // 2. for a type set: buildPokemon → if < POKEMON_MIN: remember a NOT_ENOUGH_POKEMON shortfall, next set.
  // 3. buildTrainers → if < TRAINER_MIN: shortfall NOT_ENOUGH_TRAINERS (type null).
  // 4. fill: deckSize − pokemon − trainers; if > energy room → add Trainers up to TRAINER_FILL_MAX first;
  //    then buildEnergy; if still short → shortfall NOT_ENOUGH_ENERGY (type = the short type).
  // 5. return the first set that builds; else the most informative shortfall (the last set's).
}
```

Implementation rules the code must follow exactly:

- **`resolveLine(top, byName)`**: `byName` maps a name to the pool's printings of it. Walk `evolvesFrom` from the top: each step needs a printing of that name in the pool (`room > 0`); stop at a card whose `evolvesFrom` is null. A missing step means the top is not a candidate. Return the stage *names*, Basic first. Guard against a cycle (a name seen twice) by rejecting the line.
- **Tops**: Pokémon with `types[0]` in the type set, not Radiant if a Radiant is already in. Shuffle with `rng` (Fisher–Yates, `rng.int(i + 1)`).
- **Shapes** by stage count: 3 → `[3,2,2]` or `[4,3,3]` (even odds); 2 → `[3,2]`; 1 → `[2]` or `[3]`. For each stage, pick a printing at random among those with room; place `min(shape, room)` across printings until the shape is met or the name is out of room. If a stage gets 0, roll the whole line back (counts and `byName`).
- Add lines until the Pokémon total is in `POKEMON_TARGET` (draw the target once per deck: `16 + rng.int(3)`), at most 4 lines; skip a line that would pass the target's upper bound by more than 2 (take a shorter shape first).
- **Trainers**: target `12 + rng.int(3)`. Supporters first to `4 + rng.int(3)` copies, then Items and Pokémon Tools, Stadiums capped at `STADIUM_MAX` copies in total, ACE SPEC (subtype `ACE SPEC`) at one copy in the deck. Each name 1–4 copies (`1 + rng.int(4)`, capped by room).
- **Energy**: `need = deckSize − total`. Split by type: `ceil(need / k)` to the first type, `floor` to the rest. Place across that type's printings (`basicEnergyTypeOf(name) === type`) in random order until placed; record a shortfall with `have` = the type's total room if it cannot.
- Messages exactly as in Global Constraints.
- Output `cards` sorted by card id, counts ≥ 1.

- [ ] **Step 2: Build**

Run: `pnpm --filter @pokedrop/api build` (so `apps/api/dist/decks/random-deck/*.js` exists) and the API typecheck and eslint on `apps/api/src/decks`.

- [ ] **Step 3: The check script (scratchpad)**

`gen-check.mjs` in the session scratchpad: create a `PrismaClient` with `@prisma/adapter-pg` and the root `.env`'s `DATABASE_URL` (as `apps/api/prisma/seed.ts` does), import `loadPool` and `generateDeck` from `apps/api/dist/decks/random-deck/`, `SeededRng` from `apps/api/dist/packs/pack-rng.js`, `validateDeck` and `copyLimitKey` from `@pokedrop/shared`. For each format × mode, 200 seeds `pd137-<format>-<mode>-<n>` (seed buffer = `sha256(seed)`): generate, then check G1–G5:

- G1 `validateDeck({ format, ownedOnly, deckSize: 60, cards, available })` — `valid`, no error, and no warning except `OWNERSHIP` in *Any card* mode (the member need not own the cards there); cards need `name`, `supertype`, `subtypes`, `legalities`: read them for the deck's ids;
- G2 owned: every count ≤ `available`;
- G3 every card with `evolvesFrom` has a card of that name in the deck;
- G4 Energy only of the answer's `types`; tops' `types[0]` in them; Pokémon 16–18 or (fill) ≥ 12, Trainers 12–15, total 60, ≤ 1 ACE SPEC, ≤ 1 Radiant;
- G5 the same seed twice → equal; seeds `n` and `n+1` → different.

Print a table per format × mode (decks, shortfalls by code, failures by check, first failing seed). For *Owned only*, top up the test member's collection first with `psql` — insert `inventory_items` (quantity 4) for every card of a few complete lines per format and 30 basic Energy of two types — and run once more against a member with fewer than 12 Pokémon to see each shortfall code.

- [ ] **Step 4: Iterate to clean**

Expected: 0 failures across 1 200 decks; owned shortfalls only on the small member. Fix the generator for any failure (never the check), rebuild, rerun. Record the final table for the docs.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/decks/random-deck/random-deck.generator.ts
git commit -F - <<'EOF'
[PD-137]: generate a legal deck of whole lines, trainers and energy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 4: The service and the two routes

**Files:**
- Create: `apps/api/src/decks/random-deck/random-deck.service.ts`
- Create: `apps/api/src/decks/random-deck/random-deck.controller.ts`
- Modify: `apps/api/src/decks/decks.dto.ts` (a `RandomDeckRequestDto`)
- Modify: `apps/api/src/decks/decks.module.ts`

**Interfaces:**
- Consumes: Tasks 2–3; `DeckValidationService` or shared `validateDeck`; `PLAYABLE_CARD_SELECT`, `toPlayableCard` (`apps/api/src/common/card-summary.ts`); `MODERATE_THROTTLE`; `APP_CONFIG`.
- Produces: `POST /api/v1/decks/random` → `RandomDeckResponse`; `GET /api/v1/decks/random/types` → `RandomDeckTypes`.

- [ ] **Step 1: Service**

```ts
@Injectable()
export class RandomDeckService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** From the ~180 basic Energy printings only, not the whole pool. */
  async types(): Promise<RandomDeckTypes> {
    const energies = await this.prisma.card.findMany({
      where: { supertype: 'Energy', subtypes: { has: 'Basic' } },
      select: { name: true, legalities: true },
    });
    return Object.fromEntries(
      DECK_FORMATS.map((format) => [
        format,
        BASIC_ENERGY_TYPES.filter((type) =>
          energies.some(
            (e) => basicEnergyTypeOf(e.name) === type && toLegalities(e.legalities)[format] === 'Legal',
          ),
        ),
      ]),
    ) as RandomDeckTypes;
  }

  async generate(user: AuthUser, request: RandomDeckRequest): Promise<RandomDeckResponse> {
    if (request.seed !== undefined && this.config.app.isProduction) {
      throw new BadRequestException('seed is only accepted in development');
    }
    const pool = await loadPool(this.prisma, {
      format: request.format,
      userId: request.ownedOnly ? user.id : null,
    });
    const formatTypes = (await this.types())[request.format];
    for (const type of request.types) {
      if (!formatTypes.includes(type)) {
        throw new BadRequestException(`No basic ${type} Energy is legal in ${request.format}`);
      }
    }
    const base = request.seed ?? randomBytes(16).toString('hex');
    for (let attempt = 0; attempt < 5; attempt++) {
      const seed = createHash('sha256').update(attempt === 0 ? base : `${base}:${attempt}`).digest();
      const result = generateDeck(
        pool,
        { format: request.format, types: request.types, deckSize: this.config.decks.size },
        new SeededRng(seed),
      );
      if (result.result === 'shortfall') return result;
      const verdict = await this.verdict(request, result.cards, pool);
      if (verdict.valid) return this.answer(request.format, result);
      this.logger.error({ seed: base, attempt, issues: verdict.issues }, 'random deck failed validation');
    }
    throw new InternalServerErrorException('Could not generate a legal deck');
  }

  // Owned only: the pool's available counts. Any card: an empty map with ownedOnly false, so
  // ownership is only ever a warning there.
  private async verdict(request: RandomDeckRequest, cards: { cardId: string; count: number }[], pool: PoolCard[]) {
    const byId = new Map(pool.map((card) => [card.id, card]));
    const rows = await this.prisma.card.findMany({
      where: { id: { in: cards.map((c) => c.cardId) } },
      select: { id: true, name: true, supertype: true, subtypes: true, legalities: true },
    });
    const info = new Map(rows.map((row) => [row.id, row]));
    return validateDeck({
      format: request.format,
      ownedOnly: request.ownedOnly,
      deckSize: this.config.decks.size,
      cards: cards.map(({ cardId, count }) => {
        const row = info.get(cardId)!;
        return { cardId, count, name: row.name, supertype: row.supertype, subtypes: row.subtypes, legalities: toLegalities(row.legalities) };
      }),
      available: new Map(
        request.ownedOnly ? cards.map(({ cardId }) => [cardId, byId.get(cardId)?.available ?? 0]) : [],
      ),
    });
  }

  private async answer(format: DeckFormat, result: Extract<GenerateResult, { result: 'deck' }>): Promise<RandomDeckResponse> {
    const rows = await this.prisma.card.findMany({
      where: { id: { in: result.cards.map((c) => c.cardId) } },
      select: PLAYABLE_CARD_SELECT,
    });
    const card = new Map(rows.map((row) => [row.id, toPlayableCard(row)]));
    return RandomDeckResponseSchema.parse({
      result: 'deck',
      format,
      types: result.types,
      cards: result.cards.map(({ cardId, count }) => ({ cardId, count, card: card.get(cardId) })),
    });
  }
}
```

The 400 for a type is decided by the format (`types()`), not the member's pool: a type the member owns no Energy of gets the shortfall sentence, not the 400. Imports: `createHash`, `randomBytes` from `node:crypto`; `Logger` from `@nestjs/common` (`private readonly logger = new Logger(RandomDeckService.name)`, or the project's pino logger if the decks service injects one — follow it); `toLegalities` from `../../common/card-summary.js`; `validateDeck`, `basicEnergyTypeOf`, `BASIC_ENERGY_TYPES`, `DECK_FORMATS` from `@pokedrop/shared`.

- [ ] **Step 2: Controller**

```ts
@ApiTags('decks')
@Controller('decks/random')
export class RandomDeckController {
  constructor(private readonly random: RandomDeckService) {}

  @Doc('The energy types each format can generate a random deck of', returns('RandomDeckTypes', RandomDeckTypesSchema))
  @Get('types')
  types(): Promise<RandomDeckTypes> { return this.random.types(); }

  @Doc('Generate a random legal deck for the caller; nothing is saved', returns('RandomDeckResponse', RandomDeckResponseSchema))
  @Throttle(MODERATE_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post()
  generate(@CurrentUser() user: AuthUser, @Body() body: RandomDeckRequestDto): Promise<RandomDeckResponse> {
    return this.random.generate(user, body);
  }
}
```

Register the controller **before** `DecksController` in `DecksModule.controllers` so `decks/random` is not taken by a `decks/:id` route; add `RandomDeckService` to providers. `RandomDeckRequestDto` follows the existing DTO pattern in `decks.dto.ts` (`createZodDto(RandomDeckRequestSchema)` or whatever the file uses).

- [ ] **Step 3: Gate**

Shared build, API typecheck, eslint `apps/api/src/decks`, prettier. Restart the API.

- [ ] **Step 4: Measure (curl, the test member's jar)**

- `GET /decks/random/types` → standard without Fairy, unlimited with it, no Dragon or Colorless anywhere;
- `POST /decks/random {"format":"standard","ownedOnly":false,"types":[],"seed":"a"}` twice → the same 60-card deck; `types` named; each `card` a full `PlayableCard`;
- `{"types":["Fairy"]}` in standard → 400 *No basic Fairy Energy is legal in standard*; three types → 400; `{"format":"nope"}` → 400;
- *Owned only* for the small member → `result: 'shortfall'` with the exact sentence; for the topped-up member → a deck whose counts are all ≤ available;
- no cookie → 401; 30 quick calls → a 429 once over the `MODERATE` limit.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/decks
git commit -F - <<'EOF'
[PD-137]: serve random decks and the energy types each format allows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 5: The builder's *Random deck* and *New deck*'s toggle

**Files:**
- Modify: `apps/web/lib/api/endpoints/decks.ts`, `apps/web/lib/query/decks.ts`, `apps/web/lib/query/keys.ts`
- Modify: `apps/web/lib/stores/deck-draft.ts`
- Create: `apps/web/components/decks/builder/random-deck-dialog.tsx`
- Modify: `apps/web/components/decks/builder/builder-header.tsx`, `deck-builder.tsx`
- Modify: `apps/web/components/decks/deck-page.tsx`, `apps/web/app/(public)/decks/[id]/page.tsx`
- Modify: `apps/web/components/decks/decks-list.tsx`

**Interfaces:**
- Consumes: Task 4's routes; shared `RandomDeckRequest`, `RandomDeckResponse`, `RandomDeckTypes`, `BasicEnergyType`.
- Produces: `randomDeck(body)`, `randomDeckTypes()` endpoints; `useRandomDeckTypes()`, `useRandomDeck()` hooks; store `replaceCards(entries: { cardId: CardId; count: number; card: PlayableCard }[], options: { format: DeckFormat; ownedOnly: boolean }) => void`; `RandomDeckDialog({ open, onClose, format, ownedOnly })`.

- [ ] **Step 1: Endpoints and hooks**

```ts
// endpoints/decks.ts
export const randomDeck = (body: RandomDeckRequest) => post('/decks/random', RandomDeckResponseSchema, body);
export const randomDeckTypes = () => get('/decks/random/types', RandomDeckTypesSchema);
```

`useRandomDeckTypes()`: `useQuery({ queryKey: keys.decks.randomTypes, queryFn, staleTime: 60 * 60_000 })`. `useRandomDeck()`: `useMutation({ mutationFn: (body) => api.call(randomDeck(body)), meta: { toast: false } })` (the dialog reports errors itself). Add `randomTypes: ['decks', 'random-types'] as const` to `keys.decks`.

- [ ] **Step 2: Store action**

In `DeckDraftStore` and its implementation:

```ts
        replaceCards: (entries, { format, ownedOnly }) =>
          set((s) => ({
            draft: { ...s.draft, format, ownedOnly, cards: entries.map(({ cardId, count }) => ({ cardId, count })) },
            cardsById: { ...s.cardsById, ...Object.fromEntries(entries.map((e) => [e.cardId, e.card])) },
            verdict: null,
          })),
```

(`available` is learned by the builder's existing owned-count query for the new ids; do not invent counts.)

- [ ] **Step 3: The dialog**

`random-deck-dialog.tsx`: a `Dialog` titled *Random deck*, description *A legal deck of whole evolution lines, Trainers and basic Energy. It replaces the deck's cards; nothing is saved until you save.* Fields:

- *Format*: a `<select>` of `DECK_FORMATS` with `FORMAT_LABELS`, default the prop;
- *Cards*: two radio buttons *Owned only* / *Any card*, default from `ownedOnly`;
- *Energy*: toggle chips (`aria-pressed`) of `useRandomDeckTypes().data?.[format]` with `energyStyle(type)` icon and label, at most two selected (a third press replaces the oldest); *Surprise me* chip pressed when none is;
- the confirm button *Generate* (`icon={Shuffle}`), busy while the mutation runs.

On confirm: if the draft has cards and the user has not confirmed replacing in this dialog, show inline *Replace the {n} cards in this deck?* with *Replace* / *Keep them* (a second step inside the dialog, not a second dialog). Then `mutateAsync`:
- `deck` → `replaceCards(answer.cards, { format: answer.format, ownedOnly })`, `toastSuccess(\`Random ${answer.types.join(' · ')} deck added — save it to keep it\`)`, close;
- `shortfall` → show `answer.message` in a `role="alert"` paragraph and, when `ownedOnly`, *Use any card instead* (sets *Any card* and generates again);
- error → `toastApiError(error)`, stay open.

- [ ] **Step 4: Header and `?random=1`**

`BuilderHeader` gains `onRandom: () => void` and a `Button variant="secondary" size="sm" icon={Shuffle}` *Random deck* before the *Public* toggle. `DeckBuilder` holds `const [randomOpen, setRandomOpen] = useState(false)` and renders the dialog with the draft's format and mode; `DeckBuilder` / `DeckPage` / the page take `random?: boolean` from `searchParams.random === '1'`, and `Builder` opens the dialog once on arrival, dropping the parameter first with `window.history.replaceState(null, '', \`/decks/${deck.id}\`)` (as `?add=` does).

- [ ] **Step 5: *New deck***

`NewDeckDialog` in `decks-list.tsx`: a `Toggle` *Start with a random deck* (default off) beside the format; created with it on → `router.push(\`/decks/${deck.id}?random=1\`)` (with `addCardId` present, keep `?add=` and ignore the toggle).

- [ ] **Step 6: Gate**

Web typecheck; eslint `apps/web/components/decks apps/web/lib`; prettier.

- [ ] **Step 7: Gallery**

Not needed: the dialog needs the API. Skip.

- [ ] **Step 8: Measure (CDP, the test member)**

- B1 an empty deck → *Random deck* → *Generate* (Surprise me, Any card) → 60 cards in the list, the banner *Legal*, *Unsaved changes*; *Save* → `GET /decks/:id` equals the draft (ids and counts);
- B2 a deck with 23 cards → *Replace the 23 cards in this deck?* → *Replace* → the new deck; the sidebar's *Inventory* → *Leave this deck?*;
- B3 the small member, *Owned only* → the sentence and *Use any card instead* → a deck;
- B4 `/decks` → *New deck* with *Start with a random deck* → the builder with the dialog open; reload → not open;
- B5 375 px: the dialog and the builder `scrollWidth` 375; no console errors.

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -F - <<'EOF'
[PD-137]: add Random deck to the builder and to New deck

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 6: Documentation

**Files:**
- Modify: `docs/API.md` (*Decks*), `docs/DataModel.md` (*Card*), `docs/Pages.md` (*Deck builder*, *Decks*), `apps/api/src/sync/README.md` (if Task 1 left it short)

- [ ] **Step 1: Write**

From what was built and measured: the two routes, the request, the union, generatable types per format (as measured), shortfall codes and sentences, `seed`; `Card.evolvesFrom` and the backfill counts; the dialog, *New deck*'s toggle, and the G1–G5 table and B1–B5 results under a *Measured 2026-10-08 (PD-137)* paragraph.

- [ ] **Step 2: Commit**

```bash
git add docs apps/api/src/sync/README.md
git commit -F - <<'EOF'
[PD-137]: document random decks, evolvesFrom and what they measured

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
