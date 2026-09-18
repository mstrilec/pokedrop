# PD-38 CardSourceProvider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the seam that keeps the application ignorant of which card API is behind it — the interface, the provider-neutral DTOs, the error taxonomy, the registry, and the lint rule that stops anyone reaching around it.

**Architecture:** Configuration names the active provider, and `CardSourceName` is inferred from it so the enum in `env.schema.ts` is the only place a provider is named. Three files under `apps/api/src/sync/providers/` carry the contract: `provider.dto.ts` (Zod schemas mirroring the Prisma catalog models, minus the price columns the catalog path must not be able to write), `provider.errors.ts` (a four-member taxonomy PD-43's circuit breaker branches on), and `card-source-provider.ts` (the interface plus two injection tokens). `SyncModule` builds the registry and the configured default but stays unwired until PD-39 has a provider to register. An ESLint `no-restricted-imports` block fences the folder, following the workspace-boundary precedent from PD-10.

**Tech Stack:** NestJS 12 (ESM, `module: nodenext` — every relative import ends in `.js`), Zod 4, TypeScript 5.9.3 with `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals` and `isolatedModules`. No new dependency, no migration.

**Spec:** [`docs/superpowers/specs/2026-09-18-pd-38-card-source-provider-design.md`](../specs/2026-09-18-pd-38-card-source-provider-design.md)

## Global Constraints

- **Work directly on `dev`.** No feature branches, no pull requests.
- **Commit subjects are `[PD-38]: short lowercase description`**, no trailing period. Bodies end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. A `feat:` or `docs:` prefix is rejected by the commit-msg hook.
- **No automated tests in v1** (`docs/PRD.md` §20). No test files, runners, dependencies, or CI test step. **This overrides the TDD structure the writing-plans skill normally imposes.** Every task's red/green cycle is a measurement against real data or a real boot, run by hand.
- **Every commit compiles.** `pnpm typecheck` and `pnpm lint` pass from the repository root before each one. The task order exists to make this possible — do not reorder.
- **ESM.** Relative imports inside `apps/api` carry the `.js` extension or the build fails.
- **`isolatedModules` is on.** Type-only exports use `export type { … }`, type-only imports `import type { … }`.
- **No migration, no dependency.** If a step seems to need either, stop — the spec is wrong.
- **`SyncModule` is not imported into `AppModule`.** Task 4 explains why; only its verification adds the import, and it reverts it.
- **Verified claims only.** If a measurement contradicts the spec, report the contradiction rather than adjusting the claim to fit.

### Shared shell setup

```bash
cd /m/projects/pokedrop
SCRATCH="/c/Users/MaxSt/AppData/Local/Temp/claude/M--projects-pokedrop/4e8570a8-d95e-47c6-b109-3f4155daaaeb/scratchpad"
```

The fixtures the probes read were captured live on 2026-09-18 and already exist in `$SCRATCH`:

| File | What it is |
| --- | --- |
| `ptcg-sets.json` | `GET https://api.pokemontcg.io/v2/sets?pageSize=2` — 200 |
| `tcgdex-set.json` | `GET https://api.tcgdex.net/v2/en/sets/base1` — 200, full |
| `tcgdex-card.json` | `GET https://api.tcgdex.net/v2/en/cards/base1-4` — 200, full |

If any is missing, re-fetch it with the URL in the table before starting.

**Probes live in `apps/api/dist/`.** That directory is gitignored, and a probe has to sit inside `apps/api` because Node resolves bare imports (`zod`, `@pokedrop/shared`) relative to the file, not the working directory. This cost commands in PD-36 and PD-132; do not rediscover it.

**Build before writing a probe, never after.** `nest build` clears `dist/`, so a probe written first is deleted by the build that was supposed to make it runnable.

```bash
pnpm --filter @pokedrop/shared build && pnpm --filter @pokedrop/api build
```

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/api/src/sync/providers/provider.dto.ts` | `SetDTOSchema`, `CardDTOSchema`, `PriceDTOSchema` and their inferred types. Nothing else. |
| `apps/api/src/sync/providers/provider.errors.ts` | `ProviderError` and its three subclasses; the `ProviderItemError` value type. |
| `apps/api/src/sync/providers/card-source-provider.ts` | `CardSourceName`, `FetchCardsParams`, `CardPage`, `CardSourceProvider`, `CardSourceRegistry`, the two tokens. |
| `apps/api/src/sync/providers/index.ts` | The folder's entire public surface. Everything outside imports from here. |
| `apps/api/src/sync/sync.module.ts` | Provides `CARD_SOURCE_REGISTRY` and `CARD_SOURCE_PROVIDER`. |
| `apps/api/src/sync/index.ts` | Re-exports `SyncModule` and the providers surface. |
| `apps/api/src/sync/README.md` | The boundary rule and the error taxonomy, beside the code they govern. |

Four small files rather than one `provider.types.ts`: the DTOs are consumed by every mapper, the errors by the circuit breaker, and the interface by the processors. They change for different reasons and on different tickets.

### Why the tasks are in this order

`CardSourceName` is inferred from `AppConfig['providers']['active']`, so the configuration has to exist before any file naming that type will compile. Configuration is therefore Task 1, not an afterthought bundled with the module.

The interface and the error taxonomy reference each other — `CardPage.skipped` is a `ProviderItemError[]`, and every error carries a `CardSourceName`. They are one reviewable unit and land in one task.

---

## Task 1: The active provider becomes configuration

**Files:**
- Modify: `apps/api/src/config/env.schema.ts` (after the `TCGDEX_BASE_URL` line, around line 76)
- Modify: `apps/api/src/config/app.config.ts` (the `providers` block)
- Modify: `.env.example`, `.env` (the `External providers` block, around line 72)

**Interfaces:**
- Consumes: nothing.
- Produces: `AppConfig['providers']['active']`, typed `'pokemontcg' | 'tcgdex'`. Task 3 infers `CardSourceName` from it and Task 4 reads it in the registry lookup.

- [ ] **Step 1: Add the environment variable**

In `apps/api/src/config/env.schema.ts`, directly after the `TCGDEX_BASE_URL` line:

```ts
    // Which provider the sync layer reads from. pokemontcg.io is primary per
    // docs/PRD.md section 15, and stays primary despite answering 500 on
    // /v2/cards on 2026-09-18: it is the only one of the two with a bulk path
    // to full card data — up to 250 cards per request against TCGdex's one,
    // which is roughly 80 requests for a full catalog against 20 000.
    //
    // Changing this value is the whole of "changing provider". No code moves.
    CARD_SOURCE_PROVIDER: z.enum(['pokemontcg', 'tcgdex']).default('pokemontcg'),
```

- [ ] **Step 2: Surface it on the typed config**

In `apps/api/src/config/app.config.ts`, inside the existing `providers` block, as the first entry:

```ts
    providers: {
      /**
       * The active card source. `CardSourceName` in sync/providers is inferred
       * from this field, so adding a provider means editing the enum in
       * env.schema.ts and nothing else.
       */
      active: env.CARD_SOURCE_PROVIDER,
      /** Null is valid: the provider serves anonymous callers at a lower rate limit. */
      pokemonTcgApiKey: env.POKEMONTCG_API_KEY ?? null,
      pokemonTcgBaseUrl: env.POKEMONTCG_BASE_URL,
      tcgdexBaseUrl: env.TCGDEX_BASE_URL,
    },
```

- [ ] **Step 3: Document it in both env files**

In `.env.example` **and** `.env`, inside the `External providers` block, directly after the `TCGDEX_BASE_URL` line:

```bash

# pokemontcg | tcgdex. Which source the sync layer reads from.
#
# pokemontcg is primary: it returns up to 250 full cards per request, where
# TCGdex serves full card data one card at a time — roughly 80 requests for the
# whole catalog against 20 000. TCGdex is the fallback PD-43 switches to.
#
# Switching is this line alone; no code changes.
CARD_SOURCE_PROVIDER=pokemontcg
```

- [ ] **Step 4: Confirm the default holds and a bad value is named**

```bash
pnpm typecheck
pnpm --filter @pokedrop/api build
node -e "
const { parseEnv } = require('./apps/api/dist/config/env.schema.js');
" 2>/dev/null || true
CARD_SOURCE_PROVIDER=scrydex node apps/api/dist/main.js
```

Expected: the process exits without listening, and the output names the variable:

```
Invalid environment configuration:
  · CARD_SOURCE_PROVIDER: Invalid option: expected one of "pokemontcg"|"tcgdex"
```

Then confirm the default:

```bash
node apps/api/dist/main.js
```

Expected: it listens on 4000 as before. Stop it.

The exact wording of the Zod message may differ by version; what matters is that the variable is named and the process refuses to start. If it starts with an invalid value, `validate: parseEnv` is not reaching the new field — check that the key was added inside the `z.object`, above the two `.refine` calls.

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint && pnpm typecheck
git add apps/api/src/config/env.schema.ts apps/api/src/config/app.config.ts .env.example
git commit -F - <<'EOF'
[PD-38]: make the active card source a configuration value

pokemontcg stays the default. It answered 500 on /v2/cards on 2026-09-18 while
/v2/sets served normally, but it is still the only one of the two with a bulk
path to full card data — up to 250 cards per request against TCGdex's one.

Verified: an unknown value is refused at boot with the variable named, and the
default boots as before.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

`.env` is gitignored and is not staged; only `.env.example` is committed.

---

## Task 2: The normalized DTOs

**Files:**
- Create: `apps/api/src/sync/providers/provider.dto.ts`
- Probe: `apps/api/dist/probe-dto.mjs` (throwaway, gitignored)

**Interfaces:**
- Consumes: `@pokedrop/shared` — `CardIdSchema`, `SetIdSchema`, `RaritySchema`, `WeaknessSchema`, `ResistanceSchema`, `AttackSchema`, `AbilitySchema`, `LegalitiesSchema`, `PriceSourceSchema`.
- Produces: `SetDTOSchema` / `SetDTO`, `CardDTOSchema` / `CardDTO`, `PriceDTOSchema` / `PriceDTO`. Task 3 puts them in `CardPage` and the interface; every mapper in PD-39 and PD-40 produces them.

- [ ] **Step 1: Write the DTO module**

Create `apps/api/src/sync/providers/provider.dto.ts`:

```ts
import { z } from 'zod';
import {
  AbilitySchema,
  AttackSchema,
  CardIdSchema,
  LegalitiesSchema,
  PriceSourceSchema,
  RaritySchema,
  ResistanceSchema,
  SetIdSchema,
  WeaknessSchema,
} from '@pokedrop/shared';

/**
 * What a provider returns once its own mapper has run — provider-neutral by
 * construction, because the shape is taken from our Prisma models rather than
 * from any upstream payload.
 *
 * Dates are `z.date()` and not `z.coerce.date()` on purpose. The schemas in
 * @pokedrop/shared coerce because they serve both the wire and Prisma; here the
 * only producer is a mapper inside this folder, so accepting a string would do
 * nothing but hide a mapper that forgot to parse one.
 */
export const SetDTOSchema = z.object({
  id: SetIdSchema,
  name: z.string().min(1),
  series: z.string().min(1),
  releaseDate: z.date(),
  printedTotal: z.number().int().min(0),
  total: z.number().int().min(0),
  symbolUrl: z.url().nullable(),
  logoUrl: z.url().nullable(),
});
export type SetDTO = z.infer<typeof SetDTOSchema>;

/**
 * A card as the catalog path carries it.
 *
 * `latestPriceUsd`, `latestPriceEur` and `priceUpdatedAt` are absent, and their
 * absence is the point: those three columns belong to the price path
 * (docs/Architecture.md section 7), and a type with no field for them cannot
 * express an overwrite of a fresh price with a stale one. The separation is
 * structural rather than a convention somebody has to remember.
 */
export const CardDTOSchema = z.object({
  id: CardIdSchema,
  setId: SetIdSchema,
  name: z.string().min(1),
  supertype: z.string().min(1),
  subtypes: z.array(z.string()),
  hp: z.number().int().min(0).nullable(),
  types: z.array(z.string()),
  rarity: RaritySchema.nullable(),
  retreatCost: z.array(z.string()),
  weaknesses: z.array(WeaknessSchema),
  resistances: z.array(ResistanceSchema),
  attacks: z.array(AttackSchema),
  abilities: z.array(AbilitySchema),
  legalities: LegalitiesSchema,
  nationalPokedexNumbers: z.array(z.number().int().min(1)),
  imageSmall: z.url(),
  imageLarge: z.url(),
  tcgplayerId: z.string().nullable(),
  cardmarketId: z.string().nullable(),
});
export type CardDTO = z.infer<typeof CardDTOSchema>;

/**
 * One captured price point — what PriceSnapshot stores, minus its own id.
 *
 * A card yields up to two of these, one per source. `currency` is derived from
 * the source by the mapper rather than trusted from the payload.
 */
export const PriceDTOSchema = z.object({
  cardId: CardIdSchema,
  source: PriceSourceSchema,
  currency: z.string().length(3),
  market: z.number().nonnegative().nullable(),
  low: z.number().nonnegative().nullable(),
  mid: z.number().nonnegative().nullable(),
  high: z.number().nonnegative().nullable(),
  capturedAt: z.date(),
});
export type PriceDTO = z.infer<typeof PriceDTOSchema>;
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS. A failure here means a name in `@pokedrop/shared` differs from the import list — check `packages/shared/src/entities/card.ts` and `enums.ts` rather than declaring a local copy of the schema.

- [ ] **Step 3: Build, then write the probe**

```bash
pnpm --filter @pokedrop/shared build && pnpm --filter @pokedrop/api build
```

Create `apps/api/dist/probe-dto.mjs`:

```js
import { readFileSync } from 'node:fs';
import { SetDTOSchema, CardDTOSchema } from './sync/providers/provider.dto.js';

const dir = process.argv[2];
const read = (f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));

// 1. pokemontcg.io set -> SetDTO. The slash-separated date is what to watch.
const ptcg = read('ptcg-sets.json').data[0];
const fromPtcg = SetDTOSchema.safeParse({
  id: ptcg.id,
  name: ptcg.name,
  series: ptcg.series,
  releaseDate: new Date(ptcg.releaseDate.replace(/\//g, '-')),
  printedTotal: ptcg.printedTotal,
  total: ptcg.total,
  symbolUrl: ptcg.images?.symbol ?? null,
  logoUrl: ptcg.images?.logo ?? null,
});
console.log('ptcg set   :', fromPtcg.success, fromPtcg.success ? fromPtcg.data.releaseDate.toISOString() : fromPtcg.error.issues);

// 2. TCGdex set detail -> the same SetDTO, from a completely different shape.
const tcg = read('tcgdex-set.json');
const fromTcgdex = SetDTOSchema.safeParse({
  id: tcg.id,
  name: tcg.name,
  series: tcg.serie.name,
  releaseDate: new Date(tcg.releaseDate),
  printedTotal: tcg.cardCount.official,
  total: tcg.cardCount.total,
  symbolUrl: tcg.symbol ?? null,
  logoUrl: tcg.logo ?? null,
});
console.log('tcgdex set :', fromTcgdex.success, fromTcgdex.success ? fromTcgdex.data.releaseDate.toISOString() : fromTcgdex.error.issues);

// 3. Both must be the same instant, or the two mappers disagree about a date
//    the mirror will treat as one value.
if (fromPtcg.success && fromTcgdex.success) {
  console.log('same date  :', fromPtcg.data.releaseDate.getTime() === fromTcgdex.data.releaseDate.getTime());
}

// 4. TCGdex card -> CardDTO. Exercises every shape difference at once:
//    category/supertype, stage/subtypes, retreat int/array, damage number/string,
//    effect/text, legal booleans/strings, dexId, and the extensionless image.
const c = read('tcgdex-card.json');
const img = (suffix) => `${c.image}/${suffix}`;
const toCard = (raw) =>
  CardDTOSchema.safeParse({
    id: raw.id,
    setId: raw.set.id,
    name: raw.name,
    supertype: raw.category,
    subtypes: raw.stage ? [raw.stage] : [],
    hp: raw.hp ?? null,
    types: raw.types ?? [],
    rarity: raw.rarity ?? null,
    retreatCost: Array.from({ length: raw.retreat ?? 0 }, () => 'Colorless'),
    weaknesses: raw.weaknesses ?? [],
    resistances: raw.resistances ?? [],
    attacks: (raw.attacks ?? []).map((a) => ({
      name: a.name,
      cost: a.cost ?? [],
      convertedEnergyCost: (a.cost ?? []).length,
      damage: String(a.damage ?? ''),
      text: a.effect ?? '',
    })),
    abilities: (raw.abilities ?? []).map((a) => ({ name: a.name, text: a.effect ?? '', type: a.type })),
    legalities: Object.fromEntries(Object.entries(raw.legal ?? {}).map(([k, v]) => [k, v ? 'Legal' : 'Illegal'])),
    nationalPokedexNumbers: raw.dexId ?? [],
    imageSmall: img('low.webp'),
    imageLarge: img('high.png'),
    tcgplayerId: raw.variants_detailed?.[0]?.thirdParty?.tcgplayer?.toString() ?? null,
    cardmarketId: raw.variants_detailed?.[0]?.thirdParty?.cardmarket?.toString() ?? null,
  });

const card = toCard(c);
console.log('tcgdex card:', card.success, card.success ? card.data.retreatCost : card.error.issues);

// 5. A date that arrived as a string is refused, not quietly coerced.
const stringDate = SetDTOSchema.safeParse({ ...fromTcgdex.data, releaseDate: '1999-01-09' });
console.log('string date rejected:', !stringDate.success);

// 6. A card missing a required field is refused, and the issue names the field.
const broken = toCard({ ...c, name: '' });
console.log('empty name rejected :', !broken.success, broken.success ? '' : broken.error.issues[0].path.join('.'));
```

- [ ] **Step 4: Run the probe**

```bash
node apps/api/dist/probe-dto.mjs "$SCRATCH"
```

Expected:

```
ptcg set   : true 1999-01-09T00:00:00.000Z
tcgdex set : true 1999-01-09T00:00:00.000Z
same date  : true
tcgdex card: true [ 'Colorless', 'Colorless', 'Colorless' ]
string date rejected: true
empty name rejected : true name
```

Two providers with nothing in common produce identical `SetDTO`s from the same real set, and the strict `z.date()` refuses a string. If `same date` is false, one of the two date parses is wrong — fix the probe's mapping, not the schema.

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint && pnpm typecheck
git add apps/api/src/sync/providers/provider.dto.ts
git commit -F - <<'EOF'
[PD-38]: add the provider dto contract

Shaped from the Prisma catalog models rather than from any upstream payload.
CardDTO deliberately omits the three price columns, so a catalog sync has no
field in which to overwrite a fresher price with a staler one.

Verified against live payloads from both providers: a pokemontcg.io set and a
TCGdex set map to identical SetDTOs down to the instant, and a TCGdex card maps
to a valid CardDTO across every shape difference at once.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 3: The interface, the errors, and the folder's surface

The interface and the taxonomy reference each other — `CardPage.skipped` is a `ProviderItemError[]`, and every error carries a `CardSourceName`. They are one unit.

**Files:**
- Create: `apps/api/src/sync/providers/card-source-provider.ts`
- Create: `apps/api/src/sync/providers/provider.errors.ts`
- Create: `apps/api/src/sync/providers/index.ts`
- Probe: `apps/api/dist/probe-contract.mjs` (throwaway)

**Interfaces:**
- Consumes: `AppConfig` (Task 1); `CardDTO`, `PriceDTO`, `SetDTO` (Task 2).
- Produces: `CardSourceName`, `FetchCardsParams`, `CardPage`, `CardSourceProvider`, `CardSourceRegistry`, `CARD_SOURCE_PROVIDER`, `CARD_SOURCE_REGISTRY`, `ProviderError`, `ProviderUnavailableError`, `ProviderRateLimitError`, `ProviderContractError`, `ProviderItemError`, and the `index.ts` everything outside imports from.

- [ ] **Step 1: Write the interface**

Create `apps/api/src/sync/providers/card-source-provider.ts`:

```ts
import type { AppConfig } from '../../config/index.js';
import type { CardDTO, PriceDTO, SetDTO } from './provider.dto.js';
import type { ProviderItemError } from './provider.errors.js';

/**
 * The providers the sync layer knows about.
 *
 * Inferred from the configuration rather than declared beside it, so the enum
 * in env.schema.ts is the single place a provider is named. A second
 * declaration here could drift from the first, and the drift would only show up
 * as a registry miss at boot.
 */
export type CardSourceName = AppConfig['providers']['active'];

export interface FetchCardsParams {
  /** Absent means the whole catalog. PD-42 batches per set. */
  setId?: string;
  page: number;
  pageSize: number;
}

/**
 * One page of cards, rather than the flat array the ticket's signature implies.
 *
 * PD-42 has to resume after a crash and PD-39 has to page across the full
 * catalog; neither is possible if a provider hides pagination behind an array.
 * A provider that loops internally holds an entire catalog in memory before
 * returning anything, and a crash halfway leaves nothing to resume from,
 * because no caller ever saw a page boundary. Returning a page puts the loop in
 * the processor — the only layer that can persist where it got to.
 */
export interface CardPage {
  items: CardDTO[];
  /** Items that failed to parse. Non-fatal by design; see provider.errors.ts. */
  skipped: ProviderItemError[];
  page: number;
  pageSize: number;
  /** Matching cards across every page, not the length of `items`. */
  total: number;
  hasMore: boolean;
}

/**
 * The seam. Everything the application knows about an external card API.
 *
 * `fetchSets` keeps a flat return: 176 sets is one small response, and
 * paginating it would be ceremony with no resume point worth saving.
 *
 * `fetchPrices` is declared here although M4 is its first caller — the ticket
 * requires this interface to be sufficient for price sync as well as catalog
 * sync. Both providers embed prices inside the card payload, so the honest
 * implementation fetches those cards and projects the price blocks out.
 */
export interface CardSourceProvider {
  readonly name: CardSourceName;
  fetchSets(): Promise<SetDTO[]>;
  fetchCards(params: FetchCardsParams): Promise<CardPage>;
  fetchPrices(cardIds: string[]): Promise<PriceDTO[]>;
}

export type CardSourceRegistry = ReadonlyMap<CardSourceName, CardSourceProvider>;

/** The provider named by configuration. What M3 and M4 consumers inject. */
export const CARD_SOURCE_PROVIDER = Symbol('CARD_SOURCE_PROVIDER');

/**
 * Every registered provider, by name.
 *
 * Present from the start although PD-43 is its only consumer: introducing it
 * later would mean editing every call site that had injected the single token,
 * and it costs three lines here.
 */
export const CARD_SOURCE_REGISTRY = Symbol('CARD_SOURCE_REGISTRY');
```

- [ ] **Step 2: Write the error taxonomy**

Create `apps/api/src/sync/providers/provider.errors.ts`:

```ts
import type { CardSourceName } from './card-source-provider.js';

/**
 * Base for everything this layer throws. `provider` sits on the base so a log
 * line always names the upstream that failed, whatever the reason was.
 */
export class ProviderError extends Error {
  constructor(
    readonly provider: CardSourceName,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    // Without this, every subclass reports "Error" in a stack trace: the name
    // comes from the prototype, and subclassing does not set it. A 429 and a
    // 500 would be indistinguishable in the log.
    this.name = new.target.name;
  }
}

/**
 * 5xx, timeout, DNS failure, connection reset — the upstream is not answering
 * usefully. Counts toward PD-43's failover.
 *
 * The canonical instance, measured 2026-09-18: pokemontcg.io answering 500 on
 * /v2/cards while /v2/sets served normally.
 */
export class ProviderUnavailableError extends ProviderError {}

/**
 * 429.
 *
 * Deliberately not a failover signal. A rate limit means slow down, not "this
 * provider is broken", and switching on one would move the load onto the
 * fallback and rate-limit that too — turning a delay into an outage.
 */
export class ProviderRateLimitError extends ProviderError {
  constructor(
    provider: CardSourceName,
    message: string,
    /** From `Retry-After` when the upstream sent one. */
    readonly retryAfterMs: number | null,
    options?: ErrorOptions,
  ) {
    super(provider, message, options);
  }
}

/**
 * The response envelope did not parse at all — upstream changed its contract.
 * Counts toward failover, and is the loudest of the three: continuing would
 * fill the mirror with nonsense.
 */
export class ProviderContractError extends ProviderError {}

/**
 * Not an Error, and never thrown.
 *
 * One item inside a well-formed response failed to parse. It is skipped and
 * described, so a single malformed card cannot discard the good ones beside it
 * — which is what makes PD-42's "a single failing set does not abort the entire
 * run" reachable.
 */
export interface ProviderItemError {
  provider: CardSourceName;
  /** Null when the payload was malformed enough that no id could be read. */
  itemId: string | null;
  message: string;
}
```

- [ ] **Step 3: Write the folder's public surface**

Create `apps/api/src/sync/providers/index.ts`:

```ts
/**
 * The entire public surface of this folder.
 *
 * Nothing outside `sync/providers/` may import a provider-specific type — the
 * fourth item of PD-38's scope. The rule is enforced by `no-restricted-imports`
 * in eslint.config.mjs rather than left as a convention, following the
 * workspace boundary PD-10 established.
 */
export { CARD_SOURCE_PROVIDER, CARD_SOURCE_REGISTRY } from './card-source-provider.js';
export type {
  CardPage,
  CardSourceName,
  CardSourceProvider,
  CardSourceRegistry,
  FetchCardsParams,
} from './card-source-provider.js';

export { CardDTOSchema, PriceDTOSchema, SetDTOSchema } from './provider.dto.js';
export type { CardDTO, PriceDTO, SetDTO } from './provider.dto.js';

export {
  ProviderContractError,
  ProviderError,
  ProviderRateLimitError,
  ProviderUnavailableError,
} from './provider.errors.js';
export type { ProviderItemError } from './provider.errors.js';
```

- [ ] **Step 4: Prove `CardSourceName` is really derived**

Add this line temporarily at the end of `card-source-provider.ts`:

```ts
export const _assertCardSourceName: CardSourceName = 'tcgdex';
```

```bash
pnpm typecheck
```

Expected: PASS.

Now change the enum in `env.schema.ts` to `z.enum(['pokemontcg'])` and run it again:

```bash
pnpm typecheck
```

Expected: FAIL, naming `card-source-provider.ts` and the `_assertCardSourceName` line — `Type '"tcgdex"' is not assignable to type '"pokemontcg"'`.

If it passes, the derivation is not wired: check that `app.config.ts` exposes `active` and that `card-source-provider.ts` reads `AppConfig['providers']['active']` rather than declaring its own union.

Restore `z.enum(['pokemontcg', 'tcgdex'])`, delete the `_assertCardSourceName` line, and run `pnpm typecheck` once more — expected PASS.

- [ ] **Step 5: Build, then write the probe**

```bash
pnpm --filter @pokedrop/api build
```

Create `apps/api/dist/probe-contract.mjs`:

```js
import { readFileSync } from 'node:fs';
import {
  ProviderError,
  ProviderUnavailableError,
  ProviderRateLimitError,
  ProviderContractError,
} from './sync/providers/provider.errors.js';
import { CardDTOSchema } from './sync/providers/provider.dto.js';

const down = new ProviderUnavailableError('pokemontcg', '/v2/cards answered 500');
const limited = new ProviderRateLimitError('pokemontcg', 'rate limited', 30_000);
const broken = new ProviderContractError('tcgdex', 'response was not an array');

// One catch block can log all three.
console.log('all are ProviderError:', [down, limited, broken].every((e) => e instanceof ProviderError));

// PD-43 branches on these being distinct.
console.log('unavailable is not rate limit:', !(down instanceof ProviderRateLimitError));
console.log('rate limit is not unavailable:', !(limited instanceof ProviderUnavailableError));
console.log('contract is not unavailable  :', !(broken instanceof ProviderUnavailableError));

console.log('names  :', down.name, limited.name, broken.name);
console.log('provider on base:', down.provider, broken.provider);
console.log('retryAfterMs    :', limited.retryAfterMs);

const wrapped = new ProviderUnavailableError('tcgdex', 'fetch failed', { cause: new TypeError('ECONNRESET') });
console.log('cause preserved :', wrapped.cause instanceof TypeError);

// The envelope/item split, in miniature. This is the loop PD-39's mapper will
// write for real; here it only has to demonstrate that the types support it.
const dir = process.argv[2];
const good = JSON.parse(readFileSync(`${dir}/tcgdex-card.json`, 'utf8'));
const map = (raw) => ({
  id: raw.id,
  setId: raw.set.id,
  name: raw.name,
  supertype: raw.category,
  subtypes: raw.stage ? [raw.stage] : [],
  hp: raw.hp ?? null,
  types: raw.types ?? [],
  rarity: raw.rarity ?? null,
  retreatCost: Array.from({ length: raw.retreat ?? 0 }, () => 'Colorless'),
  weaknesses: raw.weaknesses ?? [],
  resistances: raw.resistances ?? [],
  attacks: (raw.attacks ?? []).map((a) => ({
    name: a.name,
    cost: a.cost ?? [],
    convertedEnergyCost: (a.cost ?? []).length,
    damage: String(a.damage ?? ''),
    text: a.effect ?? '',
  })),
  abilities: (raw.abilities ?? []).map((a) => ({ name: a.name, text: a.effect ?? '', type: a.type })),
  legalities: Object.fromEntries(Object.entries(raw.legal ?? {}).map(([k, v]) => [k, v ? 'Legal' : 'Illegal'])),
  nationalPokedexNumbers: raw.dexId ?? [],
  imageSmall: `${raw.image}/low.webp`,
  imageLarge: `${raw.image}/high.png`,
  tcgplayerId: null,
  cardmarketId: null,
});

function toPage(envelope, provider) {
  if (!Array.isArray(envelope)) {
    throw new ProviderContractError(provider, 'expected an array of cards');
  }
  const items = [];
  const skipped = [];
  for (const raw of envelope) {
    const parsed = CardDTOSchema.safeParse(map(raw));
    if (parsed.success) items.push(parsed.data);
    else skipped.push({ provider, itemId: raw.id ?? null, message: parsed.error.issues[0].message });
  }
  return { items, skipped, page: 1, pageSize: envelope.length, total: envelope.length, hasMore: false };
}

const page = toPage([good, { ...good, id: 'base1-99', hp: 'sixty' }], 'tcgdex');
console.log('kept  :', page.items.length, page.items[0].id);
console.log('skipped:', page.skipped.length, page.skipped[0]?.itemId, '|', page.skipped[0]?.message);

try {
  toPage({ notAnArray: true }, 'tcgdex');
  console.log('envelope fatal  : false');
} catch (e) {
  console.log('envelope fatal  :', e instanceof ProviderContractError);
}
```

- [ ] **Step 6: Run the probe**

```bash
node apps/api/dist/probe-contract.mjs "$SCRATCH"
```

Expected:

```
all are ProviderError: true
unavailable is not rate limit: true
rate limit is not unavailable: true
contract is not unavailable  : true
names  : ProviderUnavailableError ProviderRateLimitError ProviderContractError
provider on base: pokemontcg tcgdex
retryAfterMs    : 30000
cause preserved : true
kept  : 1 base1-4
skipped: 1 base1-99 | <a message naming the hp field>
envelope fatal  : true
```

The last three lines are the whole point of the split: one good card survives a bad one beside it, the bad one is named, and a response of the wrong shape entirely still throws.

If `names` prints `Error` three times, the `new.target.name` line was dropped.

- [ ] **Step 7: Lint and commit**

```bash
pnpm lint && pnpm typecheck
git add apps/api/src/sync/providers/card-source-provider.ts apps/api/src/sync/providers/provider.errors.ts apps/api/src/sync/providers/index.ts
git commit -F - <<'EOF'
[PD-38]: add the card source provider interface and error taxonomy

fetchCards returns a page rather than the flat array the ticket's signature
implies. PD-42 must resume after a crash and PD-39 must page across the whole
catalog, and neither works if a provider hides pagination: the caller never sees
a boundary to resume from, and a full catalog lands in memory first.

The taxonomy's load-bearing distinction is 429 against 5xx. PD-43 counts
unavailability and contract breaks toward failover and must not count a rate
limit, which would move the load onto the fallback and rate-limit that one too.

Verified: a malformed item is skipped and named while the good card beside it
survives, and a response of the wrong shape entirely throws.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 4: The module and the registry

**Files:**
- Create: `apps/api/src/sync/sync.module.ts`, `apps/api/src/sync/index.ts`
- Temporarily modify then revert: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `APP_CONFIG`, `AppConfig` (existing); `CARD_SOURCE_PROVIDER`, `CARD_SOURCE_REGISTRY`, `CardSourceName`, `CardSourceProvider`, `CardSourceRegistry` (Task 3).
- Produces: `SyncModule`. PD-39 imports it into `AppModule` and fills the registry.

- [ ] **Step 1: Write `SyncModule`**

Create `apps/api/src/sync/sync.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import {
  CARD_SOURCE_PROVIDER,
  CARD_SOURCE_REGISTRY,
  type CardSourceName,
  type CardSourceProvider,
  type CardSourceRegistry,
} from './providers/index.js';

/**
 * The sync layer's wiring.
 *
 * Deliberately not imported into AppModule by PD-38. Nest instantiates
 * providers eagerly, so wiring it while the registry is still empty would make
 * the refusal below fire on every boot and leave `dev` unable to start until
 * PD-39 landed — a guard against misconfiguration becoming the misconfiguration.
 * PD-39 wires it in the same commit that registers the first provider.
 *
 * Not @Global either: the processors in PD-42 and the catalog module in PD-45
 * import it explicitly, which keeps the dependency visible.
 */
@Module({
  providers: [
    {
      provide: CARD_SOURCE_REGISTRY,
      // Empty until PD-39 registers PokemonTcgClient and PD-40 TcgdexClient.
      useFactory: (): CardSourceRegistry => new Map<CardSourceName, CardSourceProvider>(),
    },
    {
      provide: CARD_SOURCE_PROVIDER,
      inject: [CARD_SOURCE_REGISTRY, APP_CONFIG],
      useFactory: (registry: CardSourceRegistry, config: AppConfig): CardSourceProvider => {
        const provider = registry.get(config.providers.active);

        if (!provider) {
          // Named at boot, in the style of parseEnv, rather than surfacing as a
          // null dereference inside a job at three in the morning.
          throw new Error(
            `No card source provider is registered for "${config.providers.active}". ` +
              'Providers are registered by PD-39 (pokemontcg) and PD-40 (tcgdex).',
          );
        }

        return provider;
      },
    },
  ],
  exports: [CARD_SOURCE_PROVIDER, CARD_SOURCE_REGISTRY],
})
export class SyncModule {}
```

Create `apps/api/src/sync/index.ts`:

```ts
export { SyncModule } from './sync.module.js';
export * from './providers/index.js';
```

- [ ] **Step 2: Observe the boot refusal**

Add `SyncModule` to the `imports` array in `apps/api/src/app.module.ts`, with the import line `import { SyncModule } from './sync/index.js';`, then:

```bash
pnpm --filter @pokedrop/api build && node apps/api/dist/main.js
```

Expected: the process exits without listening, and the output contains:

```
No card source provider is registered for "pokemontcg". Providers are registered by PD-39 (pokemontcg) and PD-40 (tcgdex).
```

- [ ] **Step 3: Confirm the selection is by configured name**

With the import still in place:

```bash
CARD_SOURCE_PROVIDER=tcgdex node apps/api/dist/main.js
```

Expected: the same refusal, but naming `tcgdex`:

```
No card source provider is registered for "tcgdex". …
```

This is what the first acceptance criterion can be shown to mean today: the configured value reaches the registry lookup and selects by it. The full criterion — swapping providers changes no code — is demonstrable once PD-39 and PD-40 have registered implementations.

- [ ] **Step 4: Revert the wiring and confirm the API still boots**

Remove the `SyncModule` import and the `imports` entry from `app.module.ts`.

```bash
git diff --stat apps/api/src/app.module.ts
pnpm --filter @pokedrop/api build && node apps/api/dist/main.js
```

Expected: `git diff` prints nothing for that file, and the API listens on 4000. Stop it.

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint && pnpm typecheck
git status --short
git add apps/api/src/sync/sync.module.ts apps/api/src/sync/index.ts
git commit -F - <<'EOF'
[PD-38]: add the sync module and the provider registry

Two tokens: the configured default that M3 and M4 consumers inject, and the
registry PD-43 needs in order to switch at runtime. Both land now because
introducing the registry later would mean editing every call site.

SyncModule is written but not imported into AppModule. Nest builds providers
eagerly, so wiring an empty registry would make the boot refusal fire on every
start and leave dev unable to run until PD-39. Verified all three ways: imported
it exits naming pokemontcg, with CARD_SOURCE_PROVIDER=tcgdex it exits naming
tcgdex, and unimported the API listens as before.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

`git status --short` must show nothing for `app.module.ts` before the commit.

---

## Task 5: Fence the folder with a lint rule

**Files:**
- Modify: `eslint.config.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: a lint failure for any import of provider internals from outside the folder. No runtime surface.

- [ ] **Step 1: Hoist the existing group to a named const**

At the top of `eslint.config.mjs`, after the imports:

```js
/**
 * Shared so the two `apps/api` blocks below cannot drift. Flat config resolves
 * a rule by last match rather than by merging, so the block that re-states
 * `no-restricted-imports` for the providers folder has to repeat this group or
 * it would silently switch the workspace boundary off for those files.
 */
const apiMustNotImportWeb = {
  // These match the import specifier as written, not the resolved path, so the
  // relative form has to be listed too.
  group: ['@pokedrop/web', '@pokedrop/web/**', '**/apps/web/**', '**/web/app/**', '../**/web/**'],
  message:
    'apps/api must not import from apps/web. Share types and schemas through @pokedrop/shared.',
};

/**
 * PD-38's provider seam. Everything outside sync/providers/ goes through the
 * folder's index.ts, which exports the interface, the DTOs, the errors and the
 * tokens — never a provider's own client, raw schema or mapper.
 *
 * Same caveat as above: the patterns match the specifier as written, so both
 * the `./providers/…` form used from inside sync/ and the `…/sync/providers/…`
 * form used from elsewhere are listed.
 */
const providerInternalsAreSealed = {
  group: [
    '**/sync/providers/*/**',
    './providers/*/**',
    '../providers/*/**',
    '../**/sync/providers/*/**',
  ],
  message:
    'Provider internals stay behind apps/api/src/sync/providers/index.ts. Import the interface, DTOs, errors and tokens from there.',
};
```

- [ ] **Step 2: Replace the `apps/api` block and add the exemption**

Replace the existing `apps/api/**/*.ts` `no-restricted-imports` block with these two, in this order:

```js
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [apiMustNotImportWeb, providerInternalsAreSealed] },
      ],
    },
  },
  // The providers folder is what the seal protects, not what it constrains: a
  // client imports its own raw schema and mapper, and may reach a sibling
  // provider by a long path. Last match wins, so this restates the workspace
  // boundary rather than only dropping the seal.
  {
    files: ['apps/api/src/sync/providers/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [apiMustNotImportWeb] }],
    },
  },
```

- [ ] **Step 3: Confirm the rule bites from outside**

Create a throwaway internal file `apps/api/src/sync/providers/pokemon-tcg/probe.ts`:

```ts
export const PROBE = 'pd-38';
```

In `apps/api/src/app.service.ts`, add at the top:

```ts
import { PROBE } from './sync/providers/pokemon-tcg/probe.js';
```

and use it inside `getHello` so `noUnusedLocals` does not mask the check — return `` `Hello World! ${PROBE}` ``.

```bash
pnpm lint
```

Expected: FAIL on `apps/api/src/app.service.ts` with

```
Provider internals stay behind apps/api/src/sync/providers/index.ts. Import the interface, DTOs, errors and tokens from there.
```

- [ ] **Step 4: Confirm the folder itself is exempt**

The patterns only match a specifier containing `sync/providers/` or `./providers/`, so an ordinary sibling import inside the folder was never going to be caught. What the exemption block actually protects is the long-path form, which is the one somebody produces by copy-pasting.

Create `apps/api/src/sync/providers/tcgdex/probe.ts`:

```ts
export const SIBLING = 'pd-38';
```

and in `apps/api/src/sync/providers/pokemon-tcg/probe.ts`, add the long form:

```ts
import { SIBLING } from '../../../sync/providers/tcgdex/probe.js';

export const PROBE = `pd-38 ${SIBLING}`;
```

```bash
pnpm lint
```

Expected: the `app.service.ts` failure is still reported, and **neither** probe file is. That specifier matches `**/sync/providers/*/**`, so without the exemption block it would be flagged — this is the block working.

If a probe file is also flagged, the second block's `files` glob is wrong.

- [ ] **Step 5: Revert every probe edit**

```bash
git checkout apps/api/src/app.service.ts
rm -rf apps/api/src/sync/providers/pokemon-tcg apps/api/src/sync/providers/tcgdex
pnpm lint && pnpm typecheck
git status --short
```

Expected: both PASS, and `git status` shows only `eslint.config.mjs` modified.

- [ ] **Step 6: Commit**

```bash
git add eslint.config.mjs
git commit -F - <<'EOF'
[PD-38]: fence the provider folder with an import rule

The ticket asks for a documented rule that nothing outside sync/providers may
import a provider-specific type. A documented rule is a rule until someone is in
a hurry, so it is no-restricted-imports instead — the same mechanism PD-10 used
for the workspace boundary.

Flat config resolves a rule by last match rather than by merging, so the block
exempting the providers folder restates the api-from-web group; both now come
from one shared const. Verified both directions: the import fails lint from
app.service.ts and passes inside the folder.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 6: Documentation

**Files:**
- Create: `apps/api/src/sync/README.md`
- Modify: `docs/Architecture.md` §3 (the `CardSourceProvider` block, around line 69)

**Interfaces:**
- Consumes: everything built in Tasks 1–5.
- Produces: nothing importable.

- [ ] **Step 1: Correct the architecture reference**

`docs/Architecture.md` §3 currently prints:

```
CardSourceProvider
  fetchSets(): Promise<SetDTO[]>
  fetchCards(params): Promise<CardDTO[]>
  fetchPrices(cardIds): Promise<PriceDTO[]>
```

Replace that block and the paragraph beneath it with:

````markdown
```
CardSourceProvider
  name: CardSourceName
  fetchSets(): Promise<SetDTO[]>
  fetchCards(params): Promise<CardPage>
  fetchPrices(cardIds): Promise<PriceDTO[]>
```

`fetchCards` returns a page — `{ items, skipped, page, pageSize, total, hasMore }` — rather than a flat array. The catalog sync has to resume after a crash and has to page across the whole catalog, and a provider that loops internally makes both impossible: the caller never sees a page boundary to resume from, and an entire catalog lands in memory before anything returns. `skipped` carries items that failed to parse, so one malformed card does not discard the good ones beside it.

`PokemonTcgClient` is the default; `TcgdexClient` is a fallback the sync layer switches to on repeated failures. The rest of the app is source-agnostic, and `CARD_SOURCE_PROVIDER` in the environment is the whole of choosing between them. The seam lives in `apps/api/src/sync/providers/`, and an ESLint rule keeps provider internals behind its `index.ts`.
````

- [ ] **Step 2: Write the module README**

Create `apps/api/src/sync/README.md`:

```markdown
# Sync module

The seam between this application and whichever card API is behind it. Nothing
outside this folder knows that pokemontcg.io or TCGdex exist.

## Shape

| File | Holds |
| --- | --- |
| `providers/provider.dto.ts` | `SetDTO`, `CardDTO`, `PriceDTO` — provider-neutral, Zod |
| `providers/provider.errors.ts` | the error taxonomy, and `ProviderItemError` |
| `providers/card-source-provider.ts` | the interface, `CardPage`, the two tokens |
| `providers/index.ts` | the folder's entire public surface |
| `sync.module.ts` | the registry and the configured default |

## The boundary, and how it is held

Nothing outside `providers/` may import a provider-specific type. That is not a
convention — `eslint.config.mjs` refuses it, the same way PD-10's rule refuses
`apps/api` importing from `apps/web`. Import from `providers/index.ts`.

Choosing a provider is `CARD_SOURCE_PROVIDER` in the environment and nothing
else. If changing it ever requires a code change outside this folder, the seam
has been broken.

## Three things that will bite

**`CardDTO` has no price fields, and that is deliberate.** `latestPriceUsd`,
`latestPriceEur` and `priceUpdatedAt` belong to the price path. Adding them here
would let a nightly catalog sync overwrite a fresh price with a stale one; with
no field to put it in, it cannot.

**A 429 is not a failover signal.** `ProviderRateLimitError` means slow down.
`ProviderUnavailableError` and `ProviderContractError` mean the upstream is not
serving, and only those two count toward PD-43's circuit breaker. Counting a 429
would move the load onto the fallback and rate-limit that one too.

**A malformed envelope throws; a malformed item does not.** A response that is
not the documented shape raises `ProviderContractError`. One bad card inside a
good response is skipped and reported through `CardPage.skipped`, so it cannot
discard the good ones beside it.

## Measured, 2026-09-18

pokemontcg.io answered 500 on `/v2/cards` — from the origin, `x-runtime`
present — while `/v2/sets` served normally. TCGdex answered everything, but has
no bulk path to full card data: full cards are one request each, roughly 20 000
for a catalog against pokemontcg.io's 80. That is why the primary did not change
when it broke.

## What is not here yet

`SyncModule` is not imported into `AppModule`. Nest builds providers eagerly, so
wiring an empty registry would make the boot refusal fire on every start. PD-39
wires it together with the first provider.

| Ticket | Adds |
| --- | --- |
| PD-39 | `providers/pokemon-tcg/` — client, raw schema, mapper |
| PD-40 | `providers/tcgdex/` — the same against the fallback |
| PD-41 | BullMQ queues and the worker entrypoint |
| PD-42 | `catalog-sync.processor.ts` and the `SyncRun` model |
| PD-43 | failover and the circuit breaker, reading the error taxonomy |
```

- [ ] **Step 3: Format and check**

```bash
npx prettier --write apps/api/src/sync/README.md docs/Architecture.md
npx prettier --check .
pnpm lint && pnpm typecheck
```

Expected: all PASS.

- [ ] **Step 4: Clean up the probes, then commit and push**

```bash
rm -f apps/api/dist/probe-dto.mjs apps/api/dist/probe-contract.mjs
git add apps/api/src/sync/README.md docs/Architecture.md
git commit -F - <<'EOF'
[PD-38]: document the provider seam

Architecture.md printed fetchCards returning a flat array, which is no longer
what the interface says. Left alone it would be untrue on the first page anyone
reads about this seam.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git status --short
git push origin dev
```

`git status --short` must be clean. `apps/api/dist/` is gitignored, so the probes were never tracked; removing them only keeps the next build honest.

---

## Acceptance criteria

Checked against the ticket after Task 6.

- [ ] **Swapping the configured provider changes no code outside the providers folder.** `CARD_SOURCE_PROVIDER` in `.env` is the entire change. Task 4 Step 3 shows the configured value reaching the registry lookup and selecting by name; the criterion is fully demonstrable once PD-39 and PD-40 have registered implementations, and PD-39 should re-check it then.
- [ ] **Malformed upstream payloads are rejected at the boundary with a clear error.** `ProviderContractError` for an envelope, `ProviderItemError` for an item — Task 3 Step 6. Field-level rejection within a DTO — Task 2 Step 4.
- [ ] **The interface is sufficient for both catalog sync and price sync.** `fetchSets` and `fetchCards` serve PD-42; `fetchPrices` and `PriceDTO` serve M4. Task 3 Step 1.
- [ ] **Nothing outside `sync/providers/` may import a provider-specific type.** Enforced rather than documented — Task 5 Steps 3 and 4.

## Out of scope

HTTP clients, retry, backoff and `Retry-After` (PD-39, PD-40) · the two mappers (PD-39, PD-40) · failover and the breaker (PD-43) · BullMQ and the worker (PD-41) · any database write, the `SyncRun` model, cache invalidation (PD-42) · calling `fetchPrices` (M4) · `RarityTier` mapping (PD-45, PD-47) · fixture contract tests (PD-44, deferred).
