# PD-53 Inventory Read API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /inventory` — the caller's own cards, joined to a slim card projection and the latest price, filtered, sorted six ways and paged by a keyset cursor that survives rows being added or deleted mid-scroll.

**Architecture:** A new `inventory` module. The cursor carries the last row's sort value and id, never a row reference, and "after the cursor" is an `OR` built with Prisma's query builder, including the NULL-price tail. `userId` is its own `AND` element that no filter or cursor branch can widen. Three SQL statements per request regardless of page size; no cache.

**Tech Stack:** NestJS (ESM, `module: nodenext` — every relative import ends in `.js`), Prisma 7.10.0 with `@prisma/adapter-pg`, Zod 4 via `@pokedrop/shared`, PostgreSQL.

**Spec:** [`docs/superpowers/specs/2026-09-27-pd-53-inventory-api-design.md`](../specs/2026-09-27-pd-53-inventory-api-design.md)

## Global Constraints

- **Work directly on `dev`.** No feature branches, no pull requests.
- **Commit subjects are `[PD-53]: short lowercase description`**, no trailing period, 72 characters maximum. Bodies end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **No automated tests in v1.** This overrides the TDD structure the writing-plans skill normally imposes. Every verification step is a measurement against the running stack or a throwaway probe. Do not add test files, test runners, test dependencies, or a CI test step.
- **Minimal code comments.** Only where a tidy-up would break something silently and nothing would catch it. Rationale lives in the spec and in `docs/API.md`.
- **ESM.** Relative imports inside `apps/api` carry the `.js` extension or the build fails.
- **The route is NOT `@Public()`.** The global `SessionGuard` answers 401 without a session.
- **`userId` comes from `@CurrentUser()` only.** No query, path or body parameter names a user.
- **`Decimal` becomes `number` at the boundary**, through the shared `toNumber` Task 2 creates.
- **Every commit compiles.** `pnpm typecheck`, `pnpm lint` and `pnpm format:check` pass from the repository root before each one.
- **Verified claims only.** If a measurement contradicts the spec, report the contradiction rather than adjusting the claim to fit.
- **The probe is never committed.** `apps/api/probe-pd53.mjs` is created in Task 4 and deleted at its end.

## Review Focus

Five inputs the spec implies but does not spell out, each pinned by a check in the task that owns the code.

1. **A cursor that decodes but carries a value of the wrong kind** — `v: "yesterday"` under `acquired_desc`, `v: "abc"` under `price_desc`, `v: null` under `name_asc`. Unchecked, the first becomes `new Date("yesterday")` → `Invalid Date` and the second a Prisma Decimal parse error, both a 500. Expected: 400 `Invalid cursor`. *Task 3, Step 7.*
2. **`minQuantity` beyond a PostgreSQL `integer`** — `?minQuantity=99999999999`. Coerced to a JS number, it reaches Prisma as an out-of-range `Int` and fails at the driver. Expected: 400 from the Zod pipe. *Task 1 caps it at 2 147 483 647; Task 3, Step 7 measures it.*
3. **A cursor built around another user's item id** — the id is valid, the row exists, it is not the caller's. Expected: the caller's own rows only, positioned by the cursor's value. *Task 4, check 5.*
4. **A price sort where the cursor lands in the NULL tail** — on real data almost every row is unpriced, so the second and later pages of `price_asc` are entirely the `v: null` branch. Expected: the walk still covers every row once. *Task 4, check 3.*
5. **Ties on every sort key** — shared names, a shared `acquiredAt`, a shared price. Without the `id` tiebreak in both `orderBy` and the cursor predicate, a page boundary inside a tie repeats or drops rows. Expected: no repeats, no gaps. *Task 4, check 3, on data seeded to contain all three.*

### Shared shell setup

```bash
cd /m/projects/pokedrop
SCRATCH="$(mktemp -d)"
PSQL="docker compose exec -T postgres psql -U pokedrop -d pokedrop -At"
API="http://localhost:4000/api/v1"
AUTH="http://localhost:4000/api/auth"
WEB="http://localhost:3000"
```

`docker compose ps` must show postgres and redis healthy.

**Start the API from `dist`, not from watch mode**, so a restart is deliberate and the log is a file:

```bash
pnpm --filter @pokedrop/api build
pkill -f 'node apps/api/dist/main.js'
node apps/api/dist/main.js > "$SCRATCH/api.log" 2>&1 &
sleep 8
curl -s -o /dev/null -w 'ready: %{http_code}\n' "$API/health/ready"
```

Expected: `ready: 200`.

**Do not run the worker (`apps/api/dist/worker.js`) while probe data exists.** PD-50's active refresh selects cards someone owns; a probe user owning 5 000 cards would spend the day's provider budget on them. The schedulers are registered in the worker only, so the API process alone is safe. Check with `pgrep -f worker.js` — expected: no output.

### Live values these steps assert against

Measured 2026-09-27. Re-measure if a step disagrees rather than editing the expectation.

