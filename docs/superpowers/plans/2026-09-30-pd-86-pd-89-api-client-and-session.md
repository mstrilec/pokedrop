# PD-86 + PD-89 API Client, Session and Route Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web app reaches the API only through its own origin, through one typed client that works in Server Components and the browser, and gates `(app)` and `/admin` on a session read once per request.

**Architecture:** `next.config.ts` rewrites `/api/*` to Nest. `lib/api/core.ts` builds, sends, retries (GET only) and parses every call against the shared Zod schema; `server.ts` adds the visitor's cookie, `Origin` and address and never caches, `browser.ts` uses relative paths. `proxy.ts` redirects on a missing session cookie; layouts validate with `GET /users/me` through `getSession()` and pass identity to the client.

**Tech Stack:** Next.js 16.3.5 App Router (`proxy.ts`, Node runtime), React 19.2, Zod 4 via `@pokedrop/shared`, Better Auth 1.7.5 on the API side.

**Spec:** `docs/superpowers/specs/2026-09-30-pd-86-pd-89-api-client-and-session-design.md`

## Global Constraints

- **No automated tests, runners or CI test steps during v1.** Every verification step is a typecheck, lint or build, plus a probe against the running stack (curl, `psql`, the browser).
- Commit straight to `dev`. Subject is `[PD-86]: …` or `[PD-89]: …`, lowercase, no trailing period, header ≤ 72 characters, and the message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Comments only where load-bearing; rationale belongs in `docs/`.
- **No change to `apps/api` source.** Configuration and documentation only.
- The web app has no route handlers under `/api`; the whole prefix belongs to the API.
- Browser code never uses an absolute API URL; server code never uses the rewrite.
- `serverApi` sends `cache: 'no-store'` on every call.
- Only `GET` retries: once, after 300 ms, on a network error or 502/503/504. Never on 4xx or 429. Never another method.
- `safeNext()` is the only reader of a `next` value. Its fallback is `/dashboard`.
- Session cookie names: `better-auth.session_token` and `__Secure-better-auth.session_token`.
- The proxy's note, in the code: navigation comfort, not access control; the API is the boundary.

## Review Focus

- **A `next` value that a browser normalises into another origin.** `/\evil.com`, `/%09/evil.com` (tab), `//evil.com`, `https://evil.com` and `/sign-in` itself must all resolve to `/dashboard`; `/trades/abc?tab=sent` must survive intact. Pinned in Task 3, Step 7.
- **A stale cookie on an auth page.** A revoked session whose cookie survives must never loop between `/sign-in` and `/dashboard`: the proxy never redirects away from `/sign-in`, and the `(app)` layout sends the visitor there once. Pinned in Task 3, Step 7.
- **`/cards` and `/decks` against `/cards/:id` and `/decks/:id`.** A prefix match would protect the public pages. Pinned in Task 3, Step 7 (`/cards/x` anonymous is 200; `/cards` anonymous redirects).
- **A client-sent `X-Forwarded-For`.** It must not choose the rate-limit bucket, through the rewrite or through a server render. Measured in Task 1, Step 5 and Task 2, Step 7.
- **A 204 or an empty body on success.** `core.ts` must parse `undefined` against the schema, not crash on `JSON.parse('')`. Pinned by reading in the final review; no M11 endpoint answers 204.

---

## Shared probe setup

Create once (Task 1, Step 1) at `$S/env86.sh`, and `source` it at the start of every probe step:

```bash
cd /m/projects/pokedrop
S="C:/Users/MaxSt/AppData/Local/Temp/claude/M--projects-pokedrop/16e24598-0135-4352-9a75-29ee9775cf38/scratchpad"
PSQL="docker compose exec -T postgres psql -U pokedrop -d pokedrop -At"
API=http://localhost:4000; WEB=http://localhost:3000; LAN=http://192.168.0.107:3000
P=pd86
mkuser(){ curl -s -o /dev/null -w "sign-up $1 %{http_code}\n" -X POST "$WEB/api/auth/sign-up/email" -H 'Content-Type: application/json' -H "Origin: $WEB" -d "{\"email\":\"$P-$1@example.com\",\"password\":\"correct-horse-battery\",\"name\":\"PD86 $1\"}"; }
verify(){ $PSQL -c "update users set \"emailVerified\" = true where email = '$P-$1@example.com'" >/dev/null; }
admin(){ $PSQL -c "update users set role = 'ADMIN' where email = '$P-$1@example.com'" >/dev/null; }
signin(){ curl -s -D "$S/signin-$1.h" -o /dev/null -w "sign-in $1 %{http_code}\n" -c "$S/jar-$1.txt" -X POST "$WEB/api/auth/sign-in/email" -H 'Content-Type: application/json' -H "Origin: $WEB" -d "{\"email\":\"$P-$1@example.com\",\"password\":\"correct-horse-battery\"}"; }
uid(){ $PSQL -c "select id from users where email = '$P-$1@example.com'"; }
cleanup(){ $PSQL -c "delete from users where email like '$P-%'" >/dev/null; echo cleaned; }
```

`sessions` and `accounts` cascade from `users`. The web app runs on `0.0.0.0:3000` so `$LAN` reaches it from a second address.

---

### Task 1: The rewrite, and probe 0

The configuration the whole design stands on, then every claim in the spec's probe 0 measured before any client code depends on it.

