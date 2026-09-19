# PD-45 Catalog Read API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four public routes over the mirror — card search, card detail, set list and set detail — answering from PostgreSQL and never from a provider.

**Architecture:** The request and response contract lands in `@pokedrop/shared`, because that is where `packages/shared/src/index.ts` says an endpoint's schemas belong and it is what the frontend will import. `CatalogService` holds the queries and `CatalogController` stays thin, per `docs/Architecture.md` §1. `CatalogModule` imports nothing at all: `PrismaModule` is `@Global()` so `PrismaService` injects without one, and `SyncModule` is not, so a provider token is not in this module's context to inject by accident.

**Tech Stack:** NestJS 12 (ESM, `module: nodenext` — every relative import ends in `.js`), Prisma 7.10.0, Zod 4 through the local `createZodDto`, PostgreSQL 17 with a `C` collation.

**Spec:** [`docs/superpowers/specs/2026-09-19-pd-45-catalog-read-api-design.md`](../specs/2026-09-19-pd-45-catalog-read-api-design.md)

## Global Constraints

- **Work directly on `dev`.** No feature branches, no pull requests.
- **Commit subjects are `[PD-45]: short lowercase description`**, no trailing period. Bodies end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Avoid a body line that starts a word then a colon — commitlint reads it as a footer and warns.
- **No automated tests in v1** (`docs/PRD.md` §20). **This overrides the TDD structure the writing-plans skill normally imposes.** Every red/green cycle is a measurement against the running stack with the full catalog.
- **Every commit compiles.** `pnpm typecheck` and `pnpm lint` pass from the repository root before each one.
- **ESM.** Relative imports inside `apps/api` carry the `.js` extension or the build fails.
- **`ORDER BY` always carries `id` beside `name`.** 16 216 of 20 670 rows share a name; without the tiebreak, offset pagination shows a row twice and another never.
- **No caching.** PD-46 adds it with sync-driven invalidation. A cache here would mean that ticket rewriting rather than extending.
- **`CatalogModule` has an empty `imports` array**, and that is the third acceptance criterion rather than an oversight.
- **Nothing computes a price.** `latestPriceUsd`, `latestPriceEur` and `priceUpdatedAt` are returned as stored, currently null everywhere, until M4 fills them.
- **Verified claims only.** If a measurement contradicts the spec, report the contradiction rather than adjusting the claim to fit.

### Shared shell setup

```bash
cd /m/projects/pokedrop
PSQL="docker compose exec -T postgres psql -U pokedrop -d pokedrop"
API="http://localhost:4000/api/v1"
```

`docker compose ps` must show postgres healthy, and the catalog must be
populated — `$PSQL -tAc "SELECT count(*) FROM cards"` should return 20 670. If it
returns 12, PD-42's sync has not been run against this database and every
measurement below is meaningless.

Real values to filter on, taken from the live table:

- rarities include `Common`, `Double Rare`, `Amazing Rare`, `ACE SPEC Rare`
- types include `Fire`, `Water`, `Grass`, `Lightning`, `Colorless`, `Darkness`
- `base1` has 102 cards

**No probe files are needed.** Every verification is a `curl` against the running
API or a `psql` query, so the `dist/` build trap that bit PD-39, PD-41 and PD-42
does not apply.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/shared/src/entities/catalog.ts` | the query and response contract both apps import |
| `apps/api/src/catalog/catalog.dto.ts` | `createZodDto` wrappers so the pipe validates and Swagger documents |
| `apps/api/src/catalog/catalog.service.ts` | the four queries, and the only file that touches Prisma |
| `apps/api/src/catalog/catalog.controller.ts` | four routes, thin |
| `apps/api/src/catalog/catalog.module.ts` | the module, with an empty `imports` |
| `apps/api/src/catalog/index.ts` | the module's public surface |

The contract is separated from the DTO wrappers because they serve different
consumers: the frontend imports the Zod schemas, and only Nest needs the classes
`createZodDto` produces.

### Task order

The contract first, because the service's signatures are written against it.
Then the service, which can be measured on its own through a probe-free `psql`
comparison. Then the controller and module, which make it reachable. The
documentation last, once the numbers it records exist.

---

## Task 1: The contract in `@pokedrop/shared`

**Files:**
- Create: `packages/shared/src/entities/catalog.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `CardSchema`, `CardSetSchema`, `PaginationQuerySchema`, `pageOf` from the existing shared package.
- Produces: `CardSortSchema` / `CardSort`, `CardSearchQuerySchema` / `CardSearchQuery`, `CardSearchResultSchema` / `CardSearchResult`, `SetDetailSchema` / `SetDetail`. Task 2's service takes `CardSearchQuery`; Task 3's DTOs wrap the query schema.

