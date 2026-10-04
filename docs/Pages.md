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
| D7 | Settings shows the email read-only and has no theme choice: dark is the only theme | PD-118 |

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