**Files:**
- Create: `apps/web/lib/env.ts`
- Modify: `apps/web/next.config.ts`
- Modify: `apps/web/package.json` (add `zod`)
- Scratch (deleted in Step 8): `$S/echo.mjs`, `apps/web/app/(public)/probe/page.tsx`

**Interfaces:**
- Produces: `env: { API_INTERNAL_URL: string; WEB_ORIGIN: string }` from `apps/web/lib/env.ts`.

- [ ] **Step 1: Probe helpers and dependencies.** Write `$S/env86.sh` from [Shared probe setup](#shared-probe-setup). Then:

```bash
cd /m/projects/pokedrop && pnpm --filter @pokedrop/web add zod@^4.6.5 server-only
docker compose up -d --wait
```

- [ ] **Step 2: The env module.** Create `apps/web/lib/env.ts`:

```ts
import { z } from 'zod';

const EnvSchema = z.object({
  API_INTERNAL_URL: z.url().default('http://localhost:4000'),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
});

export const env = EnvSchema.parse({
  API_INTERNAL_URL: process.env.API_INTERNAL_URL,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
});
```

It carries no `server-only` import because `next.config.ts` reads it too; `lib/api/server.ts` is the server-only boundary.

- [ ] **Step 3: The rewrite.** Replace `apps/web/next.config.ts`:

```ts
import type { NextConfig } from 'next';
import { env } from './lib/env';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${env.API_INTERNAL_URL}/api/:path*` }];
  },
};

export default nextConfig;
```

- [ ] **Step 4: What the rewrite and a server render forward (probe 0, item 4, header side).** Create `$S/echo.mjs`:

```js
import { createServer } from 'node:http';
createServer((req, res) => {
  const seen = { url: req.url, socket: req.socket.remoteAddress, xff: req.headers['x-forwarded-for'] ?? null, host: req.headers.host, origin: req.headers.origin ?? null, cookie: req.headers.cookie ?? null };
  console.log(JSON.stringify(seen));
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(seen));
}).listen(4001);
```

Create the scratch page `apps/web/app/(public)/probe/page.tsx`:

```tsx
import { headers } from 'next/headers';

export default async function Probe() {
  const h = await headers();
  return <pre id="probe">{JSON.stringify({ xff: h.get('x-forwarded-for'), realIp: h.get('x-real-ip') })}</pre>;
}
```

Run the echo server and the web app against it (background both):

```bash
node "$S/echo.mjs"
cd apps/web && API_INTERNAL_URL=http://localhost:4001 pnpm exec next dev -H 0.0.0.0 -p 3000
```

Then record every line:

```bash
source "$S/env86.sh"
curl -s "$WEB/api/v1/x"; echo
curl -s "$WEB/api/v1/x" -H 'X-Forwarded-For: 6.6.6.6'; echo
curl -s "$LAN/api/v1/x"; echo
curl -s "$LAN/api/v1/x" -H 'X-Forwarded-For: 6.6.6.6'; echo
for u in "$WEB" "$LAN"; do for h in '' 'X-Forwarded-For: 6.6.6.6'; do curl -s "$u/probe" ${h:+-H "$h"} | grep -o '<pre id="probe">[^<]*'; done; done
```

**Go / no-go.** The design needs both of: (a) the rewrite's `xff` ends with the connecting address (`::1`/`127.0.0.1` for `$WEB`, `192.168.0.107` for `$LAN`) whatever the client sent, and (b) the server render's `xff` does the same. Then an API trusting **one** hop reads the rightmost entry, which the client cannot forge, and `serverApi` forwards the incoming `x-forwarded-for` unchanged (Task 2). If either fails, **stop**: report the table and ask before writing Task 2.

Stop `next dev` and the echo server.

- [ ] **Step 5: The rewrite against the real API (probe 0, items 1–4 and 6).** Start the API with the web origin as its auth base and one trusted hop, and the web app against it (background both):

```bash
cd /m/projects/pokedrop && pnpm --filter @pokedrop/shared build && AUTH_BASE_URL=http://localhost:3000 TRUST_PROXY_HOPS=1 pnpm --filter @pokedrop/api start
cd apps/web && pnpm exec next dev -H 0.0.0.0 -p 3000
```

Wait for `curl -s $API/api/v1/health/ready` to answer 200, then:

```bash
source "$S/env86.sh"; cleanup
# 1: sign-in through the rewrite sets a host-only cookie on the web origin
mkuser member; verify member; signin member; grep -i '^set-cookie' "$S/signin-member.h"
# 3: a mutation through the rewrite with the cookie passes CsrfGuard; without Origin it does not
curl -s -o /dev/null -w "patch with origin %{http_code}\n" -b "$S/jar-member.txt" -X PATCH "$WEB/api/v1/users/me" -H 'Content-Type: application/json' -H "Origin: $WEB" -d '{}'
curl -s -o /dev/null -w "patch no origin %{http_code}\n" -b "$S/jar-member.txt" -X PATCH "$WEB/api/v1/users/me" -H 'Content-Type: application/json' -d '{}'
# 2: verification through the rewrite: 302, Location, Set-Cookie
mkuser fresh
id=$(curl -s 'http://localhost:8025/api/v1/messages' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).messages.find(m=>m.To[0].Address==='$P-fresh@example.com').ID))")
link=$(curl -s "http://localhost:8025/api/v1/message/$id" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).Text.match(/https?:\/\/\S+verify-email\S+/)[0]))")
echo "$link"
curl -s -i "$link" | grep -iE '^(HTTP|location|set-cookie)'
# 4: the rate-limit bucket through the rewrite, per address, and whether a client header moves it
for i in 1 2; do curl -s -D - -o /dev/null "$WEB/api/v1/sets" | grep -i 'x-ratelimit-remaining'; done
curl -s -D - -o /dev/null "$WEB/api/v1/sets" -H 'X-Forwarded-For: 6.6.6.6' | grep -i 'x-ratelimit-remaining'
curl -s -D - -o /dev/null "$LAN/api/v1/sets" | grep -i 'x-ratelimit-remaining'
```

Expected: (1) `Set-Cookie: better-auth.session_token=…` with no `Domain` attribute; (3) `200`, then `403`; (2) the link starts with `http://localhost:3000/api/auth/verify-email`, the answer is a `302` whose `Location` is the web app's `/verify-email` and which carries `Set-Cookie`; (4) the two `$WEB` requests count down one bucket, the spoofed one continues the **same** bucket, the `$LAN` one starts a **fresh** bucket.

