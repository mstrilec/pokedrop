# M12 · Component Library

What the web app's components are, how they differ from [ComponentSpecs.md](ComponentSpecs.md), and how they were checked. ComponentSpecs is the contract; this is what exists and where it bends. It grows ticket by ticket through M12.

---

## The gallery

`/dev/components` renders every component in each variant and state. It is how M12 is checked: there are no automated tests in v1, so a component is accepted by looking at it, tabbing through it and measuring it in a browser.

It lives in its own route group, `app/(dev)/`, whose layout answers 404 in production unless the server was started with `COMPONENT_GALLERY=1`. The check runs per request (`connection()`), so a production build opts in at `next start`, with no rebuild. Its sections are in `app/(dev)/dev/components/_sections/`, one file per ticket.

## Merging classes (PD-92)

`cn` (shadcn's replacement for `clsx` + `tailwind-merge`) resolves conflicts from Tailwind's default theme. It did not know this project's names, and read them as colors: `cn('text-h3 text-on-pri')` kept only `text-on-pri`, `cn('rounded-control', 'rounded-pill')` kept both, and `cn('bg-card-face', 'bg-surface')` dropped the gradient. `lib/utils.ts` now builds `cn` with `createCn` from `cn/config`, extended with the type scale, radii, shadows and gradient utilities from `app/globals.css`. **Import `cn` from `@/lib/utils` only;** lint refuses `import { cn } from 'cn'`. A new named utility in `globals.css` that conflicts with a Tailwind group belongs in that extension too.

## Primitives (PD-92)

| Component | File | Notes |
| --- | --- | --- |
| Button | `components/ui/button.tsx` | `primary` `secondary` `ghost` `confirm` `destructive` `economy` × `sm` (32 px) `md` (40) `lg` (48); `icon`, `loading`, `asChild` |
| IconButton | `components/ui/icon-button.tsx` | 40 px, 44 px on a coarse pointer; `surface` `ghost`; `label` required; `badge` |
| Badge | `components/ui/badge.tsx` | `tone` `neutral` `primary` `success` `warning` `danger` `accent`; `rarity`; `pill` or `tag`; `dot` or `icon`; `onDismiss`; `RarityBadge` |
| Avatar | `components/ui/avatar.tsx` | Radix Avatar; image, initial on the brand gradient while it loads or when it fails; 28–88 px; `ring`; `decorative` |

`lib/design/status.ts` maps each trade status to its label and badge tone (Pending gold, Accepted green, Countered violet, Declined and Voided red, Cancelled neutral).

**Where they differ from the spec.**

- **The shadcn Button was replaced, not extended.** Its `default`/`outline`/`link` variants are gone; `outline` became `secondary`. A shadcn component added later that calls `buttonVariants({ variant: 'outline' })` has to be adapted.
- **`icon` is a Lucide component** (`icon={PackageOpen}`), not a name string, so an unused icon is never bundled.
- **A loading button stays focusable.** `loading` sets `aria-busy` and `aria-disabled` and swallows clicks and Enter, but does not set `disabled`: a submit that starts loading would otherwise throw keyboard focus to `<body>`. `disabled` is the native attribute, which already takes the button out of the tab order.
- **IconButton draws a count as a dot** unless `showCount` is set, because the topbar bell in the mockups is a dot; the count is in the accessible name either way (`Notifications, 3 unread`).
- **Avatar has no `gradient` prop.** A per-user gradient would have to be written as hex, which the lint rule refuses; every fallback uses the brand gradient, `--pri` to `--c-ultra`. The radius is 26 % of the side, which is what the mockups' 34 px / 9 px and 88 px / 20 px tiles have in common.
- **Badge `tone` names a color, not a family.** The spec's families (rarity, status, utility, role) are uses of these tones: rarity through `rarity`, status through `TRADE_STATUS_STYLES`, utility tags through `shape="tag"`, the admin role as `danger` with a border and a shield.

**The shell uses them.** The menu button and the notification bell are IconButtons, the account menu's trigger is an Avatar (so an uploaded avatar now shows there), and *Open packs* is a Button. The CurrencyPill is still the shell's own until PD-93.

**Measured 2026-10-04** in the gallery under `next dev`:

- with real input events, a click started a loading button; a second click and two Enters during loading did nothing, and the button kept `aria-busy="true"`, `aria-disabled="true"` and focus. A first version also set `pointer-events: none` while busy, and the second click then fell through to the page and moved focus to `<body>`;
- IconButton names: `Notifications`, `Notifications, unread`, `Notifications, 3 unread`, `Notifications, 12 unread`; a badge of 0 draws nothing and adds nothing to the name;
- a failing avatar image (`avatar.invalid`) rendered the initial on the gradient at the same size; every avatar exposes `role="img"` with the person's name unless `decorative`;
- the focus ring on a focused button: 2 px of `--bg`, then 2 px of `--pri` — 6.0 : 1 against the canvas, 5.3 : 1 against `--surface`;
- after `next build`, `next start` answered `/dev/components` with 404, and with `COMPONENT_GALLERY=1` with 200; the not-found page's link rendered as a secondary Button.

In the shell, signed in as an admin against the live API: Tab from the top of `/admin/sync` stopped at *Skip to content*, the logo, the 16 sidebar links, search, the balance, the bell, *Open packs*, the account menu and the admin sub-nav, in PD-90's order; the bell, *Open packs* and the account trigger each showed the ring; Enter on the account trigger opened its menu on *My profile*. After an admin grant the bell read *Notifications, 1 unread* with its dot and the balance *500 coins*. The menu's Escape-returns-focus was not re-measured: the browser pane was not drawing, so Radix's close animation never ended. The trigger's behaviour comes from Radix and only its contents changed; PD-100's keyboard pass covers it.

**Text contrast below the spec's 4.5 : 1** (measured on `--surface`): white on the primary fill **3.2**, red text on `--red-dim` (destructive button, Declined, Voided, Admin) **4.19**, violet on its tint (Countered, Ultra Rare) **4.48**. Every other variant passes, from 4.69 (Rare) to 14.6 (secondary). These are the design system's own token pairs, so they are left for PD-100's contrast pass, which decides between adjusting the tokens and accepting them.
