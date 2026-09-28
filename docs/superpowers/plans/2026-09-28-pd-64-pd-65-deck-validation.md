# PD-64 + PD-65 Deck Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic, side-effect-free deck validation engine (size, copy limit by name with basic energy exempt, format legality, ownership) run on every save and on `POST /decks/:id/validate`, with a per-deck `ownedOnly` mode that turns "not owned" from a warning into an error.

**Architecture:** A pure `validateDeck(input)` in `decks/deck-validator.ts` holds every rule. `DeckValidationService` loads its input — the deck with its cards, the owner's `availableQuantities`, `DECK_SIZE` — through whatever client it is handed, so the save path runs it inside its own transaction. Saves never fail on a rule; they return the deck plus `validation`.

**Tech Stack:** NestJS 12, Prisma 7 (driver adapter `@prisma/adapter-pg`), PostgreSQL 17, Zod 4 contracts in `@pokedrop/shared`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-28-pd-64-pd-65-deck-validation-design.md`

## Global Constraints

- **Work directly on `dev`.** Commit subjects `[PD-64]: …` or `[PD-65]: …`, ≤ 72 characters — commitlint rejects longer. Bodies end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **No automated tests in v1.** Verification is by throwaway probes; never add test files, runners or a CI step. Probes live in the session scratchpad, or at `apps/api/probe-pd64.mjs` when they need `dist` resolution — never committed, deleted at the end of their task.
- **Minimal comments** — only where a tidy-up would silently break something.
- **`noUncheckedIndexedAccess` is on**: handle `T | undefined` explicitly, no `!`.
- **Every commit compiles:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` from the repo root (an untracked probe may fail `format:check`; committed files must not).
- **Migrations:** never reset the database. If `prisma migrate dev` reports drift or offers a reset, stop and report.
- **A save never fails on a deck rule** (spec decision 1). PD-63's 400s for malformed requests stay.
- **Validation is shown to the deck's owner only** (spec decision 5): never on `GET /decks/:id`, `/decks/:id/stats`, `/users/:id/decks` or `GET /decks`.
- **Basic energy is `supertype === 'Energy' && subtypes.includes('Basic')`**, removed before grouping by name. Max copies: `4`. `DECK_SIZE`: integer 1–100, default `60`, exact match required.
- **Rule order is fixed:** `DECK_SIZE`, `COPY_LIMIT`, `FORMAT_LEGALITY`, `OWNERSHIP`. Issues sort by rule order, then first `cardId`, then `code`.
- **Verified claims only.** Docs state what a probe measured; report contradictions with the spec rather than adjusting a claim.

## Review Focus

1. **Basic and special energy sharing a name** — `Metal Energy` has basic (`bw1-112`) and special (`col1-87`) printings. Expected: 10 basic + 4 special raises no copy issue; 5 special raises one. *Task 2, probe case "metal".*
2. **An empty deck** — Expected: exactly one issue (`DECK_SIZE_MISMATCH`, `actual: 0`), all four `rules` rows present, `valid: false`. *Task 2, probe case "empty".*
3. **A card missing from the owner's inventory, and copies locked by a trade** — Expected: absent means `available: 0`; `quantity 2, lockedQuantity 1` means `available: 1`. *Task 3, scenario 4.*
4. **The save response and a following validate disagreeing** — the save's `validation` is computed inside its transaction. Expected: byte-identical to an immediate `POST /validate`. *Task 3, scenario 5.*
5. **A clone validated against the wrong inventory** — Expected: the clone's `CARD_NOT_OWNED` uses the cloner's copies, not the source owner's. *Task 3, scenario 8.*

### Shared shell setup

```bash
cd /m/projects/pokedrop
S="C:/Users/MaxSt/AppData/Local/Temp/claude/M--projects-pokedrop/79776e29-d9d0-49c9-8036-f54ef8082d5c/scratchpad"
PSQL="docker compose exec -T postgres psql -U pokedrop -d pokedrop -At"
API=http://localhost:4000/api/v1; AUTH=http://localhost:4000/api/auth; WEB=http://localhost:3000
req(){ who=$1; shift; m=$1; shift; p=$1; shift; if [ "$who" = anon ]; then curl -s -w ' |%{http_code}' -X "$m" "$API$p" -H 'Content-Type: application/json' "$@"; else curl -s -w ' |%{http_code}' -b "$S/jar-$who.txt" -X "$m" "$API$p" -H 'Content-Type: application/json' -H "Origin: $WEB" "$@"; fi; echo; }
```

**Starting the API** (from `dist`; stop any previous one first — Git Bash has no `pkill`, use PowerShell):

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'apps[/\\]api[/\\]dist[/\\]main\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }
```

```bash
pnpm build:shared && pnpm --filter @pokedrop/api build
(node apps/api/dist/main.js > "$S/api64.log" 2>&1 &)
for i in $(seq 1 40); do c=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/api/v1/health/ready); [ "$c" = 200 ] && break; sleep 1; done; echo "ready: $c"
```

**Probe users** (sign-up needs a verified email to sign in; the flag is set directly in the local DB):

```bash
for who in a b; do curl -s -o /dev/null -X POST "$AUTH/sign-up/email" -H 'Content-Type: application/json' -H "Origin: $WEB" -d "{\"email\":\"pd64-$who@example.com\",\"password\":\"correct-horse-battery\",\"name\":\"PD64 $who\"}"; done
$PSQL -c "update users set \"emailVerified\" = true where email like 'pd64-%';"
for who in a b; do curl -s -o /dev/null -w "sign-in $who %{http_code}\n" -c "$S/jar-$who.txt" -X POST "$AUTH/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $WEB" -d "{\"email\":\"pd64-$who@example.com\",\"password\":\"correct-horse-battery\"}"; done
```

Cleanup at the end of every task that created them: `$PSQL -c "delete from users where email like 'pd64-%';"` (decks cascade), then stop the API.

### Live values

Measured 2026-09-28 — cards the probes use:

| Id | Card | Why |
| --- | --- | --- |
| `base1-4` | Charizard, Pokémon | a non-energy card; `seed-ash` holds 2 with 1 locked |
| `col1-88` | basic energy | exempt from the copy limit |
| `base1-96` | Double Colorless Energy, special | limited like any card |
| `bw1-112` / `col1-87` | `Metal Energy`, basic / special | one name, two kinds |
| `base1-58` / `base2-60` | Pikachu in two sets | copies count by name |
| `bw3-67` | Archeops — `expanded: Banned` | `CARD_BANNED` |
| `me2pt5-1` | Erika's Oddish — `standard: Not Legal` | `CARD_NOT_LEGAL` |
| `me55-1` | Exeggcute — `legalities = {}` | `CARD_LEGALITY_UNKNOWN` |

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/api/prisma/schema.prisma` | **edit** — `Deck.ownedOnly` |
| `apps/api/prisma/migrations/*_deck_owned_only/` | **new** — generated by `prisma migrate dev` |
| `packages/shared/src/entities/deck.ts` | **edit** — `ownedOnly`; `DeckValidation`, `DeckSaveResult`, rule and code lists |
| `apps/api/src/config/env.schema.ts`, `app.config.ts`, `.env.example` | **edit** — `DECK_SIZE` |
| `apps/api/src/decks/deck-validator.ts` | **new** — the pure engine |
| `apps/api/src/decks/deck-validation.service.ts` | **new** — the loader |
| `apps/api/src/decks/decks.service.ts` | **edit** — `ownedOnly` writes; save path returns `DeckSaveResult`; `validate(user, id)` |
| `apps/api/src/decks/decks.controller.ts` | **edit** — `POST /decks/:id/validate`; save routes return `DeckSaveResult` |
| `apps/api/src/decks/decks.module.ts` | **edit** — import `InventoryModule`, provide `DeckValidationService` |
| `docs/API.md` (Decks), `docs/DataModel.md` (Deck) | **edit** — Task 4 |

