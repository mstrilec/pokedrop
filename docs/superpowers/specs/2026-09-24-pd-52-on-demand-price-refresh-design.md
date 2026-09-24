# PD-52 — The on-demand price refresh

Design, 2026-09-24. Milestone M4 · Price Sync.

Ticket: [PD-52](https://linear.app/mstrilec/issue/PD-52/on-demand-price-refresh-with-per-card-cooldown) ·
Reference: `docs/PRD.md` §15 (on-demand) · `docs/Architecture.md` §7 ·
[PD-48's write path](2026-09-21-pd-48-price-sync-write-path-design.md) ·
[PD-51's read API](2026-09-23-pd-51-prices-read-api-design.md).

The last ticket in M4, and the one that finally gives the `price-sync` queue a
producer.

---

## The understanding this design is built on

**What the ticket asks for:** someone looking at a card can ask for a fresher
price and gets an answer immediately rather than waiting on a third party;
asking twice inside a window does not queue the work twice; the window is
configurable.

**What the repository adds, which the ticket does not say:** the provider
allowance is 1 000 requests a day and three scheduled jobs already commit about
620 of it — the catalog sync ~250, PD-49's nightly sweep ~250, PD-50's active
refresh ~120. On-demand lives in the remaining ~380, and one refresh costs about
three requests once retries are counted. **So roughly 125 distinct cards a day
is the whole of what is left.** A per-card cooldown does nothing about that,
because there are 20 670 cards to choose from.

**The decision that follows, taken with the user:** the endpoint requires a
session, and a daily reserve stops it before it can starve the scheduled jobs.

---

## Measured before designing

Against the running stack, 2026-09-24.

| Probe | Result |
| --- | --- |
| producers enqueuing to `price-sync` | **none** — the queue is registered and consumed, and nothing has ever filled it |
| `bull:price-sync:*` in Redis | job keys 1–7 and a `completed` set, all from PD-48's and PD-50's measurement probes |
| `price_snapshots` | **0 rows** |
| cards with `latestPriceUsd` | **12** of 20 670; with `latestPriceEur`, **none** |
| `cache:price:*` keys | **0** |
| `throttle:price:*` keys | **0** |
| today's `budget:pokemontcg:{day}` | unset |
| registered throttler tiers | **one**, `default`, at 100 requests per 60 s per user |
| `THROTTLE_MODERATE_LIMIT` / `_WINDOW` | 30 and 60 in config, **referenced by no tier** |
| `PricesModule.exports` | absent — `PricesService` is exported from `prices/index.ts` only |

Two of these shape the ticket.

### The queue has a consumer and has never had a producer

`PriceSyncProcessor` has existed since PD-48 and its docblock already names this
ticket as its producer. PD-49 and PD-50 both deliberately declined to enqueue
there — each coordinates its own batches on its own queue, because a fan-out has
no good answer for which of many jobs closes a run.

So `price-sync` is the one queue in the system whose consumer has never
executed against real work. This ticket is what makes it live, and the first
acceptance criterion — two requests, one job — is a statement about the producer
rather than about the consumer.

### The `moderate` throttle tier does not exist

`THROTTLE_MODERATE_LIMIT` and `THROTTLE_MODERATE_WINDOW` are in the environment
schema and in `AppConfig`, and **no throttler is registered under that name**.
`@nestjs/throttler` 6.7.0 applies every registered tier to every route, so
registering one would tighten the whole application from 100 requests a minute
to 30 — a behaviour change to every endpoint in the service, bought for one.

This design therefore adds **no per-route limit**. The `default` tier already
applies to this route and already bounds a single caller; the daily reserve is
what actually protects the quota, and it does so regardless of how many callers
there are. The unused config stays unused, which is a smaller lie than a tier
that exists to be overridden.

---

## The endpoint

```
POST /cards/:id/price/refresh
```

**No `@Public()`.** The global `SessionGuard` then requires a session by
default — the polarity PD-33 chose so that forgetting a decorator produces a 401
rather than a hole. The endpoint does not care *who* the caller is; it only
requires that there is one, so nothing reads `@CurrentUser`.

The response is **always 200**, and always the card's current price:

```json
{
  "cardId": "base1-4",
  "usd": 412.95,
  "eur": null,
  "priceUpdatedAt": "2026-09-23T04:02:11.008Z",
  "queued": false,
  "retryAfterSeconds": 233
}
```

A card id that is not in the catalog is a **404**, through the same
`PricesService.getLatest` that already answers that way for PD-51's read.

### Why 200 and not 202

202 Accepted describes a response *about* work that has been queued. This body
is about the **price**, which is returned in every case — queued or not — and
the two extra fields say what happened to the request beside it.

Splitting the status code would make a client branch twice for one call: once on
the code and again on the body it has to read anyway. The card detail page wants
the figure to render and a label to show; both come from the body.

### `queued` and `retryAfterSeconds` together say which of three things happened

| Outcome | `queued` | `retryAfterSeconds` |
| --- | --- | --- |
| a job was enqueued | `true` | the cooldown just set |
| the card is inside its cooldown | `false` | what remains of it |
| the day's reserve is reached | `false` | seconds until 00:00 UTC |

The third case needs no separate flag. The budget counter is keyed on the UTC
day and resets there, so "come back after midnight" is the literal truth, and a
client rendering "try again in 4 minutes" against a cooldown renders "try again
in 7 hours" against an exhausted day without knowing the difference.

---

## The cooldown is `SET NX EX`, not check-then-set

Key: `throttle:price:refresh:{cardId}`, in the `throttle:` namespace beside the
mail-resend cooldown that already lives there — **outside `cache:`**, so a
routine cache flush cannot hand every card a fresh window.

The primitive is the whole of the first acceptance criterion. "Two refresh
requests for the same card inside the cooldown enqueue only one job" is true **by
construction** with an atomic `SET key value NX EX ttl`: two concurrent requests
race, exactly one write succeeds, and the loser reads the key's TTL as its
remaining wait.

A read-then-write sequence has a window between the two steps that both requests
fit through, and the criterion would hold only most of the time. That is the
distinction between an invariant and a probability, and this ticket's first
criterion asks for the former.

**The key is set only when a job is actually enqueued.** A request refused for
lack of budget does not start a cooldown, because nothing was spent and nothing
is in flight.

**A failed job does not clear it.** The cooldown exists to stop repeated spending
on one card, and a job that failed has already spent its retry budget. Clearing
it on failure would turn a bad provider minute into a spending loop.

---

## Two layers, each against a different thing

| Layer | Prevents | Mechanism | Default |
| --- | --- | --- | --- |
| per-card cooldown | duplicate work on one card | `SET NX EX` | **600 s** (`PRICE_REFRESH_COOLDOWN`) |
| daily reserve | on-demand starving the scheduled jobs | `RequestBudgetService.hasHeadroom` | **50** (`PRICE_ONDEMAND_RESERVE`) |

**Ten minutes**, because it has to be shorter than PD-50's six-hour freshness
window for on-demand to be worth asking for at all, and long enough that
reloading a page does not spend the quota again. Chosen, not measured.

**Fifty**, because this is the last consumer to run in a day and the only one
left to protect is the 23:00 active refresh, which costs about 30 requests. The
sweep leaves 300 and the active refresh leaves 150; on-demand leaves the least
because it has the least behind it.

The second reuses the counter PD-49 built and PD-50 already shares, so all four
consumers of the provider now bid against **one honest count** rather than four
independent estimates. `PRICE_ONDEMAND_RESERVE` is a third reserve value beside
`PRICE_SWEEP_RESERVE` (300) and `PRICE_ACTIVE_RESERVE` (150).

The check happens **in the producer, not the processor**. The endpoint is what
decides whether to spend; the processor's job is to do what it was handed. This
also keeps PD-48's file untouched.

---

## What PD-51 left for this ticket

`PricesService` is exported from `apps/api/src/prices/index.ts` but **not from
`PricesModule`'s `exports`**, so nothing outside that module can inject it today.
PD-51's final review recorded this deliberately: adding the line before a
consumer existed would have been an unused export, and `CatalogModule` has the
same shape for the same reason.

This ticket is that consumer. It adds one line, and it reads the current price
through `getLatest` rather than re-querying, so the refresh response and the
ordinary read cannot drift apart in their shape, their `Decimal` conversion or
their caching.

---

## Failure handling

| What | Result |
| --- | --- |
| card id not in the catalog | 404, standard envelope, nothing enqueued, no cooldown set |
| inside the cooldown | 200, `queued: false`, remaining TTL |
| below the daily reserve | 200, `queued: false`, seconds to UTC midnight |
| Redis unreachable | see below |

**Redis unreachable is the interesting one**, because two different Redis
interactions sit in this path and they want opposite failure modes.

The cooldown is a lock. It is taken through `RedisService` directly, and a
failure to take it must **not** be read as "the lock is free" — that would let
every request through at the moment the system is least able to cope.

But refusing it *as though the cooldown were held* would be a lie: it would tell
a caller their card was refreshed recently when in fact nothing could be checked.
So a cooldown that cannot be taken answers **503**, with no body pretending to be
a cooldown state. The read endpoint is unaffected and still serves the price from
the database, which PD-51 measured at 68 ms with Redis stopped — so a client that
wants the figure has somewhere to get it.

The budget check fails **open**, by PD-49's design, and that stays: with Redis
down the reserve cannot be read, and the precedent is to proceed rather than halt
all synchronisation over a cache blip. In this path that difference never
surfaces, because the cooldown is taken first and its 503 ends the request before
the budget is consulted.

The two rules differ because a lock and a budget estimate are different kinds of
thing — the warning `cache.keys.ts` already carries beside `lockKeys`.

---

## Verification plan

No automated tests (`docs/PRD.md` §20). Measurements against the running stack.

1. **A refresh enqueues one job and returns immediately.** The response carries the card's current price, `queued: true`, and a `retryAfterSeconds` equal to the configured cooldown. Timed: the call returns in milliseconds, not the seconds a provider round trip takes.
2. **Two requests inside the window enqueue one job.** Issue them **concurrently**, not in sequence — sequential requests would pass a check-then-set implementation too, and the criterion is about the race. Confirm exactly one job appears on `bull:price-sync` and the second response carries `queued: false` with a remaining wait.
3. **The job actually refreshes the card.** After it completes, `priceUpdatedAt` has moved and `cache:price:card:{id}` is gone — the delete PD-48 performs, now removing a key PD-51 creates.
4. **The cooldown expires.** With a short configured TTL, a third request after it passes enqueues again.
5. **An unknown card is a 404**, and leaves no cooldown key behind.
6. **The reserve refuses.** Set the day's counter near the limit by hand; the response is 200 with `queued: false` and a `retryAfterSeconds` pointing at UTC midnight, and **no cooldown key is created** — nothing was spent.
7. **A session is required.** Without one the route answers 401 rather than refreshing.
8. **A cooldown that cannot be taken answers 503**, and this one *is* reachable over HTTP: with Redis stopped the API still serves — PD-51 measured the price read at 68 ms in that state — and the cooldown is attempted before anything touches the queue. Stop Redis, POST, expect **503** rather than a 200 claiming a cooldown, and confirm `GET /cards/:id/price` still answers 200 beside it.
9. **Gates.** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`.

Point 2 is the one that distinguishes this implementation from one that merely
looks right, and it is the only one that must be run concurrently to mean
anything.

---

## Files

**New**

| Path | Holds |
| --- | --- |
| `apps/api/src/prices/price-refresh.service.ts` | the cooldown, the budget check, the enqueue |

**Edited**

| Path | Change |
| --- | --- |
| `apps/api/src/prices/prices.controller.ts` | the `POST` route |
| `apps/api/src/prices/prices.module.ts` | register the new service, import `QueueModule`, **export `PricesService`** |
| `apps/api/src/prices/index.ts` | export the new service |
| `apps/api/src/redis/cache.keys.ts` | `throttleKeys.priceRefresh(cardId)` |
| `packages/shared/src/entities/price.ts` | `PriceRefreshResultSchema` |
| `apps/api/src/config/env.schema.ts`, `app.config.ts`, `.env.example` | the cooldown TTL and the reserve |
| `docs/API.md`, `apps/api/src/sync/README.md` | the endpoint, and that `price-sync` finally has a producer |

No migration. Nothing here changes the schema.

---

## Out of scope

| Not here | Where |
| --- | --- |
| **Admin "Sync prices now"** | the ticket's scope line says this reuses "the same producer for the full catalog". **There is no such producer**: PD-49 built a coordinator that walks the catalog itself and never enqueues to `price-sync`. Admin sync control is PD-81, in M10 |
| A refresh button, or any UI | M13 |
| Refreshing more than one card per request | nothing asks for it; the batch path is the scheduled jobs' |
| Per-user quotas or attribution of spend | the daily reserve bounds the total; who spent it is an admin-metrics question, PD-82 |
| Registering the `moderate` throttle tier | it would retune every route in the service; see §Measured |

---

## Forward notes

**M4 closes here, and the budget is the thing it leaves behind.** Catalog ~250,
sweep ~250, active ~120, on-demand bounded by its reserve — roughly 620 committed
of 1 000, against a provider that is deprecated and stops serving keys on
2027-03-01. The next ticket that wants a scheduled provider call has to take it
from one of these four, and `RequestBudgetService` is where it will find that out.

**The cooldown is per card and not per card per user**, deliberately. Two people
looking at the same card want the same fresh price, and the second one should get
the first one's refresh rather than paying for a duplicate.

**`price-sync` gets its first real traffic here.** Every measurement PD-48
recorded against that processor came from a probe enqueuing by hand. The first
criterion of this ticket is also the first evidence that the queue works the way
its docblock has claimed since M4 began.
