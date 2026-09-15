# Product Requirements Document — Pokémon TCG Web Application

**Status:** Draft v1.0
**Type:** Production-oriented web application (collection, deck-building, trading)
**Stack:** NestJS + Prisma + PostgreSQL + Redis + BullMQ (backend) · Next.js App Router + Tailwind + shadcn/ui (frontend)

> **Guiding assumptions** (override if wrong):
> 1. **Free-to-play economy.** Packs are opened using in-app currency/credits granted or earned in-app. No real-money purchases in scope.
> 2. **No live battle gameplay.** The product is collection, deck-building, and trading — not a playable card-game engine.
> 3. **Market price is informational.** Real marketplace prices (from an external API) are displayed for reference and are decoupled from the in-app pack economy.
> 4. **English-first**, with a path to multilingual via TCGdex.

---

## 1. Product Overview

A web application where users open Pokémon TCG booster packs with realistic rarity logic, build a personal collection (inventory), assemble decks, browse rich card detail pages (image, stats, rarity, live-ish market price, set info), maintain a public profile, and trade cards with other users. Access is role-gated (Admin / Member) behind authentication.

The system uses a **local catalog-mirror architecture**: card metadata and prices are synced from external Pokémon APIs into our own PostgreSQL database on a schedule, so all user-facing reads are served from our database + Redis cache and never block on a third party.

### API strategy (summary of the pre-PRD analysis)

| Concern | Decision |
|---|---|
| Primary card + price source | **pokemontcg.io API v2** — free, ~20k req/day with key, card object embeds TCGPlayer (USD) + Cardmarket (EUR) prices |
| Fallback / multilingual / self-host insurance | **TCGdex** — free, no key, REST + GraphQL, 14 languages, open-source & Docker-self-hostable, also carries Cardmarket/TCGplayer prices |
| Documented production upgrade | **Scrydex** — commercial successor of pokemontcg.io, credit-based, SLA-backed; drop-in when a contract/SLA is required |
| Optional species enrichment | **PokéAPI** — video-game Pokédex base stats/flavor for the card detail page only |
| Explicitly rejected | Direct TCGPlayer API (closed to new devs) and scraping TCGPlayer/eBay (ToS-prohibited, fragile) |

**What lives where:**
- **PostgreSQL** — source of truth: users, roles, mirrored card catalog, inventory, decks, trades, pack config, price history.
- **External API** — reached only by scheduled background jobs (catalog sync, price refresh). Never on a user request path.
- **Redis** — cache of hot reads (card detail, sets, search facets, latest price), rate-limit counters, BullMQ queues, idempotency locks.

---

## 2. Goals

- Deliver a **realistic pack-opening experience** with configurable, weighted rarity logic and satisfying reveal UX.
- Give users a **fast, searchable inventory** and a **drag-and-drop deck builder** with format/legality awareness.
- Provide **information-rich card detail pages** with high-quality images, card stats, rarity, market price, and set data.
- Enable **safe, atomic peer-to-peer trading** with clear offer/accept/counter flows and no item duplication or loss.
- Enforce **role-based access control** (Admin/Member) across API and UI.
- Keep the app **resilient to external API downtime** by serving from a local mirror + cache.
- Ship a codebase that is **simple, typed end-to-end, linted, and documented** (Swagger). Automated tests are deliberately deferred during v1 — see §20.

## 3. Non-Goals

- No playable battle/duel engine or matchmaking.
- No real-money transactions, payment processing, or cash-out of cards.
- No mobile native apps (responsive web only).
- No marketplace/auction house (only direct user-to-user trades).
- No card grading, authentication of physical cards, or scanning of real cards.
- No social graph beyond trading and public profiles (no DMs, feeds, or follows in v1).
- No real-time multiplayer state; live updates limited to trade/notification events.

---

## 4. User Roles & Permissions