- [ ] **Step 1: Write the contract**

Create `packages/shared/src/entities/catalog.ts`:

```ts
import { z } from 'zod';
import { CardSchema } from './card.js';
import { CardSetSchema } from './set.js';
import { PaginationQuerySchema, pageOf } from '../primitives/pagination.js';

/**
 * One field, two directions.
 *
 * Price columns are null until the price sync exists, and a meaningful rarity
 * order needs RarityTier, which is a presentation concept rather than a column.
 * Adding a sort is one entry here plus one branch in the service.
 */
export const CardSortSchema = z.enum(['name_asc', 'name_desc']).default('name_asc');
export type CardSort = z.infer<typeof CardSortSchema>;

/**
 * Every filter is optional and absent means "no filter". An empty string is
 * treated as absent too, because a cleared search box sends `?q=`.
 */
export const CardSearchQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  set: z.string().trim().min(1).max(64).optional(),
  rarity: z.string().trim().min(1).max(64).optional(),
  /**
   * One type, matched by array containment. A card carries at most two, and the
   * FilterBar is a single dropdown.
   */
  type: z.string().trim().min(1).max(32).optional(),
  sort: CardSortSchema,
});
export type CardSearchQuery = z.infer<typeof CardSearchQuerySchema>;

/**
 * Named `CardSearchResult` rather than `CardPage`, because
 * `sync/providers/card-source-provider.ts` already exports a `CardPage` - the
 * provider-side page of a fetch. Two types with one name in one codebase is a
 * collision waiting for the file that imports both.
 */
export const CardSearchResultSchema = pageOf(CardSchema);
export type CardSearchResult = z.infer<typeof CardSearchResultSchema>;

/**
 * A set plus how many cards the mirror holds for it, which is not the same as
 * `total`: `total` is what the provider says the set contains, and `cardCount`
 * is what we actually have. They differ while a sync is still filling in pages.
 */
export const SetDetailSchema = CardSetSchema.extend({
  cardCount: z.number().int().min(0),
});
export type SetDetail = z.infer<typeof SetDetailSchema>;
```

`CardSearchQuerySchema` extends `PaginationQuerySchema`, so `page` and
`pageSize` come with their existing bounds — `pageSize` at most 100, and Zod
rejects rather than clamps.

- [ ] **Step 2: Export it**

In `packages/shared/src/index.ts`, add after the `entities/card.js` line:

```ts
export * from './entities/catalog.js';
```

- [ ] **Step 3: Confirm the bounds behave**

```bash
pnpm --filter @pokedrop/shared build
node --input-type=module -e "
import { CardSearchQuerySchema } from './packages/shared/dist/index.js';
const show = (label, input) => {
  const r = CardSearchQuerySchema.safeParse(input);
  console.log(label, r.success ? JSON.stringify(r.data) : r.error.issues[0].path.join('.') + ': ' + r.error.issues[0].message);
};
show('defaults      :', {});
show('pageSize 1000 :', { pageSize: '1000' });
show('page 0        :', { page: '0' });
show('coerced       :', { page: '2', pageSize: '50' });
show('filters       :', { q: ' char ', set: 'base1', rarity: 'Common', type: 'Fire', sort: 'name_desc' });
show('bad sort      :', { sort: 'price_asc' });
"
```

Expected:

