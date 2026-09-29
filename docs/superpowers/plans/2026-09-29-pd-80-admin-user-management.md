# PD-80 Admin User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins audited, self-safe levers over accounts — a user list, idempotent currency grants, role changes that can never leave the product without an admin, and a suspension that stops a user at once and voids their pending trades.

**Architecture:** A `suspendedAt` column enforced three ways (sessions deleted in the suspending transaction, Better Auth's session-creation hook, and `SessionGuard`); a new `admin-users` module whose writes run in one transaction each, write their audit row inside it, and notify after commit; the last-admin rule enforced by locking every active admin row in id order.

**Tech Stack:** NestJS 12, Prisma 7 (PostgreSQL, `@prisma/adapter-pg`), Better Auth 1.7.5, Zod 4 in `@pokedrop/shared`.

**Spec:** `docs/superpowers/specs/2026-09-29-pd-80-admin-user-management-design.md`

## Global Constraints

- **No automated tests, runners or CI test steps during v1.** Every "test" step below is a build/typecheck plus an HTTP probe against the running API with the database checked by `psql` — the project's established verification.
- Commit straight to `dev`, subject `[PD-80]: short lowercase description`, header ≤ 72 characters, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Comments only where load-bearing; rationale belongs in `docs/`.
- `input: false` on every Better Auth `additionalFields` entry.
- Error codes: `ACCOUNT_SUSPENDED` (403), `LAST_ADMIN` (409), `SELF_TARGET` (403), `GRANT_ID_CONFLICT` (409); an admin debit below zero is 409 `INSUFFICIENT_FUNDS`.
- Grants: `grantId` UUID, `amount` integer in −1 000 000 … 1 000 000 and non-zero, `reason` trimmed 1–500. Answer 200 for the first request and a replay alike.
- Audit actions: `user.currency_grant` `{ grantId, amount, reason }`, `user.role_change` `{ from, to }`, `user.suspend` `{ reason, voidedTradeIds }`, `user.unsuspend` `{}`; entity `User`, entity id the target, actor the admin. Each written in the transaction of its action.
- Suspension order inside the transaction: close pending trades → last-admin lock → set `suspendedAt` → delete sessions → audit.
- Never run `prisma migrate reset`; `prisma migrate dev --name user_suspension` only.

## Review Focus

- `q` containing `%`, `_` or `\` must match those characters literally — measured while planning: Prisma's `contains` does not escape them, so `escapeLike` does — pinned in Task 2, Step 4.
- An admin demoted while holding a session must be refused on the very next admin request, with no sign-out needed — pinned in Task 2, Step 4.
- A grant to a suspended user must still work (an admin compensating someone mid-investigation) and still notify — pinned in Task 3, Step 3.
- A suspension racing an accept of the same user's pending trade must leave exactly one outcome — the trade `ACCEPTED` or `VOIDED`, never a lock orphaned or double-released — pinned in Task 4, Step 4.
- An unknown `:id` on every write route must be 404 `User not found`, never a 500 from a missing row — pinned in Tasks 2, 3 and 4.

---

## Shared probe setup

Every task's verification uses this file. Create it once (Task 1, Step 1) at `$S/env80.sh`, where `S` is this session's scratchpad directory:

```bash
cd /m/projects/pokedrop
S="C:/Users/MaxSt/AppData/Local/Temp/claude/M--projects-pokedrop/eb1aa85d-d269-4373-af15-32b4004510fc/scratchpad"
PSQL="docker compose exec -T postgres psql -U pokedrop -d pokedrop -At"
API=http://localhost:4000/api/v1; AUTH=http://localhost:4000/api/auth; WEB=http://localhost:3000
P=pd80
req(){ who=$1; shift; m=$1; shift; p=$1; shift; if [ "$who" = anon ]; then curl -s -w ' |%{http_code}' -X "$m" "$API$p" -H 'Content-Type: application/json' "$@"; else curl -s -w ' |%{http_code}' -b "$S/jar-$who.txt" -X "$m" "$API$p" -H 'Content-Type: application/json' -H "Origin: $WEB" "$@"; fi; echo; }
strip(){ sed -E 's/,"requestId":"[^"]*"//'; }
idof(){ sed -E 's/^\{"id":"([^"]+)".*/\1/'; }
signin(){ curl -s -o /dev/null -w "sign-in $1 %{http_code}\n" -c "$S/jar-$1.txt" -X POST "$AUTH/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $WEB" -d "{\"email\":\"$P-$1@example.com\",\"password\":\"correct-horse-battery\"}"; }
mkuser(){ curl -s -o /dev/null -X POST "$AUTH/sign-up/email" -H 'Content-Type: application/json' -H "Origin: $WEB" -d "{\"email\":\"$P-$1@example.com\",\"password\":\"correct-horse-battery\",\"name\":\"PD80 $1\"}"; $PSQL -c "update users set \"emailVerified\" = true where email = '$P-$1@example.com'" >/dev/null; signin $1; }
uid(){ $PSQL -c "select id from users where email = '$P-$1@example.com'"; }
admin(){ $PSQL -c "update users set role = 'ADMIN' where email = '$P-$1@example.com'" >/dev/null; }
give(){ $PSQL -c "insert into inventory_items (id, \"userId\", \"cardId\", quantity, \"lockedQuantity\", \"acquiredAt\") values (gen_random_uuid()::text, '$(uid $1)', '$2', $3, 0, now()) on conflict (\"userId\", \"cardId\") do update set quantity = inventory_items.quantity + excluded.quantity" >/dev/null; }
coins(){ $PSQL -c "update users set currency = currency + ($2) where id = '$(uid $1)'; insert into currency_transactions (id, \"userId\", amount, type) values (gen_random_uuid()::text, '$(uid $1)', $2, 'GRANT')" >/dev/null; }
held(){ $PSQL -c "select coalesce((select quantity||'/'||\"lockedQuantity\" from inventory_items where \"userId\" = '$(uid $1)' and \"cardId\" = '$2'), 'none')"; }
uuid(){ node -e 'console.log(crypto.randomUUID())'; }
checks(){
  $PSQL -c "select 'ledger-mismatch '||count(*) from users u where currency <> coalesce((select sum(amount) from currency_transactions t where t.\"userId\" = u.id), 0)"
  $PSQL -c "select 'unreconciled '||count(*) from (with promised as (select t.\"initiatorId\" u, ti.\"cardId\" c, sum(ti.quantity) q from trades t join trade_items ti on ti.\"tradeId\" = t.id where t.status = 'PENDING' and ti.side = 'OFFERED' group by 1, 2) select 1 from inventory_items i full join promised p on p.u = i.\"userId\" and p.c = i.\"cardId\" where coalesce(i.\"lockedQuantity\", 0) <> coalesce(p.q, 0)) r"
  $PSQL -c "select 'active-admins '||count(*) from users where role = 'ADMIN' and \"suspendedAt\" is null"
}
cleanup(){
  $PSQL -c "delete from trades where \"initiatorId\" in (select id from users where email like '$P-%') or \"recipientId\" in (select id from users where email like '$P-%')"
  $PSQL -c "delete from audit_logs where \"actorId\" in (select id from users where email like '$P-%') or \"entityId\" in (select id from users where email like '$P-%') or (entity = 'Trade' and \"entityId\" not in (select id from trades))"
  $PSQL -c "delete from users where email like '$P-%'"; rm -f "$S"/jar-*.txt
}
```

`checks` must print `ledger-mismatch 0` and `unreconciled 0` after every scenario. `active-admins` is the seed's admin plus probe admins.

**Starting the API** — stop any previous one (PowerShell tool), then build and start (Bash):

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'apps[/\\]api[/\\]dist[/\\]main\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }
```

```bash
source "C:/Users/MaxSt/AppData/Local/Temp/claude/M--projects-pokedrop/eb1aa85d-d269-4373-af15-32b4004510fc/scratchpad/env80.sh"
pnpm build:shared >/dev/null && pnpm --filter @pokedrop/api build 2>&1 | grep -i error
(node apps/api/dist/main.js > "$S/api80.log" 2>&1 &)
for i in $(seq 1 40); do c=$(curl -s -o /dev/null -w '%{http_code}' $API/health/ready); [ "$c" = 200 ] && break; sleep 1; done; echo "ready: $c"
```

End every task by running `cleanup`, then `checks`, then stopping the API.

---

### Task 1: Suspension column and its enforcement

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `User`)
- Create: `apps/api/prisma/migrations/<timestamp>_user_suspension/migration.sql` (generated)
- Modify: `packages/shared/src/primitives/error.ts` (`ERROR_CODES`)
- Modify: `apps/api/src/auth/auth.factory.ts` (`user.additionalFields`, new `databaseHooks`)
- Modify: `apps/api/src/common/guards/session.guard.ts`

