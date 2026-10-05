# M12 · Component Library

What the web app's components are, how they differ from [ComponentSpecs.md](ComponentSpecs.md), and how they were checked. ComponentSpecs is the contract; this is what exists and where it bends. It grows ticket by ticket through M12.

---

## The gallery

`/dev/components` renders every component in each variant and state. It is how M12 is checked: there are no automated tests in v1, so a component is accepted by looking at it, tabbing through it and measuring it in a browser.

It lives in its own route group, `app/(dev)/`, whose layout answers 404 in production unless the server was started with `COMPONENT_GALLERY=1`. The check runs per request (`connection()`), so a production build opts in at `next start`, with no rebuild. Its sections are in `app/(dev)/dev/components/_sections/`, one file per ticket.

## Merging classes (PD-92)

`cn` (shadcn's replacement for `clsx` + `tailwind-merge`) resolves conflicts from Tailwind's default theme. It did not know this project's names, and read them as colors: `cn('text-h3 text-on-pri')` kept only `text-on-pri`, `cn('rounded-control', 'rounded-pill')` kept both, and `cn('bg-card-face', 'bg-surface')` dropped the gradient. `lib/utils.ts` now builds `cn` with `createCn` from `cn/config`, extended with the type scale, radii, shadows and gradient utilities from `app/globals.css`. **Import `cn` from `@/lib/utils` only;** lint refuses `import { cn } from 'cn'`. A new named utility in `globals.css` that conflicts with a Tailwind group belongs in that extension too.

## Primitives (PD-92)

| Component | File | Notes |
| --- | --- | --- |
| Button | `components/ui/button.tsx` | `primary` `secondary` `ghost` `confirm` `destructive` `economy` × `sm` (32 px) `md` (40) `lg` (48); `icon`, `loading`, `asChild` |
| IconButton | `components/ui/icon-button.tsx` | 40 px, 44 px on a coarse pointer; `surface` `ghost`; `label` required; `badge` |
| Badge | `components/ui/badge.tsx` | `tone` `neutral` `primary` `success` `warning` `danger` `accent`; `rarity`; `pill` or `tag`; `dot` or `icon`; `onDismiss`; `RarityBadge` |
| Avatar | `components/ui/avatar.tsx` | Radix Avatar; image, initial on the brand gradient while it loads or when it fails; 28–88 px; `ring`; `decorative` |

`lib/design/status.ts` maps each trade status to its label and badge tone (Pending gold, Accepted green, Countered violet, Declined and Voided red, Cancelled neutral).

**Where they differ from the spec.**

- **The shadcn Button was replaced, not extended.** Its `default`/`outline`/`link` variants are gone; `outline` became `secondary`. A shadcn component added later that calls `buttonVariants({ variant: 'outline' })` has to be adapted.
- **`icon` is a Lucide component** (`icon={PackageOpen}`), not a name string, so an unused icon is never bundled.
- **A loading button stays focusable.** `loading` sets `aria-busy` and `aria-disabled` and swallows clicks and Enter, but does not set `disabled`: a submit that starts loading would otherwise throw keyboard focus to `<body>`. `disabled` is the native attribute, which already takes the button out of the tab order.
- **IconButton draws a count as a dot** unless `showCount` is set, because the topbar bell in the mockups is a dot; the count is in the accessible name either way (`Notifications, 3 unread`).
- **Avatar has no `gradient` prop.** A per-user gradient would have to be written as hex, which the lint rule refuses; every fallback uses the brand gradient, `--pri` to `--c-ultra`. The radius is 26 % of the side, which is what the mockups' 34 px / 9 px and 88 px / 20 px tiles have in common.
- **Badge `tone` names a color, not a family.** The spec's families (rarity, status, utility, role) are uses of these tones: rarity through `rarity`, status through `TRADE_STATUS_STYLES`, utility tags through `shape="tag"`, the admin role as `danger` with a border and a shield.

**The shell uses them.** The menu button and the notification bell are IconButtons, the account menu's trigger is an Avatar (so an uploaded avatar now shows there), and *Open packs* is a Button. The balance became the CurrencyPill in PD-93.

**Measured 2026-10-04** in the gallery under `next dev`:

- with real input events, a click started a loading button; a second click and two Enters during loading did nothing, and the button kept `aria-busy="true"`, `aria-disabled="true"` and focus. A first version also set `pointer-events: none` while busy, and the second click then fell through to the page and moved focus to `<body>`;
- IconButton names: `Notifications`, `Notifications, unread`, `Notifications, 3 unread`, `Notifications, 12 unread`; a badge of 0 draws nothing and adds nothing to the name;
- a failing avatar image (`avatar.invalid`) rendered the initial on the gradient at the same size; every avatar exposes `role="img"` with the person's name unless `decorative`;
- the focus ring on a focused button: 2 px of `--bg`, then 2 px of `--pri` — 6.0 : 1 against the canvas, 5.3 : 1 against `--surface`;
- after `next build`, `next start` answered `/dev/components` with 404, and with `COMPONENT_GALLERY=1` with 200; the not-found page's link rendered as a secondary Button.

In the shell, signed in as an admin against the live API: Tab from the top of `/admin/sync` stopped at *Skip to content*, the logo, the 16 sidebar links, search, the balance, the bell, *Open packs*, the account menu and the admin sub-nav, in PD-90's order; the bell, *Open packs* and the account trigger each showed the ring; Enter on the account trigger opened its menu on *My profile*. After an admin grant the bell read *Notifications, 1 unread* with its dot and the balance *500 coins*. The menu's Escape-returns-focus was not re-measured: the browser pane was not drawing, so Radix's close animation never ended. The trigger's behaviour comes from Radix and only its contents changed; PD-100's keyboard pass covers it.

**Text contrast below the spec's 4.5 : 1** (measured on `--surface`): white on the primary fill **3.2**, red text on `--red-dim` (destructive button, Declined, Voided, Admin) **4.19**, violet on its tint (Countered, Ultra Rare) **4.48**. Every other variant passes, from 4.69 (Rare) to 14.6 (secondary). These were the design system's own token pairs; PD-100 changed the tokens (see *Accessibility audit*).

## Loading and economy primitives (PD-93)

| Component | File | Notes |
| --- | --- | --- |
| Spinner | `components/ui/spinner.tsx` | `size` in px (34), ring 7.5 % of it; `role="status"` with `label`, hidden unless `showLabel` |
| Skeleton | `components/ui/skeleton.tsx` | `line` `block` `circle`; `width`/`height` as CSS lengths; `aria-hidden`, the loading container carries `aria-busy` |
| CurrencyPill | `components/ui/currency-pill.tsx` | `amount` (`null` while unknown), `sm`/`md`, `interactive` links to `/wallet`, `animate` |
| CompletionMeter | `components/ui/completion-meter.tsx` | `label`, `value`, `max`, `color` as a CSS color (`var(--e-fire)`), `height`, `showHeader` |

- **Skeletons do not size themselves.** The ticket asks that nothing shifts on load; that is the caller's job, by passing the measured size of the content. The gallery shows a card tile, a list row and an avatar built that way, after the mockups' loading states.
- **Large balances abbreviate** from 100 000 (`125K`, `1.3M`); the accessible name always carries the exact figure (`1,250,000 coins`). Below that the figure is grouped (`1,250`).
- **The balance counts, it does not jump.** When `amount` changes, the numeral counts from the old value to the new one over 600 ms and a `+500` or `−150` chip shows for 1.8 s. The count runs on `requestAnimationFrame`, which the global reduced-motion CSS rule cannot reach, so the hook checks `prefers-reduced-motion` itself and sets the new value at once. The numeral is `aria-hidden`, so a screen reader hears the final balance in the name and never the frames in between.
- **CompletionMeter speaks the count, not only the bar:** `aria-valuetext` is `42 of 64 cards, 66%`, and the visible header shows `42/64 · 66%`. The header is `aria-hidden`, because the progressbar already says it.
- **The shell's balance is a CurrencyPill**, `BalancePill` in `topbar-controls.tsx`, fed by `useMe()`.

**Measured 2026-10-04** in the gallery under `next dev`:

- granting 500 on a 1 250 balance showed `1,454` after 100 ms, `1,602` after 200, `1,715` after 350 and `1,750` from 700 ms; the `+500` chip was there throughout and gone at 2.6 s; the name read `Balance 1,750 coins. Open wallet` the whole time;
- with `matchMedia('(prefers-reduced-motion: reduce)')` answering true, spending 150 showed `1,600` 30 ms later;
- the four meters: `0 of 102 cards, 0%`, `42 of 64 cards, 66%`, `62 of 62 cards, 100%`, `30 of 83 cards, 36%`, each fill at that width;
- the three spinners announce `Loading`, `Loading` and `Opening pack…`; all seven skeleton parts are hidden from assistive tech;
- signed in, the topbar balance is 40 px high and reads `Balance 500 coins. Open wallet`.

## Inputs, forms, search and filters (PD-94)

The design, and the decisions taken with the user, are in `docs/superpowers/specs/2026-10-04-pd-94-inputs-and-forms-design.md`.

| Component | File | Notes |
| --- | --- | --- |
| Input | `components/ui/input.tsx` | `label`, `help`, `error`, `type`, `mono`, `hideLabel`; ids and `aria-describedby` built in; password reveal |
| Toggle | `components/ui/toggle.tsx` | Radix Switch with a clickable `label` and optional `description`; controlled |
| Form, FormField, FormToggle, FormError | `components/ui/form.tsx` | React Hook Form through context; `applyApiError` puts an `ApiError` on a field or on the form |
| SearchInput | `components/ui/search-input.tsx` | controlled, 300 ms debounce, Escape and a button clear it, `loading`, `resultCount` read out |
| FilterBar | `components/ui/filter-bar.tsx` | controlled; a menu per `FilterDef`, active filters as chips, *Clear all*, grid/list toggle |
| useUrlState | `lib/url-state.ts` | filter state in the URL, parsed by a shared Zod schema |
| useCatalogFacets | `lib/query/catalog.ts` | `GET /facets`, keyed `['catalog', 'facets']` |

### A form

```tsx
const form = useForm<SignIn>({ resolver: zodResolver(SignInSchema), mode: 'onTouched' });

<Form form={form} onSubmit={submit}>
  <FormField<SignIn> name="email" label="Email" type="email" autoComplete="email" />
  <FormField<SignIn> name="password" label="Password" type="password" />
  <FormError />
  <Button type="submit" loading={form.formState.isSubmitting}>Sign in</Button>
</Form>
```

- `mode: 'onTouched'`: an error shows when a field is left, then follows the typing. After a failed submit React Hook Form focuses the first invalid field.
- Give `FormField` the form's type (`FormField<SignIn>`) and `name` is checked against its fields; without it `name` is any string.
- **API errors.** In `onSubmit`, catch and call `applyApiError(form, error, { EMAIL_NOT_VERIFIED: 'email' })`: a mapped code lands on that field, anything else on the form, above the button, as `role="alert"`. The text is `apiErrorMessage()` from `lib/toast.ts`, the same sentence a toast would show. Give the mutation `meta: { toast: false }` so PD-91's toast does not say it twice.
- **Sign-up never says an address is taken.** Signing up with a registered email answers 200 with a decoy user while email verification is required; there is no "email already registered" state to design.
- The password reveal button keeps one name, *Show password*, and says its state with `aria-pressed`; changing the name too would announce the toggle twice.

**SearchInput emits the trimmed query** and stops at 100 characters (`maxLength`), the API's limit for `q`. The URL schema trims, so an untrimmed `dark ` came back as `dark`, looked like an outside change and overwrote the field: typing `dark `, pausing and typing `charizard` gave `darkcharizard`. A paste over 100 characters failed the schema and emptied the field.

**`apiErrorMessage` changed.** It used to turn every 401 into *Sign in to continue.* A wrong password is Better Auth's 401 (`INVALID_EMAIL_OR_PASSWORD`, kind `auth`), so the sign-in form would have told a person with a typo that their session expired. Only our own API's 401s (kind `api`, no session) are replaced now; Better Auth's keep their sentence.

### Filters in the URL

```tsx
const CatalogFilterSchema = CardSearchQuerySchema.pick({ q: true, set: true, rarity: true, type: true, supertype: true, sort: true });

const [query, setQuery] = useUrlState(CatalogFilterSchema); // module-level schema, so the value keeps its identity
setQuery({ rarity: 'Rare' });                               // push: Back undoes it
setQuery({ q: 'char' }, { history: 'replace' });           // search: no history entry per pause
```

- **Reading** parses each key with its own field schema; a bad value falls back to that field's default and the rest survive. A bad link widens the results; it never empties the page or throws.
- **Writing** merges the patch into the current params, drops `undefined`, `''` and values equal to the field's default (`sort=name_asc`), keeps keys the schema does not know (`?tab=`), and deletes `page` and `cursor` (`resets`), so a new filter starts on the first page.
- **Writes go through `window.history`, not the router.** Next keeps `useSearchParams` in step with `pushState`/`replaceState`, and the URL changes the moment `set` returns, so the next write builds on it. The first version used `router.push`/`replace` on the render's params, as the spec said; the final review showed that a write made before the previous navigation committed undid it: a filter picked while a search was in flight dropped the search, and a debounce firing after *Clear all* brought the filters back. A side effect: a filter change no longer costs a server round trip, and no Server Component re-renders on it. Pages that use `useUrlState` fetch their data in the browser.
- **History.** Choosing a filter, a sort or a tab pushes; search replaces.
- **Static pages.** `useSearchParams` on a statically prerendered page turns the tree up to the nearest `<Suspense>` into client-only rendering. Every `(app)` page is dynamic, so this only matters on a public static page: wrap the component that calls `useUrlState` in `<Suspense>` there.

`FilterBar` takes `FilterDef[]` (`key`, `label`, `icon`, `kind: 'select' | 'sort'`, `options`, `error`), the parsed `value` and `onChange`; pass `setQuery` straight in. `options: undefined` means loading and disables the menu; `error: true` disables it with *couldn't load options*. A `select` menu starts with *Any*. Facet counts are global over the mirror, not conditional on the other filters, and the same answer serves the catalog and the inventory.

**Measured 2026-10-04** in the gallery, under `next dev` against the live API, with real key events:

- typing `charizard` wrote the URL once with `replaceState` (0 `pushState`, history length unchanged) and sent one `/cards?q=charizard` request;
- typing `char`, pausing 340 ms and typing `izard`: `q=char` reached the URL and the API while the field already held more, and the field read `char` then `charizard`, never anything shorter;
- *Rarity: Rare*, then *Type: Water* (history 11 → 12), then Back: `?rarity=Rare`, the Type menu back to *Type*, one chip;
- Enter on *Remove Rare*: `rarity` left the URL, `/cards` was requested again, and focus landed on the Rarity menu button; *Clear all* on `?rarity=Rare&type=Water&sort=name_desc` left `?sort=name_desc`;
- `?sort=nonsense&rarity=Rare` showed *Rarity: Rare* and *Sort: Name A–Z* (2 583 cards); `?rarity=%00` showed no rarity filter and requested no rarity;
- choosing a sort on `?page=3&tab=sent` gave `?tab=sent&sort=name_desc`;
- Tab from the search: Set, Rarity, Type, Sort, Grid view, List view, each chip's remove button, *Clear all*; in the open Set menu, pressing `j u n g` moved focus to *Jungle 64* (177 options); Escape returned focus to *Set*;
- the demo form: submitting empty focused the email, set `aria-invalid="true"`, and its `aria-describedby` held *Enter an email address*; `unverified@pokedrop.test` put the API's sentence under the email; another address showed *Invalid email or password* above *Sign in*; no toast either time;
- with the API stopped, Set, Rarity and Type read *couldn't load options* and were disabled, Sort still read *Name A–Z*, and typing `mew` still wrote `?q=mew`.

After the review fixes, the same way:

- typing `dark `, pausing 700 ms (the URL read `?q=dark`, the field `dark `) and typing `charizard` gave `?q=dark+charizard` and the field `dark charizard`;
- on `?rarity=Rare&type=Water`, typing `mew` and activating *Clear all* at once: the URL was empty the moment the click returned, and 900 ms later read `?q=mew`, with no filter back;
- Enter on *Clear all* left focus on the *Set* menu button (before: `<body>`); a chip removed while its menu is disabled sends focus to the first enabled control in the bar;
- Back after *Clear all* restored `?rarity=Rare&type=Water`, both chips and 359 results.

**How the browser pane got in the way.** When the desktop app's window is not drawing, transitions and Radix's close animations never end: a closed menu stays mounted, its focus trap keeps focus, and the next key goes to it. Three first attempts above failed that way, not in the code; taking a screenshot before each key press keeps the pane drawing. The pane's `type` action inserts text without `keydown`, so it cannot exercise a menu's typeahead; key presses can.

## Tabs and breadcrumbs (PD-97)

| Component | File | Notes |
| --- | --- | --- |
| Tabs, TabsPanel | `components/ui/tabs.tsx` | Radix Tabs: `tablist`/`tab`/`tabpanel`, `aria-selected`, arrow keys, Home and End, roving focus; `tabs` (`value`, `label`, `count`), `value`, `onValueChange`, `label` names the list |
| useUrlTab | `components/ui/tabs.tsx` | `useUrlTab('tab', TRADE_TABS)`: the tab in `?tab=` through `useUrlState`; the first value is the default and stays out of the URL, an unknown value falls back to it |
| Breadcrumbs | `components/ui/breadcrumbs.tsx` | `trail` of `{ label, href? }`; `nav[aria-label="Breadcrumb"]`, an ordered list, the last crumb `aria-current="page"` and never a link, chevrons `aria-hidden` |

- **Switching a tab pushes**, like a filter, so Back returns to the previous tab, and it deletes `page` and `cursor`.
- **A tab's count is part of its name.** The label and the count are separate elements in a flex row, which would make the name `Sent2`; a space between them, invisible in the layout, makes it `Sent 2`.
- **On a narrow screen** (below `sm`) the middle crumbs become `sr-only` and an `aria-hidden` ellipsis stands in for them, so a screen reader still hears the whole trail. Earlier crumbs never shrink; the current one truncates, with its full text in `title`. The `nav` is `min-w-0 max-w-full`, so it shrinks inside a flex row instead of widening the page.

**Measured 2026-10-04** in the gallery under `next dev`:

- `?tab=sent` loaded with *Sent* selected and its panel shown; `?tab=bogus` loaded with *All*;
- from *Sent*, ArrowRight selected *Completed* (`?tab=completed`), Home selected *All* and removed `tab` from the URL, End selected *Completed* again; only the active tab is in the tab order (`tabIndex` 0, the rest −1) and inactive panels are hidden;
- tab names read `All 5`, `Sent 2`;
- at 375 px the page was 375 px wide; the three-level trail read *Collection › … › Charizard ex* with *Astral Eclipse* still in the accessibility tree, and the long trail kept *Collection* whole and truncated only the current crumb. The first attempt widened the page to 507 px: a `nav` in a flex row could not shrink below its text.


## Cards: CardTile and RevealCard (PD-95)

| Piece | File | Notes |
| --- | --- | --- |
| CardView | `components/cards/card-data.ts` | what card components take: `id`, `name`, `image`, `rarity`, `types`, `hp`, `priceUsd`; `cardView(card)` and `inventoryCardView(entry)` build it from the catalog and inventory shapes |
| CardFace, CardArt | `components/cards/card-art.tsx` | the design's abstract face (energy gradient, type glyph, name, HP, set and number) under the card's art through `next/image`; the face is the placeholder while the art loads and what stays when it fails |
| CardTile | `components/cards/card-tile.tsx` | 5 : 7 art, rarity text in its tier's color, USD price; `owned` (omitted, `0` = locked, `N` = ×N), `href` (default `/cards/:id`) or `onSelect` + `selected` (a toggle button); memoized |
| RevealCard | `components/cards/reveal-card.tsx` | a back and a face; `revealed` flips it over in 650 ms; `highlight` adds the tier-colored glow, pulsing for Ultra and Secret; `appear` + `index` flip it in 80 ms after the previous card |
| rarityTier | `lib/design/rarity.ts` | the provider's rarity strings folded into the five tiers |

**Rarity tiers.** The mirror holds 44 rarity strings (2026-10-04). `rarityTier()` folds them, first match wins: *Secret* for secret, hyper, rainbow, special illustration and shiny ultra; *Ultra* for ultra, double, illustration, ex, GX, V/VMAX/VSTAR, LV.X, BREAK, Prime, Prism Star, Star, LEGEND, Radiant, Amazing, ACE, Shining, Shiny, Trainer Gallery, Mega attack, Black White and Futuristic; *Uncommon*; *Common*; everything else (Rare, Rare Holo, Promo, Classic Collection, Pikachu Rare) *Rare*; no rarity reads *Common*. A tile shows the provider's own string (`Illustration Rare`) in the tier's color, so the text carries what the color does.

**Names, not colors.** A tile is a single link or button whose name is `Absol, Rare Holo, 3 owned, $18.89` or `Abra, Common, not owned, $1.51`; a locked tile is also greyscale with a lock. A reveal card's caption is `AZ's Tranquility, Special Illustration Rare`, or `Face-down card`; both faces are `aria-hidden`.

**Card art through the image optimizer.** A card's small image is a PNG of about 150 KB (`base1/43.png`: 240×330, 154 224 bytes); the optimizer sends it as WebP at 13 726 bytes. A grid that loads a few hundred tiles is a few megabytes instead of tens. `next.config.ts` allows the three hosts in `lib/images.ts` and keeps converted images for 30 days (`minimumCacheTTL`; the default is 4 hours, and art never changes at a URL). **Hosting:** the converted copies live in `.next/cache/images` on the web server's disk, so that directory must persist across restarts and have room; recorded for M14.

**The mirror has three image hosts.** `images.pokemontcg.io` (19 818 cards), `images.scrydex.com` (852, the newer sets pokemontcg.io now points elsewhere for), and `assets.tcgdex.net` (the fallback provider). The first version allowed two: `next/image` throws on an unconfigured host, and one Scrydex card took the whole gallery into the error boundary. `CardArt` now serves any host outside `CARD_IMAGE_HOSTS` unoptimized instead, so a fourth host costs bandwidth, not the page.

**Reduced motion** reaches the flip and the flip-in through the global rule: both run for 0.01 ms, so the card lands face up and the rarity is still in its chip, border and caption.

**Measured 2026-10-04:**

- in the gallery, the five tier samples read *Common*, *Uncommon*, *Rare Holo* (blue), *Illustration Rare* (violet, glowing border) and *Special Illustration Rare* (gold, glowing border); a tile whose art 404s shows the abstract face with its name, HP and set number at the same size; owned 0 is greyscale with a lock;
- *Flip* turned the large card from `Face-down card` to `AZ's Tranquility, Special Illustration Rare`, `rotateY(180deg)`, with the pulsing glow behind it;
- in headless Chrome against `next build && next start`, 1280×900: the 500-tile grid was in the DOM 251 ms after the click; scrolling it end to end at 40 px a frame took 555 frames in 4.6 s, frame time median 7 ms, p95 14 ms, one frame over 33 ms (132 ms, at the start), no long tasks; 293 of 497 images had loaded by the end, 3.7 MB in all (12.7 KB each); three cards have no image and kept their face;
- with `--force-prefers-reduced-motion`, the flip transition and the flip-in both computed to 0.00001 s.

## Data display (PD-96)

| Component | File | Notes |
| --- | --- | --- |
| StatCard | `components/ui/stat-card.tsx` | `label`, `value` (already formatted), `icon` + `tone`, `trend` + `trendTone` (`up` `down` `flat`), `compact`, `loading` (skeletons, `aria-busy`); a `section` labelled by its label |
| DataTable | `components/ui/data-table.tsx` | TanStack Table in a CSS grid with `table`/`row`/`columnheader`/`cell` roles; column `meta.width` (grid track) and `meta.numeric` (mono, right); sortable headers are buttons, the header cell carries `aria-sort`; `onRowClick` makes rows focusable and Enter/Space activate them; `loading` draws skeleton rows, `empty` fills a zero-row table |
| PackTemplateCard | `components/packs/pack-template-card.tsx` | energy-colored art, name, card count, guarantee, the cost button; `balance` below the cost disables it and says how many coins are missing |
| NotificationRow | `components/notifications/notification-row.tsx` | one link per notification: a sentence per kind (the seven trade kinds, coins granted or taken, anything else), the counterparty in bold, relative time with the full date in `title`; `notificationHref()` leads to the trade or the wallet |

- **Sorting.** Without `onSortingChange` the table sorts its own rows. Pass `sorting` and `onSortingChange` and it only reports: a server-paginated list (every admin table) sorts on the server, and a client sort would order only the page on screen. TanStack sorts a number column descending first.
- **`useReactTable` and the React Compiler.** Lint warns (`react-hooks/incompatible-library`) because the table instance's functions cannot be memoized; the warning is disabled on that line, and the compiler skips the component.
- **A table too narrow for its columns scrolls sideways** inside its own border (since PD-119): the rowgroups are `min-w-fit` and the table `overflow-x-auto`, so the minimum widths in `meta.width` hold and the page never widens.
- **Trend direction is text**, not only an arrow and a color: a visually hidden *Up:*, *Down:* or *No change:* precedes the trend.
- **Unread is text**, not only the dot and the tint: an unread row starts with a visually hidden *Unread:*.
- **Coins spoken in full.** The pack button reads `250K · Open` but is named `Open Premium Collection for 250,000 coins`, and a shortfall reads `You need 249,880 more coins`; an abbreviation is for the eye.
- **`formatCoins` moved to `lib/format.ts`**, beside `timeAgo` and `dateTime`. It lived in the CurrencyPill's module, which is `'use client'`, and a Server Component importing a function from there gets a client reference, not the function.
- **Relative times depend on the clock.** `NotificationRow` takes `now` for demos; rendered on the server and again in the browser a minute apart, `12 minutes ago` could disagree, so lists of notifications render in the browser (they are TanStack queries).

**Measured 2026-10-04** in the gallery under `next dev`:

- the table with 4 rows reported `aria-rowcount="5"` (with the header); with 1 row, one row; with 0, the single cell *No members match these filters.*; loading, `aria-busy="true"` and 5 hidden skeleton rows;
- Enter on the *Coins* header: `aria-sort="descending"`, `10,000, 1,250, 830, 40`; Enter again: `ascending`, `40, 830, 1,250, 10,000`; *Status* (not sortable) has no `aria-sort`; Enter on the focused second row reported *Opened Ash*;
- with 120 coins: *Base Set Booster* (100) enabled; *Astral Eclipse* (150) disabled, described by *You need 30 more coins.*; *Premium Collection* named *Open Premium Collection for 250,000 coins*;
- the ten notification rows read, for example, *Unread: MistyW proposed a trade 12 minutes ago*, *An admin voided your trade with MistyW 3 days ago*, *−200 coins were taken from your balance by an admin last month*, *You have a new notification last year*. A first version ran the sentence and the time together (*trade12 minutes ago*); a space between them, invisible in the column layout, separates them.

## Overlays and feedback (PD-98)

| Component | File | Notes |
| --- | --- | --- |
| Dialog | `components/ui/dialog.tsx` | Radix Dialog: focus trap, Escape and the scrim dismiss, scroll lock; `title`, `description`, `icon`, `tone` (`default` `danger` `success`, which also picks the confirm button), `trigger`, `children`, `onConfirm` + `confirmLabel`/`cancelLabel`, `confirming` |
| Toast helpers | `lib/toast.ts` | `toastSuccess(message, action?)`, `toastInfo(message, action?)` beside PD-91's `toastApiError`; Sonner, restyled in PD-91 |
| EmptyState | `components/ui/empty-state.tsx` | badge, title, one line, one call to action (`href` or `onClick`); `tone` `primary` `economy` `accent` `neutral` |
| TradeStatusTimeline | `components/trades/trade-status-timeline.tsx` | an ordered list of `{ label, time, state, icon }`; `tradeTimelineSteps(detail)` builds it from `TradeDetail.timeline`, adding *Awaiting … response* and *Cards swap and the trade settles* while the trade is pending |

- **Focus goes back where it came from.** Radix returns focus only to its own `Trigger`. A dialog opened from code (a row action, a confirm after a check) would drop focus to `<body>`, so `Dialog` remembers what had focus when it opened and returns there.
- **`confirming` holds the dialog open**: Escape and the scrim do nothing, *Cancel* is disabled, and the confirm button is busy.
- **`aria-modal="true"` is set explicitly.** Radix hides the rest of the page with `aria-hidden`, except elements that contain a live region, so they keep announcing; in the gallery that left `<main>` and Sonner's region exposed. `aria-modal` is what tells a screen reader to stay inside the dialog.
- **Toasts are polite, errors included.** Sonner announces every toast through one `aria-live="polite"` region and gives no toast `role="alert"`, which the spec asks for errors. Every critical outcome is also shown in place (a form's `role="alert"`, a page's error state), which the spec requires anyway; PD-100 kept it that way.
- **Every list gets an EmptyState** — but the lists are M13's pages; the four in the gallery (collection, trades, decks, search) are the patterns they use. A list's empty state is part of its page ticket.
- **The timeline says its states in words**: each step starts with a hidden *Done:*, *Current step:* or *Not yet:*, and the current one has `aria-current="step"`. Steps name people from the viewer's side: *Accepted and settled by you*.

**Measured 2026-10-04** in headless Chrome against `next dev`, with real key events (the desktop pane was not drawing):

- Enter on *Open Astral Eclipse*: a dialog labelled *Open Astral Eclipse pack?*, described by its body, focus on *Cancel*, `body` overflow hidden; Tab ×4 went *Open pack · 150*, *Cancel*, *Open pack · 150*, *Cancel*, never outside; Escape closed it and focus was on *Open Astral Eclipse*;
- while the confirm was in flight, Escape left the dialog open with *Cancel* disabled and the confirm busy; when it finished the dialog closed, focus was back on the trigger, and a success toast with a *View* action appeared;
- *Delete deck*, opened from code: Escape returned focus to *Delete deck*;
- toasts: success (with *Undo*), info and an API error with *Request ID bc212513-demo*, all in Sonner's polite region;
- each empty state's first focusable element is its call to action (three links, one button);
- the pending timeline reads *Done: Proposed by MistyW … / Current step: Awaiting your response / Not yet: Cards swap and the trade settles*; the voided one ends *Done: Voided by an admin*.

## TCG domain (PD-99)

| Component | File | Notes |
| --- | --- | --- |
| CopyCountStepper | `components/decks/copy-count-stepper.tsx` | − count +; `max` from `copiesAllowed()`; at the limit *+* stays focusable (`aria-disabled`) and pressing it says why (`role="alert"`); the count is read out as *3 copies of Charizard* |
| DeckSlot | `components/decks/deck-slot.tsx` | a decklist row: art, name, set number, rarity, stepper; `locked` (promised in a pending trade), `dragging`, `dropTarget`; `readOnly` (*×3* instead of a stepper, for the public deck); `ref` and `handle` (the art and name become dnd-kit's drag handle); `focusDeckSlot(cardId)` scrolls to a row, focuses it and flashes it for 1.6 s |
| copiesAllowed | `components/decks/deck-rules.ts` | 4 minus the copies of every other printing of the name; Infinity for basic energy. Since PD-112 also `slotMax()` (that, capped at the request bound of 100), `addRefusal()` (why one more copy cannot go in: the copy limit, 100 distinct cards, 100 copies) and `saveBlocker()` (what disables *Save*) |
| DeckValidationBanner | `components/decks/deck-validation-banner.tsx` | a `DeckValidation` (the API's) as a checklist: each rule with an icon and a spoken *Passes*/*Fails*; each issue's message with a *Show {card} ({set number})* button per card; the summary badge is `role="status"` |
| TradeOfferPanel | `components/trades/trade-offer-panel.tsx` | two regions labelled by whose side they are (*You give*, *MistyW gives*), cards with counts and *Locked in escrow*, an add-card slot and coins when `editable`, a line of card count, market value and coins per side. Since PD-115: `onCountChange` turns each line's count into a stepper (*One fewer* / *One more* Charizard) capped by the line's `max`, and a line's `problem` shows under it in red |
| CounterpartyPicker | `components/trades/composer/counterparty-picker.tsx` | *Trade with*: a `combobox` over `GET /users?q=` (two characters, a 300 ms pause) with a `listbox` of avatars and names, arrows, Enter and Escape; the choice is a chip with *Change*, fixed when `locked` (a counter-offer) |
| CardPickerDialog | `components/trades/composer/card-picker-dialog.tsx` | a dialog with a search field and a virtualized grid inside its own scroll area: the caller's cards (badges *×4 · 1 locked*) for the give side, the counterparty's showcase and then the catalog for the other; a tile refused by `pickRefusal` is grey, `aria-disabled`, and says why; picking keeps the dialog open, *Done* closes it |
| CurrencyInput | `components/ui/currency-input.tsx` | a coin `spinbutton` with the gold affix; never emits above `max` and says so; `min` below 0 for admin grants; ArrowUp/Down step 10 (100 with Shift); grouped (`1,250`) when not focused |

**One copy rule for the API and the builder.** The validator counts the limit by name across printings (*Charizard* from Base Set and from Base Set 2 share four) and exempts basic energy. That rule moved to `@pokedrop/shared` as `baseCardName()` and `copyLimitKey()`; `the validator (in `@pokedrop/shared` since PD-112) and `copiesAllowed()` both use it, so the stepper cannot allow what the server refuses. Measured after the move against the live API: a deck of 3 *Charizard* (base1-4), 2 (base4-4) and 10 *Fire Energy* answered `COPY_LIMIT_EXCEEDED` for `["base1-4", "base4-4"]`, *Charizard has 5 copies; at most 4 are allowed*, and nothing for the energy.

- **The page validates, not the banner.** The banner draws a `DeckValidation`: in the builder the shared validator's verdict on the draft, after a save the server's; the gallery fakes the size and copy rules locally because it has no deck.
- **Drag is the builder's** (PD-112): DeckSlot draws `dragging` and takes a `handle`; the dnd-kit context, the drop zones and *+ Add* as the touch fallback live in `components/decks/builder/` — see *Deck builder (PD-112, PD-113)* in [Pages.md](Pages.md).

**Measured 2026-10-04** in headless Chrome against `next dev`, with real key events:

- the demo deck (3 + 2 *Charizard*, 10 *Fire Energy*, 2 locked *Mewtwo*) showed *2 rules failing*, *17 of 60 cards*, and *Charizard has 5 copies…* with *Show Charizard (BASE1 4)* and *Show Charizard (BASE4 4)*;
- removing a base4-4 copy left 3 + 1 and *1 rule failing*; Enter on *Add a copy of Charizard* (base1-4) kept *3 copies of Charizard*, the button `aria-disabled="true"` and focused, and its description *4-copy limit, counting other printings* as `role="alert"`;
- three Enters on *Add a copy of Fire Energy* went from 10 to 13; the locked *Mewtwo* has both stepper buttons disabled and says *Locked in a pending trade*;
- Enter on *Show Charizard (BASE4 4)* focused `deck-slot-base4-4`, in view, highlighted; the highlight was gone 1.8 s later;
- typing `5000` into *Coins you give* with a 1,250 balance showed `1250`, `aria-valuenow` 1250, `aria-invalid`, and *You have 1,250 coins; that is the most you can offer.*; ArrowUp stayed at 1250; on leaving the field it read `1,250`;
- typing `-300` into the admin grant gave `aria-valuenow` −300, *-300 coins*;
- the read-only panel's sides are *MistyW gives — 1 card · market value $180.00 · 120 coins* (with *Locked in escrow*) and *You give — 2 cards · market value $48.00*.

## Collection view (PD-107)

What the inventory, the catalog (PD-108) and the deck builder's pool (PD-112) show cards through. It knows nothing about the inventory: it takes items and draws them with the caller's tile.

| Piece | File | Notes |
| --- | --- | --- |
| VirtualCardGrid | `components/collection/virtual-card-grid.tsx` | `items`, `getKey`, `renderTile`, `label`, `minTileWidth` (150), `hasMore`, `loadingMore`, `onLoadMore`; virtualizes **rows** against the window (`useWindowVirtualizer`), or inside `scrollElement` when given one (`useVirtualizer`, the deck builder's pool column); the column count from the container's width; asks for more when the last rendered row is within three of the end; a `list` of `listitem`s |
| useDocumentTop, useElementWidth | `components/collection/layout-metrics.ts` | an element's offset from the document's top and its width, kept current by a `ResizeObserver` on the body — the virtualizers' `scrollMargin` and the grid's columns |
| DataTable `virtualize` | `components/ui/data-table.tsx` | `{ estimateRowHeight, totalRows?, onEndReached? }`: only the rows in view render, between spacers; `aria-rowcount` is `totalRows` + 1 and each row carries `aria-rowindex`; `onEndReached` fires within ten rows of the end. Without it the table renders every row, as before |
| CardTile `locked` | `components/cards/card-tile.tsx` | of `owned`, how many are promised to pending trades: the badge reads *×3 · 1 locked*; all of them locked greys the tile and adds the lock, named *3 owned, all locked in pending trades*. `owned={0}` still means *not owned* |
| SearchInput `onInput` | `components/ui/search-input.tsx` | every text the field holds, before the debounce — typed, cleared, or adopted from the URL on Back |
| matchesName, narrowToTyped | `lib/name-match.ts` | the server's `q` rule — a substring, ASCII case folded, `%` `_` `\` literal — and what may be shown while the field runs ahead of the answer; see [Pages.md](Pages.md), *Inventory* |

- **The window scrolls, so the virtualizers are window virtualizers.** Each needs its list's distance from the top of the document (`scrollMargin`), which moves as content above it loads; `useDocumentTop` follows it.
- **No React Compiler opt-out is needed today**: the compiler is not enabled. If it ever is, the virtualized components must opt out (`'use no memo'`), because TanStack Virtual's instance changes without changing identity.
- The gallery's DataTable and CardTile specimens were re-checked after these changes: the members table still reads `aria-rowcount` 5 with 4 rows, and the tiles still read *Abra, Common, 3 owned, $1.51* and *…, not owned, …*.

## Accessibility audit (PD-100)

The whole library was swept in the gallery, in headless Chrome against `next dev`, with axe-core 4.10 loaded from cdnjs into the page and real key events over the DevTools protocol. Nothing was added to the repository to do it: v1 has no test suite, so the audit is a measurement, recorded here, not a check that runs again by itself.

**axe** (WCAG 2.0/2.1 A and AA plus best practice), before → after:

| Page | Critical | Serious | Moderate |
| --- | --- | --- | --- |
| `/dev/components` | 0 → 0 | 95 contrast → 2 | 3 → 3 |
| `/dashboard`, signed in | 0 → 0 | 1 contrast → 0 | 0 → 0 |

The two serious nodes left are a DeckSlot's `dragging` state, drawn at half opacity on purpose: it is the place the card left, and during a drag PD-112 draws the card itself under the pointer. The three moderate ones (`landmark-unique`) are the gallery showing three breadcrumb trails and two offer panels on one page; an application page has one of each.

**The palette changed**, chosen with the user from measured options, and `docs/DesignSystem.md` carries the new values:

| Token | Before | After | Why |
| --- | --- | --- | --- |
| `--faint` | `#636876` | `#858a96` | 59 captions and hints at 3.24 : 1 on `--surface`; now 5.38 (5.85 on `--bg`, 4.96 on `--surface2`), still dimmer than `--mut` |
| `--pri-strong` (new) | — | `#3f74d2`, hover `#3a6cc4` | the primary button's fill: white on `--pri` is 3.2 : 1, on `--pri-strong` 4.53 (hover 5.09). `--pri` stays the accent for links, focus rings and tints |
| `--red` | `#ef4444` | `#f05151` | red text on `--red-dim` was 4.19 : 1; now 4.51 |
| `--red-strong` (new) | — | `#d73d3d` | red fills that carry text (the count badge, a negative balance delta): white at 4.54 : 1 instead of 3.76 |
| `--c-ultra` | `#b06bf0` | `#b06cf0` | Ultra Rare text on its tint was 4.47 : 1; now 4.50; the tint, border, edge and glow follow |

**Keyboard.** Tab from the top of the gallery made 123 stops, the same number of focusable elements the page holds, 121 of them the library's (28 primitives, 20 inputs and forms, 7 navigation, 12 cards, 22 data display, 9 overlays, 23 domain) and two Next and TanStack developer buttons. Every one of the library's stops showed the focus ring; none was invisible or off-screen. The menus, dialog, tabs, stepper and form were walked key by key in their tickets.

**Color is never the only signal**: rarity is printed in words on every tile, chip and reveal; energy has its glyph; legality, trade status, unread notifications and timeline steps say their state in text.

**Reduced motion.** With `--force-prefers-reduced-motion`: no element in the gallery had an animation or transition longer than 1 ms, at rest or with the dialog open; no animation was running; the reveal flip computed to 0.00001 s; granting 500 coins showed only `1,750`, no frames between; and following a validation error put the deck slot in view within 40 ms. Without it: 161 transitions, the balance counted up through `1,308`, `1,369`, `1,424`…, and the scroll took its time.

**One thing the audit found and fixed in code**: `focusDeckSlot()` scrolled with `behavior: 'smooth'`, and an explicit smooth scroll in script is not reached by the CSS reduced-motion rule. It now asks `prefers-reduced-motion` and scrolls instantly when asked to.

**Decided, not changed**: toasts stay polite (Sonner has no per-toast `role="alert"`); every critical outcome also shows in place. The ticket asked for axe checks in component tests; with no tests in v1 they ran in the browser instead.