Two roles in v1: **Member** and **Admin**. RBAC is enforced server-side via NestJS guards; the UI hides/disables what a role can't do but never relies on the client for enforcement.

| Capability | Member | Admin |
|---|:---:|:---:|
| Register / manage own profile | ✅ | ✅ |
| Open booster packs (with currency) | ✅ | ✅ |
| View own inventory | ✅ | ✅ |
| Build / edit / delete own decks | ✅ | ✅ |
| Mark own deck public/private | ✅ | ✅ |
| View public profiles & public decks | ✅ | ✅ |
| Create / accept / decline / counter trades | ✅ | ✅ |
| View card detail pages | ✅ | ✅ |
| Manage pack templates & rarity weights | ❌ | ✅ |
| Trigger catalog / price sync manually | ❌ | ✅ |
| Grant/adjust user currency | ❌ | ✅ |
| Promote/demote roles, ban/suspend users | ❌ | ✅ |
| View audit logs & admin dashboards | ❌ | ✅ |
| Moderate/void suspicious trades | ❌ | ✅ |

Design note: model as a single `role` enum for v1 (simple, predictable). If finer control is needed later, upgrade to a permission-based model with CASL without changing the storage of roles.

---

## 5. Core Features (detailed)

### 5.1 Booster Pack Opening
- User spends in-app currency to open a pack of a chosen **pack template** (e.g., "Base Set", "Latest Set").
- Server generates the pack contents using weighted rarity slots (see §13), records the opening, and mints card instances into the user's inventory **atomically**.
- Frontend plays a reveal animation (Motion): cards flip one by one, rare pulls emphasized.
- Idempotency: an `openId` guards against double-spend on retries/double-clicks.

### 5.2 Inventory (Collection)
- Grid/list of owned cards with quantity, rarity, set, and current price.
- Filter by set, rarity, type, owned-count; sort by price/name/date acquired; full-text/fuzzy search (server-side for scale; Fuse.js for instant client-side filtering of the loaded page).
- Virtualized rendering for large collections; TanStack Table for the dense list view.
- Aggregate stats: total cards, unique cards, collection value (sum of latest prices), completion % per set.

### 5.3 Deck Builder
- Drag-and-drop (dnd-kit) between a searchable card pool and the deck.
- Enforces basic deck rules (configurable): deck size, max copies per card (4, energy exempt), format legality (standard/expanded/unlimited via card `legalities`).
- Live validation with inline errors; deck stats (type curve, energy count, rarity spread) via Recharts.
- Save multiple decks; mark public/private; clone a deck.
- Users can only include cards they own **or** (config toggle) any catalog card for "theorycrafting" decks (owned-only enforced for a stricter mode).

### 5.4 Card Detail Page
- High-quality image (large art), with graceful fallback.
- **Card stats:** HP, types, attacks (name/cost/damage/text), weaknesses, resistances, retreat cost, abilities.
- **Rarity** and **set information** (set name, series, release date, printed total, symbol/logo).
- **Market price:** latest TCGPlayer (USD) and Cardmarket (EUR) values + a small price-history sparkline.
- Optional **species enrichment** (PokéAPI): base Pokédex stats/flavor text.
- "Owned: N" badge and quick actions (add to deck, propose trade for this card).

### 5.5 User Profile
- **Public view:** display name, avatar, join date, showcase cards, public decks, collection highlights (value/completion optional to expose).
- **Private/own view:** editable personal info, currency balance, trade history, private decks.
- Privacy toggles for what's exposed publicly.

### 5.6 Trading System
- Propose a trade to another user: offered items + requested items (+ optional currency on either side, config).
- Recipient can **accept / decline / counter**. All state transitions are server-validated and **atomic** (no partial swaps).
- Escrow semantics: offered cards are **locked** (reserved) while a trade is pending so they can't be double-offered or deck-locked into unavailability.
- Trade history and status timeline; admin can void suspicious trades.

