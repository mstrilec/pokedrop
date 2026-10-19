# User Flows

> End-to-end flows and the state machines behind the two transactional cores.
> Screens referenced here are mapped in [InformationArchitecture.md](InformationArchitecture.md); endpoints in [API.md](API.md).

---

## 1. Onboarding

```
Register → Verify email → Sign in → Dashboard (starter currency grant) → guided "open your first pack"
```

- Register (`/register`) collects display name + email + password (Better Auth). Password length bounds are `PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_LENGTH` in `@pokedrop/shared`.
- Verify email (`/verify-email`) shows a "check your inbox" state; the link activates the account and releases a **1,000-coin welcome grant** (`CurrencyTransaction type=GRANT`), once per account. Signing in before verifying is refused and mails a fresh link.
- The dashboard's onboarding checklist (*Get started · 1 of 4*) ticks verify email → open a pack → build a full deck → complete a trade from `GET /users/me/progress`, and disappears when all four are done.

## 2. Open a pack

```
Dashboard/Packs → choose template → Confirm-cost dialog → server generates + mints (atomic)
  → Reveal animation (sealed → opening → reveal → summary) → cards in inventory
```

- **Confirm-cost dialog** states cost + guarantee ("10 cards with at least 1 Rare. This action can't be undone.").
- Client generates an `openId` (UUID) and posts it — see [pack state machine](#7-pack-opening--state-machine--algorithm).
- **Reveal** (`components/packs/reveal/`, state in `lib/stores/reveal-machine.ts`) has four stages: `sealed` (floating pack) → `opening` (shake + flash, ~2s) → `reveal` (tap to flip cards one by one; rare pulls glow) → `summary` (grid of pulls, "Open another" / "View in collection"). **Skippable** and reduced-motion aware.

## 3. Build a deck

```
Decks → New/Open builder → search pool → drag cards in (dnd-kit)
  → live validation (DeckValidationBanner) → save → toggle public/private
```

- Enforces configurable rules: deck size, **max 4 copies per card** (energy exempt), format legality (standard/expanded/unlimited via card `legalities`).
- Owned-only vs theorycrafting (any catalog card) is a config toggle.
- Deck stats (type curve, energy count, rarity spread) render via Recharts. Clone + legality check happen in-place.

## 4. Inspect a card

```
Inventory / Catalog / Search → Card Detail
  → view stats · price sparkline · set info → Add to deck  OR  Propose trade
```

Card Detail (`/cards/:id`) is a public, SEO-friendly Server Component: large art, HP/types/attacks/weaknesses/resistances/retreat/abilities, rarity + set info, latest TCGPlayer (USD) + Cardmarket (EUR) price with a 30-day sparkline, optional PokéAPI enrichment, "Owned: N" badge, and quick actions.

## 5. Trade

```
Another user's profile/card → Propose trade → pick offered + requested (+ optional coins) → send
  → recipient reviews → Accept | Decline | Counter
  → on Accept: atomic swap → both inventories update + notifications
```

See the [trade state machine](#8-trade-lifecycle--state-machine).

## 6. Admin sync

```
Admin → Sync control → "Run now" (catalog, then prices) → job enqueued (BullMQ) → status, last run and breakers on /admin/sync
```

In production this is the only way a sync runs (`SYNC_SCHEDULES=false`); a second trigger while one is queued or running is refused with `SYNC_IN_PROGRESS`.

---

## 7. Pack opening — state machine & algorithm

### UI stages

```
sealed ──tap/open──▶ opening ──(~2s, server responds)──▶ reveal ──cards exhausted──▶ summary
                                                            │
                                                     skip ──┴──▶ summary
```

### Server algorithm (transactional)

Packs are defined by an admin **PackTemplate** with an ordered `slotConfig`; each slot has a rarity-weight distribution.

```jsonc
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

1. Validate the user has enough currency and the template is active.
2. For each slot × `count`: pick a rarity by weighted random (cumulative weight + single RNG draw), then a random card of that rarity within the template's `setFilter`.
3. Collect the resulting card IDs.
4. In **one Prisma transaction**: debit currency (write `CurrencyTransaction`), create `PackOpening` (+ `PackOpeningCard` rows), upsert `InventoryItem` quantities.
5. Return the pulled cards for the reveal.

### Fairness & integrity

- Weights live in the DB — auditable/adjustable by admins; deterministic given RNG draws. Each opening's seed is stored in `PackOpening.seed` for disputes.
- Draw from an HMAC-SHA256 stream over a `crypto.randomBytes` seed (`apps/api/src/packs/pack-rng.ts`) — never `Math.random`, and not `crypto.randomInt`, which cannot be seeded, so a stored seed would reproduce nothing.
- **Idempotency:** client sends `openId` (UUID); a unique constraint on `PackOpening.openId` makes retries safe (double-click / network retry won't double-charge or double-mint).
- Guard against empty rarity buckets so a misconfigured template can't 500: fall back to the next **more common** rarity in the same slot (by weight), then to the nearest rarer one; a slot with no cards at all refuses the open without charging. See [API.md](API.md) (Packs, "How a pack is drawn").

---

## 8. Trade lifecycle — state machine

```
                 ┌──────────── decline ───────────▶ DECLINED
                 │
   propose ──▶ PENDING ──── cancel (initiator) ───▶ CANCELLED
                 │
                 ├──── counter ──▶ COUNTERED  (links a new PENDING trade; locks transfer)
                 │
                 ├──── accept ───▶ ACCEPTED   (atomic swap)
                 │
                 └── admin void ─▶ VOIDED     (reverse a fraudulent accepted trade where feasible)
```

Stale `PENDING` trades (older than `TRADE_EXPIRY_DAYS`, 7 by default) are auto-cancelled by the hourly BullMQ expiry job in the worker, which releases locks and records `trade.expire` with no actor. A negotiation holds at most 10 trades (`COUNTER_LIMIT`).

### Escrow via quantity locking

When a trade is proposed, the initiator's offered quantities are reserved by incrementing `InventoryItem.lockedQuantity`.
`availableQuantity = quantity − lockedQuantity` is what can be used in decks (strict mode) or offered elsewhere. Prevents the same card being promised to two trades.

### Atomic settlement (accept)

In a single Prisma transaction:
1. Re-validate both parties still own the required quantities and currency.
2. Move cards: decrement/increment `InventoryItem` on both sides; delete rows that hit zero; release locks.
3. Apply currency deltas (+ `CurrencyTransaction` rows).
4. Set trade `ACCEPTED`, `resolvedAt`, write `AuditLog`, emit notifications.

Any failed check → the transaction rolls back. **No partial swaps, no duplication, no loss.**

### Safety

- Prevent self-trades and trading cards a user doesn't actually have available.
- Rate-limit trade creation per user (`@nestjs/throttler`).
- Admin `void` reverses a fraudulent accepted trade where feasible and logs it.

---

## 9. Auth flows (Better Auth)

```
/register ──▶ /verify-email ──▶ /sign-in ──▶ Dashboard
                                    ▲
/forgot-password ──▶ (email) ──▶ /reset-password ──┘
```

- Email/password only; verification is required to sign in (link valid `AUTH_VERIFICATION_TTL`, 1 h); password reset with a single-use token (`AUTH_RESET_TTL`, 15 min) that revokes every session.
- The verification link returns to `/verify-email?verified=1`, or with `?error=TOKEN_EXPIRED` and similar when it fails; the reset link lands on `/reset-password?token=…`.
- A session is an opaque token in an httpOnly cookie (7 days, extended at most daily) — no JWT, no refresh token. A global `SessionGuard` resolves it on every `/api/v1` request; `@Public()` opts out.
- Settings lists the active sessions and signs out every other one; the avatar menu has *Sign out* and *Sign out of all devices*.
- Ownership checks are service-level; the client is never trusted for user IDs.
- CSRF: a state-changing request carrying the session cookie needs a trusted `Origin`. Details in [Security.md](Security.md).