Item 6, the cookie refresh hypothesis:

```bash
source "$S/env86.sh"
tok=$(grep better-auth.session_token "$S/jar-member.txt" | awk '{print $7}' | cut -d. -f1)
$PSQL -c "update sessions set \"expiresAt\" = now() + interval '5 days' where token = '$tok'" >/dev/null
curl -s -D - -o /dev/null -b "$S/jar-member.txt" "$WEB/api/v1/users/me" | grep -iE '^(HTTP|set-cookie)'
$PSQL -c "select \"expiresAt\" > now() + interval '6 days' from sessions where token = '$tok'"
$PSQL -c "update sessions set \"expiresAt\" = now() + interval '5 days' where token = '$tok'" >/dev/null
curl -s -D - -o /dev/null -b "$S/jar-member.txt" "$WEB/api/auth/get-session" | grep -iE '^(HTTP|set-cookie)'
```

Hypothesis confirmed when the `/api/v1/users/me` answer has **no** `Set-Cookie` while the database row moved to seven days (`t`), and the `/api/auth/get-session` answer **does** carry `Set-Cookie` with `Max-Age=604800`. If `/api/v1` does carry the cookie, the hypothesis is refuted: skip `SessionKeepAlive` in Task 3 and say so in the docs.

**Go / no-go.** Items 1, 2 and 3 must hold as expected. If any does not, **stop**, report, and amend the spec before Task 2. Item 4 must match Step 4's conclusion.

- [ ] **Step 6: Record.** Append every command's output to `$S/probe0.md` with the date, one heading per item. Task 4 moves the results into `docs/Frontend.md`.

- [ ] **Step 7: Typecheck, lint and build**

```bash
cd /m/projects/pokedrop && pnpm typecheck && pnpm lint && pnpm format:check
```

- [ ] **Step 8: Remove the scratch page and commit.** Delete `apps/web/app/(public)/probe/`. Stop both servers.

```bash
git add apps/web/lib/env.ts apps/web/next.config.ts apps/web/package.json pnpm-lock.yaml
git commit -F - <<'EOF'
[PD-86]: send /api through the web origin to the nest api

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: The typed API client

**Files:**
- Create: `apps/web/lib/api/core.ts`, `apps/web/lib/api/server.ts`, `apps/web/lib/api/browser.ts`
- Create: `apps/web/lib/api/endpoints/users.ts`, `apps/web/lib/api/endpoints/notifications.ts`, `apps/web/lib/api/endpoints/packs.ts`
- Scratch (deleted in Step 8): `apps/web/app/(public)/probe/page.tsx`, `$S/fake.mjs`

**Interfaces:**
- Consumes: `env` from Task 1.
- Produces:
  - `ApiError` with `kind: 'api' | 'auth' | 'network' | 'contract'`, `statusCode: number`, `code?: string`, `requestId?: string`;
  - `ApiRequest<S extends z.ZodType>` and the builders `get(path, response, query?)`, `post(path, response, body?)`, `patch(path, response, body?)`, `del(path, response)`;
  - `createClient(transport)` returning `{ call<S>(request: ApiRequest<S>): Promise<z.output<S>> }`;
  - `serverApi` and `serverHeaders(): Promise<Record<string, string>>` from `lib/api/server.ts`; `api` from `lib/api/browser.ts`;
  - endpoints `me()`, `unreadCount()`, `openPack(templateId, body)`.

The spec's `call(endpoint, args)` is realised as `call(endpoint(args))`: an endpoint is a function of its typed arguments that returns the request, which types path parameters, query and body with no generic machinery.

- [ ] **Step 1: The core.** Create `apps/web/lib/api/core.ts`:

```ts
import { ErrorEnvelopeSchema } from '@pokedrop/shared';
import { z } from 'zod';