**Interfaces:**
- Produces: `User.suspendedAt: Date | null` in Prisma; `session.user.suspendedAt` on `AuthUser`; `ERROR_CODES.ACCOUNT_SUSPENDED | LAST_ADMIN | SELF_TARGET | GRANT_ID_CONFLICT`.

- [ ] **Step 1: Write the probe helper file** — create `$S/env80.sh` with the content of [Shared probe setup](#shared-probe-setup).

- [ ] **Step 2: Add the column.** In `apps/api/prisma/schema.prisma`, inside `model User`, directly after the `showcaseCardIds` field:

```prisma
  /// Set while an admin has suspended the account. Enforced three ways - the
  /// suspending transaction deletes the sessions, Better Auth's session hook
  /// refuses new ones, and SessionGuard refuses any that slipped between.
  suspendedAt         DateTime?
```

Then:

```bash
cd /m/projects/pokedrop/apps/api && pnpm exec prisma migrate dev --name user_suspension && pnpm exec prisma generate
```

Expected: a new folder `prisma/migrations/<ts>_user_suspension/` whose `migration.sql` is `ALTER TABLE "users" ADD COLUMN "suspendedAt" TIMESTAMP(3);`.

- [ ] **Step 3: Add the error codes.** In `packages/shared/src/primitives/error.ts`, extend `ERROR_CODES`:

```ts
export const ERROR_CODES = {
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  PACK_UNAVAILABLE: 'PACK_UNAVAILABLE',
  OPEN_ID_CONFLICT: 'OPEN_ID_CONFLICT',
  CARDS_UNAVAILABLE: 'CARDS_UNAVAILABLE',
  TRADE_NOT_PENDING: 'TRADE_NOT_PENDING',
  COUNTER_LIMIT: 'COUNTER_LIMIT',
  TRADE_NOT_REVERSIBLE: 'TRADE_NOT_REVERSIBLE',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  LAST_ADMIN: 'LAST_ADMIN',
  SELF_TARGET: 'SELF_TARGET',
  GRANT_ID_CONFLICT: 'GRANT_ID_CONFLICT',
} as const;
```

- [ ] **Step 4: Teach Better Auth the field and refuse suspended sessions.** In `apps/api/src/auth/auth.factory.ts`:

Add the import next to the other `better-auth` imports:

```ts
import { APIError } from 'better-auth/api';
```

Extend `user.additionalFields`:

```ts
      additionalFields: {
        role: { type: 'string', required: true, defaultValue: 'MEMBER', input: false },
        currency: { type: 'number', required: true, defaultValue: 0, input: false },
        suspendedAt: { type: 'date', required: false, input: false },
      },
```

Add a `databaseHooks` block to the `betterAuth({ … })` options, directly after the `user: { … }` block:

```ts
    // Every path that creates a session - sign-in, sign-up, verification -
    // passes here, so a suspended account cannot obtain one by any of them.
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const owner = await deps.prisma.user.findUnique({
              where: { id: session.userId },
              select: { suspendedAt: true },
            });
            if (owner?.suspendedAt) {
              throw APIError.from('FORBIDDEN', {
                message: 'This account is suspended',
                code: 'ACCOUNT_SUSPENDED',
              });
            }
          },
        },
      },
    },
```

- [ ] **Step 5: Refuse suspended sessions in the guard.** Replace the body of `canActivate` in `apps/api/src/common/guards/session.guard.ts`, and add the two imports:

```ts
import { HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ERROR_CODES } from '@pokedrop/shared';
import { domainError } from '../errors/domain-error.js';
```

```ts
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    const session = await this.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    // A session can outlive its user's suspension by a moment: one created by
    // a sign-in racing the suspending transaction. It is never honoured.
    const suspended = session !== null && session.user.suspendedAt != null;

    if (session && !suspended) {
      setAuthContext(request, session);
    }

    const isPublic = this.reflector.getAllAndOverride(Public, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic !== undefined) {
      return true;
    }

    if (suspended) {
      throw domainError(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.ACCOUNT_SUSPENDED,
        'This account is suspended',
      );
    }

    if (!session) {
      throw new UnauthorizedException('Authentication required');
    }

    return true;
  }
```

- [ ] **Step 6: Typecheck and lint**

```bash
cd /m/projects/pokedrop && pnpm typecheck 2>&1 | grep -E "error|Done" && npx eslint apps/api/src/auth apps/api/src/common/guards packages/shared/src --max-warnings=0
```

Expected: three `Done` lines, no errors, no lint output.

- [ ] **Step 7: Verify enforcement.** Start the API, then:

```bash
source "$S/env80.sh"   # the full path as above
mkuser m; M=$(uid m)
req m GET /users/me | grep -o '"email":"[^"]*"\||[0-9]*$' | tr '\n' ' '; echo          # 200
# The race-created session, reproduced: a live session whose user is suspended.
$PSQL -c "update users set \"suspendedAt\" = now() where id = '$M'"
req m GET /users/me | strip                                                                 # 403 ACCOUNT_SUSPENDED
req m GET /users/$M | grep -o '"id":"[^"]*"\||[0-9]*$' | tr '\n' ' '; echo                  # 200, public route served
req m GET /wallet | strip                                                                   # 403 ACCOUNT_SUSPENDED
curl -s -w ' |%{http_code}\n' -X POST "$AUTH/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $WEB" -d "{\"email\":\"$P-m@example.com\",\"password\":\"correct-horse-battery\"}"   # 403, code ACCOUNT_SUSPENDED
$PSQL -c "update users set \"suspendedAt\" = null where id = '$M'"
signin m; req m GET /users/me | grep -o '|[0-9]*$'                                          # sign-in 200, then 200
curl -s -w ' |%{http_code}\n' -X POST "$AUTH/sign-up/email" -H 'Content-Type: application/json' -H "Origin: $WEB" -d "{\"email\":\"$P-x@example.com\",\"password\":\"correct-horse-battery\",\"name\":\"x\",\"suspendedAt\":\"2020-01-01T00:00:00Z\"}" | grep -o '|[0-9]*$'
$PSQL -c "select \"suspendedAt\" is null from users where email = '$P-x@example.com'"      # t: input:false ignored it
```

Expected as commented. Then `cleanup`, `checks`, stop the API.

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma packages/shared/src/primitives/error.ts apps/api/src/auth/auth.factory.ts apps/api/src/common/guards/session.guard.ts
git commit -m "[PD-80]: add account suspension and refuse suspended sessions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Admin users module — list and role change

**Files:**
- Modify: `packages/shared/src/entities/user.ts` (append contracts)
- Create: `apps/api/src/admin-users/admin-users.service.ts`
- Create: `apps/api/src/admin-users/admin-users.controller.ts`
- Create: `apps/api/src/admin-users/admin-users.dto.ts`
- Create: `apps/api/src/admin-users/admin-users.module.ts`
- Create: `apps/api/src/admin-users/index.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `ERROR_CODES.SELF_TARGET`, `ERROR_CODES.LAST_ADMIN` (Task 1); `AuditService.record(tx, entry)`; `PrismaService.withTransaction`.
- Produces: `AdminUsersService` with `list(query)`, `changeRole(admin, id, role)`, private `row(id)`, private `assertNotLastAdmin(tx, targetId)`, private `assertNotSelf(admin, id)`; shared `AdminUserListQuerySchema`, `AdminUserRowSchema`, `AdminUserPageSchema`, `ChangeRoleSchema`, `GrantCurrencySchema`, `GrantResultSchema`, `SuspendUserSchema` and their types. Tasks 3 and 4 add methods to this service and routes to this controller.

- [ ] **Step 1: Add the contracts.** Append to `packages/shared/src/entities/user.ts`, and extend its imports to:

```ts
import { z } from 'zod';
import { RoleSchema } from '../enums.js';
import { CurrencyTransactionIdSchema, UserIdSchema } from '../primitives/id.js';
import { PaginationQuerySchema, pageOf } from '../primitives/pagination.js';
import { InventoryCardSchema, InventorySummarySchema } from './inventory.js';
```

```ts
export const AdminUserListQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  role: RoleSchema.optional(),
  suspended: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: PaginationQuerySchema.shape.page,
  pageSize: PaginationQuerySchema.shape.pageSize,
});
export type AdminUserListQuery = z.infer<typeof AdminUserListQuerySchema>;

