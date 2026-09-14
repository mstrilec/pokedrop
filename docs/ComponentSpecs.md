# Component Specs

> The contract for every UI primitive and composite. Extracted from `design/Component Specs.dc.html` and `design/CardTile.dc.html`.
> Props map 1:1 to the React/shadcn implementation. Tokens referenced here are defined in [DesignSystem.md](DesignSystem.md).

**Legend**
- **Primitive** — atomic, style-only.
- **Composite** — composes primitives + data.

24 components across 6 groups. Every component lists **Props · Variants · States · Accessibility**. Required props are marked `*`.

---

## Primitives

### Button `primitive`
The core action trigger. Text label with optional leading icon; visual weight proportional to intent.

| Prop | Type | Default | Description |
|---|---|---|---|
| `variant` | `"primary" \| "secondary" \| "ghost" \| "confirm" \| "destructive" \| "economy"` | `"primary"` | Visual intent + color treatment. |
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | Padding + font-size (13 / 14 / 16px). |
| `icon` | `LucideName` | — | Optional leading glyph, sized to match label. |
| `disabled` | `boolean` | `false` | Dims to 40% and blocks pointer events. |
| `onClick`* | `() => void` | — | Activation handler. |

- **Variants:** primary · secondary · ghost · confirm · destructive · economy
- **States:** default · hover · active · focus-visible · disabled · loading
- **A11y:** native `<button>`, Enter/Space activate · visible 2px focus ring at 3:1 · `disabled` sets `aria-disabled` + removes from tab order · label ≥ 4.5:1 on its fill · icon-only requires `aria-label`.

### IconButton `primitive`
A square 40px control for a single icon action (bell, overflow, close).

| Prop | Type | Default | Description |
|---|---|---|---|
| `icon`* | `LucideName` | — | Glyph to render (17px). |
| `label`* | `string` | — | Accessible name announced to AT. |
| `badge` | `boolean \| number` | `false` | Optional unread dot or count. |
| `onClick`* | `() => void` | — | Activation handler. |

- **Variants:** ghost · surface · with-badge — **States:** default · hover · active · focus-visible
- **A11y:** `aria-label` mandatory · 44px min touch target · badge count in `aria-label` suffix, not color alone.

### Badge / Chip `primitive`
A compact status/category marker. Tinted background at ~14% of the hue with matching text and optional leading dot.

| Prop | Type | Default | Description |
|---|---|---|---|
| `tone` | `"rarity" \| "status" \| "utility" \| "role"` | `"status"` | Semantic family selecting the palette. |
| `label`* | `string` | — | Text content. |
| `dot` | `boolean` | `true` | Show the leading indicator dot. |
| `icon` | `LucideName` | — | Optional glyph in place of the dot. |

- **Variants:** Common→Secret ramp · Pending/Accepted/Declined/Countered · Legal/Issues · IN/OUT · Admin
- **States:** static (non-interactive)
- **A11y:** decorative only, always paired with text · dot contrast ≥ 3:1, text ≥ 4.5:1 · `role="status"` for live changes.

### CurrencyPill `primitive`
Displays the user's coin balance in gold (Geist Mono numeral); doubles as a link to the wallet.

| Prop | Type | Default | Description |
|---|---|---|---|
| `amount`* | `number` | — | Balance, formatted with thousands separators. |
| `size` | `"sm" \| "md"` | `"md"` | Compact vs standard. |
| `interactive` | `boolean` | `true` | Renders as a link/button to the wallet. |

- **Variants:** static · interactive — **States:** default · hover
- **A11y:** numeral read as "1,250 coins" via `aria-label` · gold-on-tint ≥ 4.5:1.

### Avatar `primitive`
A user's visual identity — a gradient tile with the initial, or an uploaded image.

| Prop | Type | Default | Description |
|---|---|---|---|
| `name`* | `string` | — | Used for the initial + accessible name. |
| `src` | `string` | — | Optional image URL; falls back to initial. |
| `size` | `number` | `34` | Square dimension in px. |
| `gradient` | `[string,string]` | brand | Fallback tile gradient. |

