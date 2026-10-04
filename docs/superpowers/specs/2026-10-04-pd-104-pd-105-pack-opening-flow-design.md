# PD-104 + PD-105 — Choosing a pack and the reveal

Design, 2026-10-04. Milestone M13 · Application Pages.

Tickets: [PD-104](https://linear.app/mstrilec/issue/PD-104/packs-page-with-confirm-cost-dialog) (packs page and confirm-cost dialog) and
[PD-105](https://linear.app/mstrilec/issue/PD-105/pack-reveal-animation-sealed-opening-reveal-summary) (the reveal).
They are designed together because the hand-off between them decides who sends the opening request, and that decision
(D8 in the M13 analysis) shapes both pages.
Builds on PD-87/PD-88 (`docs/Frontend.md`: `useOpenPack`, the invalidation map, `usePackReveal` and `reveal-machine.ts`),
PD-95/PD-96/PD-98 (`docs/Components.md`: `RevealCard`, `CardTile`, `PackTemplateCard`, `Dialog`).
Reference: `docs/UserFlows.md` §2 and §5 · `docs/API.md` *Packs* · `design/Booster Opening.dc.html` · `docs/DesignSystem.md` §7.

---

## What the tickets ask

| Scope item | Where it lands |
| --- | --- |
| `/packs` grid of PackTemplateCards with cost and guarantee | [Packs page](#packs-page) |
| Confirm-cost dialog stating cost and guarantee | [Packs page](#packs-page) |
| Client generates the `openId` before posting | [Hand-off](#hand-off) |
| Insufficient balance disables the action and points at the wallet | [Packs page](#packs-page) |
| On success, route into the reveal | [Hand-off](#hand-off) |
| Four stages driven by the reveal store; skippable; reduced-motion aware; never blocks on the network | [Stages](#stages) |

| Acceptance criterion | How it is met |
| --- | --- |
| PD-104: a double-click on confirm sends one request with one `openId` | Confirm sends nothing; it creates one `openId` and navigates. The one request is the tap in `sealed`, and the machine accepts `open` only from `sealed` |
| PD-104: the dialog states the exact cost and the exact guarantee | Cost and `guarantee` come from `GET /packs/templates`, the same answer the generator's odds are published in |
| PD-104: a failed open shows a recoverable error and does not consume currency | The API's opening is one transaction; a failure returns the reveal to `sealed` with the error in place and *Try again* on the same `openId` |
| PD-105: skipping jumps straight to summary with all cards intact | `skip` → `summary`; the summary renders the mutation's whole `cards` array |
| PD-105: under reduced motion the sequence completes without flips or shakes | The global CSS rule ends every animation at once; the opening's minimum duration is 0 when the user asks for reduced motion |
| PD-105: a slow response degrades the timing rather than breaking the sequence | `opening` lasts until both the minimum time has passed and the response has arrived |
| PD-105: refreshing mid-reveal does not re-open or re-charge | The `openId` lives in the URL; a replay of it answers the original cards and charges nothing |

## Decisions

Taken with the user during brainstorming:

1. **The tap sends the request, not the confirm.** The dialog on `/packs` is the money gate: it states the price and
   creates the `openId`. The tap on the sealed pack sends `POST /packs/:templateId/open`, so the opening animation
   really overlaps the server's answer, as PD-105 asks. Rejected: posting on confirm and arriving at the reveal with the
   cards (the opening becomes two seconds of theatre and the "overlap" requirement is not met), and posting on confirm
   while navigating in parallel (the request's state would live between two pages).
2. **A refresh after the opening goes to the summary.** A successful opening sets a per-tab mark for its `openId`. A load
   that finds the mark replays the request (free, same cards) and shows the summary; without the mark, the page shows
   `sealed`. Rejected: resuming at the card the user had reached (more state, more edge cases for little gain) and always
   showing `sealed` (a *Tap to open* on a pack already paid for reads as a second charge).
3. **The reveal plays the cards in pull order**, the API's `position`. The generator fills slots in order and the seeded
   templates put the rarest slot last, so the climax comes on its own. No client-side reordering.
4. **No set-completion bar and no new/duplicate markers in the summary.** The mockup has both; each needs a snapshot of
   the inventory before the opening. Left out, and not planned.
5. **Animations are CSS keyframes in `globals.css`**, not the `motion` library. The global reduced-motion rule then
   reaches them with no per-component work.

## Hand-off

The URL is the whole contract between the two pages:

```
/packs/open?template=<templateId>&open=<openId>
```

`lib/pack-open-flow.ts` owns it:

| Function | Does |
| --- | --- |
| `openUrl(templateId)` | a new `crypto.randomUUID()` as `openId`, and the URL above |
| `parseOpenParams(params)` | `{ templateId, openId }` when `template` is non-empty and `open` is a UUID, else `null` |
| `markOpened(openId)` / `wasOpened(openId)` | `sessionStorage['pokedrop.opened.<openId>'] = '1'`; every access in try/catch, so a refused storage only costs the refresh shortcut |

- **The confirm dialog** calls `router.push(openUrl(template.id))`. It sends nothing, so a double-click cannot send twice;
  the second click lands on a page already navigating.
- **`/packs/open` without valid parameters** redirects to `/packs` from the Server Component, before anything renders.
- **The `openId` is not personal data**: a random UUID that only this user can redeem. A replay by another user is
  409 `OPEN_ID_CONFLICT` with no cards (API.md, *Opening a pack*).

## Packs page

`/packs`: `PageHeader` (*Open a pack*, a link to `/packs/history`), then a grid of `PackTemplateCard`s from
`usePackTemplates()` (`GET /packs/templates`, keyed `['packs', 'templates']` under the `packs` root that `openPack`
already invalidates).

- `balance` comes from `useMe()`; a card below its cost is disabled and says how many coins are missing (the component
  already does). A line under the grid links the wallet when any pack is unaffordable.
- *Open* opens `ConfirmOpenDialog` (`components/packs/confirm-open-dialog.tsx`): title *Open {name}?*, the `guarantee`
  sentence, *This action can't be undone.*, the cost in the confirm button (*Open pack · 300*). The same component serves
  the summary's *Open another*.
- Loading: skeleton cards. Error: `ListError`. No active templates: an `EmptyState` (*No packs on sale right now*).

## Stages

`/packs/open` renders `PackRevealProvider` around `PackReveal` (`components/packs/reveal/pack-reveal.tsx`), which owns
the store, the `useOpenPack` mutation (`meta: { toast: false }` — errors are shown in place), the opening timers and the
refresh replay. One component per stage, each a plain function of what `PackReveal` hands it.

### On load

`wasOpened(openId)` → send `open` and replay the request at once, then `opened` and `skip` as soon as the cards are
back: the user lands on the summary. While the replay is in flight the page shows a spinner with *Loading your pack…*,
not the opening animation; a failed replay shows the [opening's failure table](#opening--opening-stagetsx) with
*Try again*. Without the mark the store stays `sealed`.

### sealed — `sealed-stage.tsx`

The pack floating with its sweep and glow, the template's name, and a *Tap to open* button that takes focus on arrival.
A click on the pack does the same. Activating sends `open` and the request together.

### opening — `opening-stage.tsx`

Shake twice over 0.6 s, then the flash. `PackReveal` sends `opened(total)` only when **both** the minimum time (2 s) has
passed **and** the response has arrived. After 6 s without an answer, *Still opening…* appears as `role="status"` and
the glow keeps pulsing. Under `prefers-reduced-motion: reduce` the minimum is 0: the stage ends when the answer arrives.

On success: `markOpened(openId)`. On failure: `failed` (back to `sealed`) with the error above the button, by status:

| Failure | Shown | Action |
| --- | --- | --- |
| network, 5xx, 429 | the `apiErrorMessage` sentence | *Try again* — the same `openId`, so a request that did land is replayed, not repeated |
| 402 `INSUFFICIENT_FUNDS` | *You don't have enough coins for this pack.* | *Go to wallet* |
| 404, 409 `OPEN_ID_CONFLICT`, 409 `PACK_UNAVAILABLE` | the API's sentence | *Back to packs* |

### reveal — `reveal-stage.tsx`

One large `RevealCard` at a time, centred; above it *3 / 8* and *Skip all →*.

- The first activation flips the card (`revealed`); the second sends `next`, and the next card enters with `card-in`.
  Whether the current card is flipped is component state keyed by the index; the machine is unchanged.
- An explicit button, *Reveal card* then *Next card* (*See all cards* on the last), carries keyboard focus; a click
  anywhere on the stage does the same for pointer users.
- Ultra and Secret pulls add the rays and burst in their tier's color and the caption *Ultra Rare pull* /
  *Secret Rare pull*; every tier gets `RevealCard`'s `highlight` from Rare up.
- A polite live region says *Card 3 of 8: Charizard, Rare Holo* when a card is revealed.
- *Skip all* sends `skip`.

### summary — `summary-stage.tsx`

A check, *{name} opened*, four figures — cards, *Rare or better*, market value (the sum of `latestPriceUsd`, cards
without a price left out and counted in a note), balance after (`result.balance`) — then every card as a `CardTile`
linking `/cards/:id`, in pull order. *View in collection* → `/inventory`; *Open another · {cost}* opens
`ConfirmOpenDialog` for the same template, whose confirm `router.replace`s to a fresh `openUrl` and sends `reset`.
Focus moves to the summary's heading on arrival.

### Motion tokens

Added to `@theme` in `app/globals.css`: `float-pack`, `sweep`, `shake`, `flash`, `burst`, `ray-spin`, `card-in`, each as
an `--animate-*` utility with its keyframes, values taken from `design/Booster Opening.dc.html`. Colors come from the
rarity tokens. JavaScript timing reads `prefers-reduced-motion` the way `CurrencyPill` does, because the CSS rule cannot
reach a timer.

## Files

| File | Change |
| --- | --- |
| `apps/web/lib/api/endpoints/packs.ts` | `packTemplates()` |
| `apps/web/lib/query/keys.ts` | `packs.templates` |
| `apps/web/lib/query/packs.ts` | `usePackTemplates()` |
| `apps/web/lib/pack-open-flow.ts` | new: the URL contract and the opened mark |
| `apps/web/components/packs/confirm-open-dialog.tsx` | new |
| `apps/web/components/packs/packs-grid.tsx` | new: the `/packs` page body |
| `apps/web/components/packs/reveal/*.tsx` | new: `pack-reveal`, `sealed-stage`, `opening-stage`, `reveal-stage`, `summary-stage` |
| `apps/web/app/(app)/packs/page.tsx`, `apps/web/app/(app)/packs/open/page.tsx` | the placeholders replaced |
| `apps/web/app/globals.css` | the motion tokens |
| `docs/Pages.md` | the two sections and their measurements |

Nothing changes in `apps/api` or `packages/shared`, and `reveal-machine.ts` keeps its events and states.

## Verification

No automated tests in v1. Measured with a fresh headless Chrome profile against `next dev` and the live API, real key
events, and the database checked; each result recorded in `docs/Pages.md`.

1. A double Enter on the dialog's confirm: no `POST /packs/*/open`, one navigation to `/packs/open?…`.
2. Enter on *Tap to open*: exactly one `POST`; the topbar balance drops by the cost; one `PACK_SPEND` row.
3. *Skip all* on the second card: the summary with all N cards.
4. With `--force-prefers-reduced-motion`: the computed durations 0.00001 s, and `opening` ends as soon as the answer
   arrives.
5. The answer held for 8 s (CDP `Fetch` interception): *Still opening…* after 6 s, then the reveal; nothing broken.
6. A reload on the fourth card: the summary with the same cards in the same order, the balance unchanged, still one
   `PACK_SPEND` row and one opening for that `openId`.
7. A pack above the balance: disabled, with the shortfall; a 402 at the tap (balance lowered between dialog and tap):
   the error in place, no ledger row, *Go to wallet*.
8. `/packs/open`, `?template=x`, `?template=x&open=nope`: each redirects to `/packs`.
9. The whole flow by keyboard alone; the live region announces each card.
10. *Open another*: a new `openId` in the URL (history not grown, `replace`), the stage back to `sealed`.