export const AdminUserRowSchema = UserSchema.extend({
  emailVerified: z.boolean(),
  suspendedAt: z.coerce.date().nullable(),
});
export type AdminUserRow = z.infer<typeof AdminUserRowSchema>;

export const AdminUserPageSchema = pageOf(AdminUserRowSchema);
export type AdminUserPage = z.infer<typeof AdminUserPageSchema>;

export const ChangeRoleSchema = z.strictObject({ role: RoleSchema });
export type ChangeRole = z.infer<typeof ChangeRoleSchema>;

/** `grantId` makes a retry harmless, as `openId` does for a pack open. Negative adjusts down. */
export const GrantCurrencySchema = z.strictObject({
  grantId: z.uuid(),
  amount: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((amount) => amount !== 0, 'amount must not be zero'),
  reason: z.string().trim().min(1).max(500),
});
export type GrantCurrency = z.infer<typeof GrantCurrencySchema>;

export const GrantResultSchema = z.object({
  userId: UserIdSchema,
  balance: z.number().int().min(0),
  transaction: z.object({
    id: CurrencyTransactionIdSchema,
    amount: z.number().int(),
    createdAt: z.coerce.date(),
  }),
});
export type GrantResult = z.infer<typeof GrantResultSchema>;

export const SuspendUserSchema = z.strictObject({ reason: z.string().trim().min(1).max(500) });
export type SuspendUser = z.infer<typeof SuspendUserSchema>;
```

- [ ] **Step 2: Write the service with list and role change.** Create `apps/api/src/admin-users/admin-users.service.ts`:

```ts
import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, Role } from '@prisma/client';
import {
  AdminUserPageSchema,
  AdminUserRowSchema,
  ERROR_CODES,
  type AdminUserListQuery,
  type AdminUserPage,
  type AdminUserRow,
} from '@pokedrop/shared';
import { AuditService } from '../audit/index.js';
import { domainError } from '../common/errors/domain-error.js';
import type { AuthUser } from '../common/request-auth.js';
import { PrismaService, type TransactionClient } from '../prisma/index.js';