- `cards`: **20 670** rows; `latestPriceUsd` set on **16**, `latestPriceEur` on **8**
- `inventory_items`: **7** rows; `seed-ash` owns **3** (`base1-4` qty 2 locked 1, `base1-58` qty 5, `base1-46` qty 3)
- Prisma 7.10 loads a nested `select` as a second batched `SELECT … WHERE id IN (…)`: `findMany` with a nested card select is **2** statements, so a request is **3** with the count

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/shared/src/primitives/pagination.ts` | **edit** — `cursorPageOf`, `CursorPage<T>` |
| `packages/shared/src/entities/inventory.ts` | **edit** — sort, query, slim card, entry and page contracts |
| `apps/api/src/common/decimal.ts` | **new** — `toNumber`, lifted from catalog and prices |
| `apps/api/src/catalog/catalog.service.ts` | **edit** — import `toNumber` |
| `apps/api/src/prices/prices.service.ts` | **edit** — import `toNumber`, drop the local copy and its rationale comment |
| `apps/api/src/inventory/inventory.cursor.ts` | **new** — sort table, cursor encode/decode/validation |
| `apps/api/src/inventory/inventory.service.ts` | **new** — filters, order, keyset predicate, mapping |
| `apps/api/src/inventory/inventory.dto.ts` | **new** — `InventoryQueryDto` |
| `apps/api/src/inventory/inventory.controller.ts` | **new** — `GET /inventory` |
| `apps/api/src/inventory/inventory.module.ts`, `index.ts` | **new** — wiring, public surface |
| `apps/api/src/app.module.ts` | **edit** — import `InventoryModule` |
| `docs/API.md` | **edit** — pagination convention, Inventory section |
| `docs/DataModel.md` | **edit only if Task 4 adds an index** |

### Task order

1 → 2 → 3 → 4 → 5, strictly. Task 3 imports Task 1's contracts and Task 2's `toNumber`; Task 4 measures Task 3; Task 5 documents what Task 4 measured.

---

## Task 1: The contracts

**Files:**
- Modify: `packages/shared/src/primitives/pagination.ts`
- Modify: `packages/shared/src/entities/inventory.ts`

**Interfaces:**
- Produces, all exported from `@pokedrop/shared`:
  - `cursorPageOf<T extends z.ZodType>(item: T)`, `CursorPage<T>`
  - `INVENTORY_SORTS` (readonly tuple of the six sort names), `InventorySortSchema`, `InventorySort`
  - `InventoryQuerySchema`, `InventoryQuery` (output type: `sort` and `pageSize` always present)
  - `InventoryCardSchema`, `InventoryCard`
  - `InventoryEntrySchema`, `InventoryEntry`
  - `InventoryPageSchema`, `InventoryPage`

- [ ] **Step 1: Add the cursor page wrapper**

Append to `packages/shared/src/primitives/pagination.ts`:

```ts
export const cursorPageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
    nextCursor: z.string().nullable(),
  });

export type CursorPage<T> = {
  items: T[];
  pageSize: number;
  total: number;
  nextCursor: string | null;
};
```

- [ ] **Step 2: Add the inventory contracts**

In `packages/shared/src/entities/inventory.ts`, replace the import block with:

```ts
import { z } from 'zod';
import { CardSchema } from './card.js';
import { CardSearchQuerySchema } from './catalog.js';
import { CardIdSchema, InventoryItemIdSchema, UserIdSchema } from '../primitives/id.js';
import { PaginationQuerySchema, cursorPageOf } from '../primitives/pagination.js';
```

Leave `InventoryItemSchema` and `InventorySummarySchema` as they are, and append:

```ts
export const INVENTORY_SORTS = [
  'acquired_desc',
  'acquired_asc',
  'name_asc',
  'name_desc',
  'price_desc',
  'price_asc',
] as const;

export const InventorySortSchema = z.enum(INVENTORY_SORTS).default('acquired_desc');
export type InventorySort = z.infer<typeof InventorySortSchema>;

export const InventoryQuerySchema = CardSearchQuerySchema.pick({
  q: true,
  set: true,
  rarity: true,
  type: true,
}).extend({
  cursor: z.string().min(1).max(512).optional(),
  pageSize: PaginationQuerySchema.shape.pageSize,
  // The ceiling is PostgreSQL's integer: past it the driver fails, not the pipe.
  minQuantity: z.coerce.number().int().min(1).max(2_147_483_647).optional(),
  sort: InventorySortSchema,
});
export type InventoryQuery = z.infer<typeof InventoryQuerySchema>;

export const InventoryCardSchema = CardSchema.pick({
  id: true,
  setId: true,
  name: true,
  supertype: true,
  subtypes: true,
  types: true,
  hp: true,
  rarity: true,
  imageSmall: true,
  latestPriceUsd: true,
  latestPriceEur: true,
  priceUpdatedAt: true,
});
export type InventoryCard = z.infer<typeof InventoryCardSchema>;

export const InventoryEntrySchema = InventoryItemSchema.omit({ userId: true }).extend({
  card: InventoryCardSchema,
});
export type InventoryEntry = z.infer<typeof InventoryEntrySchema>;

export const InventoryPageSchema = cursorPageOf(InventoryEntrySchema);
export type InventoryPage = z.infer<typeof InventoryPageSchema>;
```

`CardIdSchema`, `InventoryItemIdSchema` and `UserIdSchema` stay imported: `InventoryItemSchema` above still uses them.

- [ ] **Step 3: Build and check the contracts**

```bash
pnpm build:shared && pnpm typecheck
node --input-type=module -e "
import { InventoryQuerySchema, InventoryPageSchema } from './packages/shared/dist/index.js';
console.log(JSON.stringify(InventoryQuerySchema.parse({})));
console.log(JSON.stringify(InventoryQuerySchema.parse({ minQuantity: '2', sort: 'price_asc', pageSize: '100', page: '3' })));
console.log(InventoryQuerySchema.safeParse({ minQuantity: '99999999999' }).success);
console.log(InventoryQuerySchema.safeParse({ sort: 'rarity_desc' }).success);
console.log(InventoryPageSchema.safeParse({ items: [], pageSize: 24, total: 0, nextCursor: null }).success);
"
```

Expected, in order:
- `{"pageSize":24,"sort":"acquired_desc"}`
- `{"pageSize":100,"minQuantity":2,"sort":"price_asc"}` — `page` is stripped, not rejected, as in the catalog
- `false`
- `false`
- `true`

- [ ] **Step 4: Commit**

```bash
pnpm lint && pnpm format:check
git add packages/shared/src/primitives/pagination.ts packages/shared/src/entities/inventory.ts
git commit -m "[PD-53]: add the inventory query and cursor page contracts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Lift `toNumber` into `common/`

