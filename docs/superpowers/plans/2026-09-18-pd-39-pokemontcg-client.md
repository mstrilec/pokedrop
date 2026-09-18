# PD-39 PokemonTcgClient Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pokemontcg.io v2 implementation of `CardSourceProvider`, able to complete a full catalog fetch against an upstream that fails 70% of requests.

**Architecture:** Four files behind PD-38's lint fence. `http.ts` owns the two retry policies — quick exponential backoff for 5xx and network faults, `Retry-After` for 429 — and is the only place `fetch` is called. `pokemon-tcg.schema.ts` validates the raw envelope while leaving `data` as `unknown[]`, so one malformed card is skipped rather than failing the page. `pokemon-tcg.mapper.ts` turns raw objects into the DTOs, absorbing every shape difference the spec measured. `pokemon-tcg.client.ts` composes them into the interface and is registered in `SyncModule`, which this ticket finally wires into `AppModule`.

**Tech Stack:** NestJS 12 (ESM, `module: nodenext` — every relative import ends in `.js`), Zod 4, Node 22 `fetch` and `AbortSignal.timeout`. No new dependency, no migration.

**Spec:** [`docs/superpowers/specs/2026-09-18-pd-39-pokemontcg-client-design.md`](../specs/2026-09-18-pd-39-pokemontcg-client-design.md)

## Global Constraints

- **Work directly on `dev`.** No feature branches, no pull requests.
- **Commit subjects are `[PD-39]: short lowercase description`**, no trailing period. Bodies end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **No automated tests in v1** (`docs/PRD.md` §20). **This overrides the TDD structure the writing-plans skill normally imposes.** Every red/green cycle is a measurement against captured payloads or the live API.
- **No paid services** (`docs/PRD.md` §2). Nothing here needs a key; the free key only raises a rate limit.
- **Every commit compiles.** `pnpm typecheck` and `pnpm lint` pass from the repository root before each one.
- **ESM.** Relative imports inside `apps/api` carry the `.js` extension or the build fails.
- **The lint fence is real.** Nothing outside `sync/providers/` may import these files. Adding an import from elsewhere fails `pnpm lint` — that is PD-38 working, not a problem to route around.
- **`hp` is a string upstream**, `printedTotal` can be absent, and there is no TCGplayer or Cardmarket id. All three are measured, not guessed; do not "fix" the mapper to assume otherwise.
- **Verified claims only.** If a measurement contradicts the spec, report the contradiction rather than adjusting the claim to fit.

### Shared shell setup

```bash
cd /m/projects/pokedrop
SCRATCH="/c/Users/MaxSt/AppData/Local/Temp/claude/M--projects-pokedrop/4e8570a8-d95e-47c6-b109-3f4155daaaeb/scratchpad"
```

Captured live on 2026-09-18 and already in `$SCRATCH`:

| File | What it is |
| --- | --- |
| `allsets.json` | `GET /v2/sets?pageSize=250` — all 176 sets, including `me55c` with no `printedTotal` |
| `big.json` | `GET /v2/cards?pageSize=250&page=1` — 250 cards, `totalCount` 20670 |
| `ptcg-cards-real.json` | the same endpoint at `pageSize=2` |

**Probes live in `apps/api/dist/`,** which is gitignored, and must sit inside `apps/api` because Node resolves bare imports relative to the file. **Build before writing a probe, never after** — `nest build` has `deleteOutDir: true` and deletes it. This bit twice during PD-41; write the probe after every build that precedes it.

**The upstream fails ~70% of requests.** Any step that calls it live must loop until it succeeds or the attempt budget is spent. A single `curl` returning 500 proves nothing.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/api/src/sync/providers/pokemon-tcg/http.ts` | the only `fetch` call; timeout, both retry policies, error translation |
| `apps/api/src/sync/providers/pokemon-tcg/pokemon-tcg.schema.ts` | raw Zod schemas for the envelope, a set and a card |
| `apps/api/src/sync/providers/pokemon-tcg/pokemon-tcg.mapper.ts` | raw → `SetDTO`, `CardDTO`, `PriceDTO` |
| `apps/api/src/sync/providers/pokemon-tcg/pokemon-tcg.client.ts` | `CardSourceProvider`, composing the three above |

Split this way because they change for different reasons: the retry policy changes when the upstream's behaviour changes, the schema when the provider adds a field, the mapper when our own model changes, and the client when the interface does.

### Task order

`http.ts` first — it is the only part with a real algorithm, and everything else calls it. Schema before mapper because the mapper consumes its output. The client last, together with registration, because an unregistered provider satisfies none of the acceptance criteria.

---

## Task 1: The HTTP layer and its two retry policies

**Files:**
- Create: `apps/api/src/sync/providers/pokemon-tcg/http.ts`

**Interfaces:**
- Consumes: `ProviderContractError`, `ProviderRateLimitError`, `ProviderUnavailableError` and `CardSourceName` from `../provider.errors.js` and `../card-source-provider.js` (PD-38).
- Produces: `getJson(path, query, options)` returning `Promise<unknown>`, and the `PokemonTcgHttpOptions` type. Task 4's client is the only caller.

- [ ] **Step 1: Write the module**

Create `apps/api/src/sync/providers/pokemon-tcg/http.ts`:

```ts
import type { CardSourceName } from '../card-source-provider.js';
import { ProviderRateLimitError, ProviderUnavailableError } from '../provider.errors.js';

const PROVIDER: CardSourceName = 'pokemontcg';

const RATE_LIMITED = 429;
const SERVER_ERROR_FLOOR = 500;
const BACKOFF_BASE_MS = 250;
const RATE_LIMIT_BACKOFF_MS = 5_000;

