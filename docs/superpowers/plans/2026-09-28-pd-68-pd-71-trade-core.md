# PD-68 – PD-71 Trade Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Propose, decline, cancel, admin-void, accept (atomic settlement) and counter trades, with escrow locks that can never be stranded and coins and cards that can never be duplicated or lost.

**Architecture:** Every way out of `PENDING` goes through `TradeCloseService.close` — a guarded `updateMany … where status = 'PENDING'` whose row lock serialises all transitions of a trade, plus the lock release and one audit row. Accept adds `TradeSettlementService.settle` (coins, then card moves through the new `InventoryService.applyMoves`) inside the same transaction. Notifications are written after commit by a new `NotificationsService` that never fails the trade.

**Tech Stack:** NestJS 12, Prisma 7 (`@prisma/adapter-pg`), PostgreSQL 17, Redis, Zod 4 contracts in `@pokedrop/shared`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-28-pd-68-pd-71-trade-core-design.md`

## Global Constraints

- **Work directly on `dev`.** Commit subjects `[PD-68]: …`, `[PD-69]: …`, `[PD-70]: …` or `[PD-71]: …`, ≤ 72 characters — commitlint rejects longer. Bodies end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **No automated tests in v1.** Verification is by throwaway probes; never add test files, runners or a CI step. Probes live in the session scratchpad, or at `apps/api/probe-pd68-*.mjs` when they need `dist`/`@prisma/client` resolution — never committed, deleted at the end of their task.
- **Minimal comments** — only where a tidy-up would silently break something.
- **`noUncheckedIndexedAccess` is on**: handle `T | undefined` explicitly, no `!`.
- **Every commit compiles:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` from the repo root.
- **No migration in this plan.** If anything seems to need one, stop and report.
- **The lock invariant:** for every `(userId, cardId)`, `lockedQuantity` = the sum of `OFFERED` quantities of `PENDING` trades initiated by that user. Every task's probe ends with the reconciliation query returning 0 rows.
- **Lock order inside a transaction:** the trade row → `users` rows ascending `id` (only when coins move) → `inventory_items` rows ascending `(userId, cardId)`.
- **Notifications and `invalidateSummary` run after the transaction commits, never inside it.**
- **A non-party asking about a trade gets 404 `Trade not found`; a party using the other role's route gets 403.**
- **Verified claims only.** Docs state what a probe measured; report contradictions with the spec rather than adjusting a claim.

## Review Focus

1. **A coins-only side** — a trade where one party gives only coins (B pays 50 coins for A's card). Expected: settles; one card moves; two ledger rows. *Task 5, scenario 3b.*
2. **A requested card the recipient holds but has locked in their own pending trade** — Expected: 409 `CARDS_UNAVAILABLE`, nothing moves; locked copies are not "available". *Task 5, scenario 4b.*
3. **Receiving a card you already hold with a lock on it** — Expected: `quantity` rises, `lockedQuantity` untouched, reconciliation still 0 rows. *Task 5, scenario 3c.*
4. **A pack open and an accept by the same user at the same moment** — Expected: both succeed; no deadlock (`40P01`) in the log. *Task 5, scenario 6b.*
5. **A counter offering cards the counter-initiator does not have available** — Expected: 409 `CARDS_UNAVAILABLE`; the original stays `PENDING` with its lock. *Task 6, scenario 5.*

### Shared shell setup

```bash
cd /m/projects/pokedrop
S="C:/Users/MaxSt/AppData/Local/Temp/claude/M--projects-pokedrop/79776e29-d9d0-49c9-8036-f54ef8082d5c/scratchpad"
PSQL="docker compose exec -T postgres psql -U pokedrop -d pokedrop -At"
API=http://localhost:4000/api/v1; AUTH=http://localhost:4000/api/auth; WEB=http://localhost:3000
req(){ who=$1; shift; m=$1; shift; p=$1; shift; if [ "$who" = anon ]; then curl -s -w ' |%{http_code}' -X "$m" "$API$p" -H 'Content-Type: application/json' "$@"; else curl -s -w ' |%{http_code}' -b "$S/jar-$who.txt" -X "$m" "$API$p" -H 'Content-Type: application/json' -H "Origin: $WEB" "$@"; fi; echo; }
strip(){ sed -E 's/,"requestId":"[^"]*"//'; }
idof(){ sed -E 's/^\{"id":"([^"]+)".*/\1/'; }
mkuser(){ curl -s -o /dev/null -X POST "$AUTH/sign-up/email" -H 'Content-Type: application/json' -H "Origin: $WEB" -d "{\"email\":\"pd68-$1@example.com\",\"password\":\"correct-horse-battery\",\"name\":\"PD68 $1\"}"; $PSQL -c "update users set \"emailVerified\" = true where email = 'pd68-$1@example.com'" >/dev/null; curl -s -o /dev/null -w "sign-in $1 %{http_code}\n" -c "$S/jar-$1.txt" -X POST "$AUTH/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $WEB" -d "{\"email\":\"pd68-$1@example.com\",\"password\":\"correct-horse-battery\"}"; }
uid(){ $PSQL -c "select id from users where email = 'pd68-$1@example.com'"; }
give(){ $PSQL -c "insert into inventory_items (id, \"userId\", \"cardId\", quantity, \"lockedQuantity\", \"acquiredAt\") values (gen_random_uuid()::text, '$(uid $1)', '$2', $3, 0, now()) on conflict (\"userId\", \"cardId\") do update set quantity = inventory_items.quantity + excluded.quantity" >/dev/null; }
coins(){ $PSQL -c "update users set currency = currency + ($2) where id = '$(uid $1)'; insert into currency_transactions (id, \"userId\", amount, type) values (gen_random_uuid()::text, '$(uid $1)', $2, 'GRANT')" >/dev/null; }
held(){ $PSQL -c "select coalesce((select quantity||'/'||\"lockedQuantity\" from inventory_items where \"userId\" = '$(uid $1)' and \"cardId\" = '$2'), 'none')"; }
checks(){
  $PSQL -c "select 'cards '||md5(string_agg(c||':'||s, ',' order by c)) from (select \"cardId\" c, sum(quantity) s from inventory_items group by 1) x"
  $PSQL -c "select 'coins '||sum(currency)||' ledger-mismatch '||(select count(*) from users u where currency <> coalesce((select sum(amount) from currency_transactions t where t.\"userId\" = u.id), 0)) from users"
  $PSQL -c "select 'unreconciled '||count(*) from (with promised as (select t.\"initiatorId\" u, ti.\"cardId\" c, sum(ti.quantity) q from trades t join trade_items ti on ti.\"tradeId\" = t.id where t.status = 'PENDING' and ti.side = 'OFFERED' group by 1, 2) select 1 from inventory_items i full join promised p on p.u = i.\"userId\" and p.c = i.\"cardId\" where coalesce(i.\"lockedQuantity\", 0) <> coalesce(p.q, 0)) r"
  $PSQL -c "select 'negative '||(select count(*) from inventory_items where quantity < 0 or \"lockedQuantity\" < 0) + (select count(*) from users where currency < 0)"
}
snap(){ $PSQL -c "select md5((select coalesce(string_agg(id||status||coalesce(\"resolvedAt\"::text, ''), ',' order by id), '') from trades) || (select coalesce(string_agg(\"userId\"||\"cardId\"||quantity||\"lockedQuantity\", ',' order by \"userId\", \"cardId\"), '') from inventory_items) || (select string_agg(id||currency, ',' order by id) from users) || (select coalesce(string_agg(id, ',' order by id), '') from currency_transactions))"; }
```

`checks` prints four lines — `cards <md5>`, `coins <sum> ledger-mismatch <n>`, `unreconciled <n>`, `negative <n>`. Run it before and after a scenario: `cards` and `coins` must be identical, `ledger-mismatch` unchanged, `unreconciled 0`, `negative 0`. Direct `coins`/`give` calls change the totals — take the "before" after the setup.

**Starting the API** (from `dist`; stop any previous one first — Git Bash has no `pkill`, use the PowerShell tool):

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'apps[/\\]api[/\\]dist[/\\]main\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }
```

```bash
pnpm build:shared && pnpm --filter @pokedrop/api build
(node apps/api/dist/main.js > "$S/api68.log" 2>&1 &)
for i in $(seq 1 40); do c=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/api/v1/health/ready); [ "$c" = 200 ] && break; sleep 1; done; echo "ready: $c"
```

**Cleanup at the end of every task that created probe users:** `$PSQL -c "delete from trades where \"initiatorId\" in (select id from users where email like 'pd68-%') or \"recipientId\" in (select id from users where email like 'pd68-%')"` (trades are `Restrict` on users — delete them first, children cascade), then `$PSQL -c "delete from audit_logs where \"actorId\" in (select id from users where email like 'pd68-%') or (entity = 'Trade' and \"entityId\" not in (select id from trades))"`, then `$PSQL -c "delete from users where email like 'pd68-%'"` (if that fails on another foreign key — pack openings from Task 5 — delete those rows for the probe users first and say so in the task report), then stop the API. Run `checks` once more: `unreconciled 0`.

### Live values

Measured 2026-09-28: the seed holds one `PENDING` trade (`seed-trade-pending`, `seed-ash` offering 1 × `base1-4`, locked) and one `ACCEPTED` (`seed-trade-accepted`); reconciliation 0 rows; the seed pack template `seed-template-base` costs 300; the moderate throttle is 30 per 60 s.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `packages/shared/src/entities/trade.ts` | **edit** — request schemas, `counteredTradeId`, limits, notification types |
| `packages/shared/src/primitives/error.ts` | **edit** — `CARDS_UNAVAILABLE`, `TRADE_NOT_PENDING`, `COUNTER_LIMIT` |
| `apps/api/src/common/throttle.ts` | **new** — `MODERATE_THROTTLE`, moved |
| `apps/api/src/packs/pack-open.throttle.ts` | **delete** |
| `apps/api/src/packs/packs.controller.ts` | **edit** — import path |
| `apps/api/src/notifications/{notifications.service,notifications.module,index}.ts` | **new** — the writer |
| `apps/api/src/inventory/{inventory.service,quantity,index}.ts`, `README.md` | **edit** — coded 409 on `lock`, `applyMoves`, `InventoryMove` |
| `apps/api/src/trades/trade-row.ts` | **new** — select, row type, mappers |
| `apps/api/src/trades/trade-close.service.ts` | **new** — the guarded close |
| `apps/api/src/trades/trade-settlement.service.ts` | **new** — coins and card moves |
| `apps/api/src/trades/trades-core.module.ts` | **new** — core services, no controllers |
| `apps/api/src/trades/trades.service.ts` | **new** — propose, decline, cancel, voidPending, accept, counter |
| `apps/api/src/trades/{trades.controller,admin-trades.controller,trades.dto,trades.module,index}.ts` | **new** — HTTP |
| `apps/api/src/app.module.ts` | **edit** — `TradesModule` |
| `docs/API.md`, `docs/DataModel.md` | **edit** — Task 7 |

---

### Task 1: Contracts, error codes, the shared throttle and the notification writer

**Files:**
- Modify: `packages/shared/src/entities/trade.ts`, `packages/shared/src/primitives/error.ts`
- Create: `apps/api/src/common/throttle.ts`
- Delete: `apps/api/src/packs/pack-open.throttle.ts`
- Modify: `apps/api/src/packs/packs.controller.ts`
- Create: `apps/api/src/notifications/notifications.service.ts`, `notifications.module.ts`, `index.ts`
- Probe (untracked): `apps/api/probe-pd68-contracts.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - shared: `TradeLineSchema`/`TradeLine`, `ProposeTradeSchema`/`ProposeTrade`, `CounterTradeSchema`/`CounterTrade`, `VoidTradeSchema`/`VoidTrade`, `TradeSchema.counteredTradeId: TradeId | null`, `MAX_TRADE_LINES = 20`, `MAX_TRADE_LINE_QUANTITY = 100`, `MAX_TRADE_CURRENCY = 1_000_000`, `MAX_COUNTER_CHAIN = 10`, `TRADE_NOTIFICATION_TYPES`, `TradeNotificationType`; `ERROR_CODES.CARDS_UNAVAILABLE | TRADE_NOT_PENDING | COUNTER_LIMIT`.
  - `MODERATE_THROTTLE` from `apps/api/src/common/throttle.ts`.
  - `NotificationsService.notify(entries: NotificationEntry[]): Promise<void>`, `NotificationEntry = { userId: string; type: string; payload: Prisma.InputJsonObject }`, `NotificationsModule` (exports the service).