export type ApiErrorKind = 'api' | 'auth' | 'network' | 'contract';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly statusCode: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(init: {
    kind: ApiErrorKind;
    statusCode: number;
    message: string;
    code?: string;
    requestId?: string;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.statusCode = init.statusCode;
    this.code = init.code;
    this.requestId = init.requestId;
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type Query = Record<string, unknown>;

export interface ApiRequest<S extends z.ZodType> {
  method: HttpMethod;
  path: string;
  response: S;
  query?: Query;
  body?: unknown;
}

export const get = <S extends z.ZodType>(path: string, response: S, query?: Query): ApiRequest<S> => ({
  method: 'GET',
  path,
  response,
  query,
});

export const post = <S extends z.ZodType>(path: string, response: S, body?: unknown): ApiRequest<S> => ({
  method: 'POST',
  path,
  response,
  body,
});

export const patch = <S extends z.ZodType>(path: string, response: S, body?: unknown): ApiRequest<S> => ({
  method: 'PATCH',
  path,
  response,
  body,
});

export const del = <S extends z.ZodType>(path: string, response: S): ApiRequest<S> => ({
  method: 'DELETE',
  path,
  response,
});

export interface Transport {
  baseUrl: string;
  headers: () => Record<string, string> | Promise<Record<string, string>>;
  init?: RequestInit;
}

const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const RETRY_DELAY_MS = 300;

const AuthErrorSchema = z.object({ message: z.string(), code: z.string() });

export function createClient(transport: Transport) {
  async function call<S extends z.ZodType>(request: ApiRequest<S>): Promise<z.output<S>> {
    const headers = new Headers(await transport.headers());
    const init: RequestInit = { ...transport.init, method: request.method, headers };
    if (request.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(request.body);
    }
    const url = `${transport.baseUrl}${request.path}${searchOf(request.query)}`;
    const response = await send(url, init, request.method === 'GET' ? 1 : 0);
    return parse(response, request.response);
  }

  return { call };
}

async function send(url: string, init: RequestInit, retries: number): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (retries > 0) return delay().then(() => send(url, init, retries - 1));
    throw new ApiError({
      kind: 'network',
      statusCode: 0,
      message: error instanceof Error ? error.message : 'Network request failed',
    });
  }
  if (retries > 0 && RETRYABLE_STATUSES.has(response.status)) {
    return delay().then(() => send(url, init, retries - 1));
  }
  return response;
}

async function parse<S extends z.ZodType>(response: Response, schema: S): Promise<z.output<S>> {
  const requestId = response.headers.get('x-request-id') ?? undefined;
  const text = await response.text();
  const body = text === '' ? undefined : jsonOrText(text);

  if (!response.ok) throw errorOf(response.status, body, requestId);

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError({
      kind: 'contract',
      statusCode: response.status,
      message: `Response did not match its contract: ${z.prettifyError(parsed.error)}`,
      requestId,
    });
  }
  return parsed.data;
}

function errorOf(status: number, body: unknown, requestId: string | undefined): ApiError {
  const envelope = ErrorEnvelopeSchema.safeParse(body);
  if (envelope.success) {
    return new ApiError({
      kind: 'api',
      statusCode: envelope.data.statusCode,
      message: envelope.data.message,
      code: envelope.data.code,
      requestId: envelope.data.requestId,
    });
  }
  const auth = AuthErrorSchema.safeParse(body);
  if (auth.success) {
    return new ApiError({
      kind: 'auth',
      statusCode: status,
      message: auth.data.message,
      code: auth.data.code,
      requestId,
    });
  }
  return new ApiError({ kind: 'api', statusCode: status, message: `Request failed with status ${status}`, requestId });
}

function searchOf(query: Query | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined || item === null) continue;
      params.append(key, item instanceof Date ? item.toISOString() : String(item));
    }
  }
  const search = params.toString();
  return search === '' ? '' : `?${search}`;
}

function jsonOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
}
```

- [ ] **Step 2: The two clients.** Create `apps/web/lib/api/server.ts`:

```ts
import 'server-only';
import { headers } from 'next/headers';
import { env } from '../env';
import { createClient } from './core';

// Task 1, Step 4 measured that Next's incoming x-forwarded-for ends with the
// connecting address; the API trusts one hop and reads that entry.
export async function serverHeaders(): Promise<Record<string, string>> {
  const incoming = await headers();
  const out: Record<string, string> = { Origin: env.WEB_ORIGIN };
  const cookie = incoming.get('cookie');
  if (cookie) out.cookie = cookie;
  const forwarded = incoming.get('x-forwarded-for');
  if (forwarded) out['x-forwarded-for'] = forwarded;
  return out;
}

export const serverApi = createClient({
  baseUrl: `${env.API_INTERNAL_URL}/api/v1`,
  headers: serverHeaders,
  init: { cache: 'no-store' },
});
```

Create `apps/web/lib/api/browser.ts`:

```ts
import { createClient } from './core';

export const api = createClient({ baseUrl: '/api/v1', headers: () => ({}) });
```

- [ ] **Step 3: The M11 endpoints.** Create `apps/web/lib/api/endpoints/users.ts`:

```ts
import { MyProfileSchema } from '@pokedrop/shared';
import { get } from '../core';

export const me = () => get('/users/me', MyProfileSchema);
```

Create `apps/web/lib/api/endpoints/notifications.ts`:

```ts
import { UnreadCountSchema } from '@pokedrop/shared';
import { get } from '../core';

export const unreadCount = () => get('/notifications/unread-count', UnreadCountSchema);
```

Create `apps/web/lib/api/endpoints/packs.ts`:

```ts
import {
  PackOpenResultSchema,
  type OpenPackRequestSchema,
  type PackTemplateId,
} from '@pokedrop/shared';
import type { z } from 'zod';
import { post } from '../core';

export const openPack = (templateId: PackTemplateId, body: z.input<typeof OpenPackRequestSchema>) =>
  post(`/packs/${templateId}/open`, PackOpenResultSchema, body);
