# Design System

> The visual foundation for PokéDex TCG — extracted from `design/Design System.dc.html` and `design/CardTile.dc.html`.
> This is the **source of truth** for CSS variables / Tailwind theme tokens. Component contracts live in [ComponentSpecs.md](ComponentSpecs.md).

**Language:** A dark-first, desktop-first system for a premium collectible-card experience. Electric-blue accents, gold economy cues, and a full rarity spectrum — built on Geist with a strict 4px rhythm.

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
| `--faint` | `#636876` | Faint / tertiary text, captions |
| `--bd` | `rgba(255,255,255,.08)` | Hairline border |
| `--bd2` | `rgba(255,255,255,.13)` | Stronger border / input outline |

Body backdrop uses `radial-gradient(1000px 500px at 85% -10%, rgba(76,141,255,.05), transparent 60%)` over `--bg`.

### Accent & semantic

| Token | Hex | Role | Text-on |
|---|---|---|---|
| `--pri` | `#4c8dff` | Primary action | `#fff` |
| `--pri-dim` | `rgba(76,141,255,.14)` | Primary tint (active nav, badges) | — |
| `--gold` | `#f2b23c` | Economy / currency | `#1a1204` |
| `--gold-dim` | `rgba(242,178,60,.14)` | Economy tint | — |
| `--grn` | `#34d399` | Success / confirm | `#04120b` |
| `--red` | `#ef4444` | Danger / destructive | `#fff` |
| `--red-dim` | `rgba(239,68,68,.14)` | Danger tint | — |

### Rarity ramp

Each rarity has a solid color, a glow (for high-rarity emphasis), a ~14% tint (chip background), and a 30% border.

| Rarity | Token | Hex | Tint | Border |
|---|---|---|---|---|
| Common | `--c-com` | `#9aa1ad` | `rgba(154,161,173,.14)` | `rgba(154,161,173,.3)` |
| Uncommon | `--c-unc` | `#4fc98a` | `rgba(79,201,138,.14)` | `rgba(79,201,138,.3)` |
| Rare | `--c-rare` | `#4c8dff` | `rgba(76,141,255,.14)` | `rgba(76,141,255,.3)` |
| Ultra Rare | `--c-ultra` | `#b06bf0` | `rgba(176,107,240,.14)` | `rgba(176,107,240,.3)` |
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

**Accessibility:** text sits at AA+ contrast on the near-black canvas. Color is never the sole carrier of meaning — rarity, status, and ownership are always paired with text or an icon.

---

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

A **4px base unit**. Gaps of 8 / 12 / 16 within components; 20 / 24 between sections; 34+ for page padding.

| Token | px |
|---|---|
| `space-1` | 4 |
| `space-2` | 8 |
| `space-3` | 12 |
| `space-4` | 16 |
| `space-5` | 20 |
| `space-6` | 24 |
| `space-8` | 34 |

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
- **Card / tile hover ("lift + glow"):** `translateY(-4px)` + border accent + shadow `md`.
- **Row hover ("row tint"):** background → `--surface2`.
- **Link / icon hover:** color → `--pri`.
- **Reveal flip-in:** `flipIn 0.5s cubic-bezier(.2,.7,.2,1)` with per-card stagger delay.
- **Rare-pull burst:** radial glow + `pulseGlow 2s` behind the tile.
- **Skeleton shimmer:** `shimmer 1.5s ease-in-out infinite` over a `linear-gradient(90deg,#191c24,#262a34,#191c24)`.
- **Spinner:** 2.5px ring, `--pri` top color, `spin 0.8s linear infinite`.
- **Booster opening stages:** sealed (float) → opening (shake + flash) → reveal (card-by-card flip) → summary. See `design/Booster Opening.dc.html`.

**All motion must honor `prefers-reduced-motion`** — freeze shimmer, drop the flip, render results instantly.

---

## 8. Buttons (variants)

Radius 10px, 600 weight. Sizes: `sm` 13px / 8–13px pad · `md` 14px / 11–18px pad · `lg` 16px / 14–26px pad.

| Variant | Fill | Text | Note |
|---|---|---|---|
| Primary | `--pri` | `#fff` | Soft blue glow; brightens to `#5d99ff` on hover |
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
