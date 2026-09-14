# PokéDrop

A production-oriented **Pokémon TCG web application** for opening booster packs, building a personal collection, assembling decks, browsing rich card detail pages, and trading cards with other users — all behind role-gated authentication.

> **Status:** Design & documentation phase (PRD + architecture + design system complete; implementation not yet started).

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
| **Testing** | Jest · Supertest · Testcontainers (backend) · Vitest · React Testing Library · Playwright · MSW (frontend) |
| **Quality** | ESLint · Prettier · Husky · lint-staged · commitlint |

## Design system

A **dark-first, desktop-first** system for a premium collectible-card experience: electric-blue accents, gold economy cues, a full rarity spectrum, built on **Geist** with a strict 4px rhythm. All motion honors `prefers-reduced-motion`; color is never the sole carrier of meaning. See [docs/DesignSystem.md](docs/DesignSystem.md) for the full token set.

## Documentation

All architecture and design decisions live in [`docs/`](docs/). Start with the [documentation index](docs/README.md).

| Doc | What it covers |
|---|---|
| [PRD.md](docs/PRD.md) | Product requirements — the source of truth for scope, goals, and decisions. |
| [Architecture.md](docs/Architecture.md) | System topology, module structure, data flow, sync, caching, provider adapter. |
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

This repository currently contains the **planning and design deliverables** — a complete PRD, architecture, data model, API reference, information architecture, user flows, design system, and component specs, along with the source HTML mockups. Backend and frontend implementation follow the structure laid out in [docs/Architecture.md](docs/Architecture.md).