- [ ] **Step 1: Replace `packages/shared/src/entities/trade.ts`**

```ts
import { z } from 'zod';
import { TradeItemSideSchema, TradeStatusSchema } from '../enums.js';
import { CardIdSchema, TradeIdSchema, TradeItemIdSchema, UserIdSchema } from '../primitives/id.js';

export const TradeItemSchema = z.object({
  id: TradeItemIdSchema,
  tradeId: TradeIdSchema,
  side: TradeItemSideSchema,
  cardId: CardIdSchema,
  quantity: z.number().int().min(1),
});
export type TradeItem = z.infer<typeof TradeItemSchema>;

export const TradeSchema = z.object({
  id: TradeIdSchema,
  initiatorId: UserIdSchema,
  recipientId: UserIdSchema,
  status: TradeStatusSchema,
  currencyFromInitiator: z.number().int().min(0),
  currencyFromRecipient: z.number().int().min(0),
  counteredTradeId: TradeIdSchema.nullable(),
  items: z.array(TradeItemSchema),
  createdAt: z.coerce.date(),
  resolvedAt: z.coerce.date().nullable(),
});
export type Trade = z.infer<typeof TradeSchema>;

export const MAX_TRADE_LINES = 20;
export const MAX_TRADE_LINE_QUANTITY = 100;
export const MAX_TRADE_CURRENCY = 1_000_000;
export const MAX_COUNTER_CHAIN = 10;

export const TradeLineSchema = z.strictObject({
  cardId: CardIdSchema,
  quantity: z.number().int().min(1).max(MAX_TRADE_LINE_QUANTITY),
});
export type TradeLine = z.infer<typeof TradeLineSchema>;

const TRADE_TERMS = {
  offered: z.array(TradeLineSchema).max(MAX_TRADE_LINES).default([]),
  requested: z.array(TradeLineSchema).max(MAX_TRADE_LINES).default([]),
  currencyFromInitiator: z.number().int().min(0).max(MAX_TRADE_CURRENCY).default(0),
  currencyFromRecipient: z.number().int().min(0).max(MAX_TRADE_CURRENCY).default(0),
};

type Terms = {
  offered: TradeLine[];
  requested: TradeLine[];
  currencyFromInitiator: number;
  currencyFromRecipient: number;
};

function checkTerms(terms: Terms, ctx: z.RefinementCtx): void {
  const lines = terms.offered.length + terms.requested.length;
  if (lines === 0 && terms.currencyFromInitiator === 0 && terms.currencyFromRecipient === 0) {
    ctx.addIssue({ code: 'custom', message: 'A trade must move at least one card or coin' });
  }

  const offered = new Set(terms.offered.map((line) => line.cardId));
  const requested = new Set(terms.requested.map((line) => line.cardId));
  if (offered.size !== terms.offered.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['offered'],
      message: 'A card may appear once per side; put its copies in quantity',
    });
  }
  if (requested.size !== terms.requested.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['requested'],
      message: 'A card may appear once per side; put its copies in quantity',
    });
  }
  if ([...offered].some((cardId) => requested.has(cardId))) {
    ctx.addIssue({
      code: 'custom',
      path: ['requested'],
      message: 'A card cannot be both offered and requested',
    });
  }
}

export const CounterTradeSchema = z.strictObject(TRADE_TERMS).superRefine(checkTerms);
export type CounterTrade = z.infer<typeof CounterTradeSchema>;

export const ProposeTradeSchema = z
  .strictObject({ recipientId: UserIdSchema, ...TRADE_TERMS })
  .superRefine(checkTerms);
export type ProposeTrade = z.infer<typeof ProposeTradeSchema>;

export const VoidTradeSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
});
export type VoidTrade = z.infer<typeof VoidTradeSchema>;

export const TRADE_NOTIFICATION_TYPES = [
  'trade.proposed',
  'trade.accepted',
  'trade.declined',
  'trade.cancelled',
  'trade.countered',
  'trade.voided',
  'trade.expired',
] as const;
export type TradeNotificationType = (typeof TRADE_NOTIFICATION_TYPES)[number];
```

- [ ] **Step 2: Add the codes to `packages/shared/src/primitives/error.ts`**

Replace the `ERROR_CODES` object with:

```ts
export const ERROR_CODES = {
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  PACK_UNAVAILABLE: 'PACK_UNAVAILABLE',
  OPEN_ID_CONFLICT: 'OPEN_ID_CONFLICT',
  CARDS_UNAVAILABLE: 'CARDS_UNAVAILABLE',
  TRADE_NOT_PENDING: 'TRADE_NOT_PENDING',
  COUNTER_LIMIT: 'COUNTER_LIMIT',
} as const;
```

- [ ] **Step 3: Move the throttle**

Create `apps/api/src/common/throttle.ts` with exactly the body of `apps/api/src/packs/pack-open.throttle.ts` (same import `../config/index.js` — `common/` sits at the same depth as `packs/`), then add one line to its doc comment so it reads:

```ts
/**
 * Overrides `default` rather than registering a `moderate` throttler: the
 * guard runs every registered throttler on every route, and a second one would
 * silently limit the health probes. Pack opening and trade creation share it.
 */
```

Delete `apps/api/src/packs/pack-open.throttle.ts`. In `apps/api/src/packs/packs.controller.ts` change the import to:

```ts
import { MODERATE_THROTTLE } from '../common/throttle.js';
```

Check: `grep -rn "pack-open.throttle" apps/api/src` prints nothing.

- [ ] **Step 4: Write the notification writer**

`apps/api/src/notifications/notifications.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/index.js';

export type NotificationEntry = {
  userId: string;
  type: string;
  payload: Prisma.InputJsonObject;
};

/**
 * Called after the triggering transaction commits, never inside it: a
 * notification that failed must not undo the trade it describes.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async notify(entries: NotificationEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    try {
      await this.prisma.notification.createMany({ data: entries });
    } catch (error) {
      const what = entries.map((entry) => `${entry.type} to ${entry.userId}`).join(', ');
      const why = error instanceof Error ? error.message : String(error);
      this.logger.error(`Notification write failed (${what}): ${why}`);
    }
  }
}
```

`apps/api/src/notifications/notifications.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';

@Module({
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

`apps/api/src/notifications/index.ts`:

```ts
export { NotificationsModule } from './notifications.module.js';
export { NotificationsService, type NotificationEntry } from './notifications.service.js';
```

- [ ] **Step 5: Compile**

```bash
cd /m/projects/pokedrop && pnpm typecheck && pnpm lint && pnpm format:check
```

Expected: all pass.

- [ ] **Step 6: Probe the contracts — `apps/api/probe-pd68-contracts.mjs`**

```js
import assert from 'node:assert/strict';
import { CounterTradeSchema, ERROR_CODES, ProposeTradeSchema, TradeSchema, VoidTradeSchema } from '@pokedrop/shared';

const X = { cardId: 'base1-4', quantity: 1 };
const ok = ProposeTradeSchema.safeParse({ recipientId: 'u', offered: [X] });
assert.equal(ok.success, true);
assert.deepEqual([ok.data.requested, ok.data.currencyFromInitiator, ok.data.currencyFromRecipient], [[], 0, 0]);
assert.equal(ProposeTradeSchema.safeParse({ recipientId: 'u', currencyFromRecipient: 50 }).success, true, 'coins only is a trade');

const fails = (schema, value) => schema.safeParse(value).success === false;
assert.ok(fails(ProposeTradeSchema, { recipientId: 'u' }), 'empty trade');
assert.ok(fails(ProposeTradeSchema, { recipientId: 'u', offered: [X, X] }), 'a card twice on one side');
assert.ok(fails(ProposeTradeSchema, { recipientId: 'u', offered: [X], requested: [X] }), 'a card on both sides');
assert.ok(fails(ProposeTradeSchema, { recipientId: 'u', offered: Array.from({ length: 21 }, (_, i) => ({ cardId: `c-${i}`, quantity: 1 })) }), '21 lines');
assert.ok(fails(ProposeTradeSchema, { recipientId: 'u', offered: [{ cardId: 'base1-4', quantity: 101 }] }), 'quantity 101');
assert.ok(fails(ProposeTradeSchema, { recipientId: 'u', currencyFromInitiator: 1_000_001 }), 'too many coins');
assert.ok(fails(ProposeTradeSchema, { recipientId: 'u', offered: [X], userId: 'me' }), 'unknown key');
assert.ok(fails(CounterTradeSchema, { recipientId: 'u', offered: [X] }), 'a counter names no recipient');
assert.equal(CounterTradeSchema.safeParse({ offered: [X] }).success, true);
assert.ok(fails(VoidTradeSchema, { reason: '   ' }), 'blank reason');
assert.equal(VoidTradeSchema.parse({ reason: '  fraud  ' }).reason, 'fraud');
assert.deepEqual([ERROR_CODES.CARDS_UNAVAILABLE, ERROR_CODES.TRADE_NOT_PENDING, ERROR_CODES.COUNTER_LIMIT], ['CARDS_UNAVAILABLE', 'TRADE_NOT_PENDING', 'COUNTER_LIMIT']);
assert.ok(fails(TradeSchema, { id: 't', initiatorId: 'a', recipientId: 'b', status: 'PENDING', currencyFromInitiator: 0, currencyFromRecipient: 0, items: [], createdAt: new Date(), resolvedAt: null }), 'counteredTradeId is required');
console.log('probe-pd68-contracts: all assertions passed');
```

Run:

```bash
cd /m/projects/pokedrop && pnpm build:shared && cd apps/api && node probe-pd68-contracts.mjs
```

Expected: `probe-pd68-contracts: all assertions passed`.

- [ ] **Step 7: Delete the probe and commit**

```bash
rm /m/projects/pokedrop/apps/api/probe-pd68-contracts.mjs
cd /m/projects/pokedrop
git add packages/shared/src/entities/trade.ts packages/shared/src/primitives/error.ts apps/api/src/common/throttle.ts apps/api/src/packs apps/api/src/notifications
git commit -m "[PD-68]: add trade contracts, codes and a notification writer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Inventory moves and a coded 409 on `lock`

**Files:**
- Modify: `apps/api/src/inventory/quantity.ts`, `inventory.service.ts`, `index.ts`, `README.md`
- Probe (untracked): `apps/api/probe-pd68-inventory.mjs`

