# PD-123 Trade Moderation and Audit Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins `/admin/trades` (every trade, filtered), `/admin/trades/[id]` (the trade, and a void that is checked before it is offered) and `/admin/audit` (every audit row, filtered, each linking its object), on three new read-only admin endpoints.

**Architecture:** The API gains `GET /admin/trades` (beside the inbox in `TradeReadsService`), `GET /admin/trades/:id/void-check` (the void's own transactional part, run and rolled back) and `GET /admin/audit` (a new `admin-audit` module with a `(createdAt, id)` index). The web app gets one admin user picker reused by both filter bars, three pages under `components/admin/{trades,audit}/`, and `?q=` / `?template=` deep links into the existing users and packs pages.

**Tech Stack:** NestJS + Prisma 6 (API), Zod 4 (shared), Next 16.3, React 19.2, TanStack Query 5.

**Spec:** `docs/superpowers/specs/2026-10-07-pd-123-trade-moderation-audit-design.md`

## Global Constraints

- No automated tests in v1. Each task's gate: shared `pnpm --filter @pokedrop/shared build`; api `pnpm --filter @pokedrop/api exec tsc --noEmit -p tsconfig.json` and `pnpm exec eslint <touched api folders> --max-warnings=0`; web `pnpm --filter @pokedrop/web typecheck` and `pnpm exec eslint <touched web folders> --max-warnings=0`; `pnpm exec prettier --check` on touched files. Behaviour is measured with `curl`/`psql` (Tasks 2–4) and in a browser over CDP (Task 9).
- Every new route is `@Roles(['ADMIN'])`: a member 403, signed out 401. Nothing writes or deletes `audit_logs` outside `AuditService.record`.
- Pages: `pageSize` 1–100; trades default 24, audit default 50. Dates `YYYY-MM-DD`, UTC, on `createdAt`, `to` inclusive; `from` after `to` is 400.
- The void check answers `{ voidable: true }` or `{ voidable: false, code, reason }`, `code`/`reason` exactly what `POST /admin/trades/:id/void` answers; it writes nothing that survives (no audit row, no notification, no cache invalidation).
- `VoidTradeSchema` (`reason` trimmed 1–500) is the void dialog's rule.
- Audit entities: `Trade`, `User`, `PackTemplate`, `SyncJob`, `Provider`. Action groups: `trade`, `user`, `pack_template`, `sync`.
- No hex colors or arbitrary spacing lengths in `apps/web` class strings; arbitrary font sizes (`text-[11.5px]`) are allowed.
- Commits on `dev`, header `[PD-123]: …` (≤ 72 characters), body ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Code, commits and docs in English; comments only where they carry a reason.
- The test admin is `pd103-…@pokedrop.test` (password in the session scratchpad `pd103-user.txt`, cookies in `jar-admin.json`); the member jar is `jar.txt` (PD102 Tester).

## Review Focus

1. **A trade whose state changes between the check and the confirm** (another admin voids it, the receiver trades the card on): the void answers 409 and the dialog shows it and re-reads the trade — never a toast of success. Pinned in Task 7 (the confirm's `onError`) and measured in Task 9, B3.
2. **The void check leaving anything behind** — an audit row, a notification, a released lock: the dry run must be byte-identical afterwards. Pinned in Task 3 (the rollback sentinel after `voidIn`, notifications only in `voidTrade`) and measured in Task 3, step 5.
3. **Cursor pages under a filter** (`user`, `actor`, a date range): every row once, newest first, no row from outside the filter on page 2. Pinned in Tasks 2 and 4 (the scope is its own `AND` element, as the inbox does) and measured there.
4. **A filter value that matches nothing or is malformed in the URL** (`?status=nope`, `?from=2026-13-40`): the page falls back to the default for that one filter instead of erroring. Pinned in Tasks 6 and 8 (`useUrlState` schemas with `.catch`) and measured in Task 9, B1/B5.
5. **Audit rows whose subject no longer exists or has no email** (a deleted template — there is no delete, but a user with an empty name): the row still renders, its link falls back to the id. Pinned in Task 4 (`subject` nullable) and Task 8 (`entityHref`).

---

## File structure

| File | Responsibility |
| --- | --- |
| `packages/shared/src/entities/admin-moderation.ts` | `AdminTradeQuerySchema`, `VoidCheckSchema`, `AuditQuerySchema`, `AuditEntrySchema`, `AuditPageSchema`, `AUDIT_ENTITIES`, `AUDIT_ACTION_GROUPS` |
| `apps/api/src/trades/{trade-reads.service,admin-trades.controller,trades.dto,trades.service}.ts` | `GET /admin/trades`, `GET /admin/trades/:id/void-check`, `voidIn` |
| `apps/api/prisma/schema.prisma` + a migration | `audit_logs (createdAt, id)` |
| `apps/api/src/admin-audit/*` | `GET /admin/audit` |
| `apps/web/lib/api/endpoints/admin.ts`, `apps/web/lib/query/{admin,keys,invalidation}.ts` | endpoints and hooks |
| `apps/web/components/trades/trade-summary.ts` | `namedSides` |
| `apps/web/components/admin/user-filter.tsx` | the admin user picker for filter bars |
| `apps/web/components/admin/trades/{admin-trades,admin-trade-detail,void-dialog}.tsx` | the trades pages |
| `apps/web/components/admin/audit/{admin-audit,audit-words}.tsx` | the audit page and its wording |
| `apps/web/app/(app)/admin/{trades,trades/[id],audit}/page.tsx` | routes |
| `apps/web/components/admin/users/admin-users.tsx`, `apps/web/components/admin/packs/admin-packs.tsx` | `?q=` and `?template=` |

---

### Task 1: Shared schemas

**Files:**
- Create: `packages/shared/src/entities/admin-moderation.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `AdminTradeQuerySchema` → `{ status?: TradeStatus; user?: string; from?: string; to?: string; cursor?: string; pageSize: number }`; `VoidCheckSchema` → `{ voidable: true } | { voidable: false; code: string; reason: string }`; `AUDIT_ENTITIES`; `AUDIT_ACTION_GROUPS`; `AuditQuerySchema` → `{ actor?: string; action?: string; entity?: AuditEntity; entityId?: string; from?; to?; cursor?; pageSize }`; `AuditEntrySchema`; `AuditPageSchema = cursorPageOf(AuditEntrySchema)`; types `AdminTradeQuery`, `VoidCheck`, `AuditEntity`, `AuditQuery`, `AuditEntry`, `AuditPage`.

- [ ] **Step 1: Write the module**

```ts
import { z } from 'zod';
import { TradeStatusSchema } from '../enums.js';
import { cursorPageOf, PaginationQuerySchema } from '../primitives/pagination.js';

const DaySchema = z.iso.date();

// `to` is inclusive; a range that ends before it starts names nothing.
const range = <T extends { from?: string; to?: string }>(query: T) =>
  query.from === undefined || query.to === undefined || query.from <= query.to;
const RANGE_MESSAGE = { message: '`from` must not be after `to`', path: ['from'] };

export const AdminTradeQuerySchema = z
  .object({
    status: TradeStatusSchema.optional(),
    user: z.string().min(1).max(64).optional(),
    from: DaySchema.optional(),
    to: DaySchema.optional(),
    cursor: z.string().min(1).max(512).optional(),
    pageSize: PaginationQuerySchema.shape.pageSize,
  })
  .refine(range, RANGE_MESSAGE);
export type AdminTradeQuery = z.infer<typeof AdminTradeQuerySchema>;

/** What `POST /admin/trades/:id/void` would answer, found by running it and rolling it back. */
export const VoidCheckSchema = z.discriminatedUnion('voidable', [
  z.object({ voidable: z.literal(true) }),
  z.object({ voidable: z.literal(false), code: z.string(), reason: z.string() }),
]);
export type VoidCheck = z.infer<typeof VoidCheckSchema>;

export const AUDIT_ENTITIES = ['Trade', 'User', 'PackTemplate', 'SyncJob', 'Provider'] as const;
export const AuditEntitySchema = z.enum(AUDIT_ENTITIES);
export type AuditEntity = z.infer<typeof AuditEntitySchema>;

/** `trade` matches every `trade.*` action; anything with a dot is one exact action. */
export const AUDIT_ACTION_GROUPS = ['trade', 'user', 'pack_template', 'sync'] as const;

export const AuditQuerySchema = z
  .object({
    actor: z.string().min(1).max(64).optional(),
    action: z
      .string()
      .regex(/^[a-z_]+(\.[a-z_]+)?$/)
      .optional(),
    entity: AuditEntitySchema.optional(),
    entityId: z.string().min(1).max(128).optional(),
    from: DaySchema.optional(),
    to: DaySchema.optional(),
    cursor: z.string().min(1).max(512).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine(range, RANGE_MESSAGE)
  .refine((query) => query.entityId === undefined || query.entity !== undefined, {
    message: '`entityId` needs `entity`',
    path: ['entityId'],
  });
export type AuditQuery = z.infer<typeof AuditQuerySchema>;

export const AuditEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string(),
  /** null: the system acted (the expiry job). */
  actor: z.object({ id: z.string(), displayName: z.string(), email: z.string() }).nullable(),
  /** Who or what the row is about, for its link: a user's name and email, a template's name. */
  subject: z.object({ label: z.string(), email: z.string().nullable() }).nullable(),
  meta: z.record(z.string(), z.unknown()),
  createdAt: z.coerce.date(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditPageSchema = cursorPageOf(AuditEntrySchema);
export type AuditPage = z.infer<typeof AuditPageSchema>;
```

Check `PaginationQuerySchema.shape.pageSize` is the coerced 1–100 default 24 the inbox uses (`packages/shared/src/primitives/pagination.ts`); the audit's own default is 50.

- [ ] **Step 2: Export it**

Append to `packages/shared/src/index.ts`, after `export * from './entities/metrics.js';`:

```ts
export * from './entities/admin-moderation.js';
```

- [ ] **Step 3: Build**

Run: `pnpm --filter @pokedrop/shared build`
Expected: exits 0; `grep -l AuditPageSchema packages/shared/dist/entities/admin-moderation.js` prints the file.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src
git commit -m "[PD-123]: share the admin trade, void check and audit schemas" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `GET /admin/trades`

**Files:**
- Modify: `apps/api/src/trades/trades.dto.ts`, `apps/api/src/trades/trade-reads.service.ts`, `apps/api/src/trades/admin-trades.controller.ts`

**Interfaces:**
- Consumes: `AdminTradeQuerySchema`, `TradePageSchema` (Task 1, shared).
- Produces: `TradeReadsService.adminList(query: AdminTradeQuery): Promise<TradePage>`; `GET /admin/trades` → `TradePage` with `role: null` on every row.

- [ ] **Step 1: Measure the route missing**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -b <scratchpad>/jar-admin.txt http://localhost:4000/api/v1/admin/trades`
Expected: `404` (the route does not exist yet; `/admin/trades/:id` takes the empty id as unknown). If the admin jar is the CDP JSON, write a curl jar first: `node -e` converting `jar-admin.json` to Netscape format into `jar-admin.txt`.

- [ ] **Step 2: The DTO**

In `trades.dto.ts` import `AdminTradeQuerySchema` and add:

```ts
export class AdminTradeQueryDto extends createZodDto('AdminTradeQuery', AdminTradeQuerySchema) {}
```

- [ ] **Step 3: The read**

In `trade-reads.service.ts` add `type AdminTradeQuery` to the shared import and, after `inbox`:

```ts
  /** Every trade, newest first; `role` is null on every row because the reader is no party. */
  async adminList(query: AdminTradeQuery): Promise<TradePage> {
    const cursor = query.cursor === undefined ? null : decodeNewestCursor(query.cursor);
    const scope = adminScope(query);
    const where: Prisma.TradeWhereInput =
      cursor === null
        ? scope
        : {
            AND: [
              scope,
              {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              },
            ],
          };

    const [rows, total] = await Promise.all([
      this.prisma.trade.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.pageSize + 1,
        select: VIEW_SELECT,
      }),
      this.prisma.trade.count({ where: scope }),
    ]);

    const page = rows.slice(0, query.pageSize);
    const last = page.at(-1);
    return TradePageSchema.parse({
      items: page.map((row) => toView(row, null, this.config.trades.expiryDays)),
      pageSize: query.pageSize,
      total,
      nextCursor:
        rows.length > query.pageSize && last !== undefined
          ? encodeNewestCursor(last.createdAt, last.id)
          : null,
    });
  }
```

and, beside `tabScope`:

```ts
const DAY = 24 * 60 * 60 * 1000;

/** The filters as one AND element; a user on either side keeps each side its own index. */
function adminScope(query: AdminTradeQuery): Prisma.TradeWhereInput {
  const and: Prisma.TradeWhereInput[] = [];
  if (query.status !== undefined) and.push({ status: query.status });
  if (query.user !== undefined) {
    and.push({ OR: [{ initiatorId: query.user }, { recipientId: query.user }] });
  }
  if (query.from !== undefined || query.to !== undefined) {
    and.push({
      createdAt: {
        ...(query.from !== undefined ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
        ...(query.to !== undefined
          ? { lt: new Date(new Date(`${query.to}T00:00:00Z`).getTime() + DAY) }
          : {}),
      },
    });
  }
  return and.length === 0 ? {} : { AND: and };
}
```

- [ ] **Step 4: The route**

In `admin-trades.controller.ts`: import `Query` from `@nestjs/common`, `TradePageSchema` and `type TradePage` from shared, `AdminTradeQueryDto` from `./trades.dto.js`, and add **before** `@Get(':id')`:

```ts
  @Doc('Every trade, newest first, filtered', returns('TradePage', TradePageSchema))
  @Get()
  list(@Query() query: AdminTradeQueryDto): Promise<TradePage> {
    return this.reads.adminList(query);
  }
```

- [ ] **Step 5: Gate and measure**

Run the api gate on `apps/api/src/trades`. Then, with the admin jar and the member jar:
- `GET /admin/trades?pageSize=2` → 200, `total` equals `select count(*) from trades`, `role` null on both rows;
- walk `nextCursor` at `pageSize=7` to the end: every id once (`sort | uniq -d` empty), the count equals `total`;
- `status=ACCEPTED` → every row `ACCEPTED`, `total` equals the SQL count; `user=<PD102 id>` → every row has them on a side, `total` equals `select count(*) from trades where "initiatorId"=… or "recipientId"=…`; `user=…&pageSize=3` walked: every row once, none without them;
- `from=2026-10-06&to=2026-10-06` → every `createdAt` on that UTC day;
- `status=nope`, `from=2026-13-01`, `from=2026-10-07&to=2026-10-01` → 400 each; the member jar → 403; no cookie → 401.
Expected: as listed.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/trades
git commit -m "[PD-123]: list every trade for admins, filtered and keyset-paged" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `GET /admin/trades/:id/void-check`

**Files:**
- Modify: `apps/api/src/trades/trades.service.ts`, `apps/api/src/trades/admin-trades.controller.ts`

**Interfaces:**
- Consumes: `VoidCheckSchema`, `type VoidCheck` (Task 1).
- Produces: `TradesService.voidCheck(admin: AuthUser, id: string): Promise<VoidCheck>`; `GET /admin/trades/:id/void-check` → `VoidCheck`, 404 for an unknown id.

- [ ] **Step 1: Measure the route missing**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -b jar-admin.txt http://localhost:4000/api/v1/admin/trades/<any id>/void-check`
Expected: `404` (Cannot GET).

- [ ] **Step 2: Split the void**

In `trades.service.ts`, replace the body of `voidTrade` so the transactional part is a method both callers run, and add `voidCheck`. Import `HttpException` from `@nestjs/common` and `type VoidCheck` from shared.

```ts
/** Thrown at the end of a void check so its transaction rolls back whatever it did. */
class DryRun extends Error {}

  async voidTrade(admin: AuthUser, id: string, reason: string): Promise<Trade> {
    const trade = await this.loadAny(id);
    await this.prisma.withTransaction((tx) => this.voidIn(tx, admin, trade, reason));
    if (trade.status === 'ACCEPTED') {
      await Promise.all([
        this.inventory.invalidateSummary(trade.initiatorId),
        this.inventory.invalidateSummary(trade.recipientId),
      ]);
    }
    await this.notify([trade.initiatorId, trade.recipientId], 'trade.voided', trade.id);
    return this.read(id);
  }

  /**
   * The void itself, inside a transaction that always rolls back: a refusal is exactly the one
   * the void would give. Notifications and cache invalidation live in `voidTrade`, after its
   * commit, so a check never reaches them.
   */
  async voidCheck(admin: AuthUser, id: string): Promise<VoidCheck> {
    const trade = await this.loadAny(id);
    try {
      await this.prisma.withTransaction(async (tx) => {
        await this.voidIn(tx, admin, trade, 'void check');
        throw new DryRun();
      });
    } catch (error) {
      if (error instanceof DryRun) return { voidable: true };
      const code = error instanceof HttpException ? codeOf(error.getResponse()) : undefined;
      if (error instanceof HttpException && code !== undefined) {
        return { voidable: false, code, reason: error.message };
      }
      throw error;
    }
    throw new Error('unreachable: a void check always rolls back');
  }

  private async voidIn(tx: TransactionClient, admin: AuthUser, trade: TradeRow, reason: string) {
    if (trade.status === 'ACCEPTED') {
      await this.closer.close(tx, trade, {
        from: 'ACCEPTED',
        to: 'VOIDED',
        action: 'trade.void',
        actorId: admin.id,
        release: false,
        meta: { reason },
      });
      await this.settlement.reverse(tx, trade);
    } else {
      await this.closer.close(tx, trade, {
        to: 'VOIDED',
        action: 'trade.void',
        actorId: admin.id,
        release: true,
        meta: { reason },
      });
    }
  }

  private async loadAny(id: string): Promise<TradeRow> {
    const trade = await this.prisma.trade.findUnique({ where: { id }, select: TRADE_SELECT });
    if (trade === null) {
      throw new NotFoundException('Trade not found');
    }
    return trade;
  }
```

with, at the bottom of the file:

```ts
function codeOf(body: unknown): string | undefined {
  return typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string'
    ? body.code
    : undefined;
}
```

and `import type { TransactionClient } from '../prisma/index.js';` (check the export name in `apps/api/src/prisma/index.ts`). Keep the existing `voidTrade` doc comment above it.

- [ ] **Step 3: The route**

In `admin-trades.controller.ts`, import `VoidCheckSchema`, `type VoidCheck`, and add after `detail`:

```ts
  @Doc(
    'Whether a void would succeed: the void run and rolled back, nothing kept',
    returns('VoidCheck', VoidCheckSchema),
  )
  @Get(':id/void-check')
  voidCheck(@CurrentUser() admin: AuthUser, @Param('id') id: string): Promise<VoidCheck> {
    return this.trades.voidCheck(admin, id);
  }
```

- [ ] **Step 4: Gate**

Run the api gate on `apps/api/src/trades`.
Expected: no output from eslint, tsc exits 0.

- [ ] **Step 5: Measure, byte-identical**

Before and after each check, snapshot with psql: `select md5(string_agg(t::text, '|' order by t.id)) from trades t`, the same over `inventory_items`, `users` (id, currency), `currency_transactions`, `audit_logs`, `notifications`.
- a fresh pending trade (PD102 → n64, one coin): `{ voidable: true }`, all six hashes equal;
- a settled trade with cards whose receiver still holds them: `{ voidable: true }`, hashes equal;
- a settled trade whose receiver has since given the card away (settle one, then trade the card on): `{ voidable: false, code: "TRADE_NOT_REVERSIBLE", reason }`; then `POST …/void` with a reason → 409 with the same `code` and `message`; hashes equal after the check;
- a declined trade: `{ voidable: false, code: "TRADE_NOT_PENDING", reason: "This trade is already DECLINED" }` (the message `TradeCloseService` gives — compare with `POST …/void`);
- an unknown id → 404; the member jar → 403; no cookie → 401.
Expected: as listed. Then void the fresh pending trade for real and see one `trade.void` row and two `trade.voided` notifications — the real path still notifies.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/trades
git commit -m "[PD-123]: check a void by running it and rolling it back" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `GET /admin/audit` and its index

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `AuditLog`)
- Create: `apps/api/prisma/migrations/<timestamp>_audit_created_index/migration.sql` (by `prisma migrate dev`)
- Create: `apps/api/src/admin-audit/{admin-audit.module,admin-audit.controller,admin-audit.service,admin-audit.dto}.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `AuditQuerySchema`, `AuditPageSchema` (Task 1).
- Produces: `GET /admin/audit` → `AuditPage`.

- [ ] **Step 1: Measure the route missing and the plan before the index**

Run: `curl … /api/v1/admin/audit` → 404. In psql, inside `BEGIN … ROLLBACK`, insert 20 000 audit rows (`insert into audit_logs (id, "actorId", action, entity, "entityId", meta, "createdAt") select 'x'||g, null, 'trade.propose', 'Trade', 't'||g, '{}', now() - g * interval '1 minute' from generate_series(1,20000) g;`), `ANALYZE audit_logs`, then `EXPLAIN ANALYZE select * from audit_logs order by "createdAt" desc, id desc limit 51;`
Expected: a `Sort` over a sequential scan (no index on `createdAt` alone).

- [ ] **Step 2: The index**

In `model AuditLog`, add after `@@index([actorId, createdAt])`:

```prisma
  @@index([createdAt, id])
```

Run: `cd apps/api && pnpm prisma migrate dev --name audit_created_index`
Expected: a new migration with `CREATE INDEX "audit_logs_createdAt_id_idx" ON "audit_logs"("createdAt", "id");`; the API dev server picks up the regenerated client (restart the `api` preview if it does not).

- [ ] **Step 3: DTO, service, controller, module**

`admin-audit.dto.ts`:

```ts
import { AuditQuerySchema } from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

export class AuditQueryDto extends createZodDto('AuditQuery', AuditQuerySchema) {}
```

`admin-audit.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditPageSchema, type AuditPage, type AuditQuery } from '@pokedrop/shared';
import { decodeNewestCursor, encodeNewestCursor } from '../common/newest-cursor.js';
import { PrismaService } from '../prisma/index.js';

const DAY = 24 * 60 * 60 * 1000;

/** Reads only: the log is append-only, and nothing here writes it. */
@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AuditQuery): Promise<AuditPage> {
    const cursor = query.cursor === undefined ? null : decodeNewestCursor(query.cursor);
    const scope = scopeOf(query);
    const where: Prisma.AuditLogWhereInput =
      cursor === null
        ? scope
        : {
            AND: [
              scope,
              {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              },
            ],
          };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.pageSize + 1,
        select: {
          id: true,
          action: true,
          entity: true,
          entityId: true,
          meta: true,
          createdAt: true,
          actor: { select: { id: true, displayName: true, email: true } },
        },
      }),
      this.prisma.auditLog.count({ where: scope }),
    ]);
    const page = rows.slice(0, query.pageSize);
    const last = page.at(-1);
    const subjects = await this.subjects(page);

    return AuditPageSchema.parse({
      items: page.map((row) => ({
        ...row,
        meta: typeof row.meta === 'object' && row.meta !== null && !Array.isArray(row.meta) ? row.meta : {},
        subject: subjects.get(`${row.entity}:${row.entityId}`) ?? null,
      })),
      pageSize: query.pageSize,
      total,
      nextCursor:
        rows.length > query.pageSize && last !== undefined
          ? encodeNewestCursor(last.createdAt, last.id)
          : null,
    });
  }

  /** One read per kind for the whole page: users by id, templates by id. */
  private async subjects(rows: { entity: string; entityId: string }[]) {
    const ids = (entity: string) => [...new Set(rows.filter((r) => r.entity === entity).map((r) => r.entityId))];
    const [users, templates] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: ids('User') } },
        select: { id: true, displayName: true, email: true },
      }),
      this.prisma.packTemplate.findMany({
        where: { id: { in: ids('PackTemplate') } },
        select: { id: true, name: true },
      }),
    ]);
    const map = new Map<string, { label: string; email: string | null }>();
    for (const u of users) map.set(`User:${u.id}`, { label: u.displayName || u.email, email: u.email });
    for (const t of templates) map.set(`PackTemplate:${t.id}`, { label: t.name, email: null });
    return map;
  }
}

