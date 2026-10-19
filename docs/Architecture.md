# Architecture

> System architecture for the PokéDex TCG web application. Derived from [PRD.md](PRD.md).
> Sibling references: [DataModel.md](DataModel.md) · [API.md](API.md) · [InformationArchitecture.md](InformationArchitecture.md)

## 1. Guiding principles

1. **Local catalog-mirror.** Card metadata and prices are synced from external Pokémon APIs into our own PostgreSQL on a schedule. **All user-facing reads are served from our DB + Redis and never block on a third party.**
2. **Read from DB/cache, write to external only via jobs.** External APIs are touched exclusively by scheduled BullMQ workers — never on a user request path.
3. **Thin controllers / fat services.** Business logic lives in services; controllers only validate + delegate.
4. **Typed end-to-end.** Shared Zod/DTO contracts across backend and frontend.
5. **Correctness by construction.** Money/item/trade mutations run inside DB transactions with idempotency keys and quantity locking — no dupe, loss, or double-spend.
6. **Swappable providers.** External card sources sit behind one adapter interface so the Scrydex upgrade is a one-file change.

## 2. High-level topology

```
                     ┌──────────────────────────────────────────────┐
   Browser  ───────▶ │  Next.js (App Router) — the only origin      │
                     │  RSC + Client Components · TanStack Query ·  │
                     │  Zustand · shadcn/ui · dnd-kit · three.js    │
                     └───────────────┬──────────────────────────────┘
                                     │  /api/* rewrite + server renders
                                     │  (REST/JSON, session cookie)
                                     ▼
                     ┌──────────────────────────────────────────────┐
                     │  NestJS API                                  │
                     │  Auth · Users · Catalog · Inventory · Decks  │
                     │  Packs · Trades · Prices · Wallet · Admin    │
                     │  Guards (Csrf/Session/Throttler/Roles)       │
                     └───┬───────────────┬───────────────┬──────────┘
                         │               │               │
              ┌──────────▼───┐   ┌───────▼──────┐   ┌─────▼───────────┐
              │ PostgreSQL   │   │    Redis     │   │  BullMQ workers │
              │ (Prisma)     │   │ cache+queues │   │ price/catalog   │
              │ source of    │   │              │   │ sync, trade     │
              │ truth        │   │              │   │ cleanup         │
              └──────────────┘   └──────────────┘   └───────┬─────────┘
                                                            │ scheduled
                                                            ▼
                                          ┌───────────────────────────────┐
                                          │  External APIs (never on the  │
                                          │  user request path):          │
                                          │  pokemontcg.io v2 (primary),  │
                                          │  TCGdex (fallback/i18n),      │
                                          │  Scrydex (upgrade), PokéAPI   │
                                          └───────────────────────────────┘
```

### What lives where

| Store | Role |
|---|---|
| **PostgreSQL** | Source of truth: users, roles, mirrored card catalog, inventory, decks, trades, pack config, price history. |
| **Redis** | Cache of hot reads (card detail, sets, facets, latest price), rate-limit counters, BullMQ queues, idempotency locks. |
| **External API** | Reached only by scheduled background jobs (catalog sync, price refresh) — with one exception: the card page's Pokédex section reads PokéAPI from the web server at request time (D9 in `Pages.md`), cached a day, two-second timeout, absent on any failure. |

## 3. External API strategy

| Concern | Decision |
|---|---|
| Primary card + price source | **pokemontcg.io API v2** — free. Anonymous ceiling 1 000 req/day, 30/min (documented, not observed — no rate-limit header on any response, verified 2026-09-21); a key raises the daily figure to 20 000, but **registration is closed** — the API is deprecated and existing keys work only through 2027-03-01. Card object embeds TCGPlayer (USD) + Cardmarket (EUR) prices |
| Fallback / multilingual / self-host | **TCGdex** — free, no key, REST + GraphQL, 14 languages, Docker-self-hostable |
| Documented production upgrade, **not used in v1** — but see below | **Scrydex** — commercial successor of pokemontcg.io, credit-based, SLA-backed. Paid, and v1 uses no paid services (`docs/PRD.md` §2, API strategy); kept as the escape hatch this adapter makes cheap |
| Optional species enrichment | **PokéAPI** — Pokédex base stats/flavor for the card detail page only |
| Rejected | Direct TCGPlayer API (closed) and scraping TCGPlayer/eBay (ToS-prohibited) |

### Scrydex is already in the mirror, as an image host

