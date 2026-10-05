# PD-112 + PD-113 — The deck builder

Design, 2026-10-05. Milestone M13 · Application Pages.

Tickets: [PD-112](https://linear.app/mstrilec/issue/PD-112/deck-builder-drag-and-drop-assembly) (drag-and-drop
assembly) and [PD-113](https://linear.app/mstrilec/issue/PD-113/deck-builder-live-validation-and-stats-panel) (live
validation and stats). One spec, because the second is the first's right-hand column and both read the same draft.
Builds on PD-64/PD-65 (the deck validator, `docs/superpowers/specs/2026-09-28-pd-64-pd-65-deck-validation-design.md`),
PD-90 (`DeckSlot`, `CopyCountStepper`, `DeckValidationBanner`, the `deck-draft` store — `docs/Components.md`), PD-107
(`VirtualCardGrid`, the collection queries) and PD-111 (the decks list).
Reference: `docs/UserFlows.md` §3 · `docs/PRD.md` §5.3 · `docs/ComponentSpecs.md` (DeckSlot / CopyCountStepper,
DeckValidationBanner) · `docs/Architecture.md` §5 · `design/Pokemon TCG App.dc.html` (Deck builder).

---

## What the tickets ask

| Scope item | Where it lands |
| --- | --- |
| `/decks/:id`: two panels, a searchable and filterable pool, the deck as DeckSlots | [Layout](#layout), [Pool](#pool), [Decklist](#decklist) |
| dnd-kit drag between pool and deck, and reordering within the deck | [Drag and drop](#drag-and-drop); reordering dropped, [Decision 4](#decisions) |
| Copy counts by CopyCountStepper; dragging a card already in the deck increments | [Decklist](#decklist), [Drag and drop](#drag-and-drop) |
| Draft in the Zustand store; explicit save; a dirty-state guard on navigation | [Draft](#draft), [Save](#save), [Leaving](#leaving-with-unsaved-changes) |
| Keyboard alternative: dnd-kit keyboard sensor plus add/remove buttons | [Keyboard](#keyboard-and-screen-readers) |
| DeckValidationBanner fed by the engine, revalidating on every draft change | [Validation](#validation) |
| Errors link to the offending card | [Validation](#validation) |
| Recharts stats: energy-type curve, energy count, rarity spread | [Stats](#stats) |
| Format selector re-running legality | [Header](#header), [Validation](#validation) |
| Save disabled, with the reason, while blocking errors exist | [Save](#save), [Decision 2](#decisions) |

| Acceptance criterion | How it is met |
| --- | --- |
| A deck can be built end-to-end without a mouse | *+ Add* on every pool tile, steppers, header controls, a skip link; [Verification](#verification) 1 |
| Dragging is smooth with a pool of hundreds of cards | A virtualized pool, memoized draggables, a `DragOverlay` moved by transform; [Verification](#verification) 3 |
| Leaving with unsaved changes prompts first | `beforeunload`, an in-app link interceptor and a history sentinel for Back; [Verification](#verification) 6 |
| Drop targets are announced to screen readers | dnd-kit `announcements` written for this builder; [Verification](#verification) 2 |
| Validation feedback appears without a full round trip on every keystroke | The validator runs in the browser on every draft change; no request; [Verification](#verification) 4 |
| Client-side feedback never disagrees with the server's verdict on save | One validator, the API's own, in `@pokedrop/shared`; the save's verdict replaces the client's; [Verification](#verification) 4 |
| Charts update live as the draft changes | `toDeckStats` over the draft; [Verification](#verification) 5 |
| Every chart has an accessible text equivalent | A caption summary and a visually hidden table per chart; [Verification](#verification) 5 |

## Decisions

Taken with the user during brainstorming:

1. **D4 — the browser runs the API's validator.** `validateDeck` and `toDeckStats` are pure functions; they move from
   `apps/api/src/decks/` to `@pokedrop/shared`, and the API imports them from there. The client therefore cannot
   disagree with the server about the same inputs; the only input that can differ is the owner's available copies,
   which a trade can change between loading the deck and saving it, and the save answers with the server's verdict,
   which replaces the client's. Rejected: a dry-run validate endpoint called on a debounce (a request per change and
   no feedback offline) and a split where only size and copies run locally (two engines to keep in step).
2. **Rules never block a save.** The API saves an invalid deck on purpose: *New deck* creates an empty one and the
   decks list says *Fix it in the builder*. The "blocking errors" that disable *Save* are the ones the API would
   refuse with a 400 — an empty name, more than 100 distinct cards, more than 100 copies of one card. Rule failures
   are stated by the header's verdict badge and the save's toast (*Saved — not legal yet*).
3. **The pool switches between *My cards* and *All cards*,** independent of the deck's `ownedOnly`: the inventory
   (available copies on every tile) or the catalog (owned badges by `GET /inventory/owned`, D2). It opens on *My
   cards*. An unowned card may go into an owned-only deck; the validator says what that means.
4. **The draft is name, format, `ownedOnly` and the cards; *Public* saves at once,** as on the decks list. Sharing is
   not deck content, and turning it on cannot publish unsaved changes: the public page shows the saved deck. **No
   reordering:** the server keeps no card order (`DeckCard` has no position), so the decklist is grouped by supertype
   and sorted by name, as in the design, and dragging adds or removes copies.
5. **Recharts, loaded lazily** with the stats panel only, as the ticket and `docs/Architecture.md` §5 name it.

## Shared and API changes

| Change | Where | Why |
| --- | --- | --- |
| `validateDeck`, `ValidationCard`, `ValidationInput` move | `packages/shared/src/decks/validate.ts` | D4. The API's `DeckValidationService` and `DecksService` import them; their behaviour is unchanged |
| `toDeckStats`, `StatsRow` move | `packages/shared/src/decks/stats.ts` | The stats panel and the public deck page compute stats from the cards they hold |
| `DeckEntry.card` gains `legalities` | `DeckEntrySchema` in `packages/shared/src/entities/deck.ts`, the service's `DETAIL_SELECT` | The validator reads legality for every deck card |
| Inventory entries' card gains `legalities`, through a new `PlayableCardSchema` (`InventoryCardSchema` + `legalities`), which deck entries use too | `packages/shared/src/entities/inventory.ts`, the inventory service's card select | Cards added from *My cards* carry what the validator needs. Catalog cards (`CardSchema`) have it already. `InventoryCardSchema` itself is unchanged: it is also the card of pack openings, history, trades and showcases |
| `DeckDetail` gains `rules: { deckSize: number }` | `DeckDetailSchema`, `toDetail()` | The deck size is configuration (`DECK_SIZE`, default 60); the client reads it instead of copying the constant. Not private, so every viewer gets it |

No new endpoint. `docs/API.md` records the three new fields.

## Draft

The `deck-draft` store (`lib/stores/deck-draft.ts`) is reshaped:

- **State:** `saved` and `draft`, each `{ name, format, ownedOnly, cards: DeckCardInput[] }`; `cardsById`, a map from
  card id to what the validator, the rows and the charts need (`InventoryCard`-shaped plus `legalities`); `available`,
  a map from card id to available copies.
- **Actions:** `add(card, available?)` (records the card and, when the pool knows it, its available copies),
  `remove(cardId)`, `setCount(cardId, count)`, `setName`, `setFormat`, `setOwnedOnly`, `learnAvailable(counts)`,
  `reset(fromServer)`.
- **`isDirty`** compares name, format, `ownedOnly` and every count.
- `beforeDrag` and `undoDrag` go: a drop is one copy more or less and the stepper reverses it.
- The provider is keyed by the deck's id only. The store is seeded once from the first answer of `GET /decks/:id`;
  later refetches of that query — the *Public* switch invalidates the `decks` root — never touch it. Only a save
  (`reset` from the save's answer) and *Discard changes* replace it. **Trap:** keying by `updatedAt` would wipe the
  draft whenever *Public* is flipped.

**Derived, not stored:** `validation = validateDeck(...)` and `stats = toDeckStats(...)`, each a `useMemo` over the
draft. No debounce: the validator walks at most 100 entries.

**Available copies:** `useOwnedCounts` over the deck's card ids (one request, ≤100 ids) fills `available` on load;
when a card is added whose availability is unknown (added from *All cards* before its page's counts arrived), its id
joins the next request. Absent from the answer means 0.

## Layout

`app/(public)/decks/[id]/page.tsx` renders `DeckPage`: the builder for the owner, the [public view](#public-view) for
everyone else, decided by the deck's `userId` against the session, as `GET /decks/:id` decides what to return. A
private deck of someone else is the API's 404 and the not-found page. Loading is a three-column skeleton.

- **≥1280 px:** three columns under a sticky header — the pool (flexible), the decklist (~360 px) and the checks
  (~320 px). Each column scrolls on its own; the page does not scroll under the header.
- **1024–1279 px:** the pool and a second column holding the decklist above the checks.
- **<1024 px:** three tabs, *Pool*, *Deck · 42*, *Check*. Dragging is off; *+ Add* and the steppers build the deck.
  *Show card* in the checks switches to *Deck* first.

Components live in `components/decks/builder/`: `deck-builder.tsx` (the page and its columns), `builder-header.tsx`,
`card-pool.tsx`, `deck-list.tsx`, `deck-checks.tsx`, `deck-stats.tsx` (lazy), `builder-dnd.tsx` (the dnd-kit context,
sensors and announcements), `leave-guard.tsx`. Queries: `useDeck(id)` and `useSaveDeck()` in `lib/query/decks.ts`.

### Header

← *Decks*; the name as a text field (the *New deck* dialog's rules); a format select; an *Owned only / Theorycraft*
segment for `ownedOnly`; the verdict badge, *60/60 · Legal* (success) or *42/60 · 2 rules failing* (warning), a
button that moves focus to the checks; the *Public* switch (saves at once, `useUpdateDeck`); *Save* with its state,
*Unsaved changes*, *Saving…* or *Saved*.

### Pool

*My cards / All cards*, a search field and set, rarity and type filters. *My cards* is `useInventory`, *All cards* is
`useCatalogBrowse` with `useOwnedCounts` per page, both with the narrowing `collectionView` from PD-107. Pool filters
are local state, not the URL: the builder's URL is the deck's share link.

`VirtualCardGrid` gains an optional `scrollElement`: given one, it virtualizes inside that element with
`useVirtualizer` instead of the window. Each pool tile is the card's art and name, a badge *In deck ×2* when it is in
the draft, its available copies (*My cards*) or owned badge (*All cards*), and **+ Add** (*Add Charizard to the
deck*). *+ Add* refuses at the copy limit or at the 100th distinct card, saying why, as the stepper does.

### Decklist

Groups *Pokémon*, *Trainer*, *Energy*, each with its copy total; rows are `DeckSlot`s sorted by name, the stepper's
`max` from `copiesAllowed()` (basic energy: 100, the request bound). Empty: *Drag cards here or press + Add*. A *Skip
to deck* link sits before the pool for keyboard users.

### Validation

`DeckValidationBanner` takes the derived validation — or, after a save, the server's, until the next change. *Show
card* calls `focusDeckSlot`. Changing the format or `ownedOnly` changes the inputs, so legality and ownership re-run
at once.

### Stats

Lazy (`next/dynamic`, `ssr: false`, a skeleton while Recharts loads). Energy count as a figure; bars by Pokémon type
(the energy-type curve); bars by rarity; the Pokémon / Trainer / Energy split. Colours from the type and rarity
tokens. Each chart is a `<figure>`: the chart `aria-hidden`, a caption summary (*Fire 12, Lightning 6, Colorless 4*)
and a visually hidden table of the same numbers.

## Drag and drop

`@dnd-kit/core` only; sortable is not needed (Decision 4).

- **Draggables:** pool tiles (`{ from: 'pool', cardId }`) and decklist rows (`{ from: 'deck', cardId }`).
- **Droppables:** the decklist column and the pool column.
- **Pool → deck:** one copy more, whether or not the card is already in; at the limit nothing changes and the
  announcement says why. **Deck → pool:** one copy less; at zero the row leaves.
- A `DragOverlay` draws the card under the pointer; the source dims (`DeckSlot` `dragging`) and the hovered column
  highlights (`dropTarget`).
- **Sensors:** `PointerSensor` with a 6 px activation distance, so a click on a tile or *+ Add* is not a drag;
  `KeyboardSensor` with a coordinate getter that jumps between the two columns on ←/→. Below 1024 px no sensors.
- Pool tiles are `memo`ized so a drag re-renders only the active tile and the two columns.

## Keyboard and screen readers

**Without a mouse:** the header controls; the pool's search and filters; Tab through the rendered tiles' *+ Add*;
*Skip to deck*; the steppers; the checks' *Show card*; *Save* (or Ctrl/⌘+S). The keyboard drag is an extra path:
Space or Enter picks a tile up, ←/→ moves between columns, Space drops, Escape cancels.

**Announcements** (dnd-kit `accessibility`), with the card's name:

- start: *Picked up Charizard from the pool. Arrow right to move to the deck, Space to drop, Escape to cancel.*
- over: *Over the deck* / *Over the pool*
- end: *Added Charizard — 3 copies in the deck* · *Charizard is at the 4-copy limit; nothing added* · *Removed a copy
  of Charizard — 2 left* · *Removed Charizard from the deck*
- cancel: *Cancelled; the deck is unchanged*

`screenReaderInstructions` are read when a draggable takes focus.

## Save

`useSaveDeck` sends `PATCH /decks/:id` with `{ name, format, ownedOnly, cards }`, `meta: { toast: false }`. On
success: the answer goes into the deck's query cache, the store resets from it, its validation is shown until the next
change, the `decks` root and the owned counts are invalidated, and a toast says *Saved* or *Saved — not legal yet: 2
rules failing*.

*Save* is disabled, with the reason beside it (`aria-describedby`), only when: nothing changed (*No changes to save*);
the name is empty (*Name the deck*); the draft holds more than 100 distinct cards (*A deck holds at most 100 different
cards*) — which *+ Add* already prevents.

**Failures keep the draft.** Network or 5xx: *Couldn't save — your changes are still here*, *Save* enabled again. 404
(deleted in another tab): a dialog, *This deck no longer exists*, linking to `/decks`. 400: the server's message in a
toast. Two tabs on one deck: the last save wins; the API serialises saves of one deck.

## Leaving with unsaved changes

Only while the draft is dirty:

- **Reload or close:** `beforeunload`.
- **In-app links** (sidebar, ← *Decks*, anything else): a capture-phase click listener on same-origin `a[href]` stops
  the navigation and opens *Leave without saving?* — **Save and leave**, **Discard changes**, **Stay** (focused).
  The App Router has no navigation-blocking API.
- **Back:** a sentinel history entry is pushed while dirty; `popstate` restores it and opens the same dialog; *Discard
  changes* then goes back for real.
- Saving or discarding removes the sentinel.

## Public view

For anyone who is not the owner, signed in or out, of a public deck: the name, the owner (linking to `/profile/:id`),
the format and the card count; the decklist in the same groups with read-only rows (`DeckSlot` gains `readOnly`: *×3*
instead of a stepper); the stats panel from the deck's cards. No verdict: it depends on the owner's copies, which are
private (as in D3). **Clone** for a signed-in viewer, opening the copy in the builder; *Sign in to clone* for a guest,
with `next` back to the deck. `generateMetadata` names the tab after the deck for anyone the API shows it to (a server fetch with the
visitor's cookies, so the owner's private deck too); otherwise *Deck*.

## Dependencies

`@dnd-kit/core` and `recharts`, both MIT.

## Documentation

- `docs/Pages.md`: D4 in the decisions table; a *Deck builder (PD-112, PD-113)* section with what it measured and its
  traps.
- `docs/API.md`: `legalities` on deck entries and inventory cards; `rules.deckSize` on `DeckDetail`.
- `docs/Components.md`: the builder's parts, `VirtualCardGrid` `scrollElement`, `DeckSlot` `readOnly`.
- `docs/Architecture.md` §5: the validator and the stats live in `@pokedrop/shared`.

## Verification

No automated tests (v1). Measured in a browser over CDP against the running API, with the user's test data:

1. **Without a mouse:** a 60-card deck built from an empty one by keys only — name, format, search, *+ Add*,
   steppers, *Save*; `GET /decks/:id` holds what was built.
2. **Drag:** pool → deck adds (and refuses at the limit), deck → pool removes, by pointer and by keyboard (Space, →,
   Space); the dnd-kit live region's text at each step.
3. **Smoothness:** a drag across a pool of 500+ cards; long tasks and frame times recorded.
4. **Agreement:** after each save the client's verdict equals the server's. A trade locking a deck card between load
   and save: the server's verdict differs, and the page shows the server's.
5. **Charts:** every draft change updates them; each hidden table holds the chart's numbers.
6. **Leaving:** a link, Back and reload with a dirty draft, and each dialog button; none with a clean one.
7. **375 px:** tabs, no horizontal scroll. **Public view:** a guest and another member see the read-only deck; a
   private deck is 404; *Clone* opens the copy.

## Out of scope

Persisted card order; undo beyond the stepper; draft recovery after a reload; offline save; a verdict on the public
view.
