# PD-115 — The trade composer

Design, 2026-10-05. Milestone M13 · Application Pages.

Ticket: [PD-115](https://linear.app/mstrilec/issue/PD-115/propose-trade-composer). Builds on PD-68–PD-71 (the trade
core: propose, counter, locks — `docs/superpowers/specs/2026-09-28-pd-68-pd-71-trade-core-design.md`), PD-99
(`TradeOfferPanel`, `CurrencyInput` — `docs/Components.md`), PD-107/PD-108 (the collection queries and
`VirtualCardGrid`), PD-112 (`useUnsavedChanges`) and PD-114 (the inbox, `TradeParty`). PD-116 adds the *Counter* button
that opens this composer in counter mode; PD-110 and PD-117 add the *Propose trade* links that open it pre-filled.
Reference: `docs/UserFlows.md` §5 · `docs/ComponentSpecs.md` (TradeOfferPanel, CurrencyInput) · `docs/API.md` *Trades*,
*Users / Profile* · `design/Pokemon TCG App.dc.html` (Propose trade).

---

## What the ticket asks

| Scope item | Where it lands |
| --- | --- |
| `/trades/new` — TradeOfferPanel, the offered side from own available inventory, the requested side from the counterparty's | [Screen](#screen), [Pickers](#card-pickers), [Decision 1](#decisions) |
| Optional coins on either side via CurrencyInput, clamped to balance | [Screen](#screen) |
| Only `availableQuantity` is offerable; locked copies visibly excluded | [Pickers](#card-pickers) |
| Pre-fill from a card detail page or a public profile | [Pre-fill](#pre-fill) |
| A review step restating both sides in plain language | [Review](#review) |

| Acceptance criterion | How it is met |
| --- | --- |
| A card locked by another pending trade cannot be selected | The give picker greys a card whose copies are all locked and refuses it with the reason; a line's `max` is its available copies; [Verification](#verification) 2 |
| The review step is unambiguous about direction | Two headed lists, *You give Misty* / *Misty gives you*, with an arrow and the words, never colour alone; [Verification](#verification) 5 |
| Arriving from "propose trade for this card" pre-fills the requested side | `?card=` puts one copy on the side the counterparty gives; [Verification](#verification) 4 |
| Self-trade is impossible to construct in the UI | The user search never returns the caller; `?to=` naming the caller is dropped with the reason; `composeProblems` refuses it anyway; [Verification](#verification) 3 |

## Decisions

Taken with the user during brainstorming (D5 in `docs/Pages.md`):

1. **The requested side is chosen from the whole catalog**, with the counterparty's showcase first as *On Misty's
   showcase*. Their inventory stays private: the API does not check the recipient's cards at proposal, so that a
   refusal cannot disclose a collection, and settlement checks them (`409` if they lack a card). The review says so.
   Rejected: a new endpoint exposing the counterparty's tradeable inventory behind a privacy opt-in (a change to the
   privacy model, the API and Settings), and the showcase alone (at most six cards to ask for).
2. **A member user search, `GET /users?q=`**, answering only the public `{ id, displayName, avatarUrl }`; the composer's
   *Trade with…* is a combobox over it. Rejected: a counterparty only through a profile link (a card page could never
   start a trade) and pasting a profile link or id.
3. **Counter mode now.** `/trades/new?counter=<tradeId>` opens the same composer with the counterparty fixed and both
   sides flipped from that trade, and sends `POST /trades/:id/counter`. PD-116 then only adds the button.

## API

**`GET /users?q=`** — member only, in `UsersController`:

| | |
| --- | --- |
| Query | `q`: trimmed, 2–64 characters, no NUL (`UserSearchQuerySchema`) |
| Answer | up to 10 `TradeParty` — `{ id, displayName, avatarUrl }` (`UserSearchResultSchema = z.array(TradePartySchema)`) |
| Match | `displayName` contains `q`, case-insensitive; an exact match (case-insensitive) first, then by name |
| Excluded | the caller; suspended accounts (`suspendedAt` set) |
| Never | email, role, balance — what the public profile never shows either |
| Throttle | `MODERATE_THROTTLE`, as proposing a trade: a name search can enumerate members |

No index is added: `EXPLAIN ANALYZE` on the users table is recorded in `docs/API.md` with the decision. Everything else
exists: `POST /trades` and `POST /trades/:id/counter` take the same `offered` / `requested` / coins and refuse a
self-trade (400), locked copies (409 `CARDS_UNAVAILABLE`), coins beyond the balance (402) and a card on both sides
(400); `GET /users/:id`, `GET /cards/:id`, `GET /trades/:id` and `GET /inventory` feed the composer.

## Screen

`app/(app)/trades/new/page.tsx` renders `TradeComposer` (`components/trades/composer/`). State is a `useReducer` local
to it — one screen, nothing shared:

```
{ mode: 'new' | 'counter', counteredId: string | null, counterparty: TradeParty | null,
  give: Line[], get: Line[], coinsGive: number, coinsGet: number, step: 'compose' | 'review' }
Line = { card: InventoryCard, count: number, max: number }
```

`composeProblems(state, me)` names what keeps *Review offer* disabled, the first shown beside the button: no
counterparty; the counterparty is the caller; nothing on either side (*Add a card or coins to either side*); more than
20 lines on a side; a card on both sides; coins beyond the balance.

From the top:

1. *Trades › New proposal*, *Propose a trade* (or *Counter Misty's offer*), and a line saying offered cards lock when
   sent.
2. **Trade with…** — `CounterpartyPicker`, a combobox (`role="combobox"` + `listbox`) over `GET /users?q=` with a 300 ms
   debounce; arrows, Enter and Escape; *No collectors match* and *Type at least 2 characters*. The choice shows as a
   chip — avatar, name, *Change*. Fixed in counter mode.
3. **`TradeOfferPanel`**, *You give* (red border) and *Misty gives* (green border). It gains a count stepper per line
   (`count` 1..`max`: the give side's `max` is the line's available copies, the get side's 100) and its add slot opens
   a picker.
4. **Coins** — the panel's two `CurrencyInput`s; *Coins you give* capped at the balance (`GET /users/me`).
5. *Review offer* (disabled, with the reason) and *Cancel* (to `/trades`).

The leave guard (`useUnsavedChanges`) is on while anything is on either side.

## Card pickers

`CardPickerDialog` — a dialog with a search field and a virtualized grid of tiles (`VirtualCardGrid` inside the
dialog's scroll area); choosing a tile adds one copy (or one more) and keeps the dialog open; *Done* closes it.

- **You give** — the caller's cards (`useInventory`, name search). A tile shows *×4 · 1 locked*. A card with every copy
  locked is grey, `aria-disabled`, and says *All copies locked in pending trades*; one already at its available count
  says *All available copies added*.
- **Misty gives** — *On Misty's showcase* (up to six, from `GET /users/:id`) above a catalog search (`useCatalogBrowse`).
- **Either side** — a card already on the other side is refused: *Already on Misty's side — a card can't be on both*.

## Review

A step of its own, not a dialog, so it fits a phone:

- **You give Misty** — `2 × Charizard (BASE1 4)`, `50 coins`; an up-right arrow and the word *give*.
- **Misty gives you** — the same, down-left arrow. An empty side reads *Nothing — a gift* (give side empty) or *Nothing in
  return* (get side empty).
- **What happens:** *Your 3 cards lock until Misty answers, you cancel, or the offer expires.* (the window is the
  server's; the sent trade shows its `expiresAt`); *Misty's cards aren't checked now — the trade can only be accepted
  if Misty has them.*; in counter mode *Your counter-offer replaces Misty's offer, which closes as Countered.*
- *Back to edit* and *Send offer* / *Send counter-offer*.

**Sent:** a toast *Offer sent to Misty*; the `proposeTrade` / `counterTrade` mutations invalidate `trades`, `inventory`
(the caller's copies are now locked) and `notifications`; then `/trades?tab=sent` (PD-116 may point it at the trade).

**Refused** — the draft stays and the step returns to *compose*:

- 409 `CARDS_UNAVAILABLE`: *Some of your copies were locked by another trade meanwhile*; the inventory is refetched and
  each give line's `max` re-read, a line over it cut down with a note.
- 402: *You don't have that many coins any more*.
- 409 `TRADE_NOT_PENDING` (counter): *Misty's offer was already answered*, with a link to the inbox.
- 400 / 404: the server's message.

## Pre-fill

| Parameter | Read | Effect |
| --- | --- | --- |
| `?to=<userId>` | `GET /users/:id` | the counterparty and their showcase; the caller's own id is dropped with *You can't trade with yourself*; 404 *That collector doesn't exist* |
| `?card=<cardId>` | `GET /cards/:id` | one copy on the side the counterparty gives; without `?to=` it waits for a counterparty |
| `?counter=<tradeId>` | `GET /trades/:id` | when the caller is the recipient of a pending trade: the initiator as the fixed counterparty, its `requested` lines on *You give*, its `offered` lines on *Misty gives*, its coins swapped; give lines capped at the caller's available copies now, a cut line noted. Otherwise an explanation and a link back |

`?counter=` ignores `?to=` and `?card=`.

## Documentation

- `docs/Pages.md`: D5 in the decisions table; a *Trade composer (PD-115)* section with what it measured and its traps.
- `docs/API.md`: `GET /users?q=` under *Users / Profile*, with its `EXPLAIN` and the no-index decision.
- `docs/Components.md`: `TradeOfferPanel`'s stepper and picker hook, `CounterpartyPicker`, `CardPickerDialog`.

## Verification

No automated tests (v1). In a browser over CDP against the running API, with the two test members:

1. **Counterparty:** typing `pd1` finds the other member by keys alone (arrows, Enter); the caller never appears;
   *Change* clears the choice.
2. **Locked copies:** a card all of whose copies are locked by a pending trade is grey and refused in the give picker; a
   partly locked card's line stops at its available copies.
3. **Self-trade:** `?to=<own id>` is dropped with the reason; the search for the caller's own name does not return them.
4. **Pre-fill:** `?to=…&card=base1-4` opens with the counterparty and one *Charizard* on their side.
5. **Review:** the text for a two-sided trade, a gift and a request-only trade; direction read from the DOM.
6. **Send:** the trade appears under *Sent* with the right lines and coins; the offered copies are locked
   (`GET /inventory/owned`).
7. **Refusal:** copies locked from another tab between compose and send → the 409 message, the draft kept, the line cut.
8. **Counter:** from the other member's pending trade, `?counter=` flips both sides; sending makes the original
   *Countered* and the new trade pending the other way.
9. **375 px**, keyboard only end to end, no console errors.

## Out of scope

The *Counter* button on the trade page (PD-116); *Propose trade* links on the card and profile pages (PD-110, PD-117);
a privacy opt-in that exposes a member's tradeable cards; requesting coins beyond the counterparty's balance (the server
checks at settlement).
