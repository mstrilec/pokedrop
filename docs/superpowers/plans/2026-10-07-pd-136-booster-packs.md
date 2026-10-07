# PD-136 Booster Packs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every pack template looks like a real booster — a drawn foil wrapper with its set's logo and a featured card, or an admin's photo — the same on `/packs`, the dashboard, the admin editor and the reveal.

**Architecture:** `PackTemplate` gains `coverCardId` and `imageUrl`. The API resolves an `art` object for each template (set, chosen or default cover, image URL) and returns it inside `PackTemplateView` from the member and admin template routes. The web app draws it with one `BoosterPack` component in four sizes, and the template editor gains a *Pack art* section with a cover picker.

**Tech Stack:** NestJS + Prisma 7 (API), Zod 4 (shared), Next 16.3, React 19.2, TanStack Query 5, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-10-07-pd-136-booster-packs-design.md`

## Global Constraints

- No automated tests in v1. Each task's gate: shared `pnpm --filter @pokedrop/shared build`; api `pnpm --filter @pokedrop/api exec tsc --noEmit -p tsconfig.json` and `pnpm exec eslint apps/api/src/packs --max-warnings=0`; web `pnpm --filter @pokedrop/web typecheck` and `pnpm exec eslint <touched web folders> --max-warnings=0`; `pnpm exec prettier --check` on touched files. Behaviour is measured with `curl`/`psql` (Tasks 2–3) and in the browser (Tasks 4–7).
- **Sessions.** Every pack route needs a session. The browser pane and `curl` checks run signed in only after the user signs the pane in or explicitly allows Claude to sign in the test account (`pd134-…@pokedrop.test`, credentials in the session scratchpad `pd134-user.txt`; promote it with `psql` for admin checks and demote it after). Until then: signed-out checks only — the `/dev/components` gallery and `psql`.
- The default cover: highest rarity tier by `rarityTier` (`RarityTierSchema.options` order, Common lowest), then `latestPriceUsd` descending with no price last, then card id ascending. Computed on read, never stored.
- The wrapper's colour: `energyStyle(art.cover?.type ?? 'Colorless').face`.
- `imageUrl`: `https://` only, at most 2,048 characters, message *Use an https:// address* (the avatar's rule, shared).
- The cover 400 message, exactly: *The featured card is not in this pack's sets*.
- Raw colours only in `apps/web/app/globals.css`; no hex colours or arbitrary spacing lengths in class strings (arbitrary font sizes and percentages allowed).
- Commits on `dev`, header `[PD-136]: …` (≤ 72 characters), body ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Comments only where a tidy-up would silently break something.
- On Windows, a Python edit script must open files with `newline=''`; the repository is LF.

## Review Focus

1. **A template whose sets change while a cover is chosen**: the editor must send `coverCardId: null` with the new `setFilter`, never the stale cover (which the API would refuse with 400). Pinned in Task 6 (`edit({ setIds })` clears `coverCardId`; `changesOf` sends it) and measured in Task 7, B2.
2. **A set with no prices at all (`me4`) or partly priced (`base2`)**: the default still picks a cover — by tier, then id. Pinned in Task 2 (`nulls: 'last'`, `id` tie-break) and measured in Task 2, step 6 (a `me4` template via `psql`).
3. **An image that fails** — logo, cover or photo: a complete wrapper, no layout shift, no console error from `next/image`. Pinned in Task 4 (per-image `failed` state, fixed aspect ratios, `unoptimized` for foreign hosts) and measured in Task 4, step 5 (gallery specimens with broken URLs).
4. **A reveal opened before the template list loads** (deep link, slow network): `art` is `null` and the wrapper still renders. Pinned in Task 5 (`template?.art ?? null`) and Task 4 (the `null` branch).
5. **A photo on a host outside `CARD_IMAGE_HOSTS`**: `next/image` would throw and take the page down. Pinned in Task 4 (`unoptimized={!isOptimizable(src)}`) and measured in Task 4, step 5.

---

### Task 1: Shared contract

**Files:**
- Create: `packages/shared/src/primitives/url.ts`
- Create: `packages/shared/src/cards/rarity.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/entities/user.ts:43-46`
- Modify: `packages/shared/src/entities/pack.ts:41-64,115-120`
- Modify: `apps/web/lib/design/rarity.ts:52-66`

**Interfaces:**
- Produces: `HttpsUrlSchema`; `rarityTier(rarity: string | null): RarityTier`; `PackArtSchema` / `PackArt`; `PackTemplate.coverCardId: CardId | null`, `PackTemplate.imageUrl: string | null`; `CreatePackTemplate.coverCardId?: CardId | null`, `.imageUrl?: string | null`; `PackTemplateView.art: PackArt`.

- [ ] **Step 1: The https URL rule**

`packages/shared/src/primitives/url.ts`:

```ts
import { z } from 'zod';

export const HttpsUrlSchema = z
  .url({ protocol: /^https$/, error: 'Use an https:// address' })
  .max(2048);
```

In `entities/user.ts`, `ProfileIdentitySchema.avatarUrl` becomes `HttpsUrlSchema.nullable()` (import from `../primitives/url.js`).

- [ ] **Step 2: Move `rarityTier`**

`packages/shared/src/cards/rarity.ts` — the body of `apps/web/lib/design/rarity.ts` lines 52–66 moved verbatim:

```ts
import type { RarityTier } from '../enums.js';

const TIER_RULES: [RegExp, RarityTier][] = [
  [/secret|hyper|rainbow|special illustration|shiny ultra/i, 'Secret Rare'],
  [
    /ultra|double rare|illustration rare|\bex\b|\bgx\b|\bv(max|star)?\b|lv\.x|break|prime|prism|star|legend|radiant|amazing|\bace\b|shining|shiny|gallery|mega|black white|futuristic/i,
    'Ultra Rare',
  ],
  [/uncommon/i, 'Uncommon'],
  [/^common$/i, 'Common'],
];

export function rarityTier(rarity: string | null): RarityTier {
  if (!rarity) return 'Common';
  return TIER_RULES.find(([pattern]) => pattern.test(rarity))?.[1] ?? 'Rare';
}
```

In `apps/web/lib/design/rarity.ts`, delete `TIER_RULES` and the function and add `export { rarityTier } from '@pokedrop/shared';` so the ten importers stay as they are.

`index.ts` gains `export * from './primitives/url.js';` and `export * from './cards/rarity.js';`.

- [ ] **Step 3: Template fields and the art**

In `entities/pack.ts` (import `HttpsUrlSchema`):

```ts
export const PackTemplateSchema = z.object({
  id: PackTemplateIdSchema,
  name: z.string().min(1),
  setFilter: SetFilterSchema,
  cost: z.number().int().min(0),
  slotConfig: SlotConfigSchema,
  active: z.boolean(),
  coverCardId: CardIdSchema.nullable(),
  imageUrl: z.string().nullable(),
});

export const CreatePackTemplateSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  setFilter: SetFilterSchema,
  cost: z.number().int().min(0).max(1_000_000),
  slotConfig: SlotConfigSchema,
  active: z.boolean().default(true),
  coverCardId: CardIdSchema.nullable().optional(),
  imageUrl: HttpsUrlSchema.nullable().optional(),
});
```

Before `PackTemplateViewSchema`:

```ts
/** What a booster wrapper is drawn from; resolved by the API, the same for every surface. */
export const PackArtSchema = z.object({
  set: z.object({
    id: SetIdSchema,
    name: z.string(),
    series: z.string(),
    logoUrl: z.string().nullable(),
  }),
  cover: z
    .object({
      id: CardIdSchema,
      name: z.string(),
      image: z.string(),
      type: z.string().nullable(),
      rarity: z.string().nullable(),
    })
    .nullable(),
  coverIsDefault: z.boolean(),
  imageUrl: z.string().nullable(),
});
export type PackArt = z.infer<typeof PackArtSchema>;
```

and `PackTemplateViewSchema` gains `art: PackArtSchema`.

- [ ] **Step 4: Gate**

Run: `pnpm --filter @pokedrop/shared build && pnpm --filter @pokedrop/web typecheck`
Expected: the shared build passes. The web typecheck passes too (nothing reads the new fields yet; `rarityTier` re-exported). The API typecheck fails in `pack-template.view.ts` (`art` missing) — fixed in Task 2; do not commit until Task 2's gate.

### Task 2: Migration and resolved art on every template read

**Files:**
- Modify: `apps/api/prisma/schema.prisma:228-283,357-368`
- Create: `apps/api/prisma/migrations/<timestamp>_pack_template_art/migration.sql` (generated)
- Create: `apps/api/src/packs/pack-art.ts`
- Modify: `apps/api/src/packs/pack-template.view.ts`
- Modify: `apps/api/src/packs/pack-templates.service.ts`
- Modify: `apps/api/src/packs/packs.controller.ts:30-37`
- Modify: `apps/api/src/packs/admin-pack-templates.controller.ts`

**Interfaces:**
- Consumes: Task 1's `PackArt`, `rarityTier`, `RarityTierSchema`.
- Produces: `PackTemplatesService.viewsOf(templates: PackTemplate[]): Promise<PackTemplateView[]>`; `toTemplateView(template: PackTemplate, art: PackArt): PackTemplateView`; the member and admin routes answering `PackTemplateView` / `PackTemplateView[]`.

- [ ] **Step 1: Schema and migration**

In `model PackTemplate`, after `active`:

```prisma
  coverCardId String?
  imageUrl    String?

  coverCard Card? @relation(fields: [coverCardId], references: [id], onDelete: SetNull)
```

In `model Card`, beside the other back-relations: `packTemplateCovers PackTemplate[]`.

Run: `cd apps/api && pnpm exec prisma migrate dev --name pack_template_art`
Expected: a migration adding two nullable columns, a foreign key `ON DELETE SET NULL`, and the client regenerated. Check the SQL has no `DROP` and no `NOT NULL`.

- [ ] **Step 2: The art resolver**

`apps/api/src/packs/pack-art.ts`:

```ts
import {
  rarityTier,
  RarityTierSchema,
  type CardId,
  type PackArt,
  type PackTemplate,
  type SetId,
} from '@pokedrop/shared';
import type { PrismaService } from '../prisma/index.js';

const COVER_SELECT = { id: true, name: true, types: true, rarity: true, imageLarge: true } as const;
type CoverRow = { id: string; name: string; types: string[]; rarity: string | null; imageLarge: string };
type RarityRow = { setId: string; rarity: string | null };

const tierRank = (rarity: string | null) => RarityTierSchema.options.indexOf(rarityTier(rarity));

export async function packArtOf(
  prisma: PrismaService,
  templates: PackTemplate[],
): Promise<Map<string, PackArt>> {
  const firstSetIds = unique(templates.flatMap((t) => t.setFilter.setIds.slice(0, 1)));
  const coverIds = unique(templates.flatMap((t) => (t.coverCardId ? [t.coverCardId] : [])));
  const defaultSetIds = unique(templates.flatMap((t) => t.setFilter.setIds));

  const [sets, covers, rarities] = await Promise.all([
    prisma.cardSet.findMany({
      where: { id: { in: firstSetIds } },
      select: { id: true, name: true, series: true, logoUrl: true },
    }),
    prisma.card.findMany({ where: { id: { in: coverIds } }, select: COVER_SELECT }),
    prisma.card.groupBy({ by: ['setId', 'rarity'], where: { setId: { in: defaultSetIds } } }),
  ]);
  const setById = new Map(sets.map((set) => [set.id, set]));
  const coverById = new Map(covers.map((card) => [card.id, card]));

  const arts = new Map<string, PackArt>();
  for (const template of templates) {
    const setId = template.setFilter.setIds[0] ?? '';
    const set = setById.get(setId) ?? { id: setId, name: setId, series: '', logoUrl: null };
    const chosen = template.coverCardId ? coverById.get(template.coverCardId) : undefined;
    const cover = chosen ?? (await defaultCover(prisma, template.setFilter.setIds, rarities));
    arts.set(template.id, {
      set: { ...set, id: set.id as SetId },
      cover: cover === null ? null : coverOf(cover),
      coverIsDefault: chosen === undefined,
      imageUrl: template.imageUrl,
    });
  }
  return arts;
}

// The cards of the highest tier the sets hold, then the most valuable, then the first by id.
async function defaultCover(
  prisma: PrismaService,
  setIds: string[],
  rarities: RarityRow[],
): Promise<CoverRow | null> {
  const own = rarities.filter((row) => setIds.includes(row.setId));
  if (own.length === 0) return null;
  const top = Math.max(...own.map((row) => tierRank(row.rarity)));
  const inTop = unique(own.filter((row) => tierRank(row.rarity) === top).map((row) => row.rarity));
  const named = inTop.filter((rarity): rarity is string => rarity !== null);
  const rarity = inTop.includes(null)
    ? { OR: [{ rarity: { in: named } }, { rarity: null }] }
    : { rarity: { in: named } };

  return prisma.card.findFirst({
    where: { setId: { in: setIds }, ...rarity },
    orderBy: [{ latestPriceUsd: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
    select: COVER_SELECT,
  });
}

function coverOf(card: CoverRow): NonNullable<PackArt['cover']> {
  return {
    id: card.id as CardId,
    name: card.name,
    image: card.imageLarge,
    type: card.types[0] ?? null,
    rarity: card.rarity,
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
```

If `groupBy`'s inferred row type does not narrow to `RarityRow`, map it: `rarities.map(({ setId, rarity }) => ({ setId, rarity }))`.

- [ ] **Step 3: The view takes the art**

`pack-template.view.ts`: `toTemplateView(template: PackTemplate, art: PackArt)` and the parse becomes `PackTemplateViewSchema.parse({ ...template, contents, guarantee: guaranteeOf(contents), art })`.

In `PackTemplatesService`:

```ts
  async viewsOf(templates: PackTemplate[]): Promise<PackTemplateView[]> {
    const arts = await packArtOf(this.prisma, templates);
    return templates.map((template) => toTemplateView(template, arts.get(template.id)!));
  }
```

