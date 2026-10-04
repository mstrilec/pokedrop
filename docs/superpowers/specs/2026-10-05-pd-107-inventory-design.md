# PD-107 — Inventory: the collection view

Design, 2026-10-05. Milestone M13 · Application Pages.

Ticket: [PD-107](https://linear.app/mstrilec/issue/PD-107/inventory-page-virtualized-grid-and-list-with-filters-and-instant).
The collection view it builds is reused by PD-108 (catalog browse) and PD-112 (the deck builder's card pool), so its
shared pieces know nothing about the inventory.
Builds on PD-94 (`FilterBar`, `SearchInput`, `useUrlState`), PD-95 (`CardTile`), PD-96 (`DataTable`, `StatCard`),
PD-93 (`CompletionMeter`) — `docs/Components.md` — and PD-87 (query keys and invalidation, `docs/Frontend.md`).
Reference: `docs/PRD.md` §5.2 · `docs/InformationArchitecture.md` §03 · `docs/API.md` *Inventory* ·
`design/Pokemon TCG App.dc.html` (Inventory).

---

## What the ticket asks

| Scope item | Where it lands |
| --- | --- |
| Grid and dense list views, toggleable and remembered | [View](#the-page), [Shared pieces](#shared-pieces) |
| Virtualized rendering so thousands of cards stay smooth | [Shared pieces](#shared-pieces) |
| FilterBar driven by facets: set, rarity, type, owned-count; sorting by price, name, acquired date | [Filters](#filters) |
| Server-side search and filtering; instant client-side filtering of the loaded page | [Instant filter](#instant-filter) |
| Aggregate header: totals, collection value, per-set completion | [Header](#header) |
| Locked quantities visibly distinguished from available ones | [Locked copies](#locked-copies) |

| Acceptance criterion | How it is met |
| --- | --- |
| A 5,000-card collection scrolls at 60fps | Window virtualization of grid rows and list rows; measured over a 5,000-card collection, [Verification](#verification) 2 |
| Filter and sort state lives in the URL and survives a refresh | `useUrlState` over the inventory query schema plus `view`; [Verification](#verification) 4 |
| Client-side instant filtering never contradicts server-side results | The client narrows with the server's own predicate, and only where the narrowing is a subset of the server's answer; [Verification](#verification) 3 |
| Cards locked in a pending trade are clearly marked as unavailable | `CardTile`'s `locked` and the list's *Copies* column; [Verification](#verification) 5 |

## Decisions

Taken with the user during brainstorming:

1. **No Fuse.js.** The ticket names it for instant filtering and also asks that the client never contradict the server.
   The server matches a case-insensitive substring of the name; Fuse is fuzzy by design, so it would show Charizard for
   `chrzd`, which the server never returns. The client narrows with the server's predicate instead (`matchesName`), and
   no dependency is added. `docs/Architecture.md` §5 is corrected.
2. **Infinite scroll over keyset pages of 100**, the API's maximum. The next page loads when the viewport is three rows
   from the end. Filtering and sorting stay on the server, which scales to any collection size. Rejected: loading the
   whole collection up front for client-side filtering (a slow first paint and memory that grows with the collection,
   against the ticket's "server-side for scale"), and a *Show more* button (fifty presses for 5,000 cards).
3. **The collection view is shared and inventory-agnostic** (`components/collection/`): it takes items and a tile
   renderer, so PD-108 renders catalog tiles with owned badges and PD-112 renders selectable pool tiles through it.

## Shared pieces

| Piece | File | Does |
| --- | --- | --- |
| `VirtualCardGrid` | `components/collection/virtual-card-grid.tsx` | Virtualizes the grid by **rows** with `useWindowVirtualizer` (the window scrolls; the topbar is sticky). Columns come from the container's width (`ResizeObserver`) and `minTileWidth`. Renders `renderTile(item)`; calls `onLoadMore` when the last rendered row is within three rows of the end and `hasMore` |
| `DataTable` `virtualize` | `components/ui/data-table.tsx` | New optional prop `virtualize: { estimateRowHeight: number; onEndReached?: () => void }`. The body renders only the visible rows between top and bottom spacers; `aria-rowcount` is the whole known count and each row carries `aria-rowindex`. Without the prop, nothing changes |
| `matchesName` | `lib/name-match.ts` | The server's rule: a case-insensitive substring of the name, `%`, `_` and `\` matched literally |
| `CardTile` `locked` | `components/cards/card-tile.tsx` | New optional prop, the number of locked copies; see [Locked copies](#locked-copies). `owned={0}` keeps meaning "not owned" |

**New dependency:** `@tanstack/react-virtual`, from the same maintainers as Table and Query.

`SearchInput` gains an optional `onInput(text)`, called on every keystroke, before the debounce, for the instant filter.

## The page

`/inventory` (`components/inventory/`), data through `lib/query/inventory.ts`:

- `useInventory(filters)` — an infinite query, `pageSize: 100`, keyed `['inventory', 'list', filters]`,
  `placeholderData: keepPreviousData`. A change of filter or sort is a new key, so its pages start from the first; the
  API ties a cursor to its sort and nothing else, and the client drops it with every change.
- `useInventorySummary()` — keyed `['inventory', 'summary']`.

Both live under the `inventory` root, which `openPack` already invalidates.

**URL.** The schema is `InventoryQuerySchema.pick({ q, set, rarity, type, minQuantity, sort })` plus `view`
(`grid` | `list`, default `grid`), through `useUrlState`. The last view chosen is also kept in `localStorage`
(`pokedrop.inventory-view`, read and written in try/catch): `/inventory` without `?view=` opens in it. A filter or sort
pushes a history entry; search replaces (PD-94's rule).

### Header

`PageHeader` *Your collection*, its line *842 cards · 391 unique · worth $2,480*. Four `StatCard`s: *Total cards*,
*Unique*, *Collection value* (noted *priced: 16 of 391*, because few cards carry a price), *Sets started*. Then a
`CompletionMeter` per set in `setCompletion`, newest release first: the first six, the rest behind *Show all N sets*.
Skeletons of the same size while the summary loads.

### Filters

| Filter | Options |
| --- | --- |
| Set | `setCompletion`: only sets the user owns cards in, labelled *Base · 3/102* |
| Rarity, Type | `GET /facets` (global counts, as PD-94 settled) |
| Copies | *Any* · *2+ (duplicates)* · *4+ (playset)* → `minQuantity` |
| Sort | *Recently acquired* · *Oldest first* · *Name A–Z* · *Name Z–A* · *Price high–low* · *Price low–high* |

The search is a `SearchInput` in the bar's `search` slot, 300 ms debounce.

### Grid and list

- **Grid:** `VirtualCardGrid` of `CardTile`s linking `/cards/:id`, `owned={quantity}`, `locked={lockedQuantity}`,
  `minTileWidth` 150 px.
- **List:** `DataTable` with `virtualize`. Columns: *Card* (thumbnail, name, set number), *Rarity*, *Type*, *Copies*,
  *Price*, *Acquired*. The *Card*, *Price* and *Acquired* headers drive the **server's** sort through `?sort=`
  (`sorting` / `onSortingChange`), so the table never reorders a page by itself.
- Under either: *Showing 300 of 842* (`role="status"`), and a spinner while the next page loads.

### Locked copies

- Some copies locked: the tile's badge reads *×3 · 1 locked*; the list's *Copies* reads *3 · 1 locked* with a lock icon.
- All copies locked (`availableQuantity` 0): the tile is greyscale with the lock, as an unowned tile is, and its name
  says *3 owned, all locked in pending trades*.

### Empty, error and loading

- No cards at all: *Your collection is empty* with *Open a pack*.
- Filters that match nothing: *No cards match these filters* with *Clear filters*.
- The first page failing: `ListError` in place of the view. A later page failing: *Couldn't load more* with
  *Try again* under what is already loaded.
- First load: skeleton tiles or rows.

## Instant filter

`SearchInput` reports what is typed (`typed`) on every keystroke; the server's query is `q`, in the URL after the
debounce. While they differ:

| `typed` against `q` (case-insensitive) | Shown |
| --- | --- |
| `typed` contains `q` (typing on) | the loaded items narrowed by `matchesName(name, typed)` — each is in the server's answer for `typed` too |
| `q` contains `typed` (deleting) | the current results unchanged — a subset of what the server will return |
| neither (new text) | the current results dimmed and `aria-busy` until the server answers |

Once the answer for the new `q` arrives (`isPlaceholderData` false), the narrowing is dropped. The client therefore only
ever shows a subset of what the server returns for the text in the field; it may show fewer, never other.

## Known limit

Tab reaches only rendered items (the visible rows plus overscan). The rest renders as the page scrolls — PageDown,
Space, the scrollbar — and Tab continues from there. Search and filters remain the fast way to a card. Recorded, not
worked around.

## Files

| File | Change |
| --- | --- |
| `apps/web/package.json` | `@tanstack/react-virtual` |
| `apps/web/lib/name-match.ts` | new |
| `apps/web/lib/query/keys.ts` | `inventory.summary` |
| `apps/web/lib/query/inventory.ts` | new: `useInventory`, `useInventorySummary` |
| `apps/web/lib/api/endpoints/inventory.ts` | `inventorySummary()` |
| `apps/web/components/ui/search-input.tsx` | `onInput` |
| `apps/web/components/ui/data-table.tsx` | `virtualize` |
| `apps/web/components/cards/card-tile.tsx` | `locked` |
| `apps/web/components/collection/virtual-card-grid.tsx` | new |
| `apps/web/components/inventory/*.tsx` | new: the header, the filters, the grid and list, the page body |
| `apps/web/app/(app)/inventory/page.tsx` | the placeholder replaced |
| `docs/Architecture.md` | §5: Fuse.js replaced by the shared predicate |
| `docs/Components.md` | `DataTable` `virtualize`, `CardTile` `locked`, `SearchInput` `onInput`, `VirtualCardGrid` |
| `docs/Pages.md` | the section and its measurements |

Nothing changes in `apps/api` or `packages/shared`.

## Verification

No automated tests in v1. Measured with a fresh headless Chrome profile against `next build && next start` and the live
API; each result recorded in `docs/Pages.md`.

1. **Test data.** One member with 5,000 `inventory_items` rows over distinct mirrored cards, some with `quantity` above
   1, inserted in SQL; the summary's cache key deleted.
2. **5,000 cards at 60fps.** Scroll the grid and then the list from top to bottom, loading every page on the way; frame
   time median and p95, and frames over 16.7 ms. The target is a median at or under 16.7 ms.
3. **Instant filter.** Type `c`, `ch`, `cha`, `char`, then delete back; at every step the visible names are a subset of
   `GET /inventory?q=<that text>`.
4. **URL state.** A set, a rarity, `minQuantity=2`, a sort and `view=list` survive a reload; Back undoes the last filter.
5. **Locked copies.** A pending trade offering one of two copies and another offering a card's only copy: *×2 · 1
   locked* and a greyscale, locked tile; the same in the list.
6. **375 px and keyboard.** No horizontal page scroll in either view; filters, tiles and the sort headers reachable and
   operable by keyboard.
