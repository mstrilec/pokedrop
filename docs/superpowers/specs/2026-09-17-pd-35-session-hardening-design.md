# PD-35 — Session hardening

Design, 2026-09-17. Milestone M2 · Auth & RBAC.

Ticket: [PD-35](https://linear.app/mstrilec/issue/PD-35/session-hardening-secure-cookies-refresh-rotation-sign-out-all) ·
Reference: `docs/PRD.md` §12 (session security), §17 (transport & headers).

---

## The problem the ticket was written against

PD-35 was created on 2026-08-12, a month before Better Auth was adopted in PD-29. Its
scope list describes an OAuth-shaped session: an access token, a refresh token, a token
family, and rotation on every refresh. The implementation this project actually has is a
single opaque session token in an httpOnly cookie, stored in `sessions.token`.

The difference is not a detail. It decides what the ticket can deliver.

### Evidence

`better-auth@1.7.5/dist/api/routes/session.mjs:198-202` is the entire refresh path:

```js
const updatedSession = await ctx.context.internalAdapter.updateSession(
  session.session.token,
  { expiresAt: getDate(ctx.context.sessionConfig.expiresIn, 'sec'), updatedAt: new Date() },
);
```

The token is the lookup key, not a value being replaced. Refreshing a session moves
`expiresAt` forward on the same row. No new token is issued, so no old token exists to be
replayed, so there is no family to invalidate.

### Disposition of the scope list

| Ticket scope item | Disposition |
| --- | --- |
| Cookies: `httpOnly`, `Secure`, `SameSite`, scoped path and domain from config | **Build.** Attributes are currently library defaults; none is configurable. |
| Refresh-token rotation with reuse detection | **Not applicable.** No refresh token exists. Documented with the evidence above. |
| "Sign out all sessions" endpoint | **Verify, then fix a neighbour.** Four endpoints already exist; the freshness gate is on the wrong one. |
| CSRF protection for cookie-based mutating requests | **Build.** `/api/auth/*` is protected; `/api/v1/*` is not. |
| Short-lived access tokens if the JWT path is used | **Condition not met.** The JWT path is not used. |

| Acceptance criterion | Disposition |
| --- | --- |
| AC1 — a replayed refresh token invalidates the whole session family | Not achievable in this architecture. Recorded, with evidence, as an accepted architectural boundary. |
| AC2 — "sign out all" immediately rejects a second browser's session | Measured. Revocation turns out not to be age-gated; the device list is, which is the finding. |
| AC3 — a cross-origin POST without a CSRF token is rejected | Measured, and extended to the application's own routes. |

### Why rotation is not built

Rotation could be bolted on: add `familyId` and `rotatedAt` to `sessions`, replace the token
in `SessionGuard`, and reject a token whose `rotatedAt` is set. It is rejected because
Better Auth's own `getSession` knows nothing about those columns and would keep accepting a
rotated token on every path that does not run through the guard — the auth handler's own
routes included. The result is two session systems disagreeing about which tokens are live,
which is worse than one system without rotation.

It also contradicts the constraint recorded in `apps/api/src/auth/README.md`: everything
provider-specific stays behind the `auth` folder so the provider can be replaced. A
hand-rolled session lifecycle sitting on top of the provider's own is precisely the coupling
that document exists to prevent.

---

## What a stolen cookie actually costs, and what shortens it

Stating the threat model plainly, because it is what the remaining work is measured against.

A session cookie is a bearer credential. Anyone holding it is the user until it expires or is
revoked. The defences available here are:

1. **It cannot be read by script** — `httpOnly`, already on by default.
2. **It cannot cross to an attacker's origin** — `SameSite`, plus the Origin checks below.
3. **It can be revoked** — `revoke-session`, `revoke-other-sessions`, `revoke-sessions`, none
   of which is age-gated.
4. **Its use is visible** — `sessions.ipAddress` and `sessions.userAgent`, surfaced by
   `list-sessions`.
5. **It expires** — 7 days, extended at most once per day while active.

Rotation would have added a sixth: theft becomes *detectable* because two parties present the
same token. Its absence is the residual risk this ticket accepts and records.

---

## Component 1 — cookie attributes become configuration

### Current state

`better-auth/dist/cookies/index.mjs:30-42` builds every cookie from a fixed base:

```js
attributes: {
  secure: !!secureCookiePrefix,
  sameSite: 'lax',
  path: '/',
  httpOnly: true,
  ...crossSubdomainEnabled ? { domain } : {},
  ...options.advanced?.defaultCookieAttributes,
  ...overrideAttributes,
  ...attributes,
}
```

Nothing in `auth.factory.ts` overrides any of it. `useSecureCookies` is wired to
`config.app.isProduction` and that is the whole of the project's control over its session
cookie.

### Change

Three new environment variables:

| Variable | Type | Default | Purpose |
| --- | --- | --- | --- |
| `AUTH_COOKIE_DOMAIN` | optional string | unset | Host-only cookie when unset. `.pokedrop.app` shares the session across subdomains. |
| `AUTH_COOKIE_SAME_SITE` | `lax` \| `strict` \| `none` | `lax` | `none` only for a deployment where the web app and the API are on different registrable domains. |
| `AUTH_SECURE_COOKIES` | optional boolean | `NODE_ENV === 'production'` | Forces the `Secure` attribute and the `__Secure-` name prefix. |

They reach Better Auth as:

```ts
advanced: {
  useSecureCookies: config.auth.secureCookies,
  defaultCookieAttributes: {
    ...(config.auth.cookieDomain ? { domain: config.auth.cookieDomain } : {}),
    sameSite: config.auth.cookieSameSite,
  },
}
```

`defaultCookieAttributes` is spread after the `crossSubDomainCookies` domain and before
`overrideAttributes`, so `domain` and `sameSite` win while the session cookie's `maxAge`
(the only thing `overrideAttributes` carries) is left intact. Verified by reading the spread
order at the line cited above.

### Two deliberate constraints

**`secure` is driven only by `useSecureCookies`, never by `defaultCookieAttributes`.** In the
same block, `secure: !!secureCookiePrefix` ties the attribute to the `__Secure-` name prefix.
Setting `secure` through `defaultCookieAttributes` would let a cookie carry `Secure` without
the prefix, or the prefix without `Secure`. One switch keeps them in agreement.

**`path` stays `/` and is not configurable.** This departs from the ticket's wording and the
reason is recorded here rather than argued again later. A cookie path is not a security
boundary: any document on the origin can reach a sibling path through the DOM, so path
scoping buys nothing against an attacker who is already executing on the origin. Both
`/api/auth/*` and `/api/v1/*` need the cookie, which leaves `/` as the only correct value.
An environment variable with exactly one admissible setting is the pattern
`apps/api/src/config/app.config.ts` already argues against in its note on cache TTLs.

### Boot-time refusal

`parseEnv` gains a cross-field check: `AUTH_COOKIE_SAME_SITE=none` together with secure
cookies off is refused, and the message names both variables.

This is the highest-value line in the component. Every current browser silently discards a
`SameSite=None` cookie that lacks `Secure`. The symptom is a sign-in that returns 200 and
leaves the user signed out — a failure with no error anywhere, in either the browser or the
server log. Refusing it at boot converts a day of debugging into a startup message.

---

## Component 2 — the application's own routes get an Origin check

### The gap

Better Auth guards `/api/auth/*` with Origin validation and Fetch Metadata checks
(`api/middlewares/origin-check.mjs`). That protection is the handler's, and the handler is
mounted on the Express instance outside the Nest router. `/api/v1/*` has none of it.

What stands in today is `sameSite: 'lax'`: the browser does not attach the cookie to a
cross-site POST, so the forged request arrives unauthenticated. That is real protection, but
it is implicit, it lives in the browser rather than in the service, and Component 1 makes it
configurable — a deployment that sets `AUTH_COOKIE_SAME_SITE=none` removes it entirely.

`app.enableCors()` is not a substitute. CORS governs whether the browser lets the caller
*read* the response. A CSRF attacker does not need to read anything; the write has already
happened.

### Change

`apps/api/src/common/guards/csrf.guard.ts`, registered as the **first** global guard in
`app.module.ts` — ahead of `SessionGuard`, so a rejected request never reaches the database
lookup that resolves a session.

The rule mirrors the provider's:

| Condition | Result |
| --- | --- |
| Method is `GET`, `HEAD` or `OPTIONS` | pass |
| Request carries no session cookie | pass |
| Session cookie present, `Origin` in `config.app.corsOrigins` | pass |
| Session cookie present, `Origin` missing, `null`, or unlisted | 403 |

The second row is what keeps the guard from breaking non-browser callers. CSRF requires
ambient credentials; a request without the session cookie has nothing to forge, so `curl`,
health probes and future server-to-server calls are unaffected. It is also exactly the
condition Better Auth documents for its own check ("Origin header validation when cookies are
present", `@better-auth/core/dist/types/init-options.d.mts:283`).

The cookie name is read once in `onModuleInit` from
`auth.$context` → `authCookies.sessionToken.name` rather than hardcoded, so it follows
`cookiePrefix` and the `__Secure-` prefix automatically.

The guard applies to `@Public()` routes as well. Public is a statement about who may call a
route, not about whether a cookie sent to it can be forged.

Rejection raises `ForbiddenException`, so it travels through the existing
`AllExceptionsFilter` and arrives in the standard envelope from PD-18 with its request id.

---

## Component 3 — sign out everywhere, and the gate that sits on the wrong endpoint

Four endpoints already exist and need no code:

| Endpoint | Effect | Middleware |
| --- | --- | --- |
| `POST /api/auth/revoke-sessions` | deletes every session for the user | `sensitiveSessionMiddleware` |
| `POST /api/auth/revoke-other-sessions` | deletes all but the calling one | `sensitiveSessionMiddleware` |
| `POST /api/auth/revoke-session` | deletes one by token | `sensitiveSessionMiddleware` |
| `GET /api/auth/list-sessions` | lists them, with `ipAddress` and `userAgent` | `freshSessionMiddleware` |

The two middlewares are not variants of one idea, and the difference decides what the user
can do after a day.

`sensitiveSessionMiddleware` (`session.mjs:304`) requires an *authoritative* session — it
sets `disableCookieCache: true` so the session is read from the database rather than from the
signed cookie cache. It does **not** check age. Revocation is therefore always available.

`freshSessionMiddleware` (`session.mjs:331`) is the one that checks age:

```js
if (ctx.context.sessionConfig.freshAge !== 0) {
  const createdAt = new Date(session.session.createdAt).getTime();
  if (Date.now() - createdAt >= freshAge) throw APIError.from('FORBIDDEN', SESSION_NOT_FRESH);
}
```

`freshAge` defaults to one day, and in this configuration it gates exactly two endpoints:
`list-sessions` and `unlink-account` — and the second is unreachable, because no social
provider is configured.

**So the gate sits on the wrong endpoint.** The three calls that *fix* a compromise stay open
for the whole seven-day session. The one call that makes a compromise *visible* — the device
list showing an IP and a user agent you do not recognise — stops working after twenty-four
hours, which is to say it stops working before almost anyone would think to look.

AC2 is therefore safe: "sign out all" is not freshness-gated, and that will be measured
rather than asserted. The `list-sessions` gate is the finding, and the resolution is to raise
`session.freshAge` to the session lifetime so the list remains readable for as long as the
session it describes. The cost of that change is bounded and known: `unlink-account`, which
this application cannot reach.

`freshAge: 0` is rejected as the alternative. It disables the check globally and permanently,
including for endpoints that PD-32 and a future account-deletion flow will want it on.

Both claims are measured by moving `sessions.createdAt` backwards with SQL, since waiting a
day is not a measurement strategy.

---

## Verification plan

Every claim below is a command run against the running stack, not an inspection of source.

| # | Claim | Method |
| --- | --- | --- |
| 1 | Cookie carries `HttpOnly`, `SameSite=Lax`, `Path=/`, and no `Domain` by default | read the real `Set-Cookie` header from a sign-in |
| 2 | `AUTH_COOKIE_DOMAIN` reaches the header | boot with it set, re-read `Set-Cookie` |
| 3 | `AUTH_SECURE_COOKIES=true` adds `Secure` and the `__Secure-` prefix | boot with it set, re-read `Set-Cookie` |
| 4 | `sameSite=none` without secure cookies is refused at boot | boot with that pair, capture the startup error |
| 5 | Two sign-ins produce two sessions | two cookie jars, `list-sessions`, `select count(*) from sessions` |
| 6 | `revoke-sessions` kills both | call it from jar A, then `get-session` from jar B, then count rows |
| 7 | `revoke-other-sessions` kills only the other | same, checking jar A still resolves |
| 8 | Revocation is **not** freshness-gated | backdate `sessions.createdAt` by SQL, retry #6 |
| 8b | `list-sessions` **is** freshness-gated, and the fix lifts it | backdate, call `list-sessions`, expect `SESSION_NOT_FRESH`; raise `freshAge`, repeat |
| 9 | Cross-origin POST with a cookie is rejected | `POST` with `Origin: https://evil.example` and the session cookie |
| 10 | Same-origin POST with a cookie passes | the same request with an allowlisted `Origin` |
| 11 | POST without a cookie passes regardless of `Origin` | same request, no cookie |
| 12 | Cross-origin `GET` with a cookie passes | safe methods are not gated |

Measurements 9 through 12 need a mutating route under the Nest router, and none exists yet —
`AppController` has a single `@Get()`. A throwaway `POST` will be added for the measurement
and removed before the commit. The completion report states this explicitly rather than
implying the guard was exercised by a shipped route.

---

## Documentation

| File | Change |
| --- | --- |
| `apps/api/src/auth/README.md` | new section: session lifetime, the cookie's attributes and which variable controls each, and the rotation finding with its file and line |
| `.env.example` | the three variables, each with the reason it exists |
| `docs/API.md` | the four session-management endpoints, and which of them the freshness gate applies to |

Forward notes, into tickets that are not started:

- **PD-32** (password reset) — `changePassword` accepts `revokeOtherSessions`. A credential
  change that leaves old sessions alive is the closest thing this architecture has to the
  reuse detection AC1 asked for, and PD-32 is where it belongs.
- **PD-36** (rate limiting) — `/api/auth/*` is mounted on the Express instance, outside the
  Nest router, so a global `ThrottlerGuard` will never see it. It needs throttling at the
  Express layer.

---

## Files

| Path | Change |
| --- | --- |
| `apps/api/src/config/env.schema.ts` | three variables, one cross-field refusal |
| `apps/api/src/config/app.config.ts` | the `auth` namespace gains `cookieDomain`, `cookieSameSite`, `secureCookies` |
| `apps/api/src/auth/auth.factory.ts` | `advanced.defaultCookieAttributes`, `useSecureCookies` from config, `session.freshAge` raised to the session lifetime |
| `apps/api/src/common/guards/csrf.guard.ts` | new |
| `apps/api/src/app.module.ts` | register the guard first |
| `apps/api/src/auth/README.md` | session and cookie section |
| `.env.example` | three variables |
| `docs/API.md` | session-management endpoints |
| `docs/superpowers/specs/2026-09-17-pd-35-session-hardening-design.md` | this document |

No schema change, so no migration.

## Out of scope

Refresh-token rotation and reuse detection, for the reasons recorded above. Short-lived
access tokens, because the JWT path is not used. Rate limiting on the auth endpoints, which
is PD-36. Revoking sessions on password change, which is PD-32. A user-facing device list,
which belongs with the account settings page in M13 — `list-sessions` already returns the
data it would need.