export interface PokemonTcgHttpOptions {
  baseUrl: string;
  apiKey: string | null;
  timeoutMs: number;
  maxAttempts: number;
  /**
   * Called once per retry, never on a first-attempt success.
   *
   * Retries are the normal case against this upstream, not an exception, so how
   * often they happen is the number worth watching - PD-42 logs it per sync run
   * and PD-43 sizes its breaker against it. Optional because the production
   * client has nothing useful to do with it until PD-42 wires a logger in.
   */
  onRetry?: (attempt: number, reason: string) => void;
}

/**
 * Half the exponential step plus jitter over the other half, so a batch of
 * concurrent requests does not retry in lockstep and reproduce the burst that
 * failed.
 */
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
 * Two policies, because a 5xx and a 429 mean opposite things. A 5xx from this
 * upstream is an ordinary event - 70% of requests failed when this was written -
 * so it is retried quickly and only becomes a ProviderUnavailableError once the
 * attempt budget is spent. That is what keeps PD-43's breaker measuring "the
 * provider is unusable" rather than "a request failed".
 *
 * A 429 is the opposite: the server is healthy and we are asking too fast.
 * Retry-After is honoured, and the error that escapes is a
 * ProviderRateLimitError, which PD-43 must not count toward failover.
 */
export async function getJson(
  path: string,
  query: Record<string, string | number | undefined>,
  options: PokemonTcgHttpOptions,
): Promise<unknown> {
  const url = new URL(`${options.baseUrl}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.apiKey !== null) {
    headers['X-Api-Key'] = options.apiKey;
  }

  let lastReason = 'no attempt was made';

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    let response: Response;

    try {
      response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      // Timeout, DNS, reset. Indistinguishable from a 5xx for our purposes and
      // treated the same way.
      lastReason = error instanceof Error ? error.message : 'network failure';
      if (attempt === options.maxAttempts) break;
      options.onRetry?.(attempt, lastReason);
      await sleep(backoffMs(attempt));
      continue;
    }

    if (response.ok) {
      try {
        return (await response.json()) as unknown;
      } catch (error) {
        // A 200 whose body is not JSON is an upstream contract problem, not a
        // transient one; retrying would just fetch the same broken body.
        throw new ProviderUnavailableError(
          PROVIDER,
          `${path} returned a 200 that is not JSON`,
          { cause: error },
        );
      }
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

    // 4xx other than 429: a bad request or a bad key. Retrying cannot help.
    throw new ProviderUnavailableError(
      PROVIDER,
      `${path} failed with HTTP ${response.status}`,
    );
  }

  throw new ProviderUnavailableError(
    PROVIDER,
    `${path} failed after ${options.maxAttempts} attempts: ${lastReason}`,
  );
}
```

Note what the message never contains: the key. `lastReason` carries a status or a network message, and `url` is not interpolated into any error — an error quoting the URL would be fine today but would leak the key the day it moves to a query parameter.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck && pnpm lint
```

Expected: PASS.

- [ ] **Step 3: Build, then probe the retry behaviour against a local stub**

```bash
pnpm --filter @pokedrop/shared build && pnpm --filter @pokedrop/api build
```

Create `apps/api/dist/probe-http.mjs`:

```js
import { createServer } from 'node:http';
import { getJson } from './sync/providers/pokemon-tcg/http.js';

let hits = 0;
let mode = 'fail-twice';

const server = createServer((req, res) => {
  hits += 1;
  if (mode === 'fail-twice' && hits <= 2) {
    res.writeHead(500).end('boom');
    return;
  }
  if (mode === 'always-500') {
    res.writeHead(500).end('boom');
    return;
  }
  if (mode === 'rate-limited') {
    res.writeHead(429, { 'retry-after': '1' }).end('slow down');
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, hits }));
});

await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const opts = { baseUrl: base, apiKey: 'secret-key-value', timeoutMs: 2000, maxAttempts: 5 };

// 1. Two failures then success: the retry is what makes this work.
let started = Date.now();
const ok = await getJson('/cards', { pageSize: 1 }, opts);
console.log('recovered after retries:', JSON.stringify(ok), `in ${Date.now() - started}ms`);

// 2. Exhausted budget -> ProviderUnavailableError naming the attempt count.
mode = 'always-500';
hits = 0;
started = Date.now();
try {
  await getJson('/cards', {}, opts);
  console.log('exhausted: NO ERROR - wrong');
} catch (e) {
  console.log('exhausted:', e.name, '|', e.message, `| ${hits} requests in ${Date.now() - started}ms`);
  console.log('leaks key:', e.message.includes('secret-key-value'));
}

// 3. 429 -> ProviderRateLimitError carrying Retry-After, not Unavailable.
mode = 'rate-limited';
hits = 0;
try {
  await getJson('/cards', {}, { ...opts, maxAttempts: 2 });
} catch (e) {
  console.log('rate limited:', e.name, '| retryAfterMs =', e.retryAfterMs);
}