### 5.7 Auth & RBAC
- Email/password (and optionally OAuth) via Better Auth; email verification; password reset.
- Session or JWT-based auth validated by a Nest guard; role guard for admin routes.
- Secure cookie handling, refresh rotation, and logout/all-sessions.

### 5.8 Admin
- Manage pack templates and rarity weights.
- Trigger catalog/price syncs; view sync status and last-run metrics.
- Adjust user currency; manage roles; suspend users.
- Dashboards: DAU, packs opened, trade volume, catalog/price freshness (Recharts/Tremor).

---

## 6. User Flows

**Onboarding:** Register → verify email → land on dashboard with a starter currency grant → guided "open your first pack."

**Open a pack:** Dashboard → choose pack → confirm cost → server generates + mints → reveal animation → cards appear in inventory.

**Build a deck:** Deck Builder → search pool → drag cards in → live validation → save → toggle public.

**Inspect a card:** Inventory/search → card detail → view stats/price/set → add to deck or propose trade.

**Trade:** Visit another user's profile/inventory → "Propose trade" → pick offered/requested cards → send → recipient reviews → accept/counter/decline → on accept, atomic swap → both inventories update + notifications.

**Admin sync:** Admin panel → "Sync prices now" → job enqueued → progress + completion surfaced.

---

## 7. High-Level System Architecture