- **Variants:** initial · image · sizes 28–88 — **States:** default
- **A11y:** `alt`/`aria-label` derived from name · decorative gradient hidden from AT.

### CompletionMeter `primitive`
A thin horizontal progress bar for set completion and deck/energy balance.

| Prop | Type | Default | Description |
|---|---|---|---|
| `value`* | `number` | — | Current amount. |
| `max`* | `number` | — | Total for 100%. |
| `color` | `string` | `var(--pri)` | Fill color (often set-themed). |
| `height` | `number` | `7` | Track thickness in px. |

- **Variants:** default · set-themed — **States:** empty · partial · complete
- **A11y:** `role="progressbar"` with `aria-valuenow/min/max` · percentage shown as text, not color alone.

### Skeleton `primitive`
A shimmering placeholder mirroring loading content to prevent layout shift.

| Prop | Type | Default | Description |
|---|---|---|---|
| `shape` | `"line" \| "block" \| "circle"` | `"line"` | Geometry preset. |
| `width` | `string` | `"100%"` | CSS width. |
| `height` | `string` | — | CSS height. |

- **Variants:** line · block · circle — **States:** animating
- **A11y:** `aria-hidden`; container exposes `aria-busy="true"` · respects `prefers-reduced-motion`.

### Spinner `primitive`
An indeterminate circular loader for waits with no measurable progress (pack opening, sync).

| Prop | Type | Default | Description |
|---|---|---|---|
| `size` | `number` | `34` | Diameter in px. |
| `label` | `string` | `"Loading"` | Accessible status text. |

- **Variants:** sm · md · inline — **States:** spinning
- **A11y:** `role="status"` + visible/hidden label · honors `prefers-reduced-motion`.

---

## Inputs & forms

### Input / FormField `primitive`
A labelled text field with inline validation — atom of every auth/settings form (RHF + Zod).

| Prop | Type | Default | Description |
|---|---|---|---|
| `label`* | `string` | — | Field label above the control. |
| `type` | `"text" \| "email" \| "password" \| "number"` | `"text"` | Native input type. |
| `placeholder` | `string` | — | Ghost hint text. |
| `error` | `string` | — | Validation message; flips border to danger. |
| `value` | `string` | — | Controlled value. |

- **Variants:** default · with-error · password (masked) · mono (numeric)
- **States:** default · focus · filled · error · disabled
- **A11y:** `<label for>` tied to input id · `aria-invalid` + `aria-describedby` link the error · focus ring never removed; error not color-only.

### Toggle (Switch) `primitive`
A binary on/off control for privacy and preference settings.

| Prop | Type | Default | Description |
|---|---|---|---|
| `checked`* | `boolean` | `false` | On/off state. |
| `onChange`* | `(v:boolean) => void` | — | Change handler. |
| `label` | `string` | — | Associated description. |
| `disabled` | `boolean` | `false` | Non-interactive state. |

- **Variants:** on · off — **States:** default · hover · focus-visible · disabled
- **A11y:** `role="switch"` + `aria-checked` · Space toggles; label clickable · state by knob position + color, not color only.

### SearchInput `composite`
A search field with a leading icon; drives instant client filtering (Fuse.js) plus server queries.

| Prop | Type | Default | Description |
|---|---|---|---|
| `placeholder` | `string` | `"Search…"` | Hint text. |
| `value` | `string` | — | Query string. |
| `onSearch` | `(q:string) => void` | — | Debounced query callback. |
| `scope` | `"catalog" \| "inventory"` | `"inventory"` | Which dataset to query. |

- **Variants:** topbar (global) · inline (filter bar) — **States:** default · focus · has-query · empty-results
- **A11y:** `role="searchbox"`; Escape clears · result count announced via `aria-live`.

### FilterBar / FilterChip `composite`
A row of dropdown filters (set, rarity, type, sort) plus a view toggle, above card grids.

