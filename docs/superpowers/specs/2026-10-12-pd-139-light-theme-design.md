# PD-139 — Light theme with a theme switch

Design, 2026-10-12. Milestone M15 · Polish & Extras.

Ticket: [PD-139](https://linear.app/mstrilec/issue/PD-139). Reverses D7 (*dark is the only theme*, `docs/Pages.md`).
Builds on the token system in `apps/web/app/globals.css` (PD-91…PD-100), the account settings (PD-118), the shell
menus (PD-134), the booster wrapper (PD-136) and the landing (PD-138). Reference: `docs/DesignSystem.md` ·
`docs/Frontend.md` · `docs/Pages.md` *Account settings*, *Landing* · `docs/InformationArchitecture.md`.

---

## What the ticket asks

| Scope item | Where it lands |
| --- | --- |
| A light palette with AA contrast (3:1 for UI) | [Palette](#palette) |
| System · Light · Dark in Settings and a quick toggle in the account menu | [Switches](#switches) |
| The server renders the right theme on the first byte; System follows `prefers-color-scheme`; no flash | [Mechanism](#mechanism) |
| Every page in `InformationArchitecture.md` checked at 1440 and 375 | [Verification](#verification) |
| No raw colours outside `globals.css` | [Raw colours](#raw-colours) |
| Docs: DesignSystem, Frontend, Pages | [Documentation](#documentation) |

## Decisions

Taken with the user during brainstorming:

1. **The light palette is derived from the existing tokens**, not designed in Claude Design first; every text and UI pair
   is checked by a contrast script and the figures are recorded.
2. **The choice lives in a cookie on the device.** No database column, no API change. A guest can switch too.
3. **Without a cookie the theme is System** (the operating system's preference).
4. **Mechanism: a server-read cookie plus one light block of tokens through a Tailwind `@variant`**, System resolved in
   CSS. Rejected: `light-dark()` in every token (needs Safari 17.5 / Chrome 123, above Next 16's supported browsers),
   and `next-themes` in its normal mode (localStorage and an inline script; the first byte does not carry the theme, and
   React 19.2 warns about a rendered `<script>`).

## Mechanism

**Cookie.** `theme=light` or `theme=dark`, `Path=/`, `Max-Age` one year, `SameSite=Lax`. System is the absence of the
cookie: choosing System deletes it. Any other value is ignored (treated as System).

**Root layout** (`app/layout.tsx`) reads it with `cookies()` and renders `<html data-theme="light|dark">` for an
explicit choice, no attribute for System. Reading cookies makes the root layout dynamic; every route already is except
`/forgot-password` and `/_not-found`, which become dynamic too.

**CSS** (`globals.css`):

```css
@custom-variant light {
  &:where([data-theme='light'], [data-theme='light'] *) {
    @slot;
  }
  @media (prefers-color-scheme: light) {
    &:where(:root:not([data-theme='dark']), :root:not([data-theme='dark']) *) {
      @slot;
    }
  }
}

:root {
  color-scheme: dark;
  /* …the dark tokens, unchanged… */

  @variant light {
    color-scheme: light;
    /* …the light tokens, once… */
  }
}
```

The dark tokens stay the default; `[data-theme='dark']` keeps them under a light operating system. The unused
`@custom-variant dark (&:is(.dark *))` goes. The exact selector form is confirmed against Tailwind 4's `@variant`
output in the build (the plan's first task measures it); the behaviour required is: light when `data-theme="light"`,
or when there is no `data-theme="dark"` and the OS prefers light; dark otherwise.

**`ThemeProvider`** (`lib/theme/theme-provider.tsx`, client) replaces `next-themes` (removed from `package.json`):

```ts
type ThemePreference = 'system' | 'light' | 'dark';
type ResolvedTheme = 'light' | 'dark';
function ThemeProvider(props: { initial: ThemePreference; children: ReactNode }): JSX.Element;
function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference(next: ThemePreference): void;
};
```

- `initial` comes from the root layout's cookie read, so the server and the first client render agree.
- `resolved` for System follows `matchMedia('(prefers-color-scheme: light)')` through `useSyncExternalStore` with a
  server snapshot of `dark`, and updates when the OS changes.
- `setPreference` writes or deletes the cookie, sets or removes `data-theme` on `<html>`, and suppresses colour
  transitions for one frame (a `data-theme-switching` attribute that `globals.css` maps to `transition: none`, removed
  on the next animation frame). No reload, no request. With cookies blocked the change holds until the page reloads.
- The `Toaster` (`components/ui/sonner.tsx`, today `theme="dark"`) takes `resolved`.

## Palette

**Three groups of tokens.**

| Group | Tokens | Light theme |
| --- | --- | --- |
| UI neutrals | `--bg`, `--surface`, `--surface2`, `--elev`, `--tx`, `--mut`, `--faint`, `--bd`, `--bd2`, `--bar`, `--scrim`, `--skeleton-*`, `--backdrop`, `--elevation-*`, `--glow-pri` | new values |
| Ink: colour as text, icon or UI fill | `--pri*`, `--gold*`, `--grn`, `--red*`, `--on-*`, `--c-*` (rarity), new `--ink-*` for the energy utilities | darkened to AA |
| Art: identical in both themes | `--e-*`, `--card-face-end`, `--card-back`, `--booster-*`, new `--art-rare`, `--on-art`, `--art-scrim` | unchanged |

**Energy ink.** `--color-energy-*` (the `text-energy-*` and `bg-energy-*` utilities) point at new `--ink-<type>` tokens
instead of `--e-<type>`. Card faces, boosters and the landing's 3D keep reading `var(--e-<type>)` directly, so art does
not change between themes. In the dark theme `--ink-<type>` equals `--e-<type>`, except two that fail today:
`--ink-darkness` `#8c93a3` (the art colour `#4a4f5d` reads 2.4:1 as text) and `--ink-fighting` `#d4804f` (4.30:1 on
`surface2`).

**Light values** (each text colour ≥ 4.5:1 on `#f5f6f8`, `#ffffff` and `#eef0f3`; figures from the contrast script,
bg / surface / surface2):

| Token | Light | Contrast |
| --- | --- | --- |
| `--bg` · `--surface` · `--surface2` · `--elev` | `#f5f6f8` · `#ffffff` · `#eef0f3` · `#ffffff` | — |
| `--tx` | `#12141a` | 17.0 / 18.4 / 16.1 |
| `--mut` | `#4f5664` | 6.8 / 7.4 / 6.5 |
| `--faint` | `#626977` | 5.1 / 5.5 / 4.8 |
| `--bd` · `--bd2` | `rgba(18, 20, 26, 0.1)` · `rgba(18, 20, 26, 0.16)` | decorative, as in dark |
| `--pri` · `--pri-hover` | `#2160e0` · `#1d56cf` | 5.1 / 5.5 / 4.8 |
| `--pri-strong` · `--pri-strong-hover` · `--on-pri` | `#1d56cf` · `#1849b3` · `#fff` | white on strong 6.4 |
| `--pri-dim` | `rgba(33, 96, 224, 0.1)` | — |
| `--gold` · `--gold-dim` · `--on-gold` | `#a05a00` · `rgba(160, 90, 0, 0.1)` · `#fff` | 4.9 / 5.3 / 4.7 |
| `--grn` · `--on-grn` | `#057a52` · `#fff` | 5.0 / 5.4 / 4.7 |
| `--red` · `--red-strong` · `--red-dim` · `--on-red` | `#c82e2c` · `#b42318` · `rgba(200, 46, 44, 0.1)` · `#fff` | 5.0 / 5.4 / 4.7; white on strong 6.6 |
| `--c-com` | `#5f6673` | 5.3 / 5.8 / 5.1 |
| `--c-unc` | `#157b3a` | 5.0 / 5.4 / 4.7 |
| `--c-rare` | `#2160e0` | 5.1 / 5.5 / 4.8 |
| `--c-ultra` | `#7c3aed` | 5.3 / 5.7 / 5.0 |
| `--c-secret` | `#a05a00` | 4.9 / 5.3 / 4.7 |
| `--c-*-tint` · `--c-*-border` | the colour at 0.1 · 0.28 | — |
| `--c-ultra-edge` · `--c-secret-edge` | the colour at 0.4 | — |
| `--c-ultra-glow` · `--c-secret-glow` | `0 0 18px` the colour at 0.18 | — |
| `--ink-fire` · `water` · `grass` · `lightning` | `#bc411b` · `#1d6db8` · `#2a7a33` · `#856600` | ≥ 4.6 on all three |
| `--ink-psychic` · `fighting` · `darkness` · `metal` | `#8d3fb0` · `#a14f22` · `#4a4f5d` · `#5b6577` | ≥ 5.0 |
| `--ink-dragon` · `fairy` · `colorless` | `#896611` · `#b1417b` · `#5f6673` | ≥ 4.6 |
| `--elevation-sm` · `md` · `lg` | `0 4px 14px` · `0 16px 34px` · `0 40px 90px` `rgba(18, 20, 26, 0.1 / 0.12 / 0.16)` | — |
| `--glow-pri` | `0 8px 24px rgba(33, 96, 224, 0.25)` | — |
| `--scrim` · `--bar` | `rgba(15, 18, 25, 0.45)` · `rgba(245, 246, 248, 0.85)` | — |
| `--skeleton-base` · `--skeleton-highlight` | `#e6e8ec` · `#f2f3f6` | — |
| `--backdrop` | the dark radial with `rgba(33, 96, 224, 0.06)` | — |

The shadcn names and `--chart-*`, `--sidebar-*` already point at these tokens and need no light values.

**Thresholds** (the contrast script fails the task otherwise): text tokens ≥ 4.5:1 on `--bg`, `--surface`, `--surface2`
in each theme; text on a filled button (`--on-*` on its fill) ≥ 4.5:1; icons and focus ring (`--pri`) ≥ 3:1. Borders
(`--bd`, `--bd2`) stay decorative in both themes, as today; inputs are identified by their label and fill, not by the
border alone.

## Raw colours

Every `white`/`black` utility in components sits on card art, which is the same in both themes. They become art tokens
with the same values in both themes:

- `--on-art` `#fff`: the card face's name, HP, icon and set number (`card-art.tsx`), the reveal card's back icon
  (`reveal-card.tsx`), the landing's flat hero cards' border (`hero-card-stage.tsx`, `border-on-art/20`), the reveal
  back's frame lines;
- `--art-scrim` `#000`: the `×4` plates on `card-tile.tsx`, `pool-tile.tsx`, `card-picker-dialog.tsx` and the reveal's
  price plate (`bg-art-scrim/50`, `/40`);
- the switch thumb in `toggle.tsx` (`data-[state=checked]:bg-white`) becomes `bg-on-pri`, since it sits on the primary
  fill.

`--color-white` and `--color-black` leave `@theme`, so a raw `white`/`black` utility no longer exists. The landing's 3D
modules read `--art-rare` (`#4c8dff` in both themes) instead of `--c-rare`, so they never need re-initialising after a
switch. The OG image (`opengraph-image.tsx`) stays dark; it cannot read CSS variables anyway.

## Switches

**`ThemeSwitch`** (`components/shell/theme-switch.tsx`, client): three native radio inputs in a `radiogroup` named
*Theme* — System (`Monitor`), Light (`Sun`), Dark (`Moon`) — so arrow keys move between them; `size="labelled"`
shows the words, `size="icon"` shows only the icons with each input's accessible name.

| Where | Who | Form |
| --- | --- | --- |
| Settings → a new **Appearance** section, first, *Applies to this device. System follows your operating system.* | members | labelled `ThemeSwitch` |
| Account menu (`AvatarMenu`), a *Theme* group above *Sign out* | members | three `DropdownMenuRadioItem`s |
| The footer's bottom row, beside `©` | everyone on every public page | icon `ThemeSwitch` |

The comment `// No theme choice: dark is the only theme (D7 in docs/Pages.md)` in `settings-page.tsx` goes.

## Verification

No automated tests (v1). Gates: shared and web build/typecheck, eslint `--max-warnings=0`, prettier.

- **Contrast**: the script in the session scratchpad computes every threshold pair above for both themes; its table goes
  into `DesignSystem.md`. A failing pair blocks the task.
- **First byte**: `curl` with `theme=light`, `theme=dark` and without the cookie → `data-theme="light"`, `"dark"`, none.
- **No flash**: headless Chrome with network throttled to Slow 4G, for each of {no cookie, light, dark} ×
  {`prefers-color-scheme: light`, `dark`}: the first painted frame (`Page.startScreencast`) and `body`'s computed
  background match the expected theme — six cases.
- **Switching**: each control sets the cookie and `data-theme` at once, System deletes the cookie, a reload keeps the
  choice, the Toaster follows, the account menu and footer show the current choice.
- **Screenshot pass (subagent)**: every page in `InformationArchitecture.md` in the light theme at 1440 and 375 —
  guest, member, and the admin pages through the test account promoted for the pass and demoted after; a dark-theme
  regression sample (landing, catalog, deck builder, pack reveal, trades). Looks for unreadable text, dark blocks left
  in the light theme, invisible focus.
- **Lighthouse** on `/` in the light theme: accessibility 100 with no `color-contrast` failure.
- **Grep**: no hex, `rgb(`, `white` or `black` colour outside `globals.css`, except `opengraph-image.tsx` and `/dev`.

## Documentation

`DesignSystem.md` (two palettes, the three groups, the contrast table, D7 reversed), `Frontend.md` (the theme
mechanism), `Pages.md` (D7 → *System · Light · Dark*, Settings → Appearance, the footer switch), `Components.md`
(`ThemeSwitch`, `ThemeProvider`).

## Out of scope

Saving the choice on the account; syncing open tabs live; a light OG image; theming card art; Linear status changes.
