# M11 · Frontend Foundation

What the web app is built on, why it looks the way it does, and where the sharp edges are. [Architecture.md](Architecture.md) §5 says how the finished frontend is meant to be shaped; this says what exists today. It grows ticket by ticket through M11.

---

## What exists

```
apps/web/
  app/
    layout.tsx        html, Geist fonts, global css, title template
    providers.tsx     theme, QueryClientProvider, Toaster, devtools in development
    error.tsx  not-found.tsx  global-error.tsx   (and an error.tsx in every route group)
    (public)/         no session: /, /cards/[id], /profile/[id], /decks/[id]; chrome follows the session
    (auth)/           /register, /verify-email, /sign-in, /forgot-password, /reset-password
    (app)/            session required: 14 user pages
      admin/          role = ADMIN: 6 pages
  components/
    ui/               shadcn/ui primitives: button, sonner, dropdown-menu
    shell/            the app shell: sidebar, topbar controls, nav links
    route-error.tsx   the error boundaries' shared fallback
    page-placeholder.tsx
  lib/
    env.ts            API_INTERNAL_URL, WEB_ORIGIN
    api/              typed client: core, server, browser, endpoints/
    session/          getSession, SessionProvider/useSession
    query/            TanStack Query: client, keys, invalidation map, hooks
    stores/           Zustand: deck draft, pack reveal (and its machine), UI
    use-unsaved-changes.ts  the leave-with-unsaved-changes prompt
    routes.ts         public paths, safeNext, signInUrl, redirectToSignIn
    route-access.ts   protected paths and the admin prefix — the proxy's only
    nav.ts            sidebar and admin navigation entries — server-only
    toast.ts          toastApiError
    utils.ts          cn()
    design/           rarity and energy styles, each color paired with a label or icon
  proxy.ts            session-cookie redirects, session renewal, the admin role check
  next.config.ts      /api rewrite to the Nest API
  components.json     shadcn configuration
  postcss.config.mjs  Tailwind v4
```

Every page in [InformationArchitecture.md](InformationArchitecture.md) exists as a route, rendering a placeholder that names the M13 ticket that builds it. The route map is fixed now so that the proxy (PD-89), the shell (PD-90) and every M13 page build against real paths.

## Route zones (PD-84)

| Zone | Route group | Session | Chrome |
| --- | --- | --- | --- |
| 01 Public | `(public)` | never required | public top nav; the shell when signed in (PD-89/PD-90) |
| 02 Auth | `(auth)` | none | centered card |
| 03 User app | `(app)` | required | app shell (PD-90) |
| 04 Admin | `(app)/admin` | `role = ADMIN` | app shell + admin sub-nav |

**Three URLs belong to two zones.** `/cards/:id`, `/profile/:id` and `/decks/:id` are shareable and render signed out, and they are also part of the signed-in app — "My profile", card detail from the inventory, the deck builder. Next refuses two route groups that resolve to the same path, so each page lives once, in `(public)`, and its chrome follows the session rather than the folder. `/decks/:id` is one page for the public deck and the owner's builder; which one renders is decided by ownership, exactly as `GET /decks/:id` answers the owner and everyone else from one route.

The consequence for PD-89: route groups do not appear in URLs, so the proxy cannot tell zones apart by folder. `/cards` (browse, session required) and `/cards/:id` (public) share a prefix, and the protected list has to match paths, not prefixes.

The ticket and the original tree called the public group `(marketing)`; it holds more than marketing, so it is `(public)`, after the IA zone.

## Styling toolchain (PD-84)

Tailwind **v4**, configured in CSS — there is no `tailwind.config.*`. shadcn/ui is initialised on **Radix** with the `radix-nova` preset, which is the one built on Lucide and Geist, the design system's icon set and typeface. Components land in `components/ui/` and belong to us once added.

`cn()` comes from the `cn` package, shadcn's own compiled replacement for `clsx` + `tailwind-merge` (repository `shadcn-ui/cn`, published by shadcn). `shadcn` itself is a dev dependency: the app consumes only its `shadcn/tailwind.css`, which is read at build time.