```

- [ ] **Step 4: Typecheck, lint and format**

```bash
cd /m/projects/pokedrop && pnpm exec prettier --write apps/web && pnpm typecheck && pnpm lint && pnpm format:check
```

- [ ] **Step 5: A changed schema breaks the build (PD-86 AC 1).** Write a scratch reader `apps/web/app/(public)/probe/page.tsx`:

```tsx
import { serverApi } from '@/lib/api/server';
import { me } from '@/lib/api/endpoints/users';

export const dynamic = 'force-dynamic';

export default async function Probe() {
  const profile = await serverApi.call(me());
  return <pre id="probe">{JSON.stringify({ name: profile.displayName, currency: profile.currency })}</pre>;
}
```

In `packages/shared/src/entities/user.ts` rename `currency` in `UserSchema` to `coins`, run `pnpm typecheck`, record the error and its location (expected: `apps/web/app/(public)/probe/page.tsx`, `Property 'currency' does not exist`), then revert the rename with `git checkout packages/shared/src/entities/user.ts` and confirm `pnpm typecheck` passes.

- [ ] **Step 6: Server renders are authenticated, and server mutations pass CsrfGuard (PD-86 AC 2).** Start the API (`AUTH_BASE_URL=http://localhost:3000 TRUST_PROXY_HOPS=1`) and `next dev -H 0.0.0.0 -p 3000` as in Task 1, Step 5. Extend the scratch page to also send a no-op mutation:

```tsx
import { MyProfileSchema } from '@pokedrop/shared';
import { patch } from '@/lib/api/core';
import { serverApi } from '@/lib/api/server';
import { me } from '@/lib/api/endpoints/users';

export const dynamic = 'force-dynamic';

export default async function Probe() {
  const profile = await serverApi.call(me());
  const patched = await serverApi.call(patch('/users/me', MyProfileSchema, {}));
  return <pre id="probe">{JSON.stringify({ name: profile.displayName, patched: patched.id === profile.id })}</pre>;
}
```

```bash
source "$S/env86.sh"; cleanup; mkuser member; verify member; signin member
curl -s -b "$S/jar-member.txt" "$WEB/probe" | grep -o '<pre id="probe">[^<]*'
curl -s -o /dev/null -w "signed out %{http_code}\n" "$WEB/probe"
```

Expected: `{"name":"PD86 member","patched":true}` signed in; signed out, the render fails (`500`, the error page) and the `next dev` log shows an `ApiError` with status 401. The API log shows `GET /api/v1/users/me` and `PATCH /api/v1/users/me` with status 200 for the member's id.

- [ ] **Step 7: The visitor's address reaches the API from a server render (spec verification 4).** Replace the scratch page body with a raw call that reports the bucket the API used:

```tsx
import { env } from '@/lib/env';
import { serverHeaders } from '@/lib/api/server';

export const dynamic = 'force-dynamic';

export default async function Probe() {
  const res = await fetch(`${env.API_INTERNAL_URL}/api/v1/sets`, { headers: await serverHeaders(), cache: 'no-store' });
  return <pre id="probe">{res.headers.get('x-ratelimit-remaining')}</pre>;
}
```

```bash
source "$S/env86.sh"
for u in "$WEB" "$WEB" "$LAN" "$LAN"; do curl -s "$u/probe" | grep -o '<pre id="probe">[^<]*'; done
curl -s "$WEB/probe" -H 'X-Forwarded-For: 6.6.6.6' | grep -o '<pre id="probe">[^<]*'
```

Expected: the two `$WEB` renders count down one bucket, the two `$LAN` renders a separate one, and the spoofed render continues the `$WEB` bucket.

- [ ] **Step 8: Retry only for GET (PD-86 AC 3).** Create `$S/fake.mjs`, an API that always answers 503 and logs each request:

```js
import { createServer } from 'node:http';
createServer((req, res) => {
  console.log(new Date().toISOString(), req.method, req.url);
  res.writeHead(503, { 'content-type': 'application/json', 'x-request-id': 'fake' });
  res.end(JSON.stringify({ statusCode: 503, error: 'Service Unavailable', message: 'down', requestId: 'fake' }));
}).listen(4002);
```

Point the scratch page at both methods:

```tsx
import { MyProfileSchema } from '@pokedrop/shared';
import { ApiError, createClient, get, post } from '@/lib/api/core';

export const dynamic = 'force-dynamic';

const fake = createClient({ baseUrl: 'http://localhost:4002/api/v1', headers: () => ({}), init: { cache: 'no-store' } });

async function outcome(run: () => Promise<unknown>) {
  try {
    await run();
    return 'ok';
  } catch (error) {
    return error instanceof ApiError ? `${error.kind} ${error.statusCode} ${error.requestId}` : String(error);
  }
}

export default async function Probe() {
  const g = await outcome(() => fake.call(get('/users/me', MyProfileSchema)));
  const p = await outcome(() => fake.call(post('/users/me', MyProfileSchema, {})));
  return <pre id="probe">{JSON.stringify({ get: g, post: p })}</pre>;
}
```

```bash
node "$S/fake.mjs"   # background, then:
curl -s "$WEB/probe" | grep -o '<pre id="probe">[^<]*'
```

Expected page: `{"get":"api 503 fake","post":"api 503 fake"}`. Expected fake log: `GET /api/v1/users/me` **twice**, about 300 ms apart, and `POST /api/v1/users/me` **once**. Stop the fake. Append Steps 5–8 to `$S/probe0.md`.

- [ ] **Step 9: Remove the scratch page and commit.** Delete `apps/web/app/(public)/probe/`, run `pnpm typecheck && pnpm lint && pnpm format:check`, then:

```bash
git add apps/web/lib/api
git commit -F - <<'EOF'
[PD-86]: add a typed api client for server renders and the browser

Every response is parsed with its shared schema; only GET retries,
once. Server calls forward the cookie, Origin and visitor address.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Session, proxy and layouts

**Files:**
- Create: `apps/web/lib/routes.ts`, `apps/web/lib/session/cookie.ts`, `apps/web/lib/session/identity.ts`, `apps/web/lib/session/server.ts`, `apps/web/lib/session/context.tsx`, `apps/web/lib/session/keep-alive.tsx`
- Create: `apps/web/proxy.ts`, `apps/web/app/(app)/admin/layout.tsx`
- Modify: `apps/web/app/(app)/layout.tsx`, `apps/web/app/(public)/layout.tsx`

**Interfaces:**
- Consumes: `serverApi`, `ApiError` and `me()` from Task 2.
- Produces:
  - `isProtected(pathname: string): boolean`, `safeNext(value: string | null | undefined): string`, `signInUrl(next: string, error?: string): string`, `redirectToSignIn(): void`, `HOME = '/dashboard'`, `SIGN_IN = '/sign-in'` from `lib/routes.ts` — PD-87 wires `redirectToSignIn` into its caches, PD-102 reads `next` through `safeNext`;
  - `getSession(): Promise<SessionResult>` where `SessionResult = { profile: MyProfile } | { profile: null; reason: 'signed-out' | 'suspended' }` — PD-87 seeds the `me` query from `profile`;
  - `SessionIdentity = Pick<MyProfile, 'id' | 'role' | 'displayName' | 'avatarUrl'>`, `identityOf(profile)`, `SessionProvider`, `useSession(): SessionIdentity | null` — PD-90 reads the role and name from here.

- [ ] **Step 1: Routes.** Create `apps/web/lib/routes.ts`:

```ts
export const HOME = '/dashboard';
export const SIGN_IN = '/sign-in';

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/packs',
  '/inventory',
  '/sets',
  '/trades',
  '/settings',
  '/wallet',
  '/notifications',
  '/admin',
];

// /cards/:id and /decks/:id are public; only the lists need a session.
const PROTECTED_EXACT = ['/cards', '/decks'];

export function isProtected(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return (
    PROTECTED_EXACT.includes(path) ||
    PROTECTED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  );
}

const BASE = 'http://next.invalid';

// Resolved by the URL parser, the way a browser would: a backslash, tab or
// second slash that turns the value into another origin is refused.
export function safeNext(value: string | null | undefined): string {
  if (!value?.startsWith('/')) return HOME;
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE || url.pathname === SIGN_IN) return HOME;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return HOME;
  }
}

export function signInUrl(next: string, error?: string): string {
  const params = new URLSearchParams({ next: safeNext(next) });
  if (error) params.set('error', error);
  return `${SIGN_IN}?${params.toString()}`;
}

export function redirectToSignIn(): void {
  window.location.assign(signInUrl(`${window.location.pathname}${window.location.search}`));
}
```

- [ ] **Step 2: Cookie and identity.** Create `apps/web/lib/session/cookie.ts`:

```ts
const SESSION_COOKIES = ['better-auth.session_token', '__Secure-better-auth.session_token'];

export function hasSessionCookie(cookies: { has(name: string): boolean }): boolean {
  return SESSION_COOKIES.some((name) => cookies.has(name));
}
```

Create `apps/web/lib/session/identity.ts`:

```ts
import type { MyProfile } from '@pokedrop/shared';

export type SessionIdentity = Pick<MyProfile, 'id' | 'role' | 'displayName' | 'avatarUrl'>;

export function identityOf(profile: MyProfile): SessionIdentity {
  return {
    id: profile.id,
    role: profile.role,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
  };
}
```

- [ ] **Step 3: The server session.** Create `apps/web/lib/session/server.ts`:

```ts
import 'server-only';
import { ERROR_CODES, type MyProfile } from '@pokedrop/shared';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { ApiError } from '../api/core';
import { me } from '../api/endpoints/users';
import { serverApi } from '../api/server';
import { hasSessionCookie } from './cookie';

export type SessionResult =
  | { profile: MyProfile }
  | { profile: null; reason: 'signed-out' | 'suspended' };

export const getSession = cache(async (): Promise<SessionResult> => {
  if (!hasSessionCookie(await cookies())) return { profile: null, reason: 'signed-out' };
  try {
    return { profile: await serverApi.call(me()) };
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 401) {
      return { profile: null, reason: 'signed-out' };
    }
    if (error instanceof ApiError && error.code === ERROR_CODES.ACCOUNT_SUSPENDED) {
      return { profile: null, reason: 'suspended' };
    }
    throw error;
  }
});
```

- [ ] **Step 4: The client side.** Create `apps/web/lib/session/context.tsx`:

```tsx
'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { SessionIdentity } from './identity';

const SessionContext = createContext<SessionIdentity | null>(null);

export function SessionProvider({
  identity,
  children,
}: {
  identity: SessionIdentity | null;
  children: ReactNode;
}) {
  return <SessionContext value={identity}>{children}</SessionContext>;
}

export function useSession(): SessionIdentity | null {
  return useContext(SessionContext);
}
```

Only if Task 1, Step 5 confirmed hypothesis 6, create `apps/web/lib/session/keep-alive.tsx`:

```tsx
'use client';

import { useEffect } from 'react';

