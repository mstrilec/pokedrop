# PD-136 — Boosters that look like real booster packs

Design, 2026-10-07. Milestone M15 · Polish & Extras.

Ticket: [PD-136](https://linear.app/mstrilec/issue/PD-136/boosters-that-look-like-real-booster-packs). Builds on the
pack templates (PD-56, PD-57: `PackTemplatesService`, `toTemplateView`), the packs page and reveal (PD-104, PD-105:
`PackTemplateCard`, `PackArt`, `PackReveal`), the dashboard (PD-103) and the template editor (PD-121). Blocks PD-138,
whose landing reuses the wrapper. Reference: `docs/API.md` *Packs* · `docs/DataModel.md` *PackTemplate* ·
`docs/Pages.md` *Packs*, *Pack reveal*, *Admin packs* · `design/Booster Opening.dc.html`.

---

## What the ticket asks

| Scope item | Where it lands |
| --- | --- |
| a drawn booster wrapper from what we have | [`BoosterPack`](#boosterpack) |
| the template gains a featured card and an optional pack image URL | [Data](#data), [API](#api) |
| names like the product; set name and series above it | [Seed](#seed), [Packs page](#packs) |
| `/packs`: tilt and foil sheen on hover, no duplicated *8 cards ·* | [Packs page](#packs) |
| every image has a fallback and alt text; no layout shift | [Fallbacks](#fallbacks) |

| Acceptance criterion | How it is met |
| --- | --- |
| `/packs`, the dashboard, the admin preview and the sealed stage show the same wrapper for the same template | One `art` object computed by the API ([Decision 1](#decisions)) feeds one component in all four places |
| An admin can choose the featured card and set or clear an image URL; audited; members see it on their next load | `PATCH /admin/pack-templates/:id` takes `coverCardId` and `imageUrl` (`null` clears); the existing `pack_template.update` audit row records them; `GET /packs/templates` is not cached |
| A template with a broken logo or cover still renders a complete pack | [Fallbacks](#fallbacks); [Verification](#verification) B4 |
| Lighthouse on `/packs` does not drop; 375 px without horizontal scroll; reduced motion respected | Sized images, `next/image` for catalog art with `sizes`, fixed aspect ratios; [Verification](#verification) B6–B8 |

## Decisions

Taken with the user during brainstorming:

1. **The API resolves the art.** `PackTemplateView` carries an `art` object: the set's name, series and logo, the cover
   card (chosen or default) and the image URL. One rule, in one place, so the four surfaces cannot disagree. Rejected:
   the client fetching sets and cards through the catalog (a request per template, and the default rule duplicated).
2. **The default featured card is the highest rarity, ties broken by market price.** Among the cards of the template's
   sets: the highest rarity tier (Secret Rare > Ultra Rare > Rare > Uncommon > Common, by `rarityTier`), then the highest
   `latestPriceUsd` (no price last), then the card id. It is computed on read, never stored, so it follows the next price
   sync. Rejected: most valuable first (prices are missing for whole sets — `me4` has none, `base2` 16 of 64 — and the
   cover would change nightly), and no cover until an admin chooses one.
3. **The wrapper's colour is the cover card's energy type**: the first of the card's `types` through `energyStyle`, and
   Colorless for a Trainer, an Energy or no cover. Rejected: a colour chosen by an admin (a field, an input and a column
   for what the cover already says) and a colour sampled from the set logo (image processing, unpredictable).

## Data

`PackTemplate` gains two nullable columns, one migration, no backfill (`null` is the default):

```prisma
coverCardId String?
imageUrl    String?

coverCard Card? @relation(fields: [coverCardId], references: [id], onDelete: SetNull)
```

`Card` gets the back-relation `packTemplateCovers PackTemplate[]`. `onDelete: SetNull`: the mirror does not delete
cards today, but a removed card must fall back to the default rather than block anything.

## Shared (`@pokedrop/shared`)

- **`rarityTier`** moves from `apps/web/lib/design/rarity.ts` to the shared package with its `TIER_RULES`, beside the
  `RarityTier` type it already exports; the web imports it from there. The server needs the same reading of "highest".
- **`httpsUrl`**: the avatar's rule (`z.url({ protocol: /^https$/, error: 'Use an https:// address' })`) becomes a named
  schema used by both `ProfileIdentitySchema.avatarUrl` and the template's `imageUrl`; the message stays the same.
- **`PackTemplateSchema`** gains `coverCardId: string | null` and `imageUrl: string | null`.
- **`CreatePackTemplateSchema`** takes both as optional nullable (`imageUrl` capped at 2,048 characters, like the
  avatar); `UpdatePackTemplateSchema` stays its `.partial()`.
- **`PackTemplateViewSchema`** gains:

```ts
art: {
  set: { id: string; name: string; series: string; logoUrl: string | null };
  cover: { id: string; name: string; image: string; type: string | null } | null;
  coverIsDefault: boolean;
  imageUrl: string | null;
}
```

`set` is the first set of `setFilter.setIds`, the order the admin added them in. `cover.image` is the card's
`imageLarge`; `type` its first type or `null`. `cover` is `null` only when the sets hold no card at all.

## API

### Reads

`GET /packs/templates` (members) and `GET /admin/pack-templates` (admins) both return `PackTemplateView[]`. The admin
list returned `PackTemplate[]` until now; the view is a superset, so the editor keeps working. `POST` and `PATCH` return
the view too, so the editor's preview updates from the answer.

`PackTemplatesService` builds `art` for a list of templates at once:

1. the sets of every template's `setIds` (`id`, `name`, `series`, `logoUrl`), one query;
2. the chosen covers (`coverCardId`s), one query;
3. for the templates without a chosen cover, the candidates — `id`, `name`, `setId`, `rarity`, `types`, `imageLarge`,
   `latestPriceUsd` of every card in their sets — one query, ranked in TypeScript by [Decision 2](#decisions).

A few hundred rows for today's templates; no cache, so an admin's change shows on a member's next load.

### Writes

`POST` and `PATCH /admin/pack-templates[/:id]` accept `coverCardId` and `imageUrl`. Inside the existing transaction:

- a `coverCardId` that is not a card of the template's sets (after the patch) → 400 *The featured card is not in this
  pack's sets*;
- a `setFilter` change that leaves the stored cover outside the new sets → the same 400. The editor clears the cover
  when the sets change, so an admin does not meet it there;
- `null` clears either field.

The audit row stays `pack_template.update` (`pack_template.create`), with the new fields in `meta.changes` (`input`).

### Seed

The Base Set template is named *Base Set Booster Pack*; its cover stays `null`, so the default applies. In the dev mirror
that is Charizard (`base1-4`): every Base Set holo is tier Rare, and the price decides.

## Web

### `BoosterPack`

`components/packs/booster-pack.tsx`. Props: `art` (the view's, or `null` while loading or unknown), `name`,
`cardCount`, `size: 'sm' | 'md' | 'lg' | 'xl'`, `className`. It only draws; float, shake, tilt and flash stay with the
callers, as with `PackArt` today.

- **The drawn wrapper**: a tall foil pouch at a fixed 5:8 ratio. Crimped top and bottom edges (a CSS mask of small
  teeth); a body gradient from the cover's energy colour (`energyStyle(type).face`) to `--card-face-end`; a vertical
  foil sheen (the `sweep` animation, decorative). The set logo at the top; a window in the middle with the cover card's
  art cropped to the upper part of the card, framed in its rarity colour; the product name and *{n} cards* at the bottom.
- **Sizes**: `sm` for the dashboard (~72 px wide), `md` for the `/packs` card (~150), `lg` for the admin preview
  (~220), `xl` for the reveal (300, the current `PackArt` width). Text and logo scale with the size.
- **Colours** come from tokens only. The raw `white` / `black` utilities of `PackArt` and `PackTemplateCard` go; where a
  light text on the foil is needed, a token is added in `globals.css` (and `docs/DesignSystem.md`) so PD-139 finds it.
- **The image URL**: when `art.imageUrl` is set, the wrapper is that photo, as a plain `<img>` (`object-contain`, the
  same 5:8 box) — the host is anyone's, outside `CARD_IMAGE_HOSTS`. If it fails to load, the drawn wrapper shows.
- **Accessibility**: the wrapper is one image to assistive technology, `role="img"` with *{name} booster pack*; the logo
  and cover inside are `alt=""`.

### Fallbacks

- No `art` (loading, or a reveal without the template): the drawn wrapper in Colorless, the name, no logo, no window art.
- The logo fails or is `null`: the set name in text at the top.
- The cover fails or is `null`: the window filled with the energy colour and the type's icon.
- The photo fails: the drawn wrapper.

Every box has its size before anything loads, so nothing shifts.

### Where it is used

1. **`/packs`** — `PackTemplateCard`'s art area becomes `BoosterPack md`, tilted a few degrees. On hover (pointer only,
   not under reduced motion) it lifts and straightens and the sheen passes. Above the name: *{set name} · {series}*, or the set name alone when the two are the same (*Base*). The
   *8 cards ·* before the guarantee goes; the guarantee already says it. `PackTemplateCard` takes the view's `art`.
2. **The dashboard** — *Featured packs* shows `BoosterPack sm` instead of the `PackageOpen` icon.
3. **The reveal** — the sealed and opening stages show `BoosterPack xl` in place of `PackArt`; `pack-art.tsx` is
   deleted. `PackReveal` already finds the template in `usePackTemplates()`; it passes `template?.art ?? null`. The
   float, shake, flash and tear stay as they are.
4. **The admin editor** — a *Pack art* section: the preview (`BoosterPack lg`), *Featured card* (the card's name with
   *Default — highest rarity* or *Chosen*, *Choose…*, *Use default*), and *Pack image address* (empty means none, the
   https rule shown under the field). The preview uses the saved view's `art` while the draft's cover and sets are
   unchanged; after a pick it uses the picked card; a new template with no pick shows the wrapper without art and
   *The featured card is chosen when you save*. Changing the sets clears a chosen cover. The draft and `bodyOf` carry
   `coverCardId` and `imageUrl`.

### `CoverCardPicker`

`components/admin/packs/cover-card-picker.tsx`: a dialog with a set selector (the template's sets, by name) and a
search over `GET /cards?set=<id>&q=`, results as a grid of `CardTile`s; choosing one closes it. The trade composer's
`CardPickerDialog` is not reused — it is built around the two sides of a trade.

## Errors

| Case | Answer |
| --- | --- |
| `coverCardId` outside the template's sets | 400 *The featured card is not in this pack's sets* |
| `setFilter` change leaving the stored cover outside | the same 400 |
| `imageUrl` not https, or not a URL | 400 *Use an https:// address* |
| `coverCardId` of no card | 400, the same message (the card is in none of the sets) |

## Documentation

- `docs/API.md` *Packs* and the admin pack templates: the `art` object, the two fields, the default rule, the 400s.
- `docs/DataModel.md` *PackTemplate*: the two columns. `docs/Migrations.md`: the migration.
- `docs/Pages.md` *Packs*, *Pack reveal*, *Dashboard*, *Admin packs*: the wrapper and the editor section.
- `docs/Components.md`: `BoosterPack`, its sizes and fallbacks.
- `docs/DesignSystem.md`: any token the wrapper adds.

## Verification

No automated tests in v1. Checked by hand and recorded in `docs/Pages.md`.

**API (curl, an admin and a member session):**

- A1 `GET /packs/templates`: the Base Set template's `art` — set *Base*, series *Base*, its logo, cover Charizard
  `base1-4` with `coverIsDefault: true`, `imageUrl: null`.
- A2 `PATCH` with a `base1` card as cover → the view with that cover and `coverIsDefault: false`; `GET /admin/audit`
  shows `pack_template.update` with the change; a member's `GET /packs/templates` shows it.
- A3 `PATCH` with a card of another set → 400; with an unknown id → 400; `setFilter` to `['base2']` while the cover is a
  `base1` card → 400; `coverCardId: null` → the default again.
- A4 `imageUrl` `http://…` → 400 *Use an https:// address*; an https URL → in `art`; `null` → cleared.
- A5 a member calling the admin routes → 403; no cookie → 401.

**Browser (signed in; the user signs the pane in, or allows it):**

- B1 the same template on `/packs`, the dashboard, the admin preview and the sealed stage: the same wrapper (logo,
  cover, colour, name).
- B2 the editor: *Choose…* → pick a card → the preview changes before saving; save → `/packs` shows it on reload;
  *Use default* → back to Charizard; changing the sets clears the pick.
- B3 an image URL set → the photo on all four surfaces; cleared → the drawn wrapper.
- B4 a broken logo and a broken cover (request blocking) and a broken image URL: a complete pack each time, no layout
  shift.
- B5 the reveal: float, shake, flash and tear as before, with the new wrapper.
- B6 Lighthouse on `/packs`, desktop and mobile, before and after: no category drops.
- B7 375 px: `/packs`, the dashboard, the editor and the reveal with `scrollWidth` 375.
- B8 reduced motion: no hover lift, no sheen, no float; no console errors.

## Out of scope

- Real booster photos from any source (none is free; the image URL is for an admin's own licensed photo).
- A per-set colour or palette field.
- Tearing or opening animations beyond the existing ones (PD-138's landing showcase owns its own).
- The light theme's colours for the wrapper (PD-139).
