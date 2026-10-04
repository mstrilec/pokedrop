# PD-104 + PD-105 Pack Opening Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/packs` (choose a pack, confirm its cost) and `/packs/open` (sealed → opening → reveal → summary), with the URL as the hand-off and the tap on the sealed pack as the one request that spends coins.

**Architecture:** The confirm dialog creates an `openId` and navigates to `/packs/open?template=…&open=…`; it sends nothing. `PackReveal` drives the existing `usePackReveal` store and `useOpenPack` mutation: the tap sends `open` and the request together, and `opened` waits for both the answer and a minimum time. A per-tab mark turns a reload after the opening into a free replay that lands on the summary.

**Tech Stack:** Next 16.3 App Router, React 19.2, TanStack Query 5, Zustand 5, Tailwind 4 tokens, existing components (`Dialog`, `PackTemplateCard`, `RevealCard`, `CardTile`, `EmptyState`, `ListError`, `PageHeader`).

**Spec:** `docs/superpowers/specs/2026-10-04-pd-104-pd-105-pack-opening-flow-design.md`

## Global Constraints

- No automated tests in v1: each task's cycle is `pnpm --filter @pokedrop/web typecheck` + `npx eslint apps/web/...`, and the user-visible behaviour is measured in a browser in Task 6.
- No hex colors or arbitrary spacing lengths in `apps/web` (lint): colors from tokens in `app/globals.css`.
- Commits go straight to `dev`, header `[PD-104]: …` or `[PD-105]: …`, at most 72 characters, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Code comments only where they carry a reason the code cannot; rationale belongs in `docs/Pages.md`.
- Nothing changes in `apps/api`, `packages/shared` or `apps/web/lib/stores/reveal-machine.ts`.
- Opening minimum 2 s (`OPENING_MIN_MS = 2000`), *Still opening…* after 6 s (`STILL_OPENING_MS = 6000`), minimum 0 under `prefers-reduced-motion: reduce`.
- The opened mark is `sessionStorage['pokedrop.opened.<openId>'] = '1'`; every storage access in try/catch.
- Errors of the opening are shown in place; the mutation carries `meta: { toast: false }`.

## Review Focus

1. **A double activation of *Tap to open*** must send one request: the button disappears with `sealed`, and the machine ignores `open` outside `sealed`. Measured in Task 6, check 2.
2. **Back during `opening`, then Forward** must land on the summary with the cards, not on a second *Tap to open*: the request finishes and marks the `openId` even after the component unmounted. Measured in Task 6, check 11.
3. **The same `/packs/open?…` URL in a second tab** (no mark there) shows `sealed`; tapping replays the same cards and writes no second ledger row. Measured in Task 6, check 12.
4. **A template deactivated between the packs page and the tap** answers 404: the reveal shows the API's sentence and *Back to packs*, nothing charged. Measured in Task 6, check 13.
5. **A reload before the tap** (no mark) keeps `sealed` with the same `openId`, so the eventual tap is still the only charge. Measured in Task 6, check 6 (its first half).

---

## File structure

| File | Responsibility |
| --- | --- |
| `apps/web/lib/motion.ts` | `prefersReducedMotion()`, shared by `CurrencyPill` and the reveal |
| `apps/web/lib/pack-open-flow.ts` | the URL contract (`openUrl`, `parseOpenParams`) and the opened mark (`markOpened`, `wasOpened`) |
| `apps/web/lib/api/endpoints/packs.ts` | `packTemplates()` added |
| `apps/web/lib/query/keys.ts` | `packs.templates` added |
| `apps/web/lib/query/packs.ts` | `usePackTemplates()` added; `useOpenPack()` carries `meta: { toast: false }` |
| `apps/web/components/packs/confirm-open-dialog.tsx` | the cost-and-guarantee dialog, used by `/packs` and the summary |
| `apps/web/components/packs/packs-grid.tsx` | the `/packs` body |
| `apps/web/app/globals.css` | motion tokens |
| `apps/web/components/packs/reveal/pack-art.tsx` | the sealed pack drawing, used by two stages |
| `apps/web/components/packs/reveal/sealed-stage.tsx` | sealed, with the failure messages |
| `apps/web/components/packs/reveal/opening-stage.tsx` | opening |
| `apps/web/components/packs/reveal/reveal-stage.tsx` | one card at a time |
| `apps/web/components/packs/reveal/summary-stage.tsx` | the pulls and *Open another* |
| `apps/web/components/packs/reveal/pack-reveal.tsx` | orchestration: store, request, timers, replay |
| `apps/web/app/(app)/packs/page.tsx`, `apps/web/app/(app)/packs/open/page.tsx` | the two routes |
| `docs/Pages.md` | the two sections and their measurements |

---

### Task 1: Data layer and the hand-off contract

