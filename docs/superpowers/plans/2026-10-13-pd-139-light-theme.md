# PD-139 Light Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A light theme beside the dark one, chosen as System · Light · Dark in Settings, the account menu and the public footer, rendered right on the first byte with no flash.

**Architecture:** A `theme` cookie (absent = System) is read by the root layout, which sets `data-theme` on `<html>` for an explicit choice. `globals.css` keeps the dark tokens as the default and declares the light ones once inside a Tailwind `@variant light`, whose custom variant matches `[data-theme=light]` or, with no explicit dark, `prefers-color-scheme: light`. A small `ThemeProvider` replaces `next-themes` for the switches and the Toaster.

**Tech Stack:** Next 16.3.5 (App Router, `cookies()`), React 19.2, Tailwind 4 (`@custom-variant`, `@variant`), sonner.

**Spec:** `docs/superpowers/specs/2026-10-12-pd-139-light-theme-design.md`

## Global Constraints

- No automated tests in v1; nothing test-like is committed. Gates: `pnpm --filter @pokedrop/web typecheck`; `pnpm exec eslint <touched folders> --max-warnings=0`; `pnpm exec prettier --check <touched files>`. Behaviour is measured with `curl`, a contrast script and headless Chrome over CDP in the session scratchpad (`cdp.mjs`), and Lighthouse 13 (`.superpowers/sdd/<plan>/lh.sh`-style script), and recorded in `docs/`.
- Read `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md` before Task 1.
- Cookie: name `theme`, values `light` | `dark`, `Path=/`, `Max-Age=31536000`, `SameSite=Lax`; System = no cookie; any other value is System.
- `data-theme` on `<html>`: `light`, `dark`, or absent (System). The dark tokens are the default; light applies when `data-theme="light"`, or when there is no `data-theme="dark"` and `prefers-color-scheme: light`.
- Contrast thresholds: text tokens ≥ 4.5:1 on `--bg`, `--surface`, `--surface2` in each theme; `--on-*` on its fill ≥ 4.5:1; `--pri` (icons, focus ring) ≥ 3:1. Borders are decorative in both themes.
- Art tokens (`--e-*`, `--card-face-end`, `--card-back`, `--booster-*`, `--art-rare`, `--on-art`, `--art-scrim`) have the same value in both themes. The OG image stays dark.
- The light values are the spec's *Palette* table, verbatim. The dark `--ink-darkness` is `#8c93a3` and `--ink-fighting` `#d4804f`; every other dark `--ink-<type>` equals `var(--e-<type>)`.
- Removing `next-themes` with `pnpm remove` may prune other packages' store entries (PD-138 lost `better-auth` that way): run `pnpm install --frozen-lockfile` after it and confirm `apps/api/node_modules/better-auth/package.json` exists before restarting the API.
- Commits on `dev`, header `[PD-139]: …` ≤ 72 characters, lowercase, body ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push. Comments only where a tidy-up would silently break something. Python edit scripts open files with `newline=''`.
- Servers: `preview_start` names `api` (4000) and `web` (3000); subagents never start or stop servers.

## Review Focus

1. **A stale or malformed cookie** (`theme=blue`, an empty value, a value with spaces) must render System, never a broken `data-theme`. Pinned in Task 1 (`parseTheme`), measured in Task 1, Step 7 (curl with `theme=blue`).
2. **Switching under System when the OS changes** (light ⇄ dark while the page is open): the page and the Toaster follow without a reload. Pinned in Task 1 (`useSyncExternalStore` on the media query), measured in Task 4, Step 3 (CDP `Emulation.setEmulatedMedia` flipped live).
3. **Dark-only leftovers in the light theme**: a component that hard-codes a dark surface or relies on a dark-tuned shadow becomes a dark block or vanishes. Pinned in Task 2 (no raw colours, `--color-white/black` removed from `@theme`), measured in Task 5 (the screenshot pass over every page).
4. **Hydration with an explicit cookie vs System**: the server renders `preference` from the cookie and `resolved` as `dark` for System; the client must not flip markup during hydration. Pinned in Task 1 (server snapshot `dark`, no markup depends on `resolved` except the Toaster prop), measured in Task 4 (no hydration warning in any of the six cases).
5. **Keyboard use of the switch**: arrow keys move between System, Light and Dark and apply each; the footer's icon-only switch announces its options. Pinned in Task 3 (native radios with labels), measured in Task 3, Step 7.