**Interfaces:**
- Consumes: `ERROR_CODES.CARDS_UNAVAILABLE` (Task 1).
- Produces:
  - `InventoryMove = { userId: string; cardId: string; quantity: number; fromLock?: boolean }` exported from `apps/api/src/inventory/index.ts` along with `QuantityChange`.
  - `InventoryService.applyMoves(tx: TransactionClient, moves: InventoryMove[]): Promise<void>` — throws `HttpException` 409 `{ code: 'CARDS_UNAVAILABLE' }` on a shortfall.
  - `InventoryService.lock` throws 409 `{ code: 'CARDS_UNAVAILABLE' }` (message unchanged).

- [ ] **Step 1: Add the move type to `apps/api/src/inventory/quantity.ts`**

After `export type QuantityChange = …;` add:

```ts
/** Positive receives, negative gives; `fromLock` gives copies locked for the trade. */
export type InventoryMove = {
  userId: string;
  cardId: string;
  quantity: number;
  fromLock?: boolean;
};
```

`apps/api/src/inventory/index.ts` becomes:

```ts
export { InventoryModule } from './inventory.module.js';
export { InventoryService } from './inventory.service.js';
export type { InventoryMove, QuantityChange } from './quantity.js';
```

- [ ] **Step 2: Code the `lock` refusal**

In `apps/api/src/inventory/inventory.service.ts`:

- Imports: `ConflictException` → replace with `HttpStatus` and `Logger` in the `@nestjs/common` import (keep `Injectable`; keep `ConflictException` only if something else in the file still uses it — `grep -n ConflictException` after the edit); change `import type { Prisma } from '@prisma/client';` to `import { Prisma } from '@prisma/client';`; add `ERROR_CODES` to the `@pokedrop/shared` import; add:

```ts
import { randomUUID } from 'node:crypto';
import { domainError } from '../common/errors/domain-error.js';
```

and add `type InventoryMove` to the `./quantity.js` import.

- In `lock`, replace

```ts
        throw new ConflictException(`Not enough available copies of ${change.cardId}`);
```

with

```ts
        throw domainError(
          HttpStatus.CONFLICT,
          ERROR_CODES.CARDS_UNAVAILABLE,
          `Not enough available copies of ${change.cardId}`,
        );
```

- Add a logger field as the first member of the class:

```ts
  private readonly logger = new Logger(InventoryService.name);
```

- [ ] **Step 3: Add `applyMoves` after `release`**

```ts
  /**
   * Settles card moves inside the caller's transaction. Rows are taken in
   * (userId, cardId) order, the order every other writer uses, so two
   * settlements - or a settlement and a pack open - cannot deadlock. Emptied
   * rows are deleted. The summary is the caller's to invalidate after commit.
   */
  async applyMoves(tx: TransactionClient, moves: InventoryMove[]): Promise<void> {
    const seen = new Set<string>();
    for (const move of moves) {
      if (!Number.isInteger(move.quantity) || move.quantity === 0) {
        throw new Error(`Inventory move for ${move.cardId} must be a non-zero integer`);
      }
      const key = `${move.userId}\u0000${move.cardId}`;
      if (seen.has(key)) {
        throw new Error(`Card ${move.cardId} moves twice for ${move.userId}`);
      }
      seen.add(key);
    }

    const sorted = [...moves].sort(
      (a, b) => compare(a.userId, b.userId) || compare(a.cardId, b.cardId),
    );
    const givers: Prisma.Sql[] = [];

    for (const move of sorted) {
      if (move.quantity > 0) {
        await tx.$executeRaw`
          INSERT INTO inventory_items (id, "userId", "cardId", quantity, "lockedQuantity", "acquiredAt")
          VALUES (${randomUUID()}, ${move.userId}, ${move.cardId}, ${move.quantity}, 0, now())
          ON CONFLICT ("userId", "cardId") DO UPDATE
          SET quantity = inventory_items.quantity + EXCLUDED.quantity,
              "acquiredAt" = EXCLUDED."acquiredAt"`;
        continue;
      }

      const count = -move.quantity;
      const updated = move.fromLock
        ? await tx.$executeRaw`
            UPDATE inventory_items
            SET quantity = quantity - ${count}, "lockedQuantity" = "lockedQuantity" - ${count}
            WHERE "userId" = ${move.userId} AND "cardId" = ${move.cardId}
              AND "lockedQuantity" >= ${count}`
        : await tx.$executeRaw`
            UPDATE inventory_items
            SET quantity = quantity - ${count}
            WHERE "userId" = ${move.userId} AND "cardId" = ${move.cardId}
              AND quantity - "lockedQuantity" >= ${count}`;

      if (updated === 0) {
        if (move.fromLock) {
          this.logger.error(
            `Escrow invariant broken: ${move.userId} has fewer than ${count} locked ${move.cardId}`,
          );
        }
        throw domainError(
          HttpStatus.CONFLICT,
          ERROR_CODES.CARDS_UNAVAILABLE,
          `User ${move.userId} no longer has ${count} available ${move.cardId}`,
        );
      }
      givers.push(Prisma.sql`(${move.userId}, ${move.cardId})`);
    }

    if (givers.length > 0) {
      await tx.$executeRaw`
        DELETE FROM inventory_items
        WHERE quantity = 0 AND "lockedQuantity" = 0
          AND ("userId", "cardId") IN (${Prisma.join(givers)})`;
    }
  }
```

And, at module level at the end of the file (next to the other helpers):

```ts
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
```

If a `compare` helper already exists in the file, reuse it instead of adding a second one.

- [ ] **Step 4: Document the contract in `apps/api/src/inventory/README.md`**

After the `## Reading availability` section, insert:

```markdown
## Moving cards

`applyMoves(tx, moves)` settles a trade's card movements inside the caller's
transaction. A move is `{ userId, cardId, quantity, fromLock? }`: positive
receives (the pack open's upsert), negative gives — from copies the user had
locked for this trade when `fromLock`, otherwise from available copies. A
shortfall answers 409 `CARDS_UNAVAILABLE` and the caller's transaction rolls
back whole; a `fromLock` shortfall is also logged as an escrow bug. Rows are
taken in `(userId, cardId)` order, and rows a move empties — `quantity = 0` and
`lockedQuantity = 0` — are deleted. A `(user, card)` may move once per call.

## The lock invariant

For every `(userId, cardId)`, `lockedQuantity` equals the sum of `OFFERED`
quantities over `PENDING` trades that user initiated. Trades (M8) keep it:
proposing adds, every way out of `PENDING` subtracts, and accepting consumes the
lock with the copies it guarded. The reconciliation query in
`docs/DataModel.md` (Trade) returns no rows when it holds.
```

Also change the sentence in `## Locking and releasing` that reads "**`lock` refuses with a 409 and leaves the transaction usable.**" to "**`lock` refuses with a 409 `CARDS_UNAVAILABLE` and leaves the transaction usable.**"

- [ ] **Step 5: Compile**

```bash
cd /m/projects/pokedrop && pnpm typecheck && pnpm lint && pnpm format:check && pnpm --filter @pokedrop/api build
```

Expected: all pass.

- [ ] **Step 6: Probe against the database — `apps/api/probe-pd68-inventory.mjs`**

```js
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { InventoryService } from './dist/inventory/inventory.service.js';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const inventory = new InventoryService(prisma, { del: async () => {} });
const U1 = 'pd68-probe-1';
const U2 = 'pd68-probe-2';
const row = (userId, cardId) => prisma.inventoryItem.findUnique({ where: { userId_cardId: { userId, cardId } } });
const rows = () => prisma.inventoryItem.findMany({ where: { userId: { in: [U1, U2] } }, orderBy: [{ userId: 'asc' }, { cardId: 'asc' }] });
const coded = (status, code) => (e) => e.getStatus?.() === status && e.getResponse?.().code === code;

for (const id of [U1, U2]) await prisma.user.create({ data: { id, email: `${id}@example.com`, displayName: id } });
try {
  await prisma.inventoryItem.createMany({ data: [
    { userId: U1, cardId: 'base1-4', quantity: 1, lockedQuantity: 1 },
    { userId: U1, cardId: 'base1-2', quantity: 3, lockedQuantity: 1 },
    { userId: U2, cardId: 'base1-58', quantity: 2, lockedQuantity: 0 },
  ] });

  // a swap given out of order: a locked give that empties its row, a receive into a new row, a partial give
  await prisma.$transaction((tx) => inventory.applyMoves(tx, [
    { userId: U2, cardId: 'base1-4', quantity: 1 },
    { userId: U1, cardId: 'base1-4', quantity: -1, fromLock: true },
    { userId: U2, cardId: 'base1-58', quantity: -1 },
    { userId: U1, cardId: 'base1-58', quantity: 1 },
  ]));
  assert.equal(await row(U1, 'base1-4'), null, 'the emptied row is deleted');
  assert.equal((await row(U2, 'base1-4'))?.quantity, 1);
  assert.deepEqual([(await row(U2, 'base1-58'))?.quantity, (await row(U1, 'base1-58'))?.quantity], [1, 1]);

  // locked copies are not available: 3 held, 1 locked, 3 asked → refused, and the receive before it rolls back
  const before = JSON.stringify(await rows());
  await assert.rejects(prisma.$transaction((tx) => inventory.applyMoves(tx, [
    { userId: U2, cardId: 'base1-2', quantity: 3 },
    { userId: U1, cardId: 'base1-2', quantity: -3 },
  ])), coded(409, 'CARDS_UNAVAILABLE'));
  assert.equal(JSON.stringify(await rows()), before, 'rollback left every row as it was');

  // receiving into a row that carries a lock keeps the lock
  await prisma.$transaction((tx) => inventory.applyMoves(tx, [{ userId: U1, cardId: 'base1-2', quantity: 2 }]));
  const kept = await row(U1, 'base1-2');
  assert.deepEqual([kept?.quantity, kept?.lockedQuantity], [5, 1]);

  // lock now answers with a code
  await assert.rejects(prisma.$transaction((tx) => inventory.lock(tx, U1, [{ cardId: 'base1-2', quantity: 5 }])), coded(409, 'CARDS_UNAVAILABLE'));

  // a zero move and a duplicate move are bugs, not user errors
  await assert.rejects(prisma.$transaction((tx) => inventory.applyMoves(tx, [{ userId: U1, cardId: 'base1-2', quantity: 0 }])), /non-zero integer/);
  await assert.rejects(prisma.$transaction((tx) => inventory.applyMoves(tx, [
    { userId: U1, cardId: 'base1-2', quantity: 1 }, { userId: U1, cardId: 'base1-2', quantity: -1 },
  ])), /moves twice/);
  console.log('probe-pd68-inventory: all assertions passed');
} finally {
  await prisma.user.deleteMany({ where: { id: { in: [U1, U2] } } });
  await prisma.$disconnect();
}
```

Run:

```bash
cd /m/projects/pokedrop/apps/api && node --env-file=../../.env probe-pd68-inventory.mjs
```

Expected: `probe-pd68-inventory: all assertions passed`. If the compound unique is not named `userId_cardId`, read it from `apps/api/prisma/schema.prisma` and adjust the probe, not the code.

- [ ] **Step 7: Delete the probe and commit**

