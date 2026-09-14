# User Flows

> End-to-end flows and the state machines behind the two transactional cores.
> Screens referenced here are mapped in [InformationArchitecture.md](InformationArchitecture.md); endpoints in [API.md](API.md).

---

## 1. Onboarding

```
Register → Verify email → Sign in → Dashboard (starter currency grant) → guided "open your first pack"
```

- Register (`/register`) collects username + email + password (Better Auth).
- Verify email (`/verify-email`) shows a "check your inbox" state; the link activates the account and releases a **1,000-coin welcome grant** (`CurrencyTransaction type=GRANT`).
- On first dashboard load, an onboarding checklist ("3 of 5") nudges: first pack → verify email → build a deck → make a trade.

## 2. Open a pack

```
Dashboard/Packs → choose template → Confirm-cost dialog → server generates + mints (atomic)
  → Reveal animation (sealed → opening → reveal → summary) → cards in inventory
```

- **Confirm-cost dialog** states cost + guarantee ("10 cards with at least 1 Rare. This action can't be undone.").
- Client generates an `openId` (UUID) and posts it — see [pack state machine](#5-pack-opening-state-machine).
- **Reveal** (`design/Booster Opening.dc.html`) has four stages: `sealed` (floating pack) → `opening` (shake + flash, ~2s) → `reveal` (tap to flip cards one by one; rare pulls glow) → `summary` (grid of pulls, "Open another" / "View in collection"). **Skippable** and reduced-motion aware.

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

See the [trade state machine](#6-trade-lifecycle-state-machine).

## 6. Admin sync

```
Admin → Sync control → "Sync prices now" → job enqueued (BullMQ) → progress + completion surfaced
```

---

## 5. Pack opening — state machine & algorithm

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

- Weights live in the DB — auditable/adjustable by admins; deterministic given RNG draws (log the seed for disputes).
- Use `crypto.randomInt`, **not** `Math.random`.
- **Idempotency:** client sends `openId` (UUID); a unique constraint on `PackOpening.openId` makes retries safe (double-click / network retry won't double-charge or double-mint).
- Guard against empty rarity buckets (fall back to next-lower rarity) so a misconfigured template can't 500.

---

## 6. Trade lifecycle — state machine

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

Stale `PENDING` trades (e.g. > 7 days) are auto-cancelled by a BullMQ expiry job, which releases locks.

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

## 7. Auth flows (Better Auth)

```
/register ──▶ /verify-email ──▶ /sign-in ──▶ Dashboard
                                    ▲
/forgot-password ──▶ (email) ──▶ /reset-password ──┘
```

- Email/password (optionally OAuth); email verification; password reset with token expiry.
- Session (httpOnly cookie) or JWT validated by a global Nest guard; `@Public()` opts out.
- Ownership checks are service-level; the client is never trusted for user IDs.
- Session security: httpOnly + Secure + SameSite cookies, refresh rotation, "sign out all sessions," CSRF for cookie flows.
