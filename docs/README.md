# PokéDrop — Documentation

Architecture & design reference for the Pokémon TCG web application (collection, deck-building, trading).

**Stack:** NestJS + Prisma + PostgreSQL + Redis + BullMQ + Better Auth (backend) · Next.js App Router + Tailwind + shadcn/ui (frontend) · Docker Compose on a home server behind Tailscale Funnel (production).

## Documents

| Doc | What it covers |
|---|---|
| [Foundation.md](Foundation.md) | What M0 built, why, how it works, and the traps it left behind. |
| [Frontend.md](Frontend.md) | What M11 built in the web app: route zones, styling toolchain, API client, session, and its traps. |
| [Components.md](Components.md) | What M12 built: the component library as it exists, its gallery, and where it bends the specs. |
| [Pages.md](Pages.md) | What M13 built: each page, the decisions behind it, and what it measured. |
| [PRD.md](PRD.md) | Product requirements — the source of truth for scope, goals, and decisions; *As built* notes mark where the implementation differs. |
| [Architecture.md](Architecture.md) | System topology, module structure (backend + frontend), data flow, sync, caching, provider adapter. |
| [Security.md](Security.md) | Authentication, sessions, authorization, CSRF, rate limits and secrets on one page. |
| [Deployment.md](Deployment.md) | Where production runs (home server, Tailscale Funnel), how a release goes out, the first admin, and first response. |
| [Migrations.md](Migrations.md) | How the schema changes: the rules, the rollback path, and what CI enforces. |
| [DataModel.md](DataModel.md) | Prisma entities, relationships, enums, indexes, integrity rules. |
| [API.md](API.md) | REST endpoint reference, conventions, error envelope, rate limits. |
| [InformationArchitecture.md](InformationArchitecture.md) | Page inventory (30 routes), routing, navigation chrome, RBAC gating. |
| [UserFlows.md](UserFlows.md) | End-to-end flows + the pack-opening and trade-lifecycle state machines. |
| [DesignSystem.md](DesignSystem.md) | Design tokens (color, type, spacing, radius, shadow, motion), both themes — the theming source of truth. |
| [ComponentSpecs.md](ComponentSpecs.md) | Contracts for all 24 UI components (props, variants, states, a11y). |

## Next to the code

Module READMEs hold what is specific to one module and too detailed for the documents above:

| README | What it covers |
|---|---|
| [`apps/api/src/auth`](../apps/api/src/auth/README.md) | Better Auth configuration, mail flows, sessions and cookies, what was measured |
| [`apps/api/src/queue`](../apps/api/src/queue/README.md) | Queues, which process runs what, retries and failed jobs |
| [`apps/api/src/sync`](../apps/api/src/sync/README.md) | Catalog and price sync, providers, breaker, request budget |
| [`apps/api/src/inventory`](../apps/api/src/inventory/README.md) | How many copies a user can use (`available = quantity − locked`): the contract for every module that changes quantities |
| [`apps/api/src/metrics`](../apps/api/src/metrics/README.md) | Request and activity counters behind the admin metrics |

## Design records

[`superpowers/specs/`](superpowers/specs/) and [`superpowers/plans/`](superpowers/plans/) hold the design spec and the implementation plan written for each larger ticket, named `YYYY-MM-DD-pd-NN-…`. They record the reasoning at the time and are not updated afterwards; where one disagrees with the documents above, the documents and the code win.

## Design source

The UI was designed in Claude Design. The exported mockups were kept in a `design/` folder until 2026-10-19 and have been removed; [DesignSystem.md](DesignSystem.md), [ComponentSpecs.md](ComponentSpecs.md), [InformationArchitecture.md](InformationArchitecture.md) and the code are now the source of truth. The mockups remain in git history.

## Reading order

0. **Foundation** for what already exists in the repository and what will bite you.
1. **PRD** for the "why" and scope boundaries.
2. **Architecture** + **DataModel** for the system shape; **Security** for who can do what.
3. **InformationArchitecture** + **UserFlows** for what the product does.
4. **DesignSystem** + **ComponentSpecs** for building the UI; **Frontend**, **Components** and **Pages** for how it was built.
5. **API** as the contract between frontend and backend.
6. **Deployment** + **Migrations** before releasing anything.

## Scope guardrails (from the PRD)

No automated tests during v1 — testing is deliberately deferred until the product is built (see [PRD.md](PRD.md) §20) · no paid services · free-to-play economy (in-app currency, no real money) · no live battle engine · informational market prices decoupled from the pack economy · English-first · responsive web only · direct user-to-user trades (no marketplace/auction).
