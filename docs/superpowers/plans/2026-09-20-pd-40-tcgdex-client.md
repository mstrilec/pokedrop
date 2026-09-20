# PD-40 TCGdex Fallback Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second `CardSourceProvider` over TCGdex that the catalog sync can run against without a line changing outside `apps/api/src/sync/providers/`.

**Architecture:** TCGdex has no bulk path to full card data — every filtered endpoint returns briefs. What it does have is an index of all 23 736 briefs in **one 960 ms request**, so `fetchCards({ page, pageSize })` is a sorted slice of that index hydrated through `/cards/{id}` at concurrency 8. The index is sorted by `id` so a page boundary is a property of the data rather than of the response order, and cached for an hour so one sweep sees one snapshot.

**Tech Stack:** NestJS 12 (ESM, `module: nodenext` — every relative import ends in `.js`), Zod 4, `fetch` with `AbortSignal.timeout`, PostgreSQL 17.

**Spec:** [`docs/superpowers/specs/2026-09-19-pd-40-pd-43-provider-fallback-and-failover-design.md`](../specs/2026-09-19-pd-40-pd-43-provider-fallback-and-failover-design.md)

**Companion plan:** PD-43 (failover) builds on this one and is planned separately, so commits stay per ticket.

## Global Constraints

- **Work directly on `dev`.** No feature branches, no pull requests.
- **Commit subjects are `[PD-40]: short lowercase description`**, no trailing period, **72 characters maximum**. Bodies end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. commitlint rejects two ticket tags in one subject and warns on a body line that starts a word then a colon.
- **No automated tests in v1** (`docs/PRD.md` §20). **This overrides the TDD structure the writing-plans skill normally imposes.** Every red/green cycle is a measurement against the live API through a throwaway probe.
- **No paid services.** TCGdex needs no key and must never be given one.
- **Concurrency is 8 and does not go higher.** Nothing failed at 16, and 8 is the number the spec committed to because this is a free community service and the extra 1.1 minutes are not ours to take.
- **Nothing outside `sync/providers/` changes.** That is PD-40's third acceptance criterion, and `git diff --stat` is the check in Task 4.
- **ESM.** Relative imports inside `apps/api` carry the `.js` extension or the build fails.
- **Every commit compiles.** `pnpm typecheck`, `pnpm lint` and `pnpm format:check` pass from the repository root before each one.
- **Verified claims only.** If a measurement contradicts the spec, report the contradiction rather than adjusting the claim to fit.

### Shared shell setup

```bash
cd /m/projects/pokedrop
PSQL="docker compose exec -T postgres psql -U pokedrop -d pokedrop"
TCG="https://api.tcgdex.net/v2/en"
```

`docker compose ps` must show postgres and redis healthy.

### Three traps that have already cost time on this project

**A probe that imports project code must live inside `apps/api`.** Node resolves
bare imports relative to the file, and pnpm keeps packages under
`apps/api/node_modules`. `apps/api/dist/` is gitignored and is the right home.
This cost two failed commands in PD-36 — do not rediscover it.

**A probe importing `dist/` needs `pnpm build` first**, and a stale `dist/` will
silently run the previous version of the code you are trying to measure.

**Do not background the API with `(node dist/main &)`.** It detaches, writes no
log anywhere you can read, and survives the shell that started it — then the
next start fails with `EADDRINUSE` on port 4000 and the error looks like a code
fault. Use the Bash tool's `run_in_background`, or redirect to a file and record
the PID.

### Live values these steps assert against

Measured 2026-09-19. Re-measure if a step disagrees rather than editing the
expectation.

- the brief index is **23 736** entries; **1 749** of them carry no `image`
- TCGdex publishes **220** sets; 63 have no logo, 51 no symbol
- `base1` is `Base Set`, series `Base`, released `1999-01-09`, 102 cards
- `base1-4` is Charizard: `category` `Pokemon`, `stage` `Stage2`, `hp` 120, `types` `["Fire"]`, `retreat` 3, `rarity` `Rare`, `dexId` `[6]`
- `exu-!` and `exu-%3F` are the two ids that need URL encoding
- concurrency 8 measured 114.5 req/s, all 200, no `429` at any level

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/api/src/sync/providers/tcgdex/http.ts` | the only place this provider touches the network; retry policy and the error taxonomy |
| `apps/api/src/sync/providers/tcgdex/tcgdex.schema.ts` | raw Zod shapes for what TCGdex actually sends |
| `apps/api/src/sync/providers/tcgdex/tcgdex.mapper.ts` | raw → `SetDTO` / `CardDTO` / `PriceDTO`, and nothing else |
| `apps/api/src/sync/providers/tcgdex/tcgdex.client.ts` | the interface implementation, the brief index and the hydration pool |
| `apps/api/src/sync/providers/providers.module.ts` | **modified** — register the client in the registry |
| `apps/api/src/sync/README.md` | **modified** — the provider, its gaps, the measurements |
| `docs/Architecture.md` | **modified** — §3 gains what the fallback actually costs |

`http.ts` deliberately parallels `pokemon-tcg/http.ts` rather than sharing with
it. The mechanism is the same; the *policy* is not — TCGdex needs no API key,
answers 10/10, and serves 404 for a missing card, so its attempt budget is 3
rather than 5 and a 404 is a skip rather than a fault. Extracting a shared
transport would mean editing PD-39's measured file to add options only one
caller uses. If a third provider arrives, extract then, with three cases to
generalise from instead of two.

### Task order

Task 1 → 2 → 3 → 4 → 5, strictly. Task 3 imports from 1 and 2; Task 4 cannot run
until 3 exists.

---

## Task 1: The HTTP layer and the raw schemas

**Files:**
- Create: `apps/api/src/sync/providers/tcgdex/http.ts`
- Create: `apps/api/src/sync/providers/tcgdex/tcgdex.schema.ts`

**Interfaces:**
- Consumes: `CardSourceName`, `ProviderRateLimitError`, `ProviderUnavailableError` from `../card-source-provider.js` and `../provider.errors.js`
- Produces:
  - `getJson(path: string, options: TcgdexHttpOptions): Promise<unknown>` — resolves to `null` for a 404
  - `interface TcgdexHttpOptions { baseUrl: string; language: string; timeoutMs: number; maxAttempts: number; onRetry?: (attempt: number, reason: string) => void }`
  - `RawSetBriefSchema`, `RawSetSchema`, `RawCardBriefSchema`, `RawCardSchema` and the types `RawSetBrief`, `RawSet`, `RawCardBrief`, `RawCard`

- [ ] **Step 1: Write the HTTP layer**

Create `apps/api/src/sync/providers/tcgdex/http.ts`:

```ts
import type { CardSourceName } from '../card-source-provider.js';
import { ProviderRateLimitError, ProviderUnavailableError } from '../provider.errors.js';

const PROVIDER: CardSourceName = 'tcgdex';

const NOT_FOUND = 404;
const RATE_LIMITED = 429;
const SERVER_ERROR_FLOOR = 500;
const BACKOFF_BASE_MS = 250;
const RATE_LIMIT_BACKOFF_MS = 5_000;

