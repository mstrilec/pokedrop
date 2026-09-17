# PokéDrop

A production-oriented **Pokémon TCG web application** for opening booster packs, building a personal collection, assembling decks, browsing rich card detail pages, and trading cards with other users — all behind role-gated authentication.

> **Status:** Foundation in progress. Planning and design deliverables are complete; the monorepo is scaffolded and the local service stack runs. Feature work has not started.

## What it does

- **Booster pack opening** — spend in-app currency to open packs with realistic, admin-configurable weighted rarity logic and a satisfying card-by-card reveal animation.
- **Inventory (collection)** — a fast, searchable, virtualized grid/list of owned cards with filters, sorting, aggregate stats, and set-completion tracking.
- **Deck builder** — drag-and-drop deck assembly with live validation, format legality, and deck stats.
- **Card detail pages** — high-quality art, full card stats, rarity, set info, and informational market prices (TCGPlayer USD / Cardmarket EUR) with a price-history sparkline.
- **User profiles** — public showcase profiles and public decks, plus a private view with currency balance and trade history.
- **Peer-to-peer trading** — safe, atomic offer / accept / decline / counter flows with escrow-style quantity locking (no duplication or loss).
- **Admin tools** — manage pack templates & rarity weights, trigger catalog/price syncs, adjust currency, manage roles, and moderate trades.

### Guiding assumptions & scope

- **Free-to-play economy** — packs use in-app currency; no real-money purchases.
- **No live battle engine** — this is collection, deck-building, and trading, not a playable card-game.
- **Market prices are informational** — decoupled from the in-app pack economy.
- **English-first**, responsive web only, direct user-to-user trades (no marketplace/auction house).

## Architecture

The system uses a **local catalog-mirror architecture**: card metadata and prices are synced from external Pokémon APIs into our own PostgreSQL on a schedule, so **all user-facing reads are served from our DB + Redis and never block on a third party**. External APIs are touched only by scheduled background jobs.

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

**Key principles:** read from DB/cache, write to external only via jobs · thin controllers / fat services · typed end-to-end (shared Zod/DTO contracts) · money/item/trade mutations run inside DB transactions with idempotency keys and quantity locking (no dupe, loss, or double-spend) · external card sources sit behind one swappable adapter interface.

## Tech stack

| Layer | Technologies |
|---|---|
| **Backend** | NestJS · Prisma · PostgreSQL · Redis · BullMQ · Better Auth · Swagger · Zod |
| **Frontend** | Next.js (App Router) · React · Tailwind · shadcn/ui · TanStack Query · Zustand · React Hook Form · dnd-kit · Motion · Recharts |
| **External data** | pokemontcg.io v2 (primary) · TCGdex (fallback/i18n) · Scrydex (upgrade path) · PokéAPI (species enrichment) |
| **Testing** | *Deferred* — no automated tests are written during v1 development (see [PRD.md](docs/PRD.md) §20) |
| **Quality** | ESLint · Prettier · Husky · lint-staged · commitlint |

## Local development

### Prerequisites

- **Node 22.20.0** (`.nvmrc`) and **pnpm 10.17.1** (enable with `corepack enable`)
- **Docker Desktop** running

### Bring the stack up

```bash
cp .env.example .env
docker compose up -d --wait
```

`--wait` blocks until both healthchecks pass, so the next command can assume
the database is actually accepting connections rather than merely started.

| Service | Host port | Credentials |
|---|---|---|
| PostgreSQL 17 | **5433** | `pokedrop` / `pokedrop_local_dev`, database `pokedrop` |
| Redis 7.4 | 6379 | none |

> **Postgres is on 5433, not 5432.** A natively installed PostgreSQL service
> already owns 5432 on at least one machine here, and Docker Desktop publishes
> over it without raising an error — so `localhost:5432` silently reaches the
> wrong server and migrations would land in the wrong database. Both ports are
> settable in `.env` (`POSTGRES_PORT`, `REDIS_PORT`) if they clash on yours.

### Connect

```bash
docker compose exec postgres psql -U pokedrop -d pokedrop
docker compose exec redis redis-cli
```

From the host, `DATABASE_URL` and `REDIS_URL` in `.env` work verbatim with any
client — `psql`, `pgcli`, Prisma, `redis-cli -u`.