Measured 2026-09-21, against the live catalog: **852 of 20 670 cards (4%) carry
image URLs on `images.scrydex.com` rather than `images.pokemontcg.io`.** They
are newer sets — `me5` and its neighbours.

This is not a decision anyone took. It is what the primary provider serves:

```
GET api.pokemontcg.io/v2/cards/me5-108
  → images.small = https://images.scrydex.com/pokemon/me5-108/small
```

Nothing here is paid and no Scrydex API is called; pokemontcg.io simply hands
out URLs on its commercial successor's CDN, and the mirror stores what it is
given. So the "no paid services" rule in `docs/PRD.md` §2 is intact.

**What is not intact is the assumption that v1 depends only on the sources
listed above.** If Scrydex starts hotlink-protecting or metering that CDN, 4% of
the catalog renders broken images, and the cause will not be obvious from
anything in this repository — the URLs look like ordinary provider data.

Recorded rather than fixed. The fix is mirroring images to storage we control,
which is a real piece of work with its own cost, and the right time to take it
is when images are being served for real rather than now. Whoever plans that
should know the count is growing: it covers the newest sets, so it rises with
every release pokemontcg.io ingests.

### Provider adapter pattern

All external sources implement a common `CardSourceProvider` interface:

```
CardSourceProvider
  name: CardSourceName
  fetchSets(): Promise<SetDTO[]>
  fetchCards(params): Promise<CardPage>
  fetchPrices(cardIds): Promise<PriceDTO[]>
```

`fetchCards` returns a page — `{ items, skipped, page, pageSize, total, hasMore }` — rather than a flat array. The catalog sync has to resume after a crash and has to page across the whole catalog, and a provider that loops internally makes both impossible: the caller never sees a page boundary to resume from, and an entire catalog lands in memory before anything returns. `skipped` carries items that failed to parse, so one malformed card does not discard the good ones beside it.

`PokemonTcgClient` is the default; `TcgdexClient` is a fallback the sync layer switches to on repeated failures. The rest of the app is source-agnostic, and `CARD_SOURCE_PROVIDER` in the environment is the whole of choosing between them. The seam lives in `apps/api/src/sync/providers/`, and an ESLint rule keeps provider internals behind its `index.ts`.

Both are implemented. They fail in opposite directions, which is the point:
pokemontcg.io is cheap in requests and answered 6 of 20 when measured, TCGdex is
one request per card and answered 10 of 10. A full TCGdex sweep is 23 736
requests against the primary's 83, and takes 15 to 25 minutes end to end at the
concurrency of 8 the client holds to.

**Their set ids diverge on newer sets** — `sv3pt5` against `sv03.5` — so 73.6%
of the mirror shares an id with TCGdex and 26.4% does not. Switching providers
on a populated database forks the catalog silently; PD-43 carries the rules that
make failing over safe.

## 4. Backend module structure (NestJS)

As built (`apps/api/src`):

```
src/
├── main.ts                      # bootstrap: helmet, request id, metrics, CORS, the Better Auth
│                                #   route, body parsers, /api + URI versioning, Swagger, 404 handler
├── worker.ts                    # second entrypoint: no HTTP, crons + queue processors
├── app.module.ts                # global guards (order matters), ZodValidationPipe, AllExceptionsFilter
├── worker.module.ts
├── common/
│   ├── guards/                  # CsrfGuard, SessionGuard, RolesGuard
│   ├── decorators/              # @CurrentUser, @Roles, @Public
│   ├── errors/                  # envelope, domainError, Prisma error mapping, 404 handler
│   ├── filters/                 # AllExceptionsFilter
│   ├── pipes/                   # ZodValidationPipe
│   └── *.ts                     # openapi (@Doc), zod-dto, ownership (assertOwner), request-id,
│                                #   request-auth, cursors, throttle policies
├── config/                      # Zod env schema → typed AppConfig (APP_CONFIG token)
├── logging/                     # buildLoggerOptions, shared by both entrypoints
├── prisma/                      # PrismaService (driver adapter, withTransaction)
├── redis/                       # RedisService, CacheService, every key builder
├── queue/                       # BullMQ queue registration, job defaults, sync dedup
├── throttle/                    # Redis throttler storage, the /api/auth/* limiter middleware
├── auth/                        # Better Auth instance (AUTH_INSTANCE) — see auth/README.md
├── mail/                        # nodemailer transport (pooled), templates
├── economy/                     # welcome grant
├── audit/                       # AuditService.record(tx, …)
├── metrics/                     # request/error counters, daily activity
├── users/                       # profile, privacy, showcase, progress, collector search
├── catalog/                     # cards, sets, facets — read from the mirror
├── prices/                      # latest price, history, on-demand refresh
├── inventory/                   # owned cards, summary, owned counts
├── packs/                       # templates, generator, seeded RNG, transactional open
├── decks/                       # CRUD, validation, stats, random deck generator
├── trades/                      # propose/accept/decline/counter/cancel, settlement, expiry, void
├── wallet/                      # balance + ledger
├── notifications/               # notification centre
├── sync/                        # catalog + price processors and schedulers
│   └── providers/               # CardSourceProvider, PokemonTcgClient, TcgdexClient,
│                                #   breaker, request budget, provider selector
├── admin/  admin-users/  admin-audit/   # admin metrics, sync control, users, audit log
└── health/                      # /health/live, /health/ready (terminus)
```

