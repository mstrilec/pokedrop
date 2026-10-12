# Prompt for Claude Design — PokéDrop landing page

Paste everything below the line into Claude Design (the project folder is already attached).

---

Design the **landing page** for PokéDrop (`/`), a Pokémon TCG web app where people open booster packs with free in-app coins, collect cards, build legal decks and trade with other collectors. Save it as `design/Landing.dc.html`, the same export format as the other files in `design/`.

## Read first (in the attached project)

- `docs/DesignSystem.md` and `design/Design System.dc.html`: tokens, colour, type, spacing, radius, elevation, motion. **Stay inside them.** A new token is allowed only if you list it at the end under "New tokens".
- `docs/ComponentSpecs.md` and `design/Component Specs.dc.html`: Button, Badge, CardTile, CompletionMeter, StatCard and the rest. Reuse them by name.
- `design/Booster Opening.dc.html`: the pack-opening look (sealed, shake, flash, reveal). The landing's showcase must feel like the same product.
- `design/Pokemon TCG App.dc.html` and `design/CardTile.dc.html`: the app's real look.
- `docs/Pages.md`, section *Landing (PD-101)*: what the current landing does and the rules it follows (true figures only).
- `apps/web/components/packs/booster-pack.tsx` and the *Booster wrapper* section of `docs/Components.md`: a booster is drawn as a foil pouch (crimped edges, set logo, a window of the featured card, the pack name), coloured by the cover card's energy type. Use that look, not a generic box.

## The product, in one line

*Open. Collect. Build. Trade.* Free to play: every new account gets 1,000 coins. No real money, no cash-out. It is a fan project, not affiliated with Nintendo, Creatures, GAME FREAK or The Pokémon Company.

## What this page must do

Tell the whole story of the product in one scroll, look **bright and alive** (richer use of the energy colours and rarity glows, gradients, foil and holo effects) while staying a dark-first design system, and end with a footer. It replaces today's one-screen landing (hero plus four feature cards, no footer).

## Sections (the order is a proposal; settle it as a designer would)

1. **Hero.** The headline, two calls to action (signed out: *Start collecting free* → `/register`, *Sign in*; signed in: *Go to your dashboard*, *Open a pack*), the live figures (cards catalogued, sets, 1,000-coin welcome), and one **hero card** (see Three.js below).
2. **How it works.** Four steps — *Get 1,000 coins → Open packs → Build decks → Trade*. Each with a small illustration or a looping micro-animation.
3. **Pack opening showcase.** A booster that tears open as it scrolls into view and fans out real cards. One line: *Every pack lists its odds before you open it.*
4. **Chase cards.** A slow marquee of the catalog's most valuable cards, each with its current market price. Mark this block as "hidden if the API cannot answer".
5. **Collect every set.** A strip of real set logos (newest and classics) with example completion meters, linking `/sets`.
6. **Deck builder.** A short animated preview: cards dropping into a deck, the validation banner turning green, and the rules it checks (60 cards, max 4 copies, format legality).
7. **Safe trading.** Escrow in three beats — *cards lock → the other side answers → one atomic swap* — and the counter-offer chain.
8. **Live numbers.** Cards catalogued, sets, prices updated in the last day, packs opened. **True figures only.** Mark each figure's data source and "dropped if unavailable".
9. **FAQ.** Is it free? Is it real money (no)? Where do the cards and prices come from? Can I trade with friends?
10. **Final call to action**, then the **footer**.

**Footer** (shown on every public page, so design it as a reusable component): logo and one line; links (Browse cards, Sets, Sign in, Create account; Dashboard when signed in); data credits (pokemontcg.io, TCGdex, PokéAPI, TCGplayer / Cardmarket prices); the fan-project disclaimer above; the year.

## Rules that are not negotiable