---

### Task 1: The `ownedOnly` mode on a deck (PD-65 data)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `Deck`)
- Create: `apps/api/prisma/migrations/<timestamp>_deck_owned_only/migration.sql` (generated)
- Modify: `packages/shared/src/entities/deck.ts` (`DeckSchema`, `CreateDeckSchema`, `UpdateDeckSchema`)
- Modify: `apps/api/src/decks/decks.service.ts` (`DETAIL_SELECT`, `create`, `update`, `clone`)

**Interfaces:**
- Consumes: PD-63's `DecksService` and `DETAIL_SELECT`.
- Produces: `Deck.ownedOnly: boolean` in Prisma and in `DeckSchema` (so `DeckDetail` and `DeckSummary` carry it); `CreateDeck.ownedOnly: boolean` (default `false`); `UpdateDeck.ownedOnly?: boolean`.

- [ ] **Step 1: Add the column to the schema**

In `apps/api/prisma/schema.prisma`, model `Deck`, directly after `isPublic`:

```prisma
  isPublic  Boolean  @default(false)
  /// Strict mode: a card beyond the owner's available copies is an error
  /// rather than a warning. Read by the validation engine only; changing it
  /// never touches the decklist.
  ownedOnly Boolean  @default(false)
```

- [ ] **Step 2: Generate and apply the migration**

```bash
cd /m/projects/pokedrop/apps/api && pnpm exec prisma migrate dev --name deck_owned_only
```

Expected: a new folder `prisma/migrations/<timestamp>_deck_owned_only/` whose `migration.sql` is exactly one `ALTER TABLE "decks" ADD COLUMN "ownedOnly" BOOLEAN NOT NULL DEFAULT false;`, and the client regenerated. If Prisma reports drift or offers a reset: stop and report.

Check: `$PSQL -c "select count(*), bool_or(\"ownedOnly\") from decks"` → every existing row `false`.

- [ ] **Step 3: Carry `ownedOnly` in the shared contracts**

In `packages/shared/src/entities/deck.ts`:

`DeckSchema` — after `isPublic: z.boolean(),` add:

```ts
  ownedOnly: z.boolean(),
```

`CreateDeckSchema` — after `isPublic: z.boolean().default(false),` add:

```ts
  ownedOnly: z.boolean().default(false),
```

`UpdateDeckSchema` — after `isPublic: z.boolean().optional(),` add:

```ts
    ownedOnly: z.boolean().optional(),
```

- [ ] **Step 4: Write and read it in the service**

In `apps/api/src/decks/decks.service.ts`:

`DETAIL_SELECT` — after `isPublic: true,` add `ownedOnly: true,`.

`create` — in `tx.deck.create({ data: { … } })`, after `isPublic: input.isPublic,` add:

```ts
          ownedOnly: input.ownedOnly,
```

`update` — in the `tx.deck.update` data, after the `isPublic` spread add:

```ts
          ...(patch.ownedOnly === undefined ? {} : { ownedOnly: patch.ownedOnly }),
```

`clone` — add `ownedOnly: true,` to the source `select`, and in `this.prisma.deck.create({ data: { … } })` after `isPublic: false,` add:

```ts
        ownedOnly: source.ownedOnly,
```

`page()` needs nothing: its `findMany` has no `select`, so every scalar — `ownedOnly` included — reaches `DeckSummarySchema`.

- [ ] **Step 5: Compile**

```bash
cd /m/projects/pokedrop && pnpm typecheck && pnpm lint && pnpm format:check
```

Expected: all pass.

- [ ] **Step 6: Probe — the toggle never touches the decklist**

Start the API and the probe users (Shared shell setup). Then:

```bash
D=$(req a POST /decks -d '{"name":"Mode","format":"unlimited","cards":[{"cardId":"base1-4","count":3},{"cardId":"col1-88","count":10}]}' | sed -E 's/^\{"id":"([^"]+)".*/\1/'); echo "D=$D"
req a GET /decks/$D | grep -o '"ownedOnly":[a-z]*'                        # false by default
h0=$($PSQL -c "select md5(string_agg(id||\"cardId\"||count, ',' order by id)) from deck_cards where \"deckId\"='$D'")
req a PATCH /decks/$D -d '{"ownedOnly":true}' | grep -o '"ownedOnly":[a-z]*\||[0-9]*$' | tr '\n' ' '; echo   # true |200
h1=$($PSQL -c "select md5(string_agg(id||\"cardId\"||count, ',' order by id)) from deck_cards where \"deckId\"='$D'")
[ "$h0" = "$h1" ] && echo "deck_cards untouched (row ids included)"
req a GET /decks | grep -o '"ownedOnly":[a-z]*'                           # the list carries it
req a PATCH /decks/$D -d '{"isPublic":true}' >/dev/null
req b POST /decks/$D/clone | grep -o '"ownedOnly":[a-z]*'                 # clone copies true
req a POST /decks -d '{"name":"x","format":"standard","ownedOnly":"yes"}' | sed -E 's/,"requestId":"[^"]*"//'   # 400
```