const KEY = 'pokedrop.session-refreshed-at';
const DAY_MS = 24 * 60 * 60 * 1000;

// /api/v1 renews a session in the database but drops the refreshed cookie;
// Better Auth's own route returns it, so the cookie rolls forward with the row.
export function SessionKeepAlive() {
  useEffect(() => {
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(KEY)) || 0;
    } catch {
      // Storage unavailable: refresh on every mount instead.
    }
    if (Date.now() - last < DAY_MS) return;
    fetch('/api/auth/get-session', { cache: 'no-store' }).then(
      () => {
        try {
          sessionStorage.setItem(KEY, String(Date.now()));
        } catch {
          // Storage unavailable: nothing to remember.
        }
      },
      () => undefined,
    );
  }, []);
  return null;
}
```

- [ ] **Step 5: The proxy.** Create `apps/web/proxy.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { isProtected, signInUrl } from '@/lib/routes';
import { hasSessionCookie } from '@/lib/session/cookie';

// Navigation comfort, not access control. This only checks that a session
// cookie exists; the layouts ask the API, and the API refuses anything the
// session does not allow.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isProtected(pathname) && !hasSessionCookie(request.cookies)) {
    return NextResponse.redirect(new URL(signInUrl(`${pathname}${search}`), request.url));
  }

  const headers = new Headers(request.headers);
  headers.set('x-pathname', `${pathname}${search}`);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!api/|_next/static|_next/image|favicon\\.ico|.*\\.[a-z0-9]+$).*)'],
};
```

- [ ] **Step 6: The layouts.** Replace `apps/web/app/(app)/layout.tsx`:

```tsx
import { ERROR_CODES } from '@pokedrop/shared';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { HOME, signInUrl } from '@/lib/routes';
import { SessionProvider } from '@/lib/session/context';
import { identityOf } from '@/lib/session/identity';
import { SessionKeepAlive } from '@/lib/session/keep-alive';
import { getSession } from '@/lib/session/server';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const session = await getSession();
  if (!session.profile) {
    const next = (await headers()).get('x-pathname') ?? HOME;
    redirect(
      signInUrl(next, session.reason === 'suspended' ? ERROR_CODES.ACCOUNT_SUSPENDED : undefined),
    );
  }

  return (
    <SessionProvider identity={identityOf(session.profile)}>
      <SessionKeepAlive />
      <main className="flex-1 p-8">{children}</main>
    </SessionProvider>
  );
}
```

If `keep-alive.tsx` was not created, drop its import and element.

Create `apps/web/app/(app)/admin/layout.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { HOME } from '@/lib/routes';
import { getSession } from '@/lib/session/server';

export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  const session = await getSession();
  if (session.profile?.role !== 'ADMIN') redirect(HOME);
  return children;
}
```

Replace `apps/web/app/(public)/layout.tsx` so its chrome follows the session (PD-90 replaces the signed-in branch with the app shell):

```tsx
import Link from 'next/link';
import { HOME } from '@/lib/routes';
import { SessionProvider } from '@/lib/session/context';
import { identityOf } from '@/lib/session/identity';
import { getSession } from '@/lib/session/server';

export default async function PublicLayout({ children }: LayoutProps<'/'>) {
  const session = await getSession();
  const identity = session.profile ? identityOf(session.profile) : null;

  return (
    <SessionProvider identity={identity}>
      <header className="flex items-center justify-between gap-4 p-4">
        <Link href="/">PokéDrop</Link>
        <nav aria-label="Account" className="flex gap-4">
          {identity ? (
            <Link href={HOME}>{identity.displayName}</Link>
          ) : (
            <>
              <Link href="/sign-in">Sign in</Link>
              <Link href="/register">Create account</Link>
            </>
          )}
        </nav>
      </header>
      <main className="flex-1 p-8">{children}</main>
    </SessionProvider>
  );
}
```

- [ ] **Step 7: Verify (PD-89 AC 1–3 and the Review Focus).** `pnpm exec prettier --write apps/web && pnpm typecheck && pnpm lint`. Start the API (`AUTH_BASE_URL=http://localhost:3000 TRUST_PROXY_HOPS=1`) and, this time, a production build of the web app: `cd apps/web && pnpm exec next build && pnpm exec next start -H 0.0.0.0 -p 3000`.

```bash
source "$S/env86.sh"; cleanup
mkuser member; verify member; signin member
mkuser boss; verify boss; admin boss; signin boss
st(){ curl -s -o /dev/null -w "%-8s %-34s %{http_code} %{redirect_url}\n" ${2:+-b "$S/jar-$2.txt"} "$WEB$1" | sed "s|^|${2:-anon} |"; }
# public stays public, lists and app pages need a cookie
st /cards/x; st /decks/x; st /profile/x; st /; st /sign-in
st /cards; st /decks; st '/trades/abc?tab=sent'; st /admin/users
# signed in
st /dashboard member; st /cards member; st /admin member; st /admin/users member; st /admin boss
# the API would refuse anyway
curl -s -o /dev/null -w "member admin api %{http_code}\n" -b "$S/jar-member.txt" "$WEB/api/v1/admin/users"
# a revoked session with a surviving cookie: one redirect, no loop
$PSQL -c "delete from sessions where \"userId\" = '$(uid member)'" >/dev/null
st /dashboard member; st /sign-in member
curl -s -L -o /dev/null -w "followed: %{num_redirects} redirects, ends %{url_effective} %{http_code}\n" -b "$S/jar-member.txt" "$WEB/dashboard"
# suspended
signin boss >/dev/null; $PSQL -c "update users set \"suspendedAt\" = now() where email = '$P-boss@example.com'" >/dev/null
st /dashboard boss
```

