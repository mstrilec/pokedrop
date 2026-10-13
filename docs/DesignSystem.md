# Design System

> The visual foundation for PokéDex TCG — extracted from `design/Design System.dc.html` and `design/CardTile.dc.html`.
> This is the **source of truth** for CSS variables / Tailwind theme tokens. Component contracts live in [ComponentSpecs.md](ComponentSpecs.md).

**Language:** A dark-first, desktop-first system with a light theme beside it (PD-139: System · Light · Dark) for a premium collectible-card experience. Electric-blue accents, gold economy cues, and a full rarity spectrum — built on Geist with a strict 4px rhythm.

---

## 1. Color

### Surfaces & text (neutrals)

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#0a0b0e` | Canvas (page background) |
| `--surface` | `#14161c` | Default panel / card surface |
| `--surface2` | `#1b1e26` | Raised surface, inputs, row hover |
| `--elev` | `#22262f` | Elevated (menus, hovered secondary) |
| `--tx` | `#eef0f4` | Primary text |
| `--mut` | `#969cab` | Muted / secondary text |
| `--faint` | `#858a96` | Faint / tertiary text, captions (was `#636876`, 3.24 : 1 on `--surface`; now 5.38 : 1, PD-100) |
| `--bd` | `rgba(255,255,255,.08)` | Hairline border |
| `--bd2` | `rgba(255,255,255,.13)` | Stronger border / input outline |

Body backdrop uses `radial-gradient(1000px 500px at 85% -10%, rgba(76,141,255,.05), transparent 60%)` over `--bg`.

### Accent & semantic

| Token | Hex | Role | Text-on |
|---|---|---|---|
| `--pri` | `#4c8dff` | Primary action | `#fff` |
| `--pri-dim` | `rgba(76,141,255,.14)` | Primary tint (active nav, badges) | — |
| `--pri-strong` | `#3f74d2` | Primary button fill: white text at 4.53 : 1 (`#4c8dff` gives 3.2); hover `--pri-strong-hover` `#3a6cc4` | `#fff` |
| `--gold` | `#f2b23c` | Economy / currency | `#1a1204` |
| `--gold-dim` | `rgba(242,178,60,.14)` | Economy tint | — |
| `--grn` | `#34d399` | Success / confirm | `#04120b` |
| `--red` | `#f05151` | Danger / destructive text and accents (was `#ef4444`; 4.51 : 1 on `--red-dim`, PD-100) | — |
| `--red-strong` | `#d73d3d` | Red fills that carry text (count badges) | `#fff` (4.54 : 1) |
| `--red-dim` | `rgba(239,68,68,.14)` | Danger tint | — |

### Rarity ramp

Each rarity has a solid color, a glow (for high-rarity emphasis), a ~14% tint (chip background), and a 30% border.

| Rarity | Token | Hex | Tint | Border |
|---|---|---|---|---|
| Common | `--c-com` | `#9aa1ad` | `rgba(154,161,173,.14)` | `rgba(154,161,173,.3)` |
| Uncommon | `--c-unc` | `#4fc98a` | `rgba(79,201,138,.14)` | `rgba(79,201,138,.3)` |
| Rare | `--c-rare` | `#4c8dff` | `rgba(76,141,255,.14)` | `rgba(76,141,255,.3)` |
| Ultra Rare | `--c-ultra` | `#b06cf0` | `rgba(176,108,240,.14)` | `rgba(176,108,240,.3)` |
| Secret Rare | `--c-secret` | `#f2b23c` | `rgba(242,178,60,.14)` | `rgba(242,178,60,.3)` |

**High-rarity emphasis:** Ultra Rare and Secret Rare cards get a rarity-colored border at `66` alpha plus `box-shadow: 0 0 22px <color>22` glow.

### Energy types