Module READMEs carry the details that do not fit here: [`auth`](../apps/api/src/auth/README.md), [`queue`](../apps/api/src/queue/README.md), [`sync`](../apps/api/src/sync/README.md), [`inventory`](../apps/api/src/inventory/README.md), [`metrics`](../apps/api/src/metrics/README.md).

### Recommended libraries

`@nestjs/config`, a local `createZodDto` helper for Zod DTOs and their OpenAPI schemas (not `nestjs-zod`, whose peer ranges stop at `@nestjs/common` 11 and `@nestjs/swagger` 11 while this repo runs 12 of both), `@nestjs/throttler`, `helmet`, `nestjs-pino` + `pino-http`, `@nestjs/terminus`, `@nestjs/bullmq`, `ioredis` (see Cache implementation below), `@nestjs/schedule`. Testing: **none during v1** — automated tests are deferred, see [PRD.md](PRD.md) §20. Quality: ESLint + `typescript-eslint`, Prettier, Husky + lint-staged, commitlint.

### Database access (Prisma 7)

Prisma 7 changed two things that are easy to trip over, so they are written down here:

- **The datasource block no longer accepts `url`.** Connection details for the CLI live in `apps/api/prisma.config.ts`. That file also loads the repository-root `.env` explicitly, because Prisma 7 stopped reading `.env` on its own — without it `prisma migrate` fails with *"datasource.url property is required"*.
- **The client needs a driver adapter.** `PrismaService` constructs `PrismaPg` from the validated config in `src/config`, so the connection string still has exactly one source of truth and never reaches the client as a raw `process.env` read.

The generator stays on `prisma-client-js`, which emits into `node_modules` as before. The newer `prisma-client` generator emits TypeScript into the repository, which would pull generated code into `tsconfig`, the build and linting for no benefit here.

Versions are pinned: `prisma` and `@prisma/client` must match exactly, and at the time of writing the `latest` dist-tag for `prisma` points at an 8.0 release candidate while `@prisma/client` is on stable 7. Installing both without pins produces mismatched majors.

**`withTransaction`** on `PrismaService` is the primitive behind both transactional cores in section 9. Nothing should call `$transaction` directly.

### Logging

`nestjs-pino` wraps `pino-http`. `app.useLogger` routes Nest's own `Logger` through it, so every existing `new Logger(SomeService.name)` becomes a pino child with `context` as a field — no service had to change. All options live in one exported `buildLoggerOptions(config)` so the BullMQ worker entrypoint can import the same configuration rather than repeat it.

Four choices that are not defaults and should not be quietly reverted:

- **`genReqId` returns the id the request-id middleware already set.** Letting pino mint its own would put a different id in the log from the one in the error envelope and the `X-Request-Id` header.
- **`customLogLevel` maps status to level.** Without it `pino-http` writes every completion line at `useLevel`, which is `info` — a 500 would be logged at the same level as a successful read, and an alert on `level >= error` would never fire.
- **Request headers are an allowlist, not a redaction list.** The default serializer logs every header, so any future bearer-style header would be logged in full from the day it is introduced. `redact` paths are kept as a second layer in case the serializer is ever widened.
- **The response serializer emits the status code only.** The default includes response headers, and `Set-Cookie` on a sign-in response is a session handed to whoever can read the log.

Request bodies are never serialized, so a password in a sign-up payload does not reach the log at all.

`autoLogging.ignore` drops the liveness route and nothing else. An orchestrator polls it every few seconds forever, and a line saying "the process exists" is one nobody will read. Readiness is deliberately still logged: a readiness probe that fails is the signal that an instance has stopped serving.

