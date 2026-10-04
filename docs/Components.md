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

**Text contrast below the spec's 4.5 : 1** (measured on `--surface`): white on the primary fill **3.2**, red text on `--red-dim` (destructive button, Declined, Voided, Admin) **4.19**, violet on its tint (Countered, Ultra Rare) **4.48**. Every other variant passes, from 4.69 (Rare) to 14.6 (secondary). These are the design system's own token pairs, so they are left for PD-100's contrast pass, which decides between adjusting the tokens and accepting them.

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