| Type | Hex | Lucide icon |
|---|---|---|
| Fire | `#ef6a43` | `flame` |
| Water | `#4aa6ef` | `droplet` |
| Grass | `#5ec269` | `leaf` |
| Lightning | `#f4c73a` | `zap` |
| Psychic | `#b06bcf` | `eye` |
| Fighting | `#c26a3a` | `hand-fist` |
| Darkness | `#4a4f5d` | `moon` |
| Metal | `#8f9aad` | `cog` |
| Dragon | `#cf9b2e` | `flame-kindling` |
| Fairy | `#e987bd` | `sparkles` |
| Colorless | `#b9bec9` | `circle` |

Card face gradient: `linear-gradient(155deg, <energyColor>, #0d0f14)`.

Booster foil (`bg-booster`, PD-136): `linear-gradient(165deg, <energyColor> 10%, #0d0f14 95%)`, crimped top and bottom by the `booster-crimp` mask. On it: `--booster-ink` `#fff` (text and icons), `--booster-shade` `rgba(0, 0, 0, 0.28)` (the seal bands, the tag), `--booster-sheen` `rgba(255, 255, 255, 0.5)` (the sweep).

**Accessibility:** text sits at AA+ contrast on the near-black canvas. Color is never the sole carrier of meaning — rarity, status, and ownership are always paired with text or an icon.

---

### Two palettes (PD-139)

The values above are the **dark** palette, the default. The **light** palette redefines the same tokens inside `@variant light` in `globals.css` (Frontend.md *Theme*). Tokens fall into three groups:

| Group | Tokens | Light theme |
| --- | --- | --- |
| UI neutrals | `--bg` `--surface` `--surface2` `--elev` `--tx` `--mut` `--faint` `--bd` `--bd2` `--bar` `--scrim` `--skeleton-*` `--backdrop` `--elevation-*` `--glow-pri` | own values: `#f5f6f8` page, white surfaces, `#eef0f3` raised, `#12141a` text |
| Ink: colour as text, icon or UI fill | `--pri*` `--gold*` `--grn` `--red*` `--on-*` `--c-*` and `--ink-<type>` (the `text-/bg-energy-*` utilities) | darkened until text passes on every ground **and on its own tint** |
| Art: the same in both themes | `--e-*` (card faces, boosters, 3D), `--card-face-end` `--card-back` `--booster-*` `--art-rare` `--on-art` `--art-scrim` | unchanged |

**Energy ink.** `--color-energy-*` point at `--ink-<type>`; card faces and boosters read `var(--e-<type>)` directly, so art never changes with the theme. In dark, `--ink-<type>` equals `--e-<type>` except two that failed as text: `--ink-darkness` `#8c93a3` (the art `#4a4f5d` read 2.4:1) and `--ink-fighting` `#d4804f` (4.30:1 on `surface2`).

**Light values (PD-139):** `--bg #f5f6f8`, `--surface #fff`, `--surface2 #eef0f3`, `--elev #fff`, `--tx #12141a`, `--mut #4f5664`, `--faint #585e6b`, `--bd`/`--bd2` `rgba(18,20,26,.1/.16)`; `--pri #1d55c6`, `--pri-hover`/`--pri-strong` `#1a4cb1`, `--pri-strong-hover #16419a`; `--gold`/`--c-secret` `#8c4f00`, `--grn #046a48`, `--red #af2826`, `--red-strong #b42318`, every `--on-*` white; rarity `--c-com #585f6b`, `--c-unc #126b33`, `--c-rare #1d55c6`, `--c-ultra #7135d8` (tints 0.1, borders 0.28, edges 0.4); ink fire `#a43918`, water `#195fa1`, grass `#256a2d`, lightning `#765a00`, psychic `#853ba6`, fighting `#93481f`, darkness `#4a4f5d`, metal `#565f70`, dragon `#78590f`, fairy `#9a396b`, colorless `#585f6b`; elevations `rgba(18,20,26,.10/.12/.16)`, `--scrim rgba(15,18,25,.45)`, `--bar rgba(245,246,248,.85)`, skeleton `#e6e8ec`/`#f2f3f6`.