function scopeOf(query: AuditQuery): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [];
  if (query.actor === 'system') and.push({ actorId: null });
  else if (query.actor !== undefined) and.push({ actorId: query.actor });
  if (query.action !== undefined) {
    and.push(query.action.includes('.') ? { action: query.action } : { action: { startsWith: `${query.action}.` } });
  }
  if (query.entity !== undefined) and.push({ entity: query.entity });
  if (query.entityId !== undefined) and.push({ entityId: query.entityId });
  if (query.from !== undefined || query.to !== undefined) {
    and.push({
      createdAt: {
        ...(query.from !== undefined ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
        ...(query.to !== undefined
          ? { lt: new Date(new Date(`${query.to}T00:00:00Z`).getTime() + DAY) }
          : {}),
      },
    });
  }
  return and.length === 0 ? {} : { AND: and };
}
```

`action` groups are lowercase letters and underscores only (the schema's regex), so `startsWith` needs no LIKE escaping.

`admin-audit.controller.ts`:

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuditPageSchema, type AuditPage } from '@pokedrop/shared';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Doc, returns } from '../common/openapi.js';
import { AuditQueryDto } from './admin-audit.dto.js';
import { AdminAuditService } from './admin-audit.service.js';

@ApiTags('admin')
@Roles(['ADMIN'])
@Controller('admin/audit')
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @Doc('The audit log, newest first, filtered; read-only', returns('AuditPage', AuditPageSchema))
  @Get()
  list(@Query() query: AuditQueryDto): Promise<AuditPage> {
    return this.audit.list(query);
  }
}
```