A failure at 500 or above produces two lines: the completion line carrying `responseTime`, and a record from `AllExceptionsFilter` carrying the real cause and stack. They correlate on `req.id`. Both are needed — the filter answers the request itself, so Express never sees the exception and `pino-http` can only report "failed with status code 500".

The query string is logged as part of the URL, which is worth having for catalog searches. Anything token-bearing added to a query string later must be redacted here first.

## 5. Frontend architecture (Next.js)

```
app/
├── (public)/                    # no session: landing + the shareable pages
│   ├── cards/  sets/            # catalog and sets gallery — public since PD-108/PD-109
│   ├── cards/[id]/              # card detail (SEO)
│   ├── profile/[id]/            # public profile, also "My profile"
│   └── decks/[id]/              # public deck, or the owner's builder
├── (auth)/                      # register, verify-email, sign-in, forgot/reset password
├── (app)/                       # session required, app shell
│   ├── dashboard/  packs/  inventory/  decks/
│   ├── trades/  settings/  wallet/  notifications/
│   └── admin/                   # role = ADMIN, admin sub-nav
├── (dev)/dev/components/        # component gallery: next dev, or COMPONENT_GALLERY=1
components/
├── ui/                          # shadcn/ui primitives, owned by the repo
├── shell/                       # sidebar, topbar, theme switch, footer
├── admin/  auth/  cards/  catalog/  collection/  dashboard/  decks/
├── inventory/  landing/  notifications/  packs/  profile/  settings/
└── trades/  wallet/
lib/
├── api/                         # typed fetch client: core, browser, server (server-only), endpoints/
├── session/                     # getSession, SessionProvider/useSession, cookie check
├── query/                       # TanStack Query client, keys, invalidation map, hooks
├── stores/                      # Zustand vanilla stores (deck draft, pack reveal, UI)
├── theme/                       # theme cookie + provider (System · Light · Dark)
├── design/                      # rarity, energy and status styles
├── pokeapi.ts                   # the one request-time external call (server-only)
└── routes.ts  route-access.ts   # public paths, safeNext; what the proxy protects
proxy.ts                         # Next middleware: sign-in redirect, session renewal, admin check
```

Forms validate with the schemas from `@pokedrop/shared` directly; there is no separate validators folder.

### Rendering & state strategy

- **Server Components** for read-heavy pages (card detail, public profiles, set lists) — fast first paint + SEO.
- **Client Components** for interactive surfaces (deck builder, pack reveal, trade composer).
- **TanStack Query** owns server state; **Zustand** owns ephemeral client state (deck draft, reveal sequence, modals).
- Forms via **React Hook Form + Zod**. Toasts via **Sonner**. Theming via a `theme` cookie, `data-theme` on `<html>` and a CSS `@variant light` (PD-139; `next-themes` removed). Animations are CSS keyframes defined as tokens in `globals.css` (plus `tw-animate-css`), with timers that check `prefersReducedMotion()`; the landing's 3D hero and pack showcase use **three.js**, loaded with `import('three')`. The Motion library was planned and never installed. Drag-and-drop via **dnd-kit** (`@dnd-kit/core` only: the decklist has no order to sort). The deck validator and the deck stats are pure functions in `@pokedrop/shared` (`validateDeck`, `toDeckStats`), run by the API on save and by the deck builder on every draft change, so the two cannot disagree about the same inputs (PD-113). Dense tables via **TanStack Table**. Charts via **Recharts**, admin metrics included (Tremor was planned for admin and not used). Instant client narrowing of already-fetched pages by the server's own name predicate (`lib/name-match.ts`), not Fuse.js: fuzzy matching would show cards the server does not return (PD-107). Long lists are virtualized with **TanStack Virtual**.

## 6. Request data flow (read path)

```
Client → TanStack Query → NestJS controller → service
   → Redis GET (hit → return)
   → on miss: Prisma SELECT → Redis SET (TTL) → return
```