- **No invented numbers.** The old mockup's "240K packs opened" and "99.98% safe trades" were fabricated and removed. Use realistic **placeholders clearly labelled** (e.g. `{cards}`), or real values from the project (catalog ≈ 20,000 cards, 176 sets, 1,000 welcome coins).
- **Real card art and set logos** from `images.pokemontcg.io` (e.g. `base1/4_hires.png` Charizard, `base1/2_hires.png` Blastoise, `base1/58_hires.png` Pikachu; logos at `…/<set>/logo.png`). No stock illustrations of Pokémon, no copied official artwork beyond the card scans.
- **Colour is never the only signal**: pair rarity and energy colour with an icon or text.
- **Accessibility**: AA text contrast, visible focus rings, headings in order (one `h1`), every control reachable by keyboard in reading order, FAQ as real disclosure controls.
- **Motion**: scroll-reveal, the hero shine, the marquee, the pack tear and the micro-animations must all **stop under `prefers-reduced-motion: reduce`** and show their end state. Nothing may block interaction. Prefer CSS; use JavaScript only where CSS cannot do it.
- **Performance budget** (the real page must reach Lighthouse 90+ in all four categories on mobile and desktop; mobile is 86 today): images below the fold are lazy and sized, no layout shift, no heavy animation library. Design with this in mind: fewer, larger moments rather than many small ones.
- **Responsive**: show it at **1440, 768 and 375 px** with no horizontal scroll. The marquee and the showcase must adapt, not just shrink.
- **Signed-in state**: the page is also shown to signed-in members inside the app shell. Show how the hero's calls to action change; the rest is identical.

## Three.js — where to use it, and where not

I want to try three.js, **in exactly two places**, and nowhere else:

1. **Hero card.** One Charizard card as a real 3D object: a slight idle float, it **tilts to follow the pointer** (on touch: a gentle auto-sway), with a **holographic foil** look (an iridescent gradient that shifts with the tilt, a moving specular glint, rarity glow behind it). Behind it, the existing floating cards may stay as flat CSS cards for depth.
2. **Pack-opening showcase.** The booster pouch in 3D: it **tears at the top as the section scrolls into view**, the foil peels back, and 5–6 cards **fan out** in an arc with a light sweep. Scroll position drives the animation (scrub), so it works with the mouse wheel and touch and can be reversed.

Everything else (marquee, meters, counters, deck preview, escrow beats, FAQ) is **CSS or SVG, no WebGL**. Extra canvases cost performance and add nothing.

Constraints for the three.js parts, so the real page can ship them:

- **Lazy and optional.** Load three.js with a dynamic import only when its section is near the viewport (or the browser is idle for the hero). It must never be in the first bundle and must never delay LCP.
- **A poster first.** Each 3D element has a **static poster** (a normal image or CSS render of the same moment). The poster is what Lighthouse paints as LCP; the canvas fades in over it when ready.
- **Three fallbacks that look intentional, not broken:** `prefers-reduced-motion` (the poster, or a single still pose), no WebGL / context lost (the poster), and low-power mobile (the poster, or a lighter version: smaller canvas, device pixel ratio capped at 1.5, no post-processing).
- **Lightweight.** Plain three.js with only what it needs: a plane or box geometry, a custom `ShaderMaterial` or `MeshPhysicalMaterial` with iridescence, one or two lights, no post-processing, no physics, no model files. No React Three Fiber in the prototype.
- **One module per 3D element**, self-contained (`<script type="module">`, a clear init/dispose API, pauses when off-screen via `IntersectionObserver`, disposes its resources). I will rebuild the prototype in Next.js, so keep the 3D code easy to lift out.
- Textures are the real card and set images above; use the card's energy colour (Fire) and rarity glow tokens for the light and the glow.

## Tone of the copy

Short, confident, a little playful; talk to collectors. English. No exclamation-mark spam, no fake urgency, no hype about "winning" (there is no money). Examples of the voice: *Rip a pack. See the odds first.* / *Your cards stay yours: trades lock first, then swap in one step.*

## Deliverable

1. `design/Landing.dc.html`: the full page at 1440 px with the 768 and 375 px variants.
2. A short list at the end: **New tokens** (name, value, why), **Components reused** and **new components** (the footer, the step card, the marquee item), and **per-section data source** (which API figure feeds it, or "static").
3. For each of the two three.js elements: the **poster** frame and the states for reduced motion, no WebGL and mobile.

Ask me before inventing anything that is not in the project files.