`admin-audit.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AdminAuditController } from './admin-audit.controller.js';
import { AdminAuditService } from './admin-audit.service.js';

@Module({ controllers: [AdminAuditController], providers: [AdminAuditService] })
export class AdminAuditModule {}
```

In `app.module.ts` import `AdminAuditModule` from `./admin-audit/admin-audit.module.js` and add it after `AdminUsersModule` in `imports`.

- [ ] **Step 4: Gate**

Run the api gate on `apps/api/src/admin-audit apps/api/src/app.module.ts`.

- [ ] **Step 5: Measure**

- `GET /admin/audit?pageSize=2` → 200, `total` equals `select count(*) from audit_logs`; walk `pageSize=7` to the end: every id once;
- `actor=<admin id>` → only their rows; `actor=system` → only `actorId` null (`trade.expire`); `action=user` → only `user.*`; `action=trade.void` → only that; `entity=Trade&entityId=<id>` → that trade's history; `entityId` alone → 400; a date range; `action=User.X`, `entity=Card` → 400; member 403; no cookie 401;
- a `User` row carries `subject` `{ label, email }`, a `PackTemplate` row `{ label: name, email: null }`, a `Trade` row `null`;
- the step 1 `EXPLAIN ANALYZE` again inside `BEGIN … ROLLBACK` with the 20 000 rows: an `Index Scan Backward using audit_logs_createdAt_id_idx`, no `Sort`; and with a one-day `createdAt` range, the same index. Record both timings.
Expected: as listed.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma apps/api/src/admin-audit apps/api/src/app.module.ts
git commit -m "[PD-123]: list the audit log for admins, newest first, filtered" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Web endpoints, hooks and the user filter