## Design tokens (PD-85)

`app/globals.css` is [DesignSystem.md](DesignSystem.md) value for value, in three layers:

1. **Raw tokens on `:root`**, under the design system's own names — `--bg`, `--pri`, `--c-ultra`, `--e-fire`. The only place in the app a hex, rgba, shadow or easing is written.
2. **shadcn's semantic names** (`--background`, `--primary`, `--muted-foreground`, …) pointed at those tokens, so a component added with `shadcn add` arrives already in the project's colors.
3. **`@theme inline`**, which turns both into utilities.

| Kind | Utilities |
| --- | --- |
| Neutrals | `bg-bg` `bg-surface` `bg-surface-2` `bg-elev` · `text-tx` `text-mut` `text-faint` · `border-bd` `border-bd-2` |
| Accent / semantic | `pri` `pri-hover` `pri-dim` `on-pri` · `gold` `gold-dim` `on-gold` · `grn` `on-grn` · `red` `red-dim` `on-red` |
| Rarity | `rarity-{common,uncommon,rare,ultra,secret}` with `-tint` and `-border`; `-edge` and `shadow-glow-{ultra,secret}` for the two high tiers |
| Energy | `energy-{fire,water,…,colorless}`; `bg-card-face` with `--energy` set |
| Type | `text-display` `text-h1` `text-h2` `text-h3` `text-body` `text-small` `text-caption` `text-mono` — size, weight and tracking together |
| Radius | `rounded-pill` `-tag` (6) `-control` (10) `-tile` (13) `-card` (16) `-modal` (18) |
| Elevation | `shadow-sm` `-md` `-lg` `-glow` |
| Motion | `animate-flip-in` `-pulse-glow` `-shimmer` `-spin`, `ease-reveal`; every transition defaults to 160 ms `ease` |
| Other | `bg-backdrop` (body), `bg-skeleton`, `bg-scrim`, `bg-bar`, `backdrop-blur-scrim`, `backdrop-blur-bar` |

**Tailwind's default palette is switched off** (`--color-*: initial`); only `white` and `black` survive, for shadcn internals. `bg-red-500` generates nothing, so a color outside the system cannot be written by accident. Spacing keeps Tailwind's own scale, which is already the 4px unit: `p-3` is 12px, `p-8` 32px. The design system said `space-8` is 34px, which broke its own rhythm; the mockups used 34 only as page padding, so it became 32 and the doc was corrected.

**The rest is enforced by lint.** `no-restricted-syntax` in `apps/web` refuses a hex value in any string (`'#fff'`, `bg-[#4c8dff]`) and an arbitrary length on a spacing utility (`p-[13px]`, `hover:mt-[1.5rem]`). Arbitrary radii and font sizes pass: shadcn's own components use them.

**Dark is the only theme.** `:root` is dark and declares `color-scheme: dark`; there is no light palette to switch to.

**Reduced motion is one global rule.** Under `prefers-reduced-motion: reduce` every animation and transition runs for 0.01 ms, once, with no delay — including third-party components, which no per-component discipline would reach. Motion then lands on its end state.

**Color never carries meaning alone.** `lib/design/rarity.ts` and `lib/design/energy.ts` pair every rarity and energy color with its label and, for energy, its Lucide icon, so a component takes both from one place. Card `types` are the provider's strings; `energyStyle()` reads anything unrecognised as Colorless.

**Measured 2026-09-30** in headless Chrome against `next start`, with and without `--force-prefers-reduced-motion`:

| | default | reduced motion |
| --- | --- | --- |
| a 0.8 s infinite spin | 0.8 s × infinite | 0.00001 s × 1 |
| a 1.5 s infinite shimmer | 1.5 s × infinite | 0.00001 s × 1 |
| button transition | 0.16 s | 0.00001 s |

Body text `rgb(238, 240, 244)` (`--tx`) at 14px over the radial backdrop; the outline button `rgb(10, 11, 14)` (`--bg`) with a 10px radius. The compiled CSS holds no `--color-red-500` or any other default palette entry. The lint rule reported all four violations in a probe file and passed the shadcn button's arbitrary radius and font size.

