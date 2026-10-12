# PD-138 — Landing page: the full story, with a footer

Design, 2026-10-12. Milestone M15 · Polish & Extras.

Ticket: [PD-138](https://linear.app/mstrilec/issue/PD-138). Source design: `design/Landing.dc.html` and
`design/SiteFooter.dc.html` (Claude Design, from `design/Landing.prompt.md`), with two three.js modules the user placed
in `apps/web/lib/modules/`. Builds on the landing (PD-101), the booster wrapper (PD-136: `BoosterPack`, `PackArt`), the
random deck (PD-137), the catalog read API (PD-45), the deck validator (PD-64, PD-65) and trade escrow (PD-68–PD-71).
Reference: `docs/Pages.md` *Landing (PD-101)* · `docs/API.md` *Catalog*, *Trades* · `docs/Components.md`.

---

## What the ticket asks

| Scope item | Where it lands |
| --- | --- |
| One scroll that tells the whole product story, bright and alive, dark-first | [Sections](#sections) |
| A footer on every public page | [Footer and guest header](#footer-and-guest-header) |
| A three.js hero card and a three.js pack-opening showcase, lazy and optional | [3D](#3d) |
| True figures only (PD-101) | [Decisions](#decisions) 1, [Truth corrections](#truth-corrections) |
| Reduced motion, no WebGL and mobile fallbacks that look intentional | [3D](#3d), [Motion](#motion) |
| Lighthouse 90+ in all four categories, mobile and desktop | [Performance](#performance) |
| 1440, 768 and 375 px without horizontal scroll | [Verification](#verification) |

## Decisions

Taken with the user during brainstorming:

1. **No *Live numbers* section and no `GET /stats`.** The hero keeps *Cards catalogued · Sets to complete · Welcome
   coins 1,000*, each dropped on its own when the API cannot answer. The design's *Live numbers* repeated two of those,
   and its two new figures would read small (packs opened at launch) or zero (prices updated in a day, in development).
2. ***How it works* stays as the overview** and stops repeating the large sections: one new sentence per step, and steps
   02–04 link to `#pack-opening`, `#deck-builder` and `#trading`. Step 01 is the only place that explains coins. The
   odds line (*Every pack lists its odds before you open it*) appears once, in the showcase.
3. **The guest header gains *Browse cards · Sets*** on every public page (hidden below `sm`, where the footer carries
   them), and a *Skip to content* link. Signed in, the public layout still renders `AppShell`.
4. **3D only on a desktop with a fine pointer.** Touch, low-power, `saveData`, reduced motion, no WebGL, a failed load
   or a lost context all get the poster. Lighthouse's mobile run emulates `pointer: coarse`, so it never loads three.js.
5. **Price sort in the catalog.** `CardSortSchema` gains `price_desc` and `price_asc`, offered in the `/cards` sort menu
   too; the chase marquee reads `GET /cards?sort=price_desc&pageSize=12`.
6. **Server Components with client islands.** Every section renders on the server; only the parts with behaviour are
   client components. The 3D modules become TypeScript and import `three` from npm. Rejected: porting the prototype as
   one client component (the whole page in the bundle, React state per scroll frame), and shipping the modules as they
   are (they import three.js from unpkg at run time).

## Truth corrections

The design is followed except where it disagrees with the project. Each of these was checked against code, docs or
the development database on 2026-10-12.

| Where | The design says | The project does | The page says |
| --- | --- | --- | --- |
| Safe trading, beat 1 | the cards **and coins** you offer are held in escrow | only offered cards lock (`lockedQuantity`); coins are checked at proposal and at settlement (`API.md` *Trades*) | *The cards you offer are held while the offer is open, so they can't be promised twice. Coins are checked when you offer and again when the swap settles.* |
| How it works, step 04 | **both sides** stay locked | only the offering side locks | the new step 04 sentence (below) |
| Safe trading, beat 2 | a counter replaces the offer, **your lock follows it** | the initiator's lock is released and the counter's taken (`API.md:761`) | *They accept, decline or counter. A counter replaces your offer: your cards unlock and theirs lock instead. An offer left unanswered expires after 7 days.* (`TRADE_EXPIRY_DAYS`, default 7) |
| Counter chain, step 2 | *The first offer closes, the counter takes its place.* | as above | *They ask for coins on top. Your offer closes, your Blastoise unlocks and their Venusaur locks.* |
| Deck builder banner | *Legal in Unlimited · ready to play*, three rules | `DeckValidationBanner`: *Deck is legal* / *n rules failing*, four rules including Ownership | the real `DeckValidationBanner` fed a static `DeckValidation` |
| Showcase fan | six cards, two *Rare* holos | Charizard and Blastoise are *Rare Holo*; the seed template *Base Set Booster Pack* is 4 Common + 3 Uncommon + 1 Rare/Rare Holo, so two holos cannot share a pack | eight cards a real pack can hold: Pikachu `base1-58`, Bulbasaur `base1-44`, Squirtle `base1-63`, Charmander `base1-46` (Common); Charmeleon `base1-24`, Ivysaur `base1-30`, Wartortle `base1-42` (Uncommon); Charizard `base1-4` (Rare Holo) |
| Chase cards | Base Set holos, rarity fixed at *Rare*, *Base Set · n/102* | the priciest cards are Lugia `ecard2-149` ($4,500), Mew ★ δ, Latias & Latios-GX… | rarity, set name and number from each card; rarity colour from `rarityTier` |
| Sets heading | *176 sets…* fixed in the text | the count comes from `GET /sets` | *{n} sets, from Base to the newest release*, or *Every set, from Base to the newest release* when unknown |
| Newest sets | sv8, sv7, sv6, sv5 | the newest four by `releaseDate` are me55c, me55, me5, me4 today | the newest four from `GET /sets` |
| Set card counts | `total` | `/sets` and `setCompletion` count against `printedTotal` | `printedTotal` |
| FAQ, prices | refreshed every day | a nightly sweep plus a more frequent refresh of active cards | *Prices come from TCGplayer and Cardmarket, updated nightly.* |
| Hero poster | `base1/4_hires.png` (845 KB) with `fetchpriority=high` | | `next/image` sized to the stage; the hires file is only the desktop 3D texture |

Duplicates removed: the odds line once (showcase); *1,000 coins* in the hero figures, step 01, the final CTA and the
FAQ only — the showcase button and the footer line drop it.

## Sections

`app/(public)/page.tsx` stays a Server Component and composes `components/landing/*`. It already undoes the shells'
`p-8` with `-m-8`.

| # | Section, id | Component | Kind | Data |
| --- | --- | --- | --- | --- |
| 1 | Hero | `hero.tsx` + `hero-card-stage.tsx` | server + island | cards total, sets, newest set |
| 2 | How it works | `how-it-works.tsx` | server, CSS motion | static |
| 3 | Pack opening, `#pack-opening` | `pack-showcase.tsx` | island | static |
| 4 | Chase cards | `chase-marquee.tsx` + `marquee-pause.tsx` | server + island | `GET /cards?sort=price_desc&pageSize=12` |
| 5 | Collect every set | `set-strip.tsx` | server | `GET /sets`, `GET /inventory/summary` signed in |
| 6 | Deck builder, `#deck-builder` | `deck-preview.tsx` | island | static |
| 7 | Safe trading, `#trading` | `trade-beats.tsx` | server, CSS motion | static |
| 8 | FAQ | `landing-faq.tsx` | server | static, plus `FAQPage` JSON-LD |
| 9 | Final call to action | `final-cta.tsx` | server | session |
| — | Scroll reveal | `reveal.tsx` | island | — |

**1 · Hero.** As designed: the *Newest set* badge, the `h1`, the paragraph, the signed-out (*Start collecting free*,
*Sign in*) or signed-in (*Go to your dashboard*, *Open a pack*) calls to action, *Free to play. No real money, no
cash-out.*, the three figures. The stage: Blastoise and Pikachu as flat floating cards through `CardArt`, Charizard's
poster through `next/image` with `preload`, its CSS holo overlay and sweep; the 3D canvas fades in over it.

**2 · How it works.** Four step cards with the design's micro-animations:

| Step | Sentence | Link |
| --- | --- | --- |
| 01 Get 1,000 coins | Every new account starts with 1,000 coins. They open packs and sweeten trades, and they can't be bought or cashed out. | — |
| 02 Open packs | Pick a booster and rip it open. The cards are yours the moment it opens. | `#pack-opening` |
| 03 Build decks | Turn your pulls into a 60-card deck, or let the builder deal you a random legal one. | `#deck-builder` |
| 04 Trade | Swap cards and coins with any collector. | `#trading` |

**3 · Pack opening.** *Rip a pack. See the odds first.* / *Every pack lists its odds before you open it.* The pack is
*Base Set Booster Pack* with Charizard's cover; its poster is `BoosterPack` (size `lg` desktop, `md` below) with a
static `PackArt` (Fire, Charizard cover, the Base Set logo). The legend *An example pull* lists the eight cards with
their rarities. The button: signed in *Browse packs* → `/packs`; signed out *Create an account to open one* →
`/register`. In 3D mode the section is `260vh` tall with a sticky stage and the stage chips *Sealed · Torn open ·
Revealed*; as a poster it has its natural height and shows the static eight-card fan.

**4 · Chase cards.** *The cards collectors chase* / *The catalog's most valuable cards, at their latest market price.*
Up to twelve items, priced cards only; fewer than six and the section is not rendered. Each item: `CardArt`, the name,
the rarity as a dot plus text in its tier colour, `$4,500.00` (`latestPriceUsd`), *{set name} · {number}*, a link to
`/cards/{id}`. Desktop without reduced motion: a 70 s marquee of the list twice (the copy `aria-hidden`, its links
`tabIndex={-1}`), a *Pause* / *Play* button with `aria-pressed`, paused while focus is inside. Otherwise a horizontal
rail with scroll snap.

**5 · Collect every set.** The newest four sets by `releaseDate` plus `base1, base2, neo1, ex1, dp1, swsh1`, each only if
`GET /sets` has it; a *Newest* or *Classic* tag; the logo, or the name as text when the image fails. Signed out: *{n}
cards* (`printedTotal`) and *Each set shows how many cards it holds. Sign in to track how many you own.* Signed in:
`CompletionMeter` with `setCompletion`'s figures, or 0 of `printedTotal` for a set the collection has nothing from —
the same rule as `SetsGallery`. *Browse all sets* → `/sets`. No sets from the API, no section.

**6 · Deck builder.** The three rules list on the left (*Exactly 60 cards*, *At most 4 copies of a card, basic energy
excepted*, *Format legality for Standard, Expanded or Unlimited*). On the right a static deck *Lightning Rush ·
Unlimited*: a 60-slot grid filling from 52 to 60 with a falling card, the counts *Pokémon 16 · Trainer 20 · Energy 24*,
and `DeckValidationBanner` fed a `DeckValidation` whose `DECK_SIZE` fails below 60 and passes at 60. The loop runs only
while the section is visible; reduced motion shows 60/60 and *Deck is legal*.

**7 · Safe trading.** *Your cards stay yours* / *Trades lock first, then swap in one step.* Three beats with the texts
from [Truth corrections](#truth-corrections) (beat 3 unchanged: *On accept, both sides move in a single transaction.
Either everything changes hands, or nothing does.*), highlighted in turn by a CSS animation with staggered delays.
*A counter-offer, start to finish* in three steps with status badges from `TRADE_STATUS_STYLES` (`lib/design/status`).

**8 · FAQ.** `<details>`/`<summary>`, each question an `h3`:

1. *Is it free?* — Yes. Every new account gets 1,000 coins to open packs with, and there is nothing to buy.
2. *Is it real money?* — No. Coins can't be bought or cashed out, and cards can't be sold for money here. Market prices
   are shown for reference only.
3. *Where do the cards and prices come from?* — The catalog is mirrored from pokemontcg.io and TCGdex, with Pokémon
   data from PokéAPI. Prices come from TCGplayer and Cardmarket, updated nightly.
4. *Can I trade with friends?* — Yes, with any member: find them by display name and offer cards and coins. They can
   accept, decline or counter, and nothing moves until both sides agree.
5. *Is PokéDrop official?* — No. It is a fan project, not affiliated with Nintendo, Creatures, GAME FREAK or The Pokémon
   Company.

The same five as `FAQPage` JSON-LD in a `<script type="application/ld+json">`, built from one array.

**9 · Final call to action.** As designed: signed out *1,000 coins are waiting for you.* with *Start collecting free* /
*Sign in*; signed in *Your next pack is waiting.* with *Open a pack* / *Go to your dashboard*.

## Footer and guest header

`components/shell/site-footer.tsx`, a Server Component taking `signedIn`: the logo and *Open. Collect. Build. Trade.*;
*Explore* (Browse cards, Sets); *Account* (Dashboard signed in; Sign in, Create account signed out); *Data*
(pokemontcg.io, TCGdex, PokéAPI as external links with `rel="noopener noreferrer"`, and *Prices: TCGplayer /
Cardmarket*); the disclaimer; `© {year} PokéDrop`. Rendered after `<main>` in the guest branch of
`app/(public)/layout.tsx` and inside `AppShell`'s content column for members, so every public page has it. The guest
header gains *Browse cards* and *Sets* (from `sm`) and a *Skip to content* link to `#main`.

## 3D

`components/landing/three/hero-card.ts` and `components/landing/three/pack-showcase.ts` keep the modules' shaders,
poses and lifecycle (`init(container, opts)` → `{ dispose }` / `{ setProgress, setCompact, dispose }`, `onReady`,
`onFallback`, IntersectionObserver and `visibilitychange` pausing, context-loss handling) with these changes:

- `three` from npm, pinned to an exact version, loaded by `import('three')` inside `init`, so it is its own chunk.
- TypeScript; the energy, rarity, card-back and booster colours read from CSS tokens through `getComputedStyle`
  instead of hex literals.
- `apps/web/lib/modules/` is deleted once the ports land.

`components/landing/use-3d-mode.ts` decides `full` or `poster` on the client after mount: `full` only with
`(pointer: fine)`, no `prefers-reduced-motion`, WebGL available, no `saveData`, and `hardwareConcurrency` and
`deviceMemory` above 4 when the browser reports them. The server render and the first client render are always the
poster, so there is no hydration mismatch and no layout shift. The hero imports its module on `requestIdleCallback`
after `load`; the showcase when the section is within 800 px of the viewport. Scroll progress reaches `setProgress`
through a ref and `requestAnimationFrame`; React state changes only when the stage chip changes.

## Motion

New keyframes in `globals.css` beside the existing ones, as `--animate-*` utilities: `coin-drop`, `wiggle`,
`stack-in`, `swap-l`, `swap-r`, `marquee`, `deck-drop`, `beat`. The global `prefers-reduced-motion` rule
(`globals.css:474`) already stops them; each section's resting state is its end state. Scroll reveal is progressive:
content is visible without JavaScript, and only what starts below the first screen is hidden and revealed.

## API

`CardSortSchema` becomes `['name_asc', 'name_desc', 'price_desc', 'price_asc']`. `CatalogService.searchCards` orders
the price sorts by `latestPriceUsd` with `nulls: 'last'`, then `id` in the same direction. Migration `card_price_sort`:
`@@index([latestPriceUsd(sort: Desc), id])` on `cards` (`NULLS LAST` in the SQL if Prisma cannot express it). The
search stays uncached. `catalog-view.tsx` labels them *Price: high to low* and *Price: low to high*.

## Data flow and failure

The page reads in parallel with `Promise.allSettled`: `GET /cards?pageSize=1`, `GET /sets`, `GET /cards?sort=price_desc
&pageSize=12`, and signed in `GET /inventory/summary`. Each failure removes only what it feeds: a figure, the badge, the
marquee, the set strip, the meters (falling back to card counts). With the API down the page answers 200 with the
static sections.

## Performance

Budget: Lighthouse 13, 90 or better in all four categories, mobile and desktop, against `next build && next start`.
Baseline: mobile 86 today (90 at PD-101; `Pages.md:444` traces the drop to the shared bundle). `three` is never in the
first load; images below the fold are lazy with `sizes` and fixed dimensions (CLS 0); the hero poster is the LCP
candidate. A subagent investigates the shared bundle and proposes cuts; if mobile still misses 90, the measured figure
and its cause are recorded, not hidden.

## Verification

No automated tests (v1). Gates: shared, api and web build/typecheck, eslint `--max-warnings=0`, prettier.

- **API:** curl `GET /cards?sort=price_desc` and `price_asc` — order, unpriced cards last, stable pages; `EXPLAIN
  ANALYZE` uses the index; an unknown sort → 400.
- **Page, curl without a cookie:** title, description, canonical; the JSON-LD parses with five questions; every
  section and the footer in the HTML; no three.js in the HTML.
- **Degradation:** the API stopped → 200, figures, marquee and sets gone, the rest present. Signed in: `AppShell`, the
  signed-in calls to action, meters, the footer inside the shell.
- **Browser (headless Chrome over CDP, screenshot subagent):** 1440, 768, 375; signed out and in; reduced motion;
  `--disable-webgl` (posters); no horizontal scroll at 375; the showcase scrubbed down and back; *Pause* and keyboard
  in the marquee; no console errors.
- **Other public pages:** `/cards` with the new sorts, `/sets`, a profile — the guest header and the footer.
- **Lighthouse:** mobile and desktop, three runs each.

Results go into `docs/Pages.md`.

## Documentation

`Pages.md` (*Landing* rewritten, the footer, the guest header), `Components.md` (landing components, `SiteFooter`),
`API.md` (price sorts), `DataModel.md` and `Migrations.md` (the index), `DesignSystem.md` (new keyframes).

## Out of scope

`GET /stats`; a light theme (PD-139 re-checks this page); caching the search; React Three Fiber; Linear status changes
(the connector is unavailable).