const ROW_SELECT = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  role: true,
  currency: true,
  emailVerified: true,
  suspendedAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: AdminUserListQuery): Promise<AdminUserPage> {
    const q = query.q === undefined ? undefined : escapeLike(query.q);
    const where: Prisma.UserWhereInput = {
      ...(q === undefined
        ? {}
        : {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { displayName: { contains: q, mode: 'insensitive' } },
            ],
          }),
      ...(query.role === undefined ? {} : { role: query.role }),
      ...(query.suspended === undefined
        ? {}
        : { suspendedAt: query.suspended ? { not: null } : null }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: ROW_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);

    return AdminUserPageSchema.parse({
      items: rows,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    });
  }

  async changeRole(admin: AuthUser, id: string, role: Role): Promise<AdminUserRow> {
    this.assertNotSelf(admin, id);

    await this.prisma.withTransaction(async (tx) => {
      const target = await this.target(tx, id);
      if (target.role === role) {
        return;
      }
      if (target.role === 'ADMIN' && target.suspendedAt === null) {
        await this.assertNotLastAdmin(tx, id);
      }
      await tx.user.update({ where: { id }, data: { role } });
      await this.audit.record(tx, {
        actorId: admin.id,
        action: 'user.role_change',
        entity: 'User',
        entityId: id,
        meta: { from: target.role, to: role },
      });
    });

    return this.row(id);
  }

  private assertNotSelf(admin: AuthUser, id: string): void {
    if (admin.id === id) {
      throw domainError(
        HttpStatus.FORBIDDEN,
        ERROR_CODES.SELF_TARGET,
        'An admin cannot do this to their own account',
      );
    }
  }

  private async target(tx: TransactionClient, id: string) {
    const target = await tx.user.findUnique({
      where: { id },
      select: { id: true, role: true, suspendedAt: true },
    });
    if (target === null) {
      throw new NotFoundException('User not found');
    }
    return target;
  }

  /**
   * Locks every active admin in id order before counting them. A concurrent
   * change waits here, and once the first commits PostgreSQL re-checks the
   * waiting rows against the WHERE, so it counts what is really left.
   */
  private async assertNotLastAdmin(tx: TransactionClient, targetId: string): Promise<void> {
    const admins = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users
      WHERE role = 'ADMIN' AND "suspendedAt" IS NULL
      ORDER BY id
      FOR UPDATE`;
    if (admins.length <= 1 && admins.some((admin) => admin.id === targetId)) {
      throw domainError(
        HttpStatus.CONFLICT,
        ERROR_CODES.LAST_ADMIN,
        'This would leave no active admin',
      );
    }
  }

  private async row(id: string): Promise<AdminUserRow> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: ROW_SELECT });
    return AdminUserRowSchema.parse(row);
  }
}

/**
 * Prisma passes `contains` to ILIKE unescaped: measured, `_` matched every
 * user and `pokedrop_test` matched `pokedrop.test`. Backslash is ILIKE's
 * default escape character.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
```

- [ ] **Step 3: Controller, DTOs, module, wiring.**

`apps/api/src/admin-users/admin-users.dto.ts`:

```ts
import {
  AdminUserListQuerySchema,
  ChangeRoleSchema,
  GrantCurrencySchema,
  SuspendUserSchema,
} from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

export class AdminUserListQueryDto extends createZodDto(
  'AdminUserListQuery',
  AdminUserListQuerySchema,
) {}

export class ChangeRoleDto extends createZodDto('ChangeRole', ChangeRoleSchema) {}

export class GrantCurrencyDto extends createZodDto('GrantCurrency', GrantCurrencySchema) {}

export class SuspendUserDto extends createZodDto('SuspendUser', SuspendUserSchema) {}
```

`apps/api/src/admin-users/admin-users.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AdminUserPage, AdminUserRow } from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { AdminUserListQueryDto, ChangeRoleDto } from './admin-users.dto.js';
import { AdminUsersService } from './admin-users.service.js';

@ApiTags('admin')
@Roles(['ADMIN'])
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  list(@Query() query: AdminUserListQueryDto): Promise<AdminUserPage> {
    return this.users.list(query);
  }

  @Patch(':id/role')
  changeRole(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() body: ChangeRoleDto,
  ): Promise<AdminUserRow> {
    return this.users.changeRole(admin, id, body.role);
  }
}
```

`apps/api/src/admin-users/admin-users.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TradesCoreModule } from '../trades/index.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';

@Module({
  imports: [TradesCoreModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService],
})
export class AdminUsersModule {}
```

`apps/api/src/admin-users/index.ts`:

```ts
export { AdminUsersModule } from './admin-users.module.js';
```

In `apps/api/src/app.module.ts`, add `import { AdminUsersModule } from './admin-users/index.js';` with the other module imports and `AdminUsersModule,` directly after `AdminModule,` in `imports`.

Typecheck and lint as in Task 1, Step 6 (paths `apps/api/src/admin-users packages/shared/src`).

- [ ] **Step 4: Verify list and role change.** Start the API, then:

```bash
mkuser a1; mkuser a2; admin a1; admin a2; mkuser m1; mkuser m2; mkuser m3
$PSQL -c "update users set \"displayName\" = 'Misty Waterflower' where email = '$P-m2@example.com'"
A1=$(uid a1); A2=$(uid a2); M1=$(uid m1); M2=$(uid m2)
# List
req a1 GET "/admin/users?q=PD80-M" | grep -o '"total":[0-9]*'                          # 3: email matches, any case
req a1 GET "/admin/users?q=waterFLOWER" | grep -o '"email":"[^"]*"'                     # m2
req a1 GET "/admin/users?q=%25" | grep -o '"total":[0-9]*'                              # 0: % is literal
req a1 GET "/admin/users?q=pd80_" | grep -o '"total":[0-9]*'                            # 0: _ is literal
req a1 GET "/admin/users?q=%5C" | grep -o '"total":[0-9]*'                              # 0: \ is literal
req a1 GET "/admin/users?role=ADMIN&q=pd80" | grep -o '"total":[0-9]*'                  # 2
req a1 GET "/admin/users?q=pd80&pageSize=2&page=3" | grep -o '"page":3\|"totalPages":[0-9]*\|"items":\[[^]]\{0,20\}'
req a1 GET "/admin/users?suspended=maybe" | grep -o '|[0-9]*$'                          # 400
req m1 GET /admin/users | grep -o '|[0-9]*$'; req anon GET /admin/users | grep -o '|[0-9]*$'   # 403, 401
# Role change
req a1 PATCH /admin/users/$M1/role -d '{"role":"ADMIN"}' | grep -o '"role":"[A-Z]*"\||[0-9]*$' | tr '\n' ' '; echo   # ADMIN 200
req m1 GET /admin/users | grep -o '|[0-9]*$'                                            # 200 on its next request
req a1 PATCH /admin/users/$M1/role -d '{"role":"MEMBER"}' | grep -o '|[0-9]*$'          # 200
req m1 GET /admin/users | grep -o '|[0-9]*$'                                            # 403 at once, same cookie
req a1 PATCH /admin/users/$M1/role -d '{"role":"MEMBER"}' | grep -o '|[0-9]*$'          # 200, no-op
$PSQL -c "select count(*) from audit_logs where action = 'user.role_change' and \"entityId\" = '$M1'"   # 2
req a1 PATCH /admin/users/$A1/role -d '{"role":"MEMBER"}' | strip                       # 403 SELF_TARGET
req a1 PATCH /admin/users/nobody/role -d '{"role":"MEMBER"}' | strip                    # 404 User not found
req a1 PATCH /admin/users/$M1/role -d '{"role":"OWNER"}' | grep -o '|[0-9]*$'           # 400
# Last admin, concurrently: take the seed admin out of the count first, restore after.
$PSQL -c "update users set role = 'MEMBER' where email = 'admin@pokedrop.test'"
for i in 1 2 3 4 5; do
  req a1 PATCH /admin/users/$A2/role -d '{"role":"MEMBER"}' > "$S/r1.txt" & req a2 PATCH /admin/users/$A1/role -d '{"role":"MEMBER"}' > "$S/r2.txt" & wait
  echo "$(grep -o '|[0-9]*$' "$S/r1.txt") $(grep -o '|[0-9]*$' "$S/r2.txt") $(grep -o '"code":"[A-Z_]*"' "$S/r1.txt" "$S/r2.txt" | cut -d: -f2-) admins=$($PSQL -c "select count(*) from users where role='ADMIN' and \"suspendedAt\" is null")"
  $PSQL -c "update users set role = 'ADMIN' where id in ('$A1','$A2')" >/dev/null
done
$PSQL -c "update users set role = 'ADMIN' where email = 'admin@pokedrop.test'"
```

Expected: as commented; in the loop every line one `|200` and one `|409` with `"LAST_ADMIN"`, and `admins=1`. Then `cleanup`, `checks`, stop the API.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/entities/user.ts apps/api/src/admin-users apps/api/src/app.module.ts
git commit -m "[PD-80]: list users and change roles, never the last admin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Currency grants

**Files:**
- Modify: `apps/api/src/admin-users/admin-users.service.ts`
- Modify: `apps/api/src/admin-users/admin-users.controller.ts`

**Interfaces:**
- Consumes: `GrantCurrency`, `GrantResult`, `GrantResultSchema` (Task 2); `NotificationsService.notify(entries)` with `{ type: 'currency.granted', payload: { amount } }`; `isUniqueViolation(error)` from `common/errors/prisma-error.js`.
- Produces: `AdminUsersService.grant(admin, id, body): Promise<GrantResult>`; route `POST /admin/users/:id/currency`.

- [ ] **Step 1: Add `grant` and its replay.** In `admin-users.service.ts`, extend the imports:

```ts
import {
  AdminUserPageSchema,
  AdminUserRowSchema,
  ERROR_CODES,
  GrantResultSchema,
  type AdminUserListQuery,
  type AdminUserPage,
  type AdminUserRow,
  type GrantCurrency,
  type GrantResult,
} from '@pokedrop/shared';
import { isUniqueViolation } from '../common/errors/prisma-error.js';
import { NotificationsService } from '../notifications/index.js';
```

Add `private readonly notifications: NotificationsService,` to the constructor, and these methods to the class:

```ts
  /**
   * The ledger row is the first write, keyed by grantId, so a replay stops on
   * the unique index before it can touch the balance.
   */
  async grant(admin: AuthUser, id: string, body: GrantCurrency): Promise<GrantResult> {
    let result: GrantResult;
    try {
      result = await this.prisma.withTransaction(async (tx) => {
        await this.target(tx, id);
        const entry = await tx.currencyTransaction.create({
          data: { userId: id, amount: body.amount, type: 'GRANT', refId: body.grantId },
          select: { id: true, amount: true, createdAt: true },
        });
        const updated = await tx.$queryRaw<{ currency: number }[]>`
          UPDATE users SET currency = currency + ${body.amount}
          WHERE id = ${id} AND currency + ${body.amount} >= 0
          RETURNING currency`;
        const balance = updated[0]?.currency;
        if (balance === undefined) {
          throw domainError(
            HttpStatus.CONFLICT,
            ERROR_CODES.INSUFFICIENT_FUNDS,
            'This would take the balance below zero',
          );
        }
        await this.audit.record(tx, {
          actorId: admin.id,
          action: 'user.currency_grant',
          entity: 'User',
          entityId: id,
          meta: { grantId: body.grantId, amount: body.amount, reason: body.reason },
        });
        return GrantResultSchema.parse({ userId: id, balance, transaction: entry });
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      return this.replayGrant(id, body);
    }

    await this.notifications.notify([
      { userId: id, type: 'currency.granted', payload: { amount: body.amount } },
    ]);
    return result;
  }

  private async replayGrant(id: string, body: GrantCurrency): Promise<GrantResult> {
    const entry = await this.prisma.currencyTransaction.findFirstOrThrow({
      where: { userId: id, type: 'GRANT', refId: body.grantId },
      select: { id: true, amount: true, createdAt: true },
    });
    if (entry.amount !== body.amount) {
      throw domainError(
        HttpStatus.CONFLICT,
        ERROR_CODES.GRANT_ID_CONFLICT,
        'This grantId was already used for a different amount',
      );
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: { currency: true },
    });
    return GrantResultSchema.parse({ userId: id, balance: user.currency, transaction: entry });
  }
```

- [ ] **Step 2: Add the route.** In `admin-users.controller.ts`, extend the imports (`HttpCode`, `HttpStatus`, `Post` from `@nestjs/common`; `GrantResult` from `@pokedrop/shared`; `GrantCurrencyDto` from `./admin-users.dto.js`) and add:

```ts
  /** 200 for the first request and a replay alike, as a pack open answers. */
  @HttpCode(HttpStatus.OK)
  @Post(':id/currency')
  grant(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() body: GrantCurrencyDto,
  ): Promise<GrantResult> {
    return this.users.grant(admin, id, body);
  }
```

Typecheck and lint.

- [ ] **Step 3: Verify grants.** Start the API, then:

```bash
mkuser a1; admin a1; mkuser m; M=$(uid m); G=$(uuid)
checks
req a1 POST /admin/users/$M/currency -d "{\"grantId\":\"$G\",\"amount\":500,\"reason\":\"probe\"}" | strip                  # 200, balance 500
req a1 POST /admin/users/$M/currency -d "{\"grantId\":\"$G\",\"amount\":500,\"reason\":\"probe\"}" | strip                  # 200, identical body
$PSQL -c "select count(*), sum(amount) from currency_transactions where \"userId\" = '$M' and \"refId\" = '$G'"             # 1|500
$PSQL -c "select count(*) from audit_logs where action = 'user.currency_grant' and \"entityId\" = '$M'"                      # 1
$PSQL -c "select type, payload from notifications where \"userId\" = '$M'"                                                  # one currency.granted {"amount": 500}
req m GET /notifications | grep -o '"type":"currency.granted","payload":{"amount":500}'
req m GET /wallet | grep -o '"source":{"kind":"grant"}\|"balance":500'
req a1 POST /admin/users/$M/currency -d "{\"grantId\":\"$G\",\"amount\":900,\"reason\":\"probe\"}" | strip                  # 409 GRANT_ID_CONFLICT
$PSQL -c "select md5(string_agg(id||amount, ',' order by id)) || (select currency from users where id = '$M') from currency_transactions where \"userId\" = '$M'" > "$S/g0.txt"
req a1 POST /admin/users/$M/currency -d "{\"grantId\":\"$(uuid)\",\"amount\":-10000,\"reason\":\"probe\"}" | strip        # 409 INSUFFICIENT_FUNDS
$PSQL -c "select md5(string_agg(id||amount, ',' order by id)) || (select currency from users where id = '$M') from currency_transactions where \"userId\" = '$M'" | diff - "$S/g0.txt" && echo identical
req a1 POST /admin/users/$M/currency -d "{\"grantId\":\"$(uuid)\",\"amount\":-200,\"reason\":\"probe\"}" | grep -o '"balance":[0-9]*'   # 300
req a1 POST /admin/users/nobody/currency -d "{\"grantId\":\"$(uuid)\",\"amount\":5,\"reason\":\"probe\"}" | strip           # 404
for body in '{"grantId":"x","amount":5,"reason":"r"}' "{\"grantId\":\"$(uuid)\",\"amount\":0,\"reason\":\"r\"}" "{\"grantId\":\"$(uuid)\",\"amount\":5,\"reason\":\"  \"}" "{\"grantId\":\"$(uuid)\",\"amount\":5,\"reason\":\"r\",\"type\":\"TRADE\"}" "{\"grantId\":\"$(uuid)\",\"amount\":1000001,\"reason\":\"r\"}"; do req a1 POST /admin/users/$M/currency -d "$body" | grep -o '|[0-9]*$'; done   # 400 x5
req a1 POST /admin/users/$(uid a1)/currency -d "{\"grantId\":\"$(uuid)\",\"amount\":5,\"reason\":\"self\"}" | grep -o '|[0-9]*$'   # 200: self-grants allowed
# Review focus: a grant to a suspended user still works and still notifies.
$PSQL -c "update users set \"suspendedAt\" = now() where id = '$M'"
req a1 POST /admin/users/$M/currency -d "{\"grantId\":\"$(uuid)\",\"amount\":50,\"reason\":\"probe\"}" | grep -o '"balance":[0-9]*\||[0-9]*$' | tr '\n' ' '; echo   # 350 200
$PSQL -c "select count(*) from notifications where \"userId\" = '$M' and type = 'currency.granted'"                          # 3
# Rollback: a failing audit insert leaves no ledger row and the balance alone.
$PSQL -c "create function pd80_fail() returns trigger language plpgsql as \$\$ begin raise exception 'pd80 injected'; end \$\$; create trigger pd80_fail before insert on audit_logs for each row execute function pd80_fail();"
req a1 POST /admin/users/$M/currency -d "{\"grantId\":\"$(uuid)\",\"amount\":70,\"reason\":\"probe\"}" | grep -o '|[0-9]*$'   # 500
$PSQL -c "drop trigger pd80_fail on audit_logs; drop function pd80_fail();"
$PSQL -c "select currency, (select count(*) from currency_transactions where \"userId\" = '$M') from users where id = '$M'"   # 350|5
checks
```

Expected as commented; `checks` prints `ledger-mismatch 0`. Then `cleanup`, stop the API.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/admin-users
git commit -m "[PD-80]: grant or adjust currency once per grantId, with a ledger row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Suspend and unsuspend

**Files:**
- Modify: `apps/api/src/admin-users/admin-users.service.ts`
- Modify: `apps/api/src/admin-users/admin-users.controller.ts`

**Interfaces:**
- Consumes: `TradeCloseService.close(tx, trade, { to: 'VOIDED', action: 'trade.void', actorId, release: true, meta })` and `TRADE_SELECT`/`TradeRow` from `apps/api/src/trades/`; `assertNotSelf`, `target`, `assertNotLastAdmin`, `row` (Task 2).
- Produces: `AdminUsersService.suspend(admin, id, reason)`, `AdminUsersService.unsuspend(admin, id)`; routes `POST /admin/users/:id/suspend`, `POST /admin/users/:id/unsuspend`.

- [ ] **Step 1: Export the trade pieces this needs.** `apps/api/src/trades/index.ts` becomes:

```ts
export { TradeCloseService } from './trade-close.service.js';
export { TradeExpiryModule } from './trade-expiry.module.js';
export { TRADE_SELECT, type TradeRow } from './trade-row.js';
export { TradesCoreModule } from './trades-core.module.js';
export { TradesModule } from './trades.module.js';
```

- [ ] **Step 2: Add `suspend` and `unsuspend`.** In `admin-users.service.ts`, add imports:

```ts
import { HttpException } from '@nestjs/common';
import { TRADE_SELECT, TradeCloseService, type TradeRow } from '../trades/index.js';
```

(merge `HttpException` into the existing `@nestjs/common` import), add `private readonly closer: TradeCloseService,` to the constructor, and add to the class:

```ts
  /**
   * Trades are closed before `users` is touched: an accept takes the trade's
   * row and then the user rows, and taking them in the same order here makes
   * the two queue instead of deadlocking.
   */
  async suspend(admin: AuthUser, id: string, reason: string): Promise<AdminUserRow> {
    this.assertNotSelf(admin, id);

    let voided: TradeRow[] = [];
    try {
      voided = await this.prisma.withTransaction(async (tx) => {
        const target = await this.target(tx, id);
        if (target.suspendedAt !== null) {
          throw new Unchanged();
        }

        const pending = await tx.trade.findMany({
          where: { status: 'PENDING', OR: [{ initiatorId: id }, { recipientId: id }] },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: TRADE_SELECT,
        });
        const closed: TradeRow[] = [];
        for (const trade of pending) {
          try {
            await this.closer.close(tx, trade, {
              to: 'VOIDED',
              action: 'trade.void',
              actorId: admin.id,
              release: true,
              meta: { reason: 'account suspended' },
            });
            closed.push(trade);
          } catch (error) {
            if (codeOf(error) !== ERROR_CODES.TRADE_NOT_PENDING) {
              throw error;
            }
          }
        }

        if (target.role === 'ADMIN') {
          await this.assertNotLastAdmin(tx, id);
        }
        const { count } = await tx.user.updateMany({
          where: { id, suspendedAt: null },
          data: { suspendedAt: new Date() },
        });
        if (count === 0) {
          throw new Unchanged();
        }
        await tx.session.deleteMany({ where: { userId: id } });
        await this.audit.record(tx, {
          actorId: admin.id,
          action: 'user.suspend',
          entity: 'User',
          entityId: id,
          meta: { reason, voidedTradeIds: closed.map((trade) => trade.id) },
        });
        return closed;
      });
    } catch (error) {
      if (!(error instanceof Unchanged)) {
        throw error;
      }
    }

    await this.notifications.notify(
      voided.flatMap((trade) =>
        [trade.initiatorId, trade.recipientId].map((userId) => ({
          userId,
          type: 'trade.voided' as const,
          payload: { tradeId: trade.id },
        })),
      ),
    );
    return this.row(id);
  }

  async unsuspend(admin: AuthUser, id: string): Promise<AdminUserRow> {
    this.assertNotSelf(admin, id);

    await this.prisma.withTransaction(async (tx) => {
      await this.target(tx, id);
      const { count } = await tx.user.updateMany({
        where: { id, suspendedAt: { not: null } },
        data: { suspendedAt: null },
      });
      if (count === 0) {
        return;
      }
      await this.audit.record(tx, {
        actorId: admin.id,
        action: 'user.unsuspend',
        entity: 'User',
        entityId: id,
        meta: {},
      });
    });

    return this.row(id);
  }
```

At the bottom of the file, outside the class:

```ts
/** Thrown to roll back a suspension that finds the account already suspended. */
class Unchanged extends Error {}

function codeOf(error: unknown): unknown {
  if (!(error instanceof HttpException)) {
    return undefined;
  }
  const response = error.getResponse();
  return typeof response === 'object' && response !== null && 'code' in response
    ? response.code
    : undefined;
}
```

- [ ] **Step 3: Add the routes.** In `admin-users.controller.ts`, import `SuspendUserDto` and add:

```ts
  @HttpCode(HttpStatus.OK)
  @Post(':id/suspend')
  suspend(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() body: SuspendUserDto,
  ): Promise<AdminUserRow> {
    return this.users.suspend(admin, id, body.reason);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/unsuspend')
  unsuspend(@CurrentUser() admin: AuthUser, @Param('id') id: string): Promise<AdminUserRow> {
    return this.users.unsuspend(admin, id);
  }
```

Typecheck and lint.

- [ ] **Step 4: Verify suspension.** Start the API, then:

```bash
mkuser a1; mkuser a2; admin a1; admin a2; mkuser m; mkuser n; M=$(uid m); N=$(uid n); A1=$(uid a1); A2=$(uid a2)
curl -s -o /dev/null -c "$S/jar-m2.txt" -X POST "$AUTH/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $WEB" -d "{\"email\":\"$P-m@example.com\",\"password\":\"correct-horse-battery\"}"
give m base1-4 1; give n base1-2 1
T1=$(req m POST /trades -d "{\"recipientId\":\"$N\",\"offered\":[{\"cardId\":\"base1-4\",\"quantity\":1}]}" | idof)
T2=$(req n POST /trades -d "{\"recipientId\":\"$M\",\"offered\":[{\"cardId\":\"base1-2\",\"quantity\":1}]}" | idof)
held m base1-4; held n base1-2                                                        # 1/1 1/1
$PSQL -c "select count(*) from sessions where \"userId\" = '$M'"                      # 2
req a1 POST /admin/users/$M/suspend -d '{"reason":"probe"}' | grep -o '"suspendedAt":"[^"]*"\||[0-9]*$' | tr '\n' ' '; echo   # set, 200
req m GET /users/me | strip; req m2 GET /wallet | strip                               # 403 ACCOUNT_SUSPENDED twice
curl -s -b "$S/jar-m.txt" "$AUTH/get-session"; echo                                   # null
curl -s -w ' |%{http_code}\n' -X POST "$AUTH/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $WEB" -d "{\"email\":\"$P-m@example.com\",\"password\":\"correct-horse-battery\"}"   # 403 ACCOUNT_SUSPENDED
req anon GET /users/$M | grep -o '|[0-9]*$'                                           # 200
$PSQL -c "select id, status from trades where id in ('$T1','$T2') order by id"        # both VOIDED
held m base1-4; held n base1-2                                                        # 1/0 1/0
$PSQL -c "select \"entityId\", action, meta->>'reason' from audit_logs where \"entityId\" in ('$T1','$T2') and action = 'trade.void'"   # two rows
$PSQL -c "select meta from audit_logs where action = 'user.suspend' and \"entityId\" = '$M'"            # reason + both trade ids
$PSQL -c "select \"userId\", payload->>'tradeId' from notifications where type = 'trade.voided' and payload->>'tradeId' in ('$T1','$T2') order by 2, 1"   # four rows
req a1 POST /admin/users/$M/suspend -d '{"reason":"again"}' | grep -o '|[0-9]*$'     # 200
$PSQL -c "select count(*) from audit_logs where action = 'user.suspend' and \"entityId\" = '$M'"        # still 1
req a1 POST /admin/users/$A1/suspend -d '{"reason":"self"}' | strip                   # 403 SELF_TARGET
req a1 POST /admin/users/nobody/suspend -d '{"reason":"x"}' | strip                   # 404
req a1 POST /admin/users/nobody/unsuspend | strip                                     # 404
req a1 POST /admin/users/$N/suspend -d '{}' | grep -o '|[0-9]*$'                      # 400
# Unsuspend
req a1 POST /admin/users/$M/unsuspend | grep -o '"suspendedAt":null\||[0-9]*$' | tr '\n' ' '; echo   # null 200
signin m; req m GET /users/me | grep -o '|[0-9]*$'                                    # 200, 200
$PSQL -c "select status from trades where id = '$T1'"                                 # VOIDED
req a1 POST /admin/users/$M/unsuspend | grep -o '|[0-9]*$'                            # 200, no-op
$PSQL -c "select count(*) from audit_logs where action = 'user.unsuspend' and \"entityId\" = '$M'"      # 1
# Last admin via suspension, concurrently, with the seed admin out of the count.
$PSQL -c "update users set role = 'MEMBER' where email = 'admin@pokedrop.test'"
req a1 POST /admin/users/$A2/suspend -d '{"reason":"x"}' > "$S/r1.txt" & req a2 POST /admin/users/$A1/suspend -d '{"reason":"x"}' > "$S/r2.txt" & wait
grep -o '|[0-9]*$\|"code":"[A-Z_]*"' "$S/r1.txt" "$S/r2.txt"; checks                 # one 200, one 409 LAST_ADMIN; active-admins 1
$PSQL -c "update users set \"suspendedAt\" = null where id in ('$A1','$A2'); update users set role = 'ADMIN' where email = 'admin@pokedrop.test'"
signin a1; signin a2
# Review focus: a suspension racing an accept of the same user's trade, five times.
for i in 1 2 3 4 5; do
  give n base1-2 1; T=$(req n POST /trades -d "{\"recipientId\":\"$M\",\"offered\":[{\"cardId\":\"base1-2\",\"quantity\":1}]}" | idof)
  req m POST /trades/$T/accept > "$S/r1.txt" & req a1 POST /admin/users/$M/suspend -d '{"reason":"race"}' > "$S/r2.txt" & wait
  echo "accept $(grep -o '|[0-9]*$' "$S/r1.txt") suspend $(grep -o '|[0-9]*$' "$S/r2.txt") trade $($PSQL -c "select status from trades where id = '$T'") $(checks | tr '\n' ' ')"
  req a1 POST /admin/users/$M/unsuspend >/dev/null; signin m >/dev/null
done
# Rollback: a failing audit insert leaves nothing suspended.
give n base1-2 1; T3=$(req n POST /trades -d "{\"recipientId\":\"$M\",\"currencyFromRecipient\":0,\"offered\":[{\"cardId\":\"base1-2\",\"quantity\":1}]}" | idof)
$PSQL -c "create function pd80_fail() returns trigger language plpgsql as \$\$ begin if new.action = 'user.suspend' then raise exception 'pd80 injected'; end if; return new; end \$\$; create trigger pd80_fail before insert on audit_logs for each row execute function pd80_fail();"
req a1 POST /admin/users/$N/suspend -d '{"reason":"rollback"}' | grep -o '|[0-9]*$'   # 500
$PSQL -c "drop trigger pd80_fail on audit_logs; drop function pd80_fail();"
$PSQL -c "select \"suspendedAt\" is null, (select count(*) from sessions where \"userId\" = '$N'), (select status from trades where id = '$T3') from users where id = '$N'"   # t|1|PENDING
held n base1-2                                                                        # lock still held
checks
```

Expected as commented. In the race loop each line is either `accept |200 suspend |200 trade ACCEPTED` (accept first; the suspension then found nothing pending) or `accept |403/|409 suspend |200 trade VOIDED`, with `ledger-mismatch 0 unreconciled 0` every time; a `|500` on either side is a detected deadlock and must leave the trade `PENDING` or in one of the two outcomes, never a lock mismatch. Then `cleanup`, `checks`, stop the API.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/trades/index.ts apps/api/src/admin-users
git commit -m "[PD-80]: suspend and unsuspend, voiding the user's pending trades

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Documentation

**Files:**
- Modify: `docs/API.md` (Users / Profile table; new `## Admin / Users` section before `## Admin / Sync`)
- Modify: `docs/DataModel.md` (User)
- Modify: `apps/api/src/auth/README.md`

- [ ] **Step 1: `docs/API.md`.** In the Users / Profile table, replace the two admin rows with:

```markdown
| GET | `/admin/users` | admin | Search and page every account — see [Admin / Users](#admin--users) |
| POST | `/admin/users/:id/currency` | admin | Grant or adjust currency, once per `grantId` |
| PATCH | `/admin/users/:id/role` | admin | Promote/demote; never the last active admin |
| POST | `/admin/users/:id/suspend` | admin | Suspend, ending every session and voiding pending trades |
| POST | `/admin/users/:id/unsuspend` | admin | Lift a suspension |
```

Add an `## Admin / Users` section before `## Admin / Sync` covering, in the style of the Trades and Wallet sections: the list query and row; the grant body, its ledger-first order, the replay and `GRANT_ID_CONFLICT`, the 409 below zero; role change with `SELF_TARGET`, the no-op, and the last-admin lock (why it counts active admins, why it locks in id order, and that it matters only concurrently); suspension's three enforcement points and why the guard is not redundant, its transaction order and why, the voided trades, `ACCOUNT_SUSPENDED` on routes and on sign-in, public routes served anonymously, the public profile still visible; unsuspend restoring only sign-in; the accepted boundary (an in-flight proposal); and a **Measured, <date>** list with the actual results of Tasks 1–4's probes — counts, codes and timings as observed, not as expected.

- [ ] **Step 2: `docs/DataModel.md`.** Add `suspendedAt` to the User field line and a paragraph: declared to Better Auth with `input: false` so it reaches `session.user` without a query and no sign-up can set it; null means active; enforced three ways (link to API.md, Admin / Users).

- [ ] **Step 3: `apps/api/src/auth/README.md`.** Under the endpoints, one paragraph: the `databaseHooks.session.create.before` hook refuses a session for a suspended user with 403 `ACCOUNT_SUSPENDED`, covering every path that creates one.

- [ ] **Step 4: Format check and commit**

```bash
npx prettier --check docs/API.md docs/DataModel.md apps/api/src/auth/README.md
git add docs/API.md docs/DataModel.md apps/api/src/auth/README.md
git commit -m "[PD-80]: document admin user management and what it measured

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Linear.** Mark PD-80 Done. Leave PD-79 open for its remainder (sync triggers with PD-81, the read-exemption decision, documentation).