**Files:**
- Create: `apps/web/lib/motion.ts`
- Create: `apps/web/lib/pack-open-flow.ts`
- Modify: `apps/web/lib/api/endpoints/packs.ts`
- Modify: `apps/web/lib/query/keys.ts` (the `packs` entry)
- Modify: `apps/web/lib/query/packs.ts`
- Modify: `apps/web/components/ui/currency-pill.tsx:24-26` (use the shared helper)

**Interfaces:**
- Produces: `prefersReducedMotion(): boolean`; `openUrl(templateId: PackTemplateId): string`; `parseOpenParams(params: Record<string, string | string[] | undefined>): OpenParams | null` with `type OpenParams = { templateId: PackTemplateId; openId: string }`; `markOpened(openId: string): void`; `wasOpened(openId: string): boolean`; `packTemplates()`; `keys.packs.templates`; `usePackTemplates()` returning `UseQueryResult<PackTemplateView[]>`; `useOpenPack()` (unchanged signature, now `meta: { toast: false }`).

- [ ] **Step 1: Create `apps/web/lib/motion.ts`**

```ts
/** For timers and frames: the CSS reduced-motion rule cannot reach them. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
```

- [ ] **Step 2: Use it in `CurrencyPill`**

In `apps/web/components/ui/currency-pill.tsx`, delete the local function

```ts
function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
```

and add `import { prefersReducedMotion } from '@/lib/motion';` with the other `@/lib` imports. The comment above `useCountTo` stays.

- [ ] **Step 3: Create `apps/web/lib/pack-open-flow.ts`**

```ts
import { type PackTemplateId, PackTemplateIdSchema } from '@pokedrop/shared';
import { z } from 'zod';

// /packs/open?template=<templateId>&open=<openId> is the whole hand-off from
// the confirm dialog to the reveal. The tap on the sealed pack is the request.
export type OpenParams = { templateId: PackTemplateId; openId: string };

const OPENED_PREFIX = 'pokedrop.opened.';
const OpenIdSchema = z.uuid();

export function openUrl(templateId: PackTemplateId): string {
  const params = new URLSearchParams({ template: templateId, open: crypto.randomUUID() });
  return `/packs/open?${params.toString()}`;
}

export function parseOpenParams(
  params: Record<string, string | string[] | undefined>,
): OpenParams | null {
  const template = PackTemplateIdSchema.safeParse(params.template);
  const open = OpenIdSchema.safeParse(params.open);
  return template.success && open.success
    ? { templateId: template.data, openId: open.data }
    : null;
}

/** Set once the opening's answer arrived, so a reload replays it instead of offering a second tap. */
export function markOpened(openId: string): void {
  try {
    sessionStorage.setItem(`${OPENED_PREFIX}${openId}`, '1');
  } catch {
    // Storage refused: a reload then shows the sealed pack, and the tap replays for free.
  }
}

export function wasOpened(openId: string): boolean {
  try {
    return sessionStorage.getItem(`${OPENED_PREFIX}${openId}`) === '1';
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Add the templates endpoint**

In `apps/web/lib/api/endpoints/packs.ts` add `PackTemplateViewSchema` to the `@pokedrop/shared` import, change `import type { z } from 'zod';` to `import { z } from 'zod';`, and append:

```ts
export const packTemplates = () => get('/packs/templates', z.array(PackTemplateViewSchema));
```

- [ ] **Step 5: Add the key**

In `apps/web/lib/query/keys.ts` the `packs` entry becomes:

```ts
  packs: {
    all: ['packs'],
    history: ['packs', 'history'],
    templates: ['packs', 'templates'],
  },
```

- [ ] **Step 6: Add the query and silence the mutation's toast**

In `apps/web/lib/query/packs.ts`: change the hooks import to `import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';`, the endpoints import to `import { openPack, packHistory, packTemplates } from '@/lib/api/endpoints/packs';`, add

```ts
export function usePackTemplates() {
  return useQuery({ queryKey: keys.packs.templates, queryFn: () => api.call(packTemplates()) });
}
```

and give `useOpenPack`'s `useMutation` options `meta: { toast: false },` after `mutationKey` — the reveal shows every opening error in place, and its comment line above the function gains nothing.

- [ ] **Step 7: Typecheck and lint**

Run: `pnpm --filter @pokedrop/web typecheck` then `npx eslint apps/web/lib apps/web/components/ui/currency-pill.tsx`
Expected: `✓ Types generated successfully`, no TypeScript errors, no lint output.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib apps/web/components/ui/currency-pill.tsx
git commit -m "[PD-104]: add pack templates, the open url and the opened mark

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The packs page and the confirm dialog (PD-104)

**Files:**
- Create: `apps/web/components/packs/confirm-open-dialog.tsx`
- Create: `apps/web/components/packs/packs-grid.tsx`
- Modify: `apps/web/app/(app)/packs/page.tsx` (replace the placeholder)