## Fonts (PD-84)

Geist and Geist Mono through `next/font/google`: downloaded at build time, self-hosted, preloaded, and paired with a size-adjusted fallback face so the swap moves nothing. Tailwind's `font-sans` and `font-mono` point at the two font variables.

**Measured 2026-09-30** against `next build && next start`:

- Lighthouse on `/`: cumulative layout shift **0**, `font-display` audit passed;
- in the browser, a `layout-shift` observer on a first load with the font not yet cached: 0 shifts;
- `/`, `/sign-in`, `/dashboard`, `/admin/audit`, `/cards`, `/cards/abc`, `/decks/x`, `/profile/y`, `/trades/z` answered 200 with their own titles, and an unknown path 404 with the not-found page;
- the shadcn `Button` on the not-found page rendered with its slot, height and radius.

## Reaching the API (PD-86)

The design, and why, is in `docs/superpowers/specs/2026-09-30-pd-86-pd-89-api-client-and-session-design.md`.

**One origin.** `next.config.ts` rewrites `/api/*` to the Nest API, so the browser never leaves the web app's origin and the session cookie is host-only on it. `/api` belongs to the API entirely; the web app has no route handlers there. Server renders skip the rewrite and call `API_INTERNAL_URL` directly. What this asks of the API's configuration — `AUTH_BASE_URL`, `TRUST_PROXY_HOPS` and the edge proxy — is in [API.md](API.md), *Conventions*.

**The client.** `lib/api/` has one core and two transports:

| File | Role |
| --- | --- |
| `core.ts` | builds the URL, sends, retries, parses; `ApiError`; the request builders `get`, `post`, `patch`, `del` |
| `server.ts` | `serverApi`: `API_INTERNAL_URL`, the visitor's `cookie` and `X-Forwarded-For`, `Origin: WEB_ORIGIN`, `cache: 'no-store'` — server-only |
| `browser.ts` | `api`: relative `/api/v1`, the cookie travels by itself |
| `endpoints/*.ts` | one function per operation, returning a request |

```ts
const profile = await serverApi.call(me());                         // a Server Component
const result = await api.call(openPack(templateId, { openId }));    // the browser
```

**Adding an endpoint** is one line in `endpoints/`, typed by the shared schemas: path parameters are the function's arguments, a body is `z.input` of the shared request schema, the answer is `z.output` of the response schema. Declare an endpoint in the ticket that first uses it.

**Every answer is parsed.** A body that fails its schema is an `ApiError` of kind `contract` — a bug, never a state to render around.

| `ApiError.kind` | When | `code` | `requestId` |
| --- | --- | --- | --- |
| `api` | our error envelope, or any other non-2xx | `ERROR_CODES` value, when the API sent one | body, else `X-Request-Id` |
| `auth` | Better Auth's `{ message, code }` from `/api/auth/*` | Better Auth's code | `X-Request-Id` |
| `network` | `fetch` threw; `statusCode` 0 | — | — |
| `contract` | a 2xx body failed its schema | — | `X-Request-Id` |

**Retry lives here and nowhere else:** `GET` only, once, after 300 ms, on a network error or a 502/503/504. Never a 4xx or a 429, never another method. The retry carries its own `AbortController` signal, because Next memoizes identical `GET` fetches within a server render and would otherwise hand the retry the failed first answer.

**Measured 2026-09-30:**

- renaming `currency` to `coins` in the shared `UserSchema` failed `apps/web` at the one reader of `profile.currency` (`TS2339`); `apps/api` still typechecked, because it meets the schema only at runtime, in the parse before sending;
- a signed-in server render returned the member's own profile, and a no-op `PATCH /users/me` from the server passed `CsrfGuard` — the API log shows both at 200; signed out, the render failed with a 401 `ApiError` into the error boundary;
- against an API that always answers 503: `GET` reached it twice, 304 ms apart, and `POST` once. The first attempt at this measurement saw one `GET` — the memoization above — and is why the retry has its own signal;
- with `TRUST_PROXY_HOPS=1` and curl standing in for the edge proxy, `1.1.1.1` and `2.2.2.2` each drew from their own bucket (99, 98 each) through a server render, and `3.3.3.3` and `4.4.4.4` through the rewrite.