**Files:**
- Modify: `apps/web/lib/api/endpoints/admin.ts`, `apps/web/lib/query/{admin,keys,invalidation}.ts`, `apps/web/components/trades/trade-summary.ts`
- Create: `apps/web/components/admin/user-filter.tsx`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: endpoints `adminTrades(params)`, `adminTrade(id)`, `voidCheck(id)`, `voidTrade(id, reason)`, `auditLog(params)`; hooks `useAdminTrades(params)` (infinite), `useAdminTrade(id, initial?, initialAt?)`, `useVoidCheck(id, enabled)`, `useVoidTrade()`, `useAuditLog(params)` (infinite); keys `keys.admin.trades.{all,list(params),detail(id),voidCheck(id)}`, `keys.admin.audit(params)`; `namedSides(trade): { initiator: string; recipient: string }`; `<UserFilter value label onChange />`.

- [ ] **Step 1: Endpoints**

Append to `lib/api/endpoints/admin.ts` (add the shared imports `AdminTradeQuerySchema`, `AuditQuerySchema`, `AuditPageSchema`, `TradeDetailSchema`, `TradePageSchema`, `TradeSchema`, `VoidCheckSchema`):

```ts
export type AdminTradeParams = z.input<typeof AdminTradeQuerySchema>;
export type AuditParams = z.input<typeof AuditQuerySchema>;

export const adminTrades = (params: AdminTradeParams) =>
  get('/admin/trades', TradePageSchema, params);

export const adminTrade = (id: string) =>
  get(`/admin/trades/${encodeURIComponent(id)}`, TradeDetailSchema);

export const voidCheck = (id: string) =>
  get(`/admin/trades/${encodeURIComponent(id)}/void-check`, VoidCheckSchema);

export const voidTrade = (id: string, reason: string) =>
  post(`/admin/trades/${encodeURIComponent(id)}/void`, TradeSchema, { reason });

export const auditLog = (params: AuditParams) => get('/admin/audit', AuditPageSchema, params);
```

- [ ] **Step 2: Keys and invalidation**

In `keys.ts`, inside `admin`, replace nothing and add:

```ts
    trades: {
      all: ['admin', 'trades'],
      list: (params: object) => ['admin', 'trades', 'list', params],
      detail: (id: string) => ['admin', 'trades', 'detail', id],
      voidCheck: (id: string) => ['admin', 'trades', 'void-check', id],
    },
    audit: (params: object) => ['admin', 'audit', params],
```

In `invalidation.ts` add `voidTrade: ['voidTrade']` to `mutationKeys` and:

```ts
  // A void releases a lock or reverses a settlement: both parties' trades, cards and coins.
  voidTrade: [keys.admin.all, keys.trades.all, keys.inventory.all, keys.wallet.all, keys.me],
```

- [ ] **Step 3: Hooks**

Append to `lib/query/admin.ts` (imports: `useInfiniteQuery`, the new endpoints and their param types, `type TradeDetail`):