| Prop | Type | Default | Description |
|---|---|---|---|
| `filters`* | `Filter[]` | `[]` | Filter definitions with active values. |
| `view` | `"grid" \| "list"` | `"grid"` | Current layout toggle. |
| `onChange` | `(f) => void` | — | Emits updated filter state. |

- **Variants:** catalog · inventory · with view-toggle — **States:** default · open · active-filter
- **A11y:** each chip is a labelled menu button (`aria-haspopup`) · active filters announced; clearable via keyboard.

---

## Data display

### CardTile `composite`
The signature primitive — an abstract, rarity-tinted card face with HP, type glyph, owned count, and price. Glows on Ultra/Secret. Aspect locked to **5:7**.

| Prop | Type | Default | Description |
|---|---|---|---|
| `card`* | `Card` | — | `{ name, type, rarity, hp, price, owned, setCode, number }`. |
| `onOpen` | `() => void` | — | Navigates to the card detail screen. |
| `size` | `string` | auto | Grid-driven; aspect locked to 5:7. |

- **Variants:** owned · unowned (locked/greyed with lock icon) · high-rarity (glow)
- **States:** default · hover (lift + border) · focus-visible · locked
- **A11y:** focusable card acts as a link · rarity + ownership stated in text, not color alone · type glyph paired with type name in detail.
- **Rendering notes:** face = `linear-gradient(155deg, <energyColor>, #0d0f14)`; owned badge `×N` top-right; unowned overlay `rgba(6,7,10,.6)` + grayscale + lock; footer shows rarity chip + mono price.

### StatCard `composite`
A single KPI tile — label, tinted icon, large mono value, trend delta.

| Prop | Type | Default | Description |
|---|---|---|---|
| `label`* | `string` | — | Metric name. |
| `value`* | `string` | — | Formatted value (mono). |
| `icon` | `LucideName` | — | Tinted glyph. |
| `trend` | `string` | — | Delta text. |
| `trendTone` | `"up" \| "down" \| "flat"` | `"up"` | Colors the trend line. |

- **Variants:** dashboard · inventory (compact) · admin metric — **States:** default
- **A11y:** value + label form a labelled group · trend direction stated in text, arrow reinforces.

### DataTable / TableRow `composite`
A CSS-grid table inside a surface card — uppercase header, hairline dividers, mono numeric columns, row hover.

| Prop | Type | Default | Description |
|---|---|---|---|
| `columns`* | `Column[]` | — | Header defs with grid template. |
| `rows`* | `Row[]` | `[]` | Row data. |
| `onRowClick` | `(row) => void` | — | Optional row activation. |
| `dense` | `boolean` | `false` | Tighter row padding. |

- **Variants:** static · clickable rows · with row actions — **States:** default · row-hover · empty · loading (skeleton rows)
- **A11y:** table/row/cell semantics · sortable headers are buttons with `aria-sort` · row actions keyboard-reachable, not hover-only.

### PackTemplateCard `composite`
A purchasable pack — type-gradient art, name, card count, guarantee, cost button.

| Prop | Type | Default | Description |
|---|---|---|---|
| `template`* | `PackTemplate` | — | `{ name, cost, count, guarantee, art }`. |
| `onOpen`* | `() => void` | — | Opens the confirm-cost dialog. |
| `tag` | `string` | — | Optional ribbon (Latest / Premium). |

- **Variants:** standard · premium · tagged — **States:** default · hover (lift) · focus-visible
- **A11y:** cost announced as "150 coins" in button name · ribbon decorative, not sole signal.

### RevealCard `composite`
A pack-opening card that flips in with a stagger; rare pulls get an animated glow burst.

| Prop | Type | Default | Description |
|---|---|---|---|
| `card`* | `Card` | — | The pulled card. |
| `index` | `number` | `0` | Drives flip-in stagger delay. |
| `highlight` | `boolean` | `false` | Rare-pull glow emphasis. |

