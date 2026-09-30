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
  lib/
    utils.ts          cn()
    design/           rarity and energy styles, each color paired with a label or icon
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

## Traps

- **`shadcn init` wrote `--font-sans: var(--font-sans)`.** The preset expects the font variable to be called `--font-sans`; ours are `--font-geist-sans` and `--font-geist-mono`. A self-referencing custom property is invalid and falls back silently to the browser's default font. Fixed by pointing the theme at the Geist variables — re-running `init` would bring it back.
- **Two route groups may not resolve to the same path**, and the build error only appears when both exist. A page that is both public and in-app lives once, in `(public)`.
- **`global-error.tsx` replaces the root layout**, so it renders its own `<html>` and `<body>` and gets none of the root layout's fonts or classes.
- **Tailwind generates only the utilities it finds in source.** A class built at runtime (`` `text-energy-${type}` ``) produces no CSS; that is why `lib/design/` spells every class out in full.
- **A theme variable that references itself is invalid, and nothing says so.** It happened twice here — `--font-sans` from `shadcn init`, and nearly `--shadow-sm`. Raw tokens and theme names never share a name: the raw shadows are `--elevation-*` and `--glow-pri`.