export interface TcgdexHttpOptions {
  baseUrl: string;
  language: string;
  timeoutMs: number;
  maxAttempts: number;
  onRetry?: (attempt: number, reason: string) => void;
}

function backoffMs(attempt: number): number {
  const step = BACKOFF_BASE_MS * 2 ** (attempt - 1);
  return step / 2 + Math.random() * (step / 2);
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (header === null) {
    return null;
  }

  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : null;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The only place this provider calls the network.
 *
 * Three attempts rather than the primary's five. That client is built around an
 * upstream where 6 of 20 requests succeed; this one answered 10 of 10 and 64 of
 * 64 under concurrency, so a budget sized for the other provider would only
 * lengthen the wait before a real failure surfaces.
 *
 * A 404 returns null instead of throwing. The brief index and the detail
 * endpoint are separate views of the same catalog and can disagree, and one
 * absent card must cost one card rather than the page it sits in.
 *
 * The return type is `unknown` rather than `unknown | null`, because those are
 * the same type - `unknown` already admits null, and writing the union earns an
 * eslint no-redundant-type-constituents error. Callers still test `=== null`,
 * which TypeScript permits on `unknown`.
 */
export async function getJson(path: string, options: TcgdexHttpOptions): Promise<unknown> {
  const url = `${options.baseUrl}/${options.language}${path}`;
  let lastReason = 'no attempt was made';

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    let response: Response;

    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      lastReason = error instanceof Error ? error.message : 'network failure';
      if (attempt === options.maxAttempts) break;
      options.onRetry?.(attempt, lastReason);
      await sleep(backoffMs(attempt));
      continue;
    }

    if (response.ok) {
      try {
        const body: unknown = await response.json();
        return body;
      } catch (error) {
        throw new ProviderUnavailableError(PROVIDER, `${path} returned a 200 that is not JSON`, {
          cause: error,
        });
      }
    }

    if (response.status === NOT_FOUND) {
      return null;
    }

    if (response.status === RATE_LIMITED) {
      const wait = retryAfterMs(response);
      if (attempt === options.maxAttempts) {
        throw new ProviderRateLimitError(PROVIDER, `${path} is rate limited`, wait);
      }
      options.onRetry?.(attempt, 'HTTP 429');
      await sleep(wait ?? RATE_LIMIT_BACKOFF_MS);
      continue;
    }

    if (response.status >= SERVER_ERROR_FLOOR) {
      lastReason = `HTTP ${response.status}`;
      if (attempt === options.maxAttempts) break;
      options.onRetry?.(attempt, lastReason);
      await sleep(backoffMs(attempt));
      continue;
    }

    throw new ProviderUnavailableError(PROVIDER, `${path} failed with HTTP ${response.status}`);
  }

  throw new ProviderUnavailableError(
    PROVIDER,
    `${path} failed after ${options.maxAttempts} attempts: ${lastReason}`,
  );
}
```

- [ ] **Step 2: Write the raw schemas**

Create `apps/api/src/sync/providers/tcgdex/tcgdex.schema.ts`:

```ts
import { z } from 'zod';

/**
 * What TCGdex actually sends, not what the DTOs want. Every field the mapper
 * reads is declared here, and everything optional is optional because a live
 * payload was seen without it.
 *
 * `.loose()` throughout: this provider adds fields (`variants_detailed`,
 * `illustrator`, `boosters`) without warning, and a strict object would turn a
 * harmless addition into a ProviderContractError across the whole catalog.
 */

const CardCountSchema = z.looseObject({
  total: z.number().int().min(0),
  official: z.number().int().min(0),
});

export const RawSetBriefSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type RawSetBrief = z.infer<typeof RawSetBriefSchema>;

export const RawSetSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  serie: z.looseObject({ id: z.string(), name: z.string() }),
  releaseDate: z.string().min(1),
  cardCount: CardCountSchema,
  logo: z.string().optional(),
  symbol: z.string().optional(),
});
export type RawSet = z.infer<typeof RawSetSchema>;

export const RawCardBriefSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  image: z.string().optional(),
});
export type RawCardBrief = z.infer<typeof RawCardBriefSchema>;

const RawAttackSchema = z.looseObject({
  name: z.string(),
  cost: z.array(z.string()).optional(),
  effect: z.string().optional(),
  damage: z.union([z.string(), z.number()]).optional(),
});

const RawAbilitySchema = z.looseObject({
  name: z.string(),
  type: z.string().optional(),
  effect: z.string().optional(),
});

const RawTypeValueSchema = z.looseObject({
  type: z.string(),
  value: z.string(),
});

