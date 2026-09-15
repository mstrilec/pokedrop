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
   Browser  ───────▶ │  Next.js (App Router)                        │
                     │  RSC + Client Components · TanStack Query ·   │
                     │  Zustand · shadcn/ui · dnd-kit · Motion       │
                     └───────────────┬──────────────────────────────┘
                                     │  HTTPS (REST/JSON, cookie/JWT)
                                     ▼
                     ┌──────────────────────────────────────────────┐
                     │  NestJS API                                   │
                     │  Auth · Users · Catalog · Inventory · Decks · │
                     │  Packs · Trades · Prices · Admin              │
                     │  Guards (Auth/Role) · Swagger · Throttler     │
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
| **External API** | Reached only by scheduled background jobs (catalog sync, price refresh). |

## 3. External API strategy

| Concern | Decision |
|---|---|
| Primary card + price source | **pokemontcg.io API v2** — free, ~20k req/day with key; card object embeds TCGPlayer (USD) + Cardmarket (EUR) prices |
| Fallback / multilingual / self-host | **TCGdex** — free, no key, REST + GraphQL, 14 languages, Docker-self-hostable |
| Documented production upgrade | **Scrydex** — commercial successor of pokemontcg.io, credit-based, SLA-backed; drop-in when a contract is required |
| Optional species enrichment | **PokéAPI** — Pokédex base stats/flavor for the card detail page only |
| Rejected | Direct TCGPlayer API (closed) and scraping TCGPlayer/eBay (ToS-prohibited) |

### Provider adapter pattern

All external sources implement a common `CardSourceProvider` interface:

```
CardSourceProvider
  fetchSets(): Promise<SetDTO[]>
  fetchCards(params): Promise<CardDTO[]>
  fetchPrices(cardIds): Promise<PriceDTO[]>
```

`PokemonTcgClient` is the default; `TcgdexClient` is a fallback the sync layer switches to on repeated failures. The rest of the app is source-agnostic.

## 4. Backend module structure (NestJS)

```
src/
├── main.ts                      # bootstrap, helmet, CORS, Swagger, global pipes
├── app.module.ts
├── common/
│   ├── guards/                  # JwtAuthGuard, RolesGuard
│   ├── decorators/              # @CurrentUser, @Roles, @Public
│   ├── interceptors/            # logging, serialization, timeout
│   ├── filters/                 # global exception filter
│   ├── pipes/                   # ZodValidationPipe
│   └── dto/                     # shared response envelopes, pagination
├── config/                      # @nestjs/config, env schema (Zod), typed config
├── prisma/                      # PrismaModule + PrismaService
├── redis/                       # ioredis client, CacheService, key builders
├── auth/                        # Better Auth integration, sessions, guards
├── users/                       # profile, currency, roles
├── catalog/                     # cards, sets — read from mirror; search
├── inventory/                   # owned card instances, aggregates
├── decks/                       # deck CRUD, validation, legality
├── packs/                       # pack templates, opening logic (transactional)
├── trades/                      # offer/accept/counter, escrow, atomic swap
├── prices/                      # latest price reads, history, sparkline data
├── sync/                        # BullMQ producers/consumers for catalog+price sync
│   ├── catalog-sync.processor.ts
│   ├── price-sync.processor.ts
│   └── providers/               # PokemonTcgClient, TcgdexClient, adapter interface
├── admin/                       # admin-only endpoints & dashboards
├── notifications/               # trade/system notifications
└── health/                      # @nestjs/terminus liveness/readiness
```

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
├── (marketing)/                 # public landing, login, register
├── (app)/
│   ├── dashboard/
│   ├── packs/                   # open packs + reveal
│   ├── inventory/
│   ├── decks/[deckId]/          # builder
│   ├── cards/[cardId]/          # detail page
│   ├── profile/[userId]/        # public profile
│   ├── trades/                  # inbox, propose, detail
│   └── admin/                   # role-gated
├── api/                         # optional route handlers / BFF proxy
components/
├── ui/                          # shadcn/ui primitives
├── cards/  decks/  packs/  trades/  charts/
lib/
├── api-client.ts                # typed fetch wrapper (shared Zod schemas)
├── query/                       # TanStack Query hooks + keys
├── stores/                      # Zustand (deck-builder draft, pack-reveal, UI)
└── validators/                  # Zod schemas shared with forms
```

### Rendering & state strategy

- **Server Components** for read-heavy pages (card detail, public profiles, set lists) — fast first paint + SEO.
- **Client Components** for interactive surfaces (deck builder, pack reveal, trade composer).
- **TanStack Query** owns server state; **Zustand** owns ephemeral client state (deck draft, reveal sequence, modals).
- Forms via **React Hook Form + Zod**. Toasts via **Sonner**. Theming via **next-themes**. Animations via **Motion**. Drag-and-drop via **dnd-kit**. Dense tables via **TanStack Table**. Charts via **Recharts** (Tremor for admin). Instant client filtering via **Fuse.js** over already-fetched pages.

## 6. Request data flow (read path)

```
Client → TanStack Query → NestJS controller → service
   → Redis GET (hit → return)
   → on miss: Prisma SELECT → Redis SET (TTL) → return