Expected: `false`; `true |200`; `deck_cards untouched (row ids included)`; the list shows `"ownedOnly":true`; the clone shows `"ownedOnly":true`; a 400 naming `ownedOnly`. Then clean up (probe users, API).

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations packages/shared/src/entities/deck.ts apps/api/src/decks/decks.service.ts
git commit -m "[PD-65]: add an owned-only mode to decks that never edits the list" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The pure validation engine (PD-64)

**Files:**
- Modify: `packages/shared/src/entities/deck.ts` (append the validation contract)
- Modify: `apps/api/src/config/env.schema.ts`, `apps/api/src/config/app.config.ts`, `.env.example`
- Create: `apps/api/src/decks/deck-validator.ts`
- Probe (untracked, deleted in Step 7): `apps/api/probe-pd64.mjs`

**Interfaces:**
- Consumes: nothing from Task 1 at runtime; the contract's `ownedOnly` field mirrors it.
- Produces:
  - shared: `DECK_RULES`, `DeckRule`, `DECK_ISSUE_CODES`, `DeckIssueCode`, `DECK_MAX_COPIES = 4`, `DeckIssueSchema`/`DeckIssue`, `DeckValidationSchema`/`DeckValidation`, `DeckSaveResultSchema`/`DeckSaveResult`.
  - config: `config.decks.size: number`.
  - `validateDeck(input: ValidationInput): DeckValidation`, with exported types `ValidationCard` and `ValidationInput` (below).

- [ ] **Step 1: Append the contract to `packages/shared/src/entities/deck.ts`**

At the end of the file:

```ts
export const DECK_MAX_COPIES = 4;

export const DECK_RULES = ['DECK_SIZE', 'COPY_LIMIT', 'FORMAT_LEGALITY', 'OWNERSHIP'] as const;
export const DeckRuleSchema = z.enum(DECK_RULES);
export type DeckRule = z.infer<typeof DeckRuleSchema>;

export const DECK_ISSUE_CODES = [
  'DECK_SIZE_MISMATCH',
  'COPY_LIMIT_EXCEEDED',
  'CARD_BANNED',
  'CARD_NOT_LEGAL',
  'CARD_LEGALITY_UNKNOWN',
  'CARD_NOT_OWNED',
] as const;
export const DeckIssueCodeSchema = z.enum(DECK_ISSUE_CODES);
export type DeckIssueCode = z.infer<typeof DeckIssueCodeSchema>;

/**
 * `code` and `params` are the localisable part; `message` is an English
 * fallback and may be reworded. `cardIds` addresses the decklist rows the
 * issue is about; `[]` means the whole deck.
 */
export const DeckIssueSchema = z.object({
  severity: z.enum(['error', 'warning']),
  rule: DeckRuleSchema,
  code: DeckIssueCodeSchema,
  cardIds: z.array(CardIdSchema),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
  message: z.string(),
});
export type DeckIssue = z.infer<typeof DeckIssueSchema>;

/** One row per rule, always in `DECK_RULES` order; a warning never fails a rule. */
export const DeckRuleResultSchema = z.object({
  rule: DeckRuleSchema,
  ok: z.boolean(),
  errors: z.number().int().min(0),
  warnings: z.number().int().min(0),
});
export type DeckRuleResult = z.infer<typeof DeckRuleResultSchema>;

export const DeckValidationSchema = z.object({
  valid: z.boolean(),
  format: z.string(),
  ownedOnly: z.boolean(),
  deckSize: z.object({
    expected: z.number().int().min(1),
    actual: z.number().int().min(0),
  }),
  rules: z.array(DeckRuleResultSchema),
  issues: z.array(DeckIssueSchema),
});
export type DeckValidation = z.infer<typeof DeckValidationSchema>;

export const DeckSaveResultSchema = DeckDetailSchema.extend({
  validation: DeckValidationSchema,
});
export type DeckSaveResult = z.infer<typeof DeckSaveResultSchema>;
```

- [ ] **Step 2: Add `DECK_SIZE` to the configuration**

`apps/api/src/config/env.schema.ts` — after `THROTTLE_MODERATE_WINDOW: …,` add a blank line and:

```ts
    DECK_SIZE: z.coerce.number().int().min(1).max(100).default(60),
```

`apps/api/src/config/app.config.ts` — after the `cache: { … },` block:

```ts
    decks: {
      size: env.DECK_SIZE,
    },
```

`.env.example` — after the `THROTTLE_MODERATE_WINDOW=60` line:

```

# ─── Decks ───────────────────────────────────────────────────────────────────
# The exact number of cards a deck needs to pass validation.
DECK_SIZE=60
```

- [ ] **Step 3: Write `apps/api/src/decks/deck-validator.ts`**