Redis is split by logical database so that clearing the cache cannot drop
queued jobs: **db 0** is the read cache, **db 1** is the BullMQ queues.

### Reset

```bash
docker compose down          # stop, keep data
docker compose down -v       # stop and delete volumes - next up is a clean DB
```

### Check status

```bash
docker compose ps
docker compose logs -f postgres
```

## Quality gates

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

`typecheck` and `lint` compile `packages/shared` before they run, and `apps/web` runs `next typegen` before `tsc`. Both are load-bearing rather than tidiness: the apps resolve `@pokedrop/shared` through its `dist`, and `layout.tsx` uses the `LayoutProps` type Next generates. On a machine that has built once, leftovers hide this; on a fresh clone the commands would fail with `Cannot find module`. CI is where it surfaced.

A pre-commit hook runs ESLint and Prettier over staged files, and commitlint checks the message. The message format is `[PD-NN]: short lowercase description`.

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs typecheck, lint (plus `format:check`) and build as three parallel jobs on every push to `dev` and `main`, sharing the composite setup in [`.github/actions/setup`](.github/actions/setup/action.yml). A warm run finishes in well under a minute.

Versions are never repeated in the workflow: `pnpm/action-setup` reads `packageManager` and `actions/setup-node` reads `engines.node`, both from the root `package.json`, so CI cannot drift from the local toolchain through a line somebody forgot to update.

## Design system

A **dark-first, desktop-first** system for a premium collectible-card experience: electric-blue accents, gold economy cues, a full rarity spectrum, built on **Geist** with a strict 4px rhythm. All motion honors `prefers-reduced-motion`; color is never the sole carrier of meaning. See [docs/DesignSystem.md](docs/DesignSystem.md) for the full token set.

## Documentation

All architecture and design decisions live in [`docs/`](docs/). Start with the [documentation index](docs/README.md).

| Doc | What it covers |
|---|---|
| [Foundation.md](docs/Foundation.md) | What M0 built, why, how it works, and the traps it left behind. |
| [PRD.md](docs/PRD.md) | Product requirements — the source of truth for scope, goals, and decisions. |
| [Architecture.md](docs/Architecture.md) | System topology, module structure, data flow, sync, caching, provider adapter. |
| [Migrations.md](docs/Migrations.md) | How the schema changes: the rules, the rollback path, and what CI enforces. |
| [DataModel.md](docs/DataModel.md) | Prisma entities, relationships, enums, indexes, integrity rules. |
| [API.md](docs/API.md) | REST endpoint reference, conventions, error envelope. |
| [InformationArchitecture.md](docs/InformationArchitecture.md) | Page inventory (32 pages), routing, navigation, RBAC gating. |
| [UserFlows.md](docs/UserFlows.md) | End-to-end flows + pack-opening and trade-lifecycle state machines. |
| [DesignSystem.md](docs/DesignSystem.md) | Design tokens (color, type, spacing, radius, shadow, motion). |
| [ComponentSpecs.md](docs/ComponentSpecs.md) | Contracts for all 24 UI components (props, variants, states, a11y). |

The [`design/`](design/) folder holds the interactive HTML mockups these docs were extracted from (design system, component specs, information architecture, all app screens, the booster-opening reveal animation, and the CardTile component).

## Roles

Two roles in v1, enforced **server-side** via NestJS guards (the UI hides what a role can't do but never relies on the client for enforcement):

- **Member** — open packs, manage inventory, build decks, view public content, and trade.
- **Admin** — everything a member can do, plus managing pack templates & rarity weights, triggering syncs, adjusting currency, managing roles, and moderating trades.

## Project status

Planning is complete: PRD, architecture, data model, API reference, information
architecture, user flows, design system and component specs, plus the source
HTML mockups in [`design/`](design/).

Foundation work is underway. The pnpm monorepo is scaffolded (`apps/api`,
`apps/web`, `packages/shared`) and `docker compose up -d` brings up Postgres and
Redis locally. Still outstanding in the foundation: lint and formatting
toolchain, NestJS bootstrap, typed configuration, the Prisma and Redis modules,
the error envelope, structured logging, health probes and CI.

No feature modules exist yet. Backend and frontend implementation follow the
structure laid out in [docs/Architecture.md](docs/Architecture.md).