**Thresholds**, checked by a script over `globals.css`: every text token ≥ 4.5:1 on `--bg`, `--surface`, `--surface2` in both themes; `--on-*` on its fill ≥ 4.5:1; in light, also every ink on its own tint (`/0.1`, `/0.14`) over `surface`, `surface2` and a `pri-dim` panel — the case the screenshot pass caught (success and selected chips at 4.08–4.44:1 before the light inks were darkened a second time). The dark palette was not reworked: 30 of its chip pairs measure below 4.5 (lowest `--ink-psychic` on its tint inside a primary panel, 3.50), left for a later pass. Borders stay decorative in both themes.

#### Dark

| token | --bg | --surface | --surface2 |
| --- | --- | --- | --- |
| `--tx` #eef0f4 | 17.25 | 15.85 | 14.60 |
| `--mut` #969cab | 7.16 | 6.58 | 6.06 |
| `--faint` #858a96 | 5.69 | 5.23 | 4.82 |
| `--pri` #4c8dff | 6.15 | 5.65 | 5.21 |
| `--gold` #f2b23c | 10.50 | 9.65 | 8.89 |
| `--grn` #34d399 | 10.24 | 9.41 | 8.67 |
| `--red` #f05151 | 5.62 | 5.17 | 4.76 |
| `--c-com` #9aa1ad | 7.57 | 6.95 | 6.41 |
| `--c-unc` #4fc98a | 9.42 | 8.66 | 7.98 |
| `--c-rare` #4c8dff | 6.15 | 5.65 | 5.21 |
| `--c-ultra` #b06cf0 | 5.86 | 5.38 | 4.96 |
| `--c-secret` #f2b23c | 10.50 | 9.65 | 8.89 |
| `--ink-fire` #ef6a43 | 6.38 | 5.87 | 5.41 |
| `--ink-water` #4aa6ef | 7.49 | 6.88 | 6.34 |
| `--ink-grass` #5ec269 | 8.81 | 8.09 | 7.46 |
| `--ink-lightning` #f4c73a | 12.25 | 11.26 | 10.38 |
| `--ink-psychic` #b06bcf | 5.48 | 5.04 | 4.64 |
| `--ink-fighting` #d4804f | 6.56 | 6.03 | 5.55 |
| `--ink-darkness` #8c93a3 | 6.39 | 5.87 | 5.41 |
| `--ink-metal` #8f9aad | 6.93 | 6.37 | 5.87 |
| `--ink-dragon` #cf9b2e | 7.85 | 7.22 | 6.65 |
| `--ink-fairy` #e987bd | 8.12 | 7.46 | 6.88 |
| `--ink-colorless` #b9bec9 | 10.56 | 9.71 | 8.94 |
| `--on-pri` on `--pri-strong` | 4.53 | | |
| `--on-red` on `--red-strong` | 4.54 | | |
| `--on-gold` on `--gold` | 9.90 | | |
| `--on-grn` on `--grn` | 9.96 | | |

#### Light