export const RawCardSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  set: z.looseObject({ id: z.string().min(1) }),
  image: z.string().optional(),
  rarity: z.string().optional(),
  hp: z.number().optional(),
  types: z.array(z.string()).optional(),
  stage: z.string().optional(),
  retreat: z.number().int().min(0).optional(),
  dexId: z.array(z.number().int()).optional(),
  attacks: z.array(RawAttackSchema).optional(),
  abilities: z.array(RawAbilitySchema).optional(),
  weaknesses: z.array(RawTypeValueSchema).optional(),
  resistances: z.array(RawTypeValueSchema).optional(),
  legal: z.looseObject({ standard: z.boolean(), expanded: z.boolean() }).optional(),
  variants_detailed: z
    .array(
      z.looseObject({
        thirdParty: z
          .looseObject({
            tcgplayer: z.number().optional(),
            cardmarket: z.number().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  pricing: z
    .looseObject({
      cardmarket: z
        .looseObject({
          avg: z.number().nullable().optional(),
          low: z.number().nullable().optional(),
          trend: z.number().nullable().optional(),
        })
        .optional(),
      tcgplayer: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});
export type RawCard = z.infer<typeof RawCardSchema>;

export const RawSetBriefListSchema = z.array(RawSetBriefSchema);
export const RawCardBriefListSchema = z.array(RawCardBriefSchema);
```

- [ ] **Step 3: Confirm every schema parses a live payload**

```bash
pnpm -s typecheck && pnpm -s build
```

```bash
cat > apps/api/dist/tcgdex-schema-probe.mjs <<'EOF'
import {
  RawCardSchema, RawSetSchema, RawSetBriefListSchema, RawCardBriefListSchema,
} from './sync/providers/tcgdex/tcgdex.schema.js';

const base = 'https://api.tcgdex.net/v2/en';
const get = async (p) => (await fetch(base + p)).json();

const setBriefs = RawSetBriefListSchema.parse(await get('/sets'));
console.log('set briefs      :', setBriefs.length);

const set = RawSetSchema.parse(await get('/sets/base1'));
console.log('set base1       :', set.name, '|', set.serie.name, '|', set.releaseDate, '| total', set.cardCount.total);

const index = RawCardBriefListSchema.parse(await get('/cards'));
console.log('card index      :', index.length, '| without image:', index.filter((c) => c.image === undefined).length);

const card = RawCardSchema.parse(await get('/cards/base1-4'));
console.log('card base1-4    :', card.name, '|', card.category, '| stage', card.stage, '| hp', card.hp, '| retreat', card.retreat);

let parsed = 0;
const failures = [];
for (const brief of index.slice(0, 60)) {
  const raw = await get('/cards/' + encodeURIComponent(brief.id));
  const result = RawCardSchema.safeParse(raw);
  if (result.success) parsed += 1;
  else failures.push(brief.id + ': ' + result.error.issues[0].message);
}
console.log('60 cards parsed :', parsed, '| failures:', failures.length, failures.slice(0, 3));
EOF
cd apps/api && node dist/tcgdex-schema-probe.mjs; cd ../..
```

Expected: 220 set briefs; `Base Set | Base | 1999-01-09 | total 102`; a card
index of 23 736 with 1 749 lacking an image; `Charizard | Pokemon | stage Stage2
| hp 120 | retreat 3`; and **60 of 60 cards parsed with zero failures**.

A failure here is the schema being wrong about the live payload, not the payload
being wrong. Widen the schema and re-run.

- [ ] **Step 4: Gates and commit**

```bash
rm -f apps/api/dist/tcgdex-schema-probe.mjs
pnpm -s typecheck && pnpm -s lint && pnpm -s format:check
```

```bash
git add apps/api/src/sync/providers/tcgdex/
git commit -F - <<'EOF'
[PD-40]: add the tcgdex transport and the shapes it really sends

Three attempts rather than the primary's five, because this upstream answered
10 of 10 where the other answers 6 of 20. A 404 returns null so that one
missing card costs one card instead of the page around it.

Schemas are loose on purpose - this provider adds fields without warning, and
a strict object would turn an addition into a contract error across 23 736
cards.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 2: The mapper

**Files:**
- Create: `apps/api/src/sync/providers/tcgdex/tcgdex.mapper.ts`

**Interfaces:**
- Consumes: `RawCard`, `RawSet` from `./tcgdex.schema.js`; `CardDTOSchema`, `PriceDTOSchema`, `SetDTOSchema` from `../provider.dto.js`
- Produces:
  - `toSetDTO(raw: RawSet): SetDTO`
  - `toCardDTO(raw: RawCard & { image: string }): CardDTO`
  - `toPriceDTOs(raw: RawCard, capturedAt: Date): PriceDTO[]`

- [ ] **Step 1: Write the mapper**

Create `apps/api/src/sync/providers/tcgdex/tcgdex.mapper.ts`:

```ts
import {
  CardDTOSchema,
  PriceDTOSchema,
  SetDTOSchema,
  type CardDTO,
  type PriceDTO,
  type SetDTO,
} from '../provider.dto.js';
import type { RawCard, RawSet } from './tcgdex.schema.js';

/**
 * TCGdex writes `Pokemon`; the mirror holds `Pokémon`, which is what
 * pokemontcg.io publishes and what 17 464 existing rows already say. One
 * character, and without it the supertype facet grows a fourth value and
 * `?supertype=Pokémon` misses every row this provider wrote.
 *
 * An unrecognised category passes through unchanged rather than being dropped:
 * a new one is information, and inventing a mapping for it would be worse.
 */
const SUPERTYPE_BY_CATEGORY: Record<string, string> = {
  Pokemon: 'Pokémon',
  Trainer: 'Trainer',
  Energy: 'Energy',
};

/** TCGplayer print variants, best first - the same order the primary uses. */
const TCGPLAYER_VARIANTS = [
  'normal',
  'holofoil',
  'reverseHolofoil',
  '1stEditionHolofoil',
  'unlimitedHolofoil',
] as const;

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * The symbol URL TCGdex publishes does not resolve. It points at
 * `assets.tcgdex.net/univ/<serie>/<set>/symbol`, and that path answers 400 with
 * every extension and with none; the asset lives under the language prefix
 * instead. Verified across 8 sets: `univ` 0/8, `en` 8/8.
 *
 * This looks like a typo and is not. `SetDTOSchema.symbolUrl` is `z.url()`,
 * which a dead URL satisfies perfectly, so removing the rewrite writes 169 dead
 * image sources into the mirror without failing anything.
 */
function symbolUrl(symbol: string | undefined): string | null {
  return symbol === undefined ? null : `${symbol.replace('/univ/', '/en/')}.png`;
}

/** `Stage2` is one word upstream and two in the mirror. `Basic` is unchanged. */
function toSubtypes(stage: string | undefined): string[] {
  return stage === undefined ? [] : [stage.replace(/([^\d\s])(\d)/, '$1 $2')];
}

export function toSetDTO(raw: RawSet): SetDTO {
  return SetDTOSchema.parse({
    id: raw.id,
    name: raw.name,
    series: raw.serie.name,
    // Already ISO here, where pokemontcg.io sends `1999/01/09`. The two map to
    // the same instant to the millisecond - checked against both live payloads.
    releaseDate: new Date(raw.releaseDate),
    printedTotal: raw.cardCount.official,
    total: raw.cardCount.total,
    symbolUrl: symbolUrl(raw.symbol),
    logoUrl: raw.logo === undefined ? null : `${raw.logo}.png`,
  });
}

/**
 * `image` is required by the caller rather than defaulted here. `CardDTO`
 * declares `imageSmall` and `imageLarge` as non-nullable URLs, so a card with no
 * image cannot be represented at all - 1 749 of 23 736 are in that state. The
 * client filters them into `CardPage.skipped`, which is the same thing the
 * primary's client does with a card that fails to parse.
 */
export function toCardDTO(raw: RawCard & { image: string }): CardDTO {
  const thirdParty = (raw.variants_detailed ?? [])
    .map((variant) => variant.thirdParty)
    .find((party) => party?.tcgplayer !== undefined || party?.cardmarket !== undefined);

  return CardDTOSchema.parse({
    id: raw.id,
    setId: raw.set.id,
    name: raw.name,
    supertype: SUPERTYPE_BY_CATEGORY[raw.category] ?? raw.category,
    subtypes: toSubtypes(raw.stage),
    hp: raw.hp ?? null,
    types: raw.types ?? [],
    rarity: raw.rarity ?? null,
    // TCGdex publishes a count, not a cost. Expanding it is not invention:
    // retreat cost is colourless by the rules of the game.
    retreatCost: Array.from({ length: raw.retreat ?? 0 }, () => 'Colorless'),
    weaknesses: raw.weaknesses ?? [],
    resistances: raw.resistances ?? [],
    attacks: (raw.attacks ?? []).map((attack) => ({
      name: attack.name,
      cost: attack.cost ?? [],
      // Not published. `cost.length` is the definition of the field.
      convertedEnergyCost: (attack.cost ?? []).length,
      damage: attack.damage === undefined ? '' : String(attack.damage),
      // AttackSchema declares text and damage as non-nullable strings, so an
      // attack with no printed effect has nowhere to put a null. The empty
      // string is the shared contract speaking, not this mapper being careless.
      text: attack.effect ?? '',
    })),
    abilities: (raw.abilities ?? []).map((ability) => ({
      name: ability.name,
      text: ability.effect ?? '',
      type: ability.type ?? '',
    })),
    // Booleans upstream, strings in the contract. `unlimited` is omitted rather
    // than invented - TCGdex does not publish it, and a guess here would read
    // as data.
    legalities:
      raw.legal === undefined
        ? {}
        : {
            standard: raw.legal.standard ? 'Legal' : 'Illegal',
            expanded: raw.legal.expanded ? 'Legal' : 'Illegal',
          },
    nationalPokedexNumbers: raw.dexId ?? [],
    imageSmall: `${raw.image}/low.webp`,
    imageLarge: `${raw.image}/high.webp`,
    // This provider is the stronger source for both. pokemontcg.io publishes
    // neither, so all 20 670 existing rows carry null.
    tcgplayerId: thirdParty?.tcgplayer === undefined ? null : String(thirdParty.tcgplayer),
    cardmarketId: thirdParty?.cardmarket === undefined ? null : String(thirdParty.cardmarket),
  });
}

export function toPriceDTOs(raw: RawCard, capturedAt: Date): PriceDTO[] {
  const prices: PriceDTO[] = [];

  const tcg = raw.pricing?.tcgplayer;
  if (tcg) {
    const variant = TCGPLAYER_VARIANTS.find((name) => tcg[name] !== undefined);
    const block = variant === undefined ? undefined : (tcg[variant] as Record<string, unknown>);

    if (block) {
      prices.push(
        PriceDTOSchema.parse({
          cardId: raw.id,
          source: 'TCGPLAYER',
          currency: 'USD',
          market: asNumber(block.marketPrice),
          low: asNumber(block.lowPrice),
          mid: asNumber(block.midPrice),
          high: asNumber(block.highPrice),
          capturedAt,
        }),
      );
    }
  }

  const cm = raw.pricing?.cardmarket;
  if (cm) {
    prices.push(
      PriceDTOSchema.parse({
        cardId: raw.id,
        source: 'CARDMARKET',
        currency: 'EUR',
        market: asNumber(cm.avg),
        low: asNumber(cm.low),
        // The same approximation the primary's mapper makes and for the same
        // reason: Cardmarket publishes no median, and a trend is the closest
        // thing it has. M4 may prefer to widen PriceDTO instead.
        mid: asNumber(cm.trend),
        high: null,
        capturedAt,
      }),
    );
  }

  return prices;
}
```

- [ ] **Step 2: Check every mapping rule against a live card**

```bash
pnpm -s typecheck && pnpm -s build
```

```bash
cat > apps/api/dist/tcgdex-mapper-probe.mjs <<'EOF'
import { RawCardSchema, RawSetSchema } from './sync/providers/tcgdex/tcgdex.schema.js';
import { toCardDTO, toSetDTO, toPriceDTOs } from './sync/providers/tcgdex/tcgdex.mapper.js';

const base = 'https://api.tcgdex.net/v2/en';
const get = async (p) => (await fetch(base + p)).json();

const set = toSetDTO(RawSetSchema.parse(await get('/sets/base1')));
console.log('SET base1');
console.log('  series      ', set.series, '| expect Base');
console.log('  releaseDate ', set.releaseDate.toISOString(), '| expect 1999-01-09T00:00:00.000Z');
console.log('  printed/tot ', set.printedTotal, set.total, '| expect 102 102');
console.log('  logoUrl     ', set.logoUrl);
console.log('  symbolUrl   ', set.symbolUrl, '| expect null (base1 publishes none)');

const set2 = toSetDTO(RawSetSchema.parse(await get('/sets/base2')));
console.log('  base2 symbol', set2.symbolUrl, '| must contain /en/ and end .png');
for (const u of [set.logoUrl, set2.symbolUrl].filter(Boolean)) {
  console.log('  asset', (await fetch(u)).status, u);
}

const card = toCardDTO(RawCardSchema.parse(await get('/cards/base1-4')));
console.log('CARD base1-4');
console.log('  supertype   ', JSON.stringify(card.supertype), '| expect "Pokémon"');
console.log('  subtypes    ', JSON.stringify(card.subtypes), '| expect ["Stage 2"]');
console.log('  retreatCost ', JSON.stringify(card.retreatCost), '| expect 3x Colorless');
console.log('  legalities  ', JSON.stringify(card.legalities), '| expect no unlimited key');
console.log('  hp/types    ', card.hp, JSON.stringify(card.types));
console.log('  dex         ', JSON.stringify(card.nationalPokedexNumbers), '| expect [6]');
console.log('  thirdParty  ', card.tcgplayerId, card.cardmarketId, '| expect both non-null');
console.log('  attack[0]   ', JSON.stringify(card.attacks[0]));
for (const u of [card.imageSmall, card.imageLarge]) {
  console.log('  asset', (await fetch(u)).status, u);
}

const energy = toCardDTO(RawCardSchema.parse(await get('/cards/base1-98')));
console.log('CARD base1-98 (Energy):', JSON.stringify(energy.supertype), '| hp', energy.hp,
  '| types', JSON.stringify(energy.types), '| retreat', JSON.stringify(energy.retreatCost));

const trainer = toCardDTO(RawCardSchema.parse(await get('/cards/base1-88')));
console.log('CARD base1-88 (Trainer):', JSON.stringify(trainer.supertype));

const noEffect = toCardDTO(RawCardSchema.parse(await get('/cards/hgss1-1')));
console.log('CARD hgss1-1 attack with no effect:', JSON.stringify(noEffect.attacks[0]));

const prices = toPriceDTOs(RawCardSchema.parse(await get('/cards/base1-4')), new Date());
console.log('PRICES base1-4:', prices.length, 'points');
for (const p of prices) console.log('  ', p.source, p.currency, 'market', p.market, 'low', p.low, 'mid', p.mid, 'high', p.high);
EOF
cd apps/api && node dist/tcgdex-mapper-probe.mjs; cd ../..
```

Expected, every line:

- `supertype` is `"Pokémon"` with the accent, for the Pokémon card, and
  `"Energy"` / `"Trainer"` for the other two
- `subtypes` is `["Stage 2"]` — with the space
- `retreatCost` is three `"Colorless"`, and `[]` for the Energy card
- `legalities` has `standard` and `expanded` and **no `unlimited` key**
- `releaseDate` is exactly `1999-01-09T00:00:00.000Z`
- every asset URL printed answers **200** — the two card images and `base2`'s
  symbol, which must contain `/en/` and not `/univ/`
- `tcgplayerId` and `cardmarketId` are both non-null strings
- `hgss1-1`'s attack has `text: ""` and a non-empty `damage`
- two price points, `TCGPLAYER`/`USD` and `CARDMARKET`/`EUR`

A `symbolUrl` answering 400 means the `/univ/` rewrite was dropped. A
`supertype` of `"Pokemon"` without the accent means the lookup table was
bypassed; both are silent in production and loud here, which is the point of
this step.

- [ ] **Step 3: Gates and commit**

```bash
rm -f apps/api/dist/tcgdex-mapper-probe.mjs
pnpm -s typecheck && pnpm -s lint && pnpm -s format:check
```

```bash
git add apps/api/src/sync/providers/tcgdex/tcgdex.mapper.ts
git commit -F - <<'EOF'
[PD-40]: map tcgdex onto the provider DTOs

Four rules here are silent when wrong. The category is `Pokemon` upstream and
`Pokémon` in the mirror; `Stage2` is one word upstream and two here; retreat
is a count and the contract wants a cost; and the published symbol URL points
at a path that answers 400, so it is rewritten to the language prefix.

Legalities lose `unlimited` rather than gaining a guess, and an attack with no
printed effect gets "" because AttackSchema has nowhere to put a null.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 3: The client

**Files:**
- Create: `apps/api/src/sync/providers/tcgdex/tcgdex.client.ts`

**Interfaces:**
- Consumes: `getJson`, `TcgdexHttpOptions`; the schemas; the mapper; `APP_CONFIG`/`AppConfig`; `CardPage`, `CardSourceName`, `CardSourceProvider`, `FetchCardsParams`; `ProviderContractError`, `ProviderItemError`
- Produces: `class TcgdexClient implements CardSourceProvider` with `readonly name: CardSourceName = 'tcgdex'`

- [ ] **Step 1: Write the client**

Create `apps/api/src/sync/providers/tcgdex/tcgdex.client.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../config/index.js';
import type {
  CardPage,
  CardSourceName,
  CardSourceProvider,
  FetchCardsParams,
} from '../card-source-provider.js';
import type { CardDTO, PriceDTO, SetDTO } from '../provider.dto.js';
import { ProviderContractError, type ProviderItemError } from '../provider.errors.js';
import { getJson, type TcgdexHttpOptions } from './http.js';
import { toCardDTO, toPriceDTOs, toSetDTO } from './tcgdex.mapper.js';
import {
  RawCardBriefListSchema,
  RawCardSchema,
  RawSetBriefListSchema,
  RawSetSchema,
  type RawCardBrief,
} from './tcgdex.schema.js';

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;

/**
 * Eight. Nothing failed at sixteen and no 429 was seen at any level, so this is
 * not a limit the service imposed - it is one this project chose. TCGdex is
 * free and keyless and docs/PRD.md section 2 commits this project to free
 * infrastructure; being a guest on it is a constraint. Eight sweeps the catalog
 * far faster than the primary manages, and the remaining headroom
 * is not ours to take.
 */
const HYDRATION_CONCURRENCY = 8;

/**
 * English only. The 14-language path is documented in docs/Architecture.md
 * section 3 and built by nothing in v1; hardcoding it here keeps the decision
 * visible instead of hiding it behind an environment variable nobody sets.
 */
const LANGUAGE = 'en';

const INDEX_TTL_MS = 3_600_000;

interface CardIndex {
  briefs: RawCardBrief[];
  fetchedAt: number;
}

@Injectable()
export class TcgdexClient implements CardSourceProvider {
  readonly name: CardSourceName = 'tcgdex';

  private readonly http: TcgdexHttpOptions;

  private index: CardIndex | null = null;

  private indexInFlight: Promise<CardIndex> | null = null;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.http = {
      baseUrl: config.providers.tcgdexBaseUrl,
      language: LANGUAGE,
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxAttempts: MAX_ATTEMPTS,
    };
  }

  /**
   * One request for the list plus one per set - 221 in all, about 30 seconds.
   * The list carries neither `releaseDate` nor `serie`, and SetDTO requires
   * both, so there is no cheaper shape available.
   */
  async fetchSets(): Promise<SetDTO[]> {
    const briefs = RawSetBriefListSchema.safeParse(await this.get('/sets'));

    if (!briefs.success) {
      throw new ProviderContractError(this.name, '/sets did not return an array of sets', {
        cause: briefs.error,
      });
    }

    const sets: SetDTO[] = [];
    for (const brief of briefs.data) {
      const payload = await this.get(`/sets/${encodeURIComponent(brief.id)}`);
      const parsed = RawSetSchema.safeParse(payload);
      if (parsed.success) {
        sets.push(toSetDTO(parsed.data));
      }
    }

    return sets;
  }

  /**
   * TCGdex has no bulk path to full cards: every filtered endpoint returns
   * briefs. So a page is a slice of the brief index, hydrated one card at a
   * time through a bounded pool.
   *
   * `setId` narrows the index rather than issuing a different request, because
   * `/cards?set=` returns briefs too - the hydration cost is identical either
   * way.
   */
  async fetchCards(params: FetchCardsParams): Promise<CardPage> {
    const index = await this.loadIndex();

    const scope =
      params.setId === undefined
        ? index.briefs
        : index.briefs.filter((brief) => this.setIdOf(brief.id) === params.setId);

    const start = (params.page - 1) * params.pageSize;
    const slice = scope.slice(start, start + params.pageSize);

    const items: CardDTO[] = [];
    const skipped: ProviderItemError[] = [];

    // A brief with no image cannot become a CardDTO - imageSmall is a
    // non-nullable URL - so it is reported rather than fetched. 1 749 of 23 736
    // are in that state, and spending a request on each to fail anyway would
    // add seven minutes to a sweep.
    const hydratable: RawCardBrief[] = [];
    for (const brief of slice) {
      if (brief.image === undefined) {
        skipped.push({ provider: this.name, itemId: brief.id, message: 'card has no image' });
      } else {
        hydratable.push(brief);
      }
    }

    const queue = [...hydratable];
    const workers = Array.from({ length: HYDRATION_CONCURRENCY }, async () => {
      for (;;) {
        const brief = queue.shift();
        if (brief === undefined) return;

        const card = await this.hydrate(brief);
        if ('error' in card) skipped.push(card.error);
        else items.push(card.item);
      }
    });

    await Promise.all(workers);

    // The pool finishes out of order and a page has to be stable, because
    // PD-42 resumes from a page number.
    items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    return {
      items,
      skipped,
      page: params.page,
      pageSize: params.pageSize,
      total: scope.length,
      hasMore: start + params.pageSize < scope.length,
    };
  }

  async fetchPrices(cardIds: string[]): Promise<PriceDTO[]> {
    if (cardIds.length === 0) {
      return [];
    }

    const capturedAt = new Date();
    const queue = [...cardIds];
    const prices: PriceDTO[] = [];

    const workers = Array.from({ length: HYDRATION_CONCURRENCY }, async () => {
      for (;;) {
        const id = queue.shift();
        if (id === undefined) return;

        const parsed = RawCardSchema.safeParse(await this.get(`/cards/${encodeURIComponent(id)}`));
        if (parsed.success) {
          prices.push(...toPriceDTOs(parsed.data, capturedAt));
        }
      }
    });

    await Promise.all(workers);
    return prices;
  }

  /**
   * Sorted by id, so a page boundary is a property of the catalog rather than
   * of the order this endpoint happened to answer in - the same page returns
   * the same 250 cards on a resume.
   *
   * Cached for an hour so one sweep sees one snapshot. A resume after that
   * refetches, and if cards were published in between the boundaries shift:
   * some cards are fetched twice, which the guarded upsert absorbs, and some are
   * missed, which the next sweep picks up. That is how this mirror already
   * converges across runs.
   */
  private async loadIndex(): Promise<CardIndex> {
    const now = Date.now();
    if (this.index !== null && now - this.index.fetchedAt < INDEX_TTL_MS) {
      return this.index;
    }

    this.indexInFlight ??= this.fetchIndex().finally(() => {
      this.indexInFlight = null;
    });

    this.index = await this.indexInFlight;
    return this.index;
  }

  private async fetchIndex(): Promise<CardIndex> {
    const parsed = RawCardBriefListSchema.safeParse(await this.get('/cards'));

    if (!parsed.success) {
      throw new ProviderContractError(this.name, '/cards did not return an array of cards', {
        cause: parsed.error,
      });
    }

    const briefs = [...parsed.data].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { briefs, fetchedAt: Date.now() };
  }

  private async hydrate(
    brief: RawCardBrief,
  ): Promise<{ item: CardDTO } | { error: ProviderItemError }> {
    const payload = await this.get(`/cards/${encodeURIComponent(brief.id)}`);

    if (payload === null) {
      return {
        error: { provider: this.name, itemId: brief.id, message: 'card is in the index but 404s' },
      };
    }

    const parsed = RawCardSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        error: {
          provider: this.name,
          itemId: brief.id,
          message: parsed.error.issues[0]?.message ?? 'did not match the card schema',
        },
      };
    }

    // Destructured rather than tested in place, so the narrowing survives into
    // the spread below without an assertion.
    const { image } = parsed.data;
    if (image === undefined) {
      return {
        error: { provider: this.name, itemId: brief.id, message: 'card has no image' },
      };
    }

    return { item: toCardDTO({ ...parsed.data, image }) };
  }

  /** `exu-%3F` is a real id. encodeURIComponent turns it into `exu-%253F`, which
   * is the URL that answers 200 - the double encoding is correct, not a bug. */
  private get(path: string): Promise<unknown> {
    return getJson(path, this.http);
  }

  private setIdOf(cardId: string): string {
    const cut = cardId.lastIndexOf('-');
    return cut === -1 ? cardId : cardId.slice(0, cut);
  }
}
```

- [ ] **Step 2: Measure the client against the live API**

```bash
pnpm -s typecheck && pnpm -s build
```

```bash
cat > apps/api/dist/tcgdex-client-probe.mjs <<'EOF'
import { TcgdexClient } from './sync/providers/tcgdex/tcgdex.client.js';

const client = new TcgdexClient({
  providers: { tcgdexBaseUrl: 'https://api.tcgdex.net/v2' },
});

const t0 = Date.now();
const page1 = await client.fetchCards({ page: 1, pageSize: 250 });
console.log('page 1  :', page1.items.length, 'items,', page1.skipped.length, 'skipped, total',
  page1.total, 'hasMore', page1.hasMore, '|', Date.now() - t0, 'ms');

const t1 = Date.now();
const page2 = await client.fetchCards({ page: 2, pageSize: 250 });
console.log('page 2  :', page2.items.length, 'items |', Date.now() - t1, 'ms (index is cached)');

const ids1 = new Set(page1.items.map((c) => c.id));
const overlap = page2.items.filter((c) => ids1.has(c.id));
console.log('overlap between page 1 and 2:', overlap.length, '| expect 0');

const again = await client.fetchCards({ page: 1, pageSize: 250 });
const same = JSON.stringify(again.items.map((c) => c.id)) === JSON.stringify(page1.items.map((c) => c.id));
console.log('page 1 refetched is identical:', same, '| expect true');

const bySet = await client.fetchCards({ setId: 'base1', page: 1, pageSize: 250 });
console.log('base1   :', bySet.items.length, 'items, total', bySet.total,
  '| all in base1:', bySet.items.every((c) => c.setId === 'base1'));

console.log('skipped sample:', JSON.stringify(page1.skipped.slice(0, 3)));

// The two ids that need URL encoding. `exu-%3F` already carries a percent
// escape, so the URL that answers 200 is the double-encoded `exu-%253F`.
const odd = await client.fetchCards({ setId: 'exu', page: 1, pageSize: 250 });
const oddIds = new Set([...odd.items.map((c) => c.id), ...odd.skipped.map((s) => s.itemId)]);
console.log('odd ids  : exu-! seen', oddIds.has('exu-!'), '| exu-%3F seen', oddIds.has('exu-%3F'),
  '| both expect true, and neither may report a 404');
console.log('  their skip reasons:',
  JSON.stringify(odd.skipped.filter((s) => s.itemId === 'exu-!' || s.itemId === 'exu-%3F')));

const sets = await client.fetchSets();
console.log('sets    :', sets.length, '| with symbol:', sets.filter((s) => s.symbolUrl).length,
  '| with logo:', sets.filter((s) => s.logoUrl).length);

const prices = await client.fetchPrices(['base1-4', 'base1-2']);
console.log('prices  :', prices.length, 'points across', new Set(prices.map((p) => p.source)).size, 'sources');
EOF
cd apps/api && node dist/tcgdex-client-probe.mjs; cd ../..
```

Expected:

- page 1 returns items plus skipped summing to 250, `total` 23 736, `hasMore` true
- page 2 is markedly faster than page 1 — the index is cached, not refetched
- **overlap is 0** and **page 1 refetched is identical** — the two measurements
  the `id` sort exists for, and the ones that make `SyncRun.cursor` mean anything
- `base1` returns 102 items, every one with `setId` `base1`
- **both odd ids are seen, and neither is skipped with a 404 reason** — they may
  legitimately be skipped for having no image, which they are; a 404 means the
  encoding is wrong
- `fetchSets()` returns 220
- `fetchPrices` returns 4 points across 2 sources

If overlap is non-zero, the sort was dropped and every resumed sync will write
some cards twice and miss others.

- [ ] **Step 3: Gates and commit**

```bash
rm -f apps/api/dist/tcgdex-client-probe.mjs
pnpm -s typecheck && pnpm -s lint && pnpm -s format:check
```

```bash
git add apps/api/src/sync/providers/tcgdex/tcgdex.client.ts
git commit -F - <<'EOF'
[PD-40]: page tcgdex by slicing its brief index

There is no bulk path to full cards - every filtered endpoint returns briefs -
but the whole index is one 960 ms request, so a page is a slice of it hydrated
through a pool of eight.

The index is sorted by id, which is what makes a page number mean the same 250
cards on a resume as it did on the first attempt. Held for an hour so one
sweep sees one snapshot.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 4: Registration, and a sweep that proves it

**Files:**
- Modify: `apps/api/src/sync/providers/providers.module.ts`

**Interfaces:**
- Consumes: `TcgdexClient` from `./tcgdex/tcgdex.client.js`
- Produces: the registry now answers for `'tcgdex'` as well as `'pokemontcg'`

- [ ] **Step 1: Register the client**

In `apps/api/src/sync/providers/providers.module.ts`, add the import:

```ts
import { TcgdexClient } from './tcgdex/tcgdex.client.js';
```

Replace the `providers` array's first two entries with:

```ts
    PokemonTcgClient,
    TcgdexClient,
    {
      provide: CARD_SOURCE_REGISTRY,
      inject: [PokemonTcgClient, TcgdexClient],
      useFactory: (pokemonTcg: PokemonTcgClient, tcgdex: TcgdexClient): CardSourceRegistry =>
        new Map<CardSourceName, CardSourceProvider>([
          [pokemonTcg.name, pokemonTcg],
          [tcgdex.name, tcgdex],
        ]),
    },
```

Delete the `// PD-40 adds TcgdexClient beside it.` comment — it is now done — and
update the boot-failure message, which still says PD-40 has not happened:

```ts
          throw new Error(
            `No card source provider is registered for "${config.providers.active}". ` +
              'Registration lives in this module, beside the clients themselves.',
          );
```

- [ ] **Step 2: Prove nothing outside the sealed folder changed**

```bash
pnpm -s typecheck && pnpm -s lint && pnpm -s format:check
git diff --stat HEAD~3
```

Expected: every path printed begins `apps/api/src/sync/providers/`. That is
PD-40's third acceptance criterion, and this is the whole of checking it.
Documentation lands in Task 5 and is not code.

- [ ] **Step 3: Sweep a scratch database with the provider set to tcgdex**

The real mirror is **not** touched. A TCGdex sweep writes TCGdex's id space, and
running it against the populated mirror is exactly the fork the design exists to
prevent — PD-43's rules are what make a mixed database safe, and they do not
exist yet.

```bash
docker compose exec -T postgres createdb -U pokedrop pokedrop_tcgdex
SCRATCH_URL="postgresql://pokedrop:pokedrop_local_dev@localhost:5433/pokedrop_tcgdex"
cd apps/api && DATABASE_URL="$SCRATCH_URL" pnpm exec prisma migrate deploy; cd ../..
```

```bash
cat > apps/api/dist/tcgdex-sweep-probe.mjs <<'EOF'
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';
import { QUEUE } from './queue/index.js';
import { getQueueToken } from '@nestjs/bullmq';

const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: false });
const queue = app.get(getQueueToken(QUEUE.catalogSync));
const job = await queue.add('catalog-sync', {});
console.log('enqueued job', job.id, '- the worker in this process will consume it');
EOF
cd apps/api && DATABASE_URL="$SCRATCH_URL" CARD_SOURCE_PROVIDER=tcgdex node dist/tcgdex-sweep-probe.mjs; cd ../..
```

The process will not exit promptly: it consumes what it enqueued and
`app.close()` drains the job in flight, which for a full sweep is minutes. That
is PD-41's graceful shutdown working, not a hang — the same note
`sync/README.md` already carries. Let it run; the sweep is roughly 221 set
requests plus 23 736 card requests, and takes 15 to 25 minutes end to end -
the HTTP rate is not the sweep rate, because each page also opens a transaction
and upserts 250 rows.

If TCGdex starts answering 429 — it did not once in any measurement — stop the
run, record it, and report it rather than lowering the concurrency to push
through.

- [ ] **Step 4: Check what landed**

```bash
SCRATCH="docker compose exec -T postgres psql -U pokedrop -d pokedrop_tcgdex -tAc"
docker compose exec -T postgres psql -U pokedrop -d pokedrop_tcgdex -c "
SELECT (SELECT count(*) FROM sets)  AS sets,
       (SELECT count(*) FROM cards) AS cards,
       (SELECT count(*) FROM cards WHERE \"tcgplayerId\"  IS NOT NULL) AS with_tcgplayer,
       (SELECT count(*) FROM cards WHERE \"cardmarketId\" IS NOT NULL) AS with_cardmarket;
SELECT supertype, count(*) FROM cards GROUP BY supertype ORDER BY 2 DESC;
SELECT status, provider, processed, failed FROM sync_runs ORDER BY \"startedAt\" DESC LIMIT 1;
SELECT id, name, \"setId\", subtypes, \"retreatCost\", legalities FROM cards WHERE id = 'base1-4';
"
```

Expected, and each one is an acceptance criterion or a mapping rule:

- **`sets` is 220 and `cards` is well over 20 000** — the first acceptance
  criterion, "running catalog sync with the provider config set to TCGdex
  populates the mirror"
- **`supertype` is `Pokémon` with the accent**, and there is no row saying
  `Pokemon`
- **`with_tcgplayer` and `with_cardmarket` are both large** — the field the
  primary can never fill
- `base1-4` has `subtypes` `{Stage 2}`, three `retreatCost` entries, and
  `legalities` without an `unlimited` key
- the run's `provider` column reads `tcgdex`

Record the actual numbers; they go into the README in Task 5.

- [ ] **Step 5: Drop the scratch database and commit**

```bash
rm -f apps/api/dist/tcgdex-sweep-probe.mjs
docker compose exec -T postgres dropdb -U pokedrop pokedrop_tcgdex
$PSQL -tAc "SELECT count(*) FROM cards"
```

That last line must still print **20670**. The real mirror was never the target
of any of this, and confirming it is cheaper than assuming it.

```bash
git add apps/api/src/sync/providers/providers.module.ts
git commit -F - <<'EOF'
[PD-40]: register tcgdex beside the primary in the registry

Registration stays inside the sealed folder, which is what keeps PD-38's first
acceptance criterion literally true: adding a provider changed no file outside
sync/providers/.

Swept a scratch database end to end with CARD_SOURCE_PROVIDER=tcgdex rather
than the real mirror - a TCGdex sweep writes TCGdex's id space, and mixing the
two is the fork PD-43 exists to prevent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 5: Documentation

**Files:**
- Modify: `apps/api/src/sync/README.md`
- Modify: `docs/Architecture.md`

- [ ] **Step 1: Add the provider to the sync README**

In `apps/api/src/sync/README.md`, the table under "What is not here yet" lists
PD-40 as pending. Remove that row, and remove PD-39's row if Task 4's diff shows
it is also stale.

Append a section after "The pokemontcg.io provider", using the numbers Task 3
and Task 4 actually printed rather than the ones quoted here:

```markdown
## The TCGdex provider

Registered as `tcgdex` and used as the fallback. `providers/tcgdex/` holds the
same four files as the primary, and `http.ts` is deliberately a parallel of the
other rather than shared code: the mechanism matches, the policy does not.

### It fails in the opposite direction to the primary

Measured 2026-09-19. pokemontcg.io answered **6 of 20** requests; TCGdex
answered **10 of 10**, then **64 of 64** under concurrency, with no `429` at any
level. What it lacks is bulk: every filtered endpoint — `?set=`, `?id=`,
pagination — returns briefs of `{id, localId, name, image}`, and a full card is
one request each.

| Concurrency | Rate | HTTP time for 23 736 |
| --- | --- | --- |
| 1 | 12.5 req/s | 27.5 min |
| 4 | 63.9 req/s | 5.4 min |
| **8** | **114.5 req/s** | **3.0 min** |
| 16 | 177.3 req/s | 1.9 min |

**That last column is HTTP time only, and it is not how long a sweep takes.**
Measured end to end on 2026-09-20: a real catalog sync wrote 220 sets and 7 007
cards before it was stopped, at roughly 1 400 cards a minute — so a full catalog
is **15 to 25 minutes**, not three. The gap is everything the throughput probe
left out: the sweep opens a transaction and upserts 250 rows between pages, and
walks the pages one at a time. Concurrency 8 is still the right choice; what was
wrong was extrapolating an HTTP rate to a job that also writes a database.

Eight, and not because sixteen failed. This is a free keyless community service
and `docs/PRD.md` §2 commits the project to free infrastructure; the extra
minute is not ours to take.

### A page is a slice of the brief index

The whole index is **one request — 23 736 entries, 2.3 MB, 960 ms**. The client
holds it for an hour, **sorted by `id`**, and a page is a slice hydrated through
a pool of eight.

The sort is load-bearing. `SyncRun.cursor` stores a page number, and a page
number only means something if it names the same cards twice. Without it the
order is whatever the endpoint answered with, and every resumed sync writes some
cards twice and misses others.

A resume more than an hour later refetches the index, and cards published in
between shift the boundaries. Harmless: the guarded upsert absorbs a repeat, and
a missed card is picked up by the next sweep — which is how this mirror already
converges.

### Mapping rules, and four that are silent when wrong

| Target | Source | Note |
| --- | --- | --- |
| `supertype` | `category` | **`Pokemon` → `Pokémon`.** One character. Without it the supertype facet grows a fourth value and `?supertype=Pokémon` misses every row this provider wrote |
| `subtypes` | `stage` | **`Stage2` → `["Stage 2"]`**, one word upstream and two here |
| `retreatCost` | `retreat` | a count upstream, a cost here — expanded to that many `Colorless`, which is what the rules of the game say it is |
| `symbolUrl` | `symbol` | **the published URL answers 400.** It points at `assets.tcgdex.net/univ/…`; the asset lives under the language prefix. Verified across 8 sets: `univ` 0/8, `en` 8/8. `z.url()` accepts a dead URL, so dropping the rewrite is silent |
| `logoUrl` | `logo` | `+ ".png"`; 63 of 220 sets publish none |
| `legalities` | `legal` | booleans → `Legal`/`Illegal`. `unlimited` is **omitted**, not guessed |
| `attacks[].convertedEnergyCost` | — | `cost.length`, which is the definition |
| `tcgplayerId`, `cardmarketId` | `variants_detailed[].thirdParty` | **the one place this provider beats the primary**, which publishes neither |

### Two gaps that are the contract's, not the mapper's

**1 749 of 23 736 cards carry no image**, across 68 sets, confirmed on the full
object rather than the index. `CardDTO.imageSmall` is a non-nullable `z.url()`,
so such a card cannot be represented; it goes to `CardPage.skipped` without a
request being spent on it. Making images optional is a schema decision the
catalog UI has to answer first.

**`attacks[].text` and `attacks[].damage` become `""` when absent**, because
`AttackSchema` in `@pokedrop/shared` declares both non-nullable. PD-40's second
acceptance criterion — absent fields become explicit nulls — holds for `hp`,
`rarity`, `logoUrl`, `symbolUrl` and the two third-party ids, and cannot hold
here. `hgss1-1`'s Sharp Fang is the card to look at.

### Two ids need encoding

`exu-!` and `exu-%3F`. The second already carries a percent escape, so
`encodeURIComponent` produces `exu-%253F` — and that is the URL that answers
200. The double encoding is correct.

### The ids diverge from the primary's, and that is PD-43's problem

TCGdex publishes 220 sets to the primary's 176, and the two disagree about
naming on the newer ones: `sv3pt5` against `sv03.5`, `me1` against `me01`. Card
ids inherit the set prefix, so **15 222 of the mirror's 20 670 cards (73.6%)
share an id with TCGdex and 5 448 do not**.

Switching providers on a populated database therefore forks the catalog rather
than failing — every foreign key holds and nothing raises. PD-43 carries the two
rules that make failover safe; until then, a TCGdex sweep belongs in its own
database.
```

- [ ] **Step 2: Update `docs/Architecture.md` §3**

The fallback row currently reads "**TCGdex** — free, no key, REST + GraphQL, 14
languages, Docker-self-hostable". Replace the paragraph after the adapter
listing — the one beginning "`PokemonTcgClient` is the default" — so it ends
with:

```markdown
Both are implemented. They fail in opposite directions, which is the point:
pokemontcg.io is cheap in requests and answered 6 of 20 when measured, TCGdex is
one request per card and answered 10 of 10. A full TCGdex sweep is 23 736
requests against the primary's 83, and takes 15 to 25 minutes end to end at the
concurrency of 8 the client holds to.

**Their set ids diverge on newer sets** — `sv3pt5` against `sv03.5` — so 73.6%
of the mirror shares an id with TCGdex and 26.4% does not. Switching providers
on a populated database forks the catalog silently; PD-43 carries the rules that
make failing over safe.
```

- [ ] **Step 3: Format, gate and commit**

```bash
pnpm -s format && pnpm -s format:check && pnpm -s typecheck && pnpm -s lint
```

```bash
git add apps/api/src/sync/README.md docs/Architecture.md
git commit -F - <<'EOF'
[PD-40]: document the fallback provider and what it costs

Four mapping rules are silent when wrong and all four are now written down,
with the measurement that would catch each one.

Also records the thing that shapes PD-43: the two providers disagree about set
ids on the newer sets, so 73.6% of the mirror shares an id with TCGdex and the
rest would fork if a sweep mixed them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git push origin dev
```

---

## Acceptance criteria

- [ ] **Running catalog sync with the provider config set to TCGdex populates the mirror.** Task 4 Steps 3–4, against a scratch database so the real mirror keeps the primary's id space. The check is `sets` = 220 and `cards` above 20 000, with the run's `provider` column reading `tcgdex`.
- [ ] **Fields absent upstream become explicit nulls, never silent empty strings.** Task 2 Step 2 for `hp`, `rarity`, `logoUrl`, `symbolUrl`, `tcgplayerId`, `cardmarketId`. **Partially met, and recorded as such:** `attacks[].text` and `attacks[].damage` are `""` when absent because `AttackSchema` declares them non-nullable — the shared contract, not the mapper. Documented in Task 5.
- [ ] **The rest of the codebase requires zero changes to use it.** Task 4 Step 2: `git diff --stat` shows only paths under `apps/api/src/sync/providers/`.

## Out of scope

| Not here | Where |
| --- | --- |
| Failover, the breaker, the selector | PD-43 |
| The admin sync status endpoint | PD-43 (read) and PD-81 (control) |
| Set-id translation between providers | rejected in the spec |
| The 14-language path | documented in `Architecture.md` §3, built by nothing in v1 |
| Prices written to the database | M4 (PD-48, PD-49). `fetchPrices` exists and returns DTOs; nothing calls it yet |
| Making `CardDTO.imageSmall` nullable | a `ComponentSpecs.md` decision before a sync one |
