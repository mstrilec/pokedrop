# PD-86 + PD-89 — Typed API client, session and route protection

Design, 2026-09-30. Milestone M11 · Frontend Foundation.

Tickets: [PD-86](https://linear.app/mstrilec/issue/PD-86/typed-api-client-built-on-the-shared-zod-schemas) and
[PD-89](https://linear.app/mstrilec/issue/PD-89/session-handling-and-route-protection-middleware). One design because
they share one set of decisions — where the browser sends requests, which origin the session cookie lives on, and how a
server render authenticates — and deciding either alone would force the other to be reworked.
Builds on PD-84's route zones (`docs/Frontend.md`).
Reference: `docs/Architecture.md` §5 · `docs/API.md` (Conventions, error envelope, Auth) ·
`docs/InformationArchitecture.md` (access zones) · `docs/PRD.md` §4.

---

## What the tickets ask

| Scope item | Where it lands |
| --- | --- |
| PD-86: a thin `fetch` wrapper with base URL, credentials and typed methods | [API client](#api-client) |
| PD-86: responses parsed against the shared Zod schemas; a mismatch is loud | [API client](#api-client) |
| PD-86: the error envelope decoded into a typed `ApiError` with `statusCode` and `requestId` | [Errors](#errors) |
| PD-86: works in Server Components and the browser, forwarding cookies on the server | [Topology](#topology), [API client](#api-client) |
| PD-86: automatic retry only for idempotent GETs | [Retry](#retry) |
| PD-89: redirect unauthenticated `(app)` visitors to `/sign-in` with a return URL | [Proxy](#proxy), [Layouts](#layouts) |
| PD-89: session read once per request, provided through a typed context | [Session](#session) |
| PD-89: admin routes check `role = ADMIN` | [Layouts](#layouts) |
| PD-89: public routes reachable without a session | [Proxy](#proxy) |
| PD-89: an explicit note that this is UX, not security | [Proxy](#proxy) |

| Acceptance criterion | How it is met |
| --- | --- |
| A changed backend schema surfaces as a frontend typecheck failure | Endpoints are typed by the shared schema the API parses its own answers with; [Verification](#verification) 2 |
| Server Component fetches are authenticated with the incoming cookie | `serverApi` forwards the visitor's `cookie` and a trusted `Origin`; [Verification](#verification) 2 |
| Mutations never silently retry | Retry lives in one place and refuses every method but GET; TanStack Query's own retry is switched off in PD-87 |
| An expired session redirects to sign-in and returns to the original page after login | Proxy and `(app)` layout redirect with `next`; the sign-in form that consumes `next` is PD-102 |
| A member navigating to `/admin` is redirected, and the API would refuse anyway | Admin layout redirect; every admin endpoint is `@Roles(ADMIN)` |
| Public card detail pages render for anonymous visitors | `/cards/:id` is in `(public)`, never matched by the proxy's protected list |

## Decisions

1. **One origin.** The browser only ever talks to its own origin. `/api/*` on the web app is rewritten to the Nest API.
   Chosen over direct cross-origin calls (needs a shared parent cookie domain, CORS preflights, and breaks as third-party
   cookies go away) and over a full BFF (re-implements 55 operations to gain nothing rewrites do not give). Production is
   planned on a self-hosted Ubuntu machine, where web and API share one host anyway.
2. **The API owns `/api`.** The web app has no route handlers under `/api`; the whole prefix is rewritten.
3. **Server renders call the API directly**, not through the rewrite: `API_INTERNAL_URL`, the visitor's cookie, a
   trusted `Origin`, and the visitor's address.
4. **The frontend session is `GET /users/me`**, not Better Auth's `get-session`: the role and balance are read from the
   database on every request (`docs/API.md`, Conventions), and one call returns both.
5. **The proxy is optimistic.** It checks that a session cookie exists, nothing more. Validation happens in layouts, and
   enforcement in the API.
6. **Endpoints are declared as they are needed.** A descriptor per operation, added by the ticket that first uses it —
   not a 55-entry registry written up front.
7. **Retry lives in one place**, the client core.

## Topology

```
browser ──/api/v1/*, /api/auth/*──▶ Next (rewrite) ──▶ Nest :4000
browser ──pages──▶ Next ──serverApi──▶ Nest :4000   (cookie + Origin + visitor address)
```

- `next.config.ts` rewrites `/api/:path*` to `${API_INTERNAL_URL}/api/:path*`. Rewrites are resolved at `next build`:
  changing `API_INTERNAL_URL` means rebuilding.
- The session cookie is set through the rewrite, so it is host-only on the web origin. The proxy can read it, `SameSite=Lax`
  behaves as intended, and CORS plays no part for browser traffic.
- A reverse proxy placed in front later (PD-128/PD-129) may route `/api` straight to Nest; nothing the browser sees
  changes.

### Configuration

`apps/web/lib/env.ts`, server-only, Zod-validated:

| Variable | Default | Meaning |
| --- | --- | --- |
| `API_INTERNAL_URL` | `http://localhost:4000` | Where the Next server reaches Nest |
| `WEB_ORIGIN` | `http://localhost:3000` | The web app's public origin; sent as `Origin` by server calls, so it must be one of the API's `CORS_ORIGINS` |

No browser variable exists: browser code uses relative paths.

API-side, configuration and documentation only:

- **`AUTH_BASE_URL` becomes the web origin** (`http://localhost:3000` in development). Better Auth builds verification
  and reset links from it; a link to `:4000` would set its cookie on the wrong host, and in production that port is not
  public.
- **`TRUST_PROXY_HOPS`** is set to what probe 0 measures for traffic through the rewrite.
- **The visitor's address on server renders.** Anonymous `/api/v1` traffic is rate-limited by address, 100 a minute. A
  server render that does not forward the visitor's address makes every anonymous visitor share the Next server's
  bucket. `serverApi` forwards it in `X-Forwarded-For`; which value it may trust, and whether a client can forge it, is
  settled by probe 0 before any code depends on it.

### Probe 0

Run against the live API and `next start`, recorded in `docs/Frontend.md`, before implementation. Each item is a claim
this design relies on; a different answer amends this spec first.

1. `POST /api/auth/sign-in/email` through the rewrite sets the session cookie on the web origin.
2. `GET /api/auth/verify-email` through the rewrite: the 302's `Location` and its `Set-Cookie` arrive intact.
3. A `POST /api/v1/*` through the rewrite with the session cookie passes `CsrfGuard`.
4. What the API sees as the client address — through the rewrite, and from a server render — for each candidate
   `TRUST_PROXY_HOPS`, and whether a client-sent `X-Forwarded-For` can choose its bucket.
5. `proxy.ts` sees the session cookie.
6. **Hypothesis:** `SessionGuard` calls `auth.api.getSession` without returning headers, so when Better Auth rolls a
   session forward on a `/api/v1` request the refreshed `Set-Cookie` is dropped. The database session is extended to
   seven days from now, the cookie still expires seven days after sign-in, and an active user is signed out weekly.
   Measured by moving a session's `updatedAt` back past `updateAge` and comparing the cookie's expiry before and after a
   `/api/v1` request and a `/api/auth/get-session` request.

## API client

```
lib/api/
  core.ts          request building, fetch, parsing, ApiError, retry
  server.ts        server-only client: API_INTERNAL_URL, cookie, Origin, visitor address, no-store
  browser.ts       browser client: relative /api/v1
  endpoints/       descriptors, one file per resource
```

**Descriptors.** An endpoint is data — method, path, request schema, response schema:

```ts
export const me = get('/users/me', MyProfileSchema);
export const unreadCount = get('/notifications/unread-count', UnreadCountSchema);
export const openPack = post(
  (templateId: PackTemplateId) => `/packs/${templateId}/open`,
  OpenPackRequestSchema,
  PackOpenResultSchema,
);
```

A path may be a function of typed ids (`(id: DeckId) => \`/decks/${id}\``); a query is typed by the endpoint's shared
query schema. Bodies are typed with `z.input` of the shared request schema. Both clients expose one method,
`call(endpoint, args)`, returning `z.output` of the response schema.

M11 declares only what M11 uses: `me` (session, PD-89), `unreadCount` and the pack-open mutation (PD-87's invalidation
criterion). M13 pages add their own.

**Why a changed schema breaks the build.** The API parses every answer with the same shared schema before sending it
(`docs/API.md`: "the shared Zod schema the service already parses its answer with"). A renamed or retyped field changes
`z.output` of that schema, and every frontend read of the old field stops compiling.

**Parsing is not optional.** Every response is parsed with the endpoint's schema. A failure is an `ApiError` of kind
`contract` carrying the response's request id — a bug to fix, never a state to render around. Shared schemas coerce
dates, so parsed values hold `Date`s; React serialises them across the server/client boundary.

**Server client** (`import 'server-only'`):

- base `API_INTERNAL_URL`;
- `cookie` copied from the incoming request, `Origin: WEB_ORIGIN`, the visitor's address as probe 0 settles;
- `cache: 'no-store'` on every call — authenticated data never enters Next's data cache;
- wrapped per call site in React `cache()` where one render may ask twice (the session).

**Browser client:** base `/api/v1` on the current origin; the cookie travels by itself.

## Errors

```ts
class ApiError extends Error {
  kind: 'api' | 'auth' | 'network' | 'contract';
  statusCode: number;      // 0 for network
  code?: string;           // ERROR_CODES for 'api', Better Auth's code for 'auth'
  requestId?: string;
}
```

| Response | Kind | Source of `requestId` |
| --- | --- | --- |
| Body matches `ErrorEnvelopeSchema` | `api` | body |
| Body is Better Auth's `{ message, code }` (`/api/auth/*`) | `auth` | `X-Request-Id` header — the API sets it on every response |
| `fetch` throws | `network` | — |
| 2xx body fails the endpoint schema | `contract` | `X-Request-Id` header |
| Anything else non-2xx | `api`, message from the status | `X-Request-Id` header |

Callers branch on `code`, never on `message` (`docs/API.md`). Turning an `ApiError` into a toast is PD-91.

## Retry

- Only `GET`. Only once. Only on a `network` error or a 502, 503 or 504, after a short fixed delay.
- Never on a 4xx; never on a 429, whose `Retry-After` a retry would only spend.
- Never any other method, whatever the failure.
- TanStack Query's own retry is switched off in PD-87, so there are not two retry layers multiplying.

## Proxy

`apps/web/proxy.ts` (Next 16's replacement for `middleware.ts`, Node runtime).

- **Matcher** excludes `/api`, `/_next` and static files: the proxy runs before rewrites and must not touch API traffic.
- **Protected paths** come from `lib/routes.ts`: the prefixes `/dashboard`, `/packs`, `/inventory`, `/sets`, `/trades`,
  `/settings`, `/wallet`, `/notifications`, `/admin`, and the exact paths `/cards` and `/decks` — `/cards/:id` and
  `/decks/:id` are public.
- On a protected path without a session cookie (`better-auth.session_token`, or `__Secure-better-auth.session_token`
  when secure cookies are on): redirect to `/sign-in?next=<path and query>`.
- Every other request passes, with an `x-pathname` request header added so layouts know where they are.
- It never redirects a signed-in visitor away from `/sign-in`: a stale cookie would make that a redirect loop.
- The file opens with the note the ticket asks for: this is navigation comfort; the API is the boundary.

**Return URLs.** `safeNext(value)` in `lib/routes.ts` accepts only a path starting with a single `/` — not `//`, not
`/\`, not an absolute URL — and falls back to `/dashboard`. Every reader of `next` goes through it.

## Session

`lib/session/server.ts`:

```ts
export const getSession = cache(async (): Promise<MyProfile | null> => { … });
```

- No session cookie: `null`, without calling the API.
- Otherwise `serverApi.call(me)`:
  - 401 → `null`;
  - 403 `ACCOUNT_SUSPENDED` → `null`, with the reason kept for the redirect (the API has already deleted the session);
  - any other failure throws, to the route group's error boundary.
- The whole `MyProfile` is returned on the server: layouts pass identity to the client and PD-87 seeds the `me` query
  from the same object.

**What reaches the client.** A `SessionProvider` in the layouts passes identity only — `{ id, role, displayName,
avatarUrl }` — through `useSession()`. The balance and anything else a user's action changes belongs to TanStack Query
under the `me` key, which PD-87 seeds from the same server response, so no store holds data the query cache owns
(PD-88). A profile edit refreshes the route to update identity.

**A session that ends mid-use.** Navigation without a cookie is caught by the proxy. A revoked session whose cookie
survives answers 401 to the next browser request; `redirectToSignIn()` (PD-89) sends the visitor to
`/sign-in?next=<current location>`, and PD-87 wires it into TanStack Query's query and mutation caches.

**Keeping the cookie alive** — only if probe 0 confirms hypothesis 6. A client component in `(app)` calls
`GET /api/auth/get-session` at most once a day per tab. That route answers through the rewrite with Better Auth's real
`Set-Cookie`, so the cookie rolls forward with the database session.

## Layouts

| Layout | Check | On failure |
| --- | --- | --- |
| `(app)/layout.tsx` | `getSession()` not null | `redirect('/sign-in?next=' + x-pathname)`, with `error=ACCOUNT_SUSPENDED` when that was the reason |
| `(app)/admin/layout.tsx` | `session.role === 'ADMIN'` | `redirect('/dashboard')` |
| `(public)/layout.tsx` | `getSession()` may be null | never fails; chooses public nav or the app shell (rendered by PD-90) |

**Parallel rendering.** Next renders a layout and its page concurrently, so a page's own server call can start before
the layout's redirect wins. That call carries the member's session, and every admin endpoint answers it 403; the
redirect replaces the response, so none of the page's output is sent. The layout check is navigation comfort, the API
is the control — the same split as the proxy.

## Verification

No test suite (`docs/PRD.md` §20). Every claim is run once by hand against the live API and `next start`, and recorded
in `docs/Frontend.md` with its result. Signing in uses the project's seeded test users through a local
`/api/auth/sign-in/email` call, until PD-102 provides the form.

1. **Probe 0**, before implementation.
2. **PD-86:**
   - rename a field in `MyProfileSchema`, record where `pnpm typecheck` fails, revert;
   - a server-rendered page shows the signed-in user's `/users/me`, and the API log names that user;
   - against an API answering 503, a `POST` appears once in the log and a `GET` twice.
3. **PD-89:**
   - revoke the session, navigate to a protected page: `/sign-in?next=…` with the original path;
   - a member on `/admin` lands on `/dashboard`, and the admin endpoint called directly with that session answers 403;
   - `/cards/:id` answers 200 with no cookie;
   - `next=//evil.com`, `next=/\evil.com` and `next=https://evil.com` all resolve to `/dashboard`.
4. **Rate limit:** anonymous server renders on behalf of two different client addresses draw from two buckets
   (`X-RateLimit-Remaining`).
5. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`.

## Files

| File | Change |
| --- | --- |
| `apps/web/next.config.ts` | `/api/:path*` rewrite |
| `apps/web/lib/env.ts` | new — server-only env |
| `apps/web/lib/api/core.ts`, `server.ts`, `browser.ts` | new |
| `apps/web/lib/api/endpoints/users.ts`, `notifications.ts`, `packs.ts` | new — `me`, `unreadCount`, pack open |
| `apps/web/lib/routes.ts` | new — protected paths, `safeNext`, `redirectToSignIn` |
| `apps/web/lib/session/server.ts`, `lib/session/context.tsx` | new |
| `apps/web/proxy.ts` | new |
| `apps/web/app/(app)/layout.tsx`, `(app)/admin/layout.tsx`, `(public)/layout.tsx` | session checks, `SessionProvider` |
| `apps/web/package.json` | `server-only` |
| `.env.example` | `AUTH_BASE_URL` to the web origin, `TRUST_PROXY_HOPS` as measured, the two web variables |
| `docs/API.md` | the auth base URL, proxy hops, cookie refresh |
| `docs/Frontend.md` | PD-86 and PD-89 sections, with what was measured |

## Out of scope

- Sign-in, registration and reset forms, and Better Auth's client library — PD-102.
- Rendering the app shell and the adaptive public chrome — PD-90; this design supplies the session they need.
- The TanStack Query provider, the `me` query and wiring `redirectToSignIn` into its caches — PD-87.
- Toasts for `ApiError` — PD-91.
- The production reverse proxy or tunnel on the Ubuntu host — PD-128, PD-129.
- Any change to the API's code. If probe 0 shows the cookie refresh needs a server fix instead, that is a separate
  ticket.