---

### Task 1: The theme mechanism

**Files:**
- Create: `apps/web/lib/theme/theme.ts`
- Create: `apps/web/lib/theme/theme-provider.tsx`
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/providers.tsx`
- Modify: `apps/web/components/ui/sonner.tsx`
- Modify: `apps/web/app/globals.css` (the `@custom-variant dark` line; a new `@custom-variant light`; a `color-scheme: light` light block; the switching rule)
- Modify: `apps/web/package.json`, `pnpm-lock.yaml` (remove `next-themes`)

**Interfaces:**
- Produces:
  ```ts
  // lib/theme/theme.ts (no 'use client'; imported by the root layout and the provider)
  export type ThemePreference = 'system' | 'light' | 'dark';
  export type ResolvedTheme = 'light' | 'dark';
  export const THEME_COOKIE = 'theme';
  export function parseTheme(value: string | undefined): ThemePreference; // 'light' | 'dark' else 'system'
  export function themeAttribute(preference: ThemePreference): 'light' | 'dark' | undefined;

  // lib/theme/theme-provider.tsx ('use client')
  export function ThemeProvider(props: { initial: ThemePreference; children: ReactNode }): JSX.Element;
  export function useTheme(): {
    preference: ThemePreference;
    resolved: ResolvedTheme;
    setPreference(next: ThemePreference): void;
  };
  ```

- [ ] **Step 1: `theme.ts`**

```ts
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_COOKIE = 'theme';

/** Anything but an explicit light or dark is System, the default. */
export function parseTheme(value: string | undefined): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function themeAttribute(preference: ThemePreference): 'light' | 'dark' | undefined {
  return preference === 'system' ? undefined : preference;
}
```

- [ ] **Step 2: `theme-provider.tsx`**

```tsx
'use client';

