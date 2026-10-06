# M13 · Application Pages

What each page is built from, the decisions behind it, and how it was checked. [InformationArchitecture.md](InformationArchitecture.md) is the page inventory; this is what exists. It grows ticket by ticket through M13.

---

## Decisions taken before M13

The tickets were written before the API, and a few of them asked for what the API deliberately does not do. Settled on 2026-10-04:

| | Decision | Tickets |
| --- | --- | --- |
| D1 | `/cards` and `/sets` render signed out; owned badges and completion are simply absent | PD-108, PD-109 |
| D2 | Owned counts come from a private `GET /inventory/owned?cardIds=…`; the public `/cards` stays the same for every visitor | PD-108, PD-110, PD-112 |
| D3 | The owner's `GET /decks` carries `valid`, computed by the validator on read and never stored | PD-111 |
| D4 | The deck builder validates its draft in the browser with the API's own validator, from `@pokedrop/shared`; rule failures never block a save — only what the API would refuse with a 400 does | PD-112, PD-113 |
| D5 | The trade composer asks for any catalog card (the counterparty's showcase first) — inventories stay private and settlement checks; counterparties come from a member name search, `GET /users?q=`; counter-offers use the same composer | PD-115, PD-116 |
| D7 | Settings shows the email read-only and has no theme choice: dark is the only theme | PD-118 |
| D9 | The card page's Pokédex section reads PokéAPI from the web server (`lib/pokeapi.ts`) — a day's cache, a two-second timeout, nothing on failure; the API is not involved | PD-110 |
| D10 | *Add to deck* on a card page picks one of the member's decks (or creates one) and opens the builder with `?add=<cardId>`: one more copy as an unsaved change, saved by the member | PD-110 |

## Landing (PD-101)

`app/(public)/page.tsx`: a Server Component in the public layout. A hero (headline, two calls to action, three catalog figures, three floating cards) and four feature cards — packs, collection, decks, trades.

- **Signed out**, the calls to action are *Start collecting free* (`/register`) and *Sign in* (`/sign-in`), and the public top nav carries *Sign in* and *Create account*. **Signed in**, the public layout already renders the app shell, so the hero offers *Go to your dashboard* and *Open a pack* instead; nobody is redirected away from `/`.
- **Only true figures.** The mockup's *240K packs opened* and *99.98% safe trades* were invented. The hero shows the catalog's card count (`GET /cards?pageSize=1`, its `total`), the number of sets and the welcome grant; the badge names the newest set by release date. Each figure is read on its own and dropped when the API cannot answer, so the page renders with the API down — `getOptionalProfile()` in `lib/session/server.ts` (moved out of the public layout so the page can share it) does the same for the session.
- **The hero cards** are Base Set Charizard, Blastoise and Pikachu through `CardArt`, so a failed image falls back to the card's face. Their float is `animate-float`, a token added to `globals.css`, and stops under reduced motion with every other animation.
- **Metadata.** `metadataBase` is `WEB_ORIGIN` in the root layout, so canonical and Open Graph URLs are absolute. The page sets its own title, description, canonical and Open Graph fields; the shared image is `app/(public)/opengraph-image.tsx`, generated with `next/og` at build time.
- **The logo** is `components/shell/logo.tsx`, used by the sidebar and the public nav.

**Traps.**

- **A page's `openGraph` replaces its parent's, image included.** With the image file in `app/`, the landing page's own `openGraph` object dropped `og:image` from the HTML. An image file in the page's own segment wins over the config, so it lives in `(public)/`. A page that needs its own image (card detail, PD-110) puts its own file in its segment.
- **The image renderer cannot read CSS variables.** `opengraph-image.tsx` spells the five tokens it uses as `rgb()` beside the names they come from. Two adjacent `<span>`s render with a gap between them, so the wordmark is one text node.

**Measured 2026-10-04:**

- signed out (`curl`, no cookie): title *PokéDrop · Open, collect, build and trade Pokémon cards*, description, `canonical`, `og:title`/`og:description`/`og:url`/`og:type`/`og:site_name`, `og:image` 1200×630 with its alt, `twitter:card` `summary_large_image`; the image answered 200, a 58 KB PNG; *Create account* and *Start collecting free* link `/register`, both *Sign in* links `/sign-in`; figures *20,670*, *176*, *1,000*;
- signed in as a member: the app shell around the page, *Go to your dashboard* and *Open a pack*; all three card images loaded; no console errors;
- at 375 px: no horizontal scroll (`scrollWidth` 375), the headline at 38.4 px;
- Lighthouse 13 against `next build && next start`, the budget being 90 or better in every category: desktop performance 100, accessibility 100, best practices 100, SEO 100 (LCP 0.8 s, CLS 0); mobile 90, 100, 100, 100 (LCP 3.5 s simulated, CLS 0, TBT 100 ms). The mobile LCP element is the hero paragraph; in the real trace its render delay was 372 ms, and the rest is the simulated slow-4G throttling on the stylesheet.

## Auth pages (PD-102)

Five pages in `(auth)`, each an `AuthCard` (`components/auth/auth-card.tsx`: icon, title, one line, the form, a footer link) in the group's layout, which is the logo over a centered column. The forms are client components in `components/auth/`; the pages are Server Components that read the query and hand the forms what they need, so nothing here calls `useSearchParams`.

| Page | Does |
| --- | --- |
| `/register` | display name, email, password → `POST /api/auth/sign-up/email` → *check your inbox* |
| `/verify-email` | *check your inbox* with a resend button; `?verified=1` → *Email verified*, sign in; `?error=…` → the link failed, ask for the address and send a new one |
| `/sign-in` | email, password, *Keep me signed in* → the return URL; an unverified account → *check your inbox*; `?error=ACCOUNT_SUSPENDED` and `?reset=1` as notices |
| `/forgot-password` | email → `POST /api/auth/request-password-reset` → the same sentence for any address |
| `/reset-password` | `?token=…` → new password twice → `/sign-in?reset=1`; no token or `?error=INVALID_TOKEN` → request a new link |

**One set of rules.** `@pokedrop/shared` now has `entities/auth.ts`: `PASSWORD_MIN_LENGTH` (12) and `PASSWORD_MAX_LENGTH` (128), which `auth.factory.ts` hands to Better Auth, and the four form schemas. The display name is `ProfileIdentitySchema`'s, the rule the sign-up hook and `PATCH /users/me` apply; it gained readable messages (*Enter a display name*, *Use at most 64 characters*), which the API's `INVALID_PROFILE` message carries too once the API restarts on the new build. Sign-in checks only that a password was typed: the length rule is for new passwords, and an account older than it must still be able to sign in.

**Better Auth is called directly**, through `authApi` (`lib/api/browser.ts`, base `/api/auth`) and `lib/api/endpoints/auth.ts`, and outside TanStack Query, so a failure is shown in the form, never as a toast. Its error codes land on fields with `applyApiError` (`PASSWORD_TOO_SHORT` on the password, `INVALID_PROFILE` on the name); everything else, a wrong password included, is the form's alert.

**Where the links land.** Sign-up, sign-in and resend send `callbackURL: <origin>/verify-email?verified=1`, so the verification link returns to a page that knows it succeeded; Better Auth appends `error=` to the same URL when the token fails. The reset request sends `redirectTo: <origin>/reset-password`, where the link arrives with `?token=` or `?error=INVALID_TOKEN`. Both callbacks are on the web origin, which is in the API's trusted list.

**The address never travels in a URL.** *Check your inbox* needs it to say where the mail went and to resend, so `lib/auth-flow.ts` keeps `{ email, sentAt }` in `sessionStorage` for that tab. Opened elsewhere — the link in another browser, an expired link — the page asks for the address instead. The resend button waits 60 seconds from the last mail, matching the API's default `MAIL_RESEND_COOLDOWN`; the API enforces its own cooldown regardless and answers the same either way.

**After sign-in the page reloads** to `safeNext(next)`, so every layout renders again with the session, the way sign-out does. A visitor who already has a session and opens `/sign-in` or `/register` is sent on (`redirectIfSignedIn` in `lib/session/server.ts`); the other three pages stay reachable, because a reset link may be opened on a signed-in device.

**Measured 2026-10-04** with a fresh headless Chrome profile against `next dev` and the live API, keyboard only (real key events), mail read from Mailpit:

- `/register`, submitted empty: focus on *Display name*, all three fields `aria-invalid`, the name described by *Shown on your profile and in trades. | Enter a display name*; an 11-character password: *Use at least 12 characters*;
- a new account: `/verify-email` naming the address (the URL holds none), *Resend email in 60 s*; the mail *Confirm your PokeDrop email* with `callbackURL` `…/verify-email?verified=1`;
- signing in before verifying: back to `/verify-email`, and no second mail (the API's cooldown);
- the verification link: `/verify-email?verified=1`, *Your email is verified.*;
- a wrong password on `/sign-in?next=%2Fwallet`: *Invalid email or password* as the alert, still on the page; the right one: `/wallet` with *1,000* coins; then `/sign-in?next=%2Fdecks` → `/decks` and `/register` → `/dashboard`;
- *Forgot*, for an unknown and a real address: the same sentence both times; the reset link landed on `/reset-password?token=…`; different passwords: *The passwords do not match* on the second field, focused; the reset → `/sign-in?reset=1` with its notice; the old password refused, the new one → `/dashboard`;
- the spent reset link: `/reset-password?error=INVALID_TOKEN`, *This reset link has expired or was already used.*; `/reset-password` with no token: the same; `/verify-email?…&error=TOKEN_EXPIRED`: *That link has expired or was already used.* and the address form; `?error=ACCOUNT_SUSPENDED`: *This account is suspended.*;
- registering the verified account's address again: `/verify-email`, no alert; the database still holds one user with that address, verified;
- the resend button 2 seconds from the end of its cooldown: *Resend email in 2 s*, then *Resend email*; Enter: *We sent another link.* and *Resend email in 60 s*;
- the server's limits against the shared ones, through `/api/auth/sign-up/email`: 11 characters 400 `PASSWORD_TOO_SHORT`, 12 and 128 accepted, 129 400 `PASSWORD_TOO_LONG`; a 64-character name accepted, 65 and a blank one 400 `INVALID_PROFILE`;
- no console errors in any run.

## Shared page pieces

| Piece | File | Notes |
| --- | --- | --- |
| PageHeader | `components/page-header.tsx` | the page's `h1`, one line under it, actions on the right |
| LoadMore | `components/list-states.tsx` | the foot of a cursor-paged list: *Showing N of M …* as `role="status"`, and *Show more* while there is a next page |
| ListError | `components/list-states.tsx` | a failed query in place of its list: the API's sentence, the request ID, *Try again* |

**Cursor-paged lists are infinite queries.** Each page is fetched once, with the previous page's `nextCursor`; *Show more* asks for the next one and leaves the ones already on screen alone.

## Pack history (PD-106)

`/packs/history`: every opening as a card — template, date, what it cost, and its pulls as `CardTile`s in pull order, each leading to `/cards/:id`. An opening with an Ultra or Secret pull carries a *big pull* badge, and those tiles glow as everywhere else. Ten openings a page (`usePackHistory`, keyed `['packs', 'history']`, so `openPack` invalidates it), because each one is a row of eight or more tiles.

**The price paid comes from the ledger.** The history answer had no cost, and the template's price today is not what someone paid last month, so `GET /packs/history` gained `cost`, read from the opening's `PACK_SPEND` row (API.md, *Opening history*). An opening without one says *Cost not recorded*.

**Measured 2026-10-04** with a fresh headless Chrome profile against `next dev` and the API, as a member with 13 openings:

- 10 openings shown, *Showing 10 of 13 openings*, one request `/packs/history?pageSize=10`; the newest: *Base Set Booster · Oct 4, 2026, 9:08 PM*, 8 tiles, *300* coins;
- *Show more* by keyboard: 13 openings, *Showing 13 of 13 openings*, exactly one new request (`?cursor=…&pageSize=10`), and *Show more* gone;
- the first tile is *Meowth, Common* linking `/cards/base2-56`, which answered 200;
- a verified member who never opened a pack: *No packs opened yet* with *Open your first pack* → `/packs`;
- through the API: the 13 openings' `cost` 300 each, and the wallet's newest `PACK_SPEND` row `−300` with `balanceAfter` equal to the balance; no console errors.

## Wallet (PD-119)

`/wallet`: the balance, then the ledger as a `DataTable` — date, what caused the row, the amount (green in, red out) and the running balance — with tabs *All · Grants · Pack spends · Trades* in `?type=` (`useUrlTab`; the API's `GRANT`, `PACK_SPEND`, `TRADE`, which also covers reversals). `useWallet(type)` is an infinite query keyed `['wallet', 'list', { type }]`, so `openPack`'s invalidation of `['wallet']` reaches every filter.

- **The running balance is the API's `balanceAfter`**, computed over the whole ledger before the filter, so a filtered row shows the same balance it shows unfiltered, and the newest row's equals the balance above the table. The page adds nothing up itself.
- **Where a row leads.** A pack spend links `/packs/history#opening-<id>`; the history page pages through until that opening is loaded, then scrolls to it and focuses it. A trade or a reversal links `/trades/<id>`. Grants have no record to open: the welcome grant says so, and an admin's grant or adjustment says which by its sign. A row whose source no longer resolves says *Source no longer available*.
- **The balance is a figure, not the topbar's pill**: `CurrencyPill` is a link to the wallet, which on the wallet itself would lead nowhere. The pack history's cost pill is `interactive={false}` for the same reason.
- **`DataTable` scrolls sideways** when its columns' minimum widths do not fit — the wallet's four at 375 px — instead of clipping the last columns. The table itself scrolls; the page never does ([Components.md](Components.md), *Data display*).

**Measured 2026-10-04** with a fresh headless Chrome profile against `next dev`, as a member with a welcome grant, an admin-style grant and 13 pack spends:

- *100 coins*; 15 rows, *Showing 15 of 15 transactions*; the newest *Opened Base Set Booster · −300 · 100*, the oldest *Welcome grant for verifying your email · +1,000 · 1,000*; every row's balance equals the row below it plus its own amount;
- ArrowRight twice on the tabs: `?type=packs`, 13 rows, all pack spends, with exactly the balances they show unfiltered, and the balance still *100 coins*; `?type=trades`: *No coins have changed hands in a trade yet.*;
- Enter on the oldest pack spend: `/packs/history#opening-…`, which loaded the second page by itself (13 openings) and focused that opening, in view;
- at 375 px: the page 375 px wide, the table 309 px showing 564 px of columns by scrolling, its last cell *100* reachable; no console errors.

## Notification centre (PD-120)

`/notifications`: every notification as a `NotificationRow`, newest first, with tabs *All · Unread* in `?show=` and *Mark all as read* in the header. An unread row has a *Mark as read* button beside it; activating the row marks it read and follows its link — the trade, or the wallet for coins (`notificationHref`).

- **The bell and the page share one count.** `useUnreadCount()` (`lib/query/notifications.ts`, polled every minute) is the bell's query, moved out of the topbar, and the *Unread* tab's number. `markNotificationRead` and `markAllNotificationsRead` invalidate the `notifications` root, which holds the count and both lists, so the badge, the tab and the rows all change without a reload.
- **Mark all is one request**, `PATCH /notifications/read-all`; its toast says how many it marked.
- `useNotifications(unread)` is an infinite query keyed `['notifications', 'list', { unread }]`, 24 a page.

**Measured 2026-10-04** with a fresh headless Chrome profile against `next dev`, as a member with 30 notifications (20 unread, one real pending trade behind the trade kinds):

- the bell *Notifications, 20 unread*, tabs *All / Unread 20*; 24 rows, *Showing 24 of 30 notifications*; *Show more*: 30;
- the rows link to two places, `/trades/<the trade>` and `/wallet`; both answered 200;
- Enter on one row's *Mark as read*: one `PATCH`, the bell *19 unread* and the tab *Unread 19* without a reload; Enter on another unread row: `/trades/<id>`, a second `PATCH`, the bell *18 unread*;
- *Mark all as read*: exactly one request, `PATCH /notifications/read-all`, the bell back to *Notifications*, the toast *Marked 18 notifications as read*, the button disabled and no *Mark as read* left; ArrowRight to *Unread*: `?show=unread` and *You are all caught up* with a link to `/trades`; no console errors.

## Packs (PD-104)

`/packs`: a `PackTemplateCard` per active template (`usePackTemplates`, `GET /packs/templates`, keyed `['packs', 'templates']`), the member's balance from `useMe()`. A pack above the balance is disabled and says how many coins are missing, and *Short of coins? See your wallet* appears under the grid. *Open* asks through `ConfirmOpenDialog` (`components/packs/confirm-open-dialog.tsx`): *Open {name}?*, the template's `guarantee` and *This action can't be undone.*, and *Open pack · {cost}*.

**Confirming sends nothing.** It creates an `openId` and navigates to `/packs/open?template=<id>&open=<openId>` (`openUrl` in `lib/pack-open-flow.ts`); the tap on the sealed pack is the request. The design is `docs/superpowers/specs/2026-10-04-pd-104-pd-105-pack-opening-flow-design.md`: posting on confirm would have made the opening animation two seconds of theatre with the cards already known. The dialog holds itself busy once confirmed, so a second click finds nothing to do.

**Measured 2026-10-04** with a fresh headless Chrome profile against `next dev`, real key events, the database checked:

- the seed's *Base Set Booster · 300 · Open*; Enter opened *Open Base Set Booster?* reading *8 cards: 4 Common, 3 Uncommon, 1 Rare or better. This action can't be undone.*, focus on *Cancel*, buttons *Cancel / Open pack · 300*;
- Enter twice on *Open pack · 300*: `/packs/open?template=seed-template-base&open=<uuid>` and no `POST …/open` at all;
- at 100 coins: the button disabled, *You need 200 more coins.*, *Short of coins? See your wallet*;
- `/packs/open`, `?template=x` and `?template=x&open=nope` each redirected to `/packs` from the server.

## Pack reveal (PD-105)

`/packs/open` renders `PackRevealScreen` (`components/packs/reveal/pack-reveal.tsx`), which provides the reveal store, keyed by the `openId`, and drives `usePackReveal` and `useOpenPack` through four stage components in the same folder.

| Stage | What happens |
| --- | --- |
| sealed | the pack floating with its sweep; *Tap to open* focused; a tap on the pack works too |
| opening | shake and flash; the request is in flight; *Still opening…* after 6 s |
| reveal | one large `RevealCard`: *Reveal card* flips it, *Next card* brings the next; *3 / 8* and *Skip all →*; Ultra and Secret pulls add rays, a burst and *Ultra Rare pull*; a polite live region reads *Card 3 of 8: Charizard, Rare Holo* |
| summary | *{name} opened*, cards, *Rare or better*, market value, balance; every card as a `CardTile`; *View in collection* and *Open another · {cost}* |

- **`opened` waits for both** the answer and 2 s (`OPENING_MIN_MS`), so a fast server still gets the animation and a slow one only stretches it. Under `prefers-reduced-motion: reduce` the minimum is 0 and the global rule ends every animation at once; the JavaScript reads the preference through `lib/motion.ts`, shared with `CurrencyPill`.
- **A reload after the opening goes to the summary.** A successful answer sets `sessionStorage['pokedrop.opened.<openId>']`; a load that finds it shows *Loading your pack…*, replays the request — `POST` with the same `openId` answers the original cards and charges nothing — and skips to the summary. Without the mark the page shows the sealed pack, and a tap there replays just as safely (a second tab, a refused storage).
- **Failures stay on the sealed stage**, from `useOpenPack`'s now-silent mutation (`meta: { toast: false }`): a 402 says *You don't have enough coins for this pack.* with *Go to wallet*; a 404 or 409 shows the API's sentence with *Back to packs*; anything else offers *Try again* on the same `openId`.
- ***Open another*** `router.replace`s to a fresh `openUrl`, and the store, keyed by the `openId`, starts again at sealed.
- **Motion tokens** in `globals.css`: `animate-float-pack`, `-sweep`, `-shake`, `-flash`, `-burst`, `-ray-spin`, `-card-in`, values from `design/Booster Opening.dc.html`.

**Traps.**

- **A store provider cannot be rendered from a Server Component** when its module is not `'use client'`: the page's first version imported `PackRevealProvider` and the server ran `createStoreContext`, which threw. The provider lives in the client root.
- **Mark the opening when the answer arrives, not when the animation ends.** The first version set the mark after the 2 s floor, so Back and Forward (or a reload) a second after a fast answer found no mark and offered *Tap to open* on a pack already paid for. Whether a load is a return to an opened pack is read once, on arrival; reading it on every render could leave a page that arrived unmarked stuck on *Loading your pack…* once an earlier instance's request marked it.
- **Glows, rays and the flash are wider than a phone.** Transformed and absolutely positioned boxes count toward the page's scroll width (415 px sealed, 697 px during the flash, at 375 px). The stage's wrapper is `overflow-clip`, which clips without creating a scroll container.
- **After a failure, focus goes to the way out.** The failed stage's action is a link (*Go to wallet*, *Back to packs*) or *Try again*; focusing a ref that only the button carried left focus on `<body>`.
- **The confirm's second press arrives on the next page.** *Tap to open* takes focus as it appears, so the second Enter of a double press — or a held key — opened the pack and skipped the sealed stage. The sealed stage ignores activation for its first 500 ms.

**Measured 2026-10-04** with a fresh headless Chrome profile against `next dev`, real key events, the database checked after each run:

- Enter twice on *Tap to open*: one `POST`, one `PACK_SPEND` row, the balance 5,000 → 4,700 in the database and the topbar (*Balance 4,700 coins*) without a reload;
- the whole flow from `/packs`: the reveal 2,081 ms after the tap, *1 / 8* and focus on *Reveal card*; 16 presses to the summary *Base Set Booster opened* with 8 tiles, *Cards 8 · Rare or better 1 · Market value $8.53 · Balance 2,500 coins*, *3 cards have no market price yet.*, focus on the heading;
- *Skip all →* on card 2: the summary with all 8 cards;
- with reduced motion emulated: the reveal 69 ms after the tap and the card flip's transition 0.00001 s;
- the answer held 8 s at the network: *Still opening…* at 6,122 ms, the reveal at 8,135 ms;
- a reload on the sealed stage: still sealed, the same `openId`, no request; a reload on card 4: *Loading your pack…* then the summary with 8 cards, the balance unchanged (3,800), one `PACK_SPEND` row and one opening for that `openId`;
- 300 coins at the confirm, 0 at the tap: *You don't have enough coins for this pack.* with *Go to wallet*, no ledger row;
- by keyboard alone: 19 Tabs to the pack's button, *Cancel* focused in the dialog, Tab to *Open pack · 300*, Space, *Tap to open* focused, Space; the live region spoke 8 times, from *Card 1 of 8: Weedle, Common* to *Card 8 of 8: Pidgeotto, Rare*;
- *Open another* and its confirm: a new `openId`, `history.length` unchanged (3), the sealed stage;
- Back half a second into the opening landed on `/packs`; Forward three seconds later showed the summary with 8 cards, one `PACK_SPEND` row;
- the summary's URL in a second, fresh profile with the same session: the sealed stage, and the tap answered the same 8 cards in the same order, still one `PACK_SPEND` row and one opening;
- the template deactivated between the confirm and the tap: *Pack template not found* with *Back to packs*, no ledger row;
- after the final review's fixes: Back half a second after the tap and Forward a second later showed the summary (before: *Tap to open*); at 375 px the page's `scrollWidth` 375 on the sealed stage, during the flash and through a whole reveal (before: 415, 697, 406); after a 402 the focus on *Go to wallet* (before: `<body>`); all thirteen checks above re-run and unchanged;
- afterwards, every user's balance equal to their ledger; no console errors in any run.

## Inventory (PD-107)

`/inventory`: the collection's header — *10,078 cards · 5,000 unique · worth $237,061.08, 3,980 of 5,000 priced*, four `StatCard`s, the first six sets' `CompletionMeter`s behind *Show all N sets* — then a `FilterBar` (search, Set, Rarity, Type, Copies, Sort, the grid/list toggle) over the collection, drawn by the shared collection view ([Components.md](Components.md), *Collection view*). The design is `docs/superpowers/specs/2026-10-05-pd-107-inventory-design.md`.

- **Everything is in the URL**: `q`, `set`, `rarity`, `type`, `minQuantity`, `sort` and `view`. A filter or sort pushes a history entry; search replaces. The last view chosen is also kept in `localStorage` (`pokedrop.inventory-view`), so `/inventory` without `?view=` opens in it.
- **Infinite scroll over keyset pages of 100.** `useInventory(filters)` is an infinite query keyed by the filters, with `keepPreviousData`: a new filter keeps the old cards on screen, dimmed and `aria-busy`, until its own first page arrives. Every page carries the filters it answers (`answeredFor`), which is how the page knows the old cards are stale.
- **Set options are the user's own sets**, from the summary's `setCompletion` (*Celebrations · 25/25*), not the mirror's 176. Rarity and type options are the global facets. *Copies* is `minQuantity`: *2+ (duplicates)*, *4+ (playset)*.
- **The list's *Card*, *Price* and *Acquired* headers set the server's sort** through `?sort=`; the table never reorders what it has loaded.
- **Locked copies**: a tile reads *×3 · 1 locked*; a card whose every copy is promised to a pending trade is greyscale with the lock; the list's *Copies* reads *3 · 1 locked* with a lock icon.

**The instant filter is not Fuse.js.** The ticket asked for Fuse.js and for the client never to contradict the server; the server matches a substring of the name, and Fuse is fuzzy, so the two asks conflict. While the field runs ahead of the server — before the 300 ms debounce, and until the answer arrives — `narrowToTyped` decides what may be shown:

| What is typed, against what the cards on screen answer | Shown |
| --- | --- |
| it extends that query (typing on) | those cards narrowed by the server's own rule — each is in the server's answer for the new text |
| that query extends it (deleting) | those cards, unchanged — a subset of the answer to come |
| neither (new text) | those cards dimmed and `aria-busy` until the answer |

So the client may show fewer cards than the server will return, never others. **The rule folds only ASCII case**, like the database's `C` collation: `ILIKE '%POKÉ%'` does not match *Pokémon Center* there, so the client does not either.

**Known limit:** Tab reaches only rendered cards — the visible rows and a few beyond. The rest render as the page scrolls (PageDown, Space), and Tab continues from there; search and filters stay the fast way to a card.

**Traps.**

- **A note in `StatCard`'s `trend` is read as a direction.** The value's coverage first sat there and was announced *No change: priced 68 of 109*; it moved into the header's line.
- **An empty answer is a claim, so it waits for the right question.** The deleting rule keeps the cards on screen because they are a subset of the answer to come — but an empty screen is not a subset, it says *nothing matches*. Clearing `zzz` first showed *Your collection is empty* until the unfiltered answer came. The page now claims an empty result only when the cards on screen answer exactly the field and the filters (`current`); otherwise it says *Searching…*.
- **Loading more is for the current answer only.** Narrowing shrinks the grid, so the last rendered row was always near the end and every finished page asked for the next one — of the old query: typing `zubat` over the unfiltered collection loaded 34 pages nobody asked for. Pages load only while the cards on screen are current.
- **A refetched infinite query requests every loaded page again, in order.** Focus returning to a scrolled collection sent 13 requests (50 at the end of 5,000 cards), against the API's 100 a minute. The list does not refetch on focus, and is dropped as soon as nothing shows it (`gcTime: 0`), so coming back starts from the first page.
- **The page's own measurements can trip the API's rate limit.** Collecting every page of the server's answer for each typed text (to compare with what the page showed) ran into 429s; the measuring script waits and retries. The page itself sends one request per settled query and per page.

**Measured 2026-10-05** against `next build && next start` and the API, a fresh headless Chrome profile, real key events, a member seeded with 5,000 distinct cards (10,078 copies) over 50 sets:

- the header and the summary agree: *Sets started* 50, `setCompletion` 50, six meters and *Show all 50 sets*;
- **scrolling to the end at 60 px a frame**, loading all 50 pages on the way: the grid in 34.8 s, 4,966 frames, median 7.0 ms, p95 7.1 ms, 2 frames over 16.7 ms, none over 33 ms (max 21 ms), 30 tiles in the DOM at the end; the list in 40.4 s, 5,750 frames, median 7.0 ms, p95 7.1 ms, 5 over 16.7 ms, none over 33 ms, 21 rows in the DOM; both ending *Showing 5,000 of 5,000 cards*;
- **the instant filter** typing `c`, `ch`, `cha`, `char` and deleting back to `c`: every name on screen, before the debounce and after the answer, was in the server's answer for that text (0 outside, against 442, 118, 28 and 14 distinct names); replacing `char` with `p`: dimmed and `aria-busy` at once, then *Showing 100 of 1,043 cards*; `POK` → `POKÉ`: nothing shown and nothing from the server; `POK` → `POKé`: nine *Poké…* names at once, all in the server's answer, *Slowpoke* gone;
- **URL**: choosing a set, *Common*, *Copies 2+*, *Price high–low* and the list gave `?set=cel25&rarity=Common&minQuantity=2&sort=price_desc&view=list`, and a reload kept every one, the menus reading *Set: Celebrations · 25/25 · Rarity: Common · Copies: 2+ (duplicates) · Sort: Price high–low* with the list pressed; a search `pi`, a set, then `pik`, then Back: `?q=pi`, the field `pi`, nothing on screen outside the server's answer for `pi`; a rarity changed while its answer was held 2 s: the old 20 tiles dimmed and `aria-busy`, then *Showing 100 of 857 cards*;
- **locked copies**: Growlithe (4 copies, all in pending trades) greyscale with the lock, named *Growlithe, Uncommon, 4 owned, all locked in pending trades, $1.45*; Lightning Energy (3, 1 locked) *…, 3 owned, 1 locked in pending trades, $0.49*, not greyscale; the list's *Copies* *4 · 4 locked* and *3 · 1 locked*;
- **at 375 px**: `scrollWidth` 375 in both views; resizing 1280 → 800 → 1280 mid-scroll went 5 → 4 → 5 columns with no overlapping rows;
- **a failing page**: the next page's request (and its retry) refused at the network: *Couldn't load more. Try again* under the 100 loaded cards; *Try again* → *Showing 200 of 5,000 cards*;
- **keyboard**: Tab from the search goes *Set → Rarity → Type → Copies → Sort → Grid view → List view* and on into the tiles in order; Enter on the list's *Price* header gave `sort=price_desc` and `aria-sort` *descending*; no console errors;
- **after the final review's fixes**, everything above re-run on a fresh build with the same results (grid median 7.0 ms, p95 7.1 ms, none over 33 ms; list the same), and: clearing `zzz` with the answer held 2 s showed *Searching…* (busy), then the cards — never *Your collection is empty* (before: it did); typing `zubat` over the unfiltered list sent 1 request (before: 35, 34 of them pages of the old query); focus returning to 1,300 loaded cards sent none (before: 13).

## Catalog (PD-108)

`/cards`: every mirrored card through the collection view — `FilterBar` (search, Set, Rarity, Type, Sort) over a `VirtualCardGrid` of `CardTile`s — on 100-card pages of `GET /cards` (`useCatalogBrowse`, an infinite query over `page`, with the inventory's rules: `answeredFor`, `keepPreviousData`, no refetch on focus, `gcTime: 0`). The filters are the inventory's vocabulary over the global facets; the sort is the API's, name A–Z or Z–A.

- **Public (D1).** The page moved to `(public)`; the proxy no longer protects `/cards`, and `isPublicPath` includes it. Signed out it renders in the public chrome, says *Sign in to see which ones you own*, and asks for nothing that needs a session.
- **Owned badges (D2).** For each loaded page, signed in, one `GET /inventory/owned?cardIds=…` with that page's 100 ids (`useOwnedCounts`, keyed under `inventory`, so an opened pack or a settled trade refreshes them). A card is drawn *not owned* — greyscale with the lock, as the mockup's "locked cards are trade targets" — only once its page's counts have answered; until then it has no badge, rather than a wrong one. Copies in pending trades read as on the inventory: *×4 · 1 locked*, or greyscale when all of them are promised.
- **The instant filter and its states are the inventory's**, now one function, `collectionView` in `lib/name-match.ts`: narrowing while the field runs ahead, `stale` while the cards answer something else, and `current` before claiming *No cards match* or loading more.
- **The topbar's search** is a plain `GET /cards?q=` form; the page reads `q` from the URL.
- **Public pages share the app shell's padding.** The public layout's `main` is `p-8`, like the app shell's, so a page sits the same with or without a session; the landing page undoes it (`-m-8`) to run edge to edge. The public nav's buttons are tighter below `sm`: at 375 px the logo and both buttons were 2 px wider than the screen — on the landing page too, which PD-101 had measured only signed in.

**Measured 2026-10-05** under `next dev` against the API, fresh headless profiles:

- anonymous `curl`: `/cards` 200 and `/cards/base1-4` 200; `/decks` and `/sets` still 307 to sign in;
- signed out: *Showing 100 of 20,670 cards*, the public nav, no tile named *owned*, no request to `/inventory/owned`, no console errors; `/cards?set=base1&rarity=Rare%20Holo`, opened signed out, *Showing 16 of 16 cards* from `base1-1`;
- signed in, as the member with 5,000 cards: one `/inventory/owned` request with 100 ids for the first page; all 25 rendered tiles named exactly as the database says (`N owned`, `N owned, K locked`, `all locked`, or `not owned`); scrolling to 500 cards: 5 catalog pages and 5 owned requests;
- *pikachu* typed into the topbar's search on `/dashboard`: `/cards?q=pikachu`, the field reading *pikachu*, *Showing 100 of 213 cards*, every tile a Pikachu;
- at 375 px: `scrollWidth` 375 signed in and signed out, and on the landing page signed out (before the nav fix: 377).

## Sets gallery (PD-109)

`/sets`: a card per set — logo, name, series, release date, printed card count — linking `/cards?set=<id>`, with tabs *Newest first · Oldest first · By series* in `?order=`. *By series* groups the sets under their series, in the order of each series' newest release. All 176 come from `GET /sets` (`useSets`, keyed `['catalog', 'sets']`); there are few enough not to virtualize.

- **Public (D1)**, like the catalog: moved to `(public)`, out of the proxy's protected list, into `isPublicPath`. Signed out there is no meter and no request for one.
- **Completion is the inventory summary's own figures.** Signed in, each set's `CompletionMeter` takes `owned` and `total` from `GET /inventory/summary`'s `setCompletion` — the same numbers the inventory's header shows. A set the collection has nothing from is *0 of* its `printedTotal`, the base the summary counts against. While the summary loads, each card shows a placeholder bar. `useInventorySummary` takes an `enabled` flag for this.
- The header's line counts sets started and sets complete from the same summary.

**Measured 2026-10-05** under `next dev` against the API, fresh headless profiles:

- anonymous `curl /sets`: 200; signed out: 176 sets, no meters, no `/inventory/summary` request, *176 sets, from the first expansion to the newest.*, no console errors;
- signed in, as the member with 5,000 cards: *176 sets · 50 started · 49 complete*; 176 meters — the 50 owned sets equal to the summary's `owned`/`total` exactly, the other 126 at 0 of their `printedTotal`, no mismatch; Base's meter speaks *102 of 102 cards, 100%*, as the summary says;
- Enter on Base: `/cards?set=base1`, *Showing 100 of 102 cards* (the set's `cardCount` is 102), the catalog's menu reading *Set: Base*;
- *Oldest first* starts Base, Jungle, Wizards Black Star Promos; *Newest first* 30th Celebration, 30th Celebration: Classic Collection, Pitch Black; *By series* 17 series from Mega Evolution, all 176 sets;
- at 375 px: `scrollWidth` 375, no broken logo, no console errors.

## Decks list (PD-111)

`/decks`: the member's decks, newest edit first — name (to the builder), format, card count, *Valid* or *Invalid*, and a *Public* switch — with *New deck*, *Clone* and *Delete*. `useMyDecks` is an infinite query over the API's pages (24 decks each, *Show more* beyond); the four deck mutations (`createDeck`, `updateDeck`, `cloneDeck`, `deleteDeck`) each invalidate the `decks` root.

- **Validity comes from the list itself (D3).** `GET /decks` now carries `valid` per deck, the validator's verdict computed when read (API.md, *Decks*), so an invalid deck is flagged here, with *Breaks a deck rule. Fix it in the builder*, without opening it. The header counts how many need fixing.
- ***New deck*** asks for a name and a format in a dialog — the API's rules (1–64 characters, trimmed; standard, expanded or unlimited) with sentences for people — creates the deck empty and opens it in the builder.
- ***Clone*** copies the deck (the API names it *… (copy)*, private) and opens the copy.
- ***Delete*** asks first, in a danger dialog that says the cards stay in the collection; Escape or *Cancel* changes nothing.
- **The switch** sets `isPublic` at once and says what it means: *Anyone with the link can see it* or *Only you can see it*.

**Measured 2026-10-05** under `next dev` against the API, real key events:

- *2 decks · 1 need fixing*: *Unfinished — Standard · 5 cards — Invalid — Breaks a deck rule* and *Base Sixty — Unlimited · 60 cards — Valid*;
- Space on Base Sixty's *Public* switch: one `PATCH`, the switch checked, *Anyone with the link can see it*, and the user's public shelf went from *Unfinished* to *Base Sixty, Unfinished*; Space again took it back off;
- *Clone* on Base Sixty: straight to `/decks/<new id>`, which the API answers as *Base Sixty (copy)*, 60 cards, private;
- *Delete* on the copy: *Delete Base Sixty (copy)?* with focus on *Cancel*; Escape closed it with no request and the deck still listed; again with *Delete deck*: one `DELETE`, the deck gone from the list, the toast *Deleted Base Sixty (copy)*, and the API answering 404 for it;
- *New deck* submitted empty: *Name the deck* under the field; *Fire Test*, *Expanded*: `/decks/<id>`, an empty expanded deck, listed first as *Invalid*;
- a member with no decks: *No decks yet* with *Build your first deck*;
- at 375 px: `scrollWidth` 375; no console errors.

## Deck builder (PD-112, PD-113)

`/decks/:id` is one page for two people (`components/decks/deck-page.tsx`): the owner gets the builder, anyone else the read-only public deck. The server page loads the deck once (with the visitor's cookies, shared with `generateMetadata` through React `cache`), so a missing deck or someone else's private one is the not-found page, and the client starts from that answer as `useDeck`'s `initialData`. Design: `docs/superpowers/specs/2026-10-05-pd-112-pd-113-deck-builder-design.md`.

- **The draft** (`lib/stores/deck-draft.ts`) is the name, the format, *Owned only / Theorycraft* (`ownedOnly`) and the cards, plus what the validator reads about each card and the owner's available copies. A clean draft follows the newest server copy (another tab saved, or the page opened from a stale cache: the server's fresher copy replaces the cached one); a dirty draft is never replaced by a refetch — *Public* saves at once (`PATCH isPublic`), invalidates every deck query, and the draft survives. A save replaces the draft only if nothing was edited while it was in flight; edits made meanwhile stay, and stay unsaved.
- **Validation is the API's own (D4).** `validateDeck` and `toDeckStats` moved to `@pokedrop/shared`; `useDeckChecks` runs them on every change, with no request and no debounce. Deck entries and inventory entries carry `legalities` (`PlayableCardSchema`) and the deck carries `rules.deckSize`. A card whose available copies are not known yet counts as available until `GET /inventory/owned` answers (*Checking your copies…*), so nothing flashes *not owned*. After a save the server's verdict replaces the page's until the next change — the one way they can differ is a trade locking copies in between.
- **Save** is one `PATCH` of the whole draft (Ctrl/⌘+S too). Rule failures never block it — the API saves an invalid deck on purpose — only what the API would refuse with a 400 does (an empty name, more than 100 distinct cards); the header names the reason. A save that fails keeps the draft: offline or 5xx *Couldn't save — your changes are still here*, 404 *This deck no longer exists*. The mutation runs with `networkMode: 'always'`, so offline it fails at once instead of pausing.
- **The pool** (`card-pool.tsx`) is *My cards* (the inventory, available copies on every tile) or *All cards* (the catalog, owned badges by `GET /inventory/owned`), with search and set, rarity and type, on PD-107's instant narrowing. It virtualizes inside its own column (`VirtualCardGrid` `scrollElement`). Every tile has *+ Add*, which refuses at the copy limit (counting other printings), at 100 distinct cards or 100 copies, and says why.
- **Drag** (`builder-dnd.tsx`, `@dnd-kit/core`): pool → deck adds a copy, deck → pool removes one; the card's art (or a row's art and name) is the handle, a 6 px move starts a drag, so a click stays a click. The keyboard sensor moves between the two zones on ←/→; Space picks up and drops, Escape cancels. Every step is announced with the card's name and the result. Below 1024 px there is no drag: three tabs (*Pool / Deck · n / Check*), *+ Add* and the steppers.
- **Leaving** with unsaved changes asks first — links, Back and reload — through `useUnsavedChanges` (Frontend.md): *Stay*, *Save and leave* or *Discard changes*. A fragment link (*Skip to deck*, the shell's *Skip to content*) is not Back; when the deck opened the tab, *Discard* after Back goes to `/decks`.
- **Checks and stats:** `DeckValidationBanner` on the live verdict, *Show card* scrolls to the row (switching to *Deck* first on a phone); the stats panel (Recharts, loaded with the panel only) draws supertypes, Pokémon types and rarities, each a `<figure>` with a caption summary and a visually hidden table of the same numbers.
- **The public view** shows the decklist read-only, the owner and the stats — never a verdict, which depends on the owner's private copies — with *Clone* for a member and *Sign in to clone* for a guest.

**Measured 2026-10-05** under `next dev` against the API, with real key and pointer events:

- a 60-card deck from an empty one by keys only — search, Tab to *+ Add*, Enter ×56 on *Lightning Energy* and ×4 on *Mewtwo*, Ctrl+S: **95 key presses**, *60/60 · Legal*, *Saved*, and `GET /decks/:id` holding exactly *Mewtwo ×4, Lightning Energy ×56*;
- two printings of *Charizard* (base1-4 and base4-4), two of each: a fifth by *+ Add* refused with *Charizard is at the 4-copy limit*, both steppers *4-copy limit, counting other printings*; a fifth *Mewtwo* by drop announced *Mewtwo is at the 4-copy limit; nothing added* and changed nothing;
- pointer: pool → deck *Added Mewtwo — 1 copy in the deck*, the deck column outlined while over it; deck → pool *Removed a copy of Charizard — 4 left*; keyboard: Space *Picked up Mewtwo from the pool. Arrow right to move it to the deck, Space to drop, Escape to cancel.*, → *Over the deck*, Space *Added Mewtwo — 2 copies in the deck*; Escape *Cancelled; the deck is unchanged*; a click on *+ Add* added without a drag;
- smoothness: a pool of *My cards* (5,000) scrolled to row 30, 16–27 tiles rendered; a drag of 60 pointer moves across the pool onto the deck: under `next build` / `next start` **no long task**, frames median 7 ms, worst 13.9 ms; under `next dev` one 95 ms task at the drag's start and none while moving;
- agreement: for two decks, after a change and a save and after restoring it, every rule's state and issue count on the page equal `POST /decks/:id/validate`; switching to *Standard* re-ran legality with **no request** (base-set cards record no standard legality, so the validator warns, as the API does); an owned-only deck with a card then locked by a new trade between load and save: the page predicted *1 rule failing*, the save answered *2 rules failing* with *needs 1 copy; 0 available*, and the page showed the server's;
- charts: removing an *Alakazam* moved *Pokémon 60 → 59* and *Psychic 8 → 7* in the captions and the hidden tables at once;
- leaving: with a clean draft no dialog; dirty: the sidebar's *Inventory* opened *Leave without saving?* with focus on *Stay*; *Stay* kept the page and the draft; Back opened it again; *Discard changes* went back to `/decks`; forward came back to the saved deck; *Save and leave* from a link saved and went on; reload raised the browser's `beforeunload`; after a save one Back left the page; flipping *Public* kept *Unsaved changes* and the draft;
- offline: *Couldn't save — your changes are still here*, *Unsaved changes*, *Save* enabled; online again it saved; a deck deleted from another tab: *This deck no longer exists*, *Back to decks* → `/decks`;
- 375 px: *Pool / Deck 60 / Check*, `scrollWidth` 375, no drag handles; *Show Mewtwo (BASE1 10)* switched to *Deck* and focused and highlighted `deck-slot-base1-10`;
- a guest on a public deck: name, *Standard · 5 cards · by PD102 Tester*, the stats, *Sign in to clone*, no builder; on a private one *Page not found*, tab *Deck · PokéDrop*; another member: *Clone* → the builder on *Unfinished (copy)*, private; no console errors anywhere.

**After the final review, 2026-10-05** (each reproduced first, then measured fixed): *Skip to deck* with a dirty draft opened no dialog and a link afterwards still asked; a deck that opened its tab (history length 1): Back, *Discard changes* → `/decks`; a rename made during a save slowed to 1.5 s survived it as *Unsaved changes*; a deck renamed by another tab while this one was on `/decks` came back as *Fresh Copy v2*; after a save answering a trade lock, the next edit still showed the ownership failure (the owned counts are dropped, not just invalidated, on save).

**Traps:**

- Keying the draft store by `updatedAt` would wipe it whenever *Public* is flipped: that mutation invalidates the deck query, and a new answer would mean a new store.
- dnd-kit fires *over* for the zone a drag starts in at once, which replaced the pick-up instructions in the live region before a screen reader finished them; the builder announces nothing for the origin zone.
- `react-hooks/refs` fails `drag.setNodeRef` on the object `useDraggable` returns; destructure it. `react-hooks/incompatible-library` fires for `useVirtualizer` (not for `useWindowVirtualizer`); the React Compiler is not enabled.
- A missing or private deck answered the not-found page with `noindex` but HTTP 200 while `(public)/loading.tsx` made every page in the group stream; since PD-110 removed it, the answer is a real 404.
- A TanStack Query mutation pauses while offline by default; a save that should fail visibly needs `networkMode: 'always'`.

## Trades inbox (PD-114)

`/trades` (`components/trades/trades-inbox.tsx`): the member's trades in four tabs — *All*, *Incoming*, *Sent*, *Completed* — kept in `?tab=` (`useUrlTab`), so each is a link and survives a reload. Each tab is `useTrades(tab)`, an infinite query over the API's keyset pages (24 a page, *Show more* beyond); *Incoming* and *Sent* carry their counts (`useTradeCount`, a one-row request read for `total`), which the header repeats: *2 waiting on you · 3 waiting on others*.

- **A row** is the counterparty (avatar, name, *IN* or *OUT*), the age, the two sides in words from the caller's side — *You give* / *You get*: up to two card names with counts, *n more cards*, coins — the status badge, and for a pending trade its expiry. The row links to the trade (`/trades/:id`, PD-116).
- **The expiry is the server's.** `GET /trades` carries `expiresAt` on a pending trade — `createdAt` + `TRADE_EXPIRY_DAYS`, computed by the API (API.md, *Reading trades*) — so the countdown cannot drift from the window the expiry job uses. It reads *Expires in 6d 14h*, then *5h 12m*, then minutes, updated once a minute by one shared clock; past due it says *Expiring now*, because the hourly job closes a due trade within the hour after.
- **Accept and decline** sit on incoming pending rows, each behind a dialog that restates both sides (*You give Psychic Energy / You get 30 coins*; the danger tone and *Cancel* first for a decline). Accepting invalidates trades, the inventory, the wallet, the session (`me`, the topbar balance), decks (their verdicts count copies) and notifications; declining invalidates trades and notifications. The API's refusals (a trade no longer pending, coins or cards short) come back through the mutation cache's toast.
- **Empty states** say what each tab would hold, with *Propose a trade* on *All* and *Sent*.

**Measured 2026-10-05** under `next dev` against the API: the second test member proposed two trades to the first (30 and 50 coins for a *Psychic Energy* and a *Mewtwo*), then:

- `/trades?tab=incoming`: *Incoming 2*, *Sent 3*, the header *2 waiting on you · 3 waiting on others*; both rows *IN · just now · You give Psychic Energy · You get 30 coins · Expires in 7d 0h · Pending · Accept · Decline*; after a reload still *Incoming*; Enter on *Sent* → `/trades?tab=sent`;
- the three sent trades' countdowns against the API's `expiresAt` at 17:44 UTC: `2026-10-12T08:32` → *Expires in 6d 14h* (twice), `2026-10-11T18:15` → *Expires in 6d 0h*;
- *Accept* on the *Psychic Energy* row: the dialog restating both sides with focus on *Cancel*; *Accept trade*: the toast, the row gone from *Incoming* (*Incoming 1*), the topbar balance *4,100 → 4,130* without a reload, `/users/me` and `/inventory/owned` refetched; the card was in the other member's inventory; on *Completed* the row reads *Accepted*;
- *Decline* on the other: Escape closed the dialog with no request; *Decline trade*: the toast, *Nothing waiting on you* on *Incoming*, the row *Declined* on *Completed*; a member with no sent trades: *No offers out*;
- at 375 px: `scrollWidth` 375, a 64-character display name cut with an ellipsis; no console errors.

## Trade composer (PD-115)

`/trades/new` (`components/trades/composer/`): pick a collector, put cards and coins on either side, review the offer in plain words, send it — or, with `?counter=<tradeId>`, answer an open offer with a counter-offer from the same screen. Design: `docs/superpowers/specs/2026-10-05-pd-115-trade-composer-design.md`.

- **Who** — *Trade with* is a combobox over `GET /users?q=` (D5, API.md *Users / Profile*): two characters or more, a 300 ms pause, arrows and Enter; the choice is a chip with *Change*. The caller is never a result. In counter mode the counterparty is the offer's initiator and cannot change.
- **What** — the existing `TradeOfferPanel`, *You give* and *Misty gives*, now with a count stepper per line and a picker behind each add slot (`CardPickerDialog`). *You give* lists the caller's cards: a card whose copies are all promised to pending trades is grey and says *All copies locked in pending trades*; a line stops at its available copies. *Misty gives* is the whole catalog with Misty's showcase first — their collection is private, so the review says the trade can only be accepted if they have the cards. A card on one side is refused on the other.
- **What keeps Review disabled** (`composeProblems`, the first reason beside the button): no counterparty, the caller as counterparty, nothing on either side, more than 20 cards a side, a card on both sides, a give line over its available copies, coins over the balance. The available copies come from `GET /inventory/owned`, re-read when *Review offer* is pressed and whenever the tab regains focus, so a copy locked from another tab is flagged on its line (*No copies available now*) before the review, and a released one clears.
- **The review** restates both sides as lists headed *You give Misty* and *Misty gives you*, with arrows and words, and what follows: the offered cards lock until Misty answers, the caller cancels or the offer expires (the window is the server's; the sent trade shows `expiresAt`); Misty's cards are checked only at acceptance; a counter replaces Misty's offer. *Send offer* goes to the new trade's page (`/trades/<id>`, since PD-116; it went to `/trades?tab=sent` before). A counter refused as already answered links to the original trade.
- **Refusals keep the draft** and return to editing: 409 `CARDS_UNAVAILABLE` (a copy locked meanwhile — the line is flagged), 402 (coins), 409 `TRADE_NOT_PENDING` for a counter on an offer already answered.
- **Pre-fill** — `?to=<userId>` sets the counterparty (the caller's own id is dropped with *You can’t trade with yourself.*), `?card=<cardId>` puts one copy on their side, `?counter=<tradeId>` flips an open offer made to the caller (anything else: *You can only counter an open offer made to you.*). The links to it come with the card page (PD-110), the profile (PD-117) and the trade page (PD-116).
- **Leaving** an offer the user has changed asks first (*Leave this offer?*, *Stay* / *Discard the offer*); a pre-filled offer nobody touched leaves freely.

**Measured 2026-10-05** under `next dev` against the API, with real key and pointer events:

- *Trade with*: `PD102` (the caller) → *No collectors match*; `nnn`, ArrowDown, Enter → the second member's chip; *Change* → the field again;
- the give picker on *Growlithe*: *Growlithe (BASE1 28), ×4 · 4 locked* grey with *All copies locked in pending trades*, the other eleven printings open; *Lightning Energy (×3 · 1 locked)* clicked four times: two added, then *All available copies added*, and the line's *One more* disabled;
- `?to=<own id>`: *You can’t trade with yourself.*, no counterparty, *Choose who to trade with*; `?to=<member>&card=base1-10`: their chip and *Mewtwo ×1* on their side, and *Mewtwo (BASE1 10)* in the give picker refused with *Already on …’s side — a card can’t be on both*;
- the review of *1 × Mewtwo (BASE1 10) + 10 coins* for *1 × Blaine's Charizard (GYM2 2)*: both headed lists, *Your 1 card locks until … answers, you cancel, or the offer expires.* and the line on unchecked cards;
- a changed offer: the sidebar's *Inventory* → *Leave this offer?* with focus on *Stay*; *Send offer* → the toast, `/trades?tab=sent` with the new row first (*You give Mewtwo, 10 coins · You get Blaine's Charizard · Expires in 7d 0h*), no prompt on the way, and `GET /inventory/owned` *base1-10: 2 owned, 1 available*;
- a single-copy *Ninetales* added, then locked by a trade from the page's `fetch`: *Review offer* stayed on editing with *Ninetales: no copies available — remove it* and the line marked; after cancelling that trade and the tab regaining focus, the problem cleared and *Review offer* went through; a *Venusaur* locked between Review and Send: 409, back on editing with *Some of your copies were locked by another trade meanwhile*, the draft intact;
- the second member countering the first member's gift of *Growlithe ×3*: *Counter PD102 Tester’s offer*, no *Change*, the gift on *PD102 Tester gives*, 25 coins added on their own side; the review's *Your counter-offer replaces PD102 Tester’s offer, which closes as Countered.*; sent: the original *COUNTERED*, the new trade *PENDING* from them to the first member with *REQUESTED Growlithe ×3* and 25 coins; `?counter=` on their own trade and on `nope`: the two explanations;
- at 375 px: `scrollWidth` 375 on editing and review, the picker 341/341; one Tab from the picker's search to the first card, Enter added it; no console errors anywhere.

**After the final review, 2026-10-06** (each reproduced first, then measured fixed): a counter-offer sent no longer flashes *You can only counter an open offer…* on the way to the inbox — the composer's inputs are read once (`ComposerStart`), so the countered offer refetching as *Countered* cannot swap the screen; an untouched pre-filled composer stays clean through `router.refresh()` (no *Leave this offer?* on the next link); focus moves with every view change — choosing a collector to *Change*, *Change* to the field, *Review offer* to the review's heading *Check the offer before you send it*, *Back to edit* to *Review offer*; *Review offer* offline says *Can’t reach PokéDrop…* instead of doing nothing (the recount runs with `networkMode: 'always'`); and `POST /trades` to a suspended collector answers 404 *User not found* (was 201, locking the caller's cards for a week).

**Traps:**

- A send leaves through the `leaveTo` that `useUnsavedChanges` returns, never `router.push` after clearing the dirty state: the guard's cleanup would pop its sentinel entry under the navigation.
- The owned counts are cached without refetching on focus elsewhere; the composer re-reads them on *Review offer* and on focus, or a lock made from another tab stays invisible until the server refuses the send.
- Prisma reads an insensitive `equals` as `ILIKE`: the user search escapes `%` and `_` in the exact match as well as in `contains`.
- A 64-character display name without spaces widened the page: the panel's and the review's sides are `min-w-0` with `wrap-anywhere`.

## Trade detail (PD-116)

`/trades/[id]` (`components/trades/trade-detail.tsx`): one trade from the caller's side — who it is with, what each side gives, where it stands, what the caller can do about it, and the negotiation it belongs to.

- **Not a party → not found.** The page reads `GET /trades/:id` on the server with the visitor's cookies (`loadTrade`, shared by the page and its title through `cache`), and a 404 — another member's trade, or no such id — calls `notFound()`. The client query starts from that read (`useTrade(id, initial, initialAt)`) and a later 404 is the same not-found page.
- **The header** — the counterparty's avatar, *Trade with Misty* (the name links `/profile/<id>`), *Misty proposed it 2 hours ago · Waiting on your answer* (or *Answered with a counter-offer*, *Expired unanswered*, *Cancelled by its sender* …), the status badge, and while pending the same *Expires in …* countdown as the inbox (`trade-summary.ts` now holds the inbox's clock and side summaries for both).
- **The sides** — `TradeOfferPanel`, read-only, from the caller's side: *You give Misty* and *Misty gives you*, full card tiles linking the card pages, the initiator's offered copies *Locked in escrow* while pending, coins as deltas (*−10 coins* red on the give side, *+50 coins* green on the other), an empty side as *Nothing*.
- **Actions by role and status** — only what the API would accept: the recipient of a pending trade gets *Accept trade*, *Counter* (a link to `/trades/new?counter=<id>`) and *Decline*; its initiator *Cancel offer*; a closed trade nothing. A negotiation already at `MAX_COUNTER_CHAIN` (10) trades shows no *Counter* and says to accept or decline. Accept, decline and cancel each confirm in a dialog restating both sides (*Keep the offer* / *Cancel the offer* for a cancel); after the answer lands the heading takes the focus, since the buttons go with the status. A refusal (409, answered elsewhere meanwhile) is the API's toast and the trade re-read.
- **Timeline and chain** — `TradeStatusTimeline` from the audit rows; a step can carry a link, so *Proposed by you, as a counter-offer* links the offer it answered and *Countered by you* links the counter-offer. Under it, *Negotiation · N offers* lists the whole chain oldest first — *Offer 2 · by you*, its date and status — each a link but the current one (`aria-current="page"`); the parties take turns, so who proposed each offer follows from its distance to this one. A trade that was countered also says so above the sides with *Open the latest offer*. Trades older than the trade core have no audit rows; their timeline is built from `createdAt`, the status and `resolvedAt`.

**Measured 2026-10-06** under `next dev` against the API, as the two test members (one with a 64-character name), every trade made for the run:

- a one-coin gift from the first member: the initiator saw only *Cancel offer*, *You give … −1 coins* — now *−1 coin* — and the timeline *Proposed by you · Awaiting …'s response · Cards swap and the trade settles*; the recipient saw *Accept trade*, *Counter* (`/trades/new?counter=<id>`) and *Decline*;
- *Counter* → the composer in counter mode → *Review offer* → *Send counter-offer* → the new trade's page: *Proposed by you, as a counter-offer* with *Open the offer it answered*, *Negotiation · 2 offers*, and only *Cancel offer* for its sender; that link → the original, *Countered*, no actions, *Countered by you* with *Open the counter-offer* and the banner's *Open the latest offer*; the link forward → the counter again;
- the first member accepting the counter through the dialog (*You give 1 coins · You get Nothing* — now *1 coin*, here and in the inbox): *Accepted*, no actions, focus on the heading;
- *Cancel offer* → *Keep the offer* / *Cancel the offer* → *Cancelled*, *Cancelled by you*, focus on the heading; a trade cancelled from another session while its recipient's page was open: *Decline* → the toast *This trade is already CANCELLED*, the page re-read as *Cancelled* with no actions; a plain decline → *Declined by you*;
- a chain of ten made through the API: the tenth's recipient saw *Accept trade* and *Decline*, no *Counter*, and *This negotiation has reached 10 offers, the most there can be: accept or decline this one.*;
- another pair's trade (`seed-trade-pending`) and `no-such-trade`: *Page not found* both, with `noindex`;
- at 375 px (device emulation): `scrollWidth` 375 on a counter and on the tenth of the chain; no console errors anywhere, `/dev/components` included.

**Traps:**

- The not-found page answers HTTP **200**, not 404: `(app)/loading.tsx` starts streaming before the page's read finishes, and Next cannot change the status afterwards, so it adds `<meta name="robots" content="noindex">` instead (`node_modules/next/dist/docs/01-app/02-guides/streaming.md`, *The HTTP contract*). The page is private; a real 404 would need the read before any Suspense boundary.
- Headless Chrome's window is never narrower than 500 px: `--window-size=375` measures a 485-px page. Phone widths take `Emulation.setDeviceMetricsOverride`.
- A timeline label with a long name widened the page until its text column got `min-w-0` with `wrap-anywhere`; the page grid needs an explicit `minmax(0,1fr)` column below `lg`.

## Card detail (PD-110)

`/cards/[id]` (`components/cards/detail/`): a Server Component, public and indexable — everything but the owned badge and the quick actions is in the first HTML response, for a visitor or a crawler with no session.

- **What it shows** — the large art (`CardArt` over the design's card face, which stays if the art fails; `fetchPriority="high"`, the page's LCP), name, rarity and type badges, supertype · subtypes · HP · set and printed number; *Abilities and attacks* with energy costs as icons and words; *Combat data* (weakness, resistance, retreat cost — *Card data* for a trainer or energy) and the formats it is legal in; *Set* with logo, symbol, series, release date, `number/printedTotal` and a link to browse the set.
- **Prices** — the card's latest TCGplayer USD and Cardmarket EUR, each with its 30-day history (`GET /cards/:id/price/history`) as a server-drawn SVG sparkline with a spoken summary, 30-day low/high and the change. The age is always shown — *Updated 3 weeks ago* from `priceUpdatedAt`, with *— may be out of date* past 7 days — and a card never priced says *Not priced yet*, so a stale price is never hidden.
- **Pokédex (D9)** — for a Pokémon, `lib/pokeapi.ts` reads `pokemon-species` and `pokemon` for its first national number: genus, the latest English flavour text, height, weight and base stats. It streams inside its own `Suspense` after the page has decided its status, and any failure — timeout, HTTP error, a shape `zod` refuses — is one server warning and no section.
- **Owned and quick actions** — a client island (`CardActions`). Signed in: *Owned: 3 · 1 locked in trades* or *Not in your collection* from `GET /inventory/owned` (D2); *Add to deck* opens a dialog of the member's decks and *New deck with Charizard* (the decks page's `NewDeckDialog`), and either opens the builder with `?add=` (D10); *Propose trade* links `/trades/new?card=<id>` (PD-115's pre-fill). Signed out, both buttons open *Sign in to add Charizard to a deck* / *Sign in to trade for Charizard* with *Sign in* (`next` back to the card, or straight on to the composer) and *Create an account*.
- **`?add=` in the builder** — read by the server page and passed down; once the deck has loaded, the builder drops the parameter from the URL (`history.replaceState`, so a reload or Back cannot add again), runs `addRefusal` and either adds one copy as an unsaved change (*Added Charmander — save the deck to keep it*) or says why not (*Charizard not added: Charizard is at the 4-copy limit*).
- **Metadata** — title *Charizard · Base 4/102*, a description with rarity, type, HP and the market price, `canonical`, Open Graph and Twitter cards with the large art; an unknown card is *Card not found*.

**Measured 2026-10-06** with the API and `next dev`, then Lighthouse 13 against `next build && next start`:

- `curl`, no session: `/cards/base1-4` 200 with the title, description, `canonical`, `og:*` and `twitter:*` above, and *Fire Spin*, the market price, *Weakness*, *Flame Pokémon*, *Add to deck* in the HTML; `/cards/nope-nope` **404**; `/cards/ex10-%3F` and `/cards/ex10-!` 200 (*Unown · Unseen Forces ?/115*); `/decks/nope-nope` now 404 too;
- signed out in the browser: no owned line; *Add to deck* → *Sign in to add Charizard to a deck*, *Sign in* → `/sign-in?next=%2Fcards%2Fbase1-4`; *Propose trade* → `next=%2Ftrades%2Fnew%3Fcard%3Dbase1-4`;
- signed in: *Owned: 3* on Charmander, *Propose trade* → `/trades/new?card=base1-46`; *Add to deck* listed three decks; choosing *Base Sixty* opened `/decks/<id>` with *Charmander ×1* added, *Save* enabled, the toast, and the URL without `?add=`; a reload added nothing; Charizard into a deck already holding four: *not added … 4-copy limit*; *New deck with Unown* → named, created, the builder with `ex10-?` added, saved as `ex10-?×1` (the deck deleted afterwards);
- prices: Charizard *Updated 7 days ago*, two sparklines (Cardmarket *€1,531.00 to €741.93*); Gardevoir ex (`sv1-245`) *Updated 3 weeks ago — may be out of date*, *$21.80*, *No price history in the last 30 days*; Koga's Ninja Trick (`gym2-115`) *Not priced yet*, no Pokédex section, *Card data*;
- PokéAPI pointed at an unroutable host: the page 200 in 0.2 s, everything but the Pokédex section, one server line *Species 6 unavailable: fetch failed*;
- 375 px (device emulation): `scrollWidth` 375 on Charizard and on the trainer; no console errors;
- Lighthouse: desktop 99 · 100 · 100 · 100 (LCP 0.9 s); mobile performance 81–83, accessibility, best practices and SEO 100, simulated LCP 4.6 s — the observed LCP is 235 ms. The simulation queues the card art behind the page's scripts (372 KB, 37 KB more than the landing's); the landing itself measures 86 on mobile today against 90 at PD-101, so the gap is the shared bundle, not this page.

**Traps:**

- A dynamic segment arrives still percent-encoded: `params.id` is `ex10-%3F`. Encoding it again for the API asked for `ex10-%253F` and 404'd; the page decodes it first. Every link to a card page now encodes the id (`CardTile`, the inventory list) — `/cards/ex10-?` is the card `ex10-` with a query string.
- `preload` on `next/image` only adds a `<link>`; the request stayed *Low* priority until `fetchPriority="high"`.
- `TaskStop` on `npx next start` stops the shell, not the server: the next start failed on the port, and Lighthouse measured the old process against a new `.next`. Stop the process that owns the port.

## Profile (PD-117)

`/profile/[id]` (`components/profile/`): one route, two audiences. The server renders the public profile — the same HTML for every visitor, signed in or not — and the owner's private sections are added in the owner's own browser.

- **Public, server-rendered** — `GET /users/:id` and the first page of `GET /users/:id/decks` with the visitor's cookies; an unknown id is a real 404 (no loading boundary above it since PD-110). The header (avatar, name, *Joined October 2026*), stat cards (*Showcased cards*, *Public decks*, and only when their owner turned them on, *Collection value* and *Different cards*), the showcase as card tiles, *Set completion* — the four sets furthest along, only with `showSetCompletion` — and the public decks. Title is the name; description, `canonical`, Open Graph `profile` and a Twitter card; `og:image` is the first showcased card.
- **Privacy is the API's** — `collection` and `completion` are absent from `GET /users/:id` unless their toggles are on, and the page renders only what the answer carries, so *hidden* means not in the HTML at all. The toggles themselves are set on Settings (PD-118); until then, through `PATCH /users/me`.
- **The owner's sections** (`OwnProfile`) — rendered only when the session is the profile's owner, from the owner's own endpoints (`/users/me`, `/inventory/summary`, `/trades`, `/decks`): balance, collection value and card counts, which of the two figures visitors see (*hidden from visitors*, *Change what visitors see* → Settings), the five latest trades with links, and the private decks. Another member's page, and the server HTML for anyone, never holds them.
- **The action** (`ProfileActions`) — the owner gets *Edit profile* (→ `/settings`); another member *Propose trade* → `/trades/new?to=<id>`, which opens the composer with them chosen (PD-115); a visitor *Propose trade* → *Sign in to trade with Misty* with `next` straight to the composer.

**Measured 2026-10-06** with the API and `next dev`, the first test member as owner with three cards showcased for the run (restored afterwards):

- signed out: *Showcased cards 3*, *Public decks 1*, sections *Showcase* and *Public decks* only, *Propose trade* → *Sign in to trade with PD102 Tester*, `next=%2Ftrades%2Fnew%3Fto%3D<id>`; the browser made no request to `/users/me`, `/inventory/summary`, `/trades` or `/decks`; `curl` of the page: no *Only you see this*, *Balance*, email or `currency` in the HTML; `/profile/nope` **404**;
- the second member: the same page and *Propose trade* → `/trades/new?to=<id>`, the composer showing *PD102 Tester* with *Change*; no private section;
- the owner: *Edit profile*, and *Only you see this* — *Balance 4,128*, *Collection value $237,060.36*, *10,077 · 4,999 different*, both figures *hidden from visitors*, five recent trades, the private decks *Base Sixty* and *Guard Two*;
- the toggles through `PATCH /users/me`, the page fetched without a session after each: value on → *Collection value* in the HTML and `collection` in the API; both on → also *Set completion* and *Different cards*, `completion` in the API; both off → none of the three strings in the HTML and neither key in the API;
- 375 px (device emulation): `scrollWidth` 375 for the owner and for the 64-character name; no console errors.

**Traps:**

- The empty-showcase sentence carries the name: a 64-character name without spaces widened the layout viewport to 535 px under mobile emulation while no element measured wider than 375 — the layout had been settled at load. Hiding candidates with a style injected before load (`Page.addScriptToEvaluateOnNewDocument`) found it; the sentence is `wrap-anywhere` now.
- A page's own `openGraph` replaces the group's file-based `opengraph-image`, and a file-based image in the segment would override the showcase card: a profile with an empty showcase is shared without an image.

## Account settings (PD-118)

`/settings` (`components/settings/`): four sections, each saving on its own. No theme choice — dark is the only theme (D7).

- **Profile** — *Display name* and *Avatar image address* against `ProfileIdentitySchema`, the rules `PATCH /users/me` and sign-up use (an empty avatar field means none, sent as `null`); the avatar preview follows the field. *Email* is shown read-only (D7). *Save profile* is enabled once something changed; after the save `router.refresh()` re-renders the shell, whose name and avatar come from the server. Since PD-118 the shared schema says *Use an https:// address* instead of zod's *Invalid URL*, and the API answers with the same words.
- **Privacy** — *Show my collection value* and *Show my set completion*, each a `PATCH` of its own the moment it flips, with a toast saying what visitors now see; the public profile reads the toggle on its next request.
- **Password** — current, new and repeated, against `ChangePasswordSchema` (shared: the current one only non-empty, the new one `NewPasswordSchema`, the two equal), and *Sign out of every other device*, on by default, sent as Better Auth's `revokeOtherSessions`. A wrong current password lands on its field: *That isn’t your current password*. `change-password` joined the strict throttle tier: it checks the current password, so with a stolen session it was an unthrottled oracle for guessing it.
- **Sessions** — `GET /api/auth/list-sessions` with `get-session` for *This device*: browser and system read from the user agent (*Chrome on Windows*), IP, when it signed in and was last active. *Sign out other devices* confirms *Sign out 15 other sessions?* and then says what it did — *Signed out 15 other sessions. This device is still signed in.* — in a status line that stays after the list refreshes. The list's answer also carries every session's token (Better Auth revokes by token); the schema drops it unread.

**Measured 2026-10-06** with the API and `next dev`, headless Chrome with real key events:

- *Display name* emptied: `aria-invalid`, *Enter a display name*; `http://example.com/a.png`: *Use an https:// address*; *PD102 Tester Renamed* saved: the toast, the account menu *Account menu for PD102 Tester Renamed* without a reload, `GET /users/me` the same; renamed back;
- *Show my collection value* on: the toast *Visitors now see your collection value*, and the very next `GET /users/:id` without a session carried `collection` and `/profile/<id>` showed *Collection value*; off: both gone;
- the second member with two more sessions from `curl`: 16 listed, *This device* first; *Sign out other devices* → *Sign out 15 other sessions?* → *Signed out 15 other sessions. This device is still signed in.*, one row left, both `curl` sessions' `get-session` `null`, the page still signed in;
- *Repeat the new password* different: *The passwords do not match*; a wrong current password: *That isn’t your current password* with the focus on it; the right one with *Sign out of every other device*: *Password changed. Every other device was signed out.*, a fourth `curl` session `null`, this page still signed in (the password set back afterwards);
- eleven `change-password` calls from one address within the window: the eleventh and later 429;
- 375 px (device emulation): `scrollWidth` 375; no console errors.

**Traps:**

- Under zod 4 a union of `''` and a URL reports the URL branch's own message, not the union's: the readable message belongs on the shared URL rule.
- A settings save changes what the server rendered into the shell (the name in the account menu): `router.refresh()`, not only the query cache.

