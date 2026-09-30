# M11 · Frontend Foundation

What the web app is built on, why it looks the way it does, and where the sharp edges are. [Architecture.md](Architecture.md) §5 says how the finished frontend is meant to be shaped; this says what exists today. It grows ticket by ticket through M11.

---

## What exists

```
apps/web/
  app/
    layout.tsx        html, Geist fonts, global css, title template
    loading.tsx  error.tsx  not-found.tsx  global-error.tsx
    (public)/         no session: /, /cards/[id], /profile/[id], /decks/[id]
    (auth)/           /register, /verify-email, /sign-in, /forgot-password, /reset-password
    (app)/            session required: 14 user pages
      admin/          role = ADMIN: 6 pages
  components/
    ui/               shadcn/ui primitives (button so far)
    page-placeholder.tsx
  lib/utils.ts        cn()
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

The palette in `app/globals.css` is still shadcn's neutral default. PD-85 replaces it with the design system's tokens.

## Fonts (PD-84)

Geist and Geist Mono through `next/font/google`: downloaded at build time, self-hosted, preloaded, and paired with a size-adjusted fallback face so the swap moves nothing. Tailwind's `font-sans` and `font-mono` point at the two font variables.

**Measured 2026-09-30** against `next build && next start`:

- Lighthouse on `/`: cumulative layout shift **0**, `font-display` audit passed;
- in the browser, a `layout-shift` observer on a first load with the font not yet cached: 0 shifts;
- `/`, `/sign-in`, `/dashboard`, `/admin/audit`, `/cards`, `/cards/abc`, `/decks/x`, `/profile/y`, `/trades/z` answered 200 with their own titles, and an unknown path 404 with the not-found page;
- the shadcn `Button` on the not-found page rendered with its slot, height and radius.

## Traps

- **`shadcn init` wrote `--font-sans: var(--font-sans)`.** The preset expects the font variable to be called `--font-sans`; ours are `--font-geist-sans` and `--font-geist-mono`. A self-referencing custom property is invalid and falls back silently to the browser's default font. Fixed by pointing the theme at the Geist variables — re-running `init` would bring it back.
- **Two route groups may not resolve to the same path**, and the build error only appears when both exist. A page that is both public and in-app lives once, in `(public)`.
- **`global-error.tsx` replaces the root layout**, so it renders its own `<html>` and `<body>` and gets none of the root layout's fonts or classes.