## Session and route protection (PD-89)

**Three layers, each doing one thing.**

1. **`proxy.ts`** runs before any render. On a protected path without a session cookie it redirects to `/sign-in?next=<path and query>`. On `/admin` and below it also asks the API for the role (`GET /users/me`) and sends anyone but an `ADMIN`, and any failure to answer, to `/dashboard`. Everywhere else it only checks that a cookie exists, and it adds `x-pathname` for the layouts.
2. **Layouts** validate with the API. `getSession()` in `lib/session/server.ts` calls `/users/me` once per request (React `cache`), returning the profile or `null` with a reason: `signed-out` (no cookie, or 401) or `suspended` (403 `ACCOUNT_SUSPENDED`). `(app)/layout.tsx` redirects without a profile; `(app)/admin/layout.tsx` repeats the role check for client-side navigation; `(public)/layout.tsx` never redirects and chooses its chrome by the session.
3. **The API** is the boundary. The first two layers are navigation comfort.

**Protected paths** are listed in `lib/route-access.ts`, which only the proxy imports: prefixes `/dashboard`, `/packs`, `/inventory`, `/sets`, `/trades`, `/settings`, `/wallet`, `/notifications`, `/admin`, and the exact paths `/cards` and `/decks`, because `/cards/:id` and `/decks/:id` are public. A new protected section has to be added there. The browser asks the opposite question through `isPublicPath()` in `lib/routes.ts` — the landing page, the auth pages and the three shareable detail pages — so the list naming the admin area never ships to it.

**Return URLs** are read only through `safeNext()`, which resolves the value the way a browser would and keeps it only if it stays on this origin and is not `/sign-in`; anything else becomes `/dashboard`.

**The client gets identity, not state.** `SessionProvider` passes `{ id, role, displayName, avatarUrl }` to `useSession()`. The balance and anything else an action changes belongs to TanStack Query (PD-87), seeded from the same `getSession()` profile.

**Keeping the cookie alive.** `/api/v1` renews a session in the database but drops the refreshed cookie ([API.md](API.md), *Auth*), and the first API call of any render — `getSession()`, or the proxy's admin check — would spend that renewal. So the proxy itself calls `/api/auth/get-session` before anything renders, whenever a session cookie arrives without the `pokedrop.session-refreshed` marker, copies Better Auth's `Set-Cookie` onto the response, and sets the marker for 12 hours. A first version did this from a client component after hydration; the final review found that the server render had already spent the renewal by then, and a measurement confirmed the cookie never moved.

**Measured 2026-09-30** against `next start` and the live API, with throwaway users:

| Visitor | Path | Answer |
| --- | --- | --- |
| anonymous | `/`, `/sign-in`, `/cards/x`, `/decks/x`, `/profile/x` | 200 |
| anonymous | `/cards`, `/decks`, `/trades/abc?tab=sent`, `/admin/users` | 307 `/sign-in?next=` the path and query |
| member | `/dashboard`, `/cards`, `/cards/x` | 200 |
| member | `/admin`, `/admin/users`, `/admin?x=1`, and an RSC request for `/admin` | 307 `/dashboard`, 10-byte body |
| member | `/administrator` | 404 |
| member | `GET /api/v1/admin/users` | 403 |
| admin | `/admin`, `/admin/users` | 200 |
| revoked session, cookie kept | `/dashboard` | 307 `/sign-in?next=%2Fdashboard`; `/sign-in` 200; one redirect, no loop |
| suspended | `/dashboard` | 307 `/sign-in?next=%2Fdashboard&error=ACCOUNT_SUSPENDED` |