(`arts` holds every template passed in; the non-null assertion is the resolver's contract. If the lint config refuses `!`, use `?? never()` with a local `throw`.)

- [ ] **Step 4: Routes answer views**

`packs.controller.ts`:

```ts
  async listTemplates(): Promise<PackTemplateView[]> {
    return this.templates.viewsOf(await this.templates.listActive());
  }
```

and drop the `toTemplateView` import there.

`admin-pack-templates.controller.ts`: all three handlers return `Promise<PackTemplateView>` / `Promise<PackTemplateView[]>`:

```ts
  async list(): Promise<PackTemplateView[]> {
    return this.templates.viewsOf(await this.templates.listAll());
  }
  …
    const [view] = await this.templates.viewsOf([await this.templates.create(user.id, body)]);
    return view!;
```

(the same for `update`), and each `@Doc` names `PackTemplateViewSchema` (`returns('PackTemplateViewList', z.array(PackTemplateViewSchema))`, `returns('PackTemplateView', PackTemplateViewSchema)`).

- [ ] **Step 5: Gate**

Run the shared build, the API typecheck and eslint on `apps/api/src/packs`.
Expected: clean. The API dev server reloads; `GET /api/health` answers.

- [ ] **Step 6: Measure (psql now; curl once a session is allowed)**

```sql
-- what the default must pick for Base Set: Charizard base1-4 (Rare Holo, $928.32 in the dev mirror)
select id, name, rarity, "latestPriceUsd" from cards where "setId" in ('base1','base2')
order by "latestPriceUsd" desc nulls last, id limit 3;
-- a set with no prices: me4 — the pick must be the first id of its top tier
select rarity, count(*) from cards where "setId" = 'me4' group by rarity;
```

With a session: `GET /api/packs/templates` → the Base Set template's `art.cover.id` is `base1-4`, `coverIsDefault: true`, `art.set` `{ name: 'Base', series: 'Base' }` with a logo. A1 of the spec.

- [ ] **Step 7: Commit**

```bash
git add packages/shared apps/api/prisma apps/api/src/packs apps/web/lib/design/rarity.ts
git commit -F - <<'EOF'
[PD-136]: resolve each template's pack art on every template read

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 3: Admin writes take the cover and the image URL; seed name

**Files:**
- Modify: `apps/api/src/packs/pack-templates.service.ts:44-108`
- Modify: `apps/api/prisma/seed.ts:402`

**Interfaces:**
- Consumes: Task 1's `CreatePackTemplate` / `UpdatePackTemplate` with `coverCardId` and `imageUrl`.
- Produces: `POST`/`PATCH /admin/pack-templates` storing both, refusing a cover outside the sets.

- [ ] **Step 1: The cover check**

Beside `assertPool`:

```ts
async function assertCover(
  tx: TransactionClient,
  setFilter: SetFilter,
  coverCardId: string | null,
): Promise<void> {
  if (coverCardId === null) return;
  const card = await tx.card.findFirst({
    where: { id: coverCardId, setId: { in: setFilter.setIds } },
    select: { id: true },
  });
  if (card === null) {
    throw new BadRequestException("The featured card is not in this pack's sets");
  }
}
```

- [ ] **Step 2: Create**

After `assertPool` in `create`: `await assertCover(tx, input.setFilter, input.coverCardId ?? null);` and the `data` gains `coverCardId: input.coverCardId ?? null, imageUrl: input.imageUrl ?? null`.

- [ ] **Step 3: Update**

Replace the pool block so `current` is computed once:

```ts
      const current = toTemplate(existing);
      if (patch.setFilter !== undefined || patch.slotConfig !== undefined) {
        await assertPool(
          tx,
          patch.setFilter ?? current.setFilter,
          patch.slotConfig ?? current.slotConfig,
        );
      }
      if (patch.setFilter !== undefined || patch.coverCardId !== undefined) {
        await assertCover(
          tx,
          patch.setFilter ?? current.setFilter,
          patch.coverCardId === undefined ? current.coverCardId : patch.coverCardId,
        );
      }
```

(keep the existing comment above the pool check), and the `data` gains:

```ts
          ...(patch.coverCardId === undefined ? {} : { coverCardId: patch.coverCardId }),
          ...(patch.imageUrl === undefined ? {} : { imageUrl: patch.imageUrl }),
```

- [ ] **Step 4: Seed**

`name: 'Base Set Booster'` → `name: 'Base Set Booster Pack'`. The dev database keeps its row; rename it through the editor or `PATCH` when measuring (it is audited).

- [ ] **Step 5: Gate**

API typecheck and eslint on `apps/api/src/packs`; `pnpm exec eslint apps/api/prisma/seed.ts --max-warnings=0`.

- [ ] **Step 6: Measure (needs an admin session)**

A2–A5 of the spec:
- `PATCH /api/admin/pack-templates/seed-template-base` `{"coverCardId":"base1-2"}` → 200, `art.cover.id` `base1-2`, `coverIsDefault: false`; `GET /api/admin/audit?action=pack_template.update` first row has `meta.changes.coverCardId`;
- `{"coverCardId":"sv8-1"}` → 400 *The featured card is not in this pack's sets*; `{"coverCardId":"nope"}` → the same 400; `{"setFilter":{"setIds":["base2"]}}` while the cover is `base1-2` → the same 400;
- `{"coverCardId":null}` → `base1-4`, `coverIsDefault: true`;
- `{"imageUrl":"http://example.com/a.png"}` → 400 *Use an https:// address*; `{"imageUrl":"https://example.com/a.png"}` → in `art.imageUrl`; `{"imageUrl":null}` → cleared;
- `{"name":"Base Set Booster Pack"}` → renamed;
- a member's cookie → 403; none → 401.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/packs apps/api/prisma/seed.ts
git commit -F - <<'EOF'
[PD-136]: let admins choose the featured card and a pack image

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 4: `BoosterPack`

**Files:**
- Create: `apps/web/components/packs/booster-pack.tsx`
- Modify: `apps/web/app/globals.css` (tokens in `:root`, colours in `@theme inline`, two utilities)
- Modify: `apps/web/app/(dev)/dev/components/_sections/data-display.tsx` (a specimen group)

**Interfaces:**
- Consumes: `PackArt` (Task 1), `energyStyle`, `RARITY_STYLES`, `rarityTier`, `isOptimizable`.
- Produces: `BoosterPack({ art, name, cardCount, size, sheen, className }: { art: PackArt | null; name: string; cardCount?: number; size: 'sm' | 'md' | 'lg' | 'xl'; sheen?: 'loop' | 'hover' | 'none'; className?: string })`. `sheen: 'hover'` runs the sheen when an ancestor with the class `group/pack` is hovered.

- [ ] **Step 1: Tokens and utilities**

In `:root`, after `--card-back`:

```css
  --booster-ink: #fff;
  --booster-shade: rgba(0, 0, 0, 0.28);
  --booster-sheen: rgba(255, 255, 255, 0.5);
```

In `@theme inline`, beside `--color-card-face-end`:

```css
  --color-booster-ink: var(--booster-ink);
  --color-booster-shade: var(--booster-shade);
  --color-booster-sheen: var(--booster-sheen);
```

After `@utility bg-card-face`:

```css
/* A booster's foil: set --energy like bg-card-face. */
@utility bg-booster {
  background: linear-gradient(165deg, var(--energy, var(--e-colorless)) 10%, var(--card-face-end) 95%);
}

/* The crimped seal: small teeth along the top and bottom edges. */
@utility booster-crimp {
  mask:
    conic-gradient(from 135deg at top, #0000, #000 1deg 89deg, #0000 90deg) top / 8px 51% repeat-x,
    conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / 8px 51% repeat-x;
}
```

- [ ] **Step 2: The component**

`apps/web/components/packs/booster-pack.tsx`:

```tsx
'use client';

import type { PackArt } from '@pokedrop/shared';
import Image from 'next/image';
import { type CSSProperties, useState } from 'react';
import { energyStyle } from '@/lib/design/energy';
import { RARITY_STYLES, rarityTier } from '@/lib/design/rarity';
import { isOptimizable } from '@/lib/images';
import { cn } from '@/lib/utils';

type Size = 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<
  Size,
  { box: string; pad: string; logo: string; set: string; name: string; count: string; icon: string; px: number }
> = {
  sm: { box: 'w-18', pad: 'gap-1 px-1.5 py-2.5', logo: 'h-4', set: 'text-[7px]', name: 'hidden', count: 'hidden', icon: 'size-4', px: 72 },
  md: { box: 'w-37.5', pad: 'gap-2 px-3 py-4', logo: 'h-9', set: 'text-[11px]', name: 'text-[12px]', count: 'text-[10px]', icon: 'size-8', px: 150 },
  lg: { box: 'w-55', pad: 'gap-3 px-4 py-5', logo: 'h-12', set: 'text-small', name: 'text-[15px]', count: 'text-[12px]', icon: 'size-11', px: 220 },
  xl: { box: 'w-75', pad: 'gap-4 px-5 py-6', logo: 'h-16', set: 'text-body', name: 'text-h3', count: 'text-small', icon: 'size-14', px: 300 },
};

/** A booster wrapper: an admin's photo, or one drawn from the set logo and the featured card. */
export function BoosterPack({
  art,
  name,
  cardCount,
  size,
  sheen = 'none',
  className,
}: {
  art: PackArt | null;
  name: string;
  cardCount?: number;
  size: Size;
  sheen?: 'loop' | 'hover' | 'none';
  className?: string;
}) {
  const s = SIZES[size];
  const [photoFailed, setPhotoFailed] = useState<string | null>(null);
  const photo = art?.imageUrl && photoFailed !== art.imageUrl ? art.imageUrl : null;

  return (
    <div
      role="img"
      aria-label={`${name} booster pack`}
      className={cn('relative aspect-[5/8] shrink-0', s.box, className)}
    >
      {photo ? (
        <Image
          src={photo}
          alt=""
          fill
          sizes={`${s.px}px`}
          unoptimized={!isOptimizable(photo)}
          onError={() => setPhotoFailed(photo)}
          className="object-contain"
        />
      ) : (
        <DrawnWrapper art={art} name={name} cardCount={cardCount} sheen={sheen} s={s} />
      )}
    </div>
  );
}

function DrawnWrapper({
  art,
  name,
  cardCount,
  sheen,
  s,
}: {
  art: PackArt | null;
  name: string;
  cardCount: number | undefined;
  sheen: 'loop' | 'hover' | 'none';
  s: (typeof SIZES)[Size];
}) {
  const energy = energyStyle(art?.cover?.type ?? 'Colorless');
  const Icon = energy.icon;
  const rarity = RARITY_STYLES[rarityTier(art?.cover?.rarity ?? null)];
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const fail = (src: string) => setFailed((prev) => new Set(prev).add(src));
  const logo = art?.set.logoUrl && !failed.has(art.set.logoUrl) ? art.set.logoUrl : null;
  const cover = art?.cover && !failed.has(art.cover.image) ? art.cover : null;

  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-tag bg-booster booster-crimp text-booster-ink"
      style={{ '--energy': energy.face, '--rarity': rarity.color } as CSSProperties}
    >
      <div aria-hidden className="absolute inset-x-0 top-0 h-1/16 bg-booster-shade" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/16 bg-booster-shade" />
      {sheen === 'none' ? null : (
        <div
          aria-hidden
          className={cn(
            'absolute inset-y-0 w-1/4 bg-linear-90 from-transparent via-booster-sheen to-transparent',
            sheen === 'loop'
              ? 'animate-sweep'
              : '-translate-x-[140%] -skew-x-18 transition-transform duration-700 group-hover/pack:translate-x-[420%]',
          )}
        />
      )}
      <div className={cn('relative flex h-full flex-col items-center', s.pad)}>
        <div className={cn('relative flex w-full items-center justify-center', s.logo)}>
          {logo ? (
            <Image
              src={logo}
              alt=""
              fill
              sizes={`${s.px}px`}
              unoptimized={!isOptimizable(logo)}
              onError={() => fail(logo)}
              className="object-contain"
            />
          ) : (
            <span className={cn('truncate font-extrabold tracking-tight uppercase', s.set)}>
              {art?.set.name ?? name}
            </span>
          )}
        </div>
        <div className="relative w-full flex-1 overflow-hidden rounded-tile border-2 border-(--rarity) bg-card-face">
          {cover ? (
            <Image
              src={cover.image}
              alt=""
              fill
              sizes={`${s.px}px`}
              unoptimized={!isOptimizable(cover.image)}
              onError={() => fail(cover.image)}
              className="object-cover object-[50%_22%]"
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center">
              <Icon aria-hidden className={cn('text-booster-ink', s.icon)} />
            </span>
          )}
        </div>
        <div className="flex w-full flex-col items-center text-center">
          <span className={cn('line-clamp-2 leading-tight font-extrabold', s.name)}>{name}</span>
          {cardCount !== undefined ? (
            <span className={cn('font-mono font-semibold opacity-85', s.count)}>
              {cardCount} cards
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
```

The reveal passes `sheen="loop"` (the `sweep` keyframes `PackArt` used); the `/packs` card passes `sheen="hover"`; the dashboard and the editor `none`. Under reduced motion the global rule ends both at once.

- [ ] **Step 3: Gallery specimens**

In `data-display.tsx`, a `Specimen name="BoosterPack (sizes, fallbacks)"` rendering:
- `md` and `xl` with a full art (`set` Base / logo `https://images.pokemontcg.io/base1/logo.png`, cover Charizard `https://images.pokemontcg.io/base1/4_hires.png`, type `Fire`, rarity `Rare Holo`);
- `sm` and `lg` of the same;
- `md` with `art: null`;
- `md` with `logoUrl: 'https://images.pokemontcg.io/nope/logo.png'` (logo fails → set name);
- `md` with a cover image `https://images.pokemontcg.io/nope/1_hires.png` (cover fails → energy icon);
- `md` with `imageUrl: 'https://example.invalid/pack.png'` (photo fails → drawn wrapper).

The `PackTemplateCard` specimens get an `art` sample in Task 5.

- [ ] **Step 4: Gate**

Web typecheck; eslint on `apps/web/components/packs` and `apps/web/app/(dev)`; prettier.

- [ ] **Step 5: Measure (signed out, `/dev/components`)**

- every specimen renders a full wrapper; the three broken ones show the set name, the energy icon and the drawn wrapper;
- each wrapper's box keeps `aspect-ratio` 5 / 8 before and after the images load (read `getBoundingClientRect` before and after);
- console: only the deliberate `ERR_NAME_NOT_RESOLVED` / 404s of the broken URLs, no React or `next/image` error;
- a screenshot of the specimen group.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/packs/booster-pack.tsx apps/web/app/globals.css "apps/web/app/(dev)/dev/components/_sections/data-display.tsx"
git commit -F - <<'EOF'
[PD-136]: draw booster wrappers from the set logo and a featured card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 5: The wrapper on `/packs`, the dashboard and the reveal

**Files:**
- Modify: `apps/web/components/packs/pack-template-card.tsx`
- Modify: `apps/web/components/packs/packs-grid.tsx:58-66`
- Modify: `apps/web/components/dashboard/dashboard.tsx:85-100`
- Modify: `apps/web/components/packs/reveal/sealed-stage.tsx`, `opening-stage.tsx`, `pack-reveal.tsx`
- Delete: `apps/web/components/packs/reveal/pack-art.tsx`
- Modify: `apps/web/app/(dev)/dev/components/_sections/data-display.tsx:169-200`

**Interfaces:**
- Consumes: `BoosterPack` (Task 4), `PackTemplateView.art` (Task 2).
- Produces: `PackTemplateCard` props `{ template: { name; cost; cardCount; guarantee }; art: PackArt | null; tag?; balance?; onOpen; className? }` (the `type` prop removed); `SealedStage` / `OpeningStage` take `art: PackArt | null` beside `name`.

- [ ] **Step 0: Lighthouse before (B6)**

Signed in, before the first edit of this task: Lighthouse on `/packs`, desktop and mobile; keep the four figures of each for Task 7.

- [ ] **Step 1: `PackTemplateCard`**

Replace the art area (`<div className="relative flex h-42.5 …">…</div>`) with:

```tsx
      <div className="group/pack relative flex h-60 items-center justify-center overflow-hidden bg-surface-2">
        <BoosterPack
          art={art}
          name={template.name}
          cardCount={template.cardCount}
          size="md"
          sheen="hover"
          className="-rotate-6 transition duration-300 group-hover/pack:-translate-y-1.5 group-hover/pack:rotate-0 motion-reduce:transition-none"
        />
        {tag ? (
          <span className="absolute top-3 left-3 rounded-pill bg-booster-shade px-2.5 py-1 text-[11px] font-semibold text-booster-ink backdrop-blur-sm">
            {tag}
          </span>
        ) : null}
      </div>
```

Remove the `type` prop, `energyStyle`, `Icon`, the `CSSProperties` import. Above the `h3`:

```tsx
          {art ? (
            <p className="text-small text-faint">
              {art.set.name === art.set.series || art.set.series === ''
                ? art.set.name
                : `${art.set.name} · ${art.set.series}`}
            </p>
          ) : null}
```

and the meta line keeps only the guarantee (delete the `{template.cardCount} cards` span and the dot).

- [ ] **Step 2: Callers**

`packs-grid.tsx`: pass `art={template.art}`. The gallery's three `PackTemplateCard` specimens: drop `type`, pass the Task 4 sample `art` (one with `art={null}`).

`dashboard.tsx`, the featured link: replace `<PackageOpen aria-hidden className="size-6 text-pri" />` with

```tsx
                <BoosterPack art={template.art} name={template.name} size="sm" className="self-center" />
```

and make the link `items-center text-center`; drop the `PackageOpen` import if unused.

- [ ] **Step 3: The reveal**

`sealed-stage.tsx` and `opening-stage.tsx`: props gain `art: PackArt | null`; `<PackArt name={name} />` becomes `<BoosterPack art={art} name={name} size="xl" sheen="loop" />`; import `BoosterPack` from `../booster-pack`. `pack-reveal.tsx`: where `name` is derived, add `const art = template?.art ?? null;` and pass `art={art}` to both stages. Delete `pack-art.tsx`.

- [ ] **Step 4: Gate**

Web typecheck; eslint on `apps/web/components/packs`, `apps/web/components/dashboard`, `apps/web/app/(dev)`; `grep -rn "pack-art" apps/web` finds nothing.

- [ ] **Step 5: Measure**

Signed out: the `PackTemplateCard` specimens — wrapper, set line, no *8 cards ·*; hover lifts and straightens; at 375 px `scrollWidth` 375.
Signed in (once allowed): B1 (`/packs`, the dashboard, the sealed stage show the same wrapper), B5 (float, shake, flash as before), B7 (375 px), B8 (reduced motion: no hover lift, no float).

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/packs apps/web/components/dashboard "apps/web/app/(dev)/dev/components/_sections/data-display.tsx"
git commit -F - <<'EOF'
[PD-136]: show the booster wrapper on packs, the dashboard and the reveal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 6: The editor's *Pack art* section and the cover picker

**Files:**
- Create: `apps/web/components/admin/packs/cover-card-picker.tsx`
- Modify: `apps/web/components/admin/packs/template-draft.ts`
- Modify: `apps/web/components/admin/packs/template-editor.tsx`
- Modify: `apps/web/components/admin/packs/admin-packs.tsx`
- Modify: `apps/web/lib/api/endpoints/admin.ts:32-39`

**Interfaces:**
- Consumes: `PackTemplateView` (Task 2), `BoosterPack` (Task 4), `useCatalogBrowse`, `useSets`, `SearchInput` (debounces itself, `onSearch`), `CardTile`, `cardView`, `Dialog`.
- Produces: `TemplateDraft.coverCardId: string | null`, `TemplateDraft.cover: PackArt['cover']` (the picked card, for the preview), `TemplateDraft.imageUrl: string`; `CoverCardPicker({ open, setIds, onPick, onClose })`.

- [ ] **Step 1: Endpoints answer views**

In `lib/api/endpoints/admin.ts`, `adminPackTemplates`, `createPackTemplate` and `updatePackTemplate` parse with `PackTemplateViewSchema` (`z.array(PackTemplateViewSchema)` for the list). `admin-packs.tsx` and the editor type templates as `PackTemplateView`; `onSaved` receives a `PackTemplateView`.

- [ ] **Step 2: The draft**

`template-draft.ts`:

```ts
export type TemplateDraft = {
  name: string;
  cost: string;
  setIds: string[];
  slots: DraftSlot[];
  active: boolean;
  coverCardId: string | null;
  /** The picked card, for the preview; the saved view's cover until something is picked. */
  cover: PackArt['cover'];
  imageUrl: string;
};
```

`NEW_DRAFT` gains `coverCardId: null, cover: null, imageUrl: ''`. `draftOf(template: PackTemplateView)` gains `coverCardId: template.coverCardId, cover: template.art.cover, imageUrl: template.imageUrl ?? ''`. `bodyOf` gains `coverCardId: draft.coverCardId as CreatePackTemplate['coverCardId'], imageUrl: draft.imageUrl.trim() === '' ? null : draft.imageUrl.trim()`. `problemsOf` maps `head === 'imageUrl'` to `add('imageUrl', 'Use an https:// address')`. `changesOf` gains:

```ts
  if (body.coverCardId !== original.coverCardId) changes.coverCardId = body.coverCardId;
  if (body.imageUrl !== original.imageUrl) changes.imageUrl = body.imageUrl;
```

- [ ] **Step 3: Changing the sets clears a chosen cover**

In the editor, `SetPicker`'s `onChange` becomes:

```tsx
        onChange={(setIds) => edit({ setIds, coverCardId: null, cover: null })}
```

so a set change always travels with `coverCardId: null` when a cover had been chosen (`changesOf` sends it because it differs from the saved one).

- [ ] **Step 4: `CoverCardPicker`**

```tsx
'use client';

import { useState } from 'react';
import { CardTile } from '@/components/cards/card-tile';
import { cardView } from '@/components/cards/card-data';
import { Dialog } from '@/components/ui/dialog';
import { SearchInput } from '@/components/ui/search-input';
import { useCatalogBrowse, useSets } from '@/lib/query/catalog';
import type { Card } from '@pokedrop/shared';

export function CoverCardPicker({
  open,
  setIds,
  onPick,
  onClose,
}: {
  open: boolean;
  setIds: string[];
  onPick: (card: Card) => void;
  onClose: () => void;
}) {
  const sets = useSets();
  const [setId, setSetId] = useState(setIds[0] ?? '');
  const [q, setQ] = useState('');
  const browse = useCatalogBrowse({ set: setId, ...(q ? { q } : {}) });
  const cards = browse.data?.pages.flatMap((page) => page.items) ?? [];
  const name = (id: string) => sets.data?.find((set) => set.id === id)?.name ?? id;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? null : onClose())}
      title="Choose the featured card"
      description="Its art goes in the middle of the wrapper, and its type colours it."
      className="max-w-180"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Set">
          {setIds.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={id === setId}
              onClick={() => setSetId(id)}
              className="focus-ring rounded-pill border border-bd-2 px-3 py-1 text-small aria-pressed:border-pri aria-pressed:bg-pri-dim"
            >
              {name(id)}
            </button>
          ))}
        </div>
        <SearchInput label="Search this set" value={q} onSearch={(next) => setQ(next.trim())} />
        <div className="overflow-y-auto pr-1" style={{ height: '50dvh' }}>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {cards.map((card) => (
              <li key={card.id}>
                <CardTile card={cardView(card)} sizes="120px" onSelect={() => onPick(card)} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}
```

`SearchInput` takes `value` and `onSearch` and debounces 300 ms itself; `Dialog` takes `open`, `onOpenChange`, `title`, `description`, `className`. Check the catalog page's item type (`CardSearchResult['items'][number]`) matches `Card`, and use the trade picker's load-more pattern if a set has more than one page (100 cards).

- [ ] **Step 5: The section**

In the editor, after `SetPicker`:

```tsx
      <section aria-labelledby="art-heading" className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
        <BoosterPack art={previewArt} name={draft.name || 'New pack'} cardCount={cardTotal} size="lg" />
        <div className="flex flex-col gap-4">
          <h3 id="art-heading" className="text-h3">Pack art</h3>
          <div className="flex flex-col gap-2">
            <span className="text-small text-mut">Featured card</span>
            <p className="text-body text-tx">
              {draft.cover ? draft.cover.name : 'The featured card is chosen when you save'}
              <span className="ml-2 text-small text-faint">
                {draft.coverCardId ? 'Chosen' : 'Default — highest rarity'}
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" disabled={draft.setIds.length === 0} onClick={() => setPicking(true)}>
                Choose…
              </Button>
              {draft.coverCardId ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => edit({ coverCardId: null, cover: defaultCover })}>
                  Use default
                </Button>
              ) : null}
            </div>
          </div>
          <Input
            label="Pack image address"
            help="Optional: a photo you may use replaces the drawn wrapper"
            value={draft.imageUrl}
            maxLength={2048}
            onChange={(event) => edit({ imageUrl: event.target.value })}
            error={problems.get('imageUrl')}
          />
        </div>
      </section>
      <CoverCardPicker
        open={picking}
        setIds={draft.setIds}
        onClose={() => setPicking(false)}
        onPick={(card) => {
          setPicking(false);
          edit({
            coverCardId: card.id,
            cover: { id: card.id, name: card.name, image: card.imageLarge, type: card.types[0] ?? null, rarity: card.rarity },
          });
        }}
      />
```

with, in the component body:

```tsx
  const [picking, setPicking] = useState(false);
  const sets = useSets();
  const firstSet = sets.data?.find((set) => set.id === draft.setIds[0]);
  // The saved default, offered back by "Use default" while the sets are the saved ones.
  const defaultCover =
    template?.art.coverIsDefault && sameSets(template, draft) ? template.art.cover : null;
  const previewArt: PackArt | null = firstSet
    ? {
        set: { id: firstSet.id, name: firstSet.name, series: firstSet.series, logoUrl: firstSet.logoUrl },
        cover: draft.cover,
        coverIsDefault: draft.coverCardId === null,
        imageUrl: draft.imageUrl.trim() === '' ? null : draft.imageUrl.trim(),
      }
    : null;
  const cardTotal = previewSlots(draft).reduce((sum, slot) => sum + slot.count, 0);
```

and `sameSets(template, draft)` exported from `template-draft.ts`: the sorted comparison `changesOf` already does, extracted and reused there. `Input` takes `help`.

- [ ] **Step 6: Gate**

Web typecheck; eslint on `apps/web/components/admin/packs` and `apps/web/lib/api`; prettier.

- [ ] **Step 7: Measure (admin session)**

B2 and B3 of the spec: *Choose…* → pick *Blastoise* → the preview changes before saving; save → `/packs` shows Blastoise on reload; *Use default* → Charizard after saving; adding `base2` clears a chosen cover and the save goes through (no 400); an image URL saved → the photo on `/packs`, the dashboard, the editor and the sealed stage; cleared → the drawn wrapper; `http://…` → *Use an https:// address* under the field and Save disabled.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/admin/packs apps/web/lib/api/endpoints/admin.ts
git commit -F - <<'EOF'
[PD-136]: choose a pack's featured card and image in the editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 7: Documentation and the final measurements

**Files:**
- Modify: `docs/API.md` (*Packs*, admin pack templates), `docs/DataModel.md` (*PackTemplate*), `docs/Migrations.md` (only if it lists migrations), `docs/Pages.md` (*Packs*, *Pack reveal*, *Dashboard*, *Admin packs*), `docs/Components.md` (a *Booster wrapper (PD-136)* section), `docs/DesignSystem.md` (the three `--booster-*` tokens)

- [ ] **Step 1: Docs**

Write what the spec's *Documentation* section lists, from what was built: the `art` object and its default rule, the two fields and the 400s, the wrapper's sizes and fallbacks, the editor section. Replace every mention of `PackArt` in `docs/` with `BoosterPack`.

- [ ] **Step 2: Lighthouse (B6)**

`/packs`, desktop and mobile. Take the *before* figures at the start of Task 5, before its first edit, and the *after* figures here; record both. Expected: no category lower than before.

- [ ] **Step 3: B4, B7, B8**

B4 comes from the gallery's broken-URL specimens (Task 4) plus one live case: an `imageUrl` on a host that does not answer, saved through the editor, shows the drawn wrapper on `/packs`. Then 375 px on `/packs`, the dashboard, the editor and the reveal, and reduced motion; record all three.

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -F - <<'EOF'
[PD-136]: document the booster wrapper, pack art and what it measured

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