```bash
rm /m/projects/pokedrop/apps/api/probe-pd68-inventory.mjs
cd /m/projects/pokedrop
git add apps/api/src/inventory
git commit -m "[PD-70]: move cards between users in lock order, deleting emptied rows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Propose a trade (PD-68)

**Files:**
- Create: `apps/api/src/trades/trade-row.ts`, `trades-core.module.ts`, `trades.service.ts`, `trades.dto.ts`, `trades.controller.ts`, `trades.module.ts`, `index.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: Task 1 (`ProposeTradeSchema`, `ProposeTrade`, `Trade`, `TradeLine`, `TradeNotificationType`, `ERROR_CODES`, `MODERATE_THROTTLE`, `NotificationsModule`, `NotificationsService`); Task 2 (`InventoryService.lock`, `QuantityChange`); `AuditService.record(tx, entry)` (global).
- Produces:
  - `TRADE_SELECT`, `TradeRow`, `toTrade(row): Trade`, `offeredChanges(trade): QuantityChange[]`, `tradeLines(terms)` in `trades/trade-row.ts`.
  - `TradesCoreModule` (imports and re-exports `InventoryModule`, `NotificationsModule`; later tasks add providers).
  - `TradesService` with `propose(user, input): Promise<Trade>` and private helpers `assertTerms`, `notify`.
  - Route `POST /trades` → 201.

- [ ] **Step 1: `apps/api/src/trades/trade-row.ts`**

```ts
import type { Prisma } from '@prisma/client';
import { TradeSchema, type Trade, type TradeLine } from '@pokedrop/shared';
import type { QuantityChange } from '../inventory/index.js';

export const TRADE_SELECT = {
  id: true,
  initiatorId: true,
  recipientId: true,
  status: true,
  currencyFromInitiator: true,
  currencyFromRecipient: true,
  counteredTradeId: true,
  createdAt: true,
  resolvedAt: true,
  items: {
    orderBy: [{ side: 'asc' }, { cardId: 'asc' }],
    select: { id: true, tradeId: true, side: true, cardId: true, quantity: true },
  },
} satisfies Prisma.TradeSelect;

export type TradeRow = Prisma.TradeGetPayload<{ select: typeof TRADE_SELECT }>;

export function toTrade(row: TradeRow): Trade {
  return TradeSchema.parse(row);
}

export function offeredChanges(trade: Pick<TradeRow, 'items'>): QuantityChange[] {
  return trade.items
    .filter((item) => item.side === 'OFFERED')
    .map((item) => ({ cardId: item.cardId, quantity: item.quantity }));
}

export function tradeLines(terms: { offered: TradeLine[]; requested: TradeLine[] }) {
  return [
    ...terms.offered.map((line) => ({
      side: 'OFFERED' as const,
      cardId: line.cardId,
      quantity: line.quantity,
    })),
    ...terms.requested.map((line) => ({
      side: 'REQUESTED' as const,
      cardId: line.cardId,
      quantity: line.quantity,
    })),
  ];
}
```

- [ ] **Step 2: `apps/api/src/trades/trades-core.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/index.js';
import { NotificationsModule } from '../notifications/index.js';

/**
 * No controllers, so the worker (PD-74) can import the trade services without
 * Better Auth or the HTTP guards.
 */
@Module({
  imports: [InventoryModule, NotificationsModule],
  exports: [InventoryModule, NotificationsModule],
})
export class TradesCoreModule {}
```

- [ ] **Step 3: `apps/api/src/trades/trades.service.ts`**

```ts
import { BadRequestException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  ERROR_CODES,
  type ProposeTrade,
  type Trade,
  type TradeLine,
  type TradeNotificationType,
} from '@pokedrop/shared';
import { AuditService } from '../audit/index.js';
import { domainError } from '../common/errors/domain-error.js';
import type { AuthUser } from '../common/request-auth.js';
import { InventoryService } from '../inventory/index.js';
import { NotificationsService } from '../notifications/index.js';
import { PrismaService } from '../prisma/index.js';
import { TRADE_SELECT, toTrade, tradeLines } from './trade-row.js';

type Terms = { offered: TradeLine[]; requested: TradeLine[]; currencyFromInitiator: number };

@Injectable()
export class TradesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async propose(user: AuthUser, input: ProposeTrade): Promise<Trade> {
    if (input.recipientId === user.id) {
      throw new BadRequestException('You cannot trade with yourself');
    }
    const recipient = await this.prisma.user.findUnique({
      where: { id: input.recipientId },
      select: { id: true },
    });
    if (recipient === null) {
      throw new NotFoundException('User not found');
    }
    await this.assertTerms(user.id, input);

    const row = await this.prisma.withTransaction(async (tx) => {
      const created = await tx.trade.create({
        data: {
          initiatorId: user.id,
          recipientId: input.recipientId,
          currencyFromInitiator: input.currencyFromInitiator,
          currencyFromRecipient: input.currencyFromRecipient,
          items: { createMany: { data: tradeLines(input) } },
        },
        select: TRADE_SELECT,
      });
      await this.inventory.lock(tx, user.id, input.offered);
      await this.audit.record(tx, {
        actorId: user.id,
        action: 'trade.propose',
        entity: 'Trade',
        entityId: created.id,
        meta: { from: null, to: 'PENDING', counteredTradeId: null },
      });
      return created;
    });

    await this.notify([row.recipientId], 'trade.proposed', row.id, user.id);
    return toTrade(row);
  }

  /**
   * The recipient's holdings are not checked: an inventory is private, and a
   * refusal here would disclose it. Settlement checks.
   */
  private async assertTerms(initiatorId: string, terms: Terms): Promise<void> {
    const ids = [...terms.offered, ...terms.requested].map((line) => line.cardId);
    if (ids.length > 0) {
      const found = await this.prisma.card.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      const known = new Set(found.map((card) => card.id));
      const unknown = ids.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        throw new BadRequestException(`Unknown card: ${unknown.join(', ')}`);
      }
    }

    if (terms.currencyFromInitiator > 0) {
      const me = await this.prisma.user.findUniqueOrThrow({
        where: { id: initiatorId },
        select: { currency: true },
      });
      if (me.currency < terms.currencyFromInitiator) {
        throw domainError(
          HttpStatus.PAYMENT_REQUIRED,
          ERROR_CODES.INSUFFICIENT_FUNDS,
          'Not enough coins for this offer',
        );
      }
    }
  }

  private notify(
    userIds: string[],
    type: TradeNotificationType,
    tradeId: string,
    actorId: string | null,
  ): Promise<void> {
    return this.notifications.notify(
      userIds.map((userId) => ({ userId, type, payload: { tradeId, actorId } })),
    );
  }
}
```

- [ ] **Step 4: DTOs, controller, module, index, registration**

`apps/api/src/trades/trades.dto.ts`:

```ts
import { CounterTradeSchema, ProposeTradeSchema, VoidTradeSchema } from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

export class ProposeTradeDto extends createZodDto('ProposeTrade', ProposeTradeSchema) {}

export class CounterTradeDto extends createZodDto('CounterTrade', CounterTradeSchema) {}

export class VoidTradeDto extends createZodDto('VoidTrade', VoidTradeSchema) {}
```

`apps/api/src/trades/trades.controller.ts`:

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Trade } from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { MODERATE_THROTTLE } from '../common/throttle.js';
import { ProposeTradeDto } from './trades.dto.js';
import { TradesService } from './trades.service.js';

@ApiTags('trades')
@Controller('trades')
export class TradesController {
  constructor(private readonly trades: TradesService) {}

  @Throttle(MODERATE_THROTTLE)
  @Post()
  propose(@CurrentUser() user: AuthUser, @Body() body: ProposeTradeDto): Promise<Trade> {
    return this.trades.propose(user, body);
  }
}
```

`apps/api/src/trades/trades.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TradesController } from './trades.controller.js';
import { TradesCoreModule } from './trades-core.module.js';
import { TradesService } from './trades.service.js';