**Interfaces:**
- Consumes: `usePackTemplates()`, `openUrl()` (Task 1); `useMe()` (`lib/query/me.ts`, `data.currency`); `Dialog` (`open`, `onOpenChange`, `title`, `description`, `icon`, `confirmLabel`, `onConfirm`, `confirming`); `PackTemplateCard` (`template: { name, cost, cardCount, guarantee }`, `balance`, `onOpen`).
- Produces: `ConfirmOpenDialog({ template, onClose, onConfirm }: { template: PackTemplateView | null; onClose: () => void; onConfirm: (template: PackTemplateView) => void })` — used again by the summary in Task 4.

- [ ] **Step 1: Create `apps/web/components/packs/confirm-open-dialog.tsx`**

```tsx
'use client';

import type { PackTemplateView } from '@pokedrop/shared';
import { PackageOpen } from 'lucide-react';
import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { formatCoins } from '@/lib/format';

export function ConfirmOpenDialog({
  template,
  onClose,
  onConfirm,
}: {
  template: PackTemplateView | null;
  onClose: () => void;
  onConfirm: (template: PackTemplateView) => void;
}) {
  // Held until the page navigates away, so a second click finds the dialog busy.
  const [leaving, setLeaving] = useState(false);

  return (
    <Dialog
      open={template !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      icon={PackageOpen}
      title={template ? `Open ${template.name}?` : 'Open pack?'}
      description={
        template ? (
          <>
            {template.guarantee} This action can&rsquo;t be undone.
          </>
        ) : null
      }
      confirmLabel={template ? `Open pack · ${formatCoins(template.cost)}` : 'Open pack'}
      confirming={leaving}
      onConfirm={() => {
        if (!template || leaving) return;
        setLeaving(true);
        onConfirm(template);
      }}
    />
  );
}
```

- [ ] **Step 2: Create `apps/web/components/packs/packs-grid.tsx`**

```tsx
'use client';

import type { PackTemplateView } from '@pokedrop/shared';
import { PackageOpen } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ListError } from '@/components/list-states';
import { PackTemplateCard } from '@/components/packs/pack-template-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { openUrl } from '@/lib/pack-open-flow';
import { useMe } from '@/lib/query/me';
import { usePackTemplates } from '@/lib/query/packs';
import { ConfirmOpenDialog } from './confirm-open-dialog';

const GRID = 'grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

export function PacksGrid() {
  const router = useRouter();
  const templates = usePackTemplates();
  const balance = useMe().data?.currency ?? null;
  const [chosen, setChosen] = useState<PackTemplateView | null>(null);

  if (templates.isPending) {
    return (
      <ul aria-busy="true" aria-label="Loading packs" className={GRID}>
        {[0, 1, 2].map((slot) => (
          <li key={slot}>
            <Skeleton shape="block" height="22rem" />
          </li>
        ))}
      </ul>
    );
  }
  if (templates.isError) {
    return <ListError error={templates.error} onRetry={() => void templates.refetch()} />;
  }
  if (templates.data.length === 0) {
    return (
      <EmptyState
        icon={PackageOpen}
        title="No packs on sale right now"
        body="New packs appear here as soon as they are released."
        cta={{ label: 'See your pack history', href: '/packs/history' }}
      />
    );
  }

  const anyUnaffordable =
    balance !== null && templates.data.some((template) => template.cost > balance);

  return (
    <>
      <ul className={GRID}>
        {templates.data.map((template) => (
          <li key={template.id}>
            <PackTemplateCard
              template={{
                name: template.name,
                cost: template.cost,
                cardCount: template.contents.cardCount,
                guarantee: template.guarantee,
              }}
              balance={balance}
              onOpen={() => setChosen(template)}
            />
          </li>
        ))}
      </ul>
      {anyUnaffordable ? (
        <p className="mt-6 text-center text-small text-mut">
          Short of coins?{' '}
          <Link href="/wallet" className="focus-ring rounded-tag font-medium text-pri hover:underline">
            See your wallet
          </Link>
        </p>
      ) : null}
      <ConfirmOpenDialog
        template={chosen}
        onClose={() => setChosen(null)}
        onConfirm={(template) => router.push(openUrl(template.id))}
      />
    </>
  );
}
```

- [ ] **Step 3: Replace `apps/web/app/(app)/packs/page.tsx`**

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { PacksGrid } from '@/components/packs/packs-grid';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Open packs' };

