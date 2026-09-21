# PD-48 — The price sync processor and the per-card write path

Design, 2026-09-21. Milestone M4 · Price Sync.

Ticket: [PD-48](https://linear.app/mstrilec/issue/PD-48/price-sync-processor-and-per-card-write-path) ·
Reference: `docs/PRD.md` §15 (write path per card) · `docs/Architecture.md` §7 ·
`docs/DataModel.md` (PriceSnapshot).

The first thing in this project that writes a price. Four tickets sit on top of
it — PD-49 nightly, PD-50 active, PD-51 read, PD-52 on demand — so its job
contract is the one they all speak.

---

## Measured before designing

Against both live APIs and the real 20 670-card mirror, 2026-09-21.

| Probe | Result |
| --- | --- |
| pokemontcg `fetchPrices`, 10 cards from `base1` | 20 points for 10/10 cards, 1.8 s |
| pokemontcg `fetchPrices`, 10 cards from `sv10` | 20 points for 10/10 cards, 2.9 s |
| TCGdex `fetchPrices`, 10 cards from `base1` | 20 points for 10/10 cards, 0.4 s |
| **TCGdex `fetchPrices`, 10 cards from `sv10`** | **16 points for 8/10 cards** |
| pokemontcg batch of 100 | 199 points, 100 cards, 3.9 s |
| pokemontcg batch of 250 | 404 points, 250 cards, 19.2 s |

**Two points per card** — TCGplayer in USD and Cardmarket in EUR. That is what
`PriceSnapshot.source` distinguishes, and it means a card's history is two
interleaved series rather than one.

The state this starts from: `latestPriceUsd` set on **12** of 20 670 cards,
`latestPriceEur` on **none**, and `price_snapshots` **empty**. Every measurement
below is from a clean table.

TCGdex missing 2 of 10 for `sv10` is the PD-43 boundary showing up again: its
ids are zero-padded below 100, so it can address our `sv10-100` and cannot
address our `sv10-1`. Prices inherit the id problem exactly.

---

## Where the "one snapshot per card per day" cap lives

`docs/DataModel.md` currently says:

> The **≤ 1 snapshot/card/day** cap is enforced by the price sync job, not by the
> schema. Expressing it needs a unique index over `capturedAt::date`, and Prisma
> cannot declare expression indexes.

**The premise is true and the conclusion does not follow.** Prisma cannot
declare an index over an expression — but the constraint does not have to be
expressed over one. Materialise the day as a column and the index becomes
ordinary.

```prisma
capturedOn DateTime @db.Date

@@unique([cardId, source, capturedOn])
```

Prisma declares both the column and the composite unique index natively. No
hand-written SQL, no drift, nothing for a later `migrate dev` to try to drop.

### Why this is worth a migration rather than a guard in code

The alternative — `INSERT ... SELECT ... WHERE NOT EXISTS` in the processor —
satisfies the ticket's first acceptance criterion exactly ("running the job
twice in one day creates exactly one snapshot per card") and closes nothing
else. Two workers writing the same card at the same instant both read
`NOT EXISTS` under `READ COMMITTED` and both insert.

That is not hypothetical-by-construction. `QUEUE_CONCURRENCY=4` is already in
`.env` and in the config schema; it is simply not wired into a processor yet.
An invariant that survives only while one number stays at 1 is a convention, not
an invariant, and this is the table `docs/DataModel.md` already calls "the
fastest-growing in the system".

**And the table is empty right now.** Adding a column and a unique index to zero
rows needs no backfill and no thought about conflicting history. This is the
cheapest this decision will ever be.

### What it buys beyond correctness

The insert becomes `ON CONFLICT DO NOTHING`, which Prisma expresses as
`createMany({ skipDuplicates: true })` — so this ticket needs **no raw SQL at
all**. `catalog.writer.ts` is raw because a conditional-update upsert has no
Prisma equivalent; nothing here has that shape.

### `capturedOn` is UTC, and that is load-bearing

`capturedOn` is `date_trunc` of `capturedAt` **in UTC**, computed in the
application because Prisma has no generated columns. Computing it in local time
would make "a day" mean different things on different machines, and the cap
would quietly admit two rows the first time a server moved timezone or a clock
crossed a DST boundary. The processor derives it once per batch from a single
`capturedAt`, so every row in one job shares a day by construction.

---

## The job contract

```ts
interface PriceSyncJob {
  cardIds: string[];
}
```

**The processor is handed ids; it does not choose them.** PD-49 enqueues batches
covering the catalog, PD-50 enqueues the active set, PD-52 enqueues one card.
Three producers, one consumer, and all the selection logic lives in the
schedules where it can be reasoned about separately.

**Batch size is 100.** Measured: 100 cards in 3.9 s against 250 in 19.2 s — five
times the wall clock for two and a half times the work, because the provider's
`OR`-query cost grows faster than linearly. At 100 the catalog is 207 jobs, and
a failed job costs 100 cards rather than 250.

---

## The write path per card

Exactly `docs/PRD.md` §15, in one transaction per batch:

1. `provider.fetchPrices(cardIds)` — one call for the whole batch.
2. Group the returned points by `cardId`.
3. `UPDATE cards SET "latestPriceUsd", "latestPriceEur", "priceUpdatedAt"`.
4. `createMany` the snapshots with `skipDuplicates`.
5. `DEL cache:price:card:{id}` for every card written — **after the transaction
   commits**, not inside it. Redis round trips inside an open transaction hold
   row locks for the length of a network call, and a delete that raced a
   rollback would only cost one repopulating read anyway.

### Currency mapping, and what an absent currency means

| Column | Source |
| --- | --- |
| `latestPriceUsd` | the `TCGPLAYER` point's `market` |
| `latestPriceEur` | the `CARDMARKET` point's `market` |

**A currency the provider did not return this time is written as `null`.** The
two columns and `priceUpdatedAt` describe one instant, and there is exactly one
timestamp for both — so keeping a stale EUR beside a fresh USD would make
`priceUpdatedAt` a statement that is true of one column and false of the other,
with no way for a reader to tell which. Nothing is lost: the older value stays
in `PriceSnapshot`, which is what the series is for.

**A card the provider returned nothing at all for is not touched.** Not the
columns, not `priceUpdatedAt`, not a snapshot. That is the ticket's third
acceptance criterion, and it is the difference between "we have no new price"
and "the price is now nothing".

The two rules are distinguished by whether the card appears in the response at
all, not by whether a particular currency does.

### Cache invalidation

`cacheKeys.cardPrice(id)` — `cache:price:card:{id}` — deleted per card actually
written. Not `cachePatterns.allPrices()`: a batch of 100 must not flush the
other 20 570 cards' cached prices, and PD-46 measured what a needless flush
costs.

---

## Failover, and why prices cannot fork the catalog

The processor asks PD-43's `ProviderSelectorService` once per job and feeds the
same breaker. A provider that is down for the catalog is down for prices, and
sharing the counter is what makes that one fact rather than two.

**PD-43 needed two rules to stop a failover forking the mirror. This path needs
none**, and not by carefulness: it only ever `UPDATE`s rows whose ids came out
of our own database, and it never inserts a card. There is no path by which a
fallback run introduces an id. The protection falls out of the shape of the job.

`PriceSnapshot.source` is `TCGPLAYER` or `CARDMARKET` regardless of which
provider reported it, so a fallback run's rows are not a different kind of data —
both providers read the same two marketplaces.

### The known cost of a fallback price run

TCGdex cannot address roughly 10–15% of our card ids — the zero-padding
divergence PD-43 documented. Those cards come back empty, and by the rule above
they keep their previous values, which is **indistinguishable from "the provider
has no price for this card"**.

Recorded rather than solved, alongside the rarity-vocabulary drift PD-43 already
records. Solving it means an id translation table, which this project has now
rejected twice for the same reason: it breaks silently and it breaks first on
the newest sets.

---

## Failure handling

| What | Result |
| --- | --- |
| `ProviderUnavailableError` | breaker incremented, job fails, BullMQ retries it |
| `ProviderRateLimitError` | honoured inside the client; **never** counted toward the breaker |
| `ProviderContractError` | breaker incremented, job fails — the upstream changed shape |
| a card absent from the response | skipped silently; its previous values stand |
| a card whose price block has no usable numbers | no point is emitted by the mapper at all, so it lands in the row above rather than writing an all-null snapshot |
| Redis unreachable | the breaker reads closed, the run uses the configured primary, cache deletes log a warning |

The rate-limit exclusion is the same rule PD-43 states and `http.ts` comments:
counting a 429 moves load onto the fallback and rate-limits that one too.

**No `SyncRun` row is written here.** A nightly sweep is 207 jobs; a row each
would bury the table that the admin endpoint reads to answer "what happened
last". Which unit of work counts as a run is PD-49's decision, and PD-49 is next.

---

## Shape

```
apps/api/src/sync/
  price-sync.processor.ts    the job, the write path, the breaker calls
  price.writer.ts            the two writes, so the processor stays readable
```

`price.writer.ts` mirrors `catalog.writer.ts`'s position in the module — the
place writes live — without mirroring its raw SQL, which existed for a guard
this path does not need.

---

## Verification plan

No automated tests. Each item measured by hand against the running stack.

1. **The migration applies to the empty table** and `\d price_snapshots` shows
   the unique index on `(cardId, source, capturedOn)`.
2. **Running the job twice in one day creates exactly one snapshot per card** —
   the first acceptance criterion. Count snapshots, run again, count again.
3. **The second run still updates the card columns.** The cap is on history, not
   on freshness; a second run must refresh `latestPrice*` and `priceUpdatedAt`
   while adding no snapshot row.
4. **The unique index is what enforces it, not the code path.** Attempt a direct
   duplicate insert in `psql` and watch PostgreSQL refuse it. This is the
   measurement that distinguishes approach A from a guard in the processor.
5. **A price write invalidates that card's price cache key** — the second
   acceptance criterion. Set the key, run the job, confirm it is gone, and
   confirm a neighbouring card's key survives.
6. **A card the provider has no price for keeps its previous values and its old
   timestamp** — the third acceptance criterion. Pick a card the provider does
   not price, record its row, run the job, compare.
7. **An absent currency writes null rather than keeping the old value**, and the
   old value is still readable in `PriceSnapshot`.
8. **Both currencies land.** After one batch, `latestPriceUsd` and
   `latestPriceEur` are both populated for cards the provider prices in both.
9. **A number written to `Decimal(10,2)` round-trips exactly.** `PriceDTO.market`
   is a JS number and the column is a decimal; confirm in `psql` that a value
   like `882.02` stores as `882.02` rather than something with a float's tail.
   Converting a `Decimal` *back* to a number is PD-51's boundary — PD-46 measured
   what that costs when missed, and this ticket must not pre-empt it.
10. **The batch of 100 is timed end to end**, including the writes. If the
    per-card updates dominate the provider call, that is a finding to record.
11. **Gates.** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`.

---

## Files

**New**

| Path | Holds |
| --- | --- |
| `apps/api/src/sync/price-sync.processor.ts` | the processor |
| `apps/api/src/sync/price.writer.ts` | the card update and the snapshot insert |

**Edited**

| Path | Change |
| --- | --- |
| `apps/api/prisma/schema.prisma` | `capturedOn` and the unique index on `PriceSnapshot` |
| `apps/api/src/sync/sync.module.ts` | register the processor and the writer |
| `apps/api/src/sync/index.ts` | export the job type for PD-49, PD-50 and PD-52 |
| `docs/DataModel.md` | **correct the claim at the PriceSnapshot section** |
| `apps/api/src/sync/README.md`, `docs/Architecture.md` | the write path, measured |

One migration, adding one column and one unique index to an empty table.

---

## Out of scope

| Not here | Where |
| --- | --- |
| Deciding which cards to refresh | PD-49 (nightly), PD-50 (active), PD-52 (on demand) |
| Recording a sweep as a `SyncRun` | PD-49 |
| Reading prices back, sparklines | PD-51 |
| A per-card cooldown | PD-52 |
| Partitioning or downsampling the series | not in v1; `docs/DataModel.md` names it as the growth plan |
| Filling `tcgplayerId` / `cardmarketId` | null on all 20 670 rows; the primary publishes neither, TCGdex does. A separate decision |

---

## Forward notes

**PD-51 reads what this writes, and the index it needs already exists.**
`@@index([cardId, capturedAt])` is exactly a 30-day sparkline query. The new
unique index is for writes and does not replace it.

**The series grows by two rows per card per day, capped.** 20 670 cards × 2
sources = 41 340 rows a day at most, so roughly 15 million a year. That is the
number `docs/DataModel.md`'s partitioning note is about, and it is now bounded
by a database constraint rather than by a job behaving correctly.

**`capturedOn` makes a retention job trivial later.** Deleting or downsampling
by day becomes a range scan on an indexed date column rather than a computation
over every row's timestamp.