server.close();
```

- [ ] **Step 4: Run it**

```bash
node apps/api/dist/probe-http.mjs
```

Expected, allowing for jitter in the timings:

```
recovered after retries: {"ok":true,"hits":3} in ~400ms
exhausted: ProviderUnavailableError | /cards failed after 5 attempts: HTTP 500 | 5 requests in ~3700ms
leaks key: false
rate limited: ProviderRateLimitError | retryAfterMs = 1000
```

Three things to check rather than glance at: exactly **5** requests were made and not 6 (the budget is attempts, not retries); the error is `ProviderUnavailableError` and not the rate-limit one; and `leaks key` is `false`.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm lint
git add apps/api/src/sync/providers/pokemon-tcg/http.ts
git commit -F - <<'EOF'
[PD-39]: add the pokemontcg http layer with two retry policies

A 5xx and a 429 mean opposite things, so they are retried differently. This
upstream failed 70% of requests when measured, so a 5xx is an ordinary event:
retried on a short jittered backoff and only raised as ProviderUnavailableError
once the five attempts are spent, which is what keeps PD-43's breaker measuring
"unusable" instead of "one request failed". A 429 honours Retry-After and raises
ProviderRateLimitError, which must not count toward failover.

Verified against a local stub: two failures then success, exactly five requests
before the budget is spent, Retry-After read back as 1000ms, and no error
message quoting the key.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 2: Raw response schemas

**Files:**
- Create: `apps/api/src/sync/providers/pokemon-tcg/pokemon-tcg.schema.ts`

**Interfaces:**
- Consumes: nothing beyond `zod`.
- Produces: `RawSetSchema` / `RawSet`, `RawCardSchema` / `RawCard`, `ListEnvelopeSchema` / `ListEnvelope`. Task 3's mapper takes `RawSet` and `RawCard`; Task 4's client parses envelopes.

- [ ] **Step 1: Write the schemas**

Create `apps/api/src/sync/providers/pokemon-tcg/pokemon-tcg.schema.ts`:

```ts
import { z } from 'zod';

/**
 * Only the fields this project consumes. Unknown keys are stripped, which is
 * Zod's default and is what keeps a provider adding a field from breaking a
 * sync.
 *
 * Almost everything is optional, because the upstream treats its own schema as
 * advisory - `printedTotal` is absent on the newest set in the catalog, and
 * `hp` arrives as a string. The mapper is where those become our types; this
 * file only says what we are willing to receive.
 */
export const RawPricesSchema = z.record(z.string(), z.unknown());

export const RawSetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  series: z.string().min(1),
  releaseDate: z.string().min(1),
  printedTotal: z.number().int().min(0).optional(),
  total: z.number().int().min(0),
  images: z
    .object({
      symbol: z.string().optional(),
      logo: z.string().optional(),
    })
    .optional(),
});
export type RawSet = z.infer<typeof RawSetSchema>;

export const RawCardSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  supertype: z.string().min(1),
  subtypes: z.array(z.string()).optional(),
  hp: z.string().optional(),
  types: z.array(z.string()).optional(),
  rarity: z.string().optional(),
  retreatCost: z.array(z.string()).optional(),
  nationalPokedexNumbers: z.array(z.number().int()).optional(),
  images: z.object({
    small: z.string().min(1),
    large: z.string().min(1),
  }),
  legalities: z.record(z.string(), z.string()).optional(),
  weaknesses: z.array(z.object({ type: z.string(), value: z.string() })).optional(),
  resistances: z.array(z.object({ type: z.string(), value: z.string() })).optional(),
  attacks: z
    .array(
      z.object({
        name: z.string(),
        cost: z.array(z.string()).optional(),
        convertedEnergyCost: z.number().int().min(0).optional(),
        damage: z.string().optional(),
        text: z.string().optional(),
      }),
    )
    .optional(),
  abilities: z
    .array(
      z.object({
        name: z.string(),
        text: z.string().optional(),
        type: z.string().optional(),
      }),
    )
    .optional(),
  set: z.object({ id: z.string().min(1) }),
  tcgplayer: z.object({ prices: RawPricesSchema.optional() }).optional(),
  cardmarket: z.object({ prices: RawPricesSchema.optional() }).optional(),
});
export type RawCard = z.infer<typeof RawCardSchema>;

/**
 * `data` stays `unknown[]` deliberately.
 *
 * Parsing the items here would make one malformed card fail the whole page,
 * which is exactly the behaviour PD-38's CardPage.skipped exists to avoid. The
 * envelope is validated; the items are parsed one at a time by the caller.
 */
export const ListEnvelopeSchema = z.object({
  data: z.array(z.unknown()),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  count: z.number().int().min(0),
  totalCount: z.number().int().min(0),
});
export type ListEnvelope = z.infer<typeof ListEnvelopeSchema>;
```

- [ ] **Step 2: Build, then probe against the captured payloads**

```bash
pnpm typecheck && pnpm lint
pnpm --filter @pokedrop/api build
```

Create `apps/api/dist/probe-schema.mjs`:

```js
import { readFileSync } from 'node:fs';
import {
  ListEnvelopeSchema,
  RawCardSchema,
  RawSetSchema,
} from './sync/providers/pokemon-tcg/pokemon-tcg.schema.js';

const dir = process.argv[2];
const read = (f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));

const sets = read('allsets.json');
const setsEnvelope = ListEnvelopeSchema.safeParse(sets);
console.log('sets envelope:', setsEnvelope.success, setsEnvelope.success ? setsEnvelope.data.totalCount : setsEnvelope.error.issues);

const setResults = sets.data.map((s) => RawSetSchema.safeParse(s));
const badSets = setResults.filter((r) => !r.success);
console.log('sets parsed  :', setResults.length - badSets.length, 'of', setResults.length);
badSets.slice(0, 3).forEach((r) => console.log('  bad set:', JSON.stringify(r.error.issues[0])));

const me55c = sets.data.find((s) => s.id === 'me55c');
const me55cParsed = RawSetSchema.safeParse(me55c);
console.log('me55c        :', me55cParsed.success, '| printedTotal =', me55cParsed.success ? me55cParsed.data.printedTotal : 'n/a', '| total =', me55c.total);

const cards = read('big.json');
const cardsEnvelope = ListEnvelopeSchema.safeParse(cards);
console.log('cards envelope:', cardsEnvelope.success, cardsEnvelope.success ? `${cardsEnvelope.data.count}/${cardsEnvelope.data.totalCount}` : cardsEnvelope.error.issues);