**Files:**
- Create: `apps/api/src/common/decimal.ts`
- Modify: `apps/api/src/catalog/catalog.service.ts` (the `toNumber` block and its comment, lines ~20–33)
- Modify: `apps/api/src/prices/prices.service.ts` (the `toNumber` block and its comment, lines ~13–25)

**Interfaces:**
- Produces: `toNumber(value: unknown): number | null` from `apps/api/src/common/decimal.js`. Task 3 imports it.

This reverses PD-51's recorded choice to keep a second copy; the spec's "Decimal at the boundary" records why and that the owner confirmed it.

- [ ] **Step 1: Create the shared helper**

Create `apps/api/src/common/decimal.ts`:

```ts
/**
 * Prisma returns `Decimal` for price columns and JSON.stringify turns one into a
 * string, which then fails every response schema that promises a number.
 * Decimal(10,2) fits a JS number exactly, so the conversion is lossless.
 */
export function toNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
```

- [ ] **Step 2: Use it in the catalog**

In `apps/api/src/catalog/catalog.service.ts`, delete the local `function toNumber` and the comment block directly above it, and add to the imports:

```ts
import { toNumber } from '../common/decimal.js';
```

- [ ] **Step 3: Use it in prices**

In `apps/api/src/prices/prices.service.ts`, delete the local `function toNumber` and the comment block directly above it (the one ending "three lines are worth less than the module boundary."), and add to the imports:

```ts
import { toNumber } from '../common/decimal.js';
```

- [ ] **Step 4: Verify nothing changed on the wire**

```bash
pnpm typecheck
```

Start the API (see "Shared shell setup"), then:

```bash
curl -s "$API/cards/base1-4" | grep -o '"latestPriceUsd":[^,]*'
curl -s "$API/cards/base1-4/price"
```

Expected: `latestPriceUsd` is a bare number or `null` — never a quoted string — in both responses. Record which it is for `base1-4`.

- [ ] **Step 5: Commit**

```bash
pnpm lint && pnpm format:check
git add apps/api/src/common/decimal.ts apps/api/src/catalog/catalog.service.ts apps/api/src/prices/prices.service.ts
git commit -m "[PD-53]: share one decimal-to-number helper across modules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: The inventory module and `GET /inventory`

**Files:**
- Create: `apps/api/src/inventory/inventory.cursor.ts`
- Create: `apps/api/src/inventory/inventory.service.ts`
- Create: `apps/api/src/inventory/inventory.dto.ts`
- Create: `apps/api/src/inventory/inventory.controller.ts`
- Create: `apps/api/src/inventory/inventory.module.ts`
- Create: `apps/api/src/inventory/index.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `INVENTORY_SORTS`, `InventorySort`, `InventoryQuery`, `InventoryQuerySchema`, `InventoryPage`, `InventoryPageSchema` (Task 1); `toNumber` (Task 2); `PrismaService` from `../prisma/index.js`; `CurrentUser` and `AuthUser`.
- Produces:
  - `SortKey = 'acquiredAt' | 'name' | 'price'`, `SortSpec = { key: SortKey; dir: 'asc' | 'desc' }`, `SORTS: Record<InventorySort, SortSpec>`
  - `InventoryCursor = { v: string | null; id: string }`
  - `encodeCursor(sort: InventorySort, v: string | null, id: string): string`
  - `decodeCursor(raw: string, sort: InventorySort): InventoryCursor` — throws `BadRequestException('Invalid cursor')`
  - `InventoryService.list(userId: string, query: InventoryQuery): Promise<InventoryPage>` — PD-54 and PD-55 add methods to this service
  - `InventoryModule` registered in `AppModule`; `InventoryController` at `@Controller('inventory')`, so PD-54's `@Get('summary')` lands beside it

- [ ] **Step 1: The cursor**

