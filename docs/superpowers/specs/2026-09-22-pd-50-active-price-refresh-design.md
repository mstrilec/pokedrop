# PD-50 — The active-card price refresh

Design, 2026-09-22. Milestone M4 · Price Sync.

Ticket: [PD-50](https://linear.app/mstrilec/issue/PD-50/active-card-price-refresh-prioritising-owned-decked-and-traded-cards) ·
Reference: `docs/PRD.md` §15 (frequent "active" refresh) · `docs/Architecture.md` §7 ·
[PD-49's design](2026-09-21-pd-49-nightly-price-sweep-design.md).

The fast half of the two-speed strategy. PD-49 sweeps everything once; this keeps
the prices users actually look at fresher than that, without paying for the long
tail twice.

---

## Measured before designing

Against the real database and the real schema, 2026-09-22.

| Probe | Result |
| --- | --- |
| `inventory_items` | **7 rows, 7 distinct cards** |
| `deck_cards` | **3 rows, 3 distinct cards** |
| `trade_items` | **7 rows, 6 distinct cards**; all 6 trades created inside 30 days |
| the three unioned | **8 distinct cards** — they overlap heavily |
| the catalog | 20 670 cards |
| `inventory_items` index on `cardId` | **none usable** — the unique index is `(userId, cardId)`, `cardId` second |
| `deck_cards` index on `cardId` | **none usable** — the unique index is `(deckId, cardId)`, `cardId` second |
| `trade_items` index on `cardId` | **none at all** — the only index is `(tradeId)` |
| `cards.priceUpdatedAt` index | **none** |
| `SyncKind` enum values | `CATALOG`, `PRICE` |

Two of these decide the shape of this ticket.

### The active set is eight cards, and every one of them is seed data

There are no real owners. `InventoryItem` is populated by the seed script and by
pack opening, which is **M6 and unbuilt**; decks are **M7**; trades are **M8**.
All three milestones are at 0%.

So this ticket builds a prioritisation mechanism for a load that does not exist
yet. That is fine for the *mechanism* — a cron selecting a bounded, deduplicated,
index-backed set of ids and handing them to `PriceBatchService` is fully
specifiable and verifiable today, because the schema it queries has been stable
since M1. It is **not** fine for tuning, and this design does not pretend
otherwise: the thresholds below are defaults with stated reasoning, not
measurements, and the first real traffic should be allowed to move them.

### The trending input is deferred, and this is the reason

The ticket's scope line asks for a "lightweight view-tracking signal for the
'trending' input", and its acceptance criteria ask that "priority ordering so the
most-viewed cards refresh first".

**There is no traffic to shape that signal.** The frontend is M11–M13, all at 0%,
so a view counter would today record only direct API calls to `GET /cards/:id` —
which means our own probes. Designing a popularity ranking against zero traffic is
tuning against noise, and it would be rebuilt the moment a real client exists.

View tracking is therefore **out of scope here and belongs to its own ticket after
M13**. What replaces it as the ordering signal is staleness, which is honest,
already recorded, and arguably the better ordering for a refresh job: refresh what
is most out of date first. The acceptance criterion is met in substance — the set
is ordered by priority — with the priority being one this project can actually
measure.

### The index criterion is not satisfiable as the schema stands

"The active query is index-backed and bounded in size" cannot hold against a
schema where none of the three membership tables can be searched by `cardId`. A
composite index whose second column is `cardId` does not serve a `cardId` lookup,
and `trade_items` has no index on it at all.

So this ticket carries a migration regardless — and it is carrying one anyway, for
the enum value below.

---

## The selection query

One statement, and it satisfies three acceptance criteria at once.

```sql
SELECT c.id
FROM cards c
WHERE c.id IN (
        SELECT "cardId" FROM inventory_items
  UNION SELECT "cardId" FROM deck_cards
  UNION SELECT ti."cardId" FROM trade_items ti
          JOIN trades t ON t.id = ti."tradeId"
         WHERE t."createdAt" > now() - <tradeWindow>
      )
  AND (c."priceUpdatedAt" IS NULL OR c."priceUpdatedAt" < now() - <freshness>)
ORDER BY c."priceUpdatedAt" ASC NULLS FIRST
LIMIT <maxCards>
```

**Deduplication against the nightly sweep is free.** A card the 4am sweep
refreshed carries a fresh `priceUpdatedAt`, so the freshness predicate excludes it
until the window passes. No run registry, no Redis marker, no shared state between
two jobs that would have to be kept in step — the column PD-48 already writes is
the whole mechanism. The ticket's third criterion, that the two jobs "never
double-fetch the same card in one window", is a property of the query rather than
of a coordination protocol.

**Ordering is staleness, oldest first.** `NULLS FIRST` puts never-priced cards
ahead of everything, which is right: a card with no price at all is the worst thing
a user can be shown.

**Bounding is `LIMIT`.** See §Thresholds for why the bound matters more than the
cadence.

### Any trade counts, regardless of status

A card in a `PENDING` trade is one two people are negotiating over right now. A
card in a trade that was `DECLINED` last week is one somebody wanted recently.
Both are evidence of interest, which is what this signal is for, so the query
filters on recency and not on status. Filtering by status would need a rule
explaining why a declined trade stops mattering at the moment it is declined, and
there is no such rule worth defending.

---

## Shape

```
price-active.scheduler.ts   @Cron every 6h  ->  queue.add, and nothing else
price-active.processor.ts   select the set, walk it in batches, record the run
price-batch.service.ts      unchanged - PD-49 already made this the shared path
```

Its own queue, `price-active`, for the reason PD-49 took one: a job of minutes
must not sit in front of PD-52's single-card jobs on `price-sync`.

**No cursor, and that is the difference from the sweep.** PD-49 rolls a cursor
between nights because it is walking 20 670 cards it cannot finish in one run.
This job re-derives its set on every run and the set is bounded by `LIMIT`, so
there is nothing to resume: a run that dies is simply re-selected from scratch by
the next one, six hours later, with the cards it failed to refresh now even staler
and therefore sorted higher. Resumption would add a cursor whose only effect is to
stop the ordering doing its job.

A BullMQ retry of the same job re-selects too. That is correct for the same
reason.

---

## `SyncKind.PRICE_ACTIVE`

`AdminSyncService.lastRunPerKind` reports the last run **of each kind**, and there
are two kinds today. If this job wrote `PRICE` rows, then from 10am onward
`/admin/sync/status` would show a two-minute active refresh where the operator
expects the seventeen-minute nightly sweep, and the sweep would be invisible
between its own runs — on the one endpoint whose job is to say what happened.

So a third value. `ALTER TYPE "SyncKind" ADD VALUE 'PRICE_ACTIVE'` does not rewrite
the table.

`AdminSyncService` changes by one array element; `SyncKind` in
`packages/shared/src/enums.ts` gains the value so the response still parses.

**A new enum value cannot be *used* in the same transaction that adds it**, and
Prisma runs a migration inside one. Adding the value is therefore all this
migration does with it — no backfill, no default, no constraint mentioning
`PRICE_ACTIVE`. The four indexes ride in the same file safely because they touch
no enum at all. The first row carrying the new value is written at runtime, by a
later transaction, which is exactly what the restriction permits.

---

## The indexes

| Index | Why |
| --- | --- |
| `inventory_items (cardId)` | the membership scan; the existing `(userId, cardId)` cannot serve it |
| `deck_cards (cardId)` | same, against `(deckId, cardId)` |
| `trade_items (cardId)` | there is no index on this column at all |
| `cards (priceUpdatedAt)` | the `ORDER BY` and the freshness predicate |

All four are plain btrees declared in `schema.prisma` with `@@index`, so Prisma
owns them and no raw SQL is needed.

**At today's eight rows Postgres will sequentially scan whatever we build**, and
correctly so — an index on a seven-row table is slower than reading it. That makes
the index criterion unverifiable at the current size, which the verification plan
below addresses by measuring at a synthetic size rather than by asserting it.

---

## Thresholds, and which one actually protects the budget

Defaults, all configurable:

| Setting | Default | Reasoning |
| --- | --- | --- |
| cadence | **6 hours** | four runs a day, so an active card is refreshed up to four times against the long tail's once — which is what "two-speed" means |
| freshness window | **6 hours** | equal to the cadence. Shorter re-fetches what the previous run just wrote; longer leaves a run with nothing to do |
| max cards per run | **2 500** | ten batches, about 30 requests |
| trade window | **30 days** | a month of trading interest; nothing measured, and the cheapest of the four to change |
| reserve | **150** | `PRICE_ACTIVE_RESERVE`, its own setting rather than PD-49's `PRICE_SWEEP_RESERVE`. The sweep leaves 300 so the day's other jobs can run; this one leaves less, because the only thing still owed a share by the time it runs is PD-52's on-demand traffic |

**The bound is what matters, not the cadence.** The active set is eight cards
today and could eventually be most of the catalog. Unbounded at four runs a day,
20 000 active cards would cost 320 batches and roughly 960 requests — the entire
anonymous daily allowance, leaving nothing for the sweep that feeds the long tail.
With the bound, a run costs about 30 requests and a day costs about 120, whatever
the set grows to. What degrades instead is coverage, gracefully and in the right
order: the staleness sort means the cards left behind are the freshest ones.

### The budget, and why the sweep is safe

All three jobs spend the same `budget:pokemontcg:{UTC day}` counter PD-49 built.

| Job | Cost | When |
| --- | --- | --- |
| catalog sync | ~250 | 3am UTC |
| nightly sweep | ~250 | 4am UTC |
| active refresh | ~120 | four runs across the day |

Ordering protects the sweep without any rule having to: the counter resets at
00:00 UTC and the two big jobs run at 3am and 4am, so they draw on a full
allowance before the active refresh has run at all. The active refresh keeps its
own reserve on top, so PD-52's on-demand requests are not squeezed out by the last
run of the day.

---

## Failure handling

Inherited from PD-49 unchanged, because the problem is identical: a batch that
exhausts the client's retry budget is counted into `failed` and the loop
continues; a `ProviderRateLimitError` waits and retries the same batch without
counting; a `ProviderContractError` closes the run `FAILED`; an opening breaker
stops the loop. The provider is chosen once per run.

A run closes `SUCCEEDED` when it refreshed every card it selected with nothing
failed, and `PARTIAL` otherwise — including when the bound truncated the set,
because a run that refreshed 2 500 of 9 000 eligible cards did not do the whole of
what it set out to do, and the reason belongs in the row where an operator will
read it.

**Truncation is detected by asking for one more than the bound.** The selector
issues `LIMIT maxCards + 1`; if it gets `maxCards + 1` rows it discards the extra
and reports the set as truncated. A bare `LIMIT maxCards` returning exactly
`maxCards` cannot tell "there were exactly this many" from "there were more", and
a second `COUNT(*)` over the same predicate would run the membership union twice
to learn one boolean.

---

## Verification plan

No automated tests (`docs/PRD.md` §20). Measurements against the running stack.

1. **The query returns the seeded eight**, and returns them ordered oldest-price-first.
2. **A card refreshed moments ago is excluded**, and reappears once the freshness window is moved back — the dedup criterion, demonstrated rather than asserted.
3. **The nightly sweep and the active refresh do not double-fetch.** Run the sweep against a small seeded region, then the active refresh, and confirm the second selects none of what the first just wrote.
4. **The bound truncates** and the run closes `PARTIAL` naming it.
5. **`/admin/sync/status` shows three kinds**, with the nightly sweep still visible beside the active refresh — the thing `PRICE_ACTIVE` exists for.
6. **The index criterion, measured at a size where it means something.** Insert tens of thousands of synthetic `inventory_items` rows, `ANALYZE`, and capture `EXPLAIN (ANALYZE, BUFFERS)` for the selection query, confirming index scans rather than sequential ones on the membership tables and the `priceUpdatedAt` ordering. Then remove the synthetic rows and confirm the baseline is restored. **Without this step the index acceptance criterion is a claim, not a measurement** — at eight rows every plan is a sequential scan and proves nothing.
7. **Gates.** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`.

Step 6 is the one this ticket could get wrong quietly, and it is also the one most likely to be skipped because the query "obviously" uses the indexes.

---

## Files

**New**

| Path | Holds |
| --- | --- |
| `apps/api/src/sync/price-active.scheduler.ts` | the cron, whose entire body is an enqueue |
| `apps/api/src/sync/price-active.processor.ts` | the selection, the batch loop, the run |
| `apps/api/src/sync/active-card.selector.ts` | the query, so the processor reads as a sequence |

**Edited**

| Path | Change |
| --- | --- |
| `apps/api/prisma/schema.prisma` | `PRICE_ACTIVE`, four `@@index` declarations |
| `packages/shared/src/enums.ts` | `PRICE_ACTIVE` in `SyncKindSchema` |
| `apps/api/src/admin/admin-sync.service.ts` | one more kind in `lastRunPerKind` |
| `apps/api/src/queue/queue.constants.ts`, `queue.module.ts` | the `price-active` queue |
| `apps/api/src/sync/sync.module.ts`, `index.ts` | register and export |
| `apps/api/src/config/env.schema.ts`, `app.config.ts`, `.env.example` | cadence, freshness, bound, trade window, reserve |
| `apps/api/src/sync/README.md`, `docs/API.md` | the job, its thresholds, the third kind |

One migration: an enum value and four indexes.

---

## Out of scope

| Not here | Where |
| --- | --- |
| View tracking and a trending signal | its own ticket, after M13 gives it traffic |
| Reading prices back, sparklines | PD-51 |
| A per-card cooldown, an on-demand endpoint | PD-52 |
| Triggering this from the admin API | PD-81 |
| Tuning the four thresholds against real usage | after M6, when owned cards stop being seed data |
| Populating `InventoryItem` for real | M5, M6 |

---

## Forward notes

**The thresholds are the first thing to revisit after M6.** Everything here is
sized against a set of eight cards. The mechanism does not care, but the numbers
were chosen rather than measured, and the file records which is which.

**Staleness ordering will outlive the trending ticket.** When view counts arrive
they should refine this order, not replace it: a popular card whose price is two
hours old still needs refreshing less than an owned card that has never been
priced at all.

**The budget arithmetic has no slack left after this.** Catalog 250, sweep 250,
active 120 — roughly 620 of 1 000, before PD-52 spends anything on demand. The next
ticket that wants a scheduled provider call has to take it from one of these three,
and `RequestBudgetService` is where it will find that out.