import { createContext, type ReactNode, use, useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { THEME_COOKIE, type ResolvedTheme, type ThemePreference, themeAttribute } from './theme';

const LIGHT = '(prefers-color-scheme: light)';
const YEAR = 60 * 60 * 24 * 365;

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference(next: ThemePreference): void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const subscribe = (change: () => void) => {
  const list = matchMedia(LIGHT);
  list.addEventListener('change', change);
  return () => list.removeEventListener('change', change);
};

function writeCookie(preference: ThemePreference) {
  document.cookie =
    preference === 'system'
      ? `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
      : `${THEME_COOKIE}=${preference}; Path=/; Max-Age=${YEAR}; SameSite=Lax`;
}

export function ThemeProvider({ initial, children }: { initial: ThemePreference; children: ReactNode }) {
  const [preference, setState] = useState(initial);
  // The server cannot see the OS: it renders 'dark', and only the Toaster reads this.
  const osLight = useSyncExternalStore(subscribe, () => matchMedia(LIGHT).matches, () => false);
  const resolved: ResolvedTheme = preference === 'system' ? (osLight ? 'light' : 'dark') : preference;

  const setPreference = useCallback((next: ThemePreference) => {
    const root = document.documentElement;
    // One frame without transitions, so every colour switches at once instead of fading.
    root.dataset.themeSwitching = '';
    const attribute = themeAttribute(next);
    if (attribute) root.dataset.theme = attribute;
    else delete root.dataset.theme;
    writeCookie(next);
    setState(next);
    requestAnimationFrame(() => requestAnimationFrame(() => delete root.dataset.themeSwitching));
  }, []);

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const value = use(ThemeContext);
  if (!value) throw new Error('useTheme outside ThemeProvider');
  return value;
}
```

- [ ] **Step 3: Root layout and providers**

`app/layout.tsx` becomes `async`, reads the cookie and passes it down:

```tsx
import { cookies } from 'next/headers';
import { parseTheme, THEME_COOKIE, themeAttribute } from '@/lib/theme/theme';
// …
export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="en"
      data-theme={themeAttribute(theme)}
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-dvh flex-col antialiased">
        <Providers theme={theme}>{children}</Providers>
      </body>
    </html>
  );
}
```

`app/providers.tsx`: drop `next-themes`; `Providers({ theme, children }: { theme: ThemePreference; children: ReactNode })` wraps everything in `<ThemeProvider initial={theme}>`. `suppressHydrationWarning` stays on `<html>` because `setPreference` edits its attribute.

- [ ] **Step 4: Toaster** — `components/ui/sonner.tsx` reads `const { resolved } = useTheme();` and passes `theme={resolved}` instead of `"dark"`.

- [ ] **Step 5: CSS**

Replace `@custom-variant dark (&:is(.dark *));` with:

```css
/* Light when chosen, or when the OS prefers it and dark was not chosen (docs/Frontend.md). */
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
```

At the end of the `:root` block, before its closing brace:

```css
  @variant light {
    color-scheme: light;
  }
```

(Task 2 fills it.) After the reduced-motion block:

```css
/* ThemeProvider sets this for one frame while the theme changes. */
:root[data-theme-switching] *,
:root[data-theme-switching] *::before,
:root[data-theme-switching] *::after {
  transition: none !important;
}
```

- [ ] **Step 6: Remove `next-themes`** — `pnpm --filter @pokedrop/web remove next-themes`, then `pnpm install --frozen-lockfile`, then `ls apps/api/node_modules/better-auth/package.json` (must exist). `grep -rn next-themes apps/web --include=*.ts* -l` → nothing.

- [ ] **Step 7: Gate and measure**

Typecheck, eslint `apps/web/lib/theme apps/web/app apps/web/components/ui`, prettier. `pnpm --filter @pokedrop/web build` and inspect the compiled CSS (`grep -o "prefers-color-scheme: *light[^}]*" .next/static/chunks/*.css | head`, and `grep -o '\[data-theme=light\][^{]*' …`): both branches of the variant exist and wrap `color-scheme:light` for `:root`. If Tailwind emits a selector that does not match `:root` itself (e.g. only descendants), change the variant to `&:where([data-theme='light']) { @slot; }` plus the media branch `&:where(:not([data-theme='dark'])) { @slot; }` and re-check — record the form that works as a ledger `Ruling:`. Then:

```bash
curl -s -H "Cookie: theme=light" localhost:3000/sets | grep -o '<html[^>]*>'
curl -s -H "Cookie: theme=dark" localhost:3000/sets | grep -o '<html[^>]*>'
curl -s localhost:3000/sets | grep -o '<html[^>]*>'
curl -s -H "Cookie: theme=blue" localhost:3000/sets | grep -o '<html[^>]*>'
```

Expected: `data-theme="light"`, `data-theme="dark"`, no attribute, no attribute. In headless Chrome: `getComputedStyle(document.documentElement).colorScheme` is `light` with the light cookie, `dark` with the dark one, and without a cookie follows `Emulation.setEmulatedMedia` `prefers-color-scheme`.

- [ ] **Step 8: Commit** — `[PD-139]: render the chosen theme from a cookie, drop next-themes`

---

### Task 2: The light palette, ink and art tokens

**Files:**
- Modify: `apps/web/app/globals.css` (the light block; `--ink-*`; `--art-rare`, `--on-art`, `--art-scrim`; `@theme` mappings)
- Modify: `apps/web/components/cards/card-art.tsx:41-49`, `card-tile.tsx:66,73`, `reveal-card.tsx:65,69,71,90`
- Modify: `apps/web/components/decks/builder/pool-tile.tsx:64`, `apps/web/components/trades/composer/card-picker-dialog.tsx:46`
- Modify: `apps/web/components/ui/toggle.tsx:56`
- Modify: `apps/web/components/landing/hero-card-stage.tsx` (the `border-white/20`)
- Modify: `apps/web/components/landing/three/pack-showcase.ts` (`token('--c-rare')` → `token('--art-rare')`)
- Create (scratchpad, not committed): `contrast.mjs`

**Interfaces:**
- Consumes: the `@variant light` block from Task 1.
- Produces: utilities `text-on-art`, `bg-art-scrim`, `border-on-art`; `text-/bg-energy-*` now on `--ink-*`; `--art-rare`.

- [ ] **Step 1: Art and ink tokens (both themes)**

In `:root` after `--e-colorless`:

```css
  /* Ink: an energy colour used as text or a UI fill. The art above stays the same in both themes. */
  --ink-fire: var(--e-fire);
  --ink-water: var(--e-water);
  --ink-grass: var(--e-grass);
  --ink-lightning: var(--e-lightning);
  --ink-psychic: var(--e-psychic);
  --ink-fighting: #d4804f;
  --ink-darkness: #8c93a3;
  --ink-metal: var(--e-metal);
  --ink-dragon: var(--e-dragon);
  --ink-fairy: var(--e-fairy);
  --ink-colorless: var(--e-colorless);
```

after `--booster-sheen`:

```css
  --art-rare: #4c8dff;
  --on-art: #fff;
  --art-scrim: #000;
```

In `@theme inline`: each `--color-energy-<type>: var(--e-<type>)` → `var(--ink-<type>)`; add `--color-on-art: var(--on-art);` and `--color-art-scrim: var(--art-scrim);`; remove `--color-white: #fff;` and `--color-black: #000;`.

- [ ] **Step 2: The light block** — inside `@variant light { … }` after `color-scheme: light;`, every value of the spec's *Palette* table, written out:

```css
    --bg: #f5f6f8;
    --surface: #ffffff;
    --surface2: #eef0f3;
    --elev: #ffffff;
    --tx: #12141a;
    --mut: #4f5664;
    --faint: #626977;
    --bd: rgba(18, 20, 26, 0.1);
    --bd2: rgba(18, 20, 26, 0.16);

    --pri: #2160e0;
    --pri-hover: #1d56cf;
    --pri-strong: #1d56cf;
    --pri-strong-hover: #1849b3;
    --pri-dim: rgba(33, 96, 224, 0.1);
    --on-pri: #fff;
    --gold: #a05a00;
    --gold-dim: rgba(160, 90, 0, 0.1);
    --on-gold: #fff;
    --grn: #057a52;
    --on-grn: #fff;
    --red: #c82e2c;
    --red-strong: #b42318;
    --red-dim: rgba(200, 46, 44, 0.1);
    --on-red: #fff;

    --c-com: #5f6673;
    --c-com-tint: rgba(95, 102, 115, 0.1);
    --c-com-border: rgba(95, 102, 115, 0.28);
    --c-unc: #157b3a;
    --c-unc-tint: rgba(21, 123, 58, 0.1);
    --c-unc-border: rgba(21, 123, 58, 0.28);
    --c-rare: #2160e0;
    --c-rare-tint: rgba(33, 96, 224, 0.1);
    --c-rare-border: rgba(33, 96, 224, 0.28);
    --c-ultra: #7c3aed;
    --c-ultra-tint: rgba(124, 58, 237, 0.1);
    --c-ultra-border: rgba(124, 58, 237, 0.28);
    --c-ultra-edge: rgba(124, 58, 237, 0.4);
    --c-ultra-glow: 0 0 18px rgba(124, 58, 237, 0.18);
    --c-secret: #a05a00;
    --c-secret-tint: rgba(160, 90, 0, 0.1);
    --c-secret-border: rgba(160, 90, 0, 0.28);
    --c-secret-edge: rgba(160, 90, 0, 0.4);
    --c-secret-glow: 0 0 18px rgba(160, 90, 0, 0.18);

    --ink-fire: #bc411b;
    --ink-water: #1d6db8;
    --ink-grass: #2a7a33;
    --ink-lightning: #856600;
    --ink-psychic: #8d3fb0;
    --ink-fighting: #a14f22;
    --ink-darkness: #4a4f5d;
    --ink-metal: #5b6577;
    --ink-dragon: #896611;
    --ink-fairy: #b1417b;
    --ink-colorless: #5f6673;

    --elevation-sm: 0 4px 14px rgba(18, 20, 26, 0.1);
    --elevation-md: 0 16px 34px rgba(18, 20, 26, 0.12);
    --elevation-lg: 0 40px 90px rgba(18, 20, 26, 0.16);
    --glow-pri: 0 8px 24px rgba(33, 96, 224, 0.25);

    --scrim: rgba(15, 18, 25, 0.45);
    --bar: rgba(245, 246, 248, 0.85);
    --skeleton-base: #e6e8ec;
    --skeleton-highlight: #f2f3f6;
    --backdrop: radial-gradient(1000px 500px at 85% -10%, rgba(33, 96, 224, 0.06), transparent 60%);
```

- [ ] **Step 3: Raw colours to art tokens**

`text-white` → `text-on-art` (and `/90`, `/75`, `/55` kept as modifiers); `bg-black/50`, `bg-black/40` → `bg-art-scrim/50`, `/40`; `border-white/15`, `/10`, `/20` → `border-on-art/15`, `/10`, `/20`; in `toggle.tsx` `data-[state=checked]:bg-white` → `data-[state=checked]:bg-on-pri`. In `pack-showcase.ts` `token('--c-rare')` → `token('--art-rare')`. Then:

```bash
grep -rnE "(bg|text|border|from|via|to|ring|shadow|fill|stroke|outline)-(white|black)" apps/web/components apps/web/app --include=*.tsx
grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(" apps/web/components apps/web/app apps/web/lib --include=*.tsx --include=*.ts | grep -v "opengraph\|app/(dev)"
```

Expected: nothing from the first; from the second only the 3D card-back literals in `pack-showcase.ts` (commented as mirroring `--card-back`).

- [ ] **Step 4: Contrast script** — scratchpad `contrast.mjs`: parse `globals.css`'s `:root` (dark) and the `@variant light` block (light) for the tokens named in Global Constraints, resolve `var()` one level, and check every threshold pair (text tokens `--tx --mut --faint --pri --gold --grn --red --c-com --c-unc --c-rare --c-ultra --c-secret --ink-*` on `--bg --surface --surface2`; `--on-pri` on `--pri-strong`, `--on-red` on `--red-strong`, `--on-gold` on `--gold`, `--on-grn` on `--grn`; `--pri` ≥ 3 on all three). Print a table; exit 1 on any failure. Run it. Expected: exit 0. Keep its output for `DesignSystem.md`.

- [ ] **Step 5: Gate and look** — typecheck, eslint `apps/web/components apps/web/app`, prettier. Headless Chrome with `theme=light`: `/`, `/cards`, `/sets`, the dev gallery `/dev/components` at 1440 — screenshot each and look at them yourself: light surfaces, readable text, card art unchanged, no dark blocks.

- [ ] **Step 6: Commit** — `[PD-139]: add the light palette, ink and art tokens`

---

### Task 3: The switches

**Files:**
- Create: `apps/web/components/shell/theme-switch.tsx`
- Create: `apps/web/components/settings/appearance-settings.tsx`
- Modify: `apps/web/components/settings/settings-page.tsx`
- Modify: `apps/web/components/shell/topbar-controls.tsx` (`AvatarMenu`)
- Modify: `apps/web/components/shell/site-footer.tsx`

**Interfaces:**
- Consumes: `useTheme()`, `ThemePreference` (Task 1).
- Produces: `ThemeSwitch({ size }: { size: 'labelled' | 'icon' })`, `AppearanceSettings()`.

- [ ] **Step 1: `ThemeSwitch`**

```tsx
'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useId } from 'react';
import { useTheme } from '@/lib/theme/theme-provider';
import type { ThemePreference } from '@/lib/theme/theme';
import { cn } from '@/lib/utils';

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

export function ThemeSwitch({ size }: { size: 'labelled' | 'icon' }) {
  const { preference, setPreference } = useTheme();
  const name = useId();
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex gap-1 rounded-control border border-bd bg-surface-2 p-1">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <label
          key={value}
          className={cn(
            'relative flex cursor-pointer items-center gap-2 rounded-[8px] text-small font-semibold text-mut transition-colors has-checked:bg-surface has-checked:text-tx has-checked:shadow-sm has-focus-visible:ring-2 has-focus-visible:ring-ring',
            size === 'icon' ? 'size-8 justify-center' : 'h-8 px-3',
          )}
        >
          <input
            type="radio"
            name={name}
            value={value}
            checked={preference === value}
            onChange={() => setPreference(value)}
            className="sr-only"
          />
          <Icon aria-hidden className="size-4" />
          <span className={size === 'icon' ? 'sr-only' : undefined}>{label}</span>
        </label>
      ))}
    </div>
  );
}
```

If eslint refuses `rounded-[8px]`, use the nearest radius token (`rounded-sm`, 6 px).

- [ ] **Step 2: Settings** — `appearance-settings.tsx`:

```tsx
'use client';

import { ThemeSwitch } from '@/components/shell/theme-switch';
import { SettingsSection } from './settings-section';

export function AppearanceSettings() {
  return (
    <SettingsSection
      id="appearance"
      title="Appearance"
      description="Applies to this device. System follows your operating system."
    >
      <ThemeSwitch size="labelled" />
    </SettingsSection>
  );
}
```

In `settings-page.tsx`: delete the D7 comment, render `<AppearanceSettings />` first in the column, and change the header description to *Appearance, your profile, what visitors see, your password and where you’re signed in.*

- [ ] **Step 3: Account menu** — in `AvatarMenu`, before the separator above *Sign out*:

```tsx
<DropdownMenuSeparator />
<DropdownMenuLabel className="text-caption text-faint uppercase">Theme</DropdownMenuLabel>
<DropdownMenuRadioGroup
  value={preference}
  onValueChange={(value) => setPreference(parseTheme(value))}
>
  <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
  <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
  <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
</DropdownMenuRadioGroup>
```

with `const { preference, setPreference } = useTheme();` at the top of the component (before the early `return null`, hooks first) and the imports.

- [ ] **Step 4: Footer** — `site-footer.tsx` stays a Server Component; its bottom row renders `<ThemeSwitch size="icon" />` (a client island) between the disclaimer and `©`, wrapped so the row still wraps at 375.

- [ ] **Step 5: Gate** — typecheck, eslint `apps/web/components`, prettier.

- [ ] **Step 6: Measure switching** (headless Chrome, signed in with the scratchpad jar): click Light in Settings → `document.documentElement.dataset.theme === 'light'`, `document.cookie` has `theme=light`, `body` background `rgb(245, 246, 248)`; reload → still light; open the account menu → *Light* is checked; choose System → no `data-theme`, no `theme` cookie; the footer's switch shows the same choice; the Toaster's root (`[data-sonner-toaster]`) has `data-sonner-theme` equal to the resolved theme after each change (no toast needs to fire).

- [ ] **Step 7: Keyboard** — Tab to the footer switch, arrow right twice: the theme goes System → Light → Dark and each step applies; the focused option shows a ring; screen-reader names are *System*, *Light*, *Dark* (read `aria` via `Accessibility.getFullAXTree` or the inputs' labels).

- [ ] **Step 8: Commit** — `[PD-139]: add the theme switch to settings, the account menu and footer`

---

### Task 4: No flash, live OS changes and Lighthouse

**Files:** none expected; findings may touch Task 1–3 files.

- [ ] **Step 1: First byte** — the four `curl`s from Task 1, Step 7, again.
- [ ] **Step 2: First frame, six cases** — scratchpad CDP job: `Network.emulateNetworkConditions` (Slow 4G: 400 ms latency, 500 kbit/s down), `Emulation.setEmulatedMedia` `prefers-color-scheme` light or dark, cookie none / light / dark; `Page.startScreencast` before `Page.navigate`, keep the first frame, and read `getComputedStyle(document.body).backgroundColor` at `DOMContentLoaded`. Expected per case: (none, light) light; (none, dark) dark; (light, *) light; (dark, *) dark. The first frame's top-left pixel matches the expected `--bg`. No hydration warning in the console.
- [ ] **Step 3: Live OS change** — no cookie, page open, flip `prefers-color-scheme` light → dark → light: `body` background follows each time without a reload, and the Toaster's `data-sonner-theme` follows.
- [ ] **Step 4: Lighthouse** — on `/` against `next build && next start` (PD-138's `lh.sh`, copied into this plan's workspace), no cookie, so the theme is System. First confirm which scheme Lighthouse's headless Chrome reports (a one-off CDP check of `matchMedia('(prefers-color-scheme: light)').matches` in `--headless=new`); run it once as is and once with `--chrome-flags="--headless=new --force-dark-mode"`, so both themes are measured, and record which run was which. Expected in both: accessibility 100 with no `color-contrast` failure; performance not below PD-138's (mobile median ≥ 90, desktop ≥ 97).
- [ ] **Step 5: Commit** fixes if any — `[PD-139]: fix what the flash and contrast checks showed`.

---

### Task 5: Screenshot pass  *(subagent: general-purpose, foreground)*

**Brief** (`pd139-shots-brief.md` in the plan workspace): the same rules as PD-138's Task 7 brief (no code changes, no commits, never start or stop servers, the scratchpad `cdp.mjs`, `cookies.json`, shots under `<workspace>/shots/`). The admin pass uses the test account promoted with `update users set role='ADMIN' where email like 'pd138-%@pokedrop.test'` — **the main session runs the promotion before dispatch and the demotion after the subagent returns**; the subagent never touches the database. Pages: every route in `docs/InformationArchitecture.md` reachable for that role (list them in the brief from the build's route table: `/`, `/cards`, `/cards/base1-4`, `/sets`, `/profile/<test user id>`, `/sign-in`, `/register`, `/forgot-password`, `/dashboard`, `/packs`, `/packs/history`, `/inventory`, `/decks`, `/decks/<a deck id>`, `/trades`, `/trades/new`, `/notifications`, `/wallet`, `/settings`, `/admin`, `/admin/packs`, `/admin/sync`, `/admin/users`, `/admin/trades`, `/admin/audit`, `/dev/components`); the pack reveal through `/packs/open` only if the test account has coins (it has 1,000; one opening costs a template's price — allowed). Light theme (`theme=light` cookie) at 1440 and 375 for all; dark theme at 1440 for `/`, `/cards`, `/decks/<id>`, `/packs` reveal, `/trades/new`. Report per view: unreadable text, dark blocks in light, invisible focus, broken art, console errors.

- [ ] **Step 1:** Promote, dispatch, wait, demote; look at every screenshot the report names.
- [ ] **Step 2:** Fix what it found; re-shoot the affected views yourself.
- [ ] **Step 3: Commit** — `[PD-139]: fix what the light theme screenshots showed` (skip if nothing changed).

---

### Task 6: Documentation

**Files:** `docs/DesignSystem.md`, `docs/Frontend.md`, `docs/Pages.md`, `docs/Components.md`

- [ ] **Step 1:** `DesignSystem.md` §1: *two palettes* — the three groups, the light values (the spec's table), the contrast script's table for both themes, the dark ink fixes (darkness 2.4 → 6.4/5.9/5.4, fighting 4.30 → 5.55 on `surface2`); remove any *dark-only* wording.
- [ ] **Step 2:** `Frontend.md`: a *Theme* section — the cookie, the root layout, the `light` variant and its two branches, `ThemeProvider`/`useTheme`, the switching frame, the Toaster, and what stays dark (OG image, art).
- [ ] **Step 3:** `Pages.md`: D7's row → *Settings has an Appearance section: System · Light · Dark, per device (PD-139); the account menu and the footer switch it too*; the *Account settings* section gains Appearance; the landing/footer section mentions the footer switch; *Measured* from Tasks 1–5.
- [ ] **Step 4:** `Components.md`: `ThemeSwitch` (sizes, radios, where used), `ThemeProvider`.
- [ ] **Step 5:** prettier; **Commit** — `[PD-139]: document the light theme, the switch and what was measured`

---

### Task 7: Final review

- [ ] **Step 1:** One fresh Opus reviewer over `56bfcda..HEAD` with the review-package script, the spec, this plan, the Review Focus verbatim and the ledger's `Ruling:` lines.
- [ ] **Step 2:** Re-grade by effect; for each Critical/Important: a scratchpad reproduction that fails first, the fix, the reproduction passing, a commit `[PD-139]: fix …`.
- [ ] **Step 3:** Minors to the ledger as deferred; final message: what shipped, *Rulings I made*, *Deferred minors*, what was not verified.
