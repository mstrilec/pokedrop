# PD-123 — Trade moderation and the audit log

Design, 2026-10-07. Milestone M13 · Application Pages. The last M13 ticket.

Ticket: [PD-123](https://linear.app/mstrilec/issue/PD-123/admin-trade-moderation-and-audit-log-pages). Builds on the
trade core (PD-68–PD-71: `POST /admin/trades/:id/void`, `GET /admin/trades/:id`), the audit writer (PD-56, PD-79:
`AuditService.record`), PD-116 (`TradeOfferPanel` read-only, `TradeStatusTimeline`, `tradeTimelineSteps`) and PD-122
(`/admin/users`, `GET /admin/users?q=`). Reference: `docs/InformationArchitecture.md` §04 Admin · `docs/PRD.md` §14,
§17 · `docs/API.md` *Trades*, *Voiding an accepted trade* · `docs/DataModel.md` *AuditLog*.

---

## What the ticket asks

| Scope item | Where it lands |
| --- | --- |
| `/admin/trades` — all trades, filters by status, user and date | [Trades list](#admin-trades) on `GET /admin/trades` |
| drill into any trade; void with a required reason | [Trade detail](#admin-trades-id) |
| the void dialog says plainly whether the reversal is feasible before allowing it | `GET /admin/trades/:id/void-check` ([Decision 1](#decisions)) |
| `/admin/audit` — searchable, filterable by actor, action, entity and date range | [Audit log](#admin-audit) on `GET /admin/audit` |
| audit entries link to the affected entity | [Entity links](#entity-links) |

| Acceptance criterion | How it is met |
| --- | --- |
| A void the server would refuse is blocked in the UI with the reason shown | The dialog asks `void-check` first — the void itself, rolled back — and without `voidable: true` it shows the server's reason and offers no confirm; [Verification](#verification) B2–B4 |
| Every admin action performed in this session appears in the audit log | Each admin write already audits in its own transaction; the page lists every row, filterable to one actor; [Verification](#verification) B6 |
| The audit log is read-only in the UI with no edit or delete affordance | No control on a row but *Details*, which expands read-only JSON; the API has no route that writes audit rows; [Verification](#verification) B7 |

## Decisions

Taken with the user during brainstorming (D6 in `docs/Pages.md`, open until now):

1. **Feasibility is a dry run.** `GET /admin/trades/:id/void-check` runs exactly the path `POST /admin/trades/:id/void`
   runs — the guarded close, then, for an accepted trade, the reversal — inside a transaction it always rolls back, and
   answers what the void would have answered. One set of rules, so the check cannot drift from the void. It takes the
   same row locks for those milliseconds. Rejected: read-only checks of balances and available copies (a second copy of
   the reversal's rules) and no check at all (the criterion asks to block in advance).
2. **An admin trade page**, `/admin/trades/[id]`, rather than a drawer in the list: audit entries, the list and the
   address bar all link to it, and the counter chain needs room.
3. **D6 resolved:** three admin read endpoints — the trades list, the void check and the audit list. Nothing in the API
   writes or deletes audit rows; the log stays append-only by convention (`DataModel.md`).

Assumed and confirmed: the audit page lists **every** row — members' trade transitions and the expiry job's
(`actorId` null, *System*) as well as admins' actions. *Flagged trades* (the mockup's quick action) is not a concept
the data has; filters are the moderation tool.

## API

All three under `@Roles(['ADMIN'])`: a member 403, signed out 401.

### `GET /admin/trades`

| Query | Rule |
| --- | --- |
| `status` | one of the six `TradeStatus` values; absent for all |
| `user` | a user id; trades with them on either side |
| `from`, `to` | `YYYY-MM-DD`, UTC, on `createdAt`, `to` inclusive; `from` after `to` is 400 |
| `cursor`, `pageSize` | the inbox's opaque `(createdAt, id)` keyset cursor; 1–100, default 24 |

Newest first. The answer is `TradePage` — the inbox's own `TradeView` rows (both parties, coins, items with the slim
card, `expiresAt`) with `role: null`, and `total` for the filter. `user` uses the `(initiatorId, status)` and
`(recipientId, status)` indexes as the inbox does; the unfiltered list and the date range use `trades (createdAt)`.
Implemented in `TradeReadsService` beside `inbox`, sharing its select and `toView`.

### `GET /admin/trades/:id/void-check`

`{ voidable: true }` or `{ voidable: false, code, reason }` — `code` and `reason` exactly what `POST …/void` would answer:
`TRADE_NOT_PENDING` (*This trade is already DECLINED*) or `TRADE_NOT_REVERSIBLE` (*Cannot reverse this trade: …*,
for a missing card and for coins already spent alike, naming the user by id and what they lack). 404 for an unknown
trade.

`TradesService.voidTrade` is split so the transactional part is one function both callers run: the void commits it and
then notifies and invalidates; the check runs it inside `withTransaction` and throws a private rollback sentinel at the
end, mapping a domain refusal (any `HttpException` with a `code`) to `voidable: false` and anything else to a 500. The
audit row the transactional part writes is rolled back with everything else; nothing is notified; no cache is touched.
Not throttled beyond the default tier: it is admin-only and holds its locks for milliseconds.

### `GET /admin/audit`

| Query | Rule |
| --- | --- |
| `actor` | a user id, or `system` for rows with no actor |
| `action` | an exact action (`trade.void`) or a group (`trade`, `user`, `pack_template`, `sync`) |
| `entity`, `entityId` | `Trade` · `User` · `PackTemplate` · `SyncJob` · `Provider`; `entityId` only with `entity` |
| `from`, `to` | `YYYY-MM-DD`, UTC, on `createdAt`, `to` inclusive |
| `cursor`, `pageSize` | keyset over `(createdAt, id)`; 1–100, default 50 |

Newest first. Each row: `{ id, action, entity, entityId, actor: { id, displayName, email } | null, meta, createdAt }`.
`meta` is returned as stored (JSON). A new index `audit_logs (createdAt, id)` serves the unfiltered list and the date
range; the existing `(actorId, createdAt)` and `(entity, entityId)` serve their filters. Measured with `EXPLAIN ANALYZE`
over several thousand rows inserted in a rolled-back transaction, and the plans recorded in `API.md`.

Shared schemas in `packages/shared`: `AdminTradeQuerySchema`, `VoidCheckSchema`, `AuditQuerySchema`,
`AuditEntrySchema`, `AuditPageSchema`.

## Pages

### `/admin/trades`

- Filters in the URL: status tabs (*All · Pending · Accepted · Countered · Declined · Cancelled · Voided*), a user
  combobox over `GET /admin/users?q=` (the choice a chip with ×), *From* and *To* dates.
- Each row: *Ash gives Charizard ×1 · 50 coins → Misty gives Pikachu* (both sides by name, the inbox's side
  summary), the status badge, created and closed dates; the row links `/admin/trades/<id>`.
- *Load more* on the cursor; empty: *No trades match* with *Clear filters*.

### `/admin/trades/[id]`

- Server page: `GET /admin/trades/:id`; an unknown id is a real 404 (the admin layout has no loading boundary of its
  own above it — checked when built).
- Header *Ash → Misty*, the status badge, each party linking `/admin/users?q=<email>`.
- `TradeOfferPanel` read-only with *Ash gives* / *Misty gives*; the timeline (`tradeTimelineSteps` with `role: null`
  names both parties) and the negotiation chain, every link to `/admin/trades/…`; *View in the audit log* →
  `/admin/audit?entity=Trade&entityId=<id>`.
- **Void trade** for `PENDING` and `ACCEPTED` only; other statuses say why there is nothing to void. The dialog calls
  `void-check` as it opens:
  - checking — a spinner, no confirm;
  - voidable — what will happen (*pending:* closed, the initiator's locked copies released; *accepted:* the cards and
    coins go back to each side), a required *Reason* (1–500, `VoidTradeSchema`), *Void trade*;
  - not voidable — the server's reason verbatim (it names a user by id; the two parties are named above it), no
    reason field, no confirm;
  - the check failed for another reason — *Couldn’t check whether this trade can be voided*, *Try again*, no confirm;
  - the void refused anyway (state changed since the check) — the refusal in the dialog, the trade re-read.
  After a void: the toast, the trade re-read, and `trades`, `wallet`, `inventory` and admin queries invalidated.

### `/admin/audit`

- Filters in the URL: actor (combobox over `GET /admin/users?q=`, plus *System*), action (the groups, then the known
  actions), entity and `entityId` (a chip when present), *From* and *To*.
- Each row: when (relative, exact on hover), who (*Ash · ash@…* or *System*), the action in words (*Voided a trade*,
  *Granted coins*, *Changed a role*, *Proposed a trade*…) with its name in small type, the entity as a link, a one-line
  summary of `meta` for known actions (*+250 coins — Compensation…*, *MEMBER → ADMIN*, *reason: …*), and *Details*,
  which expands the raw `meta` as read-only JSON.
- *Load more*; empty: *No entries match* with *Clear filters*. Nothing on the page edits or deletes.

### Entity links

| Entity | Link |
| --- | --- |
| `Trade` | `/admin/trades/<id>` |
| `User` | `/admin/users?q=<email>` — `/admin/users` learns to read `?q=` |
| `PackTemplate` | `/admin/packs?template=<id>` — the editor learns to select from `?template=` |
| `SyncJob`, `Provider` | `/admin/sync` |

## Errors

- A list that fails: `ListError` with *Try again*. A bad filter in the URL falls back to its default, as every
  `useUrlTab` does; the API answers a bad value with 400.
- `void-check` 404 → the dialog says the trade no longer exists; 403/401 as every admin route.
- After a void, a 409 (`TRADE_NOT_PENDING`, `TRADE_NOT_REVERSIBLE`) is shown in the dialog and the trade re-read.

## Documentation

- `docs/API.md`: *Admin / Trades* (the list and the void check, with the dry-run reasoning) and *Admin / Audit*, each
  with what was measured and the `EXPLAIN` plans.
- `docs/DataModel.md`: the `(createdAt, id)` index under *AuditLog*.
- `docs/Pages.md`: D6 in the decisions table; *Trade moderation and audit log (PD-123)* with what was measured and its
  traps. Memory: D6 resolved.

## Verification

No automated tests (v1).

**A. The API, through HTTP, with the database checked:**

1. The trades list: each status filter, `user` on either side, a date range, pages of 2 across the whole set — every
   trade once, newest first; bad `status`, bad date, `from` after `to` → 400; member 403, signed out 401.
2. The void check on a pending trade → voidable; on an accepted trade whose cards are still available → voidable; on an
   accepted trade whose receiver gave the card away → not voidable with the same message `POST …/void` then returns;
   on a declined trade → `TRADE_NOT_PENDING`. After every check: the trade, locks, balances, ledger and `audit_logs`
   byte-identical, no notification.
3. The audit list: each filter (actor, `system`, action group and exact, entity and id, dates), pages of 2 — every row
   once; `EXPLAIN ANALYZE` of the unfiltered and the date-range query over thousands of rows in a rolled-back
   transaction, using the new index.

**B. In the browser over CDP, as the test admin:**

1. The trades list filtered by status, by a user and by dates; a row opens the trade page.
2. A voidable pending trade: the dialog says what happens, refuses without a reason, voids with one → *Voided*, the
   lock released.
3. An accepted trade made unreversible (the receiver trades the card on): the dialog shows the reason and no confirm.
4. An accepted trade still reversible: voided, both inventories and balances back.
5. The audit log filtered by actor, action, entity and dates; every entity link lands on its page.
6. One of each admin action in the session — a grant, a role change and back, a suspension and unsuspension, a
   template save, a sync trigger (queue paused, no provider request), a breaker reset, a void — then the log filtered
   to the admin: every one listed.
7. No edit or delete control anywhere on the audit page; *Details* read-only.
8. 375 px without horizontal scroll, keyboard through the filters and the dialog, no console errors.

## Out of scope

Flagging suspicious trades; exporting the log; editing or deleting audit rows; voiding several trades at once.