No user read ever calls an external API. See [caching](#8-caching-strategy).

## 7. Background sync (write-to-mirror path)

Prices are **never fetched on the user request path.** `@nestjs/schedule` cron triggers enqueue BullMQ jobs:

- **Nightly full sweep** — refresh prices for the whole catalog in batches, respecting rate limits (bounded concurrency + exponential backoff on 429). It counts every request against the daily allowance in §3 and stops for the night while a reserve remains unspent, rather than trusting the batch arithmetic to stay under the ceiling.
- **Frequent "active" refresh** (every few hours) — prioritize cards that are *owned*, *in a deck*, *recently traded*, or *trending/viewed*. Keeps user-visible prices fresh without burning quota on the long tail.
- **On-demand** — admin "Sync prices now" and per-card refresh with a cooldown.

As built, the crons live in the worker only (`ScheduleModule` is in `WorkerModule`), all in UTC: catalog sync 03:00, full price sweep 04:00, active refresh 05:00/11:00/17:00/23:00, trade expiry hourly at :15. `SYNC_SCHEDULES=false` removes the three sync crons at start and leaves only the admin's **Run now** — production runs that way ([Deployment.md](Deployment.md)). The API process also registers the sync processors, so an admin-triggered job runs even with the worker down; only trade expiry needs the worker. Every request to pokemontcg.io is counted against `POKEMONTCG_DAILY_REQUEST_BUDGET` in Redis, and each job leaves a reserve for the ones after it (`PRICE_*_RESERVE`). Details in [`apps/api/src/queue/README.md`](../apps/api/src/queue/README.md) and [`apps/api/src/sync/README.md`](../apps/api/src/sync/README.md).

**Write path per card:** fetch latest → `UPDATE Card` price fields → `INSERT PriceSnapshot` (≤1/card/day) → `DEL cache:price:card:{id}` in Redis. The ≤1/card/day cap is a unique index on `(cardId, source, capturedOn)`, not a job behaviour — a second run in a day still refreshes the card's latest columns even though it writes no new snapshot.

**Failure handling:** retry with backoff; five consecutive *escaped* failures —
those that survived the client's own retry budget — open a per-provider circuit
breaker for 30 minutes, and the **next** run is served by the fallback. Not the
same batch: the two providers disagree about set ids on 50 of 176 sets, so a
mid-run switch would fork the catalog rather than rescue it. A rate limit never
counts toward the breaker. Sync status, the provider that served the last run
and the breaker state surface on `GET /admin/sync/status`.

## 8. Caching strategy (Redis)

| Data | Key | TTL | Invalidation |
|---|---|---|---|
| Card detail payload | `cache:card:{id}` | 24h | on catalog sync, and on a price write for that card |
| Latest price | `cache:price:card:{id}` | 3599s (measured; configured 3600s) | on price job write |
| Set list / detail | `cache:sets`, `cache:set:{id}` | 24h | on catalog sync |
| Search facets | `cache:facets` | 24h | on catalog sync |
| Inventory summary | `cache:inv:summary:{userId}` | 5m | on inventory mutation |
| Admin metrics | `cache:admin:metrics:{days}` | 60s | expiry |
| Rate-limit counters | `throttle:{key}`, `throttle:block:{key}` | window | auto-expire |
| Resend / price-refresh cooldowns | `throttle:resend:{email}`, `throttle:price:refresh:{cardId}` | `MAIL_RESEND_COOLDOWN`, `PRICE_REFRESH_COOLDOWN` | auto-expire |
| Provider breaker | `breaker:fail:{provider}`, `breaker:open:{provider}` | 30 min open | admin reset |
| Provider request budget | `budget:{provider}:{YYYY-MM-DD}` | the UTC day | auto-expire |
| Daily counters | `metrics:{name}:{YYYY-MM-DD}` | — | — |
| Pack-open idempotency lock | `lock:open:{openId}` | 10 s | after commit |
| Trade expiry / queues | BullMQ `bull:*` in db 1 | — | job lifecycle |

All keys are built in `apps/api/src/redis/cache.keys.ts`. Only the `cache:` namespace is a cache; `throttle:`, `breaker:`, `budget:` and `metrics:` sit outside it on purpose, so a routine cache flush cannot reset a rate limit, a breaker or a day's request count.

Principle: cache read-heavy low-volatility catalog data aggressively; keep user-specific/volatile data short-TTL or uncached; always pair a write with explicit invalidation. The same Redis powers cache and BullMQ, kept apart by both a separate logical database and a key prefix.

### Cache implementation

`apps/api/src/redis` holds a thin `CacheService` built directly on `ioredis`, rather than on `cache-manager`. Three reasons, in order of weight:

- `invalidate(pattern)` is a requirement of the table above, and neither `cache-manager` nor `Keyv` can delete by pattern. That needs `SCAN` on a raw client regardless, so the abstraction would have been bypassed for the operation that matters most.
- The ioredis store for `cache-manager` (`cache-manager-ioredis-yet`) is deprecated by its maintainer as of `cache-manager` v6, which moved to Keyv. It still composes through the exported `KeyvAdapter`, but only as a compatibility shim.
- The supported Keyv store, `@keyv/redis`, speaks `node-redis`; `@keyv/ioredis` does not exist. BullMQ requires ioredis, so the supported path means two Redis client libraries and two connection pools in one process.

Conventions that follow from this:

- **Keys are built in `cache.keys.ts` and nowhere else.** A mistyped key literal is a permanent silent cache miss, which presents as mild slowness rather than as a bug.
- **The `cache:` prefix is part of the key, not ioredis' `keyPrefix` option.** `keyPrefix` is not applied to `SCAN`'s `MATCH` pattern, and the keys `SCAN` returns already carry the prefix — passing those to `del` on the same client prefixes them a second time and deletes nothing, with no error raised. A pattern invalidation would report success and do nothing.
- **`invalidate` refuses any pattern outside the `cache:` namespace.** The queue has its own logical database, but that separation is one edited line of `.env` away from vanishing.
- **TTLs live in `buildAppConfig` under `cache.ttl`,** exposed on `CacheService.ttl` so that reaching for a configured TTL is easier than writing a number.
- **Cache failures are logged and treated as misses.** A cache that throws converts a degraded dependency into an outage. This is also why the pack-open idempotency lock must not be taken through `CacheService`: a lock needs `SET NX PX` and needs failures to be fatal.
- **Pass a Zod schema to `get`/`getOrSet` for anything containing dates.** JSON has no date type, so a cached `Date` reads back as a string while the type system still claims it is a `Date`.

## 9. Transactional cores

Two operations are the backbone of correctness — both fully specified in [UserFlows.md](UserFlows.md):

- **Pack opening** — weighted rarity generation, then a single Prisma transaction that debits currency, records the opening, and mints inventory. Guarded by `openId` idempotency.
- **Trade settlement** — quantity-locking escrow while pending, then a single atomic swap transaction on accept. Rolls back entirely on any failed check.

## 10. Performance & scalability

- Serve from mirror + cache so external latency/limits never reach users.
- DB indexes on hot columns (see [DataModel.md](DataModel.md)).
- Pagination + cursors for inventory/catalog; no unbounded queries.
- Card images are hotlinked from the providers' CDNs; mirroring them to storage we control is the open item from §3.
- Virtualized lists for large collections; memoized TanStack Query selectors.
- N+1 avoidance via Prisma `include`/`select`.
- `next/image` serves card art through the web server's optimizer; converted copies are kept a month (`minimumCacheTTL`) and, in production, in the `web-image-cache` volume. Allowed hosts are `CARD_IMAGE_HOSTS` in `apps/web/lib/images.ts`.
- **Stateless API** → horizontal scaling behind a load balancer: sessions live in Postgres, cache, rate limits, locks and queues in Redis. Two things are per process and would need a look before a second replica: Better Auth's own production sign-in limiter (in memory) and `ActivityService`'s set of users already recorded today (harmless — the primary key absorbs the duplicates).
- **Workers scale independently** from the API; sync throughput tuned by concurrency. The crons must stay in exactly one process.
- **Production today is one host** with one replica of each service ([Deployment.md](Deployment.md)); everything above is headroom, not something that runs.
- Postgres read replicas for catalog/analytics if needed.
- `PriceSnapshot` is the fastest-growing table — partition by time or downsample (keep dailies, roll up weeklies).

## 11. Key decisions at a glance

1. Mirror the catalog locally → resilience + speed + rate-limit safety.
2. Provider adapter pattern → pokemontcg.io primary, TCGdex fallback, Scrydex upgrade.
3. Transactions + idempotency + quantity locking → correct packs and trades.
4. Better Auth hosted inside NestJS → single source of auth truth sharing the Prisma client.
5. Two-speed price sync → freshness vs quota.
6. Simple two-role RBAC now, CASL-ready later.

## 12. Authentication in one paragraph

Better Auth runs inside the API, mounted on Express at `/api/auth/*` ahead of the Nest router, writing `users`, `sessions`, `accounts` and `verifications` through the same `PrismaService` as everything else. A session is an opaque token in an httpOnly cookie — no JWT, no refresh token — and the global guards resolve it on every `/api/v1` request: `CsrfGuard` → `SessionGuard` → `ThrottlerGuard` → `RolesGuard`, protected by default with `@Public()` as the exception. The browser talks only to the web origin, whose `/api/*` rewrite forwards to the API. [Security.md](Security.md) maps the whole of it; [`apps/api/src/auth/README.md`](../apps/api/src/auth/README.md) holds the provider details and what was measured.