const cardResults = cards.data.map((c) => RawCardSchema.safeParse(c));
const badCards = cardResults.filter((r) => !r.success);
console.log('cards parsed :', cardResults.length - badCards.length, 'of', cardResults.length);
badCards.slice(0, 3).forEach((r) => console.log('  bad card:', JSON.stringify(r.error.issues[0])));

const notAnEnvelope = ListEnvelopeSchema.safeParse({ nope: true });
console.log('bad envelope rejected:', !notAnEnvelope.success);
```

- [ ] **Step 3: Run it**

```bash
node apps/api/dist/probe-schema.mjs "$SCRATCH"
```

Expected:

```
sets envelope: true 176
sets parsed  : 176 of 176
me55c        : true | printedTotal = undefined | total = 30
cards envelope: true 250/20670
cards parsed : 250 of 250
bad envelope rejected: true
```

`me55c` parsing with `printedTotal` undefined is the point: the schema accepts the absence, and Task 3 is where it becomes a number. If any set or card fails to parse, print the issue and widen the schema for that field only — do not relax a field that did parse.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/sync/providers/pokemon-tcg/pokemon-tcg.schema.ts
git commit -F - <<'EOF'
[PD-39]: add the raw pokemontcg response schemas

Almost every field is optional because the upstream treats its own schema as
advisory: printedTotal is absent on the newest set in the catalog and hp arrives
as a string. This file says only what we are willing to receive; the mapper is
where those become our types.

`data` stays unknown[] on purpose - parsing items inside the envelope would make
one malformed card fail the whole page, which is what CardPage.skipped exists to
prevent.

Verified against captured payloads: all 176 sets and all 250 cards of a full
page parse, and a response of the wrong shape is refused.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 3: The mapper

**Files:**
- Create: `apps/api/src/sync/providers/pokemon-tcg/pokemon-tcg.mapper.ts`

**Interfaces:**
- Consumes: `RawSet`, `RawCard` (Task 2); `SetDTO`, `CardDTO`, `PriceDTO`, `SetDTOSchema`, `CardDTOSchema`, `PriceDTOSchema` from `../provider.dto.js` (PD-38).
- Produces: `toSetDTO(raw): SetDTO`, `toCardDTO(raw): CardDTO`, `toPriceDTOs(raw, capturedAt): PriceDTO[]`. Task 4's client calls all three.

- [ ] **Step 1: Write the mapper**

Create `apps/api/src/sync/providers/pokemon-tcg/pokemon-tcg.mapper.ts`:

```ts
import {
  CardDTOSchema,
  PriceDTOSchema,
  SetDTOSchema,
  type CardDTO,
  type PriceDTO,
  type SetDTO,
} from '../provider.dto.js';
import type { RawCard, RawSet } from './pokemon-tcg.schema.js';

/**
 * Print variants, best first. A card that exists as both an ordinary and a
 * holofoil print reports the ordinary price, because that is the one most
 * holders have.
 */
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