@Module({
  imports: [TradesCoreModule],
  controllers: [TradesController],
  providers: [TradesService],
})
export class TradesModule {}
```

`apps/api/src/trades/index.ts`:

```ts
export { TradesCoreModule } from './trades-core.module.js';
export { TradesModule } from './trades.module.js';
```

`apps/api/src/app.module.ts`: add `import { TradesModule } from './trades/index.js';` next to the other feature imports, and `TradesModule,` after `DecksModule,` in `imports`.

- [ ] **Step 5: Compile**

```bash
cd /m/projects/pokedrop && pnpm typecheck && pnpm lint && pnpm format:check
```

Expected: all pass.

- [ ] **Step 6: Probe through HTTP**

Start the API (Shared shell setup). Then:

```bash
mkuser a; mkuser b; mkuser c
give a base1-4 1; give a base1-2 2; coins a 500
A=$(uid a); B=$(uid b); C=$(uid c)
checks > "$S/c0.txt"; cat "$S/c0.txt"
```

1. **Proposal locks; a second promise of the same copy fails:**

```bash
T1=$(req a POST /trades -d "{\"recipientId\":\"$B\",\"offered\":[{\"cardId\":\"base1-4\",\"quantity\":1}],\"requested\":[{\"cardId\":\"base1-58\",\"quantity\":1}]}" | tee "$S/t1.json" | idof); grep -o '"status":"PENDING"\|"counteredTradeId":null\||[0-9]*$' "$S/t1.json" | tr '\n' ' '; echo
held a base1-4
req a POST /trades -d "{\"recipientId\":\"$C\",\"offered\":[{\"cardId\":\"base1-4\",\"quantity\":1}]}" | strip
$PSQL -c "select count(*) from trades where \"initiatorId\" = '$A'"
$PSQL -c "select action, meta from audit_logs where \"entityId\" = '$T1'"
$PSQL -c "select \"userId\" = '$B', type, payload from notifications where payload->>'tradeId' = '$T1'"
```

Expected: `"status":"PENDING" "counteredTradeId":null |201`; `held` → `1/1`; the second proposal → 409 with `"code":"CARDS_UNAVAILABLE"`; 1 trade; one audit row `trade.propose` with `{"to": "PENDING", "from": null, …}`; one notification, `t|trade.proposed|{"tradeId": …, "actorId": …}`.

2. **A failed proposal leaves no lock behind** (base1-2 is available, base1-60 is not held):

```bash
req a POST /trades -d "{\"recipientId\":\"$C\",\"offered\":[{\"cardId\":\"base1-2\",\"quantity\":1},{\"cardId\":\"base1-60\",\"quantity\":1}]}" | strip
held a base1-2; $PSQL -c "select count(*) from trades where \"initiatorId\" = '$A'"
```

Expected: 409 `CARDS_UNAVAILABLE` naming `base1-60`; `held` → `2/0`; still 1 trade.

3. **Refusals before any write:**

```bash
req a POST /trades -d "{\"recipientId\":\"$A\",\"offered\":[{\"cardId\":\"base1-2\",\"quantity\":1}]}" | strip          # 400 self
req a POST /trades -d '{"recipientId":"nobody","offered":[{"cardId":"base1-2","quantity":1}]}' | strip                 # 404 User not found
req a POST /trades -d "{\"recipientId\":\"$B\",\"offered\":[{\"cardId\":\"nope-1\",\"quantity\":1}]}" | strip           # 400 Unknown card: nope-1
req a POST /trades -d "{\"recipientId\":\"$B\"}" | strip                                                                  # 400 at least one card or coin
req a POST /trades -d "{\"recipientId\":\"$B\",\"offered\":[{\"cardId\":\"base1-2\",\"quantity\":1}],\"currencyFromInitiator\":600}" | strip   # 402 INSUFFICIENT_FUNDS
req anon POST /trades -d "{\"recipientId\":\"$B\",\"currencyFromRecipient\":5}" | strip                                  # 401
held a base1-2; $PSQL -c "select count(*) from trades where \"initiatorId\" = '$A'"
```

Expected: the six statuses in the comments; `held` → `2/0`; still 1 trade.

4. **A notification failure does not fail the trade** (spec scenario 12):

```bash
docker compose exec -T postgres psql -U pokedrop -d pokedrop <<'SQL'
create function pd68_fail() returns trigger language plpgsql as $$ begin raise exception 'pd68 injected'; end $$;
create trigger pd68_fail before insert on notifications for each row execute function pd68_fail();
SQL
T2=$(req a POST /trades -d "{\"recipientId\":\"$C\",\"offered\":[{\"cardId\":\"base1-2\",\"quantity\":1}]}" | tee "$S/t2.json" | idof); grep -o '|[0-9]*$' "$S/t2.json"
docker compose exec -T postgres psql -U pokedrop -d pokedrop -c "drop trigger pd68_fail on notifications; drop function pd68_fail();"
$PSQL -c "select status from trades where id = '$T2'"; held a base1-2
$PSQL -c "select count(*) from notifications where payload->>'tradeId' = '$T2'"
grep -c "Notification write failed" "$S/api68.log"
```

Expected: `|201`; `PENDING`; `2/1`; `0` notifications; at least `1` log line.

5. **Throttle** (spec scenario 13), from a user who has not proposed yet this minute:

```bash
for i in $(seq 1 31); do curl -s -o /dev/null -w '%{http_code}\n' -b "$S/jar-c.txt" -X POST "$API/trades" -H 'Content-Type: application/json' -H "Origin: $WEB" -d '{}'; done | sort | uniq -c
```

Expected: `30 400` and `1 429`.

6. **Invariants:** `checks` → `unreconciled 0`, `negative 0`; `cards` and `coins` equal to `$S/c0.txt`.

Then clean up (Shared shell setup) and stop the API.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/trades apps/api/src/app.module.ts
git commit -m "[PD-68]: propose a trade and lock what it offers in one transaction" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Decline, cancel and admin-void a pending trade (PD-69)

**Files:**
- Create: `apps/api/src/trades/trade-close.service.ts`, `apps/api/src/trades/admin-trades.controller.ts`
- Modify: `apps/api/src/trades/trades-core.module.ts`, `trades.service.ts`, `trades.controller.ts`, `trades.module.ts`

**Interfaces:**
- Consumes: `TradeRow`, `TRADE_SELECT`, `toTrade`, `offeredChanges` (Task 3); `InventoryService.release`; `AuditService.record`; `ERROR_CODES.TRADE_NOT_PENDING`.
- Produces:
  - `TradeCloseService.close(tx, trade: Pick<TradeRow, 'id' | 'initiatorId' | 'items'>, options: CloseOptions): Promise<void>`, `CloseOptions = { to: Exclude<TradeStatus, 'PENDING'>; action: string; actorId: string | null; release: boolean; meta?: Prisma.InputJsonObject }` — exported from `TradesCoreModule`.
  - `TradesService.decline(user, id)`, `cancel(user, id)`, `voidPending(admin, id, reason)`, and private `loadAsParty(user, id): Promise<TradeRow>`, `read(id): Promise<Trade>`; module functions `assertRole(trade, user, role)`, `counterparty(trade, userId)`.
  - Routes `POST /trades/:id/decline`, `POST /trades/:id/cancel` → 200; `POST /admin/trades/:id/void` → 200.

- [ ] **Step 1: `apps/api/src/trades/trade-close.service.ts`**

```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma, TradeStatus } from '@prisma/client';
import { ERROR_CODES } from '@pokedrop/shared';
import { AuditService } from '../audit/index.js';
import { domainError } from '../common/errors/domain-error.js';
import { InventoryService } from '../inventory/index.js';
import type { TransactionClient } from '../prisma/index.js';
import { offeredChanges, type TradeRow } from './trade-row.js';

export type CloseOptions = {
  to: Exclude<TradeStatus, 'PENDING'>;
  action: string;
  actorId: string | null;
  /** False for accept, whose settlement consumes the lock, and for counter, which releases in lock order. */
  release: boolean;
  meta?: Prisma.InputJsonObject;
};

@Injectable()
export class TradeCloseService {
  constructor(
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The only way out of PENDING. The guarded update takes the trade's row lock
   * first, so every transition of one trade is serialised and the loser of a
   * race finds it no longer PENDING.
   */
  async close(
    tx: TransactionClient,
    trade: Pick<TradeRow, 'id' | 'initiatorId' | 'items'>,
    options: CloseOptions,
  ): Promise<void> {
    const { count } = await tx.trade.updateMany({
      where: { id: trade.id, status: 'PENDING' },
      data: { status: options.to, resolvedAt: new Date() },
    });
    if (count === 0) {
      const current = await tx.trade.findUnique({
        where: { id: trade.id },
        select: { status: true },
      });
      throw domainError(
        HttpStatus.CONFLICT,
        ERROR_CODES.TRADE_NOT_PENDING,
        `This trade is already ${current?.status ?? 'gone'}`,
      );
    }

    if (options.release) {
      await this.inventory.release(tx, trade.initiatorId, offeredChanges(trade));
    }

    await this.audit.record(tx, {
      actorId: options.actorId,
      action: options.action,
      entity: 'Trade',
      entityId: trade.id,
      meta: { from: 'PENDING', to: options.to, ...options.meta },
    });
  }
}
```

`trades-core.module.ts`: add `providers: [TradeCloseService]` and put `TradeCloseService` first in `exports` (import it from `./trade-close.service.js`).

- [ ] **Step 2: Extend `TradesService`**

Imports: add `ForbiddenException` to the `@nestjs/common` import; add `import { TradeCloseService } from './trade-close.service.js';`; change the `./trade-row.js` import to `import { TRADE_SELECT, toTrade, tradeLines, type TradeRow } from './trade-row.js';`.

Constructor gains `private readonly closer: TradeCloseService,` as its last parameter.

Add these methods after `propose`:

```ts
  decline(user: AuthUser, id: string): Promise<Trade> {
    return this.finish(user, id, {
      role: 'recipient',
      to: 'DECLINED',
      action: 'trade.decline',
      notify: 'trade.declined',
    });
  }

  cancel(user: AuthUser, id: string): Promise<Trade> {
    return this.finish(user, id, {
      role: 'initiator',
      to: 'CANCELLED',
      action: 'trade.cancel',
      notify: 'trade.cancelled',
    });
  }

  /** PENDING only here; an ACCEPTED trade answers TRADE_NOT_PENDING until PD-73. */
  async voidPending(admin: AuthUser, id: string, reason: string): Promise<Trade> {
    const trade = await this.prisma.trade.findUnique({ where: { id }, select: TRADE_SELECT });
    if (trade === null) {
      throw new NotFoundException('Trade not found');
    }

    await this.prisma.withTransaction((tx) =>
      this.closer.close(tx, trade, {
        to: 'VOIDED',
        action: 'trade.void',
        actorId: admin.id,
        release: true,
        meta: { reason },
      }),
    );

    await this.notify([trade.initiatorId, trade.recipientId], 'trade.voided', trade.id, admin.id);
    return this.read(id);
  }

  private async finish(
    user: AuthUser,
    id: string,
    step: {
      role: Role;
      to: 'DECLINED' | 'CANCELLED';
      action: string;
      notify: TradeNotificationType;
    },
  ): Promise<Trade> {
    const trade = await this.loadAsParty(user, id);
    assertRole(trade, user, step.role);

    await this.prisma.withTransaction((tx) =>
      this.closer.close(tx, trade, {
        to: step.to,
        action: step.action,
        actorId: user.id,
        release: true,
      }),
    );

    await this.notify([counterparty(trade, user.id)], step.notify, trade.id, user.id);
    return this.read(id);
  }

  private async loadAsParty(user: AuthUser, id: string): Promise<TradeRow> {
    const trade = await this.prisma.trade.findUnique({ where: { id }, select: TRADE_SELECT });
    if (trade === null || (trade.initiatorId !== user.id && trade.recipientId !== user.id)) {
      throw new NotFoundException('Trade not found');
    }
    return trade;
  }