Create `apps/api/src/inventory/inventory.cursor.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { INVENTORY_SORTS, type InventorySort } from '@pokedrop/shared';
import { z } from 'zod';

export type SortKey = 'acquiredAt' | 'name' | 'price';
export type SortSpec = { key: SortKey; dir: 'asc' | 'desc' };

export const SORTS: Record<InventorySort, SortSpec> = {
  acquired_desc: { key: 'acquiredAt', dir: 'desc' },
  acquired_asc: { key: 'acquiredAt', dir: 'asc' },
  name_asc: { key: 'name', dir: 'asc' },
  name_desc: { key: 'name', dir: 'desc' },
  price_desc: { key: 'price', dir: 'desc' },
  price_asc: { key: 'price', dir: 'asc' },
};

export type InventoryCursor = { v: string | null; id: string };

const PayloadSchema = z.object({
  s: z.enum(INVENTORY_SORTS),
  v: z.string().max(256).nullable(),
  id: z.string().min(1).max(64),
});

// A value of the wrong kind would reach Prisma as an Invalid Date or an
// unparseable Decimal and surface as a 500, not a 400.
const VALUE_RULES: Record<SortKey, z.ZodType<string | null>> = {
  acquiredAt: z.iso.datetime(),
  name: z.string().min(1),
  price: z
    .string()
    .regex(/^\d{1,8}\.\d{2}$/)
    .nullable(),
};

export function encodeCursor(sort: InventorySort, v: string | null, id: string): string {
  return Buffer.from(JSON.stringify({ s: sort, v, id }), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string, sort: InventorySort): InventoryCursor {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }

  const payload = PayloadSchema.safeParse(json);
  if (!payload.success || payload.data.s !== sort) {
    throw invalidCursor();
  }

  if (!VALUE_RULES[SORTS[sort].key].safeParse(payload.data.v).success) {
    throw invalidCursor();
  }

  return { v: payload.data.v, id: payload.data.id };
}

function invalidCursor(): BadRequestException {
  return new BadRequestException('Invalid cursor');
}
```

- [ ] **Step 2: The service**

Create `apps/api/src/inventory/inventory.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { InventoryPageSchema, type InventoryPage, type InventoryQuery } from '@pokedrop/shared';
import { toNumber } from '../common/decimal.js';
import { PrismaService } from '../prisma/index.js';
import {
  SORTS,
  decodeCursor,
  encodeCursor,
  type InventoryCursor,
  type SortKey,
  type SortSpec,
} from './inventory.cursor.js';

const ENTRY_SELECT = {
  id: true,
  cardId: true,
  quantity: true,
  lockedQuantity: true,
  acquiredAt: true,
  card: {
    select: {
      id: true,
      setId: true,
      name: true,
      supertype: true,
      subtypes: true,
      types: true,
      hp: true,
      rarity: true,
      imageSmall: true,
      latestPriceUsd: true,
      latestPriceEur: true,
      priceUpdatedAt: true,
    },
  },
} satisfies Prisma.InventoryItemSelect;

type EntryRow = Prisma.InventoryItemGetPayload<{ select: typeof ENTRY_SELECT }>;

type KeyFilter = { lt?: string | Date; gt?: string | Date; equals?: string | Date } | null;

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: InventoryQuery): Promise<InventoryPage> {
    const spec = SORTS[query.sort];
    const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor, query.sort);

    // userId stays its own AND element so no filter or cursor branch can widen it.
    const scope: Prisma.InventoryItemWhereInput[] = [{ userId }, ...filterClauses(query)];
    const page: Prisma.InventoryItemWhereInput[] =
      cursor === null ? scope : [...scope, afterCursor(spec, cursor)];

    const [rows, total] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where: { AND: page },
        orderBy: orderBy(spec),
        take: query.pageSize + 1,
        select: ENTRY_SELECT,
      }),
      this.prisma.inventoryItem.count({ where: { AND: scope } }),
    ]);

    const items = rows.slice(0, query.pageSize);
    const last = items.at(-1);
    const nextCursor =
      rows.length > query.pageSize && last !== undefined
        ? encodeCursor(query.sort, sortValue(spec.key, last), last.id)
        : null;

    return InventoryPageSchema.parse({
      items: items.map(toEntry),
      pageSize: query.pageSize,
      total,
      nextCursor,
    });
  }
}

function filterClauses(query: InventoryQuery): Prisma.InventoryItemWhereInput[] {
  const card: Prisma.CardWhereInput = {
    ...(query.set === undefined ? {} : { setId: query.set }),
    ...(query.rarity === undefined ? {} : { rarity: query.rarity }),
    ...(query.type === undefined ? {} : { types: { has: query.type } }),
    ...(query.q === undefined ? {} : { name: { contains: query.q, mode: 'insensitive' } }),
  };

  const clauses: Prisma.InventoryItemWhereInput[] = [];
  if (Object.keys(card).length > 0) {
    clauses.push({ card: { is: card } });
  }
  if (query.minQuantity !== undefined) {
    clauses.push({ quantity: { gte: query.minQuantity } });
  }
  return clauses;
}

function orderBy(spec: SortSpec): Prisma.InventoryItemOrderByWithRelationInput[] {
  switch (spec.key) {
    case 'acquiredAt':
      return [{ acquiredAt: spec.dir }, { id: spec.dir }];
    case 'name':
      return [{ card: { name: spec.dir } }, { id: spec.dir }];
    case 'price':
      return [
        { card: { latestPriceUsd: { sort: spec.dir, nulls: 'last' } } },
        { id: spec.dir },
      ];
  }
}

function onKey(key: SortKey, filter: KeyFilter): Prisma.InventoryItemWhereInput {
  switch (key) {
    case 'acquiredAt':
      return { acquiredAt: filter as Prisma.DateTimeFilter };
    case 'name':
      return { card: { is: { name: filter as Prisma.StringFilter } } };
    case 'price':
      return { card: { is: { latestPriceUsd: filter as Prisma.DecimalNullableFilter | null } } };
  }
}

// Unpriced rows sort last in both directions, so the NULL tail follows every
// priced value whichever way "beyond" points.
function afterCursor(spec: SortSpec, cursor: InventoryCursor): Prisma.InventoryItemWhereInput {
  const beyond = <T>(value: T) => (spec.dir === 'asc' ? { gt: value } : { lt: value });
  const idBeyond: Prisma.InventoryItemWhereInput = { id: beyond(cursor.id) };

  if (cursor.v === null) {
    return { AND: [onKey(spec.key, null), idBeyond] };
  }

  const value = spec.key === 'acquiredAt' ? new Date(cursor.v) : cursor.v;
  const branches: Prisma.InventoryItemWhereInput[] = [
    onKey(spec.key, beyond(value)),
    { AND: [onKey(spec.key, { equals: value }), idBeyond] },
  ];
  if (spec.key === 'price') {
    branches.push(onKey('price', null));
  }
  return { OR: branches };
}

function sortValue(key: SortKey, row: EntryRow): string | null {
  switch (key) {
    case 'acquiredAt':
      return row.acquiredAt.toISOString();
    case 'name':
      return row.card.name;
    case 'price':
      return row.card.latestPriceUsd === null ? null : row.card.latestPriceUsd.toFixed(2);
  }
}

function toEntry(row: EntryRow): unknown {
  return {
    id: row.id,
    cardId: row.cardId,
    quantity: row.quantity,
    lockedQuantity: row.lockedQuantity,
    availableQuantity: row.quantity - row.lockedQuantity,
    acquiredAt: row.acquiredAt,
    card: {
      ...row.card,
      latestPriceUsd: toNumber(row.card.latestPriceUsd),
      latestPriceEur: toNumber(row.card.latestPriceEur),
    },
  };
}
```

