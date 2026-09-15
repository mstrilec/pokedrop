# PokéDex TCG — Documentation

Architecture & design reference for the Pokémon TCG web application (collection, deck-building, trading).

**Stack:** NestJS + Prisma + PostgreSQL + Redis + BullMQ (backend) · Next.js App Router + Tailwind + shadcn/ui (frontend).

## Documents

| Doc | What it covers |
|---|---|
| [Foundation.md](Foundation.md) | What M0 built, why, how it works, and the traps it left behind. |
| [PRD.md](PRD.md) | Product requirements — the source of truth for scope, goals, and decisions. |
| [Architecture.md](Architecture.md) | System topology, module structure (backend + frontend), data flow, sync, caching, provider adapter. |
| [DataModel.md](DataModel.md) | Prisma entities, relationships, enums, indexes, integrity rules. |
| [API.md](API.md) | REST endpoint reference, conventions, error envelope. |
| [InformationArchitecture.md](InformationArchitecture.md) | Page inventory (32 pages), routing, navigation chrome, RBAC gating. |
| [UserFlows.md](UserFlows.md) | End-to-end flows + the pack-opening and trade-lifecycle state machines. |
| [DesignSystem.md](DesignSystem.md) | Design tokens (color, type, spacing, radius, shadow, motion) — the theming source of truth. |
| [ComponentSpecs.md](ComponentSpecs.md) | Contracts for all 24 UI components (props, variants, states, a11y). |

## Design source files

The `design/` folder holds interactive HTML mockups these docs were extracted from:
`Design System` · `Component Specs` · `Information Architecture` · `Pokemon TCG App` (all screens) · `Booster Opening` (reveal animation) · `CardTile` (component).

## Reading order

0. **Foundation** for what already exists in the repository and what will bite you.
1. **PRD** for the "why" and scope boundaries.
2. **Architecture** + **DataModel** for the system shape.
3. **InformationArchitecture** + **UserFlows** for what the product does.
4. **DesignSystem** + **ComponentSpecs** for building the UI.
5. **API** as the contract between frontend and backend.

## Scope guardrails (from the PRD)

No automated tests during v1 — testing is deliberately deferred until the product is built (see [PRD.md](PRD.md) §20) · free-to-play economy (in-app currency, no real money) · no live battle engine · informational market prices decoupled from the pack economy · English-first · responsive web only · direct user-to-user trades (no marketplace/auction).