  private async read(id: string): Promise<Trade> {
    return toTrade(await this.prisma.trade.findUniqueOrThrow({ where: { id }, select: TRADE_SELECT }));
  }
```

At module level, after the `Terms` type:

```ts
type Role = 'initiator' | 'recipient';

/** The trade is visible to both parties, so the wrong one gets an honest 403. */
function assertRole(trade: TradeRow, user: AuthUser, role: Role): void {
  const allowed = role === 'initiator' ? trade.initiatorId : trade.recipientId;
  if (allowed !== user.id) {
    throw new ForbiddenException(`Only the ${role} can do this`);
  }
}

function counterparty(trade: TradeRow, userId: string): string {
  return trade.initiatorId === userId ? trade.recipientId : trade.initiatorId;
}
```

- [ ] **Step 3: Routes**

In `trades.controller.ts` add `HttpCode`, `HttpStatus`, `Param` to the `@nestjs/common` import and, after `propose`:

```ts
  @HttpCode(HttpStatus.OK)
  @Post(':id/decline')
  decline(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<Trade> {
    return this.trades.decline(user, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<Trade> {
    return this.trades.cancel(user, id);
  }
```

`apps/api/src/trades/admin-trades.controller.ts`:

```ts
import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Trade } from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { VoidTradeDto } from './trades.dto.js';
import { TradesService } from './trades.service.js';

@ApiTags('admin')
@Roles(['ADMIN'])
@Controller('admin/trades')
export class AdminTradesController {
  constructor(private readonly trades: TradesService) {}

  @HttpCode(HttpStatus.OK)
  @Post(':id/void')
  voidTrade(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() body: VoidTradeDto,
  ): Promise<Trade> {
    return this.trades.voidPending(admin, id, body.reason);
  }
}
```

`trades.module.ts`: `controllers: [TradesController, AdminTradesController]`.

- [ ] **Step 4: Compile**

```bash
cd /m/projects/pokedrop && pnpm typecheck && pnpm lint && pnpm format:check
```

Expected: all pass.

- [ ] **Step 5: Probe through HTTP**

Start the API. Then:

```bash
mkuser a; mkuser b; mkuser c; mkuser adm
$PSQL -c "update users set role = 'ADMIN' where email = 'pd68-adm@example.com'"
give a base1-4 1; give a base1-2 2
A=$(uid a); B=$(uid b); C=$(uid c)
propose(){ req a POST /trades -d "{\"recipientId\":\"$1\",\"offered\":[{\"cardId\":\"$2\",\"quantity\":1}]}" | idof; }
T1=$(propose $B base1-4); T2=$(propose $C base1-2); T3=$(propose $B base1-2)
held a base1-4; held a base1-2
checks > "$S/c0.txt"
```

Expected: `1/1`, `2/2`.

1. **Wrong actors:**

```bash
req c POST /trades/$T1/decline | strip     # 404 Trade not found
req a POST /trades/$T1/decline | strip     # 403 Only the recipient can do this
req b POST /trades/$T1/cancel | strip      # 403 Only the initiator can do this
req b POST /admin/trades/$T3/void -d '{"reason":"x"}' | strip   # 403 (RolesGuard)
```

2. **Decline releases exactly what was locked:**

```bash
req b POST /trades/$T1/decline | grep -o '"status":"[A-Z]*"\|"resolvedAt":"[^"]*"\||[0-9]*$' | tr '\n' ' '; echo
held a base1-4
req b POST /trades/$T1/decline | strip
$PSQL -c "select action, \"actorId\" = '$B', meta->>'from', meta->>'to' from audit_logs where \"entityId\" = '$T1' order by \"createdAt\""
$PSQL -c "select \"userId\" = '$A', type from notifications where payload->>'tradeId' = '$T1' order by \"createdAt\""
```

Expected: `"status":"DECLINED" "resolvedAt":"…" |200`; `1/0`; the repeat → 409 `TRADE_NOT_PENDING` "This trade is already DECLINED"; audit rows `trade.propose` then `trade.decline|t|PENDING|DECLINED`; notifications `f|trade.proposed` (to B) then `t|trade.declined`.

3. **Cancel:** `req a POST /trades/$T2/cancel` → 200 `CANCELLED`; `held a base1-2` → `2/1`; a notification `trade.cancelled` to C.

4. **Admin void of a pending trade:**

```bash
req adm POST /admin/trades/$T3/void -d '{}' | strip                                   # 400 reason
req adm POST /admin/trades/$T3/void -d '{"reason":"probe fraud"}' | grep -o '"status":"[A-Z]*"\||[0-9]*$' | tr '\n' ' '; echo
held a base1-2
$PSQL -c "select action, meta->>'reason' from audit_logs where \"entityId\" = '$T3' and action = 'trade.void'"
$PSQL -c "select count(*) from notifications where payload->>'tradeId' = '$T3' and type = 'trade.voided'"
req adm POST /admin/trades/$T3/void -d '{"reason":"again"}' | strip                    # 409 already VOIDED
req adm POST /admin/trades/seed-trade-accepted/void -d '{"reason":"x"}' | strip       # 409 already ACCEPTED
$PSQL -c "select status from trades where id = 'seed-trade-accepted'"                 # ACCEPTED
```

Expected: 400; `"status":"VOIDED" |200`; `2/0`; `trade.void|probe fraud`; `2` notifications; 409; 409; `ACCEPTED`.

5. **A race resolves to one terminal state:**

```bash
T4=$(propose $B base1-4)
for i in 1 2 3 4 5; do (curl -s -o /dev/null -w '%{http_code}\n' -b "$S/jar-b.txt" -X POST "$API/trades/$T4/decline" -H "Origin: $WEB" >> "$S/race4.txt" &); (curl -s -o /dev/null -w '%{http_code}\n' -b "$S/jar-a.txt" -X POST "$API/trades/$T4/cancel" -H "Origin: $WEB" >> "$S/race4.txt" &); done; sleep 3
sort "$S/race4.txt" | uniq -c; rm "$S/race4.txt"
$PSQL -c "select status from trades where id = '$T4'"; held a base1-4
$PSQL -c "select count(*) from audit_logs where \"entityId\" = '$T4' and action in ('trade.decline', 'trade.cancel')"
```

Expected: `1 200` and `9 409`; `DECLINED` or `CANCELLED`; `1/0`; `1`.

6. **Invariants:** `checks` → `cards`/`coins` as in `$S/c0.txt`, `unreconciled 0`, `negative 0`.

Clean up and stop the API.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/trades
git commit -m "[PD-69]: decline, cancel and void pending trades behind one guarded close" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Accept — the atomic settlement (PD-70)

**Files:**
- Create: `apps/api/src/trades/trade-settlement.service.ts`
- Modify: `apps/api/src/trades/trades-core.module.ts`, `trades.service.ts`, `trades.controller.ts`

**Interfaces:**
- Consumes: `TradeCloseService.close` (Task 4); `InventoryService.applyMoves`, `InventoryMove` (Task 2); `TradeRow` (Task 3); `assertRole`, `loadAsParty`, `read`, `notify` (Tasks 3–4).
- Produces: `TradeSettlementService.settle(tx, trade: TradeRow): Promise<void>` (exported from `TradesCoreModule`); `cardMoves(trade): InventoryMove[]`; `TradesService.accept(user, id): Promise<Trade>`; route `POST /trades/:id/accept` → 200.

- [ ] **Step 1: `apps/api/src/trades/trade-settlement.service.ts`**

```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@pokedrop/shared';
import { domainError } from '../common/errors/domain-error.js';
import { InventoryService, type InventoryMove } from '../inventory/index.js';
import type { TransactionClient } from '../prisma/index.js';
import type { TradeRow } from './trade-row.js';

@Injectable()
export class TradeSettlementService {
  constructor(private readonly inventory: InventoryService) {}

  /** Inside the accept transaction, after the guarded close. Coins before cards: see moveCoins. */
  async settle(tx: TransactionClient, trade: TradeRow): Promise<void> {
    await moveCoins(tx, trade);
    await this.inventory.applyMoves(tx, cardMoves(trade));
  }
}

export function cardMoves(trade: TradeRow): InventoryMove[] {
  return trade.items.flatMap((item): InventoryMove[] =>
    item.side === 'OFFERED'
      ? [
          { userId: trade.initiatorId, cardId: item.cardId, quantity: -item.quantity, fromLock: true },
          { userId: trade.recipientId, cardId: item.cardId, quantity: item.quantity },
        ]
      : [
          { userId: trade.recipientId, cardId: item.cardId, quantity: -item.quantity },
          { userId: trade.initiatorId, cardId: item.cardId, quantity: item.quantity },
        ],
  );
}

async function moveCoins(tx: TransactionClient, trade: TradeRow): Promise<void> {
  const toInitiator = trade.currencyFromRecipient - trade.currencyFromInitiator;
  if (toInitiator === 0) {
    return;
  }
  const payer = toInitiator > 0 ? trade.recipientId : trade.initiatorId;
  const payee = payer === trade.initiatorId ? trade.recipientId : trade.initiatorId;
  const amount = Math.abs(toInitiator);

  // Both user rows, ascending id, before any inventory row: the pack open takes
  // a user row and then that user's inventory, and the other order deadlocks.
  await tx.$queryRaw`
    SELECT id FROM users WHERE id IN (${payer}, ${payee}) ORDER BY id FOR NO KEY UPDATE`;

  const debited = await tx.$executeRaw`
    UPDATE users SET currency = currency - ${amount}
    WHERE id = ${payer} AND currency >= ${amount}`;
  if (debited === 0) {
    throw domainError(
      HttpStatus.PAYMENT_REQUIRED,
      ERROR_CODES.INSUFFICIENT_FUNDS,
      payer === trade.recipientId
        ? 'You do not have the coins this trade asks for'
        : 'The other party no longer has the coins this trade offers',
    );
  }
  await tx.$executeRaw`UPDATE users SET currency = currency + ${amount} WHERE id = ${payee}`;

  await tx.currencyTransaction.createMany({
    data: [
      { userId: payer, amount: -amount, type: 'TRADE', refId: trade.id },
      { userId: payee, amount, type: 'TRADE', refId: trade.id },
    ],
  });
}
```

`trades-core.module.ts`: `providers: [TradeCloseService, TradeSettlementService]`, and add `TradeSettlementService` to `exports`.

- [ ] **Step 2: `TradesService.accept`**

Add `import { TradeSettlementService } from './trade-settlement.service.js';` and `private readonly settlement: TradeSettlementService,` as the constructor's last parameter. After `cancel`:

```ts
  async accept(user: AuthUser, id: string): Promise<Trade> {
    const trade = await this.loadAsParty(user, id);
    assertRole(trade, user, 'recipient');

    await this.prisma.withTransaction(async (tx) => {
      await this.closer.close(tx, trade, {
        to: 'ACCEPTED',
        action: 'trade.accept',
        actorId: user.id,
        release: false,
      });
      await this.settlement.settle(tx, trade);
    });

    await Promise.all([
      this.inventory.invalidateSummary(trade.initiatorId),
      this.inventory.invalidateSummary(trade.recipientId),
    ]);
    await this.notify([trade.initiatorId], 'trade.accepted', trade.id, user.id);
    return this.read(id);
  }
```

`trades.controller.ts`, after `propose`:

```ts
  @HttpCode(HttpStatus.OK)
  @Post(':id/accept')
  accept(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<Trade> {
    return this.trades.accept(user, id);
  }
```

- [ ] **Step 3: Compile**

```bash
cd /m/projects/pokedrop && pnpm typecheck && pnpm lint && pnpm format:check
```

Expected: all pass.

- [ ] **Step 4: Probe through HTTP**

Start the API. Setup:

```bash
mkuser a; mkuser b; mkuser c
give a base1-4 1; give a base1-2 2; give a base2-10 12; coins a 500
give b base1-58 2; give b base1-1 1; coins b 2000
A=$(uid a); B=$(uid b); C=$(uid c)
trade(){ req a POST /trades -d "$1" | idof; }
checks > "$S/c0.txt"; cat "$S/c0.txt"
```

**3. Cards and coins both ways** — A gives Charizard + 100 coins, asks 1 × base1-58 + 30 coins:

```bash
req a GET /inventory/summary >/dev/null; req b GET /inventory/summary >/dev/null
docker compose exec -T redis redis-cli -n 0 --scan --pattern "cache:inv:summary:*" | grep -c "$A\|$B"
T3=$(trade "{\"recipientId\":\"$B\",\"offered\":[{\"cardId\":\"base1-4\",\"quantity\":1}],\"requested\":[{\"cardId\":\"base1-58\",\"quantity\":1}],\"currencyFromInitiator\":100,\"currencyFromRecipient\":30}")
req b POST /trades/$T3/accept | grep -o '"status":"ACCEPTED"\|"resolvedAt":"[^"]*"\||[0-9]*$' | tr '\n' ' '; echo
held a base1-4; held b base1-4; held a base1-58; held b base1-58
$PSQL -c "select \"userId\" = '$A', amount from currency_transactions where \"refId\" = '$T3' order by amount"
$PSQL -c "select email, currency from users where email in ('pd68-a@example.com','pd68-b@example.com') order by email"
docker compose exec -T redis redis-cli -n 0 --scan --pattern "cache:inv:summary:*" | grep -c "$A\|$B"
$PSQL -c "select type from notifications where payload->>'tradeId' = '$T3' order by \"createdAt\""
checks
```

Expected: `2` warm keys before; `"status":"ACCEPTED" "resolvedAt":… |200`; `none` (A's emptied row deleted), `1/0`, `1/0`, `1/0`; ledger `t|-70` and `f|70`; A `430`, B `2070`; `0` keys after; `trade.proposed`, `trade.accepted`; `checks` identical to `$S/c0.txt` in `cards` and `coins`, `unreconciled 0`, `negative 0`. If the cache key pattern differs, read `apps/api/src/redis/cache.keys.ts` and adjust the pattern.

**3b. A coins-only side** (Review Focus 1) — A gives 1 × base1-2, B pays 50:

```bash
T3b=$(trade "{\"recipientId\":\"$B\",\"offered\":[{\"cardId\":\"base1-2\",\"quantity\":1}],\"currencyFromRecipient\":50}")
req b POST /trades/$T3b/accept | grep -o '|[0-9]*$'; held b base1-2
$PSQL -c "select count(*) from currency_transactions where \"refId\" = '$T3b'"
```

Expected: `|200`; `1/0`; `2`.

**3c. Receiving into a locked row** (Review Focus 3) — B locks its base1-2 in a proposal to C, then receives another copy:

```bash
req b POST /trades -d "{\"recipientId\":\"$C\",\"offered\":[{\"cardId\":\"base1-2\",\"quantity\":1}]}" | grep -o '|[0-9]*$'
held b base1-2
T3c=$(trade "{\"recipientId\":\"$B\",\"offered\":[{\"cardId\":\"base1-2\",\"quantity\":1}]}")
req b POST /trades/$T3c/accept | grep -o '|[0-9]*$'; held b base1-2; checks | grep unreconciled
```

Expected: `|201`; `1/1`; `|200`; `2/1`; `unreconciled 0`.

**4. The recipient lacks a requested card:**

```bash
T4=$(trade "{\"recipientId\":\"$B\",\"offered\":[{\"cardId\":\"base2-10\",\"quantity\":1}],\"requested\":[{\"cardId\":\"base1-60\",\"quantity\":1}]}")
s0=$(snap); req b POST /trades/$T4/accept | strip; [ "$s0" = "$(snap)" ] && echo "byte-identical"
$PSQL -c "select status from trades where id = '$T4'"; held a base2-10
```

Expected: 409 `CARDS_UNAVAILABLE` naming `base1-60`; `byte-identical`; `PENDING`; `12/1`.

**4b. A requested card the recipient has locked** (Review Focus 2) — B holds 2 × base1-2 with 1 locked (3c):

```bash
T4b=$(trade "{\"recipientId\":\"$B\",\"requested\":[{\"cardId\":\"base1-2\",\"quantity\":2}]}")
s0=$(snap); req b POST /trades/$T4b/accept | strip; [ "$s0" = "$(snap)" ] && echo "byte-identical"
```

Expected: 409 `CARDS_UNAVAILABLE`; `byte-identical`.

**5. The payer has spent the coins:**

```bash
T5=$(trade "{\"recipientId\":\"$B\",\"offered\":[{\"cardId\":\"base2-10\",\"quantity\":1}],\"currencyFromInitiator\":400}")
coins a -300
s0=$(snap); req b POST /trades/$T5/accept | strip; [ "$s0" = "$(snap)" ] && echo "byte-identical"
coins a 300
```

Expected: 402 `INSUFFICIENT_FUNDS` "The other party no longer has the coins this trade offers"; `byte-identical`.

**6. Ten simultaneous accepts and declines of one trade:**

```bash
T6=$(trade "{\"recipientId\":\"$B\",\"offered\":[{\"cardId\":\"base2-10\",\"quantity\":1}],\"currencyFromRecipient\":10}")
checks > "$S/c6.txt"
for i in 1 2 3 4 5; do (curl -s -o /dev/null -w '%{http_code}\n' -b "$S/jar-b.txt" -X POST "$API/trades/$T6/accept" -H "Origin: $WEB" >> "$S/race6.txt" &); (curl -s -o /dev/null -w '%{http_code}\n' -b "$S/jar-b.txt" -X POST "$API/trades/$T6/decline" -H "Origin: $WEB" >> "$S/race6.txt" &); done; sleep 4
sort "$S/race6.txt" | uniq -c; rm "$S/race6.txt"
$PSQL -c "select status from trades where id = '$T6'"
$PSQL -c "select count(*) from currency_transactions where \"refId\" = '$T6'"
checks
```

Expected: `1 200`, `9 409`; one terminal status; `2` ledger rows if `ACCEPTED`, `0` if `DECLINED`; `checks` equal to `$S/c6.txt` in `cards` and `coins`, `unreconciled 0`, `negative 0`.

**6b. A pack open and an accept by the same user at once** (Review Focus 4), five times:

```bash
for i in 1 2 3 4 5; do
  T=$(trade "{\"recipientId\":\"$B\",\"offered\":[{\"cardId\":\"base2-10\",\"quantity\":1}],\"currencyFromRecipient\":10}")
  OPEN=$(node -e "console.log(crypto.randomUUID())")
  (curl -s -o /dev/null -w 'accept %{http_code}\n' -b "$S/jar-b.txt" -X POST "$API/trades/$T/accept" -H "Origin: $WEB" >> "$S/race6b.txt" &)
  (curl -s -o /dev/null -w 'open %{http_code}\n' -b "$S/jar-b.txt" -X POST "$API/packs/seed-template-base/open" -H 'Content-Type: application/json' -H "Origin: $WEB" -d "{\"openId\":\"$OPEN\"}" >> "$S/race6b.txt" &)
  sleep 1
done; sleep 2
sort "$S/race6b.txt" | uniq -c; rm "$S/race6b.txt"
grep -ci "deadlock\|40P01" "$S/api68.log"; checks | grep "unreconciled\|negative"
```

Expected: `5 accept 200` and `5 open 200`; `0`; `unreconciled 0`, `negative 0`. (Coins and cards change here — the pack open mints — so compare only these two lines.)

**10. Wrong actors on accept:**

```bash
T10=$(trade "{\"recipientId\":\"$B\",\"offered\":[{\"cardId\":\"base2-10\",\"quantity\":1}]}")
req a POST /trades/$T10/accept | strip     # 403
req c POST /trades/$T10/accept | strip     # 404
```

**11. A failure inside settlement rolls everything back:**

```bash
T11=$(trade "{\"recipientId\":\"$B\",\"offered\":[{\"cardId\":\"base2-10\",\"quantity\":1}],\"currencyFromRecipient\":10}")
docker compose exec -T postgres psql -U pokedrop -d pokedrop <<'SQL'
create function pd68_fail() returns trigger language plpgsql as $$ begin raise exception 'pd68 injected'; end $$;
create trigger pd68_fail before insert on currency_transactions for each row when (new.type = 'TRADE') execute function pd68_fail();
SQL
s0=$(snap); req b POST /trades/$T11/accept | grep -o '|[0-9]*$'; [ "$s0" = "$(snap)" ] && echo "byte-identical"
docker compose exec -T postgres psql -U pokedrop -d pokedrop -c "drop trigger pd68_fail on currency_transactions; drop function pd68_fail();"
req b POST /trades/$T11/accept | grep -o '"status":"ACCEPTED"\||[0-9]*$' | tr '\n' ' '; echo
```

Expected: `|500`; `byte-identical`; then `"status":"ACCEPTED" |200` — the trigger, and only the trigger, stopped it.

Final `checks`: `unreconciled 0`, `negative 0`. Clean up and stop the API.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/trades
git commit -m "[PD-70]: settle an accepted trade in one transaction, coins then cards" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Counter-offers (PD-71)

**Files:**
- Modify: `apps/api/src/trades/trades.service.ts`, `trades.controller.ts`

**Interfaces:**
- Consumes: `CounterTrade`, `MAX_COUNTER_CHAIN`, `ERROR_CODES.COUNTER_LIMIT` (Task 1); `TradeCloseService.close` (Task 4); `offeredChanges`, `tradeLines`, `TRADE_SELECT`, `toTrade` (Task 3); `InventoryService.lock/release`; `assertRole`, `loadAsParty`, `assertTerms`, `notify`.
- Produces: `TradesService.counter(user, id, input): Promise<Trade>`; route `POST /trades/:id/counter` → 201.

- [ ] **Step 1: `TradesService.counter`**

Imports: add `type CounterTrade` and `MAX_COUNTER_CHAIN` to the `@pokedrop/shared` import; change the `./trade-row.js` import to include `offeredChanges`.

After `accept`:

```ts
  async counter(user: AuthUser, id: string, input: CounterTrade): Promise<Trade> {
    const original = await this.loadAsParty(user, id);
    assertRole(original, user, 'recipient');
    await this.assertTerms(user.id, input);

    const row = await this.prisma.withTransaction(async (tx) => {
      await this.closer.close(tx, original, {
        to: 'COUNTERED',
        action: 'trade.counter',
        actorId: user.id,
        release: false,
      });

      const [chain] = await tx.$queryRaw<{ length: number }[]>`
        WITH RECURSIVE chain AS (
          SELECT id, "counteredTradeId" FROM trades WHERE id = ${original.id}
          UNION ALL
          SELECT t.id, t."counteredTradeId" FROM trades t JOIN chain c ON t.id = c."counteredTradeId"
        )
        SELECT COUNT(*)::int AS length FROM chain`;
      if ((chain?.length ?? 0) >= MAX_COUNTER_CHAIN) {
        throw domainError(
          HttpStatus.CONFLICT,
          ERROR_CODES.COUNTER_LIMIT,
          `A negotiation stops at ${MAX_COUNTER_CHAIN} trades`,
        );
      }

      const created = await tx.trade.create({
        data: {
          initiatorId: user.id,
          recipientId: original.initiatorId,
          currencyFromInitiator: input.currencyFromInitiator,
          currencyFromRecipient: input.currencyFromRecipient,
          counteredTradeId: original.id,
          items: { createMany: { data: tradeLines(input) } },
        },
        select: TRADE_SELECT,
      });

      // Two users' rows in one transaction go in ascending userId, like every
      // other writer, not release-then-lock - the other order can deadlock.
      const release = () =>
        this.inventory.release(tx, original.initiatorId, offeredChanges(original));
      const lock = () => this.inventory.lock(tx, user.id, input.offered);
      if (original.initiatorId < user.id) {
        await release();
        await lock();
      } else {
        await lock();
        await release();
      }

      await this.audit.record(tx, {
        actorId: user.id,
        action: 'trade.propose',
        entity: 'Trade',
        entityId: created.id,
        meta: { from: null, to: 'PENDING', counteredTradeId: original.id },
      });
      return created;
    });

    await this.notify([original.initiatorId], 'trade.countered', row.id, user.id);
    return toTrade(row);
  }
```

`trades.controller.ts`: import `CounterTradeDto` from `./trades.dto.js`, and after `accept`:

```ts
  @Throttle(MODERATE_THROTTLE)
  @Post(':id/counter')
  counter(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: CounterTradeDto,
  ): Promise<Trade> {
    return this.trades.counter(user, id, body);
  }
```

- [ ] **Step 2: Compile**

```bash
cd /m/projects/pokedrop && pnpm typecheck && pnpm lint && pnpm format:check
```

Expected: all pass.

- [ ] **Step 3: Probe through HTTP**

Start the API. Setup:

```bash
mkuser a; mkuser b; mkuser c
give a base1-4 1; give b base1-58 2; coins a 100
A=$(uid a); B=$(uid b); C=$(uid c)
T1=$(req a POST /trades -d "{\"recipientId\":\"$B\",\"offered\":[{\"cardId\":\"base1-4\",\"quantity\":1}],\"requested\":[{\"cardId\":\"base1-58\",\"quantity\":1}]}" | idof)
checks > "$S/c0.txt"
```

1. **A counter moves the lock in one commit:**

```bash
T2=$(req b POST /trades/$T1/counter -d '{"offered":[{"cardId":"base1-58","quantity":1}],"requested":[{"cardId":"base1-4","quantity":1}],"currencyFromRecipient":20}' | tee "$S/t2.json" | idof)
grep -o "\"initiatorId\":\"[^\"]*\"\|\"counteredTradeId\":\"$T1\"\||[0-9]*$" "$S/t2.json" | tr '\n' ' '; echo
$PSQL -c "select status, \"resolvedAt\" is not null from trades where id = '$T1'"
held a base1-4; held b base1-58
$PSQL -c "select action, meta->>'counteredTradeId' from audit_logs where \"entityId\" in ('$T1', '$T2') order by \"createdAt\""
$PSQL -c "select \"userId\" = '$A', type from notifications where payload->>'tradeId' = '$T2'"
checks | grep unreconciled
```

Expected: the counter's `initiatorId` is B's id, `"counteredTradeId":"<T1>"`, `|201`; `COUNTERED|t`; `1/0`; `2/1`; audit `trade.propose|` (T1), `trade.counter|` (T1), `trade.propose|<T1>` (T2); `t|trade.countered`; `unreconciled 0`.

2. **Countering a closed or foreign trade:**

```bash
req b POST /trades/$T1/counter -d '{"offered":[{"cardId":"base1-58","quantity":1}]}' | strip   # 409 TRADE_NOT_PENDING (already COUNTERED)
req a POST /trades/$T2/counter -d '{"offered":[{"cardId":"base1-4","quantity":1}],"recipientId":"x"}' | strip   # 400 unknown key
req c POST /trades/$T2/counter -d '{"offered":[{"cardId":"base1-4","quantity":1}]}' | strip   # 404
req b POST /trades/$T2/counter -d '{"offered":[{"cardId":"base1-58","quantity":1}]}' | strip   # 403 B is T2's initiator
```

3. **The chain stops at ten trades** — A and B counter each other until T10, then the 11th:

```bash
LAST=$T2; WHO=a
for n in 3 4 5 6 7 8 9 10; do
  if [ $WHO = a ]; then BODY='{"offered":[{"cardId":"base1-4","quantity":1}]}'; NEXT=b; else BODY='{"offered":[{"cardId":"base1-58","quantity":1}]}'; NEXT=a; fi
  LAST=$(req $WHO POST /trades/$LAST/counter -d "$BODY" | idof); WHO=$NEXT
done
echo "T10=$LAST"; $PSQL -c "select count(*) from trades where status = 'COUNTERED' and (\"initiatorId\" in ('$A','$B'))"
s0=$(snap)
if [ $WHO = a ]; then BODY='{"offered":[{"cardId":"base1-4","quantity":1}]}'; else BODY='{"offered":[{"cardId":"base1-58","quantity":1}]}'; fi
req $WHO POST /trades/$LAST/counter -d "$BODY" | strip
[ "$s0" = "$(snap)" ] && echo "byte-identical"
$PSQL -c "select status from trades where id = '$LAST'"; checks | grep unreconciled
```

Expected: `9` countered trades (T1…T9); the 11th → 409 `COUNTER_LIMIT` "A negotiation stops at 10 trades"; `byte-identical`; T10 `PENDING`; `unreconciled 0`.

4. **A counter racing an accept on the same trade** (spec scenario 7): T10's recipient either accepts or counters, both at once:

```bash
R=$( [ $WHO = a ] && echo a || echo b )
(curl -s -o /dev/null -w 'accept %{http_code}\n' -b "$S/jar-$R.txt" -X POST "$API/trades/$LAST/accept" -H "Origin: $WEB" >> "$S/race7.txt" &)
(curl -s -o /dev/null -w 'counter %{http_code}\n' -b "$S/jar-$R.txt" -X POST "$API/trades/$LAST/counter" -H 'Content-Type: application/json' -H "Origin: $WEB" -d "$BODY" >> "$S/race7.txt" &)
sleep 3; sort "$S/race7.txt"; rm "$S/race7.txt"
$PSQL -c "select status from trades where id = '$LAST'"; checks
```

Expected: `accept 200` and `counter 409` — the counter loses either to the guarded update (`TRADE_NOT_PENDING`, if the accept went first) or to the chain limit (`COUNTER_LIMIT`, if it went first and rolled back); never both succeeding. T10 `ACCEPTED`; `cards`/`coins` equal to `$S/c0.txt`, `unreconciled 0`, `negative 0`. Record which code the counter got.

5. **A counter offering cards the counter-initiator lacks** (Review Focus 5):

```bash
T5=$(req a POST /trades -d "{\"recipientId\":\"$C\",\"currencyFromInitiator\":10}" | idof)
s0=$(snap)
req c POST /trades/$T5/counter -d '{"offered":[{"cardId":"base1-4","quantity":1}]}' | strip
[ "$s0" = "$(snap)" ] && echo "byte-identical"; $PSQL -c "select status from trades where id = '$T5'"
```

Expected: 409 `CARDS_UNAVAILABLE`; `byte-identical`; `PENDING`.

Clean up and stop the API.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/trades
git commit -m "[PD-71]: counter a trade, moving its locks in the same transaction" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Documentation

**Files:**
- Modify: `docs/API.md` (the domain error-code table; `## Trades`), `docs/DataModel.md` (`### Trade`)

**Interfaces:**
- Consumes: the probe output of Tasks 1–6 — every number here must be one a probe printed.
- Produces: documentation only.

- [ ] **Step 1: Error codes** — in the `| \`code\` | Status | Meaning |` table under "Domain errors add a `code`" in `docs/API.md`, add:

```markdown
| `CARDS_UNAVAILABLE` | 409 | Not enough available copies — locked copies do not count. At a trade proposal or counter, or at settlement, where the message names the user and the card |
| `TRADE_NOT_PENDING` | 409 | The trade already left `PENDING`; the message names its status |
| `COUNTER_LIMIT` | 409 | A negotiation already holds 10 trades |
```

and extend the `INSUFFICIENT_FUNDS` row's meaning with "; also a trade whose payer cannot cover the coins, at proposal or settlement".

- [ ] **Step 2: `## Trades` in `docs/API.md`** — replace the table's rows for the routes this plan built with:

```markdown
| POST | `/trades` | member | Propose; locks the offered copies — throttled like pack opening |
| POST | `/trades/:id/accept` | member (recipient) | Atomic settlement |
| POST | `/trades/:id/decline` | member (recipient) | Releases the initiator's locks |
| POST | `/trades/:id/counter` | member (recipient) | A new `PENDING` trade; the original `COUNTERED`; locks move in one transaction — throttled |
| POST | `/trades/:id/cancel` | member (initiator) | Releases the locks |
| POST | `/admin/trades/:id/void` | admin | `{ reason }`; voids a `PENDING` trade — an `ACCEPTED` one is PD-73 |
```

Keep the `GET` rows as they are (PD-72). Below the table add the request shape (`ProposeTradeSchema` fields and bounds from the spec's *Routes*), then these paragraphs, then the measured list:

```markdown
**A trade locks exactly what its initiator offered.** Proposing raises `lockedQuantity` on those copies in the same transaction that creates the trade; every way out of `PENDING` lowers it in the transaction that changes the status; accepting consumes it with the copies it guarded. The recipient's cards are not reserved and not checked at proposal — an inventory is private, and a refusal would disclose it — so settlement checks them. The invariant and its reconciliation query are in [DataModel.md](DataModel.md) (Trade).

**Every transition is one guarded update.** `UPDATE … WHERE status = 'PENDING'` takes the trade's row lock, so simultaneous accepts, declines, cancels, counters and voids of one trade resolve to exactly one; the others answer 409 `TRADE_NOT_PENDING`.

**Settlement is one transaction:** the guarded update, then coins — both user rows locked in id order, the payer debited only if they still have it (402 otherwise), one `TRADE` ledger row per user — then cards, every row in `(userId, cardId)` order, rows it empties deleted. Any failure leaves the trade `PENDING` and every balance and row as it was. Both users' inventory summaries are invalidated after commit.

**Counters** close the original as `COUNTERED` and create the new trade with the roles swapped in one transaction: the original initiator's locks are released and the counter's taken, ordered by user id. A negotiation stops at 10 trades.

**Wrong party, wrong role.** A trade you are not a party to is 404 `Trade not found`, like one that does not exist. A party using the other party's route gets 403.

**Notifications** are written after the transaction commits — one per recipient per transition — and a failure to write one is logged without affecting the trade.
```

Then `**Measured, 2026-09-28**, through HTTP with the database checked after every scenario:` and one bullet per probe scenario of Tasks 3–6, in the style of the PD-58 list above it, stating input and result, using only what the probes printed. Expected results, to verify against the actual output and correct where they differ:

- a proposal: 201, one lock, one `trade.propose` audit row, one notification to the recipient; the same copy offered again → 409 `CARDS_UNAVAILABLE`; a proposal whose second card was not held → 409 and no lock on the first
- self, unknown user, unknown card, empty trade, coins beyond the balance, signed out → 400, 404, 400, 400, 402, 401, nothing written
- a trigger failing every notification insert: the proposal still 201 and committed, the failure logged
- 31 proposals in a minute: 30 answered, the 31st 429
- decline, cancel and an admin void each released exactly the proposal's lock, wrote one audit row with `from`/`to` (the void with its reason) and notified the counterparty (both for a void); a repeat → 409; voiding the seed's `ACCEPTED` trade → 409 and nothing changed
- five declines and five cancels of one trade at once: one 200, nine 409, one terminal status, one audit row
- an accept with cards and coins both ways: the initiator's emptied row deleted, `-70`/`+70` ledger rows, both summary cache keys gone; a coins-only side; a receive into a row with a lock kept the lock
- the recipient lacking a requested card, or holding it only locked: 409, database byte-identical; the payer short of coins: 402, byte-identical
- five accepts and five declines at once: one 200, nine 409; cards and coins conserved
- a pack open and an accept by the same user at once, five times: ten 200s, no deadlock in the log
- a trigger failing the ledger insert: 500 and the database byte-identical; the same accept after dropping it: 200
- a counter: roles swapped, original `COUNTERED`, the initiator's lock gone and the counter's taken; a chain of 10 refused an 11th with 409 `COUNTER_LIMIT`, byte-identical; a counter offering cards not held → 409, the original still `PENDING`
- after every scenario: cards per card and total coins unchanged, every balance equal to its ledger, the lock reconciliation empty, nothing negative

- [ ] **Step 3: `### Trade` in `docs/DataModel.md`** — after the paragraph starting "> **A PENDING trade holds escrow**", add:

````markdown
**The lock invariant.** For every `(userId, cardId)`, `lockedQuantity` equals the sum of `OFFERED` quantities over `PENDING` trades that user initiated — the recipient's cards are never locked. Proposing adds, every way out of `PENDING` subtracts in the same transaction, and accepting consumes the lock with the copies. Zero rows from this query means no lock has leaked:

```sql
WITH promised AS (
  SELECT t."initiatorId" AS u, ti."cardId" AS c, SUM(ti.quantity) AS q
  FROM trades t JOIN trade_items ti ON ti."tradeId" = t.id
  WHERE t.status = 'PENDING' AND ti.side = 'OFFERED'
  GROUP BY 1, 2
)
SELECT i."userId", i."cardId", i."lockedQuantity", COALESCE(p.q, 0) AS promised
FROM inventory_items i
FULL JOIN promised p ON p.u = i."userId" AND p.c = i."cardId"
WHERE COALESCE(i."lockedQuantity", 0) <> COALESCE(p.q, 0);
```

**Lock order.** A transaction that touches trades takes the trade row, then `users` rows by ascending id (only when coins move), then `inventory_items` rows by ascending `(userId, cardId)` — the pack open's order, so neither can deadlock the other.

**The timeline is the audit log.** Every transition writes one `AuditLog` row (`entity 'Trade'`, `meta.from`/`meta.to`); a trade's first is always `trade.propose`, and a counter's carries `meta.counteredTradeId`.
````

- [ ] **Step 4: Check and commit**

```bash
cd /m/projects/pokedrop && pnpm format:check
git add docs/API.md docs/DataModel.md
git commit -m "[PD-70]: document the trade core, its invariant and probes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: formatting passes; the subject is ≤ 72 characters.