/** `1999/01/09`, not `1999-01-09`. */
function parseReleaseDate(value: string): Date {
  return new Date(value.replace(/\//g, '-'));
}

export function toSetDTO(raw: RawSet): SetDTO {
  return SetDTOSchema.parse({
    id: raw.id,
    name: raw.name,
    series: raw.series,
    releaseDate: parseReleaseDate(raw.releaseDate),
    // `printedTotal` is absent on the newest set in the catalog. `total`
    // includes secret rares so the two differ, but it is never absent, and it
    // beats 0 - which would make PD-54's set completion read as 0%.
    printedTotal: raw.printedTotal ?? raw.total,
    total: raw.total,
    symbolUrl: raw.images?.symbol ?? null,
    logoUrl: raw.images?.logo ?? null,
  });
}

export function toCardDTO(raw: RawCard): CardDTO {
  const hp = raw.hp === undefined ? null : Number.parseInt(raw.hp, 10);

  return CardDTOSchema.parse({
    id: raw.id,
    setId: raw.set.id,
    name: raw.name,
    supertype: raw.supertype,
    subtypes: raw.subtypes ?? [],
    // Upstream sends "140". A card whose hp is not a number at all - some
    // Trainer cards - becomes null rather than NaN.
    hp: hp === null || Number.isNaN(hp) ? null : hp,
    types: raw.types ?? [],
    rarity: raw.rarity ?? null,
    retreatCost: raw.retreatCost ?? [],
    weaknesses: raw.weaknesses ?? [],
    resistances: raw.resistances ?? [],
    attacks: (raw.attacks ?? []).map((attack) => ({
      name: attack.name,
      cost: attack.cost ?? [],
      convertedEnergyCost: attack.convertedEnergyCost ?? (attack.cost ?? []).length,
      damage: attack.damage ?? '',
      text: attack.text ?? '',
    })),
    abilities: (raw.abilities ?? []).map((ability) => ({
      name: ability.name,
      text: ability.text ?? '',
      type: ability.type ?? '',
    })),
    legalities: raw.legalities ?? {},
    nationalPokedexNumbers: raw.nationalPokedexNumbers ?? [],
    imageSmall: raw.images.small,
    imageLarge: raw.images.large,
    // This provider publishes no TCGplayer or Cardmarket identifier - the union
    // of keys across 245 price objects is url, updatedAt and prices. TCGdex
    // does, so PD-40 fills these and this one cannot.
    tcgplayerId: null,
    cardmarketId: null,
  });
}

export function toPriceDTOs(raw: RawCard, capturedAt: Date): PriceDTO[] {
  const prices: PriceDTO[] = [];

  const tcg = raw.tcgplayer?.prices;
  if (tcg) {
    const variant = TCGPLAYER_VARIANTS.find((name) => tcg[name] !== undefined);
    const block = variant === undefined ? undefined : (tcg[variant] as Record<string, unknown>);

    if (block) {
      prices.push(
        PriceDTOSchema.parse({
          cardId: raw.id,
          source: 'TCGPLAYER',
          currency: 'USD',
          market: asNumber(block.market),
          low: asNumber(block.low),
          mid: asNumber(block.mid),
          high: asNumber(block.high),
          capturedAt,
        }),
      );
    }
  }

  const cm = raw.cardmarket?.prices;
  if (cm) {
    prices.push(
      PriceDTOSchema.parse({
        cardId: raw.id,
        source: 'CARDMARKET',
        currency: 'EUR',
        market: asNumber(cm.averageSellPrice),
        low: asNumber(cm.lowPrice),
        // Cardmarket publishes no median. `trendPrice` is the closest thing it
        // has, and it is a trend rather than a middle - the loosest link in this
        // mapping. M4 may prefer to widen PriceDTO instead of keeping it.
        mid: asNumber(cm.trendPrice),
        high: null,
        capturedAt,
      }),
    );
  }

  return prices;
}
```

- [ ] **Step 2: Build, then probe against all 250 cards and all 176 sets**

```bash
pnpm typecheck && pnpm lint
pnpm --filter @pokedrop/api build
```

Create `apps/api/dist/probe-mapper.mjs`:

```js
import { readFileSync } from 'node:fs';
import { RawCardSchema, RawSetSchema } from './sync/providers/pokemon-tcg/pokemon-tcg.schema.js';
import { toCardDTO, toPriceDTOs, toSetDTO } from './sync/providers/pokemon-tcg/pokemon-tcg.mapper.js';

const dir = process.argv[2];
const read = (f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
const now = new Date('2026-09-18T00:00:00.000Z');

const sets = read('allsets.json').data.map((s) => RawSetSchema.parse(s));
const setDTOs = sets.map(toSetDTO);
console.log('sets mapped  :', setDTOs.length);
const me55c = setDTOs.find((s) => s.id === 'me55c');
console.log('me55c        : printedTotal =', me55c.printedTotal, '| total =', me55c.total, '| equal:', me55c.printedTotal === me55c.total);
const base1 = setDTOs.find((s) => s.id === 'base1');
console.log('base1 date   :', base1.releaseDate.toISOString(), '| is Date:', base1.releaseDate instanceof Date);

const cards = read('big.json').data.map((c) => RawCardSchema.parse(c));
const cardDTOs = cards.map(toCardDTO);
console.log('cards mapped :', cardDTOs.length);
console.log('hp types     :', [...new Set(cardDTOs.map((c) => (c.hp === null ? 'null' : typeof c.hp)))]);
console.log('ids all null :', cardDTOs.every((c) => c.tcgplayerId === null && c.cardmarketId === null));
console.log('sample       :', JSON.stringify({ id: cardDTOs[0].id, hp: cardDTOs[0].hp, setId: cardDTOs[0].setId, rarity: cardDTOs[0].rarity }));

const priced = cards.flatMap((c) => toPriceDTOs(c, now));
const bySource = priced.reduce((acc, p) => ({ ...acc, [p.source]: (acc[p.source] ?? 0) + 1 }), {});
console.log('price DTOs   :', priced.length, JSON.stringify(bySource));
const usd = priced.find((p) => p.source === 'TCGPLAYER');
const eur = priced.find((p) => p.source === 'CARDMARKET');
console.log('usd sample   :', JSON.stringify(usd));
console.log('eur sample   :', JSON.stringify(eur));
console.log('currencies   :', [...new Set(priced.map((p) => p.currency))]);
```

- [ ] **Step 3: Run it**

```bash
node apps/api/dist/probe-mapper.mjs "$SCRATCH"
```

Expected:

```
sets mapped  : 176
me55c        : printedTotal = 30 | total = 30 | equal: true
base1 date   : 1999-01-09T00:00:00.000Z | is Date: true
cards mapped : 250
hp types     : [ 'number', 'null' ]
ids all null : true
price DTOs   : ~490 {"TCGPLAYER":245,"CARDMARKET":246}
currencies   : [ 'USD', 'EUR' ]
```

The three claims being checked are the three the spec measured: the absent `printedTotal` becomes `total`, `hp` is a number or null and never `NaN`, and both provider ids are null on every one of 250 cards. A `NaN` would have passed `z.number()` in some Zod versions, so `hp types` showing anything other than `number` and `null` is a real failure.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/sync/providers/pokemon-tcg/pokemon-tcg.mapper.ts
git commit -F - <<'EOF'
[PD-39]: map pokemontcg payloads onto the normalized dtos

Three shape differences the spec measured, absorbed here so nothing downstream
learns of them: hp arrives as a string, printedTotal is absent on the newest set
in the catalog and falls back to total, and there is no TCGplayer or Cardmarket
identifier anywhere in the payload so both ids are null.

Price mapping picks the first print variant present, ordinary before holofoil,
because that is the price most holders have. Cardmarket publishes no median, so
trendPrice stands in for mid and high is null - the loosest link in the table
and flagged as such for M4.

Verified across all 176 sets and a full 250-card page: printedTotal falls back
correctly, hp is a number or null and never NaN, and both ids are null
throughout.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 4: The client, registered and wired

**Files:**
- Create: `apps/api/src/sync/providers/pokemon-tcg/pokemon-tcg.client.ts`
- Modify: `apps/api/src/sync/sync.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `getJson` (Task 1); the schemas (Task 2); `toSetDTO`, `toCardDTO`, `toPriceDTOs` (Task 3); `CardSourceProvider`, `CardPage`, `FetchCardsParams`, `ProviderContractError`, `ProviderItemError` from PD-38.
- Produces: `PokemonTcgClient`, registered in `CARD_SOURCE_REGISTRY` under `pokemontcg`.

- [ ] **Step 1: Write the client**

Create `apps/api/src/sync/providers/pokemon-tcg/pokemon-tcg.client.ts`:

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
import { getJson, type PokemonTcgHttpOptions } from './http.js';
import { toCardDTO, toPriceDTOs, toSetDTO } from './pokemon-tcg.mapper.js';
import { ListEnvelopeSchema, RawCardSchema, RawSetSchema } from './pokemon-tcg.schema.js';

const SETS_PAGE_SIZE = 250;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 5;

@Injectable()
export class PokemonTcgClient implements CardSourceProvider {
  readonly name: CardSourceName = 'pokemontcg';

  private readonly http: PokemonTcgHttpOptions;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.http = {
      baseUrl: config.providers.pokemonTcgBaseUrl,
      apiKey: config.providers.pokemonTcgApiKey,
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxAttempts: MAX_ATTEMPTS,
    };
  }

  /**
   * One call. 176 sets fit in a single page, and paginating would be ceremony
   * with no resume point worth saving.
   */
  async fetchSets(): Promise<SetDTO[]> {
    const envelope = this.parseEnvelope(
      await getJson('/sets', { pageSize: SETS_PAGE_SIZE }, this.http),
      '/sets',
    );

    const sets: SetDTO[] = [];
    for (const item of envelope.data) {
      const parsed = RawSetSchema.safeParse(item);
      if (parsed.success) {
        sets.push(toSetDTO(parsed.data));
      }
    }

    return sets;
  }

  async fetchCards(params: FetchCardsParams): Promise<CardPage> {
    const envelope = this.parseEnvelope(
      await getJson(
        '/cards',
        {
          page: params.page,
          pageSize: params.pageSize,
          // The provider's own query syntax. Absent means the whole catalog.
          q: params.setId === undefined ? undefined : `set.id:${params.setId}`,
        },
        this.http,
      ),
      '/cards',
    );

    const items: CardDTO[] = [];
    const skipped: ProviderItemError[] = [];

    for (const item of envelope.data) {
      const parsed = RawCardSchema.safeParse(item);

      if (parsed.success) {
        items.push(toCardDTO(parsed.data));
        continue;
      }

      // One bad card does not discard the 249 beside it. PD-42 counts these
      // into SyncRun.failed and finishes the run as PARTIAL.
      skipped.push({
        provider: this.name,
        itemId: this.idOf(item),
        message: parsed.error.issues[0]?.message ?? 'did not match the card schema',
      });
    }

    return {
      items,
      skipped,
      page: envelope.page,
      pageSize: envelope.pageSize,
      total: envelope.totalCount,
      hasMore: envelope.page * envelope.pageSize < envelope.totalCount,
    };
  }

  /**
   * Prices are embedded in the card object, so this fetches those cards and
   * projects the price blocks out. M4 is the first caller.
   */
  async fetchPrices(cardIds: string[]): Promise<PriceDTO[]> {
    if (cardIds.length === 0) {
      return [];
    }

    const capturedAt = new Date();
    const query = cardIds.map((id) => `id:${id}`).join(' OR ');
    const envelope = this.parseEnvelope(
      await getJson('/cards', { q: query, pageSize: cardIds.length }, this.http),
      '/cards',
    );

    const prices: PriceDTO[] = [];
    for (const item of envelope.data) {
      const parsed = RawCardSchema.safeParse(item);
      if (parsed.success) {
        prices.push(...toPriceDTOs(parsed.data, capturedAt));
      }
    }

    return prices;
  }

  private parseEnvelope(payload: unknown, path: string) {
    const envelope = ListEnvelopeSchema.safeParse(payload);

    if (!envelope.success) {
      throw new ProviderContractError(
        this.name,
        `${path} did not return the documented envelope`,
        { cause: envelope.error },
      );
    }

    return envelope.data;
  }

  private idOf(item: unknown): string | null {
    if (typeof item === 'object' && item !== null && 'id' in item) {
      const { id } = item as { id: unknown };
      return typeof id === 'string' ? id : null;
    }

    return null;
  }
}
```

- [ ] **Step 2: Register it**

In `apps/api/src/sync/sync.module.ts`, add the import

```ts
import { PokemonTcgClient } from './providers/pokemon-tcg/pokemon-tcg.client.js';
```

add `PokemonTcgClient` to the `providers` array as a class provider, and replace the registry factory so it is built from the client rather than being empty:

```ts
    PokemonTcgClient,
    {
      provide: CARD_SOURCE_REGISTRY,
      inject: [PokemonTcgClient],
      useFactory: (pokemonTcg: PokemonTcgClient): CardSourceRegistry =>
        new Map<CardSourceName, CardSourceProvider>([[pokemonTcg.name, pokemonTcg]]),
    },
```

The `CARD_SOURCE_PROVIDER` factory below it does not change — it already selects by `config.providers.active` and refuses to boot when the name is missing.

- [ ] **Step 3: Wire `SyncModule` into `AppModule`**

In `apps/api/src/app.module.ts`, add `import { SyncModule } from './sync/index.js';` beside the other module imports and `SyncModule,` to the `imports` array after `QueueModule`.

PD-38 deliberately left this out because an empty registry would have made the boot refusal fire on every start. This is the first commit where it can only fire for a real reason.

- [ ] **Step 4: Confirm the API boots with the provider resolved**

```bash
pnpm typecheck && pnpm lint
pnpm --filter @pokedrop/api build
( cd apps/api && node dist/main.js > /tmp/pd39-boot.txt 2>&1 & )
sleep 9
curl -s -o /dev/null -w "ready %{http_code}\n" http://localhost:4000/api/v1/health/ready
grep -ci "no card source provider" /tmp/pd39-boot.txt
PID=$(netstat -ano | grep ":4000.*LISTENING" | awk '{print $NF}' | head -1)
taskkill //PID "$PID" //F > /dev/null 2>&1
```

Expected: `ready 200`, and `0` matches for the refusal message.

Then confirm the refusal still works for a name with no implementation:

```bash
( cd apps/api && CARD_SOURCE_PROVIDER=tcgdex node dist/main.js 2>&1 | grep -o 'No card source provider is registered for "[a-z]*"' | head -1 )
```

Expected: `No card source provider is registered for "tcgdex"` — PD-40 is what makes that name resolve.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/sync/providers/pokemon-tcg/pokemon-tcg.client.ts apps/api/src/sync/sync.module.ts apps/api/src/app.module.ts
git commit -F - <<'EOF'
[PD-39]: add the pokemontcg client and wire the sync module

The registry is no longer empty, so SyncModule is imported into AppModule for
the first time - PD-38 deliberately left it out because an empty registry would
have made the boot refusal fire on every start, and this is the first commit
where it can only fire for a real reason.

A card that fails to parse is skipped into CardPage.skipped with its id rather
than failing the page, which is what makes PD-42's "a single failing set does
not abort the entire run" reachable.

Verified: the API boots with pokemontcg resolved, and CARD_SOURCE_PROVIDER=tcgdex
still refuses by name until PD-40 registers it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 5: End-to-end against the live API, and the documentation

This is where the ticket's acceptance criteria are met or reported blocked. The upstream fails roughly 70% of requests, so the retry layer is what makes any of it pass — and the run must show that it retried.

**Files:**
- Modify: `apps/api/src/sync/README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the measured record of what the provider does.

- [ ] **Step 1: Build, then write the live probe**

```bash
pnpm --filter @pokedrop/api build
```

Create `apps/api/dist/probe-live.mjs`:

```js
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { CARD_SOURCE_PROVIDER } from './sync/providers/index.js';

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
const provider = app.get(CARD_SOURCE_PROVIDER);
console.log('provider:', provider.name);

// Retries are the point of this client, so count them rather than inferring
// them from elapsed time. The client builds its own http options, so reach in
// and attach the hook for the probe only.
let retries = 0;
provider.http.onRetry = (attempt, reason) => {
  retries += 1;
  console.log(`  retry #${retries} (attempt ${attempt}): ${reason}`);
};

const t0 = Date.now();
const sets = await provider.fetchSets();
console.log(`fetchSets     : ${sets.length} sets in ${Date.now() - t0}ms`);
const me55c = sets.find((s) => s.id === 'me55c');
console.log('  me55c       :', me55c ? `printedTotal=${me55c.printedTotal} total=${me55c.total}` : 'MISSING');

const t1 = Date.now();
const page = await provider.fetchCards({ page: 1, pageSize: 250 });
console.log(`fetchCards    : ${page.items.length} items, ${page.skipped.length} skipped, total ${page.total}, hasMore ${page.hasMore}, in ${Date.now() - t1}ms`);
page.skipped.slice(0, 3).forEach((s) => console.log('  skipped:', s.itemId, s.message));
console.log('  ids null    :', page.items.every((c) => c.tcgplayerId === null && c.cardmarketId === null));
console.log('  hp kinds    :', [...new Set(page.items.map((c) => (c.hp === null ? 'null' : typeof c.hp)))]);

const t2 = Date.now();
const base1 = await provider.fetchCards({ setId: 'base1', page: 1, pageSize: 250 });
console.log(`fetchCards set: ${base1.items.length} cards of base1 in ${Date.now() - t2}ms, all in set: ${base1.items.every((c) => c.setId === 'base1')}`);

const t3 = Date.now();
const prices = await provider.fetchPrices(['base1-4', 'base1-2']);
console.log(`fetchPrices   : ${prices.length} price points in ${Date.now() - t3}ms`);
prices.forEach((p) => console.log('  ', p.source, p.currency, 'market=', p.market, 'low=', p.low, 'mid=', p.mid, 'high=', p.high));

console.log(`
total retries across the run: ${retries}`);
await app.close();
```

`provider.http` is `private` in TypeScript, which is a compile-time modifier only
— the probe is plain JavaScript and reaches it at runtime. That is acceptable in
a throwaway probe and would not be in committed code.

- [ ] **Step 2: Run it against the live API**

```bash
node apps/api/dist/probe-live.mjs
```

Expected, with the elapsed times well above a single round trip because retries happened:

```
provider: pokemontcg
fetchSets     : 176 sets in ~2000ms
  me55c       : printedTotal=30 total=30
fetchCards    : 250 items, 0 skipped, total 20670, hasMore true, in ~3000ms
  ids null    : true
  hp kinds    : [ 'number', 'null' ]
fetchCards set: 102 cards of base1, all in set: true
fetchPrices   : 4 price points
   TCGPLAYER USD market= … low= … mid= … high= …
   CARDMARKET EUR market= … low= … mid= … high= null

total retries across the run: 6
```

**The retry count is the measurement, not a detail.** At a 30% success rate four
calls should need several retries between them. A run reporting `total retries:
0` means the upstream recovered, which is good news but is *not* evidence that
the retry path works — in that case re-run Task 1 Step 4 against the stub and say
so in the commit, rather than claiming the live run proved it.

If any call throws `ProviderUnavailableError`, run it again — at a 30% success rate five attempts succeed about 83% of the time, so one failure in a run of four calls is expected rather than alarming. **If it fails repeatedly across several runs, stop and report the ticket's second acceptance criterion as blocked upstream** rather than weakening it.

Record the elapsed times; they go into the README in Step 4.

- [ ] **Step 3: Confirm the skipped path with a corrupted payload**

Create `apps/api/dist/probe-skipped.mjs`:

```js
import { readFileSync } from 'node:fs';
import { RawCardSchema } from './sync/providers/pokemon-tcg/pokemon-tcg.schema.js';
import { toCardDTO } from './sync/providers/pokemon-tcg/pokemon-tcg.mapper.js';

const page = JSON.parse(readFileSync(`${process.argv[2]}/big.json`, 'utf8'));
const data = page.data.slice(0, 5).map((c, i) => (i === 2 ? { ...c, images: undefined } : c));

const items = [];
const skipped = [];
for (const item of data) {
  const parsed = RawCardSchema.safeParse(item);
  if (parsed.success) items.push(toCardDTO(parsed.data));
  else skipped.push({ itemId: item.id ?? null, message: parsed.error.issues[0].message });
}

console.log('kept   :', items.length, 'of', data.length);
console.log('skipped:', JSON.stringify(skipped));
```

```bash
node apps/api/dist/probe-skipped.mjs "$SCRATCH"
```

Expected: `kept: 4 of 5` and one entry in `skipped` naming the third card's id. One malformed card costs one card.

- [ ] **Step 4: Extend the sync README**

Append to `apps/api/src/sync/README.md`. The counts in the table below are what Step 2 is expected to print; replace any that differ with what it actually printed:

```markdown
## The pokemontcg.io provider

Registered as `pokemontcg` and the default. `providers/pokemon-tcg/` holds the
HTTP layer, the raw schemas, the mapper and the client.

### The upstream is flaky, and the client is built around that

Measured 2026-09-18: 6 of 20 consecutive requests to `/v2/cards` succeeded. The
failures were scattered rather than clustered, so retrying works.

`http.ts` therefore runs two policies. A 5xx or a network fault is an ordinary
event — retried on a jittered exponential backoff from 250 ms, five attempts in
total, and only raised as `ProviderUnavailableError` once those are spent. A 429
is the opposite: `Retry-After` is honoured and the error raised is
`ProviderRateLimitError`, which PD-43 must **not** count toward failover.

That distinction is what keeps a breaker useful here. Counting individual 5xx
responses at a 70% failure rate would trip any sensible threshold within seconds
of every sweep.

A page that fails all five attempts is PD-42's problem: the job fails, BullMQ
retries it, and the cursor resumes from the page that failed.

### Mapping rules

| Target | Source | Note |
| --- | --- | --- |
| `hp` | `hp` | arrives as a string; parsed, `null` when it is not a number |
| `printedTotal` | `printedTotal ?? total` | the key is absent on the newest set in the catalog |
| `releaseDate` | `releaseDate` | `YYYY/MM/DD`, not ISO |
| `tcgplayerId`, `cardmarketId` | — | **always null.** The provider publishes no identifier; TCGdex does, so PD-40 fills them and this one cannot |

Prices: among TCGplayer's print variants, the first present in the order
`normal`, `holofoil`, `reverseHolofoil`, `1stEditionHolofoil`,
`unlimitedHolofoil`. Cardmarket maps `averageSellPrice` → `market`, `lowPrice` →
`low`, `trendPrice` → `mid`, and `high` → `null`, because it publishes no
median. `trendPrice` standing in for `mid` is an approximation, not an
equivalence.

### Measured end to end

| Call | Result |
| --- | --- |
| `fetchSets()` | 176 sets |
| `fetchCards({ page: 1, pageSize: 250 })` | 250 items, 0 skipped, total 20670 |
| `fetchCards({ setId: 'base1', … })` | 102 cards, all in the set |
| `fetchPrices(['base1-4','base1-2'])` | 4 price points, USD and EUR |

The catalog is 20 670 cards, so a full sweep is 83 pages — roughly 275 requests
once retries are counted. Well inside the anonymous rate limit; the free API key
raises it further and should be set before the first production sweep.
```

- [ ] **Step 5: Clean up, gate and commit**

```bash
rm -f apps/api/dist/probe-*.mjs
npx prettier --write apps/api/src/sync/README.md
npx prettier --check .
pnpm typecheck && pnpm lint && pnpm build
git status --short
git add apps/api/src/sync/README.md
git commit -F - <<'EOF'
[PD-39]: document the provider against what it actually does

Measured end to end through the registered client: 176 sets, a full 250-card
page with nothing skipped, 102 cards for a set filter, and price points in both
currencies.

The README leads with the flakiness because the retry policy is not a detail
here - at 6 successes in 20 requests it is the reason any of this completes, and
it is why PD-43 must count only exhausted budgets rather than individual 5xx
responses.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
git push origin dev
```

---

## Acceptance criteria

- [ ] **Full set list and a full set's cards fetch end-to-end against the live API.** Task 5 Step 2. Reachable because of the retry layer; if it fails across several runs it is reported blocked upstream rather than weakened.
- [ ] **A simulated 429 triggers backoff rather than failing the batch.** Task 1 Step 4, against a local stub — the live API produced no 429 to observe.
- [ ] **The API key never appears in logs or in any client-bound payload.** Task 1 Step 4 checks the error path; no request object is logged anywhere, and `logger.options.ts` allowlists request headers.

## Out of scope

The TCGdex client (PD-40) · failover and the circuit breaker (PD-43) · any database write (PD-42) · calling `fetchPrices` for real (M4) · obtaining an API key (operational).