export default function PacksPage() {
  return (
    <>
      <PageHeader
        title="Open packs"
        description="Every pack lists its odds before you open it."
        actions={
          <Button asChild variant="secondary">
            <Link href="/packs/history">Pack history</Link>
          </Button>
        }
      />
      <PacksGrid />
    </>
  );
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm --filter @pokedrop/web typecheck` then `npx eslint apps/web/components/packs apps/web/app`
Expected: no errors, no lint output.

- [ ] **Step 5: Look at it**

With the dev server on :3000 and a signed-in member, open `/packs`: one card per active template (the seed's *Base Set Booster · 300*), *Open* opens a dialog titled *Open Base Set Booster?* whose text is the template's `guarantee` followed by *This action can't be undone.* and whose confirm reads *Open pack · 300*. Confirm navigates to `/packs/open?template=seed-template-base&open=<uuid>` (still the placeholder until Task 5) and the Network panel shows no `POST /api/v1/packs/*/open`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/packs apps/web/app/\(app\)/packs/page.tsx
git commit -m "[PD-104]: add the packs page and the confirm-cost dialog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Motion tokens and the sealed and opening stages

**Files:**
- Modify: `apps/web/app/globals.css` (the `@theme` animation block, after `--animate-float`, and the keyframes after `@keyframes float`)
- Create: `apps/web/components/packs/reveal/pack-art.tsx`
- Create: `apps/web/components/packs/reveal/sealed-stage.tsx`
- Create: `apps/web/components/packs/reveal/opening-stage.tsx`

**Interfaces:**
- Consumes: `ApiError` (`lib/api/core.ts`: `statusCode`, `code`), `apiErrorMessage` (`lib/toast.ts`).
- Produces: utilities `animate-float-pack`, `animate-sweep`, `animate-shake`, `animate-flash`, `animate-burst`, `animate-ray-spin`, `animate-card-in`; `PackArt({ name }: { name: string })`; `SealedStage({ name, error, onOpen }: { name: string; error: unknown; onOpen: () => void })`; `OpeningStage({ name, slow }: { name: string; slow: boolean })`.

- [ ] **Step 1: Add the motion tokens**

In `apps/web/app/globals.css`, after `  --animate-float: float 6s ease-in-out infinite;` add:

```css
  --animate-float-pack: float-pack 5.5s ease-in-out infinite;
  --animate-sweep: sweep 4.5s ease-in-out infinite;
  --animate-shake: shake 0.6s ease-in-out 0.1s 2;
  --animate-flash: flash 1.5s ease-out 0.5s both;
  --animate-burst: burst 1.1s ease-out both;
  --animate-ray-spin: ray-spin 14s linear infinite;
  --animate-card-in: card-in 0.5s var(--ease-reveal) both;
```

and after the `@keyframes float { … }` block add:

```css
  @keyframes float-pack {
    0%,
    100% {
      transform: translateY(0) rotate(-1.5deg);
    }
    50% {
      transform: translateY(-18px) rotate(1.5deg);
    }
  }
  @keyframes sweep {
    0% {
      transform: translateX(-140%) skewX(-18deg);
    }
    100% {
      transform: translateX(240%) skewX(-18deg);
    }
  }
  @keyframes shake {
    0%,
    100% {
      transform: translate(0, 0) rotate(0);
    }
    10%,
    30%,
    50%,
    70%,
    90% {
      transform: translate(-5px, 3px) rotate(-2deg);
    }
    20%,
    40%,
    60%,
    80% {
      transform: translate(5px, -3px) rotate(2deg);
    }
  }
  @keyframes flash {
    0% {
      transform: scale(0);
      opacity: 0;
    }
    35% {
      opacity: 1;
    }
    100% {
      transform: scale(3.4);
      opacity: 0;
    }
  }
  @keyframes burst {
    0% {
      transform: scale(0.3);
      opacity: 0;
    }
    30% {
      opacity: 0.9;
    }
    100% {
      transform: scale(2.2);
      opacity: 0;
    }
  }
  @keyframes ray-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes card-in {
    0% {
      transform: translateY(40px) scale(0.9) rotate(-4deg);
      opacity: 0;
    }
    100% {
      transform: none;
      opacity: 1;
    }
  }
```

- [ ] **Step 2: Create `apps/web/components/packs/reveal/pack-art.tsx`**

```tsx
import { Zap } from 'lucide-react';

export function PackArt({ name }: { name: string }) {
  return (
    <div className="relative h-102.5 w-75 overflow-hidden rounded-modal border border-white/20 bg-linear-160 from-pri to-c-ultra shadow-lg">
      <div aria-hidden className="absolute inset-y-0 w-17.5 animate-sweep bg-linear-90 from-transparent via-white/55 to-transparent" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-6 text-center">
        <span className="flex size-20 items-center justify-center rounded-pill bg-white/15">
          <Zap aria-hidden className="size-10 text-white" />
        </span>
        <span className="text-h2 font-extrabold text-white">{name}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `apps/web/components/packs/reveal/sealed-stage.tsx`**

```tsx
'use client';

import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/core';
import { apiErrorMessage } from '@/lib/toast';
import { PackArt } from './pack-art';

type Failure = { message: string; action: 'retry' | 'wallet' | 'packs' };

function failureOf(error: unknown): Failure {
  if (error instanceof ApiError && error.statusCode === 402) {
    return { message: 'You don’t have enough coins for this pack.', action: 'wallet' };
  }
  if (error instanceof ApiError && (error.statusCode === 404 || error.statusCode === 409)) {
    return { message: apiErrorMessage(error), action: 'packs' };
  }
  return { message: apiErrorMessage(error), action: 'retry' };
}

export function SealedStage({
  name,
  error,
  onOpen,
}: {
  name: string;
  error: unknown;
  onOpen: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);
  const failure = error ? failureOf(error) : null;

  return (
    <div className="flex flex-col items-center gap-11">
      <div
        aria-hidden
        onClick={failure && failure.action !== 'retry' ? undefined : onOpen}
        className="relative animate-float-pack cursor-pointer"
      >
        <span className="absolute -inset-17.5 animate-pulse-glow rounded-pill bg-pri/40 blur-2xl" />
        <PackArt name={name} />
      </div>
      {failure ? (
        <div role="alert" className="flex max-w-sm flex-col items-center gap-3 text-center">
          <p className="text-body text-red">{failure.message}</p>
          {failure.action === 'wallet' ? (
            <Button asChild variant="secondary">
              <Link href="/wallet">Go to wallet</Link>
            </Button>
          ) : failure.action === 'packs' ? (
            <Button asChild variant="secondary">
              <Link href="/packs">Back to packs</Link>
            </Button>
          ) : (
            <Button ref={button} size="lg" icon={Sparkles} onClick={onOpen}>
              Try again
            </Button>
          )}
        </div>
      ) : (
        <Button ref={button} size="lg" icon={Sparkles} onClick={onOpen}>
          Tap to open
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `apps/web/components/packs/reveal/opening-stage.tsx`**

```tsx
import { PackArt } from './pack-art';

export function OpeningStage({ name, slow }: { name: string; slow: boolean }) {
  return (
    <div className="flex flex-col items-center gap-11">
      <div className="relative">
        <div className="animate-shake">
          <span aria-hidden className="absolute -inset-17.5 animate-pulse-glow rounded-pill bg-pri/60 blur-2xl" />
          <PackArt name={name} />
        </div>
        <span
          aria-hidden
          className="absolute inset-0 m-auto size-75 animate-flash rounded-pill bg-[radial-gradient(circle,var(--tx),var(--pri)_40%,transparent_70%)]"
        />
      </div>
      <p role="status" className="h-6 text-body text-mut">
        {slow ? 'Still opening…' : ''}
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @pokedrop/web typecheck` then `npx eslint apps/web/components/packs apps/web/app`
Expected: no errors, no lint output. `Button` spreads `...props` onto its element, so in React 19 its `ref` prop reaches the `<button>`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/globals.css apps/web/components/packs/reveal
git commit -m "[PD-105]: add the reveal's motion tokens, sealed and opening stages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The reveal and summary stages

**Files:**
- Create: `apps/web/components/packs/reveal/reveal-stage.tsx`
- Create: `apps/web/components/packs/reveal/summary-stage.tsx`

**Interfaces:**
- Consumes: `RevealCard` (`card`, `revealed`, `highlight`, `size`), `CardTile` (`card`, `sizes`), `cardView()` (`components/cards/card-data.ts`), `rarityTier`, `isHighRarity`, `RARITY_STYLES` (`lib/design/rarity.ts`), `ConfirmOpenDialog` (Task 2), `formatCoins` (`lib/format.ts`), `formatUsd` (`components/cards/card-data.ts`).
- Produces: `RevealStage({ cards, index, onNext, onSkip }: { cards: PackOpenResult['cards']; index: number; onNext: () => void; onSkip: () => void })`; `SummaryStage({ name, result, template, onOpenAnother }: { name: string; result: PackOpenResult; template: PackTemplateView | undefined; onOpenAnother: (template: PackTemplateView) => void })`.

- [ ] **Step 1: Create `apps/web/components/packs/reveal/reveal-stage.tsx`**

```tsx
'use client';

import type { PackOpenResult } from '@pokedrop/shared';
import { useEffect, useRef, useState } from 'react';
import { RevealCard } from '@/components/cards/reveal-card';
import { cardView } from '@/components/cards/card-data';
import { Button } from '@/components/ui/button';
import { isHighRarity, RARITY_STYLES, rarityTier } from '@/lib/design/rarity';

export function RevealStage({
  cards,
  index,
  onNext,
  onSkip,
}: {
  cards: PackOpenResult['cards'];
  index: number;
  onNext: () => void;
  onSkip: () => void;
}) {
  const [flippedIndex, setFlippedIndex] = useState(-1);
  const flipped = flippedIndex === index;
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);

  const pull = cards[index];
  if (!pull) return null;
  const card = cardView({ ...pull.card, rarity: pull.rarity });
  const tier = rarityTier(pull.rarity);
  const style = RARITY_STYLES[tier];
  const big = isHighRarity(tier);
  const last = index === cards.length - 1;

  function activate() {
    if (flipped) onNext();
    else setFlippedIndex(index);
  }

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <div className="flex w-full max-w-md items-center justify-between">
        <span className="font-mono text-small text-mut">
          {index + 1} / {cards.length}
        </span>
        <Button variant="secondary" size="sm" onClick={onSkip}>
          Skip all →
        </Button>
      </div>

      <div className="relative flex h-8 items-center">
        {flipped && big ? (
          <span className="text-small font-bold tracking-[0.12em] uppercase" style={{ color: style.color }}>
            {style.label} pull
          </span>
        ) : null}
      </div>

      <div aria-hidden onClick={activate} className="relative cursor-pointer">
        {flipped && big ? (
          <>
            <span
              className="pointer-events-none absolute -inset-75 animate-ray-spin rounded-pill opacity-15"
              style={{
                background: `conic-gradient(from 0deg, transparent 0deg, ${style.color} 12deg, transparent 24deg, transparent 36deg, ${style.color} 48deg, transparent 60deg, transparent 72deg, ${style.color} 84deg, transparent 96deg)`,
              }}
            />
            <span
              className="pointer-events-none absolute -inset-30 animate-burst rounded-pill"
              style={{ background: `radial-gradient(circle, ${style.color}, transparent 66%)` }}
            />
          </>
        ) : null}
        <div key={index} className="w-72.5 animate-card-in">
          <RevealCard card={card} revealed={flipped} highlight={tier !== 'Common' && tier !== 'Uncommon'} size="large" />
        </div>
      </div>

      <Button ref={button} size="lg" onClick={activate}>
        {!flipped ? 'Reveal card' : last ? 'See all cards' : 'Next card'}
      </Button>
      <p aria-live="polite" className="sr-only">
        {flipped ? `Card ${index + 1} of ${cards.length}: ${card.name}, ${pull.rarity}` : ''}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/web/components/packs/reveal/summary-stage.tsx`**

```tsx
'use client';

import type { PackOpenResult, PackTemplateView } from '@pokedrop/shared';
import { Check, Layers, PackageOpen } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CardTile } from '@/components/cards/card-tile';
import { cardView, formatUsd } from '@/components/cards/card-data';
import { Button } from '@/components/ui/button';
import { rarityTier } from '@/lib/design/rarity';
import { formatCoins } from '@/lib/format';
import { ConfirmOpenDialog } from '../confirm-open-dialog';

export function SummaryStage({
  name,
  result,
  template,
  onOpenAnother,
}: {
  name: string;
  result: PackOpenResult;
  template: PackTemplateView | undefined;
  onOpenAnother: (template: PackTemplateView) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const [confirming, setConfirming] = useState(false);

  const rareOrBetter = result.cards.filter((pull) => {
    const tier = rarityTier(pull.rarity);
    return tier !== 'Common' && tier !== 'Uncommon';
  }).length;
  const priced = result.cards.filter((pull) => pull.card.latestPriceUsd !== null);
  const value = priced.reduce((sum, pull) => sum + (pull.card.latestPriceUsd ?? 0), 0);
  const unpriced = result.cards.length - priced.length;

  const figures = [
    { label: 'Cards', value: String(result.cards.length) },
    { label: 'Rare or better', value: String(rareOrBetter) },
    { label: 'Market value', value: formatUsd(value) },
    { label: 'Balance', value: `${formatCoins(result.balance)} coins` },
  ];

  return (
    <div className="flex w-full max-w-4xl flex-col items-center gap-6">
      <span className="flex size-15 items-center justify-center rounded-pill border border-grn/30 bg-grn/14 text-grn">
        <Check aria-hidden className="size-7.5" />
      </span>
      <h1 ref={heading} tabIndex={-1} className="text-h1 font-bold outline-none">
        {name} opened
      </h1>
      <dl className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
        {figures.map((figure) => (
          <div key={figure.label} className="flex flex-col-reverse rounded-card border border-bd bg-surface p-4 text-center">
            <dt className="text-caption text-faint uppercase">{figure.label}</dt>
            <dd className="font-mono text-h3 font-bold">{figure.value}</dd>
          </div>
        ))}
      </dl>
      {unpriced > 0 ? (
        <p className="-mt-3 text-caption text-faint">
          {unpriced === 1 ? '1 card has' : `${unpriced} cards have`} no market price yet.
        </p>
      ) : null}
      <h2 className="self-start text-caption text-faint uppercase">Your pulls</h2>
      <ul className="grid w-full grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        {result.cards.map((pull) => (
          <li key={pull.position}>
            <CardTile card={cardView({ ...pull.card, rarity: pull.rarity })} sizes="(min-width: 1024px) 170px, 30vw" />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild variant="secondary" size="lg" icon={Layers}>
          <Link href="/inventory">View in collection</Link>
        </Button>
        {template ? (
          <Button size="lg" icon={PackageOpen} onClick={() => setConfirming(true)}>
            Open another · {formatCoins(template.cost)}
          </Button>
        ) : null}
      </div>
      <ConfirmOpenDialog
        template={confirming && template ? template : null}
        onClose={() => setConfirming(false)}
        onConfirm={onOpenAnother}
      />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm --filter @pokedrop/web typecheck` then `npx eslint apps/web/components/packs`
Expected: no errors, no lint output. `formatUsd` is exported from `components/cards/card-data.ts` (`formatUsd(price: number | null): string`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/packs/reveal
git commit -m "[PD-105]: add the reveal and summary stages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Orchestration and the `/packs/open` route

**Files:**
- Create: `apps/web/components/packs/reveal/pack-reveal.tsx`
- Modify: `apps/web/app/(app)/packs/open/page.tsx` (replace the placeholder)

**Interfaces:**
- Consumes: everything above; `PackRevealProvider`, `usePackReveal` (`lib/stores/pack-reveal.ts`: `stage`, `index`, `send`); events `open`, `opened(total)`, `failed`, `next`, `skip`.
- Produces: `PackReveal({ templateId, openId }: OpenParams)`.

- [ ] **Step 1: Create `apps/web/components/packs/reveal/pack-reveal.tsx`**

```tsx
'use client';

import type { PackOpenResult } from '@pokedrop/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { prefersReducedMotion } from '@/lib/motion';
import { markOpened, type OpenParams, openUrl, wasOpened } from '@/lib/pack-open-flow';
import { useOpenPack, usePackTemplates } from '@/lib/query/packs';
import { usePackReveal } from '@/lib/stores/pack-reveal';
import { OpeningStage } from './opening-stage';
import { RevealStage } from './reveal-stage';
import { SealedStage } from './sealed-stage';
import { SummaryStage } from './summary-stage';

const OPENING_MIN_MS = 2000;
const STILL_OPENING_MS = 6000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const noSubscription = () => () => {};

export function PackReveal({ templateId, openId }: OpenParams) {
  const router = useRouter();
  const stage = usePackReveal((state) => state.stage);
  const index = usePackReveal((state) => state.index);
  const send = usePackReveal((state) => state.send);
  const template = usePackTemplates().data?.find((candidate) => candidate.id === templateId);
  const openPack = useOpenPack();
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);

  const [result, setResult] = useState<PackOpenResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [replaying, setReplaying] = useState(false);
  const [slow, setSlow] = useState(false);
  const started = useRef(false);

  async function start(replay: boolean) {
    setError(null);
    setReplaying(replay);
    send({ type: 'open' });
    const minimum = replay || prefersReducedMotion() ? 0 : OPENING_MIN_MS;
    const slowTimer = replay ? undefined : setTimeout(() => setSlow(true), STILL_OPENING_MS);
    try {
      const [opened] = await Promise.all([
        openPack.mutateAsync({ templateId, openId }),
        delay(minimum),
      ]);
      markOpened(openId);
      setResult(opened);
      send({ type: 'opened', total: opened.cards.length });
      if (replay) send({ type: 'skip' });
    } catch (caught) {
      setError(caught);
      send({ type: 'failed' });
    } finally {
      clearTimeout(slowTimer);
      setSlow(false);
      setReplaying(false);
    }
  }

  // A reload after the opening: replay it (free, the same cards) and go to the summary.
  const replayIfOpened = useEffectEvent(() => {
    if (started.current || !wasOpened(openId)) return;
    started.current = true;
    void start(true);
  });
  useEffect(() => replayIfOpened(), []);

  const name = template?.name ?? 'Your pack';
  const pendingReplay = mounted && stage === 'sealed' && error === null && wasOpened(openId);

  if (!mounted || pendingReplay || replaying) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 text-mut">
        <Spinner />
        Loading your pack…
      </div>
    );
  }

  switch (stage) {
    case 'sealed':
      return (
        <SealedStage
          name={name}
          error={error}
          onOpen={() => {
            started.current = true;
            void start(false);
          }}
        />
      );
    case 'opening':
      return <OpeningStage name={name} slow={slow} />;
    case 'reveal':
      return result ? (
        <RevealStage
          cards={result.cards}
          index={index}
          onNext={() => send({ type: 'next' })}
          onSkip={() => send({ type: 'skip' })}
        />
      ) : null;
    case 'summary':
      return result ? (
        <SummaryStage
          name={name}
          result={result}
          template={template}
          onOpenAnother={(next) => router.replace(openUrl(next.id))}
        />
      ) : null;
  }
}
```

The page keys the provider by `openId` (Step 2), so *Open another*'s new URL remounts the store fresh: that is the spec's `reset`, done by React.

- [ ] **Step 2: Replace `apps/web/app/(app)/packs/open/page.tsx`**

```tsx
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PackReveal } from '@/components/packs/reveal/pack-reveal';
import { parseOpenParams } from '@/lib/pack-open-flow';
import { PackRevealProvider } from '@/lib/stores/pack-reveal';

export const metadata: Metadata = { title: 'Open a pack' };

export default async function PackOpenPage({ searchParams }: PageProps<'/packs/open'>) {
  const params = parseOpenParams(await searchParams);
  if (!params) redirect('/packs');

  return (
    <div className="flex min-h-[calc(100dvh-10rem)] items-center justify-center">
      <PackRevealProvider key={params.openId}>
        <PackReveal templateId={params.templateId} openId={params.openId} />
      </PackRevealProvider>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm --filter @pokedrop/web typecheck` then `npx eslint apps/web/components/packs apps/web/app apps/web/lib`
Expected: no errors, no lint output. `parseOpenParams` imports `zod` and `@pokedrop/shared` only, so it is safe in the Server Component.

- [ ] **Step 4: Walk it once by hand**

As a member with at least 300 coins: `/packs` → *Open* → confirm → *Tap to open* → the shake and flash for about 2 s → *Reveal card* flips the first card → *Next card* … → *See all cards* → the summary with every card and the balance 300 lower. The topbar balance has dropped without a reload.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/packs/reveal/pack-reveal.tsx apps/web/app/\(app\)/packs/open/page.tsx
git commit -m "[PD-105]: open the pack on the tap and replay it after a reload

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Measure, document, close

**Files:**
- Modify: `docs/Pages.md` (append *Packs* and *Pack reveal* sections)

**Interfaces:**
- Consumes: the running dev server (:3000), API (:4000), Mailpit (:8025), Postgres (`docker exec pokedrop-postgres psql …`), and the CDP driver in the session scratchpad (`cdp.mjs`: `launch`, `goto`, `key`, `type`, `eval`, `waitFor`, `requests`, `screenshot`; `signin.mjs`: `withJar`). A member session: the cookie jar `jar.txt` from PD-106's runs, topped up with coins through a `GRANT` ledger row plus the matching `users.currency` update in one transaction.

- [ ] **Step 1: Run the measurements**

Each with a fresh headless Chrome profile and real key events; record what was seen.

1. `/packs`, Enter on *Open*, then Enter twice fast on the dialog's confirm: zero `POST …/packs/*/open` in `requests`, one navigation to `/packs/open?template=seed-template-base&open=<uuid>`.
2. Enter twice fast on *Tap to open*: exactly one `POST`; one new `PACK_SPEND` row for the user; the topbar balance 300 lower.
3. *Skip all →* on card 2: the summary lists all 8 cards (`main ul > li` count), in `position` order.
4. A second run with `--force-prefers-reduced-motion`: `getComputedStyle` of the shaking element reports `animation-duration` `1e-05s`; time from the tap to the reveal stage under 1 s.
5. The `POST` held 8 s through CDP `Fetch.enable` with a `…/open` pattern and `Fetch.continueRequest` after 8 s: *Still opening…* present after 6 s, the reveal stage after the answer.
6. Reload on `sealed` before tapping: still `sealed`, the same `open=` in the URL, no `POST`. Then tap, go to card 4, reload: *Loading your pack…*, then the summary with the same card ids in the same order; the balance unchanged by the reload; still one `PACK_SPEND` row and one `pack_openings` row for that `openId`.
7. A member below 300 coins: the card's button disabled with *You need N more coins.* and *See your wallet* under the grid. A member with exactly 300 who confirms, then has their balance lowered to 0 in the database before tapping: *You don't have enough coins for this pack.* with *Go to wallet*; no ledger row.
8. `/packs/open`, `/packs/open?template=x`, `/packs/open?template=x&open=nope`: each ends on `/packs`.
9. The flow from `/packs` to the summary using Tab, Enter and Space only; the live region (`[aria-live=polite]`) reads *Card N of 8: <name>, <rarity>* after each reveal.
10. *Open another* on the summary, confirm: the URL's `open=` changes, `history.length` unchanged, the stage `sealed`.
11. Tap, then Back during the opening (within 1 s), wait 3 s, Forward: *Loading your pack…* then the summary; one `PACK_SPEND` row.
12. The summary's URL opened in a second, fresh profile with the same cookie: `sealed`; tap → the same card ids; still one `PACK_SPEND` row for that `openId`.
13. The template set `active = false` in the database after confirming and before tapping: the API's 404 sentence with *Back to packs*; no ledger row. Set it back to `true`.

- [ ] **Step 2: Fix what the measurements find**

Each failure is a bug in the task that owns the code; fix it there, re-run that check, and commit with that task's ticket in the header.

- [ ] **Step 3: Document**

Append to `docs/Pages.md`:

- `## Packs (PD-104)` — the page, the dialog, why confirm sends nothing (the hand-off), the files; then **Measured 2026-10-04** with checks 1, 7 and 8.
- `## Pack reveal (PD-105)` — the four stages, the minimum/slow timers, the failure table, the replay after a reload and its mark, the motion tokens, the files; then **Measured 2026-10-04** with checks 2–6 and 9–13.
- A *Traps* line for anything the measurements turned up.

- [ ] **Step 4: Commit and close**

```bash
git add docs/Pages.md
git commit -m "[PD-105]: document the pack flow and what it measured

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Then set PD-104 and PD-105 to Done in Linear, ticking each acceptance criterion with a pointer to `docs/Pages.md`.