```
                     ┌──────────────────────────────────────────────┐
                     │                 Next.js (App Router)          │
   Browser  ───────▶ │  RSC + Client Components · TanStack Query ·    │
                     │  Zustand · shadcn/ui · dnd-kit · Motion        │
                     └───────────────┬──────────────────────────────┘
                                     │  HTTPS (REST/JSON, cookie/JWT)
                                     ▼
                     ┌──────────────────────────────────────────────┐
                     │                 NestJS API                    │
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

Key principles: **read from our DB/cache, write to external only via jobs**, thin controllers / fat services, everything typed with shared Zod/DTO contracts.

---

## 8. Backend Module Structure (NestJS)

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

**Provider adapter pattern (important):** all external sources implement a common `CardSourceProvider` interface (`fetchSets`, `fetchCards`, `fetchPrices`). `pokemontcg.io` is the default provider; TCGdex is a fallback the sync layer can switch to on repeated failures. This keeps the rest of the app source-agnostic and makes the Scrydex upgrade a one-file swap.

**Recommended backend libraries (beyond your list):**
`@nestjs/config`, a local `createZodDto` helper for Zod DTOs and their OpenAPI schemas (not `nestjs-zod` — see [Architecture.md](Architecture.md) §4), `@nestjs/throttler` (rate limiting), `helmet`, `nestjs-pino` + `pino-http` (structured logs), `@nestjs/terminus` (health), `@nestjs/bullmq`, `ioredis` (cache built directly on it, see [Architecture.md](Architecture.md) §8), `@nestjs/schedule` (cron triggers). Testing: **deferred, see §20** — no test tooling is installed during v1. Quality: **ESLint** + `typescript-eslint`, **Prettier**, **Husky** + **lint-staged**, **commitlint**.

---

## 9. Frontend Architecture (Next.js)

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

**Rendering strategy:** Server Components for read-heavy pages (card detail, public profiles, set lists) for fast first paint + SEO; Client Components for interactive surfaces (deck builder, pack reveal, trade composer). **TanStack Query** owns server state; **Zustand** owns ephemeral client state (deck draft, reveal sequence, modals). Forms via **React Hook Form + Zod**. Toasts via **Sonner**. Theming via **next-themes**. Animations via **Motion**. Drag-and-drop via **dnd-kit**. Dense tables via **TanStack Table**. Charts via **Recharts** (or **Tremor** for admin dashboards). Instant client filtering via **Fuse.js** over already-fetched pages.

**Recommended frontend additions:** `@tanstack/react-query-devtools`, `react-error-boundary`, a small typed fetch layer (native `fetch` wrapper or `ky`). Testing: **deferred, see §20** — no test tooling is installed during v1. Quality: **ESLint** (`eslint-config-next`), **Prettier**, **Husky** + **lint-staged**.

---

## 10. API Design (main endpoints)

REST, JSON, versioned under `/api/v1`. All list endpoints paginated (`page`, `pageSize`, cursor optional). Swagger served at `/docs`.

**Auth** (delegated to Better Auth handlers, mounted under `/api/auth/*`)
- `POST /auth/sign-up`, `POST /auth/sign-in`, `POST /auth/sign-out`
- `POST /auth/verify-email`, `POST /auth/reset-password`
- `GET  /auth/session`

**Users / Profile**
- `GET  /users/me`
- `PATCH /users/me`
- `GET  /users/:id`                      # public profile
- `GET  /users/:id/decks`                # public decks
- `POST /admin/users/:id/currency`       # admin
- `PATCH /admin/users/:id/role`          # admin

**Catalog**
- `GET /cards`                           # search/filter/sort (set, rarity, type, q)
- `GET /cards/:id`                       # detail (from mirror + cached price)
- `GET /sets`
- `GET /sets/:id`

**Inventory**
- `GET /inventory`                       # owned cards + quantities + aggregates
- `GET /inventory/summary`               # value, completion, counts

**Packs**
- `GET  /packs/templates`
- `POST /packs/:templateId/open`         # body: { openId } (idempotent)
- `GET  /packs/history`

**Decks**
- `GET/POST /decks`
- `GET/PATCH/DELETE /decks/:id`
- `POST /decks/:id/clone`
- `POST /decks/:id/validate`

**Trades**
- `POST /trades`                         # propose
- `GET  /trades` `GET /trades/:id`
- `POST /trades/:id/accept|decline|counter|cancel`
- `POST /admin/trades/:id/void`          # admin

**Prices**
- `GET /cards/:id/price`                 # latest (cached)
- `GET /cards/:id/price/history`

**Admin / Sync**
- `POST /admin/sync/catalog`
- `POST /admin/sync/prices`
- `GET  /admin/sync/status`
- `GET  /admin/metrics`

**Health:** `GET /health/live`, `GET /health/ready`.

Standard error envelope: `{ statusCode, error, message, requestId }`.

---

## 11. Database Schema (high-level)

Prisma models (relationships summarized; enums for role, rarity tier, trade status, transaction type).

- **User** — `id, email, passwordHash?, displayName, avatarUrl, role(MEMBER|ADMIN), currency, createdAt`. → many InventoryItem, Deck, Trade, Price-independent.
- **Session / Account** — managed by Better Auth adapter (sessions, OAuth accounts, verification tokens).
- **Set** — `id, name, series, releaseDate, printedTotal, total, symbolUrl, logoUrl`. Mirrored from API.
- **Card** — `id, setId, name, supertype, subtypes[], hp, types[], rarity, retreatCost, weaknesses(json), resistances(json), attacks(json), abilities(json), nationalPokedexNumbers[], imageSmall, imageLarge, legalities(json), tcgplayerId?, cardmarketId?, latestPriceUsd?, latestPriceEur?, priceUpdatedAt`. Mirrored + price-synced. Indexed on `name`, `setId`, `rarity`, `types`.
- **PriceSnapshot** — `id, cardId, source(TCGPLAYER|CARDMARKET), currency, market, low, mid, high, capturedAt`. Time-series, indexed `(cardId, capturedAt)`.
- **InventoryItem** — `id, userId, cardId, quantity, lockedQuantity, acquiredAt`. Unique `(userId, cardId)`. `lockedQuantity` supports trade escrow.
- **PackTemplate** — `id, name, setFilter(json), cost, slotConfig(json), active`. Admin-managed.
- **PackOpening** — `id, userId, templateId, openId(unique), createdAt`. → many PackOpeningCard (cardId, rarity pulled).
- **Deck** — `id, userId, name, format, isPublic, createdAt`. → many DeckCard.
- **DeckCard** — `id, deckId, cardId, count`. Unique `(deckId, cardId)`.
- **Trade** — `id, initiatorId, recipientId, status(PENDING|ACCEPTED|DECLINED|COUNTERED|CANCELLED|VOIDED), currencyFromInitiator, currencyFromRecipient, createdAt, resolvedAt`. → many TradeItem.
- **TradeItem** — `id, tradeId, side(OFFERED|REQUESTED), cardId, quantity`.
- **CurrencyTransaction** — `id, userId, amount, type(GRANT|PACK_SPEND|TRADE), refId, createdAt`. Audit trail for balances.
- **AuditLog** — `id, actorId, action, entity, entityId, meta(json), createdAt`. Admin-sensitive actions.
- **Notification** — `id, userId, type, payload(json), readAt, createdAt`.

Relationships: User 1—N InventoryItem/Deck/Trade(initiator|recipient)/PackOpening/CurrencyTransaction/Notification. Set 1—N Card. Card 1—N InventoryItem/DeckCard/TradeItem/PriceSnapshot.

---

## 12. Authentication & Authorization Strategy

**Auth provider: Better Auth.** It's TypeScript-native, framework-agnostic, integrates cleanly with a Prisma adapter, and supports email/password, email verification, password reset, sessions, and OAuth. Because your backend is a separate NestJS service, mount Better Auth's Node handler **inside the NestJS app** (e.g., under `/api/auth/*`) so there's a single source of auth truth and the same Prisma client owns the session/account tables. The Next.js frontend calls these endpoints and relies on secure, httpOnly cookies.

- **AuthN:** Better Auth issues a session (cookie) or JWT. A `JwtAuthGuard` / `SessionGuard` validates it on every protected route via a global guard, with `@Public()` to opt out.
- **AuthZ:** `@Roles(Role.ADMIN)` + `RolesGuard` protect admin routes. For finer control later, swap in CASL abilities without touching the stored `role`.
- **Ownership checks:** service-level assertions (e.g., a user can only edit their own deck) — never trust IDs from the client.
- **Session security:** httpOnly + Secure + SameSite cookies, refresh rotation, "sign out all sessions," CSRF protection for cookie-based flows, short-lived access tokens if using JWT.
- **Alternative considered:** Auth.js (NextAuth) is Next-centric and would push auth into the frontend/BFF, splitting the source of truth from the NestJS API; Lucia is now deprecated. Better Auth is the best fit for a Nest-owned auth service. Keep the decision isolated behind the `auth` module so it can be replaced.

---

## 13. Booster Pack Generation Logic

Packs are defined by an admin **PackTemplate** with a `slotConfig`: an ordered list of slots, each with a rarity-weight distribution. This mirrors how real packs guarantee slots (e.g., commons, uncommons, one rare/holo slot with a small chance of upgrading to a higher rarity).

Example `slotConfig`:
```json
{
  "slots": [
    { "count": 4, "weights": { "Common": 100 } },
    { "count": 3, "weights": { "Uncommon": 100 } },
    { "count": 1, "weights": {
        "Rare": 72, "Rare Holo": 20, "Rare Holo EX": 5,
        "Rare Ultra": 2, "Rare Secret": 1 } }
  ]
}
```

**Algorithm (server, transactional):**
1. Validate the user has enough currency and the template is active.
2. For each slot, repeat `count` times: pick a rarity by weighted random (cumulative weight + single RNG draw), then select a random card of that rarity within the template's `setFilter`.
3. Collect the resulting card IDs.
4. In **one Prisma transaction**: debit currency (write `CurrencyTransaction`), create `PackOpening` (+ `PackOpeningCard` rows), and upsert `InventoryItem` quantities.
5. Return the pulled cards for the reveal.

**Fairness & integrity:**
- Weights live in the DB and are **auditable/adjustable by admins**; the algorithm is deterministic given the RNG draws (log the seed for disputes if desired).
- Use `crypto`-grade randomness (`crypto.randomInt`) rather than `Math.random`.
- **Idempotency:** the client sends an `openId` (UUID); a unique constraint on `PackOpening.openId` makes retries safe (double-click / network retry won't double-charge or double-mint).
- Guard against empty rarity buckets (fallback to next-lower rarity) so a misconfigured template can't 500.

---

## 14. Trading System Design

**States:** `PENDING → ACCEPTED | DECLINED | COUNTERED | CANCELLED | VOIDED`.

**Escrow via quantity locking:** when a trade is proposed, the initiator's offered quantities are reserved by incrementing `InventoryItem.lockedQuantity`. `availableQuantity = quantity − lockedQuantity` is what can be used in decks (strict mode) or offered elsewhere. This prevents the same card from being promised to two trades.

**Atomic settlement (accept):** in a single Prisma transaction:
1. Re-validate both parties still own the required (unlocked or locked-for-this-trade) quantities and currency.
2. Move cards: decrement/ increment `InventoryItem` on both sides; delete rows that hit zero; release locks.
3. Apply any currency deltas (+ `CurrencyTransaction` rows).
4. Set trade `ACCEPTED`, `resolvedAt`, write `AuditLog`, emit notifications.

If any check fails, the transaction rolls back — **no partial swaps, no duplication, no loss.**

**Counter-offers:** a counter creates a linked trade referencing the original and moves the original to `COUNTERED`; locks transfer to the new proposal.

**Safety:**
- Prevent self-trades; prevent trading cards a user doesn't actually have available.
- Rate-limit trade creation per user (anti-spam) via `@nestjs/throttler`.
- Admin `void` reverses a fraudulent accepted trade where feasible and logs it.
- A BullMQ **expiry job** auto-cancels stale `PENDING` trades (e.g., >7 days) and releases locks.

---

## 15. Market Price Synchronization Strategy

Prices are **never fetched on the user request path.** A BullMQ job keeps our DB fresh.

**Sources:** primary `pokemontcg.io` (TCGPlayer USD + Cardmarket EUR embedded per card); TCGdex as fallback; Scrydex if upgraded. Store both currencies.

**Jobs (via `@nestjs/schedule` triggering BullMQ producers):**
- **Nightly full sweep** — refresh prices for the whole catalog in batches, respecting rate limits (bounded worker concurrency + exponential backoff on 429).
- **Frequent "active" refresh** (e.g., every few hours) — prioritize cards that are *owned by someone*, *in a deck*, *recently traded*, or *trending/viewed*. This keeps the prices users actually see fresh without burning quota on the long tail.
- **On-demand** — admin "Sync prices now" and a per-card refresh with a cooldown.

**Write path per card:**
1. Fetch latest from provider.
2. `UPDATE Card SET latestPriceUsd, latestPriceEur, priceUpdatedAt`.
3. `INSERT PriceSnapshot` (for history/sparklines) — throttle to at most one snapshot per card per day to bound table growth.
4. `DEL price:card:{id}` in Redis so the next read repopulates.

**Failure handling:** if the primary provider errors/hits limits, the job retries with backoff and, after N failures, switches to the fallback provider for that batch. Sync status + last-run timestamps are surfaced on the admin dashboard, and stale prices are shown with an "updated X ago" label rather than hidden.

---

## 16. Caching Strategy (Redis)

| Data | Key pattern | TTL | Invalidation |
|---|---|---|---|
| Card detail payload | `card:{id}` | 24h | on catalog sync of that card |
| Latest price | `price:card:{id}` | 1–6h | on price job write |
| Set list / set detail | `sets`, `set:{id}` | 24h | on catalog sync |
| Search facets (rarities, types, sets) | `facets` | 24h | on catalog sync |
| Inventory summary | `inv:summary:{userId}` | 5m | on inventory mutation |
| Rate-limit counters | `throttle:{route}:{userId}` | window | auto-expire |
| Pack-open idempotency lock | `lock:open:{openId}` | short | after commit |
| Trade expiry / job queues | BullMQ namespaces | — | job lifecycle |

Principles: **cache read-heavy, low-volatility catalog data aggressively**; keep user-specific/volatile data (inventory, trades) with short TTLs or no cache; always pair a write with explicit invalidation. The same Redis powers cache and BullMQ, kept apart by a separate logical database and a `cache:` key prefix; the cache is a thin service over `ioredis` rather than `cache-manager` — see [Architecture.md](Architecture.md) §8 for why.

---

## 17. Security Considerations

- **Transport & headers:** HTTPS everywhere, `helmet`, strict CORS allowlist, secure cookies (httpOnly/Secure/SameSite), CSRF protection for cookie flows.
- **Input validation:** every DTO validated with Zod; reject unknown fields; validate pagination bounds.
- **AuthZ everywhere:** global auth guard + explicit ownership checks in services; never trust client-supplied user IDs.
- **Rate limiting & abuse:** `@nestjs/throttler` on auth, pack-open, and trade endpoints; idempotency keys on mutating money/item operations.
- **Data integrity:** all currency/item/trade mutations inside DB transactions; unique constraints for idempotency; `lockedQuantity` to prevent over-promising.
- **Secrets:** env-only config validated at boot; no secrets in the repo; API keys server-side only (the frontend never calls Pokémon APIs directly).
- **AuthN hardening:** rely on Better Auth for password hashing (Argon2/scrypt), email verification, reset-token expiry, and session rotation.
- **Auditing:** `AuditLog` for admin and sensitive actions; structured logs with request IDs (nestjs-pino).
- **Dependency hygiene:** lockfiles, `npm audit`/Dependabot, pinned base images.

---

## 18. Performance Considerations

- **Serve from mirror + cache**, so external API latency/limits never affect users.
- **DB indexes** on hot query columns (`Card.name`, `setId`, `rarity`, `types`; `InventoryItem (userId, cardId)`; `PriceSnapshot (cardId, capturedAt)`).
- **Pagination + cursors** for inventory/catalog; avoid unbounded queries.
- **Server Components** for read-heavy pages; stream where useful; cache GET responses at the edge/CDN where safe.
- **Image delivery:** use `next/image`; consider mirroring card images to your own object storage/CDN to reduce dependency on the source CDN and improve cache-hit rates.
- **Client filtering (Fuse.js)** operates on already-fetched pages; heavy search stays server-side.
- **Virtualized lists** for large collections; memoized selectors in TanStack Query.
- **N+1 avoidance** via Prisma `include`/`select` and batched reads; measure with query logging.

---

## 19. Scalability Considerations

- **Stateless API** → horizontal scaling behind a load balancer; sessions/cache in Redis, not memory.
- **Workers scale independently** from the API (separate BullMQ worker deployment); sync throughput tuned by concurrency, not by adding API replicas.
- **Read scaling:** Postgres read replicas for catalog/analytics reads if needed; Redis for hot reads.
- **Bounded external calls:** sync batching + backoff means catalog growth doesn't linearly increase user-facing risk.
- **Partitioning path:** `PriceSnapshot` is the fastest-growing table — partition by time or downsample old data (keep dailies, roll up weeklies) as it grows.
- **Upgrade path to Scrydex** for higher, SLA-backed throughput when free-tier limits become the bottleneck — isolated behind the provider adapter.

---

## 20. Testing Strategy

> **Decision — 2026-09-14: no automated tests are written during v1 development.**
>
> Tests are deliberately deferred until the product is built. Do not add test
> files, test runners, test dependencies, or a `test` step to CI as part of any
> ticket. The strategy below is kept as the plan for when testing resumes, not
> as work to schedule now.

**Backend**
- **Unit (Jest):** pack rarity distribution (statistical assertions over many draws), trade settlement invariants, deck validation, price-write logic, guards.
- **Integration (Testcontainers):** real Postgres + Redis — transactional correctness of pack-open and trade accept (no dupe/loss), idempotency, cache invalidation.
- **E2E (Supertest):** auth flows, RBAC (member blocked from admin routes), pagination, error envelopes.
- **Contract tests** for provider adapters using recorded fixtures (so a provider format change is caught).

**Frontend**
- **Unit/component (Vitest + RTL):** forms (RHF+Zod), deck-builder reducer/store, card components.
- **Integration (MSW):** query hooks against mocked API, loading/error states.
- **E2E (Playwright):** register → open pack → build deck → propose/accept trade happy paths + a couple of failure paths.

**Cross-cutting:** seed/factory data with `@faker-js/faker`; coverage gates in CI; run lint + typecheck + tests on every PR (Husky pre-commit for fast checks, CI for the full suite).

---

## 21. Deployment Overview

- **Environments:** local (Docker Compose: Postgres + Redis), staging, production.
- **Containers:** separate images for `api` and `worker` (same codebase, different entrypoint); Next.js deployed to a Node host or a platform like Vercel (frontend) with the API on a container platform (Fly.io/Render/Railway/AWS ECS).
- **Managed services:** managed Postgres (with backups/PITR) and managed Redis in production.
- **Migrations:** `prisma migrate deploy` as a release step; never auto-migrate at runtime.
- **Config:** env vars validated at boot; secrets from the platform secret store; Pokémon API keys server-side only.
- **CI/CD:** on PR → install, typecheck, lint, build (no test step during v1, see §20); on merge to main → build+push images, run migrations, deploy api + worker + frontend; smoke test `/health/ready`.
- **Observability:** structured logs (pino) shipped to a log sink; health checks (`@nestjs/terminus`); basic metrics/dashboards for sync freshness, queue depth, error rate; alerting on failed syncs and rising 429s.
- **Backups & DR:** automated DB backups + periodic restore drills; the catalog is re-syncable from source, so the irreplaceable data is users/inventory/decks/trades.

---

## 22. Future Improvements

- **Playable battles** (turn-based engine, matchmaking) — the largest possible extension.
- **Marketplace/auction house** with in-app currency bids.
- **Multilingual UI** leveraging TCGdex's 14-language data.
- **Scrydex upgrade** for SLA-backed prices, price-history depth, and graded valuations.
- **Card-image recognition** (add a card from a photo) via an image-based API.
- **Social layer:** friends, activity feed, deck comments/likes.
- **Advanced analytics:** collection value over time, portfolio insights (Tremor dashboards).
- **Achievements & quests** to drive engagement and reward currency.
- **Real-time updates** via WebSockets/SSE for trades and notifications.
- **Mobile apps** (React Native) reusing the same API.
- **Pack "guaranteed pity" mechanics** and seasonal/limited pack templates.

---

### Appendix A — Key architectural decisions, at a glance

1. **Mirror the catalog locally.** All user reads hit our DB/cache; external APIs are touched only by scheduled jobs → resilience + speed + rate-limit safety.
2. **Provider adapter pattern.** pokemontcg.io primary, TCGdex fallback, Scrydex upgrade — swappable behind one interface.
3. **Transactions + idempotency + quantity locking** are the backbone of correct packs and trades (no dupe/loss/double-spend).
4. **Better Auth hosted inside NestJS** → single source of auth truth sharing the Prisma client.
5. **Two-speed price sync** (active cards frequently, full catalog nightly) balances freshness against quota.
6. **Simple two-role RBAC now**, CASL-ready later — avoid overengineering while leaving a clean upgrade path.