`safeNext`: `/trades/abc?tab=sent` and `/cards/x#top` survive; `//evil.com`, `/\evil.com`, `/<tab>/evil.com`, `https://evil.com`, `/sign-in`, `/sign-in?next=/x`, an empty value, `null` and `dashboard` all become `/dashboard`; `/%09/evil.com` stays a path on this origin.

Session renewal, with the session's `expiresAt` moved to five days ahead (inside the one-day renewal window): the first full load of `/dashboard` answered 200 carrying `better-auth.session_token=…; Max-Age=604800` and the marker, and the row moved to seven days; the next load carried no `Set-Cookie`. Before the fix, the same sequence renewed the row and sent no cookie, on the page load and on the client's `get-session` after it. With the API stopped, a visitor holding a cookie got `/` as a signed-out visitor (200, the *Sign in* link) instead of a 500.

**Two things this measurement changed.** The first run answered 200 for every layout redirect: PD-84's root `loading.tsx` was a Suspense boundary above the group layouts, so the response began streaming before a layout could redirect. Loading boundaries now live in `(app)/` and `(public)/`. The second run showed a member's 307 from `/admin` carrying the admin page's rendered output — Next renders a page alongside its layout and ships it with the layout's redirect — which is why the admin role moved into the proxy. A layout redirect for a revoked or suspended session still carries that visitor's own page, whose API calls answer 401.

## Server state (PD-87)

TanStack Query owns every piece of server data in the browser; nothing else caches API answers. `app/providers.tsx` wraps the root layout in `QueryClientProvider` with `getQueryClient()`: a new client per server render, one for the life of the browser tab.

**Keys come only from `lib/query/keys.ts`.** Each API resource has a root, `all` (`['inventory']`, `['wallet']`, …), and every key for that resource extends it (`keys.inventory.list(params)` is `['inventory', 'list', params]`). Stale times and invalidations target the roots, so a key added under a root inherits both. Add keys there as pages need them; never write a key array inline.

**Stale times by data class**, set once per root with `setQueryDefaults`:

| Data | Roots | Stale time |
| --- | --- | --- |
| Catalog — the mirror changes nightly | `catalog` | 30 min |
| Prices | `prices` | 10 min |
| The user's own state | `me`, `inventory`, `wallet`, `trades`, `notifications` | 15 s |
| Everything else | — | 30 s |

None is zero: a query hydrated from a server render with a stale time of zero refetches the moment it mounts.

**Retry is off** for queries and mutations: `lib/api/core.ts` already retries a failed GET once, and stacking TanStack's three retries on top would make six attempts.

**Invalidation is a map, applied automatically.** `lib/query/invalidation.ts` lists, per mutation, the roots it makes stale; `MutationCache.onSuccess` invalidates them for every successful mutation by its `mutationKey`. A mutation hook only declares its key.

| Mutation | Invalidates |
| --- | --- |
| `openPack` | `me`, `wallet`, `inventory`, `packs` |

Add a row with every new mutation; a mutation missing from the map invalidates nothing.

**401 sends the visitor to sign in** — from `QueryCache` and `MutationCache` `onError`, through `redirectToSignIn()`, but only on a protected path: a public page may hold a query that needs a session, and losing the session there is no reason to leave the page.

**`me` is hydrated, not fetched.** `(app)/layout.tsx` puts the session's profile into a per-request query client (`getServerQueryClient()`) and passes it down through `HydrationBoundary`; `useMe()` then reads it without a request.

**Measured 2026-10-01** against `next start`, signed in as a member with 1 000 coins, on a scratch page reading `useMe()`, an inventory list and the wallet:

- first load: the balance rendered as 1 000, and the browser requested only `/inventory` and `/wallet` — no `/users/me`;
- opening a pack through `useOpenPack()`: `POST /packs/seed-template-base/open`, then `/users/me`, `/inventory` and `/wallet` refetched on their own; the page showed 700 coins, 5 inventory rows and an 8-card opening;
- with the session deleted in the database, a refetch answered 401 and the page moved to `/sign-in?next=%2Fpacks%2Fprobe`; the same refetch on an unprotected path stayed put;
- devtools: rendered under `next dev`, absent from the production bundle (no `tsqd-` in `.next/static`).