```
defaults      : {"page":1,"pageSize":24,"sort":"name_asc"}
pageSize 1000 : pageSize: Too big: expected number to be <=100
page 0        : page: Too small: expected number to be >=1
coerced       : {"page":2,"pageSize":50,"sort":"name_asc"}
filters       : {"page":1,"pageSize":24,"q":"char","set":"base1","rarity":"Common","type":"Fire","sort":"name_desc"}
bad sort      : sort: Invalid option: expected one of "name_asc"|"name_desc"
```

The exact wording of a Zod message may differ by version; what matters is that
`pageSize=1000` is **rejected** and names the field rather than being clamped,
and that `q` is trimmed.

- [ ] **Step 4: Gates and commit**

```bash
pnpm typecheck && pnpm lint
git add packages/shared/src/entities/catalog.ts packages/shared/src/index.ts
git commit -F - <<'EOF'
[PD-45]: add the catalog query and response contract

Lives in @pokedrop/shared because that package's own index states the rule -
endpoint schemas are added by the ticket that implements the endpoint - and
because the frontend will import the same objects the API validates against.

The sort enum is one field with two directions. Price columns are null until M4
and a meaningful rarity order needs RarityTier, which is presentation rather
than a column.

Verified that pageSize above the maximum is rejected naming the field rather
than clamped, which is the second acceptance criterion.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 2: The service

**Files:**
- Create: `apps/api/src/catalog/catalog.service.ts`

**Interfaces:**
- Consumes: `PrismaService` from `../prisma/index.js`; `CardSearchQuery`, `CardSearchResult`, `SetDetail` from `@pokedrop/shared`.
- Produces: `CatalogService` with `searchCards(query): Promise<CardSearchResult>`, `getCard(id): Promise<Card>`, `listSets(): Promise<CardSet[]>`, `getSet(id): Promise<SetDetail>`. Task 3's controller calls all four.

- [ ] **Step 1: Write the service**

Create `apps/api/src/catalog/catalog.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Card, CardSearchQuery, CardSearchResult, CardSet, SetDetail } from '@pokedrop/shared';
import { PrismaService } from '../prisma/index.js';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async searchCards(query: CardSearchQuery): Promise<CardSearchResult> {
    const where: Prisma.CardWhereInput = {
      ...(query.set === undefined ? {} : { setId: query.set }),
      ...(query.rarity === undefined ? {} : { rarity: query.rarity }),
      ...(query.type === undefined ? {} : { types: { has: query.type } }),
      ...(query.q === undefined ? {} : { name: { contains: query.q, mode: 'insensitive' } }),
    };

    // `id` is not decoration. 16 216 of 20 670 rows share a name, so without a
    // tiebreak PostgreSQL may order ties differently between two requests and
    // offset pagination then shows one row twice and another never.
    const orderBy: Prisma.CardOrderByWithRelationInput[] =
      query.sort === 'name_desc' ? [{ name: 'desc' }, { id: 'desc' }] : [{ name: 'asc' }, { id: 'asc' }];

    const [items, total] = await Promise.all([
      this.prisma.card.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.card.count({ where }),
    ]);

    return {
      items: items as unknown as Card[],
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async getCard(id: string): Promise<Card> {
    const card = await this.prisma.card.findUnique({ where: { id } });

    if (card === null) {
      // Absence is not cached and not represented as an empty body. A 404 is one
      // indexed primary-key lookup, and caching a negative invites filling the
      // cache with invented ids.
      throw new NotFoundException('Card not found');
    }

    return card as unknown as Card;
  }

  async listSets(): Promise<CardSet[]> {
    // Unpaginated on purpose: 176 rows that grow by a handful a year.
    const sets = await this.prisma.cardSet.findMany({ orderBy: [{ releaseDate: 'desc' }, { id: 'asc' }] });
    return sets as unknown as CardSet[];
  }

  async getSet(id: string): Promise<SetDetail> {
    const set = await this.prisma.cardSet.findUnique({
      where: { id },
      include: { _count: { select: { cards: true } } },
    });

    if (set === null) {
      throw new NotFoundException('Set not found');
    }

    const { _count, ...rest } = set;

    // `cardCount` is what the mirror holds; `total` is what the provider says
    // the set contains. They differ while a sync is still filling in pages.
    return { ...rest, cardCount: _count.cards } as unknown as SetDetail;
  }
}
```

The `as unknown as` casts are deliberate and narrow. Prisma returns `Decimal`
for the two price columns and a `JsonValue` for the five jsonb ones, while the
shared schemas describe the wire shape; the two agree in practice and the cast
says so once rather than mapping 20 fields by hand. If M4 ever makes the price
columns non-null, that is the moment to replace this with a real mapper.

- [ ] **Step 2: Compare the service's results against SQL**

```bash
pnpm typecheck && pnpm lint
```

Start the API and check each filter against the database directly. This is the
whole point of doing PD-45 after PD-42 — both sides now have 20 670 rows to
disagree about.

```bash
pnpm --filter @pokedrop/shared build && pnpm --filter @pokedrop/api build
( cd apps/api && node --env-file=../../.env dist/main.js > /tmp/pd45-api.log 2>&1 & )
```

Wait for it to listen, then compare counts. The service is not yet reachable
over HTTP — the controller is Task 3 — so this step only confirms it compiles
and that the SQL the queries will issue matches expectations:

```bash
$PSQL -tAc "SELECT count(*) FROM cards WHERE \"setId\"='base1'"
$PSQL -tAc "SELECT count(*) FROM cards WHERE rarity='Common'"
$PSQL -tAc "SELECT count(*) FROM cards WHERE 'Fire' = ANY(types)"
$PSQL -tAc "SELECT count(*) FROM cards WHERE name ILIKE '%charizard%'"
```

Record the four numbers. Task 3 compares the HTTP responses against them.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/catalog/catalog.service.ts
git commit -F - <<'EOF'
[PD-45]: add the catalog service

Four queries, and the only file in the module that touches Prisma. Sorting
carries id beside name because 16 216 of 20 670 rows share a name, and offset
pagination over an unstable order shows one row twice and another never.

An unknown id is a NotFoundException rather than an empty body. Absence is not
cached, because getOrSet cannot store null usefully and a cached negative
invites filling the cache with invented ids.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 3: The DTOs, the controller and the module

**Files:**
- Create: `apps/api/src/catalog/catalog.dto.ts`, `apps/api/src/catalog/catalog.controller.ts`, `apps/api/src/catalog/catalog.module.ts`, `apps/api/src/catalog/index.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `CatalogService` (Task 2); `CardSearchQuerySchema` (Task 1); `createZodDto` from `../common/zod-dto.js`; `Public` from `../common/decorators/public.decorator.js`.
- Produces: `CatalogModule`, and the four live routes.

- [ ] **Step 1: Wrap the query schema as a DTO**

Create `apps/api/src/catalog/catalog.dto.ts`:

```ts
import { CardSearchQuerySchema } from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

/**
 * The wrapper is what ZodValidationPipe looks for and what puts the schema into
 * the OpenAPI document. The schema itself lives in @pokedrop/shared, because the
 * frontend imports it too.
 */
export class CardSearchQueryDto extends createZodDto(
  'CardSearchQuery',
  CardSearchQuerySchema,
) {}
```

- [ ] **Step 2: Write the controller**

Create `apps/api/src/catalog/catalog.controller.ts`:

```ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Card, CardSet, SetDetail } from '@pokedrop/shared';
import { Public } from '../common/decorators/public.decorator.js';
import { CatalogService } from './catalog.service.js';
import { CardSearchQueryDto } from './catalog.dto.js';

/**
 * Public because a catalog is, and because the card detail page is SEO-facing.
 * Without @Public() the global SessionGuard answers 401 - the polarity PD-33
 * chose deliberately, so forgetting the decorator is noisy rather than silent.
 */
@ApiTags('catalog')
@Public()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('cards')
  searchCards(@Query() query: CardSearchQueryDto) {
    return this.catalog.searchCards(query);
  }

  @Get('cards/:id')
  getCard(@Param('id') id: string): Promise<Card> {
    return this.catalog.getCard(id);
  }

  @Get('sets')
  listSets(): Promise<CardSet[]> {
    return this.catalog.listSets();
  }

  @Get('sets/:id')
  getSet(@Param('id') id: string): Promise<SetDetail> {
    return this.catalog.getSet(id);
  }
}
```

`@Controller()` with no prefix, because the routes are `/cards` and `/sets`
rather than `/catalog/cards`. The global `api` prefix and the `v1` version still
apply, so they resolve at `/api/v1/cards`.

- [ ] **Step 3: Write the module and wire it**

Create `apps/api/src/catalog/catalog.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

/**
 * An empty `imports` is the third acceptance criterion rather than an omission.
 *
 * PrismaModule is @Global(), so PrismaService injects without one. SyncModule is
 * not, so the CARD_SOURCE_PROVIDER token is not in this module's context -
 * injecting a provider here would fail at boot rather than reach the network at
 * runtime.
 */
@Module({
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
```

Create `apps/api/src/catalog/index.ts`:

```ts
export { CatalogModule } from './catalog.module.js';
export { CatalogService } from './catalog.service.js';
```

In `apps/api/src/app.module.ts`, add `import { CatalogModule } from './catalog/index.js';`
beside the other module imports and `CatalogModule,` to the `imports` array
after `AuthModule`.

- [ ] **Step 4: Bring the API up and check every route answers without a session**

```bash
pnpm typecheck && pnpm lint
pnpm --filter @pokedrop/api build
( cd apps/api && node --env-file=../../.env dist/main.js > /tmp/pd45-api.log 2>&1 & )
sleep 10
for path in "cards?pageSize=1" "cards/base1-4" "sets" "sets/base1"; do
  printf "%-22s " "$path"
  curl -s -o /dev/null -w "%{http_code}\n" "$API/$path"
done
```

Expected: `200` four times. A `401` means `@Public()` is missing or the decorator
is on the wrong class.

- [ ] **Step 5: Check the filters agree with SQL**

Compare each against the numbers recorded in Task 2 Step 2:

```bash
for f in "set=base1" "rarity=Common" "type=Fire" "q=charizard"; do
  printf "%-18s api=%-6s " "$f" "$(curl -s "$API/cards?pageSize=1&$f" | python -c 'import json,sys; print(json.load(sys.stdin)["total"])')"
  case $f in
    set=*)    $PSQL -tAc "SELECT 'sql='||count(*) FROM cards WHERE \"setId\"='base1'";;
    rarity=*) $PSQL -tAc "SELECT 'sql='||count(*) FROM cards WHERE rarity='Common'";;
    type=*)   $PSQL -tAc "SELECT 'sql='||count(*) FROM cards WHERE 'Fire' = ANY(types)";;
    q=*)      $PSQL -tAc "SELECT 'sql='||count(*) FROM cards WHERE name ILIKE '%charizard%'";;
  esac
done
```

Expected: `api` and `sql` match on all four. A mismatch on `type` means the
`has` operator is not generating containment; a mismatch on `q` means `mode:
'insensitive'` was dropped.

- [ ] **Step 6: Check pagination is stable — the measurement the tiebreak exists for**

```bash
curl -s "$API/cards?pageSize=50&page=1" | python -c 'import json,sys; print("\n".join(c["id"] for c in json.load(sys.stdin)["items"]))' | sort > /tmp/pd45-p1
curl -s "$API/cards?pageSize=50&page=2" | python -c 'import json,sys; print("\n".join(c["id"] for c in json.load(sys.stdin)["items"]))' | sort > /tmp/pd45-p2
echo "ids on both pages: $(comm -12 /tmp/pd45-p1 /tmp/pd45-p2 | wc -l)"
echo "distinct ids over two pages: $(cat /tmp/pd45-p1 /tmp/pd45-p2 | sort -u | wc -l)"
```

Expected: **0** ids on both pages, and **100** distinct ids over two pages of 50.
Anything else means the `id` tiebreak is missing from `orderBy`.

- [ ] **Step 7: Check the remaining acceptance criteria**

```bash
echo -n "pageSize=1000 -> "; curl -s -o /tmp/pd45-big -w "%{http_code} " "$API/cards?pageSize=1000"; cat /tmp/pd45-big
echo
echo -n "unknown card  -> "; curl -s -o /tmp/pd45-404 -w "%{http_code} " "$API/cards/not-a-real-card"; cat /tmp/pd45-404
echo
echo -n "sets count    -> "; curl -s "$API/sets" | python -c 'import json,sys; print(len(json.load(sys.stdin)))'
echo -n "base1 detail  -> "; curl -s "$API/sets/base1" | python -c 'import json,sys; d=json.load(sys.stdin); print("cardCount", d["cardCount"], "total", d["total"])'
$PSQL -tAc "SELECT 'sql cardCount '||count(*) FROM cards WHERE \"setId\"='base1'"
```

Expected: a **400** whose message names `pageSize`; a **404** in the standard
envelope with `statusCode`, `error`, `message` and `requestId`; **176** sets; and
`cardCount` matching the SQL count.

- [ ] **Step 8: Prove no route can reach a provider**

The structural argument is the empty `imports`, and this is the observation that
backs it. Point the provider at an unroutable host and confirm the catalog does
not care:

```bash
PID=$(netstat -ano | grep ":4000.*LISTENING" | awk '{print $NF}' | head -1)
taskkill //PID "$PID" //F > /dev/null 2>&1
sleep 2
( cd apps/api && POKEMONTCG_BASE_URL=https://127.0.0.1:9/v2 node --env-file=../../.env dist/main.js > /tmp/pd45-noprovider.log 2>&1 & )
sleep 10
for path in "cards?pageSize=1" "cards/base1-4" "sets" "sets/base1"; do
  printf "%-22s " "$path"
  curl -s -o /dev/null -w "%{http_code}\n" "$API/$path"
done
```

Expected: `200` four times, with no delay — the routes never touch the provider,
so an unreachable one changes nothing.

- [ ] **Step 9: Confirm the plans are still what the spec measured**

The spec's numbers came from hand-written SQL. Confirm Prisma issues something
equivalent by logging the real query:

```bash
PID=$(netstat -ano | grep ":4000.*LISTENING" | awk '{print $NF}' | head -1)
taskkill //PID "$PID" //F > /dev/null 2>&1
sleep 2
( cd apps/api && DB_QUERY_LOGGING=true node --env-file=../../.env dist/main.js > /tmp/pd45-sql.log 2>&1 & )
sleep 10
curl -s -o /dev/null "$API/cards?set=sv1&rarity=Rare&pageSize=24"
sleep 1
grep -m2 -o 'SELECT [^"]*FROM "public"."cards"[^"]*' /tmp/pd45-sql.log | head -2
```

Take the `WHERE` and `ORDER BY` from that logged statement, run it under
`EXPLAIN`, and confirm it still plans as a `BitmapAnd`:

```bash
$PSQL -c "EXPLAIN (COSTS OFF) SELECT id FROM cards WHERE \"setId\"='sv1' AND rarity='Rare' ORDER BY name ASC, id ASC LIMIT 24 OFFSET 0"
```

Expected: a plan containing `BitmapAnd` over `cards_setId_idx` and
`cards_rarity_idx`. If Prisma's generated SQL differs enough to change the plan,
record what it actually does rather than the spec's number.

- [ ] **Step 10: Stop the API and commit**

```bash
PID=$(netstat -ano | grep ":4000.*LISTENING" | awk '{print $NF}' | head -1)
taskkill //PID "$PID" //F > /dev/null 2>&1
pnpm typecheck && pnpm lint
git add apps/api/src/catalog/ apps/api/src/app.module.ts
git commit -F - <<'EOF'
[PD-45]: expose the catalog over four public routes

All four carry @Public(), because the global SessionGuard answers 401 otherwise -
the polarity PD-33 chose so that forgetting the decorator is noisy rather than
silent.

CatalogModule imports nothing. PrismaModule is @Global() so PrismaService
injects without one, and SyncModule is not, so a provider token is not in this
module's context to inject by accident. That is the third acceptance criterion,
and it was checked by pointing the provider at an unroutable host and watching
every route still answer 200.

Verified against SQL on all four filters, and pagination checked for the failure
the id tiebreak exists to prevent - two pages of 50 share no ids and cover 100
distinct cards.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 4: Documentation

**Files:**
- Modify: `docs/API.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing importable.

- [ ] **Step 1: Replace the Catalog section**

`docs/API.md` currently has a four-row table under `## Catalog` and nothing else.
Replace that section with:

````markdown
## Catalog

Served entirely from the mirror. No route here can reach an external API —
`CatalogModule` imports nothing, and the provider tokens live in `SyncModule`,
which it does not import. Verified by pointing `POKEMONTCG_BASE_URL` at an
unroutable host and watching all four routes still answer 200.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/cards` | public | `q`, `set`, `rarity`, `type`, `sort`, `page`, `pageSize` |
| GET | `/cards/:id` | public | 404 when absent |
| GET | `/sets` | public | all 176, unpaginated |
| GET | `/sets/:id` | public | the set plus `cardCount` |

**Sorting is `name_asc` or `name_desc`, and `id` always rides along.** 16 216 of
the 20 670 cards share a name — `Pikachu` alone appears 134 times — so an order
by name alone lets PostgreSQL return ties differently between requests, and
offset pagination then shows one row twice and another never. `ORDER BY name, id`
plans as an `Incremental Sort` with `Presorted Key: name`, so the btree still
does the work.

**`q` is a case-insensitive substring match and is not index-backed.** The
database uses a `C` collation, under which only a case-*sensitive* prefix gets an
index condition; every case-insensitive form degrades to a filter. Measured on
the full catalog: 0.84 ms for a matching query, and 9.0 ms worst case for one
matching nothing, which is the only shape that reads all 20 670 rows. `pg_trgm`
is the recorded upgrade and is not taken, because the operator-class index it
needs is one Prisma cannot declare — see `docs/DataModel.md` on why a hand-added
index reads as schema drift.

`set` and `rarity` are index-backed, and the two together plan as a `BitmapAnd`
of both btrees. `type` matches with array containment and the planner treats it
as a filter, because a common type covers a sixth of the table.

**`pageSize` above 100 is rejected, not clamped** — a 400 naming the field.
`total` and `totalPages` are always present, and the count that produces them
costs about as much as the search itself.

**`cardCount` on a set detail is what the mirror holds**, which is not
necessarily `total`, what the provider says the set contains. They differ while a
sync is still filling in pages that failed.
````

- [ ] **Step 2: Format, gate and commit**

```bash
npx prettier --write docs/API.md
npx prettier --check .
pnpm typecheck && pnpm lint && pnpm build
git status --short
git add docs/API.md
git commit -F - <<'EOF'
[PD-45]: document the catalog routes and what their plans do

Records the two things a reader would otherwise have to rediscover. Sorting
carries id because most cards share a name, and free-text search is a filter
rather than an index seek because the C collation only gives a case-sensitive
prefix an index condition - with the 9 ms worst case that makes it acceptable
and the size at which to revisit pg_trgm.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git push origin dev
```

---

## Acceptance criteria

- [ ] **Every filter combination in the spec is index-backed.** Task 3 Step 9 confirms `set + rarity` still plans as a `BitmapAnd` through Prisma's own SQL. `type` and `q` are filters over an index scan, and `q` with no match is a sequential scan — recorded with the 9 ms measurement in both the spec and `docs/API.md` rather than claimed otherwise.
- [ ] **`pageSize` above the maximum is rejected, not silently clamped.** Task 1 Step 3 at the schema, Task 3 Step 7 over HTTP.
- [ ] **No code path in these endpoints can reach an external provider.** Structural, by the empty `imports`; observed in Task 3 Step 8 with the provider pointed at an unroutable host.

## Out of scope

Redis caching and invalidation (PD-46) · the facets endpoint (PD-47) · price reads and history (M4) · `RarityTier` mapping (the frontend, M12) · inventory-aware owned flags (M5).