```ts
import {
  DECK_MAX_COPIES,
  DECK_RULES,
  DeckValidationSchema,
  type DeckIssueCode,
  type DeckRule,
  type DeckValidation,
  type Legalities,
} from '@pokedrop/shared';

export type ValidationCard = {
  cardId: string;
  count: number;
  name: string;
  supertype: string;
  subtypes: string[];
  legalities: Legalities;
};

export type ValidationInput = {
  format: string;
  ownedOnly: boolean;
  deckSize: number;
  cards: ValidationCard[];
  available: ReadonlyMap<string, number>;
};

type Issue = {
  severity: 'error' | 'warning';
  rule: DeckRule;
  code: DeckIssueCode;
  cardIds: string[];
  params: Record<string, string | number>;
  message: string;
};

export function validateDeck(input: ValidationInput): DeckValidation {
  const cards = [...input.cards].sort((a, b) => compare(a.cardId, b.cardId));
  const actual = cards.reduce((sum, card) => sum + card.count, 0);

  const issues = [
    ...deckSize(input.deckSize, actual),
    ...copyLimit(cards),
    ...formatLegality(cards, input.format),
    ...ownership(cards, input.available, input.ownedOnly),
  ].sort(
    (a, b) =>
      DECK_RULES.indexOf(a.rule) - DECK_RULES.indexOf(b.rule) ||
      compare(a.cardIds[0] ?? '', b.cardIds[0] ?? '') ||
      compare(a.code, b.code),
  );

  return DeckValidationSchema.parse({
    valid: issues.every((issue) => issue.severity !== 'error'),
    format: input.format,
    ownedOnly: input.ownedOnly,
    deckSize: { expected: input.deckSize, actual },
    rules: DECK_RULES.map((rule) => {
      const own = issues.filter((issue) => issue.rule === rule);
      const errors = own.filter((issue) => issue.severity === 'error').length;
      return { rule, ok: errors === 0, errors, warnings: own.length - errors };
    }),
    issues,
  });
}

function deckSize(expected: number, actual: number): Issue[] {
  if (actual === expected) {
    return [];
  }
  return [
    {
      severity: 'error',
      rule: 'DECK_SIZE',
      code: 'DECK_SIZE_MISMATCH',
      cardIds: [],
      params: { expected, actual },
      message: `The deck has ${actual} cards; it needs exactly ${expected}`,
    },
  ];
}

// Basic energy leaves before grouping: "Metal Energy" names both a basic and a
// special card, and only the special one is limited.
function copyLimit(cards: ValidationCard[]): Issue[] {
  const byName = new Map<string, ValidationCard[]>();
  for (const card of cards) {
    if (isBasicEnergy(card)) {
      continue;
    }
    byName.set(card.name, [...(byName.get(card.name) ?? []), card]);
  }

  const issues: Issue[] = [];
  for (const [name, printings] of byName) {
    const count = printings.reduce((sum, card) => sum + card.count, 0);
    if (count > DECK_MAX_COPIES) {
      issues.push({
        severity: 'error',
        rule: 'COPY_LIMIT',
        code: 'COPY_LIMIT_EXCEEDED',
        cardIds: printings.map((card) => card.cardId),
        params: { name, count, max: DECK_MAX_COPIES },
        message: `${name} has ${count} copies; at most ${DECK_MAX_COPIES} are allowed`,
      });
    }
  }
  return issues;
}

function formatLegality(cards: ValidationCard[], format: string): Issue[] {
  const issues: Issue[] = [];
  for (const card of cards) {
    const status = Object.hasOwn(card.legalities, format) ? card.legalities[format] : undefined;
    const about = { rule: 'FORMAT_LEGALITY' as const, cardIds: [card.cardId] };

    if (status === undefined) {
      issues.push({
        ...about,
        severity: 'warning',
        code: 'CARD_LEGALITY_UNKNOWN',
        params: { name: card.name, format },
        message: `${label(card)} has no legality recorded for ${format}`,
      });
    } else if (status === 'Banned') {
      issues.push({
        ...about,
        severity: 'error',
        code: 'CARD_BANNED',
        params: { name: card.name, format },
        message: `${label(card)} is banned in ${format}`,
      });
    } else if (status !== 'Legal') {
      issues.push({
        ...about,
        severity: 'error',
        code: 'CARD_NOT_LEGAL',
        params: { name: card.name, format, status },
        message: `${label(card)} is not legal in ${format} (${status})`,
      });
    }
  }
  return issues;
}

function ownership(
  cards: ValidationCard[],
  available: ReadonlyMap<string, number>,
  ownedOnly: boolean,
): Issue[] {
  const issues: Issue[] = [];
  for (const card of cards) {
    const have = available.get(card.cardId) ?? 0;
    if (card.count > have) {
      issues.push({
        severity: ownedOnly ? 'error' : 'warning',
        rule: 'OWNERSHIP',
        code: 'CARD_NOT_OWNED',
        cardIds: [card.cardId],
        params: { name: card.name, needed: card.count, available: have },
        message: `${label(card)} needs ${card.count} copies; ${have} available`,
      });
    }
  }
  return issues;
}

function isBasicEnergy(card: ValidationCard): boolean {
  return card.supertype === 'Energy' && card.subtypes.includes('Basic');
}

function label(card: ValidationCard): string {
  return `${card.name} (${card.cardId})`;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
```

- [ ] **Step 4: Compile**

```bash
cd /m/projects/pokedrop && pnpm typecheck && pnpm lint && pnpm format:check && pnpm --filter @pokedrop/api build
```

Expected: all pass; `apps/api/dist/decks/deck-validator.js` exists.

- [ ] **Step 5: Write the probe `apps/api/probe-pd64.mjs`**

