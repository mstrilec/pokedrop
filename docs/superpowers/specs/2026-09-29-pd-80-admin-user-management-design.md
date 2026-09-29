# PD-80 — Admin user management: grants, roles, suspension

Design, 2026-09-29. Milestone M9 · Users, Wallet & Notifications.

Ticket: [PD-80](https://linear.app/mstrilec/issue/PD-80/admin-user-management-currency-grants-role-changes-suspension).
It also carries the part of [PD-79](https://linear.app/mstrilec/issue/PD-79/auditlog-writer-for-admin-and-sensitive-actions)
that concerns these actions — their audit rows — and emits the `currency.granted` kind
[PD-78](https://linear.app/mstrilec/issue/PD-78/notifications-module-and-api) defined.
Reference: `docs/API.md` (Users / Profile, admin rows) · `docs/PRD.md` §4, §5.8 ·
`docs/DataModel.md` (User, CurrencyTransaction, AuditLog) · `apps/api/src/auth/README.md`.

---

## What the ticket asks

| Scope item | Where it lands |
| --- | --- |
| `POST /admin/users/:id/currency` — grant or adjust, with a `GRANT` ledger row in the same transaction | [Grant](#grant) |
| `PATCH /admin/users/:id/role` — promote or demote | [Role change](#role-change) |
| Suspend / unsuspend, suspended users blocked at the auth guard | [Suspension](#suspension), [Enforcement](#enforcement) |
| Paginated, searchable user list | [User list](#user-list) |
| Every action audit-logged; an admin cannot demote or suspend themselves | each flow; [Self-targeting](#self-targeting) |

| Acceptance criterion | How it is met |
| --- | --- |
| A currency grant is always accompanied by a ledger row | The ledger row is the grant's first write; the balance update follows in the same transaction |
| A suspended user's existing sessions stop working immediately | Their sessions are deleted in the suspending transaction, and `SessionGuard` refuses any session whose user is suspended |
| The last remaining admin cannot be demoted | Every change that can remove an active admin locks all active admin rows first |

## Measured before designing

- **Sessions are read from the database on every request.** `buildAuth` sets no `cookieCache` and no `secondaryStorage`, so `auth.api.getSession` loads the session row and its user each time. A deleted session is gone on the next request; a changed `role` or `suspendedAt` is seen on the next request.
- **Better Auth's admin plugin bans through `databaseHooks.session.create.before`** (`better-auth@1.7.5/dist/plugins/admin/admin.mjs:33-49`): the hook loads the user and throws `APIError FORBIDDEN` if they are banned, which refuses the sign-in. The same hook is available without the plugin.
- **`users_currency_non_negative`** (PD-58) already makes a negative balance impossible at the schema level.
- **`(userId, type, refId)` is unique on the ledger** — the idempotency key PD-58 uses for pack opens.
- **`TradeCloseService.close(tx, trade, options)`** runs in the caller's transaction and throws `TRADE_NOT_PENDING` from JavaScript (not from SQL) when its guarded update finds the trade already closed, so the caller's transaction survives catching it.

## Decisions

1. **Suspension is our own column, not Better Auth's admin plugin.** The plugin brings its own role values (`user`/`admin` against our `MEMBER`/`ADMIN`), `banned`/`banReason`/`banExpires` columns, and impersonation and user-creation endpoints this product does not want. It is the hook, not the plugin, that does the work.
2. **Suspension is enforced three ways, and all three are needed:**
   - its transaction deletes the user's sessions, so existing sessions stop at once;
   - the session-creation hook refuses a new session, so sign-in fails;
   - `SessionGuard` refuses a session whose user is suspended. This is not redundancy: a sign-in whose hook read the user just before the suspension committed can insert its session just after the suspension deleted the others. The guard is what closes that window.
3. **A suspended user gets 403 `ACCOUNT_SUSPENDED`** on a protected route and on sign-in. On a `@Public()` route they are served as anonymous.
4. **Suspending voids the user's pending trades in the same transaction**, as admin voids of pending trades: status `VOIDED`, the initiator's lock released, one `trade.void` audit row each. The counterparty can no longer accept an offer from a suspended account.
5. **Grants are idempotent on a client `grantId` (UUID)**, stored as the `GRANT` row's `refId`, as `openId` is for pack opens. A replay returns the first result.
6. **Admins may grant to themselves.** The ticket forbids only self-demotion and self-suspension; a self-grant is audited like any other.
7. **The last-admin rule counts active admins** — `role = ADMIN AND suspendedAt IS NULL`. Suspending an admin removes one as surely as demoting them.
8. **A suspended user's public profile stays visible.** Suspension withdraws access, it does not erase.
9. **Unsuspending restores nothing but the ability to sign in.** Deleted sessions stay deleted; voided trades stay voided.

## Schema and contract changes

**Migration `user_suspension`:** `users."suspendedAt" TIMESTAMP(3) NULL`. No index — the admin list filters on it over a table this size, and the guard reads it from the row it already loads.

**Auth config:** `user.additionalFields.suspendedAt = { type: 'date', required: false, input: false }`. `input: false` for the same reason as `role`: without it, a sign-up body could set it. Declaring it is what puts it on `session.user`, so the guard needs no extra query.

**`ERROR_CODES`** gains `ACCOUNT_SUSPENDED`, `LAST_ADMIN`, `SELF_TARGET`, `GRANT_ID_CONFLICT`.

**`@pokedrop/shared`, new in `entities/user.ts`:**

- `AdminUserListQuerySchema` — `q` (trimmed, 1–100, optional), `role` (`MEMBER` | `ADMIN`, optional), `suspended` (`true` | `false`, optional), `page`, `pageSize` from `PaginationQuerySchema`.
- `AdminUserRowSchema` — `id, email, displayName, avatarUrl, role, currency, emailVerified, suspendedAt, createdAt`; `AdminUserPageSchema = pageOf(AdminUserRowSchema)`.
- `GrantCurrencySchema` — strict: `grantId` (UUID), `amount` (integer, non-zero, −1 000 000 … 1 000 000), `reason` (trimmed, 1–500).
- `GrantResultSchema` — `{ userId, balance, transaction: { id, amount, createdAt } }`.
- `ChangeRoleSchema` — strict `{ role }`.
- `SuspendUserSchema` — strict `{ reason }` (trimmed, 1–500).

## Components

- **`AdminUsersController`** (`apps/api/src/admin-users/`), `@Roles(['ADMIN'])` on the class, `@Controller('admin/users')`. Thin.
- **`AdminUsersService`** — list, grant, role change, suspend, unsuspend.
- **`lockActiveAdmins(tx)`** — a private helper: `SELECT id FROM users WHERE role = 'ADMIN' AND "suspendedAt" IS NULL ORDER BY id FOR UPDATE`. Used by role change and suspend.
- **`SessionGuard`** — one added branch.
- **`buildAuth`** — the additional field and the session-creation hook.

The module imports `TradesCoreModule` (for `TradeCloseService` and `NotificationsModule`) and `AuditModule` (global).

## The last-admin lock

Two admins, A and B. A demotes B while B demotes A. Without a lock each transaction counts two active admins, each demotes the other, and the product has none.

With `lockActiveAdmins` first in each transaction, whichever takes the locks first proceeds; the other waits on them. When the first commits, PostgreSQL re-evaluates the waiting `SELECT … FOR UPDATE` against the committed rows — at READ COMMITTED a row that no longer matches the `WHERE` is dropped from the result — so the second sees one active admin, the target itself, and answers 409 `LAST_ADMIN`.

The rule, applied after the lock: if the target is among the locked rows and the change would leave it inactive (demoted, or suspended), and it is the only locked row, refuse. Because an admin cannot target themselves, a lone admin can never be targeted at all; the lock exists for the concurrent case.

Locking in id order means two such transactions cannot deadlock on each other.

## The flows

### User list

`GET /admin/users` — `pageOf` rows, newest `createdAt` first, then `id`. `q` matches `email` or `displayName` case-insensitively (`contains`, `mode: 'insensitive'`); `role` and `suspended` filter exactly. A read, and not audited — see [PD-79's remainder](#pd-79s-remainder).

### Grant

`POST /admin/users/:id/currency`, body `GrantCurrencySchema`. In one transaction:

1. The target must exist → 404 `User not found`.
2. Insert the `GRANT` ledger row `{ userId, amount, type: GRANT, refId: grantId }`. It is the first write, so a replay stops here on the unique index before touching the balance.
3. `UPDATE users SET currency = currency + amount WHERE id = … AND currency + amount >= 0 RETURNING currency`. No row → 409 `INSUFFICIENT_FUNDS` "This would take the balance below zero"; everything rolls back.
4. Audit `user.currency_grant`, entity `User`, the target's id, `meta: { grantId, amount, reason }`, actor the admin.

After commit: notify the target `currency.granted { amount }`. Answer 200 with `GrantResultSchema` — 200 rather than 201 so a replay and the first request answer alike, as a pack open does.

**Replay:** a unique violation on step 2 rolls back, then reads the existing row for `(userId, GRANT, grantId)`. Same `amount` → 200 with that row and the current balance, no notification, no second audit row. Different `amount` → 409 `GRANT_ID_CONFLICT`. A replay against a different user is a different key and a new grant; a `grantId` is the client's to keep unique.

### Role change

`PATCH /admin/users/:id/role`, body `ChangeRoleSchema`.

1. Target is the caller → 403 `SELF_TARGET`, before any query.
2. In one transaction: load the target (404 if missing). Same role → return it unchanged, no audit row.
3. Demoting an active admin → `lockActiveAdmins`, apply the rule → 409 `LAST_ADMIN`.
4. Update `role`; audit `user.role_change`, `meta: { from, to }`.

Answer 200 with the target as an `AdminUserRow`. The change applies to the target's next request — role is read from the database each time.

### Suspension

`POST /admin/users/:id/suspend`, body `SuspendUserSchema`.

1. Target is the caller → 403 `SELF_TARGET`.
2. In one transaction:
   1. Load the target (404). Already suspended → return it unchanged, nothing written.
   2. Every `PENDING` trade with the target on either side, oldest first: `TradeCloseService.close(tx, trade, { to: 'VOIDED', action: 'trade.void', actorId: admin, release: true, meta: { reason: 'account suspended' } })`. A trade that a concurrent accept, decline or cancel closed first answers `TRADE_NOT_PENDING`; it is caught and skipped.
   3. Target is an active admin → `lockActiveAdmins`, apply the rule → 409 `LAST_ADMIN` (rolling back step 2).
   4. `UPDATE users SET "suspendedAt" = now()`.
   5. `DELETE FROM sessions WHERE "userId" = …`.
   6. Audit `user.suspend`, `meta: { reason, voidedTradeIds }`.

   **Why trades come first.** An accept takes the trade's row lock and then the user rows. Closing the trades before touching `users` takes locks in the same order, so a suspension and an accept of one of the target's trades queue rather than deadlock. Two orders can still cross — an accept of one trade holding user rows while the suspension, having released the same initiator's inventory for another, waits for it — and PostgreSQL resolves that by aborting one transaction, which answers 500 and changes nothing; the admin retries. It needs an accept by the same initiator's counterparty in the same moment as the suspension.
3. After commit: `trade.voided` to both parties of each voided trade.

Answer 200 with the target as an `AdminUserRow`.

`POST /admin/users/:id/unsuspend`: self-target is impossible in practice (a suspended admin has no session) but is checked the same way. In one transaction: load (404); not suspended → unchanged; clear `suspendedAt`; audit `user.unsuspend`, `meta: {}`. Answer 200.

### Enforcement

**Sign-in.** `databaseHooks.session.create.before(session)` loads the user by `session.userId`; if `suspendedAt` is set it throws `APIError('FORBIDDEN', { message: 'This account is suspended', code: 'ACCOUNT_SUSPENDED' })`. It covers every path that creates a session, not only email sign-in.

**Every request.** In `SessionGuard`, when a session is found and `session.user.suspendedAt` is set: on a `@Public()` route, do not set the auth context — the caller is anonymous; otherwise throw 403 with `code: ACCOUNT_SUSPENDED`. Nothing else in the guard changes.

**Better Auth's own routes** (`/api/auth/*`) are not behind `SessionGuard`. After a suspension they see no session because the sessions were deleted; the one case they could see is the race-created session from Decision 2, which `get-session` would still report until it expires, while every `/api/v1` route refuses it.

### Self-targeting

Role change, suspend and unsuspend compare `:id` with the caller's id before anything else and answer 403 `SELF_TARGET`. Grants do not (Decision 6).

## PD-79's remainder

This ticket wires `user.currency_grant`, `user.role_change`, `user.suspend` and `user.unsuspend`, each written in the transaction of its action, so a rolled-back action leaves no row. What PD-79 still owns after this: the sync triggers (which arrive with PD-81 in M10), the decision that admin reads are not audited, and its documentation.

## Accepted boundary

A trade proposal already in flight when a suspension commits can commit just after it, leaving one `PENDING` trade from a suspended user. The trade core does not re-check suspension, and adding that check to every trade path is out of scope. That trade is closed by an admin void or, at the latest, by the expiry job after `TRADE_EXPIRY_DAYS`.

## Verification plan

Through HTTP with the API running, the database checked after each step, and the ledger reconciliation (`currency` equals the ledger sum for every user) run after every scenario. Probe users are prefixed `pd80-` and removed at the end.

1. **List:** three members and two admins; `q` by part of an email and of a display name, in the wrong case; `role=ADMIN`; `suspended=true`; paging; a member on the route → 403; signed out → 401.
2. **Grant:** +500 → 201, one `GRANT` row with the `grantId`, balance +500, one audit row, one `currency.granted` notification with `{ amount: 500 }`, the wallet showing it as `grant`. The same body again → 200, identical, still one row, one audit row, one notification. The same `grantId` with another amount → 409 `GRANT_ID_CONFLICT`. −10 000 against 500 → 409 `INSUFFICIENT_FUNDS`, database byte-identical. −200 → balance 300. Unknown user → 404. `amount: 0`, a non-UUID `grantId`, an extra key → 400.
3. **Role:** promote a member → the next request by them to an admin route is 200; demote them → 403 again. Self-demotion → 403 `SELF_TARGET`. Same role → 200 and no audit row.
4. **Last admin, concurrently:** two admins demote each other at the same time, repeated five times after re-promoting → each time one 200, one 409 `LAST_ADMIN`, exactly one admin left, one `user.role_change` row. The same with each suspending the other.
5. **Suspension:** a member signed in on two cookie jars, with a pending trade they proposed (a card locked) and one they received. Suspend → 200; both jars' next `/api/v1` request → 403 `ACCOUNT_SUSPENDED`; `get-session` → null; sign-in → 403 with `ACCOUNT_SUSPENDED`; their public profile still 200; both trades `VOIDED`, the lock released, a `trade.void` audit row each, `trade.voided` to both parties of each; one `user.suspend` row listing both trade ids. Suspend again → 200, nothing new written. Self-suspension → 403.
6. **Unsuspend:** 200; sign-in works again; the trades stay `VOIDED`.
7. **Rollback:** a trigger failing inserts into `audit_logs` during a suspension → 500; the user not suspended, the sessions still there, the trades still `PENDING` with their locks. The same for a grant → no ledger row, balance unchanged.
8. **The race:** a guard branch cannot be driven through HTTP timing reliably, so it is shown directly — a session row inserted by hand for a suspended user → 403 on `/api/v1`, anonymous on a public route.

## Files

- `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<ts>_user_suspension/`
- `packages/shared/src/primitives/error.ts`, `packages/shared/src/entities/user.ts`
- `apps/api/src/auth/auth.factory.ts`, `apps/api/src/common/guards/session.guard.ts`
- `apps/api/src/admin-users/` — `admin-users.controller.ts`, `admin-users.service.ts`, `admin-users.dto.ts`, `admin-users.module.ts`, `index.ts`
- `apps/api/src/app.module.ts`
- `docs/API.md` (Users / Profile admin rows and a new Admin / Users section), `docs/DataModel.md` (User), `apps/api/src/auth/README.md`

## Out of scope

- Account deletion or anonymisation — the ticket's own note: suspension, not deletion.
- Timed suspensions (`suspendedUntil`) and a stored reason column — the reason lives in the audit row.
- A suspension check inside the trade core (see [Accepted boundary](#accepted-boundary)).
- An audit-log read API — PD-123 will need one and no ticket owns it yet.
- Automated tests — deferred for v1.