```

No user read ever calls an external API. See [caching](#8-caching-strategy).

## 7. Background sync (write-to-mirror path)

Prices are **never fetched on the user request path.** `@nestjs/schedule` cron triggers enqueue BullMQ jobs:

- **Nightly full sweep** — refresh prices for the whole catalog in batches, respecting rate limits (bounded concurrency + exponential backoff on 429).
- **Frequent "active" refresh** (every few hours) — prioritize cards that are *owned*, *in a deck*, *recently traded*, or *trending/viewed*. Keeps user-visible prices fresh without burning quota on the long tail.
- **On-demand** — admin "Sync prices now" and per-card refresh with a cooldown.

**Write path per card:** fetch latest → `UPDATE Card` price fields → `INSERT PriceSnapshot` (≤1/card/day) → `DEL price:card:{id}` in Redis.

**Failure handling:** retry with backoff; after N failures switch to fallback provider for that batch. Sync status + last-run timestamps surface on the admin dashboard; stale prices show an "updated X ago" label rather than being hidden.

## 8. Caching strategy (Redis)

| Data | Key | TTL | Invalidation |
|---|---|---|---|
| Card detail payload | `card:{id}` | 24h | on catalog sync of that card |
| Latest price | `price:card:{id}` | 1–6h | on price job write |
| Set list / detail | `sets`, `set:{id}` | 24h | on catalog sync |
| Search facets | `facets` | 24h | on catalog sync |
| Inventory summary | `inv:summary:{userId}` | 5m | on inventory mutation |
| Rate-limit counters | `throttle:{route}:{userId}` | window | auto-expire |
| Pack-open idempotency lock | `lock:open:{openId}` | short | after commit |
| Trade expiry / queues | BullMQ namespaces | — | job lifecycle |

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
- `next/image`; consider mirroring card images to own object storage/CDN.
- Virtualized lists for large collections; memoized TanStack Query selectors.
- N+1 avoidance via Prisma `include`/`select`.
- **Stateless API** → horizontal scaling behind a load balancer; sessions/cache in Redis.
- **Workers scale independently** from the API; sync throughput tuned by concurrency.
- Postgres read replicas for catalog/analytics if needed.
- `PriceSnapshot` is the fastest-growing table — partition by time or downsample (keep dailies, roll up weeklies).

## 11. Key decisions at a glance

1. Mirror the catalog locally → resilience + speed + rate-limit safety.
2. Provider adapter pattern → pokemontcg.io primary, TCGdex fallback, Scrydex upgrade.
3. Transactions + idempotency + quantity locking → correct packs and trades.
4. Better Auth hosted inside NestJS → single source of auth truth sharing the Prisma client.
5. Two-speed price sync → freshness vs quota.
6. Simple two-role RBAC now, CASL-ready later.