```js
import assert from 'node:assert/strict';
import { validateDeck } from './dist/decks/deck-validator.js';

const L = { standard: 'Legal', expanded: 'Legal', unlimited: 'Legal' };
const poke = (cardId, name, count, legalities = L) => ({ cardId, count, name, supertype: 'Pokémon', subtypes: ['Basic'], legalities });
const basicE = (cardId, name, count) => ({ cardId, count, name, supertype: 'Energy', subtypes: ['Basic'], legalities: L });
const specialE = (cardId, name, count) => ({ cardId, count, name, supertype: 'Energy', subtypes: ['Special'], legalities: L });
const run = (cards, { format = 'unlimited', ownedOnly = false, deckSize = 60, available = new Map() } = {}) =>
  validateDeck({ format, ownedOnly, deckSize, cards, available });
const codes = (v) => v.issues.map((i) => `${i.code}:${i.cardIds.join('+')}`);
const own = (cards) => new Map(cards.map((c) => [c.cardId, c.count]));

// copy limit
let v = run([poke('base1-4', 'Charizard', 5)]);
assert.deepEqual(codes(v).filter((c) => c.startsWith('COPY')), ['COPY_LIMIT_EXCEEDED:base1-4']);
v = run([basicE('col1-88', 'Fire Energy', 5)]);
assert.ok(!codes(v).some((c) => c.startsWith('COPY')), 'basic energy is exempt');
v = run([specialE('base1-96', 'Double Colorless Energy', 5)]);
assert.ok(codes(v).includes('COPY_LIMIT_EXCEEDED:base1-96'), 'special energy is limited');
v = run([poke('base1-58', 'Pikachu', 4), poke('base2-60', 'Pikachu', 1)]);
assert.ok(codes(v).includes('COPY_LIMIT_EXCEEDED:base1-58+base2-60'), 'copies count by name');
// metal: basic and special share a name
v = run([basicE('bw1-112', 'Metal Energy', 10), specialE('col1-87', 'Metal Energy', 4)]);
assert.ok(!codes(v).some((c) => c.startsWith('COPY')), 'basic Metal Energy never counts against special');
v = run([basicE('bw1-112', 'Metal Energy', 10), specialE('col1-87', 'Metal Energy', 5)]);
assert.ok(codes(v).includes('COPY_LIMIT_EXCEEDED:col1-87'), '5 special Metal Energy is over');

// size
const sixty = [basicE('col1-88', 'Fire Energy', 60)];
v = run(sixty, { available: own(sixty) });
assert.equal(v.valid, true);
assert.deepEqual(v.issues, []);
v = run([basicE('col1-88', 'Fire Energy', 59)], { available: own(sixty) });
assert.deepEqual(v.issues.map((i) => [i.code, i.params.actual]), [['DECK_SIZE_MISMATCH', 59]]);
v = run([basicE('col1-88', 'Fire Energy', 40)], { deckSize: 40, available: own(sixty) });
assert.equal(v.valid, true);

// empty
v = run([]);
assert.deepEqual(codes(v), ['DECK_SIZE_MISMATCH:']);
assert.deepEqual(v.rules.map((r) => r.rule), ['DECK_SIZE', 'COPY_LIMIT', 'FORMAT_LEGALITY', 'OWNERSHIP']);
assert.equal(v.valid, false);

// legality
v = run([poke('bw3-67', 'Archeops', 1, { expanded: 'Banned', unlimited: 'Legal' })], { format: 'expanded' });
assert.ok(codes(v).includes('CARD_BANNED:bw3-67'));
v = run([poke('me2pt5-1', "Erika's Oddish", 1, { standard: 'Not Legal', expanded: 'Legal' })], { format: 'standard' });
const notLegal = v.issues.find((i) => i.code === 'CARD_NOT_LEGAL');
assert.equal(notLegal?.params.status, 'Not Legal');
v = run([poke('me55-1', 'Exeggcute', 1, {})], { format: 'standard' });
const unknown = v.issues.find((i) => i.code === 'CARD_LEGALITY_UNKNOWN');
assert.equal(unknown?.severity, 'warning');
assert.equal(v.rules.find((r) => r.rule === 'FORMAT_LEGALITY')?.ok, true);
v = run([poke('x-1', 'Odd', 1, { standard: 'Legal' })], { format: 'constructor' });
assert.ok(codes(v).includes('CARD_LEGALITY_UNKNOWN:x-1'), 'an inherited property is not a legality');

// ownership
const deck = [poke('base1-4', 'Charizard', 2)];
v = run(deck, { available: new Map([['base1-4', 1]]) });
const warn = v.issues.find((i) => i.code === 'CARD_NOT_OWNED');
assert.deepEqual([warn?.severity, warn?.params.needed, warn?.params.available], ['warning', 2, 1]);
assert.equal(v.rules.find((r) => r.rule === 'OWNERSHIP')?.ok, true);
v = run(deck, { ownedOnly: true });
const err = v.issues.find((i) => i.code === 'CARD_NOT_OWNED');
assert.deepEqual([err?.severity, err?.params.available], ['error', 0]);
assert.equal(v.rules.find((r) => r.rule === 'OWNERSHIP')?.ok, false);

// determinism: input order does not matter, and two runs are byte-identical
const mixed = [poke('base2-60', 'Pikachu', 3), poke('base1-58', 'Pikachu', 3), specialE('base1-96', 'Double Colorless Energy', 5)];
const a = JSON.stringify(run(mixed));
const b = JSON.stringify(run([...mixed].reverse()));
assert.equal(a, b);
assert.equal(a, JSON.stringify(run(mixed)));
console.log(JSON.stringify(run(mixed).issues.map((i) => [i.rule, i.code, i.cardIds]), null, 0));
console.log('probe-pd64: all assertions passed');
```

- [ ] **Step 6: Run the probe**

```bash
cd /m/projects/pokedrop/apps/api && node probe-pd64.mjs
```

Expected: one line of issues ordered `DECK_SIZE`, then `COPY_LIMIT` (both Pikachu printings, then `base1-96`), then `OWNERSHIP` rows by `cardId` — and `probe-pd64: all assertions passed`. Any `AssertionError` is a defect in `deck-validator.ts`: fix the code, not the assertion, unless the assertion contradicts the spec — then report.

- [ ] **Step 7: Delete the probe and commit**

```bash
rm /m/projects/pokedrop/apps/api/probe-pd64.mjs
cd /m/projects/pokedrop
git add packages/shared/src/entities/deck.ts apps/api/src/config/env.schema.ts apps/api/src/config/app.config.ts .env.example apps/api/src/decks/deck-validator.ts
git commit -m "[PD-64]: validate a deck's size, copies, legality and ownership" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Validate on demand and on every save (PD-64, PD-65)

**Files:**
- Create: `apps/api/src/decks/deck-validation.service.ts`
- Modify: `apps/api/src/decks/decks.service.ts`
- Modify: `apps/api/src/decks/decks.controller.ts`
- Modify: `apps/api/src/decks/decks.module.ts`

**Interfaces:**
- Consumes: `validateDeck`, `ValidationInput` (Task 2); `config.decks.size` (Task 2); `DeckSaveResult`, `DeckValidation` (Task 2); `Deck.ownedOnly` (Task 1); `InventoryService.availableQuantities(userId, cardIds, client?)` (PD-55, exported from `InventoryModule`).
- Produces: `DeckValidationService.validate(deckId: string, client?: TransactionClient): Promise<DeckValidation>`; `DecksService.validate(user, id): Promise<DeckValidation>`; `create`/`update`/`clone` return `Promise<DeckSaveResult>`; route `POST /decks/:id/validate` → 200.

- [ ] **Step 1: Write `apps/api/src/decks/deck-validation.service.ts`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { LegalitiesSchema, type DeckValidation, type Legalities } from '@pokedrop/shared';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { InventoryService } from '../inventory/index.js';
import { PrismaService, type TransactionClient } from '../prisma/index.js';
import { validateDeck } from './deck-validator.js';

@Injectable()
export class DeckValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Pass the caller's transaction so the verdict describes the rows it just wrote. */
  async validate(deckId: string, client: TransactionClient = this.prisma): Promise<DeckValidation> {
    const deck = await client.deck.findUniqueOrThrow({
      where: { id: deckId },
      select: {
        userId: true,
        format: true,
        ownedOnly: true,
        cards: {
          orderBy: { cardId: 'asc' },
          select: {
            cardId: true,
            count: true,
            card: { select: { name: true, supertype: true, subtypes: true, legalities: true } },
          },
        },
      },
    });

    const available = await this.inventory.availableQuantities(
      deck.userId,
      deck.cards.map((entry) => entry.cardId),
      client,
    );

    return validateDeck({
      format: deck.format,
      ownedOnly: deck.ownedOnly,
      deckSize: this.config.decks.size,
      cards: deck.cards.map(({ cardId, count, card }) => ({
        cardId,
        count,
        name: card.name,
        supertype: card.supertype,
        subtypes: card.subtypes,
        legalities: toLegalities(card.legalities),
      })),
      available,
    });
  }
}

function toLegalities(value: Prisma.JsonValue): Legalities {
  const parsed = LegalitiesSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}
```

`AppConfig` and `APP_CONFIG` both come from `../config/index.js`, as in `mail.service.ts`.