- [ ] **Step 3: DTO, controller, module, index**

Create `apps/api/src/inventory/inventory.dto.ts`:

```ts
import { InventoryQuerySchema } from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

export class InventoryQueryDto extends createZodDto('InventoryQuery', InventoryQuerySchema) {}
```

Create `apps/api/src/inventory/inventory.controller.ts`:

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { InventoryPage } from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { InventoryQueryDto } from './inventory.dto.js';
import { InventoryService } from './inventory.service.js';

@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: InventoryQueryDto): Promise<InventoryPage> {
    return this.inventory.list(user.id, query);
  }
}
```

Create `apps/api/src/inventory/inventory.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
```

Create `apps/api/src/inventory/index.ts`:

```ts
export { InventoryModule } from './inventory.module.js';
export { InventoryService } from './inventory.service.js';
```

- [ ] **Step 4: Register the module**

In `apps/api/src/app.module.ts`, add beside the other feature imports:

```ts
import { InventoryModule } from './inventory/index.js';
```

and add `InventoryModule,` to the `imports` array directly after `PricesModule,`.

- [ ] **Step 5: Build and boot**

```bash
pnpm typecheck && pnpm lint
```

Start the API (see "Shared shell setup"). Expected: `ready: 200`, and `grep -i error "$SCRATCH/api.log"` prints nothing.

- [ ] **Step 6: Two probe users with sessions**

`seed-ash` has no known password. Create probe user A, mark it verified, sign in. `requireEmailVerification` is on, so sign-up alone does not yield a usable session.

```bash
$PSQL -c "delete from users where email like 'pd53-%';"
for who in a b; do
  curl -s -o /dev/null -X POST "$AUTH/sign-up/email" -H 'Content-Type: application/json' -H "Origin: $WEB" \
    -d "{\"email\":\"pd53-$who@example.com\",\"password\":\"correct-horse-battery\",\"name\":\"PD53 $who\"}"
done
$PSQL -c "update users set \"emailVerified\" = true where email like 'pd53-%';"
for who in a b; do
  curl -s -o /dev/null -w "sign-in $who: %{http_code}\n" -c "$SCRATCH/jar-$who.txt" -X POST "$AUTH/sign-in/email" \
    -H 'Content-Type: application/json' -H "Origin: $WEB" \
    -d "{\"email\":\"pd53-$who@example.com\",\"password\":\"correct-horse-battery\"}"
done
A=$($PSQL -c "select id from users where email = 'pd53-a@example.com';")
B=$($PSQL -c "select id from users where email = 'pd53-b@example.com';")
echo "A=$A B=$B"
```

Expected: `sign-in a: 200`, `sign-in b: 200`, two non-empty ids. These users are the auth rate limit's 4 of 10 per 15 minutes; do not loop this step.

Give A three rows mirroring `seed-ash`'s, so the first reads have something to show:

```bash
$PSQL -c "insert into inventory_items (id, \"userId\", \"cardId\", quantity, \"lockedQuantity\") values
  ('pd53-s-1', '$A', 'base1-4', 2, 1), ('pd53-s-2', '$A', 'base1-58', 5, 0), ('pd53-s-3', '$A', 'base1-46', 3, 0);"
```

- [ ] **Step 7: First measurements over HTTP**

```bash
curl -s -o /dev/null -w 'no session: %{http_code}\n' "$API/inventory"
curl -s -b "$SCRATCH/jar-a.txt" "$API/inventory" | head -c 700; echo
curl -s -b "$SCRATCH/jar-a.txt" "$API/inventory?pageSize=2&sort=name_asc" | grep -o '"nextCursor":"[^"]*"'
curl -s -b "$SCRATCH/jar-b.txt" "$API/inventory" ; echo