## Theme, toasts and error boundaries (PD-91)

**One theme, dark.** `next-themes` runs with `forcedTheme="dark"` and puts `class="dark"` on `<html>`, which switches on the `dark:` variants inside shadcn components. Nothing depends on it for the colors themselves: `:root` is already the dark palette and declares `color-scheme: dark`, so the very first paint is dark with or without JavaScript. When a second theme exists, it is a palette under a class plus dropping `forcedTheme`.

**Toasts** are Sonner through shadcn's `components/ui/sonner.tsx`, restyled with the tokens: `--elev` surface, `--bd-2` border, the card radius, and the icon in `grn`, `red`, `pri` or `gold` by tone; four seconds by default (ComponentSpecs, *Toast*).

**A failed mutation always says so.** `MutationCache.onError` calls `toastApiError()` (`lib/toast.ts`) for every failed mutation, unless the mutation sets `meta: { toast: false }`. The toast carries the API's own message for a 4xx — they are written for people — and a fixed one for a network error, a 5xx, a contract error or a 429; its description is the request ID. A 401 on a protected page shows nothing, because the sign-in redirect is already under way. Failed queries do not toast: the page that owns a query shows its error in place.

**Every route group has an error boundary**: `error.tsx` in `(app)`, `(public)` and `(auth)`, plus the root one for a failing group layout, all rendering `components/route-error.tsx`. Next's `error.tsx` is a React error boundary scoped to its segment, so it is used instead of adding `react-error-boundary`. The boundary renders inside its group's layout, so the chrome around a failed page stays. `Try again` calls `retry()` — stable in 16.3 — which refetches and re-renders the segment; `reset()` would only clear the error.

**The reference on the fallback.** An error thrown in a server render reaches the browser with its message replaced and only a `digest`, so the fallback shows the digest; the Next server log prints the `ApiError`, its `requestId` and that digest together. An `ApiError` thrown in the browser arrives whole, and the fallback shows its request ID.

**Measured 2026-10-01** against `next start`:

- first paint in headless Chrome with JavaScript **off**: no `dark` class, `color-scheme: dark`, body `rgb(10, 11, 14)` on `rgb(238, 240, 244)` text; with JavaScript on, the same plus `class="dark"`;
- a member with no coins opening a pack: one error toast, *Not enough coins to open this pack*, described *Request ID bc212513-…*, red icon, `--elev` background, 16 px radius; the API log holds that request ID on the 402;
- a page whose server render called a missing deck: the `(app)` boundary, inside the app layout's `<main>`, with *Reference 3495550609*; the server log printed `ApiError: Deck not found`, `statusCode: 404`, `requestId: '0a85bbf2-…'` and `digest: '3495550609'`, and the API log holds that request ID;
- a client component throwing during render: the same boundary, inside `<main>`, with no reference.

## Client state (PD-88)

Zustand holds what only the browser knows: what the user is doing, not what the server said. Server data stays in TanStack Query.

**A store per provider, never a module singleton.** A module is shared by every request on the server, so a singleton store would carry one visitor's state into another's render. `lib/stores/context.tsx` turns a store factory into a provider and a selector hook; each provider creates its store once.

| Store | Provided by | Holds |
| --- | --- | --- |
| `useUi` | `app/providers.tsx`, app-wide | the open modal's id, the navigation drawer on narrow screens, filter panel open |
| `usePackReveal` | the reveal page (PD-105) | stage, card index, card count, whether it was skipped |
| `useDeckDraft` | the deck builder (PD-112), with `initial` from the deck query | the working card list, the last saved list, the list before the last drag |

**The reveal stage machine** is a pure function, `transition(state, event)` in `lib/stores/reveal-machine.ts`: `sealed → opening → reveal → summary → sealed`, with `failed` taking an opening back to `sealed` and `skip` jumping a reveal to `summary`. An event the current stage does not accept returns the state unchanged, so nothing can reach a stage out of order or an index outside the pack. The store keeps the pack's card *count*; the cards themselves stay in the pack-opening mutation's result.