- [ ] **Step 2: Wire the module**

`apps/api/src/decks/decks.module.ts` becomes:

```ts
import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/index.js';
import { DeckValidationService } from './deck-validation.service.js';
import { DecksController } from './decks.controller.js';
import { DecksService } from './decks.service.js';
import { UserDecksController } from './user-decks.controller.js';

@Module({
  imports: [InventoryModule],
  controllers: [DecksController, UserDecksController],
  providers: [DecksService, DeckValidationService],
})
export class DecksModule {}
```

- [ ] **Step 3: Return `DeckSaveResult` from every save, and add `validate`**

In `apps/api/src/decks/decks.service.ts`:

Imports — add `type DeckSaveResult,` and `type DeckValidation,` to the `@pokedrop/shared` import list, and:

```ts
import { DeckValidationService } from './deck-validation.service.js';
```

Constructor:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: DeckValidationService,
  ) {}
```

`create` — signature `create(user: AuthUser, input: CreateDeck): Promise<DeckSaveResult>`; change the create's `select: DETAIL_SELECT` to `select: { id: true }` and its tail to:

```ts
      return this.saveResult(tx, row.id);
```

(`const row = await tx.deck.create({ … select: { id: true } });` stays as the binding.)

`update` — signature `update(user: AuthUser, id: string, patch: UpdateDeck): Promise<DeckSaveResult>`; replace its last line

```ts
      return toDetail(await tx.deck.findUniqueOrThrow({ where: { id }, select: DETAIL_SELECT }));
```

with:

```ts
      return this.saveResult(tx, id);
```

`clone` — replace the whole method with:

```ts
  /**
   * Any deck the caller can see, so a stranger's public deck too. The copy is
   * private and asks nothing of the caller's inventory: owning its cards is
   * the validator's question, answered against the cloner's copies.
   */
  clone(user: AuthUser, id: string): Promise<DeckSaveResult> {
    return this.prisma.withTransaction(async (tx) => {
      const source = await tx.deck.findUnique({
        where: { id },
        select: {
          userId: true,
          isPublic: true,
          name: true,
          format: true,
          ownedOnly: true,
          cards: { select: { cardId: true, count: true } },
        },
      });
      assertVisible(source, user);

      const row = await tx.deck.create({
        data: {
          userId: user.id,
          name: copyName(source.name),
          format: source.format,
          isPublic: false,
          ownedOnly: source.ownedOnly,
          cards: { createMany: { data: source.cards } },
        },
        select: { id: true },
      });

      return this.saveResult(tx, row.id);
    });
  }
```

New method `validate`, placed after `clone`:

```ts
  /** Owner only: the result states the owner's available copies, which is private. */
  async validate(user: AuthUser, id: string): Promise<DeckValidation> {
    const deck = await this.prisma.deck.findUnique({
      where: { id },
      select: { userId: true, isPublic: true },
    });
    assertVisible(deck, user);
    assertOwner(deck.userId, user);

    return this.validation.validate(id);
  }
```

New private method, placed after `page`:

```ts
  private async saveResult(tx: TransactionClient, id: string): Promise<DeckSaveResult> {
    const validation = await this.validation.validate(id, tx);
    const row = await tx.deck.findUniqueOrThrow({ where: { id }, select: DETAIL_SELECT });
    return { ...toDetail(row), validation };
  }