| token | --bg | --surface | --surface2 |
| --- | --- | --- | --- |
| `--tx` #12141a | 17.02 | 18.41 | 16.12 |
| `--mut` #4f5664 | 6.82 | 7.37 | 6.46 |
| `--faint` #585e6b | 6.02 | 6.50 | 5.70 |
| `--pri` #1d55c6 | 6.13 | 6.63 | 5.81 |
| `--gold` #8c4f00 | 6.01 | 6.49 | 5.69 |
| `--grn` #046a48 | 6.14 | 6.64 | 5.82 |
| `--red` #af2826 | 6.16 | 6.66 | 5.83 |
| `--c-com` #585f6b | 5.95 | 6.43 | 5.64 |
| `--c-unc` #126b33 | 6.11 | 6.61 | 5.79 |
| `--c-rare` #1d55c6 | 6.13 | 6.63 | 5.81 |
| `--c-ultra` #7135d8 | 6.06 | 6.56 | 5.74 |
| `--c-secret` #8c4f00 | 6.01 | 6.49 | 5.69 |
| `--ink-fire` #a43918 | 6.11 | 6.61 | 5.79 |
| `--ink-water` #195fa1 | 6.08 | 6.58 | 5.76 |
| `--ink-grass` #256a2d | 6.11 | 6.61 | 5.79 |
| `--ink-lightning` #765a00 | 6.01 | 6.50 | 5.69 |
| `--ink-psychic` #853ba6 | 6.12 | 6.62 | 5.80 |
| `--ink-fighting` #93481f | 6.09 | 6.59 | 5.77 |
| `--ink-darkness` #4a4f5d | 7.56 | 8.18 | 7.16 |
| `--ink-metal` #565f70 | 5.95 | 6.43 | 5.63 |
| `--ink-dragon` #78590f | 6.00 | 6.49 | 5.69 |
| `--ink-fairy` #9a396b | 6.12 | 6.62 | 5.80 |
| `--ink-colorless` #585f6b | 5.95 | 6.43 | 5.64 |
| `--on-pri` on `--pri-strong` | 7.74 | | |
| `--on-red` on `--red-strong` | 6.57 | | |
| `--on-gold` on `--gold` | 6.49 | | |
| `--on-grn` on `--grn` | 6.64 | | |

On its own tint: lowest light pair 4.57 (`--c-ultra` at 0.14 inside a primary panel); lowest dark pair 3.50 (`--ink-psychic`, deferred).

## 2. Typography

**Geist** for everything; **Geist Mono** for numbers, prices, IDs, and counts. Display sizes carry −0.02 to −0.03em tracking; body stays at 0.

Loaded from Google Fonts: `Geist` (400,500,600,700,800) · `Geist Mono` (400,500,600).

| Role | Size / weight | Tracking | Usage |
|---|---|---|---|
| Display | 52 / 800 | −0.03em | Hero headlines |
| H1 | 28 / 700 | −0.02em | Page titles |
| H2 | 20 / 600 | — | Section headers |
| H3 | 16 / 600 | — | Card / panel headers |
| Body | 14 / 400 | — | Paragraph text (`--mut`) |
| Small | 13 / 500 | — | Secondary labels (`--mut`) |
| Caption | 12 / 600 | +0.06em, uppercase | Overlines, field labels (`--faint`) |
| Mono | 14 / 600 | — | `$84.20 · 1,250 · AE 004/172 · ×6` |

---

## 3. Spacing

A **4px base unit**. Gaps of 8 / 12 / 16 within components; 20 / 24 between sections; 32 for page padding. Every value is a multiple of 4 — the mockups' 34px page padding was rounded to 32 in PD-85.

| Token | px |
|---|---|
| `space-1` | 4 |
| `space-2` | 8 |
| `space-3` | 12 |
| `space-4` | 16 |
| `space-5` | 20 |
| `space-6` | 24 |
| `space-8` | 32 |

---

## 4. Radius

| Name | Radius | Usage |
|---|---|---|
| Chip / pill | `999px` | Badges, chips, dots |
| Small | `6px` | Utility tags, code chips |
| Input / button | `10px` | Buttons, inputs |
| Tile | `13px` | CardTile |
| Card | `16px` | Surface cards, panels |
| Modal | `18px` | Dialogs |

---

## 5. Elevation & glow

| Name | CSS | Usage |
|---|---|---|
| `sm` | `0 4px 14px rgba(0,0,0,.35)` | Buttons, chips |
| `md` | `0 16px 34px rgba(0,0,0,.45)` | Hovered cards |
| `lg` | `0 40px 90px rgba(0,0,0,.6)` | Dialogs |
| `glow` | `0 8px 24px rgba(76,141,255,.4)` | Primary CTA |

