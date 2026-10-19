# PokéDrop

A **Pokémon TCG web application** for opening booster packs, building a personal collection, assembling decks, browsing rich card detail pages, and trading cards with other users — all behind role-gated authentication.

> **Status:** the v1 feature set is built and runs in production on a home server behind Tailscale Funnel ([Deployment.md](docs/Deployment.md)). There are no automated tests, by decision ([PRD.md](docs/PRD.md) §20).

## What it does

- **Booster pack opening** — spend in-app coins to open packs with admin-configurable weighted rarity slots, modelled on nineteen real boosters from Base Set (1999) to Mega Evolution (2025), and a card-by-card reveal.
- **Inventory (collection)** — a virtualized grid/list of owned cards with filters, sorting, collection value and set completion.
- **Deck builder** — drag-and-drop assembly with live validation, format legality, deck stats, cloning and a random legal deck generator.
- **Card detail pages** — large art, full card stats, set info, TCGPlayer (USD) and Cardmarket (EUR) prices with a history sparkline, and a Pokédex section from PokéAPI.
- **User profiles** — public profiles with a showcase and public decks; privacy toggles for collection value and set completion.
- **Peer-to-peer trading** — offer / accept / decline / counter / cancel with escrow-style quantity locking, coins on either side, automatic expiry after 7 days.
- **Wallet and notifications** — a coin ledger and a notification centre for trade events.
- **Admin tools** — pack templates and rarity weights, catalog and price sync control, currency grants, roles and suspensions, trade moderation and voiding, the audit log and daily metrics.

### Scope

Free-to-play economy (no real money) · no battle engine · market prices are informational and decoupled from the pack economy · English only · responsive web · direct user-to-user trades (no marketplace) · **no paid services** — every external API is free.

## Architecture

A **local catalog mirror**: card metadata and prices are synced from external Pokémon APIs into our own PostgreSQL by background jobs, so **user requests are served from our DB and Redis and never wait on a third party**. The one exception is the card page's Pokédex section, which the web server reads from PokéAPI at render time (two-second timeout, cached a day, hidden on failure).

```
                     ┌───────────────────────────────────────────────┐
   Browser  ───────▶ │  Next.js 16 (App Router) — the only origin    │
                     │  RSC + Client Components · TanStack Query ·   │
                     │  Zustand · shadcn/ui · dnd-kit · three.js     │
                     │  /api/* rewrite ──┐                           │
                     └───────────────────┼───────────────────────────┘
                                         │  HTTP, session cookie (no JWT)
                                         ▼
                     ┌───────────────────────────────────────────────┐
                     │  NestJS 12 API                                │
                     │  /api/auth/*  Better Auth handler             │
                     │  /api/v1/*    Users · Catalog · Inventory ·   │
                     │  Packs · Decks · Trades · Prices · Wallet ·   │
                     │  Notifications · Admin                        │
                     │  Guards: Csrf → Session → Throttler → Roles   │
                     └───┬───────────────┬───────────────┬───────────┘
                         │               │               │
              ┌──────────▼───┐   ┌───────▼──────┐   ┌────▼────────────┐
              │ PostgreSQL 17│   │  Redis 7.4   │   │ BullMQ worker   │
              │ (Prisma 7)   │   │ db0 cache    │   │ (same codebase) │
              │ source of    │   │ db1 queues   │   │ crons: catalog, │
              │ truth        │   │ limits/locks │   │ prices, expiry  │
              └──────────────┘   └──────────────┘   └───────┬─────────┘
                                                            │
                                                            ▼
                                          ┌───────────────────────────────┐
                                          │  pokemontcg.io v2 (primary)   │
                                          │  TCGdex (fallback)            │
                                          └───────────────────────────────┘
```

**Key principles:** read from DB/cache, reach external APIs only from jobs · thin controllers, fat services · typed end-to-end through the Zod contracts in `@pokedrop/shared` · money, item and trade mutations run inside DB transactions with idempotency keys and quantity locking · external card sources sit behind one adapter interface.

## Repository layout

| Path | What it is |
|---|---|
| `apps/api` | NestJS API (`src/main.ts`) and the BullMQ worker (`src/worker.ts`), one codebase and one image. Prisma schema and migrations in `prisma/` |
| `apps/web` | Next.js App Router frontend |
| `packages/shared` | Zod schemas and inferred types both apps import, `ERROR_CODES`, the deck validator and stats, pack odds |
| `docs/` | Architecture and design reference — start at [docs/README.md](docs/README.md) |
| `deploy/` | `deploy.sh` (the release script) and `pack-templates.sql` |
| `compose.production.yml`, `Dockerfile` | Production stack |
| `docker-compose.yml` | Local services: Postgres, Redis, Mailpit |

## Tech stack

| Layer | Technologies |
|---|---|
| **Backend** | NestJS 12 (Express 5) · Prisma 7 with `@prisma/adapter-pg` · PostgreSQL 17 · Redis 7.4 via ioredis · BullMQ · `@nestjs/schedule` · Better Auth · `@nestjs/throttler` · helmet · nestjs-pino · `@nestjs/terminus` · `@nestjs/swagger` · nodemailer · Zod 4 |
| **Frontend** | Next.js 16 · React 19 · Tailwind v4 · shadcn/ui on Radix · lucide-react · TanStack Query / Table / Virtual · Zustand · React Hook Form + Zod · dnd-kit · Recharts · Sonner · three.js (landing) · CSS keyframe animations |
| **External data** | pokemontcg.io v2 (primary) · TCGdex (fallback) · PokéAPI (species section) |
| **Testing** | *Deferred* — no automated tests during v1 ([PRD.md](docs/PRD.md) §20) |
| **Quality** | ESLint 9 · Prettier · Husky · lint-staged · commitlint · GitHub Actions CI |