bad() { curl -s -o /dev/null -w "$1: %{http_code}\n" -b "$SCRATCH/jar-a.txt" "$API/inventory?$2"; }
cur() { printf '%s' "$1" | base64 -w0 | tr '+/' '-_' | tr -d '='; }
NAME_CURSOR=$(curl -s -b "$SCRATCH/jar-a.txt" "$API/inventory?pageSize=1&sort=name_asc" | grep -o '"nextCursor":"[^"]*"' | cut -d'"' -f4)
bad 'garbage cursor'           "cursor=not-a-cursor"
bad 'cursor from another sort' "sort=price_desc&cursor=$NAME_CURSOR"
bad 'date that is not a date'  "sort=acquired_desc&cursor=$(cur '{"s":"acquired_desc","v":"yesterday","id":"x"}')"
bad 'price that is not a price' "sort=price_desc&cursor=$(cur '{"s":"price_desc","v":"abc","id":"x"}')"
bad 'null name'                "sort=name_asc&cursor=$(cur '{"s":"name_asc","v":null,"id":"x"}')"
bad 'minQuantity past int4'    "minQuantity=99999999999"
bad 'pageSize 101'             "pageSize=101"
bad 'unknown sort'             "sort=rarity_desc"
```

Expected:
- `no session: 401`
- A's body: `total` 3, three items, `nextCursor` `null`, each `card.latestPriceUsd` a number or `null`, `availableQuantity` 1 for `base1-4`, `acquiredAt` descending
- the `pageSize=2` request prints a `nextCursor`
- B's body: `{"items":[],"pageSize":24,"total":0,"nextCursor":null}`
- every `bad` line: `400`

- [ ] **Step 8: Commit**

```bash
pnpm format:check
git add apps/api/src/inventory apps/api/src/app.module.ts
git commit -m "[PD-53]: serve the caller's inventory behind a keyset cursor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: The 5 000-row probe

**Files:**
- Create (never committed, deleted in Step 7): `apps/api/probe-pd53.mjs`
- Modify only if check 1 fails: `apps/api/prisma/schema.prisma`, a new migration, `docs/DataModel.md`

**Interfaces:**
- Consumes: `InventoryService` from `apps/api/dist/inventory/inventory.service.js`, `InventoryQuerySchema` from `@pokedrop/shared`; `$A` and `$B` from Task 3, Step 6.
- Produces: the numbers Task 5 records.

The keyset walk issues ~4 300 service calls; over HTTP that would take an hour against the 100-per-minute default throttle. The probe calls the built service directly with its own logging `PrismaClient`, which is also the only way to count statements per call without auth queries mixed in.

- [ ] **Step 1: Seed 5 000 rows for A**

Every priced card first, then the rest by name, so the set contains shared names; 50 rows share each `acquiredAt` minute; quantities 1–5; every tenth row has one copy locked.

```bash
$PSQL -c "delete from inventory_items where \"userId\" = '$A';"
$PSQL -c "
insert into inventory_items (id, \"userId\", \"cardId\", quantity, \"lockedQuantity\", \"acquiredAt\")
select 'pd53-a-' || n, '$A', id, 1 + (n % 5), case when n % 10 = 0 then 1 else 0 end,
       timestamp '2026-09-01 00:00:00' + (n / 50) * interval '1 minute'
from (select id, row_number() over (order by (\"latestPriceUsd\" is null), name, id) as n
      from cards order by (\"latestPriceUsd\" is null), name, id limit 5000) c;"
$PSQL -c "insert into inventory_items (id, \"userId\", \"cardId\", quantity) values
  ('pd53-b-1', '$B', 'base1-4', 1), ('pd53-b-2', '$B', 'base1-2', 1), ('pd53-b-3', '$B', 'base2-10', 3);"
$PSQL -c "select count(*), count(distinct c.name), count(c.\"latestPriceUsd\") from inventory_items i join cards c on c.id = i.\"cardId\" where i.\"userId\" = '$A';"
```

Expected: `5000|<fewer than 5000>|16`.

- [ ] **Step 2: Create equal-price ties, recording what to restore**

Rows 17–36 hold cards that are unpriced today. Give ten of them `1.00` and ten `2.50`.

```bash
TIE_IDS=$($PSQL -c "select string_agg(quote_literal(\"cardId\"), ',') from inventory_items where id in (select 'pd53-a-' || g from generate_series(17, 36) g);")
echo "$TIE_IDS" > "$SCRATCH/tie-ids.txt"
$PSQL -c "select count(*) from cards where id in ($TIE_IDS) and \"latestPriceUsd\" is not null;"
$PSQL -c "update cards set \"latestPriceUsd\" = 1.00 where id in (select \"cardId\" from inventory_items where id in (select 'pd53-a-' || g from generate_series(17, 26) g));"
$PSQL -c "update cards set \"latestPriceUsd\" = 2.50 where id in (select \"cardId\" from inventory_items where id in (select 'pd53-a-' || g from generate_series(27, 36) g));"
```

Expected: the count is `0` before the updates, so restoring to NULL is exact.

- [ ] **Step 3: Write the probe**

Create `apps/api/probe-pd53.mjs`:

```js
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { InventoryQuerySchema } from '@pokedrop/shared';
import { InventoryService } from './dist/inventory/inventory.service.js';

const [userA, userB] = process.argv.slice(2);
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  log: [{ emit: 'event', level: 'query' }],
});
const statements = [];
prisma.$on('query', (e) => statements.push(e.query));
const service = new InventoryService(prisma);
const q = (params) => InventoryQuerySchema.parse(params);

const SORTS = ['acquired_desc', 'acquired_asc', 'name_asc', 'name_desc', 'price_desc', 'price_asc'];
const REF = {
  acquired_desc: [{ acquiredAt: 'desc' }, { id: 'desc' }],
  acquired_asc: [{ acquiredAt: 'asc' }, { id: 'asc' }],
  name_asc: [{ card: { name: 'asc' } }, { id: 'asc' }],
  name_desc: [{ card: { name: 'desc' } }, { id: 'desc' }],
  price_desc: [{ card: { latestPriceUsd: { sort: 'desc', nulls: 'last' } } }, { id: 'desc' }],
  price_asc: [{ card: { latestPriceUsd: { sort: 'asc', nulls: 'last' } } }, { id: 'asc' }],
};

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const refIds = async (user, sort) =>
  (await prisma.inventoryItem.findMany({ where: { userId: user }, orderBy: REF[sort], select: { id: true } })).map((r) => r.id);

// 1. budget
const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const time = async (params) => {
  const runs = [];
  for (let i = 0; i < 5; i += 1) {
    const start = performance.now();
    await service.list(userA, q(params));
    runs.push(performance.now() - start);
  }
  return median(runs);
};
for (const sort of SORTS) {
  for (const filters of [{}, { q: 'a', minQuantity: 2 }]) {
    let cursor;
    for (let i = 0; i < 40; i += 1) {
      const page = await service.list(userA, q({ pageSize: 100, sort, ...filters, ...(cursor ? { cursor } : {}) }));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    const first = await time({ pageSize: 100, sort, ...filters });
    const deep = await time({ pageSize: 100, sort, ...filters, ...(cursor ? { cursor } : {}) });
    const label = `budget ${sort} ${Object.keys(filters).length > 0 ? 'filtered' : 'unfiltered'}`;
    check(label, first <= 100 && deep <= 100, `first ${first.toFixed(1)} ms, deep ${deep.toFixed(1)} ms`);
  }
}

// 2. statement count
for (const pageSize of [1, 24, 100]) {
  statements.length = 0;
  await service.list(userA, q({ pageSize, sort: 'price_desc' }));
  check(`statements at pageSize ${pageSize}`, statements.length === 3, String(statements.length));
}

// 3. keyset walk
for (const sort of SORTS) {
  const ids = [];
  const prices = [];
  let cursor;
  let total = -1;
  do {
    const page = await service.list(userA, q({ pageSize: 7, sort, ...(cursor ? { cursor } : {}) }));
    total = page.total;
    ids.push(...page.items.map((item) => item.id));
    prices.push(...page.items.map((item) => item.card.latestPriceUsd));
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  const ref = await refIds(userA, sort);
  check(`walk ${sort}: covers total`, ids.length === total && total === 5000, `${ids.length} of ${total}`);
  check(`walk ${sort}: no repeats`, new Set(ids).size === ids.length);
  check(`walk ${sort}: database order`, ids.length === ref.length && ids.every((id, i) => id === ref[i]));
  if (sort.startsWith('price')) {
    const firstNull = prices.indexOf(null);
    check(`walk ${sort}: unpriced last`, firstNull === -1 || prices.slice(firstNull).every((p) => p === null), `first null at ${firstNull}`);
  }
}
statements.length = 0;

// 4. the cursor row is deleted between two pages
{
  const ref = await refIds(userA, 'name_asc');
  const first = await service.list(userA, q({ pageSize: 7, sort: 'name_asc' }));
  await prisma.inventoryItem.delete({ where: { id: first.items.at(-1).id } });
  const second = await service.list(userA, q({ pageSize: 7, sort: 'name_asc', cursor: first.nextCursor }));
  const got = second.items.map((item) => item.id);
  check('cursor row deleted: next page continues', got.every((id, i) => id === ref[7 + i]) && got.length === 7);
}

// 5. isolation
{
  const aIds = new Set(await refIds(userA, 'acquired_desc'));
  const bIds = new Set(await refIds(userB, 'acquired_desc'));
  const page = await service.list(userB, q({ pageSize: 100 }));
  check('B sees only B', page.total === bIds.size && page.items.every((item) => bIds.has(item.id) && !aIds.has(item.id)), `total ${page.total}`);
  const forged = Buffer.from(JSON.stringify({ s: 'acquired_desc', v: '2099-01-01T00:00:00.000Z', id: [...aIds][0] })).toString('base64url');
  const forgedPage = await service.list(userB, q({ pageSize: 100, cursor: forged }));
  check('forged cursor around A\'s id yields only B', forgedPage.items.every((item) => bIds.has(item.id)), `${forgedPage.items.length} items`);
}

await prisma.$disconnect();
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 4: Run it**

```bash
pnpm --filter @pokedrop/api build
(cd apps/api && DATABASE_URL="postgresql://pokedrop:pokedrop_local_dev@localhost:5433/pokedrop" node probe-pd53.mjs "$A" "$B") | tee "$SCRATCH/probe.txt"
```

Expected: every line `PASS`, ending `ALL PASS`. Keep `$SCRATCH/probe.txt`; Task 5 quotes its budget lines.

**If a `budget` line fails**, stop and do not change the query. Add the index the spec names:

```prisma
  @@index([userId, acquiredAt])