- **Variants:** common · rare-pull (glow) — **States:** face-down · flipping · revealed
- **A11y:** skippable ("Skip animation" renders results instantly) · honors `prefers-reduced-motion` · result also listed as text.

### NotificationRow `composite`
A single notification — tinted event icon, rich text, timestamp, unread dot; deep-links to its subject.

| Prop | Type | Default | Description |
|---|---|---|---|
| `notification`* | `Notification` | — | `{ icon, text, time, unread, target }`. |
| `onClick` | `() => void` | — | Navigates to the related entity. |

- **Variants:** read · unread (accent bg + dot) — **States:** default · hover · unread
- **A11y:** unread state via text, not dot color alone · whole row is one activatable link.

---

## Navigation

### Sidebar / NavItem `composite`
The 236px persistent rail. Each NavItem is icon + label; active route uses primary tint. Admin group is role-gated.

| Prop | Type | Default | Description |
|---|---|---|---|
| `items`* | `NavItem[]` | — | Icon, label, route, optional badge. |
| `active`* | `string` | — | Current route id. |
| `role` | `"member" \| "admin"` | `"member"` | Gates the Admin section. |
| `badge` | `number` | — | Per-item count (e.g. pending trades). |

- **Variants:** member · admin (extra group) · active item — **States:** default · hover · active · focus-visible
- **A11y:** `<nav>` landmark with `aria-current="page"` on active · **role-gated links removed from DOM, not just hidden** · full keyboard traversal; badges labelled.

### Topbar `composite`
The 60px sticky, translucent header — global search left; currency pill, notification bell, primary CTA right.

| Prop | Type | Default | Description |
|---|---|---|---|
| `balance`* | `number` | — | Passed to the CurrencyPill. |
| `unread` | `number` | `0` | Bell badge count. |
| `onSearch` | `(q) => void` | — | Search callback. |

- **Variants:** default — **States:** default · scrolled (blur)
- **A11y:** `<header>` + `<search>` landmarks · bell has `aria-label` with unread count · sticky bar keeps a visible focus path.

### Tabs `primitive`
A segmented control (trades inbox: All / Incoming / Sent / Completed).

| Prop | Type | Default | Description |
|---|---|---|---|
| `tabs`* | `Tab[]` | — | Label + value list. |
| `active`* | `string` | — | Selected value. |
| `onChange`* | `(v) => void` | — | Selection handler. |

- **Variants:** 2–4 segments — **States:** default · active · hover · focus-visible
- **A11y:** `role="tablist"/"tab"` with `aria-selected` · Arrow keys move; Home/End jump.

### Breadcrumbs `primitive`
A trail showing hierarchy on detail screens (Collection › Set › Card).

| Prop | Type | Default | Description |
|---|---|---|---|
| `trail`* | `Crumb[]` | — | Ordered label + link list. |

- **Variants:** default — **States:** default · hover
- **A11y:** `nav[aria-label="Breadcrumb"]`; last crumb `aria-current` · separators decorative (`aria-hidden`).

---

## Overlays & feedback

### Dialog / Modal `composite`
A centered dialog on a blurred scrim — confirm cost, destructive actions, trade confirmation, grant currency. 440px max, 18px radius, deep drop shadow. Icon badge → title → body → action row.

| Prop | Type | Default | Description |
|---|---|---|---|
| `title`* | `string` | — | Heading. |
| `icon` | `LucideName` | — | Badge glyph reflecting intent. |
| `tone` | `"default" \| "danger" \| "success"` | `"default"` | Icon badge + confirm-button color. |
| `children` | `ReactNode` | — | Body content / form. |
| `onClose`* | `() => void` | — | Dismiss handler. |
| `actions` | `Action[]` | — | Footer buttons (cancel + confirm). |

- **Variants:** confirm · destructive · form · summary — **States:** open · closing · confirming
- **A11y:** `role="dialog"` `aria-modal`; focus trapped · focus returns to trigger on close · Escape + scrim click dismiss; labelled by title id.

### Toast `composite`
A transient, non-blocking confirmation (Sonner-style) for async outcomes.