## Local development

### Prerequisites

- **Node 22.20.0** (`.nvmrc`) and **pnpm 10.17.1** (`corepack enable`)
- **Docker Desktop** running

### First run

```bash
cp .env.example .env
docker compose up -d --wait
pnpm install
pnpm --filter @pokedrop/api exec prisma migrate deploy
pnpm db:seed
```

`AUTH_SECRET` in `.env` must be replaced with a real value of at least 32 characters (`openssl rand -base64 48`); the API refuses to boot otherwise.

### Run

```bash
pnpm dev                                 # shared (watch) + API on 4000 + web on 3000
pnpm --filter @pokedrop/api dev:worker   # the worker: crons and the trade-expiry queue
```

Open <http://localhost:3000>. Swagger is at <http://localhost:4000/docs> (the document at `/docs-json`); Mailpit, which catches every mail the API sends, is at <http://localhost:8025>.

The API processes the sync queues itself, so admin-triggered syncs run without the worker; the crons and the trade-expiry job need it.

### Getting real data and an admin

The seed is small and hand-written: five users, three sets, twelve cards, one pack template, a deck, an opening and six trades covering every `TradeStatus`. **Seeded users have no credentials** — to sign in, register on `/register` and open the verification link in Mailpit (verification grants 1,000 coins). Then promote yourself:

```bash
docker compose exec postgres psql -U pokedrop -d pokedrop -c "UPDATE users SET role = 'ADMIN' WHERE email = '<you>';"
```

On `/admin/sync` run a catalog sync, then prices. With the worker running and `SYNC_SCHEDULES=true` (the default) they also run nightly. `deploy/pack-templates.sql` adds the nineteen real-booster templates once the catalog is in ([Deployment.md](docs/Deployment.md), *Pack templates*).

### Local services

| Service | Host port | Credentials |
|---|---|---|
| PostgreSQL 17 | **5433** | `pokedrop` / `pokedrop_local_dev`, database `pokedrop` |
| Redis 7.4 | 6379 | none — db 0 cache, db 1 queues |
| Mailpit | 1025 (SMTP), 8025 (UI) | none |

> **Postgres is on 5433, not 5432.** A natively installed PostgreSQL already owns 5432 on at least one machine here, and Docker Desktop publishes over it without an error — so `localhost:5432` silently reaches the wrong server. Both ports are settable in `.env`.

```bash
docker compose exec postgres psql -U pokedrop -d pokedrop
docker compose exec redis redis-cli
docker compose down          # stop, keep data
docker compose down -v       # stop and delete volumes
```

The component gallery is at `/dev/components` under `next dev`, and under `next start` only with `COMPONENT_GALLERY=1` ([Components.md](docs/Components.md)).

### Configuration

Every API variable is validated at boot by a Zod schema (`apps/api/src/config/env.schema.ts`) and explained in [`.env.example`](.env.example); production values are in [`.env.production.example`](.env.production.example). The web app reads only `API_INTERNAL_URL` and `WEB_ORIGIN`, from its own process environment — Next does not load the root `.env`.

## Quality gates

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

`typecheck` and `lint` build `packages/shared` first, and `apps/web` runs `next typegen` before `tsc`: the apps resolve `@pokedrop/shared` through its `dist`, and layouts use the `LayoutProps` type Next generates.

A pre-commit hook runs ESLint and Prettier over staged files; commitlint checks the message, `[PD-NN]: short lowercase description`. Work goes straight to `dev`; `main` is production.

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs four jobs on every push to `dev` and `main`: typecheck, lint plus `format:check`, build, and **migrations** — the history applied to an empty Postgres and diffed against `schema.prisma`.

## Production

One environment on the author's home server: Docker Compose (`web`, `api`, `worker`, `postgres`, `redis`), with only the web server published on `127.0.0.1:3000` and Tailscale Funnel providing public HTTPS. Releases are `deploy/deploy.sh` on the host (pull, build, migrate, start, health check). No staging, registry, monitoring or backups — each cut on purpose. Syncs run only when an admin presses **Run now**. Everything is in [docs/Deployment.md](docs/Deployment.md).

## Roles and security

Two roles, enforced **server-side** — the UI hides what a role cannot do but never relies on that:

- **Member** — open packs, manage inventory, build decks, view public content, trade.
- **Admin** — everything a member can do, plus pack templates, syncs, currency, roles, suspensions, trade moderation, the audit log and metrics.

Sessions are opaque Better Auth tokens in an httpOnly cookie — no JWT and no refresh token. Email verification is mandatory. [docs/Security.md](docs/Security.md) is the one-page map of authentication, authorization, CSRF, rate limits and secrets.

## Documentation

All architecture and design decisions live in [`docs/`](docs/); the [index](docs/README.md) gives a reading order. The UI mockups these docs were first extracted from were made in Claude Design and have been removed from the repository — [DesignSystem.md](docs/DesignSystem.md), [ComponentSpecs.md](docs/ComponentSpecs.md) and the code are now the source of truth.