```ts
export function useAdminTrades(params: Omit<AdminTradeParams, 'cursor'>) {
  return useInfiniteQuery({
    queryKey: keys.admin.trades.list(params),
    queryFn: ({ pageParam }) => api.call(adminTrades({ ...params, cursor: pageParam })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useAdminTrade(id: string, initial?: TradeDetail, initialAt?: number) {
  return useQuery({
    queryKey: keys.admin.trades.detail(id),
    queryFn: () => api.call(adminTrade(id)),
    initialData: initial,
    initialDataUpdatedAt: initialAt,
  });
}

/** Fresh every time the dialog opens: a check is only as good as the moment it ran. */
export function useVoidCheck(id: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.admin.trades.voidCheck(id),
    queryFn: () => api.call(voidCheck(id)),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

export function useVoidTrade() {
  return useMutation({
    mutationKey: mutationKeys.voidTrade,
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.call(voidTrade(id, reason)),
    meta: { toast: false },
  });
}

export function useAuditLog(params: Omit<AuditParams, 'cursor'>) {
  return useInfiniteQuery({
    queryKey: keys.admin.audit(params),
    queryFn: ({ pageParam }) => api.call(auditLog({ ...params, cursor: pageParam })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
```

- [ ] **Step 4: Named sides**

In `components/trades/trade-summary.ts` add:

```ts
/** Each party's side by name, for a reader who is neither: `Charizard ×2, 50 coins`. */
export function namedSides(trade: TradeView) {
  return {
    initiator: sideText(trade, 'OFFERED', trade.currencyFromInitiator),
    recipient: sideText(trade, 'REQUESTED', trade.currencyFromRecipient),
  };
}
```

- [ ] **Step 5: The user filter**

`components/admin/user-filter.tsx` — a search field over `GET /admin/users?q=` (debounced 300 ms with `useDebounced`), its matches as buttons, the choice as a chip with ×:

```tsx
'use client';

import { X } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { useAdminUsers } from '@/lib/query/admin';
import { useDebounced } from '@/lib/use-debounced';

/**
 * `value` is a user id from the URL; `label` is the name the caller already knows for it (from
 * the rows the filter produced), so a shared link still reads well without another request.
 */
export function UserFilter({
  label,
  value,
  valueLabel,
  extra,
  onChange,
}: {
  label: string;
  value: string | undefined;
  valueLabel: string | undefined;
  /** An extra choice offered first, e.g. `{ value: 'system', label: 'System' }`. */
  extra?: { value: string; label: string };
  onChange: (value: string | undefined) => void;
}) {
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 300);
  const users = useAdminUsers({ q: q || undefined, pageSize: 6 });
  const matches = q.length > 0 ? (users.data?.items ?? []) : [];

  if (value !== undefined) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-small text-mut">{label}</span>
        <span className="flex h-10 items-center gap-1 self-start rounded-pill border border-bd-2 bg-surface-2 py-1 pr-1 pl-3 text-small text-tx">
          <span className="max-w-52 truncate">{valueLabel ?? value}</span>
          <button
            type="button"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => onChange(undefined)}
            className="focus-ring flex size-6 cursor-pointer items-center justify-center rounded-pill text-mut hover:text-tx"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </span>
      </div>
    );
  }
  return (
    <div className="relative flex min-w-56 flex-col">
      <Input
        label={label}
        placeholder="Name or email"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {(extra || matches.length > 0) && (q.length > 0 || extra) ? (
        <ul
          aria-label={`${label} choices`}
          className="mt-1 flex flex-col rounded-control border border-bd bg-bg"
        >
          {extra && (q.length === 0 || extra.label.toLowerCase().includes(q.toLowerCase())) ? (
            <li>
              <button
                type="button"
                onClick={() => onChange(extra.value)}
                className="focus-ring w-full cursor-pointer px-3 py-2 text-left text-small text-tx hover:bg-surface-2"
              >
                {extra.label}
              </button>
            </li>
          ) : null}
          {matches.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => {
                  setText('');
                  onChange(user.id);
                }}
                className="focus-ring flex w-full cursor-pointer flex-col px-3 py-2 text-left text-small hover:bg-surface-2"
              >
                <span className="text-tx">{user.displayName || '(no name)'}</span>
                <span className="text-[11.5px] text-mut">{user.email}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: Gate and commit**

Run the web gate on `apps/web/lib apps/web/components/admin/user-filter.tsx apps/web/components/trades/trade-summary.ts`.

```bash
git add apps/web/lib apps/web/components/admin/user-filter.tsx apps/web/components/trades/trade-summary.ts
git commit -m "[PD-123]: add the admin trade and audit queries and a user filter" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `/admin/trades`

**Files:**
- Create: `apps/web/components/admin/trades/admin-trades.tsx`
- Modify: `apps/web/app/(app)/admin/trades/page.tsx`

**Interfaces:**
- Consumes: `useAdminTrades`, `namedSides`, `UserFilter` (Task 5), `TRADE_STATUS_STYLES`, `useUrlState`, `Tabs`/`TabsPanel`, `LoadMore`, `ListError`, `EmptyState`.

- [ ] **Step 1: The page component**

```tsx
'use client';

import { TradeStatusSchema, type TradeView } from '@pokedrop/shared';
import { ArrowRight, Flag } from 'lucide-react';
import Link from 'next/link';
import { z } from 'zod';
import { ListError, LoadMore } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsPanel } from '@/components/ui/tabs';
import { TRADE_STATUS_STYLES } from '@/lib/design/status';
import { dateTime } from '@/lib/format';
import { useAdminTrades } from '@/lib/query/admin';
import { useUrlState } from '@/lib/url-state';
import { namedSides } from '@/components/trades/trade-summary';
import { UserFilter } from '../user-filter';

const STATUS_TABS = ['all', ...TradeStatusSchema.options] as const;
const Day = z.iso.date().optional().catch(undefined);
const FiltersSchema = z.object({
  status: z.enum(STATUS_TABS).catch('all').default('all'),
  user: z.string().min(1).max(64).optional().catch(undefined),
  from: Day,
  to: Day,
});

function partyName(trades: TradeView[], id: string | undefined) {
  if (!id) return undefined;
  const row = trades.find((t) => t.initiator.id === id || t.recipient.id === id);
  return row ? (row.initiator.id === id ? row.initiator : row.recipient).displayName : undefined;
}

export function AdminTrades() {
  const [filters, setFilters] = useUrlState(FiltersSchema);
  const range = filters.from && filters.to && filters.from > filters.to ? {} : { from: filters.from, to: filters.to };
  const list = useAdminTrades({
    status: filters.status === 'all' ? undefined : filters.status,
    user: filters.user,
    ...range,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const filtered = filters.status !== 'all' || filters.user || filters.from || filters.to;

  return (
    <>
      <PageHeader title="Trade moderation" description="Every trade between collectors, newest first. Open one to see its history or void it." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <UserFilter
          label="Collector"
          value={filters.user}
          valueLabel={partyName(items, filters.user)}
          onChange={(user) => setFilters({ user })}
        />
        <Input label="From" type="date" value={filters.from ?? ''} onChange={(e) => setFilters({ from: e.target.value })} className="w-40" />
        <Input label="To" type="date" value={filters.to ?? ''} onChange={(e) => setFilters({ to: e.target.value })} className="w-40" />
      </div>
      <Tabs
        label="Status"
        value={filters.status}
        onValueChange={(status) => setFilters({ status })}
        tabs={STATUS_TABS.map((value) => ({ value, label: value === 'all' ? 'All' : TRADE_STATUS_STYLES[value].label }))}
      >
        <TabsPanel value={filters.status}>
          {list.isPending ? (
            <ul aria-busy="true" aria-label="Loading trades" className="flex flex-col gap-3">
              {[0, 1, 2].map((slot) => (
                <li key={slot}><Skeleton shape="block" height="4.5rem" /></li>
              ))}
            </ul>
          ) : list.isError ? (
            <ListError error={list.error} onRetry={() => void list.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={Flag}
              tone="neutral"
              title="No trades match"
              body="Widen the dates, choose another status or clear the collector."
              cta={filtered ? { label: 'Clear filters', onClick: () => setFilters({ status: 'all', user: undefined, from: undefined, to: undefined }) } : undefined}
            />
          ) : (
            <>
              <ul className="flex flex-col gap-3">
                {items.map((trade) => {
                  const sides = namedSides(trade);
                  const status = TRADE_STATUS_STYLES[trade.status];
                  return (
                    <li key={trade.id}>
                      <Link
                        href={`/admin/trades/${trade.id}`}
                        className="focus-ring flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-bd bg-surface p-4 transition hover:bg-surface-2"
                      >
                        <span className="flex min-w-0 flex-1 basis-80 flex-col gap-1 text-small">
                          <span className="truncate text-tx">
                            <b className="font-semibold">{trade.initiator.displayName}</b> gives {sides.initiator}
                          </span>
                          <span className="flex min-w-0 items-center gap-1 truncate text-mut">
                            <ArrowRight aria-hidden className="size-3.5 shrink-0" />
                            <b className="font-semibold text-tx">{trade.recipient.displayName}</b> gives {sides.recipient}
                          </span>
                        </span>
                        <span className="flex flex-col items-end gap-1 text-[11.5px] text-faint">
                          <Badge label={status.label} tone={status.tone} />
                          <span>created {dateTime(trade.createdAt)}</span>
                          {trade.resolvedAt ? <span>closed {dateTime(trade.resolvedAt)}</span> : null}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <LoadMore
                shown={items.length}
                total={total}
                noun={total === 1 ? 'trade' : 'trades'}
                hasMore={list.hasNextPage}
                loading={list.isFetchingNextPage}
                onLoad={() => void list.fetchNextPage()}
              />
            </>
          )}
        </TabsPanel>
      </Tabs>
    </>
  );
}
```