```

The two reads run one after the other on purpose: an interactive transaction is one connection, and Prisma does not run statements on it concurrently.

- [ ] **Step 4: Route and return types in `apps/api/src/decks/decks.controller.ts`**

Change the shared import to:

```ts
import type {
  DeckDetail,
  DeckPage,
  DeckSaveResult,
  DeckStats,
  DeckValidation,
} from '@pokedrop/shared';
```

`create`, `update` and `clone` return `Promise<DeckSaveResult>` instead of `Promise<DeckDetail>`. Add, after `clone`:

```ts
  @HttpCode(HttpStatus.OK)
  @Post(':id/validate')
  validate(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<DeckValidation> {
    return this.decks.validate(user, id);
  }
```

- [ ] **Step 5: Compile**

```bash
cd /m/projects/pokedrop && pnpm typecheck && pnpm lint && pnpm format:check
```

Expected: all pass.

- [ ] **Step 6: Probe through HTTP**

Start the API and the probe users (Shared shell setup). The scenarios share variables (`D`, `E`, `M`, `AID`): run them in one shell session, or write each id to `$S` and read it back. Helper for the scenarios:

```bash
vd(){ grep -o '"validation":{"valid":[a-z]*\|"valid":[a-z]*,"format"\|"code":"[A-Z_]*"\|"severity":"[a-z]*"\||[0-9]*$' | tr '\n' ' '; echo; }
```

1. **Copy limit, saved and reported:**

```bash
D=$(req a POST /decks -d '{"name":"Copies","format":"unlimited","cards":[{"cardId":"base1-4","count":5}]}' | tee "$S/c1.json" | sed -E 's/^\{"id":"([^"]+)".*/\1/'); vd < "$S/c1.json"
req a PATCH /decks/$D -d '{"cards":[{"cardId":"col1-88","count":60}]}' | vd
req a PATCH /decks/$D -d '{"cards":[{"cardId":"base1-58","count":4},{"cardId":"base2-60","count":1},{"cardId":"col1-88","count":55}]}' | grep -o '"cardIds":\["base1-58","base2-60"\]'
req a PATCH /decks/$D -d '{"cards":[{"cardId":"bw1-112","count":10},{"cardId":"col1-87","count":4},{"cardId":"col1-88","count":46}]}' | grep -c COPY_LIMIT
```

Expected: first a 201 whose `validation` has `COPY_LIMIT_EXCEEDED` and `DECK_SIZE_MISMATCH`; the 60 basic energy deck has no `COPY_LIMIT` (only the ownership warning); the Pikachu issue addresses both printings; the Metal Energy mix prints `0`.

2. **Size:**

```bash
req a PATCH /decks/$D -d '{"cards":[{"cardId":"col1-88","count":60}]}' | grep -o '"rule":"DECK_SIZE","ok":[a-z]*'
req a PATCH /decks/$D -d '{"cards":[{"cardId":"col1-88","count":59}]}' | grep -o '"code":"DECK_SIZE_MISMATCH","cardIds":\[\],"params":{[^}]*}'
```

Expected: `"rule":"DECK_SIZE","ok":true`, then the mismatch with `"expected":60,"actual":59`.

3. **Legality:**

```bash
E=$(req a POST /decks -d '{"name":"Legal","format":"expanded","cards":[{"cardId":"bw3-67","count":1}]}' | sed -E 's/^\{"id":"([^"]+)".*/\1/')
req a POST /decks/$E/validate | grep -o '"code":"CARD_BANNED"'
req a PATCH /decks/$E -d '{"format":"standard","cards":[{"cardId":"me2pt5-1","count":1},{"cardId":"me55-1","count":1}]}' | grep -o '"code":"CARD_NOT_LEGAL"\|"status":"Not Legal"\|"severity":"warning","rule":"FORMAT_LEGALITY","code":"CARD_LEGALITY_UNKNOWN","cardIds":\["me55-1"\]\|"rule":"FORMAT_LEGALITY","ok":[a-z]*'
```

Expected: `CARD_BANNED`; then `CARD_NOT_LEGAL`, `"status":"Not Legal"`, the unknown-legality issue on `me55-1` as a `warning`, and `"rule":"FORMAT_LEGALITY","ok":false` (the `Not Legal` card is an error; the warning alone would not fail the rule).

4. **Mode and locked copies:** give user `a` 2 × `base1-4` with 1 locked, directly in the DB:

```bash
AID=$($PSQL -c "select id from users where email='pd64-a@example.com'")
$PSQL -c "insert into inventory_items (id, \"userId\", \"cardId\", quantity, \"lockedQuantity\", \"acquiredAt\") values ('pd64-inv', '$AID', 'base1-4', 2, 1, now())"
M=$(req a POST /decks -d '{"name":"Mode","format":"unlimited","cards":[{"cardId":"base1-4","count":2},{"cardId":"base1-58","count":1}]}' | sed -E 's/^\{"id":"([^"]+)".*/\1/')
req a POST /decks/$M/validate | grep -o '"code":"CARD_NOT_OWNED","cardIds":\["[^"]*"\],"params":{[^}]*}'
h0=$($PSQL -c "select md5(string_agg(id||count, ',' order by id)) from deck_cards where \"deckId\"='$M'")
req a PATCH /decks/$M -d '{"ownedOnly":true}' | grep -o '"validation":{"valid":[a-z]*\|"OWNERSHIP","ok":[a-z]*'
h1=$($PSQL -c "select md5(string_agg(id||count, ',' order by id)) from deck_cards where \"deckId\"='$M'"); [ "$h0" = "$h1" ] && echo "deck_cards untouched"
```

Expected: two `CARD_NOT_OWNED` issues — `base1-4` with `"needed":2,"available":1` and `base1-58` with `"available":0` — both warnings, `OWNERSHIP` ok; after the PATCH `"valid":false` and `"OWNERSHIP","ok":false`; `deck_cards untouched`. If the insert fails on a column name, read `\d inventory_items` and adjust the probe, not the code.

5. **Save and validate agree:**

```bash
req a PATCH /decks/$M -d '{"name":"Mode 2"}' | sed -E 's/.*"validation":(.*) \|[0-9]+$/\1/' | sed -E 's/}$//' > "$S/save.json"
req a POST /decks/$M/validate | sed -E 's/ \|[0-9]+$//' > "$S/validate.json"
cmp "$S/save.json" "$S/validate.json" && echo "save validation == validate"
```

Expected: `save validation == validate`. If `cmp` differs only by the `sed` trimming, compare with `node -e` parsing both instead — the claim is about content.

6. **Determinism and no writes:**

```bash
snap(){ $PSQL -c "select (select md5(string_agg(id||name||\"updatedAt\"||\"ownedOnly\", ',' order by id)) from decks)||(select md5(string_agg(id||count, ',' order by id)) from deck_cards)||(select md5(string_agg(id||quantity||\"lockedQuantity\", ',' order by id)) from inventory_items)"; }
s0=$(snap); v1=$(req a POST /decks/$M/validate); v2=$(req a POST /decks/$M/validate); s1=$(snap)
[ "$v1" = "$v2" ] && echo "byte-identical"; [ "$s0" = "$s1" ] && echo "no rows changed"
```

Expected: `byte-identical` and `no rows changed`.

7. **Access:**

```bash
req b POST /decks/$M/validate | sed -E 's/,"requestId":"[^"]*"//'     # private → 404
req a PATCH /decks/$M -d '{"isPublic":true}' >/dev/null
req b POST /decks/$M/validate | sed -E 's/,"requestId":"[^"]*"//'     # public → 403
req anon POST /decks/$M/validate | sed -E 's/,"requestId":"[^"]*"//'  # 401
req anon GET /decks/$M | grep -c '"validation"'                        # 0
req b GET /decks/$M | grep -c '"validation"'                           # 0
req anon GET /users/$AID/decks | grep -c '"validation"'               # 0
req a GET /decks | grep -c '"validation"'                              # 0
```

Expected: 404, 403, 401, then four `0`s.

8. **Clone validated against the cloner:** `$M` is public, `ownedOnly: true`, and `a` has one available `base1-4`; `b` has none.

```bash
req b POST /decks/$M/clone | grep -o '"ownedOnly":true\|"CARD_NOT_OWNED","cardIds":\["base1-4"\],"params":{[^}]*}\||[0-9]*$'
```

Expected: `"ownedOnly":true`, the `base1-4` issue with `"available":0` (b's, not a's `1`), and `|201`.

Then clean up: `$PSQL -c "delete from users where email like 'pd64-%';"` (decks and the inserted inventory row cascade — confirm with `$PSQL -c "select count(*) from inventory_items where id='pd64-inv'"` → `0`), and stop the API.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/decks
git commit -m "[PD-64]: validate on demand and report a verdict on every save" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Document the rules, the mode and what they measured

**Files:**
- Modify: `docs/API.md` (section `## Decks`)
- Modify: `docs/DataModel.md` (section `### Deck`)

**Interfaces:**
- Consumes: the probe output from Tasks 1–3 — every number written here must be one a probe printed.
- Produces: documentation only.

- [ ] **Step 1: `docs/DataModel.md`, `### Deck`**

Replace

```
`id, userId, name, format, isPublic, createdAt`
→ many `DeckCard`.
```

with

```
`id, userId, name, format, isPublic, ownedOnly, createdAt`
→ many `DeckCard`.

`ownedOnly` is the deck's mode: when true, validation treats a card beyond the owner's available copies as an error rather than a warning. It is read by the validation engine and nothing else; changing it never touches the decklist. Validity itself is never stored — it depends on inventory and on legalities a sync can change, so a stored verdict would go stale.
```

- [ ] **Step 2: `docs/API.md`, Decks table**

Replace the row

```
| POST | `/decks/:id/validate` | member | Legality check |
```

with

```
| POST | `/decks/:id/validate` | member (owner) | The deck's validation verdict; writes nothing |
```

In the `POST /decks` / `PATCH /decks/:id` field table, add after the `isPublic` row:

```
| `ownedOnly` | boolean; `false` on create when absent — see *Validation* |
```

- [ ] **Step 3: `docs/API.md`, a *Validation* subsection**

Insert immediately before `## Trades`:

````markdown
### Validation

**`POST /decks/:id/validate`** takes no body and answers 200 with the verdict on the deck as saved. The same verdict rides on every save: `POST /decks`, `PATCH /decks/:id` and `POST /decks/:id/clone` return the deck plus `validation`, computed inside the save's transaction. **A save never fails on a deck rule** — an unfinished deck is a normal state of a builder — and validity is never stored, so nothing can claim a deck is valid after it stopped being so.

```json
{
  "valid": false, "format": "unlimited", "ownedOnly": false,
  "deckSize": { "expected": 60, "actual": 5 },
  "rules": [
    { "rule": "DECK_SIZE", "ok": false, "errors": 1, "warnings": 0 },
    { "rule": "COPY_LIMIT", "ok": false, "errors": 1, "warnings": 0 },
    { "rule": "FORMAT_LEGALITY", "ok": true, "errors": 0, "warnings": 0 },
    { "rule": "OWNERSHIP", "ok": true, "errors": 0, "warnings": 1 }
  ],
  "issues": [
    { "severity": "error", "rule": "DECK_SIZE", "code": "DECK_SIZE_MISMATCH", "cardIds": [], "params": { "expected": 60, "actual": 5 }, "message": "The deck has 5 cards; it needs exactly 60" },
    { "severity": "error", "rule": "COPY_LIMIT", "code": "COPY_LIMIT_EXCEEDED", "cardIds": ["base1-4"], "params": { "name": "Charizard", "count": 5, "max": 4 }, "message": "Charizard has 5 copies; at most 4 are allowed" },
    { "severity": "warning", "rule": "OWNERSHIP", "code": "CARD_NOT_OWNED", "cardIds": ["base1-4"], "params": { "name": "Charizard", "needed": 5, "available": 0 }, "message": "Charizard (base1-4) needs 5 copies; 0 available" }
  ]
}
```

`rules` is always the four rules in this order — the builder's checklist; a warning never fails a rule. `issues` are sorted by rule, then first `cardId`, then `code`. **Clients branch on `code` and read `params`**; `message` is an English fallback and may be reworded. `cardIds` names the decklist rows an issue is about; `[]` means the whole deck.

| `code` | Severity | Raised when |
| --- | --- | --- |
| `DECK_SIZE_MISMATCH` | error | total copies ≠ `DECK_SIZE` (env, default 60) |
| `COPY_LIMIT_EXCEEDED` | error | more than 4 copies share a card **name**, across printings; basic energy exempt |
| `CARD_BANNED` | error | the card's `legalities[format]` is `Banned` |
| `CARD_NOT_LEGAL` | error | it is present and neither `Legal` nor `Banned` — `params.status` says what |
| `CARD_LEGALITY_UNKNOWN` | warning | the card records no legality for the format — every such card today is from a set released 2026-09-16 |
| `CARD_NOT_OWNED` | error when `ownedOnly`, else warning | the deck holds more copies than the owner has available |

**Basic energy is `supertype = Energy` with the `Basic` subtype**, and it is set aside before copies are counted by name — `Metal Energy` names both a basic and a special card, and only the special one is limited. **Available copies are `quantity − lockedQuantity`**: copies promised to a pending trade do not count, and a card the owner does not hold has 0. A deck never reserves copies itself; two decks may use the same cards.

**The verdict is the owner's only.** It states how many copies of each card the owner has, which is their private inventory. `validate` refuses anyone else like `PATCH` does — 404 for a private deck, 403 for a public one, 401 signed out — and no public or list response carries `validation`.

**`ownedOnly`** is the deck's mode — theorycrafting when false, strict when true. Toggling it changes one column; the decklist is not touched, and the verdict on the next save or validate reflects the new mode. A clone keeps its source's mode and is judged against the cloner's copies.

**Measured, 2026-09-28**, the engine directly and then through HTTP with the database checked after each step:

- the engine, called directly: 5 × Charizard → `COPY_LIMIT_EXCEEDED`; 5 × a basic energy → none; 5 × Double Colorless Energy → one; 4 + 1 Pikachu from two sets → one issue naming both printings; 10 basic + 4 special `Metal Energy` → none, 10 + 5 → one on the special card; an empty deck → only `DECK_SIZE_MISMATCH`, four `rules` rows; the same cards in reverse order → a byte-identical result
- through HTTP, every save answered 200/201 with the rows written and a `validation` in the body, including decks breaking each rule
- 60 copies → `DECK_SIZE` ok; 59 → `DECK_SIZE_MISMATCH` with `actual` 59
- in `expanded`, Archeops → `CARD_BANNED`; in `standard`, Erika's Oddish → `CARD_NOT_LEGAL` with `status` `Not Legal`, and a `me55` card → `CARD_LEGALITY_UNKNOWN` as a warning
- an owner holding 2 Charizard with 1 locked, deck of 2: `CARD_NOT_OWNED` with `available` 1, a warning; a card not held at all: `available` 0; after `PATCH {ownedOnly: true}` both errors and `valid: false`, `deck_cards` hashed identical before and after
- a save's `validation` and an immediate `POST /validate`: identical; two `POST /validate` in a row: byte-identical, and `decks`, `deck_cards` and `inventory_items` hashed identical before and after
- another member validating a private deck: 404, a public one: 403; signed out: 401; `GET /decks/:id` (owner and stranger), the public shelf and `GET /decks` carry no `validation`
- another member cloning that strict public deck: 201, `ownedOnly` true, `CARD_NOT_OWNED` computed from the cloner's copies (`available` 0 where the source's owner had 1)
````

These bullets are the plan's expected results. Before committing, check each against what the Task 2 and Task 3 probes actually printed, and change any that differ to what was measured — never the other way round.

- [ ] **Step 4: Check formatting and commit**

```bash
cd /m/projects/pokedrop && pnpm format:check
git add docs/API.md docs/DataModel.md
git commit -m "[PD-64]: document deck validation, the owned-only mode and probes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: formatting passes; the subject is ≤ 72 characters.