Dialog scrim: `rgba(6,7,10,.72)` + 6px blur. Sticky bars (navbar/topbar) use `rgba(10,11,14,.8)` + `backdrop-filter: blur(12px)`.

---

## 6. Icons

**Lucide**, 2px stroke, `currentColor`, optically aligned via `vertical-align: -0.125em`.

| Size | px | Usage |
|---|---|---|
| xs | 12 | Inline chips |
| sm | 14 | Dense rows |
| md | 16 | Buttons |
| lg | 20 | Stat tiles |
| xl | 26 | Empty states |

---

## 7. Motion

- **Hover transitions:** 160–180ms ease. Buttons ~0.16s.
- **Menus open / close:** fade + scale from 96% + an 8px slide away from the trigger, `--menu-in` 180ms in and `--menu-out` 120ms out, on the reveal easing; they grow from Radix's transform origin.
- **Card / tile hover ("lift + glow"):** `translateY(-4px)` + border accent + shadow `md`.
- **Row hover ("row tint"):** background → `--surface2`.
- **Link / icon hover:** color → `--pri`.
- **Reveal flip-in:** `flipIn 0.5s cubic-bezier(.2,.7,.2,1)` with per-card stagger delay.
- **Rare-pull burst:** radial glow + `pulseGlow 2s` behind the tile.
- **Skeleton shimmer:** `shimmer 1.5s ease-in-out infinite` over a `linear-gradient(90deg,#191c24,#262a34,#191c24)`.
- **Spinner:** 2.5px ring, `--pri` top color, `spin 0.8s linear infinite`.
- **Booster opening stages:** sealed (float) → opening (shake + flash) → reveal (card-by-card flip) → summary. See `design/Booster Opening.dc.html`.
- **Landing micro-animations (PD-138):** `coin-drop` 2.6s, `wiggle` 3s, `stack-in` 3.6s, `swap-l`/`swap-r` 3s (the How it works steps), `marquee` 70s linear (the chase cards, from 640 px), `deck-drop` 0.6s (the deck preview), `beat` 5.4s (the escrow beats, staggered 1.8s), all on the reveal easing where they ease. The looping ones have no fill mode, so the reduced-motion rule leaves each element in its own resting style; where the resting style is not the end state (the escrow beats), the component sets it with `motion-reduce:`. `stack-in` animates `transform`, not `translate`, so the cards' translate and rotate utilities still apply.

**All motion must honor `prefers-reduced-motion`** — freeze shimmer, drop the flip, render results instantly.

---

## 8. Buttons (variants)

Radius 10px, 600 weight. Sizes: `sm` 13px / 8–13px pad · `md` 14px / 11–18px pad · `lg` 16px / 14–26px pad.

| Variant | Fill | Text | Note |
|---|---|---|---|
| Primary | `--pri-strong` | `#fff` | Soft blue glow; darkens to `--pri-strong-hover` on hover. `--pri` stays the accent for links, rings and tints (PD-100) |
| Secondary | `--surface2` + `--bd2` border | `--tx` | Border → `--mut`, bg → `--elev` on hover |
| Ghost | transparent | `--mut` | bg → `--surface2`, text → `--tx` on hover |
| Confirm | `--grn` | `#04120b` | 700 weight |
| Destructive | `--red-dim` + red border | `--red` | bg deepens on hover |
| Economy | `--gold` | `#1a1204` | 700 weight |
| Icon | `--surface` + `--bd` | `--tx` | 40×40 square |
| Disabled | opacity `.4`, `not-allowed` | — | |

---

## 9. Loading & empty states

- **Skeletons** mirror the final layout to prevent layout shift; container exposes `aria-busy="true"`, skeleton itself is `aria-hidden`.
- **Spinner** covers indeterminate waits (pack opening, sync) with `role="status"` + label.
- **Empty states** are first-class: soft icon badge (60×60, tinted), a warm one-line prompt, and a single primary action — never a dead end.