Expected: anonymous `/cards/x`, `/decks/x`, `/profile/x`, `/`, `/sign-in` are `200`; anonymous `/cards`, `/decks`, `/trades/abc?tab=sent`, `/admin/users` are `307` to `/sign-in?next=…` with the original path and query; member `/dashboard` and `/cards` `200`, member `/admin` and `/admin/users` `307` to `/dashboard`, boss `/admin` `200`; the member's admin API call `403`; after the revoke, `/dashboard` `307` to `/sign-in?next=%2Fdashboard`, `/sign-in` `200`, and following redirects ends on `/sign-in` after one redirect; the suspended boss `307` to `/sign-in?next=%2Fdashboard&error=ACCOUNT_SUSPENDED`.

The return URL (open redirect, Review Focus). `routes.ts` has no imports and touches `window` only inside `redirectToSignIn`, so node runs a copy of it directly:

```bash
cp apps/web/lib/routes.ts "$S/routes.ts"
cat > "$S/safe-next.mts" <<'EOF'
import { safeNext } from './routes.ts';
for (const v of ['/trades/abc?tab=sent', '//evil.com', '/\\evil.com', '/\t/evil.com', 'https://evil.com', '/sign-in', '/sign-in?next=/x', '', null, 'dashboard'])
  console.log(JSON.stringify(v).padEnd(26), '→', safeNext(v));
EOF
node --experimental-strip-types "$S/safe-next.mts"
```

Expected: `/trades/abc?tab=sent` unchanged; every other value → `/dashboard`.

Record every output in `$S/probe0.md`. Run `cleanup`, stop both servers.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/routes.ts apps/web/lib/session apps/web/proxy.ts "apps/web/app/(app)" "apps/web/app/(public)/layout.tsx"
git commit -F - <<'EOF'
[PD-89]: gate the app on a session read once per request

The proxy redirects on a missing cookie; layouts ask /users/me and
admin checks the role. Return urls pass through safeNext.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Documentation, configuration and Linear

**Files:**
- Modify: `.env.example`, `docs/API.md`, `docs/Frontend.md`, `docs/Architecture.md` (§5 tree: drop the optional `api/` BFF line)
- Modify: `docs/superpowers/specs/2026-09-30-pd-86-pd-89-api-client-and-session-design.md` (Verification: probe users, not seeded users — the seed creates no credentials)

- [ ] **Step 1: `.env.example`.** Change `AUTH_BASE_URL` to `http://localhost:3000` with the comment: *The web app's public origin. Better Auth builds verification and reset links from it, and they reach the API through the web app's `/api` rewrite.* Beside `TRUST_PROXY_HOPS`, add that the web app's rewrite and its server renders are one hop, with the value Task 1 measured. Add a `Web` section documenting `API_INTERNAL_URL` and `WEB_ORIGIN` as read by `apps/web` from its process environment (Next does not load the root `.env`), their defaults, and that rewrites are fixed at `next build`.

- [ ] **Step 2: `docs/API.md`.** Under *Conventions*, a paragraph *How the web app reaches the API*: the `/api` rewrite, direct server calls with cookie, `Origin` and `X-Forwarded-For`, `AUTH_BASE_URL` as the web origin, `TRUST_PROXY_HOPS` for the rewrite, with Task 1's measured table. Under *Auth*, the cookie-refresh finding from Task 1, Step 5 (confirmed or refuted) and what the web app does about it.

- [ ] **Step 3: `docs/Frontend.md`.** Two sections in the style of PD-84/PD-85:
  - *API client (PD-86)*: the layout of `lib/api`, `ApiError` kinds, retry, how to add an endpoint, why a schema change breaks the build — with Task 2's measured results (the typecheck error, the authenticated render, the 2 × GET / 1 × POST log, the rate-limit buckets).
  - *Session and route protection (PD-89)*: the protected paths, the proxy's limits, `getSession`, layouts and parallel rendering, `safeNext`, keep-alive — with Task 3's table and the `safeNext` table.
  - Traps: rewrites are fixed at build; `lib/env.ts` must stay importable by `next.config.ts`; the browser client cannot run during a server render (relative URL); a new protected section must be added to `lib/routes.ts`.

- [ ] **Step 4: The spec and Architecture.** In the spec's Verification, replace "the project's seeded test users" with "throwaway `pd86-*` users created through sign-up, since the seed creates no credentials". In `docs/Architecture.md` §5 and `docs/PRD.md` §9, remove the `api/  # optional route handlers / BFF proxy` line: `/api` belongs to the API.

- [ ] **Step 5: Format check and commit**

```bash
cd /m/projects/pokedrop && pnpm format:check
git add .env.example docs
git commit -F - <<'EOF'
[PD-89]: document the client, the session and what they measured

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 6: Linear.** Mark PD-86 and PD-89 Done. Comment on PD-87: `redirectToSignIn` from `lib/routes.ts` goes into the query and mutation caches' `onError` for `ApiError` 401; seed the `me` query from `getSession().profile`; set `retry: false` because the client already retries GETs. Comment on PD-102: read `next` only through `safeNext`, and show a message for `error=ACCOUNT_SUSPENDED`. Comment on PD-90: identity comes from `useSession()`, and `(public)/layout.tsx` already branches on the session.