**The deck draft is the one card list outside TanStack Query**, on purpose: it is the user's unsaved edit, not a copy of server state. It starts from the deck query, and after a save the builder resets it from the refreshed query. `isDirty` compares it with the last saved list, so undoing back to the saved deck is clean again. `applyDrag` records the list before the drag, and `undoDrag` restores it — one step.

**Leaving with unsaved changes.** `useUnsavedChanges(dirty)` asks before a click on a link to another page and registers `beforeunload` for closing or reloading the tab. The App Router cannot cancel a navigation, so back and forward are not caught, and anything the builder navigates to itself has to check `isDirty` first.

**Measured 2026-10-01:**

- the reveal machine, walked from `sealed` with every event — including `opened` with 0, −1 and 1.5 cards — reached 12 states over 120 transitions with no state outside its invariants and no stage move outside the five allowed; `next` while sealed, `opened(0)`, and `open` mid-reveal each left the state as it was;
- the deck draft in the browser: adding a card made it dirty; a drag reversed the list and enabled undo; undo restored the list and disabled undo; removing the added card made it clean again; saving made the current list the saved one;
- with the draft dirty, a link click asked once and stayed on the page when declined, and navigated when accepted; with the draft clean it did not ask;
- `beforeunload` is registered but its dialog was not observed: Chrome shows it only after a real user gesture on the page.

## App shell (PD-90)

`components/shell/app-shell.tsx` is the chrome around every signed-in page: `(app)/layout.tsx` renders it, and so does `(public)/layout.tsx` when the visitor is signed in. It seeds the `me` query from the session's profile, so the balance renders without a request.

- **Sidebar** (236 px): Dashboard, Packs, Inventory, Browse, Sets, Decks, Trades; an *Account* group with Notifications, Wallet, Settings; and for admins an *Admin* group. Icons and order follow the mockup.
- **Topbar** (60 px): search, the balance linking to the wallet, the notification bell (unread count polled every minute), *Open packs*, and the avatar menu — My profile, Account settings, Currency & history, Sign out, Sign out of all devices.
- **Admin sub-nav** under `/admin`: Overview · Pack templates · Sync · Users · Trade moderation · Audit log, rendered by the admin layout.
- **Active route**: `NavLink` sets `aria-current="page"` on its own path and everything below it; *Overview* matches `/admin` exactly.

**Admin routes never reach a member.** The entries live in `lib/nav.ts`, which imports `server-only`; the sidebar is a Server Component that leaves the admin group out of the markup for anyone but an admin, and hands each link to the client `NavLink` with its icon already rendered. The proxy's protected list, which names `/admin`, moved to `lib/route-access.ts` so the client bundle does not carry it either.

**Narrow screens** (below 64 rem) slide the sidebar in as a drawer from a menu button in the topbar. A closed drawer is `inert`, so keyboard focus never lands on links nobody can see; opening it focuses the first link, and Escape or the scrim closes it and returns focus to the button. The topbar search is hidden there; the catalog is one tap away under *Browse*.

**Search** is a plain `GET /cards?q=…` form inside a `<search>` landmark — it works without JavaScript, and the catalog page (PD-108) reads `q`.

**Sign out** posts to `/api/auth/sign-out` or `/api/auth/revoke-sessions`, clears the query cache and reloads to `/`: a full load, so nothing of the signed-out user survives in the router cache or the client stores.

Built from plain elements on the tokens until M12's components exist (Button, Avatar, CurrencyPill); only the avatar menu uses a shadcn primitive, for its keyboard handling. The avatar shows the name's initial; images arrive with M12's Avatar.

**Measured 2026-10-01** against `next start`:

- a member's `/dashboard`, `/cards/x`, `/trades` and `/inventory`: no `/admin`, *Pack templates* or *Admin* in the HTML; the production client bundle holds none of `/admin`, *Pack templates*, *Trade moderation* or *Audit log*;
- an admin's `/dashboard` links all six admin pages; every link in the admin's shell answered 200;
- on `/admin/sync`, `aria-current` sat on *Sync* in both the sidebar and the admin sub-nav;
- Tab through the wide layout: *Skip to content*, the logo, all 16 sidebar links, the topbar controls, the admin sub-nav — every stop with a visible focus ring; *Skip to content* moved focus to `<main>`;
- headless Chrome at 390 px with real key events: Enter on the menu button opened the drawer and focused the logo link, Tab stayed in the drawer, Escape closed it, made it inert again and returned focus to the menu button;
- *Sign out* through the avatar menu with real clicks: the member's session count went from 2 to 1, the page landed on `/` with the public nav, and `/dashboard` then redirected to sign-in; *Sign out of all devices* took 3 sessions to 0, and a second device's cookie was refused;
- after an admin grant, the bell read *Notifications, 1 unread* with its dot, and the balance *500 coins*.

## Traps

- **`shadcn init` wrote `--font-sans: var(--font-sans)`.** The preset expects the font variable to be called `--font-sans`; ours are `--font-geist-sans` and `--font-geist-mono`. A self-referencing custom property is invalid and falls back silently to the browser's default font. Fixed by pointing the theme at the Geist variables — re-running `init` would bring it back.
- **Two route groups may not resolve to the same path**, and the build error only appears when both exist. A page that is both public and in-app lives once, in `(public)`.
- **`global-error.tsx` replaces the root layout**, so it renders its own `<html>` and `<body>` and gets none of the root layout's fonts or classes.
- **Tailwind generates only the utilities it finds in source.** A class built at runtime (`` `text-energy-${type}` ``) produces no CSS; that is why `lib/design/` spells every class out in full.
- **A theme variable that references itself is invalid, and nothing says so.** It happened twice here — `--font-sans` from `shadcn init`, and nearly `--shadow-sm`. Raw tokens and theme names never share a name: the raw shadows are `--elevation-*` and `--glow-pri`.
- **Never a `loading.tsx` above a layout that redirects.** It turns the layout's 307 into a 200 whose stream redirects client-side. Put loading boundaries inside the route group, below its layout.
- **A layout's redirect does not stop its page.** The page renders in parallel and its output travels in the redirect's body. Anything a page must not show to a visitor is gated in the proxy or refused by the API.
- **The `/api` rewrite is fixed at `next build`.** Changing `API_INTERNAL_URL` in production means rebuilding. `lib/env.ts` is read by `next.config.ts`, so it must not import `server-only` or anything that needs a request.
- **The browser client cannot run during a server render**: its base URL is relative. Server Components use `serverApi`.
- **Import `lib/api` through `@/lib/api/…`.** The workspace-boundary lint rule matches `../**/api/**` as written, so a relative `../api/core` from inside `lib/` reads as a reach into `apps/api`.
- **`next dev` writes `apps/web/AGENTS.md` and `CLAUDE.md`** (Next 16.3's `agentRules`, on by default; `agentRules: false` in `next.config.ts` turns it off).
- **`NextResponse.cookies.set()` rewrites the whole `set-cookie` header from its own list**, dropping anything appended with `headers.append('set-cookie', …)` before it. The proxy sets its marker first and appends Better Auth's cookies after.
- **`await response.body?.cancel()` on a `fetch` response hangs in the proxy.** Read the body (`arrayBuffer()`) to release it instead; the request otherwise never completes.
- **`(public)/layout.tsx` renders with the API down.** A network error or 5xx from `getSession()` reads as signed out there; a contract error still throws. `(app)` pages have no such fallback: without the API they reach the error boundary.
- **Next 16.3's error boundaries take `retry`, not `reset`.** `reset()` clears the error and re-renders from what the client already holds, which cannot recover a server render that failed; `retry()` refetches it.
- **A server render's error loses its message and properties in production.** Only `digest` reaches `error.tsx`; anything a person should read must be in the server log under that digest.
- **Nothing the client imports may name the admin area.** `lib/nav.ts` is `server-only`; `lib/route-access.ts` is for the proxy. A client module that imports either puts admin routes in every member's JavaScript.