```

to `model InventoryItem` in `apps/api/prisma/schema.prisma`, then:

```bash
(cd apps/api && pnpm exec prisma migrate dev --name inventory_user_acquired_index)
```

re-seed from Step 1 (the delete in Step 4 of the probe removed one row), re-run, and record both runs. If the failing sort is a name or price sort, an index on `inventory_items` cannot serve it: report the numbers and stop for a decision rather than adding one.

- [ ] **Step 5: End-to-end timing over HTTP**

A's first page at `pageSize=100` for each sort, once each — six requests, within the throttle:

```bash
for s in acquired_desc acquired_asc name_asc name_desc price_desc price_asc; do
  curl -s -o /dev/null -w "$s: %{http_code} %{time_total}s\n" -b "$SCRATCH/jar-a.txt" "$API/inventory?pageSize=100&sort=$s"
done
```

Expected: six `200`s. Record the times; they include session resolution and are for the docs, not for the budget.

- [ ] **Step 6: EXPLAIN the slowest sort**

Take the sort with the highest `first` time from `$SCRATCH/probe.txt`. The statement Prisma sends for its first page has this shape; run the equivalent by hand, substituting that sort's `ORDER BY`:

```bash
$PSQL -c "EXPLAIN ANALYZE
SELECT i.id, i.\"cardId\", i.quantity, i.\"lockedQuantity\", i.\"acquiredAt\"
FROM inventory_items i LEFT JOIN cards c ON c.id = i.\"cardId\"
WHERE i.\"userId\" = '$A'
ORDER BY c.\"latestPriceUsd\" DESC NULLS LAST, i.id DESC
LIMIT 101;"
```

Record the plan's node types and `Execution Time` for Task 5.

- [ ] **Step 7: Clean up**

Restore prices **before** deleting inventory rows — the restore keys on the recorded card ids, not on the rows:

```bash
$PSQL -c "update cards set \"latestPriceUsd\" = null where id in ($(cat "$SCRATCH/tie-ids.txt"));"
$PSQL -c "select count(*) from cards where \"latestPriceUsd\" is not null;"
$PSQL -c "delete from users where email like 'pd53-%';"
$PSQL -c "select count(*) from inventory_items;"
rm apps/api/probe-pd53.mjs
git status --short
```

Expected: `16` priced cards again; `7` inventory rows (the users' cascade removed the probe rows); `git status` shows nothing from this task unless an index was added.

- [ ] **Step 8: Commit, only if an index was added**

```bash
pnpm typecheck && pnpm lint && pnpm format:check
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "[PD-53]: index inventory by owner and acquisition time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Documentation

**Files:**
- Modify: `docs/API.md` — the Pagination convention (line ~9) and the `## Inventory` section
- Modify: `docs/DataModel.md` — only if Task 4 added an index

**Interfaces:**
- Consumes: `$SCRATCH/probe.txt`, the Step 5 times and the Step 6 plan from Task 4.

- [ ] **Step 1: The pagination convention**

In `docs/API.md`, replace

```
- **Pagination:** all list endpoints take `page`, `pageSize` (cursor optional). Validate bounds.
```

with

```
- **Pagination:** list endpoints take `pageSize` and either `page` (offset, `pageOf`) or `cursor` (keyset, `cursorPageOf`). A list whose rows change while a user scrolls it — inventory — uses the cursor; the catalog uses pages. Validate bounds.
```

- [ ] **Step 2: The Inventory section**

Replace the `/inventory` table row's note `Owned cards + quantities + aggregates` with `Owned cards, filtered, sorted, keyset-paged`, and add below the table:

- the query parameters and their bounds, copied from the spec's query table;
- the response shape, with the one-row example from the spec;
- **the cursor**: opaque; tied to the sort it was issued under (another sort is a 400); not tied to filters, so a client drops it when a filter changes; survives the row it was built from being deleted;
- **unpriced cards sort last in both price directions**, and price means USD;
- **three statements per request whatever the page size**, and why three rather than two (the nested select is a batched `IN`, measured);
- **the measurements**: the twelve budget lines from `$SCRATCH/probe.txt`, the six HTTP times, the EXPLAIN node types and execution time, the date, and whether an index was needed;
- **isolation**: the route takes no user; a forged cursor around another user's id positions only the caller's rows — measured.

Follow the voice of the Catalog and Prices sections: bold lead sentence, then the measured fact.

- [ ] **Step 3: DataModel, only if an index was added**

Add `(userId, acquiredAt)` to the InventoryItem entry in `docs/DataModel.md` with the measurement that justified it.

- [ ] **Step 4: Verify the docs against the code**

```bash
grep -n "aggregates" docs/API.md
grep -n "cursor" docs/API.md | head
```

Expected: no `aggregates` on the `/inventory` row; the cursor rules present. Every number in the new section appears in `$SCRATCH/probe.txt` or in Task 4's recorded outputs.

- [ ] **Step 5: Commit**

```bash
pnpm format:check
git add docs/API.md docs/DataModel.md
git commit -m "[PD-53]: document the inventory read and what it measured

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage.** Contract → Task 1. Decimal lift → Task 2. Cursor, order, "after the cursor", query, isolation, errors → Task 3. Budget, statement count, keyset walk, mid-scroll delete, isolation, errors → Task 3 Step 7 and Task 4. Indexes-only-if-measured → Task 4 Step 4. Docs, including dropping "aggregates" → Task 5. Out-of-scope items have no task, by design.
- **Deviation from the spec, corrected in the spec.** Three statements per request, not two — measured while planning and written back into the spec before this plan.
- **Type names used across tasks.** `SORTS`, `SortKey`, `SortSpec`, `InventoryCursor`, `encodeCursor`, `decodeCursor`, `InventoryService.list` are defined in Task 3 Step 1–2 and used only there and in the Task 4 probe.