`Button` is unused — drop the import.

- [ ] **Step 2: The route**

```tsx
import type { Metadata } from 'next';
import { AdminTrades } from '@/components/admin/trades/admin-trades';

export const metadata: Metadata = { title: 'Trade moderation' };

export default function Page() {
  return <AdminTrades />;
}
```

- [ ] **Step 3: Gate and commit**

Run the web gate on `apps/web/components/admin/trades "apps/web/app/(app)/admin/trades"`.

```bash
git add apps/web/components/admin/trades "apps/web/app/(app)/admin/trades/page.tsx"
git commit -m "[PD-123]: add the admin trade list with status, collector and dates" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `/admin/trades/[id]` and the void dialog

**Files:**
- Create: `apps/web/components/admin/trades/admin-trade-detail.tsx`, `apps/web/components/admin/trades/void-dialog.tsx`, `apps/web/app/(app)/admin/trades/[id]/page.tsx`

**Interfaces:**
- Consumes: `useAdminTrade`, `useVoidCheck`, `useVoidTrade` (Task 5); `TradeOfferPanel`, `TradeStatusTimeline`, `tradeTimelineSteps` (PD-116); `VoidTradeSchema`; `cardView`.
- Produces: `<VoidDialog trade open onClose onVoided />`.

- [ ] **Step 1: The server route**

```tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { AdminTradeDetail } from '@/components/admin/trades/admin-trade-detail';
import { ApiError } from '@/lib/api/core';
import { adminTrade } from '@/lib/api/endpoints/admin';
import { serverApi } from '@/lib/api/server';

const loadTrade = cache(async (id: string) => {
  try {
    return { trade: await serverApi.call(adminTrade(id)), at: Date.now() };
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) return null;
    throw error;
  }
});

export async function generateMetadata({ params }: PageProps<'/admin/trades/[id]'>): Promise<Metadata> {
  const { id } = await params;
  const found = await loadTrade(id).catch(() => null);
  return { title: found ? `${found.trade.initiator.displayName} → ${found.trade.recipient.displayName}` : 'Trade' };
}

export default async function Page({ params }: PageProps<'/admin/trades/[id]'>) {
  const { id } = await params;
  const found = await loadTrade(id);
  if (!found) notFound();
  return <AdminTradeDetail id={id} initial={found.trade} initialAt={found.at} />;
}
```

- [ ] **Step 2: The void dialog**

```tsx
'use client';

import { type TradeDetail, VoidTradeSchema } from '@pokedrop/shared';
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { apiErrorMessage, toastSuccess } from '@/lib/toast';
import { useVoidCheck, useVoidTrade } from '@/lib/query/admin';

/** Asks the server first; a void it would refuse is never offered (PD-123 AC1). */
export function VoidDialog({
  trade,
  open,
  onClose,
  onSettled,
}: {
  trade: TradeDetail;
  open: boolean;
  onClose: () => void;
  /** After a void or a refusal: re-read the trade. */
  onSettled: () => void;
}) {
  const check = useVoidCheck(trade.id, open);
  const voiding = useVoidTrade();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const parsed = VoidTradeSchema.safeParse({ reason });
  const accepted = trade.status === 'ACCEPTED';
  const a = trade.initiator.displayName;
  const b = trade.recipient.displayName;
  const voidable = check.data?.voidable === true && refused === null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      tone="danger"
      icon={ShieldAlert}
      title={`Void the trade between ${a} and ${b}?`}
      description={
        accepted
          ? `The swap is undone: every card and coin goes back to the side it came from. Both are notified.`
          : `The offer closes as Voided and ${a}’s locked copies are released. Both are notified.`
      }
      confirmLabel={voidable ? 'Void trade' : undefined}
      confirming={voiding.isPending}
      onConfirm={
        voidable
          ? () => {
              setTouched(true);
              if (!parsed.success) return;
              voiding.mutate(
                { id: trade.id, reason: parsed.data.reason },
                {
                  onSuccess: () => {
                    toastSuccess(`Voided the trade between ${a} and ${b}`);
                    onSettled();
                    onClose();
                  },
                  onError: (error) => {
                    setRefused(apiErrorMessage(error));
                    onSettled();
                  },
                },
              );
            }
          : undefined
      }
    >
      {check.isPending ? (
        <p role="status" className="flex items-center gap-2 text-small text-mut">
          <Spinner size={16} /> Checking whether this trade can be voided…
        </p>
      ) : check.isError ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-small text-red">
            Couldn’t check whether this trade can be voided: {apiErrorMessage(check.error)}
          </p>
          <Button variant="secondary" size="sm" className="self-start" onClick={() => void check.refetch()}>
            Try again
          </Button>
        </div>
      ) : refused !== null ? (
        <p role="alert" className="text-small text-red">Not voided: {refused}</p>
      ) : check.data && !check.data.voidable ? (
        <p role="alert" className="text-small text-red">This trade can’t be voided now: {check.data.reason}</p>
      ) : (
        <Input
          label="Reason"
          value={reason}
          maxLength={500}
          placeholder="Recorded in the audit log; the members are not shown it"
          onChange={(event) => setReason(event.target.value)}
          error={touched && !parsed.success ? 'Say why — 1 to 500 characters' : undefined}
        />
      )}
    </Dialog>
  );
}
```

`components/ui/dialog.tsx` renders no footer at all without `onConfirm`, so every state that offers no void (checking, failed, not voidable, refused) ends its `children` with its own `<Button variant="secondary" onClick={onClose}>Close</Button>`.

- [ ] **Step 3: The page component**

```tsx
'use client';

import type { TradeDetail } from '@pokedrop/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ScrollText, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { cardView } from '@/components/cards/card-data';
import { TradeOfferPanel } from '@/components/trades/trade-offer-panel';
import { TradeStatusTimeline, tradeTimelineSteps } from '@/components/trades/trade-status-timeline';
import { Badge } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { TRADE_STATUS_STYLES } from '@/lib/design/status';
import { dateTime } from '@/lib/format';
import { useAdminTrade } from '@/lib/query/admin';
import { keys } from '@/lib/query/keys';
import { VoidDialog } from './void-dialog';

const side = (trade: TradeDetail, which: 'OFFERED' | 'REQUESTED') =>
  trade.items
    .filter((item) => item.side === which)
    .map((item) => ({ card: cardView(item.card), count: item.quantity, locked: which === 'OFFERED' && trade.status === 'PENDING' }));

