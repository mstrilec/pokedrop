# Information Architecture

> Page inventory, routing, navigation chrome, and RBAC gating. Extracted from `design/Information Architecture.dc.html`.
> **32 pages across 4 access zones.** Flows between them are in [UserFlows.md](UserFlows.md).

## Access zones

```
01 PUBLIC ──▶ 02 AUTH ──▶ 03 USER APP ──▶ 04 ADMIN (role-gated)
```

| Zone | Auth | Chrome |
|---|---|---|
| **01 Public** | none | Public top nav (Sign in / Create account) |
| **02 Auth** | credential flows | Minimal centered card |
| **03 User App** | member + admin | Persistent app shell (sidebar + topbar) |
| **04 Admin** | `role = ADMIN` | App shell + Admin sub-nav under `/admin` |

## Navigation model (3 chrome contexts)

1. **Public top nav** (unauthenticated) — logo · Sign in · Create account. CTAs route into Auth. Wraps marketing + any shareable read-only page.
2. **App nav shell** (persistent, authenticated) — 236px sidebar (Dashboard, Packs, Inventory, Browse, Sets, Decks, Trades; Account group; role-gated Admin group) + 60px topbar (search · currency pill → wallet · bell → notifications · "Open packs" CTA · avatar menu). Avatar menu: My profile · Account settings · Currency & history · Sign out / Sign out all.
3. **Admin sub-nav** (role-gated) — Overview · Pack templates · Sync · Users · Trades · Audit log. Nested under `/admin`, visible only when `role = ADMIN`. **Role-gated links are removed from the DOM, not just hidden.**

---

## 01 — Public (4 pages)

| Page | Route | Notes |
|---|---|---|
| Landing | `/` | Entry hub. Marketing + CTAs → Auth. |
| Public Profile | `/profile/:id` | Shareable read-only. |
| Public Deck | `/decks/:id` | Shareable read-only. |
| Card Detail | `/cards/:id` | Shareable · **SEO** (Server Component). |

Any action (trade, add-to-deck) on a public page prompts sign-in.

## 02 — Auth (5 pages)

| Page | Route |
|---|---|
| Register | `/register` |
| Verify Email | `/verify-email` |
| Sign In | `/sign-in` |
| Forgot Password | `/forgot-password` |
| Reset Password | `/reset-password` |

Flow: `Register → Verify → Sign In → Dashboard`; `Forgot → Reset → Sign In`. Success → Dashboard (onboarding).

## 03 — User App (17 pages, 6 sections)

**Primary hub:** Dashboard (`/dashboard`) — welcome, onboarding checklist, stat cards, featured packs, recent activity, set-completion.

| Section | Pages (route) |
|---|---|
| **Packs & opening** | Packs (`/packs`) → Pack Reveal (`/packs/open`) → Pack History (`/packs/history`) |
| **Collection & catalog** | Inventory (`/inventory`) · Catalog/Browse (`/cards`) · Sets Gallery (`/sets`) — all → Card Detail (`/cards/:id`) |
| **Deck building** | Decks (`/decks`) → Deck Builder (`/decks/:id`) |
| **Trading** | Trades inbox (`/trades`) · Propose Trade (`/trades/new`) · Trade Detail (`/trades/:id`) |
| **Profile & account** | My Profile (`/profile/:id`) · Settings (`/settings`) · Currency/Wallet (`/wallet`) |
| **Notifications** | Notification Center (`/notifications`) |

## 04 — Admin (6 pages, role-gated under `/admin`)

| Page | Route |
|---|---|
| Admin Dashboard (hub) | `/admin` — operations metrics |
| Pack Templates | `/admin/packs` |
| Sync Control | `/admin/sync` |
| User Management | `/admin/users` |
| Trade Moderation | `/admin/trades` |
| Audit Log | `/admin/audit` |

---

## Contextual cross-links

Dashed connections that jump between sections (not part of primary nav):

- Inventory → Card Detail
- Card Detail → Deck Builder (add to deck)
- Card Detail → Propose Trade
- Card Detail → Sets Gallery (its set)
- Public Profile → Propose Trade
- Pack Reveal → Inventory / Card Detail
- Sets Gallery → Catalog (filtered)
- Deck Builder → Card Detail
- Notifications → Trade Detail
- Trade Detail → Propose (counter)
- Dashboard → Packs (open first pack)
- Profile → Deck / Card Detail

## RBAC gating summary

| Capability | Member | Admin |
|---|:---:|:---:|
| Register / manage own profile | ✅ | ✅ |
| Open packs, view inventory | ✅ | ✅ |
| Build/edit/delete/publish own decks | ✅ | ✅ |
| View public profiles & decks · card detail | ✅ | ✅ |
| Create/accept/decline/counter trades | ✅ | ✅ |
| Manage pack templates & rarity weights | ❌ | ✅ |
| Trigger catalog/price sync | ❌ | ✅ |
| Grant/adjust currency | ❌ | ✅ |
| Promote/demote roles, ban/suspend | ❌ | ✅ |
| View audit logs & dashboards | ❌ | ✅ |
| Moderate/void suspicious trades | ❌ | ✅ |

RBAC is enforced **server-side** via NestJS guards; the UI hides/disables what a role can't do but never relies on the client for enforcement.
