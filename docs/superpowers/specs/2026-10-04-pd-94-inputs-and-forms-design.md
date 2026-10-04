# PD-94 — Inputs, forms, search and filters

Design, 2026-10-04. Milestone M12 · Component Library.

Ticket: [PD-94](https://linear.app/mstrilec/issue/PD-94/inputs-and-forms-inputformfield-toggle-searchinput-filterbar).
It also settles the URL-state mechanism that PD-97's Tabs reuse, so PD-97 builds on this rather than inventing its own.
Builds on PD-92 and PD-93 (`docs/Components.md`) and PD-86/PD-87 (`docs/Frontend.md`).
Reference: `docs/ComponentSpecs.md` §Inputs & forms · `docs/Architecture.md` §5 (React Hook Form + Zod) ·
`design/Pokemon TCG App.dc.html` (inventory filter bar).

---

## What the ticket asks

| Scope item | Where it lands |
| --- | --- |
| Input / FormField: label, help text, error state, wired to React Hook Form + Zod resolver | [Forms](#forms) |
| Toggle (Switch): controlled, keyboard-operable, correct ARIA | [Toggle](#toggle) |
| SearchInput: debounced, clearable, loading indicator | [SearchInput](#searchinput) |
| FilterBar / FilterChip: active filters as removable chips, clear-all, fed by the facets endpoint | [FilterBar](#filterbar), [Facets](#facets) |

| Acceptance criterion | How it is met |
| --- | --- |
| A Zod validation error renders on the correct field with an `aria-describedby` link | `Input` owns the ids and the link; `FormField` only feeds it the RHF error; [Verification](#verification) 7 |
| Every control is reachable and operable by keyboard alone | Native inputs, Radix Switch and DropdownMenu; [Verification](#verification) 6 |
| Search debounce prevents a request per keystroke | `SearchInput` calls `onSearch` 300 ms after the last keystroke, and the URL write is a `replace`; [Verification](#verification) 1 |
| Removing a chip updates both the URL query and the results | The chip calls the page's `useUrlState` setter; the query key is built from the parsed URL; [Verification](#verification) 3 |

## Decisions

Taken with the user during brainstorming:

1. **FilterBar is controlled and knows nothing about the URL.** The page owns filter state through a shared hook,
   `useUrlState(schema)`, which reads and writes search params through the same shared Zod schema the API validates
   with. The same FilterBar then works with local state where filters do not belong in the URL (the deck builder's card
   pool, a dialog), and PD-97's Tabs reuse the hook.
2. **Forms have two layers.** A presentational `Input` that works without React Hook Form, and a `FormField name=…` on
   top that takes its value and error from the form context. The ARIA wiring lives in `Input` once, so no form can get
   it wrong.
3. **History: search replaces, everything discrete pushes.** Typing in search writes with `replace`; choosing a filter or
   sort, removing a chip, clearing all and switching a tab write with `push`, so Back undoes the last choice.

Taken in the design, unopposed:

4. **Fuse.js is not part of this ticket.** `SearchInput` reports a debounced string; instant client-side filtering of an
   already-fetched page is the inventory page's job (PD-107).
5. **The filter schema is a `pick` of the shared query schema**, not a new one: `CardSearchQuerySchema.pick({ q, set,
   rarity, type, supertype, sort })` for the catalog, `InventoryQuerySchema.pick({ q, set, rarity, type, minQuantity,
   sort })` for the inventory.

## Files

| File | Role | Depends on |
| --- | --- | --- |
| `components/ui/input.tsx` | `Input`: label, help, error, ids, `aria-*`, `mono`, password reveal | — |
| `components/ui/form.tsx` | `Form`, `FormField`, `FormToggle`, `applyApiError` | `react-hook-form`, `Input`, `Toggle` |
| `components/ui/toggle.tsx` | `Toggle`: Radix Switch with a clickable label | `radix-ui` |
| `components/ui/search-input.tsx` | `SearchInput`: debounce, clear, Escape, spinner, live result count | `Spinner`, `IconButton` |
| `components/ui/filter-bar.tsx` | `FilterBar`: filter menus, active chips, clear-all, grid/list toggle | `Badge`, `Button`, `IconButton`, Radix DropdownMenu |
| `lib/url-state.ts` | `useUrlState(schema, options)` | `next/navigation` |
| `lib/api/endpoints/catalog.ts` | `facets()` | API client |
| `lib/query/catalog.ts` | `useCatalogFacets()` | TanStack Query |
| `lib/query/keys.ts` | `keys.catalog.facets` under the `catalog` root, inheriting its 30-minute stale time | — |
| `app/(dev)/dev/components/_sections/inputs.tsx` | gallery: every state, a demo form, a live catalog filter bar | all of the above |

New dependencies, in `apps/web`: `react-hook-form` 7.x and `@hookform/resolvers` 5.x (whose peer range covers Zod 4).
No Fuse.js.

How an M13 page puts it together:

```tsx
const CatalogFilterSchema = CardSearchQuerySchema.pick({ q: true, set: true, rarity: true, type: true, supertype: true, sort: true });

const [query, setQuery] = useUrlState(CatalogFilterSchema);
const { data: facets, isError } = useCatalogFacets();
const cards = useQuery({ queryKey: keys.catalog.search(query), queryFn: … });

<FilterBar
  search={<SearchInput value={query.q ?? ''} onSearch={(q) => setQuery({ q: q || undefined }, { history: 'replace' })} resultCount={cards.data?.total} loading={cards.isFetching} />}
  filters={catalogFilters(facets, isError)}
  value={query}
  onChange={setQuery}
  view={view}
  onViewChange={setView}
/>
```

## URL state

```ts
function useUrlState<S extends z.ZodObject>(
  schema: S,
  options?: { resets?: string[] }, // default ['page', 'cursor']
): [z.output<S>, (patch: Partial<z.input<S>>, how?: { history?: 'push' | 'replace' }) => void];
```

**Reading.** Each key of the schema is parsed on its own (`schema.shape[key].safeParse(param)`). A value that fails — a
NUL in `rarity`, `sort=nonsense` — falls back to that field's default, and the other fields keep their values: a bad link
shows a slightly wider catalog, never an empty page or a 400. Only the schema's keys are read. The result is memoised on
the search string, so its identity is stable and a query key built from it does not refetch on every render.

**Writing.** The current params are merged with the patch. A key set to `undefined`, or to its field's default
(`sort=name_asc`), is removed, so links stay short and one state has one URL. Keys the schema does not know are kept
(`?tab=` survives a filter change). The keys in `resets` are deleted on every write, so a new filter always starts at the
first page. Navigation is `router.push` or `router.replace` with `pathname + '?' + params` and `{ scroll: false }`.

**History.** `push` by default; search passes `{ history: 'replace' }`.

**Prerendering.** On a statically prerendered page, `useSearchParams` turns the client tree up to the nearest
`<Suspense>` into client-only rendering. Every `(app)` page renders dynamically, because its layout reads the session,
so this does not arise there. A public static page that uses `useUrlState` wraps that component in `<Suspense>`; this
goes in `docs/Components.md` as a rule.

## Forms

### Input

Props: `label` (required), `help`, `error`, `type` (`text` `email` `password` `number`), `mono`, `disabled`, and every
other `<input>` attribute; `ref` is forwarded, so React Hook Form can focus the field.

- The input's id comes from `useId()` unless `id` is passed. Help and error each get an id; `aria-describedby` lists the
  ones that are rendered, and `aria-invalid` is set while there is an error.
- An error is never color alone: the border turns `--red`, a `CircleAlert` icon and the message sit under the field.
- `type="password"` adds a reveal button, `Show password` / `Hide password`, with `aria-pressed`.
- `mono` sets Geist Mono for numeric fields.
- Look, from the mockups: `--bg` fill, `--bd2` border, 10 px radius, 40 px high, the project's `focus-ring`; the label
  above in `text-small`, help and error below in `text-small`.

### Form and FormField

```tsx
const form = useForm({ resolver: zodResolver(Schema), mode: 'onTouched' });
<Form form={form} onSubmit={submit}>
  <FormField name="email" label="Email" type="email" autoComplete="email" />
  <Button type="submit" loading={form.formState.isSubmitting}>Create account</Button>
</Form>
```

- `Form` renders `<form noValidate>` inside a `FormProvider`, so the browser's own validation bubbles never compete with
  ours, and calls `form.handleSubmit(onSubmit)`.
- `FormField` spreads `register(name)` onto an `Input` and passes `formState.errors[name]?.message` as `error`. Its
  `name` is typed by the form's field values.
- `mode: 'onTouched'` is the recommendation for every form: an error appears when the field is left, not on the first
  keystroke, and then updates as the user types. React Hook Form's `shouldFocusError` (on by default) moves focus to the
  first invalid field after a failed submit.
- A form-level message (`errors.root`) renders above the submit button as `role="alert"`.

### API errors on fields

```ts
applyApiError(form, error, { EMAIL_NOT_VERIFIED: 'email' });
```

maps an `ApiError` code to a field and calls `form.setError(field, { message: error.message })`, so the API's sentence
renders exactly where a Zod error would. A code the map does not name goes to `root`, which is where most API errors
belong: the error envelope names no field, and Better Auth's `INVALID_EMAIL_OR_PASSWORD` is about the pair, not either
half. The mutation sets `meta: { toast: false }` when the form shows its error in place, so PD-91's failed-mutation toast
does not repeat it.

**Sign-up never says an address is taken.** Measured 2026-10-04: signing up again with a registered email answers 200
with a decoy user, because Better Auth hides which addresses exist while email verification is required. No form can
show "email already registered", and PD-102 must not design one.

### Toggle

Radix Switch: `role="switch"`, `aria-checked`, Space toggles; `checked` and `onCheckedChange` (controlled); `label`
renders as a `<label>` tied to it, so clicking the text toggles too; `disabled`. On and off differ by the knob's position
and the track's fill, not by color alone. `FormToggle name=…` binds it to the form with RHF's `Controller`.

Nothing in the app uses a form yet; PD-102's auth pages are the first. This ticket proves the layer on a demo sign-in
form in the gallery — a `z.email()`, a password with a minimum length and a *Remember me* `FormToggle` — whose fake
submit answers one address with `EMAIL_NOT_VERIFIED` (mapped to the email field) and any other with
`INVALID_EMAIL_OR_PASSWORD` (form-level), the two codes the real sign-in returns.

## SearchInput

Props: `value`, `onSearch(q)`, `placeholder` (`Search…`), `debounceMs` (300), `loading`, `resultCount`, `variant`
(`inline` `topbar`), `label` (accessible name, `Search cards`).

- It keeps the typed text in local state and calls `onSearch` 300 ms after the last keystroke. When `value` changes from
  outside — Back restores an older `q` — the field takes it.
- `type="search"`, so the role is searchbox. Escape and the clear button empty it at once, without waiting for the
  debounce. The clear button shows only with text.
- `loading` swaps the magnifier for a 16 px `Spinner`.
- `resultCount`, when given, is read out by a visually hidden `aria-live="polite"` region: `24 results`, `1 result`,
  `No results`.

## FilterBar

```ts
type FilterOption = { value: string; label: string; count?: number };
type FilterDef = {
  key: string;
  label: string;
  icon: LucideIcon;
  kind: 'select' | 'sort';
  options?: FilterOption[]; // undefined while loading
  error?: boolean;
};

type FilterBarProps = {
  filters: FilterDef[];
  value: Record<string, unknown>;
  onChange: (patch: Record<string, string | undefined>) => void;
  search?: ReactNode;
  view?: 'grid' | 'list';
  onViewChange?: (view: 'grid' | 'list') => void;
};
```

- **Menus.** Each filter is a button that opens a Radix DropdownMenu (`aria-haspopup`, arrow keys, typeahead, Escape)
  holding a radio group. A `select` filter starts with an *Any* item that clears it; a `sort` has no *Any*. The button
  shows the choice — `Rarity: Rare` — and option counts render in mono. A long list (150+ sets) scrolls inside the menu,
  and typing a name jumps to it.
- **Loading and failure.** While `options` is `undefined` the button is disabled and reads `Loading…`; with `error` it is
  disabled and reads `Couldn't load options`. Search and sort keep working.
- **Chips.** Under the bar, each active `select` filter is a `Badge` with `onDismiss` (`Remove Rare`), followed by a
  *Clear all* ghost button when more than one is active. Sort is not a chip. A visually hidden `aria-live` region states
  the active count: `2 filters active`.
- **View.** Two `IconButton`s, *Grid view* and *List view*, with `aria-pressed`, rendered only when `onViewChange` is
  given. The view is not a filter and is not written to the URL by FilterBar.
- **Layout**, after the inventory mockup: one surface panel, search first and flexible, then the menus, then the view
  toggle; it wraps to more rows on narrow screens.

## Facets

`facets()` in `lib/api/endpoints/catalog.ts` calls `GET /facets` (the catalog controller has no prefix) and parses `CatalogFacetsSchema`.
`useCatalogFacets()` keys it `keys.catalog.facets` (`['catalog', 'facets']`), which inherits the catalog root's
30-minute stale time; the API caches the answer for a day. The counts are global over the whole mirror, so the same
answer serves the catalog and the inventory, and FilterBar shows them as they are: a count is how many cards exist, not
how many match the other filters.

## Verification

No automated tests (v1). Measured in the gallery against `next dev` and the live API, recorded in `docs/Components.md`:

1. Typing `charizard` at a normal pace writes the URL once, after the pause, and the demo's query runs once; the history
   gains no entry.
2. Choosing *Rare*, then *Fire*, then pressing Back leaves `rarity=Rare` and drops `type`.
3. Removing a chip changes the URL and the query key; *Clear all* removes every filter and keeps `sort`.
4. Opening `?sort=nonsense&rarity=Rare` shows *Rare* active and sort at its default; `?rarity=%00` shows no filter.
5. With `?page=3`, choosing a filter removes `page`; `?tab=sent` survives a filter change.
6. Keyboard only: Tab reaches the search, every menu, every chip's remove button, *Clear all* and the view toggle;
   menus open with Enter and close with Escape, back on their button.
7. In the demo form, leaving the email empty and submitting puts `aria-invalid` on it, and `aria-describedby` points at
   an element holding the Zod message; the unverified address shows the API's message on the email field, any other
   shows the form-level alert above the button, and neither raises a toast.
8. With the API stopped, the set, rarity and type menus are disabled and say why, while search and sort still change
   the URL.

## Out of scope

- Fuse.js and the inventory's instant filtering — PD-107.
- The catalog, inventory and auth pages themselves — M13.
- Facet counts conditional on the active filters — the API returns global counts by design (`CatalogFacetsSchema`).
- Multi-select filters — the API takes one value per filter.
- Tabs — PD-97, on `useUrlState`.