// Admin links: the timeline's and the chain's `/trades/…` become `/admin/trades/…`.
const adminHref = (href: string) => href.replace(/^\/trades\//, '/admin/trades/');

export function AdminTradeDetail({ id, initial, initialAt }: { id: string; initial: TradeDetail; initialAt: number }) {
  const queryClient = useQueryClient();
  const trade = useAdminTrade(id, initial, initialAt).data ?? initial;
  const [voiding, setVoiding] = useState(false);
  const status = TRADE_STATUS_STYLES[trade.status];
  const a = trade.initiator;
  const b = trade.recipient;
  const steps = tradeTimelineSteps(trade).map((step) =>
    step.link ? { ...step, link: { ...step.link, href: adminHref(step.link.href) } } : step,
  );
  const voidable = trade.status === 'PENDING' || trade.status === 'ACCEPTED';
  const userLink = (party: { displayName: string }) => `/admin/users?q=${encodeURIComponent(party.displayName)}`;

  return (
    <>
      <Breadcrumbs trail={[{ label: 'Trade moderation', href: '/admin/trades' }, { label: `${a.displayName} → ${b.displayName}` }]} className="mb-4" />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <header className="flex flex-wrap items-center gap-3">
            <h1 className="flex min-w-0 flex-wrap items-center gap-2 text-h1 font-bold tracking-tight wrap-anywhere">
              <Link href={userLink(a)} className="focus-ring rounded-tag hover:underline">{a.displayName}</Link>
              <ArrowRight aria-label="to" className="size-6 text-faint" />
              <Link href={userLink(b)} className="focus-ring rounded-tag hover:underline">{b.displayName}</Link>
            </h1>
            <Badge label={status.label} tone={status.tone} />
          </header>
          <p className="text-small text-mut">
            Created {dateTime(trade.createdAt)}
            {trade.resolvedAt ? ` · closed ${dateTime(trade.resolvedAt)}` : ''} · <span className="font-mono">{trade.id}</span>
          </p>
          <TradeOfferPanel
            give={{ label: `${a.displayName} gives`, cards: side(trade, 'OFFERED'), coins: trade.currencyFromInitiator }}
            get={{ label: `${b.displayName} gives`, cards: side(trade, 'REQUESTED'), coins: trade.currencyFromRecipient }}
          />
          <div className="flex flex-wrap items-center gap-3">
            {voidable ? (
              <Button variant="destructive" icon={ShieldAlert} onClick={() => setVoiding(true)}>Void trade</Button>
            ) : (
              <p className="text-small text-mut">A {status.label.toLowerCase()} trade has nothing to void.</p>
            )}
            <Button asChild variant="ghost" icon={ScrollText}>
              <Link href={`/admin/audit?entity=Trade&entityId=${encodeURIComponent(trade.id)}`}>View in the audit log</Link>
            </Button>
          </div>
        </div>
        <aside className="flex min-w-0 flex-col gap-6 rounded-card border border-bd bg-surface p-4.5">
          <section aria-labelledby="status-heading" className="flex flex-col gap-3">
            <h2 id="status-heading" className="text-small font-semibold text-mut">Status</h2>
            <TradeStatusTimeline steps={steps} />
          </section>
          {trade.chain.length > 1 ? (
            <section aria-labelledby="chain-heading" className="flex flex-col gap-2">
              <h2 id="chain-heading" className="text-small font-semibold text-mut">Negotiation · {trade.chain.length} offers</h2>
              <ol className="flex flex-col gap-2">
                {trade.chain.map((entry, index) => (
                  <li key={entry.id}>
                    {entry.id === trade.id ? (
                      <span aria-current="page" className="flex justify-between gap-2 rounded-control border border-pri/40 bg-pri-dim px-3 py-2 text-small">
                        Offer {index + 1} (this one) <Badge label={TRADE_STATUS_STYLES[entry.status].label} tone={TRADE_STATUS_STYLES[entry.status].tone} />
                      </span>
                    ) : (
                      <Link href={`/admin/trades/${entry.id}`} className="focus-ring flex justify-between gap-2 rounded-control border border-bd bg-bg px-3 py-2 text-small hover:bg-surface-2">
                        Offer {index + 1} <Badge label={TRADE_STATUS_STYLES[entry.status].label} tone={TRADE_STATUS_STYLES[entry.status].tone} />
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </aside>
      </div>
      {voiding ? (
        <VoidDialog
          trade={trade}
          open
          onClose={() => setVoiding(false)}
          onSettled={() => void queryClient.invalidateQueries({ queryKey: keys.admin.trades.detail(trade.id) })}
        />
      ) : null}
    </>
  );
}
```

The party links use the display name as `?q=` — a trade's parties carry no email (`TradeParty`), and the users search matches names too; `tradeTimelineSteps` with `role: null` already names both parties.

- [ ] **Step 4: Gate and commit**

Run the web gate on `apps/web/components/admin/trades "apps/web/app/(app)/admin/trades"`.

```bash
git add apps/web/components/admin/trades "apps/web/app/(app)/admin/trades"
git commit -m "[PD-123]: add the admin trade page with a void checked before it is offered" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `/admin/audit` and the deep links

**Files:**
- Create: `apps/web/components/admin/audit/audit-words.ts`, `apps/web/components/admin/audit/admin-audit.tsx`
- Modify: `apps/web/app/(app)/admin/audit/page.tsx`, `apps/web/components/admin/users/admin-users.tsx`, `apps/web/components/admin/packs/admin-packs.tsx`

**Interfaces:**
- Consumes: `useAuditLog`, `UserFilter` (Task 5); `AUDIT_ENTITIES`, `AUDIT_ACTION_GROUPS`, `type AuditEntry` (Task 1).
- Produces: `actionWords(action)`, `metaSummary(entry)`, `entityHref(entry)`.

- [ ] **Step 1: The wording**

`audit-words.ts`:

```ts
import type { AuditEntry } from '@pokedrop/shared';
import { formatCoins } from '@/lib/format';

const ACTIONS: Record<string, string> = {
  'trade.propose': 'Proposed a trade',
  'trade.counter': 'Countered a trade',
  'trade.accept': 'Accepted a trade',
  'trade.decline': 'Declined a trade',
  'trade.cancel': 'Cancelled a trade',
  'trade.expire': 'Expired a trade',
  'trade.void': 'Voided a trade',
  'user.currency_grant': 'Adjusted coins',
  'user.role_change': 'Changed a role',
  'user.suspend': 'Suspended an account',
  'user.unsuspend': 'Unsuspended an account',
  'pack_template.create': 'Created a pack template',
  'pack_template.update': 'Changed a pack template',
  'sync.trigger': 'Started a sync',
  'sync.breaker_reset': 'Reset a provider breaker',
};

export const KNOWN_ACTIONS = Object.keys(ACTIONS);

export function actionWords(action: string): string {
  return ACTIONS[action] ?? action;
}

const str = (value: unknown) => (typeof value === 'string' ? value : null);
const num = (value: unknown) => (typeof value === 'number' ? value : null);

/** One line from `meta` for the actions whose shape is known; the raw JSON is under *Details*. */
export function metaSummary(entry: AuditEntry): string | null {
  const m = entry.meta;
  const reason = str(m.reason);
  switch (entry.action) {
    case 'user.currency_grant': {
      const amount = num(m.amount);
      return amount === null ? null : `${amount > 0 ? '+' : '−'}${formatCoins(Math.abs(amount))} coins${reason ? ` — ${reason}` : ''}`;
    }
    case 'user.role_change':
      return `${str(m.from) ?? '?'} → ${str(m.to) ?? '?'}`;
    case 'user.suspend': {
      const voided = Array.isArray(m.voidedTradeIds) ? m.voidedTradeIds.length : 0;
      return `${reason ?? ''}${voided > 0 ? ` · ${voided} pending ${voided === 1 ? 'trade' : 'trades'} voided` : ''}` || null;
    }
    case 'pack_template.update': {
      const changes = m.changes;
      return changes && typeof changes === 'object' ? `Changed ${Object.keys(changes).join(', ')}` : null;
    }
    case 'sync.trigger':
      return str(m.kind) ? `${str(m.kind)?.toLowerCase()} sync` : null;
    case 'sync.breaker_reset':
      return num(m.failures) !== null ? `${num(m.failures)} failures cleared` : null;
    default:
      if (entry.entity === 'Trade') {
        const to = str(m.to);
        return [to ? `${str(m.from) ?? 'new'} → ${to}` : null, reason ? `reason: ${reason}` : null].filter(Boolean).join(' · ') || null;
      }
      return reason;
  }
}

export function entityHref(entry: AuditEntry): string {
  switch (entry.entity) {
    case 'Trade':
      return `/admin/trades/${encodeURIComponent(entry.entityId)}`;
    case 'User':
      return `/admin/users?q=${encodeURIComponent(entry.subject?.email ?? entry.entityId)}`;
    case 'PackTemplate':
      return `/admin/packs?template=${encodeURIComponent(entry.entityId)}`;
    default:
      return '/admin/sync';
  }
}

export function entityLabel(entry: AuditEntry): string {
  if (entry.subject) return entry.subject.label;
  if (entry.entity === 'Trade') return `Trade ${entry.entityId.slice(0, 8)}…`;
  if (entry.entity === 'SyncJob') return `Sync job ${entry.entityId.slice(0, 8)}`;
  return `${entry.entity} ${entry.entityId}`;
}
```

- [ ] **Step 2: The page**

`admin-audit.tsx` — filters in the URL with `useUrlState` (`actor`, `action`, `entity`, `entityId`, `from`, `to`, each `.catch(undefined)`), the actor `UserFilter` with `extra={{ value: 'system', label: 'System' }}` and `valueLabel` from the loaded rows (`entry.actor?.displayName`, or *System*), an action `<select>` (*Any action*, the four groups as *Trades · Users · Pack templates · Sync*, then `KNOWN_ACTIONS`), an entity `<select>` (*Any object*, `AUDIT_ENTITIES`), the `entityId` as a chip with × when present, *From* / *To* date inputs. The list:

```tsx
<ol className="flex flex-col divide-y divide-bd rounded-card border border-bd bg-surface">
  {items.map((entry) => (
    <li key={entry.id} className="flex flex-col gap-1 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <time dateTime={entry.createdAt.toISOString()} title={dateTime(entry.createdAt)} className="w-28 shrink-0 text-[11.5px] text-faint">
          {timeAgo(entry.createdAt)}
        </time>
        <span className="text-small text-tx">
          {entry.actor ? <b className="font-semibold">{entry.actor.displayName || entry.actor.email}</b> : <b className="font-semibold text-mut">System</b>}{' '}
          {actionWords(entry.action).toLowerCase()}
        </span>
        <Link href={entityHref(entry)} className="focus-ring min-w-0 truncate rounded-tag text-small text-pri hover:underline">
          {entityLabel(entry)}
        </Link>
        <span className="font-mono text-[11px] text-faint">{entry.action}</span>
      </div>
      {metaSummary(entry) ? <p className="pl-31 text-small text-mut wrap-anywhere max-sm:pl-0">{metaSummary(entry)}</p> : null}
      <details className="pl-31 max-sm:pl-0">
        <summary className="focus-ring cursor-pointer rounded-tag text-[11.5px] text-mut">Details</summary>
        <pre className="mt-1 overflow-x-auto rounded-control bg-bg p-2 font-mono text-[11px] text-mut">
          {JSON.stringify({ actor: entry.actor?.email ?? 'system', entity: entry.entity, entityId: entry.entityId, meta: entry.meta }, null, 2)}
        </pre>
      </details>
    </li>
  ))}
</ol>
```

then `LoadMore`; empty: `EmptyState` *No entries match* with *Clear filters*; loading skeletons; `ListError`. Header: *Audit log* — *Every recorded action, newest first. Read-only: nothing here changes or removes an entry.* No button on a row other than the `<details>` summary. `pl-31` is not a token — if the linter or the design rules refuse it, use `sm:pl-31` with a defined spacing token or wrap the time in a fixed `w-28` column and indent with the same grid (`grid-cols-[7rem_minmax(0,1fr)]`).

`app/(app)/admin/audit/page.tsx` renders `<AdminAudit />` with `metadata = { title: 'Audit log' }`.

- [ ] **Step 3: `?q=` on the users page**

In `components/admin/users/admin-users.tsx` initialise the search from the URL:

```tsx
import { useSearchParams } from 'next/navigation';
// …
const params = useSearchParams();
const [q, setQ] = useState(() => params.get('q')?.trim() ?? '');
```

and pass `value={q}` to `SearchInput` (it already takes `value`).

- [ ] **Step 4: `?template=` on the packs page**

In `components/admin/packs/admin-packs.tsx`:

```tsx
import { useSearchParams } from 'next/navigation';
// …
const params = useSearchParams();
const [chosen, setChosen] = useState<string | null | undefined>(() => params.get('template') ?? undefined);
```

- [ ] **Step 5: Gate and commit**

Run the web gate on `apps/web/components/admin "apps/web/app/(app)/admin"`.

```bash
git add apps/web/components/admin "apps/web/app/(app)/admin/audit/page.tsx"
git commit -m "[PD-123]: add the read-only audit log with filters and object links" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Measure in the browser and document

**Files:**
- Create (scratchpad): `measure-123.mjs`
- Modify: `docs/API.md`, `docs/DataModel.md`, `docs/Pages.md`; memory `pokedrop-m13-decisions.md`

- [ ] **Step 1: Browser checks (CDP, the test admin's cookies)**

B1 list filters (status tab by keyboard, a collector chosen and cleared, a date range; a malformed `?from=` falls back), a row opens its page; B2 a fresh pending trade voided: the dialog's *what happens*, refused without a reason, then *Voided* and the lock released (`GET /inventory/owned` for the initiator); B3 an accepted trade made unreversible: no reason field, no *Void trade*, the reason shown; then state changed under an open voidable dialog (void it through `fetch` first): the confirm shows *Not voided: …* and the page reads *Voided*; B4 a reversible accepted trade voided: cards and coins back on both sides (SQL); B5 the audit log filtered by actor (the admin, then *System*), action group and exact action, entity and id (from *View in the audit log*), dates; every link kind lands (`Trade`, `User` → the users page with the row, `PackTemplate` → the editor on that template, `SyncJob` → sync); B6 one of each admin action in this session (grant +1 and −1, role to admin and back, suspend and unsuspend a test member, a template rename and back, a sync trigger on a paused queue then drained, a breaker reset, a void) → each in the log filtered to the admin; B7 no element on the audit page other than filters, links, *Load more* and `<details>` (assert no `button` inside the list except `summary`); B8 375 px `scrollWidth` 375 on all three pages, no console errors. Resume any paused queue at the end.
Expected: as listed.

- [ ] **Step 2: Documentation**

`docs/API.md`: *Admin / Trades* (the list, the void check and why it is a rolled-back void) and *Admin / Audit* (filters, `subject`, the index and its `EXPLAIN` lines), each with what Tasks 2–4 measured. `docs/DataModel.md` *AuditLog*: the `(createdAt, id)` index and why. `docs/Pages.md`: D6 row in the decisions table (in order, after D5), and *Trade moderation and audit log (PD-123)* with what Step 1 measured and its traps. Memory: D6 resolved in `pokedrop-m13-decisions.md`.

- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "[PD-123]: document trade moderation, the audit log and what they measured" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