| Prop | Type | Default | Description |
|---|---|---|---|
| `tone` | `"success" \| "error" \| "info"` | `"info"` | Accent + icon. |
| `message`* | `string` | — | Body text. |
| `duration` | `number` | `4000` | Auto-dismiss ms. |
| `action` | `Action` | — | Optional inline action. |

- **Variants:** success · error · info — **States:** enter · visible · exit
- **A11y:** `role="status"` (polite) / `"alert"` (error) · never the only feedback for critical outcomes · pauses on hover/focus.

### EmptyState `composite`
A first-run placeholder — soft icon badge, warm one-line prompt, single primary action. Never a dead end.

| Prop | Type | Default | Description |
|---|---|---|---|
| `icon`* | `LucideName` | — | Illustrative glyph. |
| `title`* | `string` | — | Short headline. |
| `body`* | `string` | — | One-line guidance. |
| `cta` | `{label,onClick}` | — | Primary next step. |

- **Variants:** collection · trades · decks · search (no results) — **States:** default
- **A11y:** icon decorative (`aria-hidden`); title carries meaning · CTA is a real focusable button, first in tab order.

### TradeStatusTimeline `composite`
A vertical stepper tracking a trade's lifecycle — proposed → notified → awaiting → settled.

| Prop | Type | Default | Description |
|---|---|---|---|
| `steps`* | `Step[]` | — | Label, time, done/active flags. |

- **Variants:** default — **States:** done · active · pending
- **A11y:** ordered-list semantics; current step `aria-current` · status stated in text, not dot color alone.

---

## TCG domain

### DeckSlot / CopyCountStepper `composite`
A decklist row with a −/count/+ stepper enforcing the 4-copy legality limit; a drop target in the builder.

| Prop | Type | Default | Description |
|---|---|---|---|
| `card`* | `Card` | — | The card in this slot. |
| `count`* | `number` | `1` | Copies in the deck (0–4). |
| `onChange`* | `(n) => void` | — | Increment/decrement handler. |
| `locked` | `boolean` | `false` | Card locked in a pending trade. |

- **Variants:** default · max (4) · locked — **States:** default · hover · dragging · drop-target · locked
- **A11y:** stepper buttons labelled "add/remove copy" · count is `aria-live`; +/- disabled at bounds · touch fallback: tap-to-add (no drag required).

### TradeOfferPanel `composite`
The give/get composer — two columns of CardTiles plus a coin input; used in propose and trade detail.

| Prop | Type | Default | Description |
|---|---|---|---|
| `offered`* | `Card[]` | `[]` | Cards you give. |
| `requested`* | `Card[]` | `[]` | Cards you request. |
| `coins` | `{give,get}` | `{0,0}` | Currency on each side. |
| `editable` | `boolean` | `true` | Compose vs read-only view. |

- **Variants:** editable (propose) · read-only (detail) — **States:** default · empty-slot · escrow-locked
- **A11y:** give/get sides are labelled regions · add-card slots are labelled buttons · escrow-locked cards announce locked status.

### DeckValidationBanner `composite`
The live legality panel — a checklist of format rules with pass/fail rows and detail counts.

| Prop | Type | Default | Description |
|---|---|---|---|
| `results`* | `Rule[]` | — | Each rule: `{ text, ok, detail }`. |

- **Variants:** all-pass · has-errors — **States:** valid · invalid
- **A11y:** pass/fail by icon + text, not color alone · `role="status"` announces newly failing rules.

### CurrencyInput `composite`
A coin amount field with the gold coin affix; used in trade composition and admin grants.

| Prop | Type | Default | Description |
|---|---|---|---|
| `value`* | `number` | `0` | Coin amount. |
| `onChange`* | `(n) => void` | — | Change handler. |
| `max` | `number` | — | Optional balance cap. |

- **Variants:** offer · request · admin-grant — **States:** default · focus · over-balance (error)
- **A11y:** labelled numeric spinbutton · over-balance error via `aria-invalid` + text.
