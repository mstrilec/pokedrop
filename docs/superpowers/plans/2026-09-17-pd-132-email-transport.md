# PD-132 Email Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the API the ability to put a string in front of a person, so that PD-31's verification flow and PD-32's password reset become buildable.

**Architecture:** A `mail` module with one method, `send`, over a nodemailer transporter built from a single SMTP URL — so the vendor is an environment change rather than a code change. Templates are pure functions with no I/O, kept in their own file. Better Auth's two optional callbacks call the service; delivery failure is caught and logged rather than failing the request, because the user row is already written by the time the mail is sent. Mailpit in Compose gives local development a real inbox with an HTTP API, which is what makes the link in a mail followable by a measurement.

**Tech Stack:** NestJS 12 (ESM, `module: nodenext` — every relative import ends in `.js`), nodemailer 10 (ESM-native, own types, Node ≥ 20), Better Auth 1.7.5, Mailpit v1.31, Zod 4.

**Spec:** [`docs/superpowers/specs/2026-09-17-email-transport-design.md`](../specs/2026-09-17-email-transport-design.md)

---

## Global Constraints

- **Work directly on `dev`.** No feature branches, no pull requests.
- **Commit subjects are `[PD-132]: short lowercase description`.** Bodies end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. A `feat:` or `docs:` prefix is rejected by the commit hook.
- **No automated tests in v1.** Do not add test files, runners, dependencies, or a CI test step. **This overrides the TDD structure the writing-plans skill normally imposes.** Every task runs a red/green cycle where the "test" is a measurement against the running stack.
- **ESM imports.** Relative imports inside `apps/api` carry the `.js` extension or the build fails.
- **`requireEmailVerification` stays `false`.** Turning it on makes verification mandatory while the token lives an hour and no resend endpoint exists. PD-31 turns it on with resend, its cooldown and the grant. If a step seems to need it on, stop — the spec is wrong.
- **`sendOnSignUp: true` is required, not optional.** Its default is `undefined`, which means "follow `requireEmailVerification`" — and that is `false`, so without the explicit `true` **no mail is ever sent** and every measurement below fails for a reason that looks like a broken transport.
- **No `WEB_BASE_URL`.** Nothing in this piece reads the web application's address. It goes to PD-31 as a forward note.
- **Two templates only.** Verification and password reset. The "you already have an account" template belongs to PD-31's open decision.
- **No schema change.** No Prisma migration.
- **`pnpm typecheck` and `pnpm lint` run from the repository root** and must pass before every commit.
- **Verified claims only.** If a measurement contradicts the spec, report the contradiction rather than adjusting the claim to fit.

### Shared shell setup

```bash
cd /m/projects/pokedrop
SCRATCH="/c/Users/MaxSt/AppData/Local/Temp/claude/M--projects-pokedrop/c71988cc-2aa7-4705-933c-b8b1e0bc6ce1/scratchpad"
PSQL="docker compose exec -T postgres psql -U pokedrop -d pokedrop -tA"
API="http://localhost:4000"
WEB="http://localhost:3000"
MAILPIT="http://localhost:8025"
```

`stopapi` and `startapi` already exist in `$SCRATCH/env.sh` from PD-35 — `pkill` does not exist in this Git Bash, so `stopapi` kills whatever holds port 4000 through `netstat` and `taskkill`, and `startapi VAR=value …` boots with overrides and waits for the health route. Source that file rather than rewriting them:

```bash
source "$SCRATCH/env.sh"
```

A node script that imports project packages must live **inside `apps/api`** — Node resolves bare imports relative to the file, not the working directory, and pnpm keeps packages under `apps/api/node_modules`. `apps/api/dist/` is gitignored and is the right home for a throwaway probe. This cost two failed commands in PD-36; do not rediscover it.

---

## File Structure

| Path | Responsibility | Task |
| --- | --- | --- |
| `docker-compose.yml` | the `mailpit` service | 1 |
| `apps/api/src/config/env.schema.ts` | `MAIL_SMTP_URL`, `MAIL_FROM` | 1 |
| `apps/api/src/config/app.config.ts` | the `mail` namespace | 1 |
| `.env.example` | both variables and the Mailpit ports | 1 |
| `apps/api/package.json` | the `nodemailer` dependency | 1 |
| `apps/api/src/mail/mail.service.ts` | the transporter, its lifecycle, one `send` | 2 |
| `apps/api/src/mail/mail.templates.ts` | pure data → `{ subject, html, text }`; no I/O | 2 |
| `apps/api/src/mail/mail.module.ts` | `@Global`, provides `MailService` | 2 |
| `apps/api/src/mail/index.ts` | the module's public surface | 2 |
| `apps/api/src/app.module.ts` | import `MailModule` | 2 |
| `apps/api/src/auth/auth.factory.ts` | the two callbacks and the delivery policy | 3 |
| `apps/api/src/auth/auth.module.ts` | inject `MailService` | 3 |
| `apps/api/src/auth/README.md` | what is sent, when, and what happens when it fails | 4 |
| `README.md` | where to read local mail | 4 |

---

## Task 1: Mailpit, configuration, and the import risk

**Files:**
- Modify: `docker-compose.yml` (a third service, before the `volumes:` block)
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/config/env.schema.ts` (after the throttle block, before the closing `})`)
- Modify: `apps/api/src/config/app.config.ts` (a namespace after `throttle`)
- Modify: `.env.example`
- Modify: `README.md` (the `--wait` sentence, which says "both healthchecks")

**Interfaces:**
- Consumes: nothing.
- Produces: `config.mail.smtpUrl: string` and `config.mail.from: string`, read by Task 2.

---

- [ ] **Step 1: Install nodemailer**

```bash
pnpm --filter @pokedrop/api add nodemailer@10.0.10
grep -n "nodemailer" apps/api/package.json
```

Expected: listed as a dependency, with no new peer warning. It ships its own types, so no `@types/nodemailer` is needed — adding one would shadow the real types with a stale copy.

- [ ] **Step 2: Prove the import works under ESM, before anything is built on it**

nodemailer 10 declares a dual `exports` map with a real `import` condition, so this should pass — but PD-19 and PD-36 both lost time to this class of problem, and confirming costs one command.

```bash
cat > apps/api/src/mail-import-probe.ts <<'EOF'
// TEMPORARY - PD-132 ESM probe. Removed in step 4.
import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';

export const probe = (): string => typeof createTransport;
export type Probe = Transporter;
EOF
pnpm typecheck 2>&1 | tail -5
```

Expected: `Done` for both apps. If named imports do not resolve, the fallback is a default import (`import nodemailer from 'nodemailer'; const { createTransport } = nodemailer;`) applied everywhere the package is used. Report which of the two happened.

- [ ] **Step 3: Prove it at runtime too**

Type resolution and runtime resolution are separate mechanisms; one can pass while the other fails.

```bash
cd apps/api && node --input-type=module -e "
  const m = await import('nodemailer');
  console.log('createTransport:', typeof m.createTransport);
  console.log('default:', typeof m.default);
"; cd ../..
```

Expected: `createTransport: function`. `default` may be `function` or `object`; only the named export matters here.

- [ ] **Step 4: Remove the probe**

```bash
rm apps/api/src/mail-import-probe.ts
git status --porcelain
```

Expected: the probe is gone; only `package.json` and the lockfile are modified.

- [ ] **Step 5: Add Mailpit to Compose**

In `docker-compose.yml`, after the `redis` service and before the `volumes:` block:

```yaml
  # A local mail sink. Nothing it receives ever leaves this machine.
  #
  # Chosen over a vendor's sandbox for its HTTP API on 8025: a measurement can
  # pull the verification link out of a received message and follow it, which is
  # the difference between "a mail was probably sent" and "the link in the mail
  # verifies the account".
  mailpit:
    image: axllent/mailpit:v1.31
    container_name: pokedrop-mailpit
    restart: unless-stopped
    ports:
      - '${MAILPIT_SMTP_PORT:-1025}:1025'
      - '${MAILPIT_UI_PORT:-8025}:8025'
    healthcheck:
      # Mailpit ships its own readiness probe; the image has no curl or wget.
      test: ['CMD', '/mailpit', 'readyz']
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 5s
```

- [ ] **Step 6: Confirm the container is healthy and its API answers**

The healthcheck command above is the documented form. Confirm it rather than assume it — an image without that subcommand would report `unhealthy` forever and `docker compose up --wait` would hang.

```bash
docker compose up -d --wait 2>&1 | tail -5
docker compose ps --format '{{.Service}} {{.State}} {{.Status}}'
```

Expected: three services `running`, and `mailpit` reporting `(healthy)`. If it reports `unhealthy`, read `docker compose logs mailpit`, find the correct probe with `docker compose exec mailpit /mailpit --help`, and record what it turned out to be.

Then learn the API's real shape, which later measurements depend on:

```bash
curl -s "$MAILPIT/api/v1/messages" | head -c 400; echo
```

Expected: JSON with a `messages` array (empty). **Write down the field names.** The per-message path and the names of the text and HTML body fields are version-specific; Task 2 Step 6 and Task 3 need them, and a measurement built on a guessed path fails in a way that looks like "the mail never arrived".

- [ ] **Step 7: Add the environment variables**

In `apps/api/src/config/env.schema.ts`, after the `THROTTLE_MODERATE_WINDOW` entry and before the closing `})`:

```ts
    // One URL rather than five variables: nodemailer parses host, port,
    // credentials and TLS mode out of it, so changing vendor — Resend, SES,
    // Postmark, Mailgun — is an environment change and not a code change.
    // `smtp://` is plain or STARTTLS; `smtps://` is implicit TLS on 465.
    //
    // The default points at the Mailpit container, so a fresh clone sends mail
    // successfully with no mail configuration at all.
    MAIL_SMTP_URL: z.string().min(1).default('smtp://localhost:1025'),

    // RFC 5322 display form is accepted: `PokeDrop <no-reply@example.com>`.
    MAIL_FROM: z.string().min(1).default('PokeDrop <no-reply@pokedrop.local>'),
```

- [ ] **Step 8: Expose them typed**

In `apps/api/src/config/app.config.ts`, add a namespace after `throttle`:

```ts
    mail: {
      smtpUrl: env.MAIL_SMTP_URL,
      from: env.MAIL_FROM,
    },
```

- [ ] **Step 9: Document them**

Append to `.env.example`:

```bash

# ─── Mail ────────────────────────────────────────────────────────────────────
# Host ports for the local mail sink. Nothing it receives leaves this machine;
# read what was sent at http://localhost:8025.
MAILPIT_SMTP_PORT=1025
MAILPIT_UI_PORT=8025

# The relay. One URL carries host, port, credentials and TLS mode, so switching
# vendor is a change here rather than in the source. `smtp://` is plain or
# STARTTLS, `smtps://` is implicit TLS on 465. In production this becomes
# something like smtps://user:key@smtp.provider.com:465
MAIL_SMTP_URL=smtp://localhost:1025

# Sender. Deliverability from a real relay also needs SPF, DKIM and DMARC on
# the sending domain — none of which is code, and without which mail lands in
# spam.
MAIL_FROM=PokeDrop <no-reply@pokedrop.local>
```

- [ ] **Step 10: Fix the README's arithmetic**

`README.md` currently says `--wait` "blocks until **both** healthchecks pass". There are three services now. In the `Bring the stack up` section, replace that sentence with:

```markdown
`--wait` blocks until every healthcheck passes, so the next command can assume
the database is actually accepting connections rather than merely started.
Mailpit's web interface is then at <http://localhost:8025> — every mail the API
sends in development lands there and goes nowhere else.
```

- [ ] **Step 11: Confirm the API still boots with the new configuration**

```bash
source "$SCRATCH/env.sh"
pnpm typecheck && pnpm --filter @pokedrop/api build 2>&1 | tail -2
startapi && curl -s -o /dev/null -w 'health: %{http_code}\n' "$API/api/v1/health/live"
```

Expected: `200`. Nothing reads the mail configuration yet; this only proves the schema change did not break the boot.

- [ ] **Step 12: Lint and commit**

```bash
pnpm lint
git add docker-compose.yml apps/api/package.json pnpm-lock.yaml \
        apps/api/src/config/env.schema.ts apps/api/src/config/app.config.ts \
        .env.example README.md
git commit -F - <<'EOF'
[PD-132]: add mailpit and the mail configuration

One SMTP URL rather than five variables, so switching vendor is an
environment change rather than a code change, and it defaults to the
Mailpit container so a fresh clone sends mail with no configuration.

Mailpit is chosen over a vendor sandbox for its HTTP API: a measurement
can pull the link out of a received message and follow it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 2: The mail module

**Files:**
- Create: `apps/api/src/mail/mail.templates.ts`
- Create: `apps/api/src/mail/mail.service.ts`
- Create: `apps/api/src/mail/mail.module.ts`
- Create: `apps/api/src/mail/index.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `config.mail.smtpUrl`, `config.mail.from` (Task 1); `APP_CONFIG` from `../config/index.js`.
- Produces, all exported from `./mail/index.js` and used by Task 3:
  - `interface MailMessage { to: string; subject: string; html: string; text: string }`
  - `interface RenderedMail { subject: string; html: string; text: string }`
  - `verificationEmail(input: { displayName: string; url: string }): RenderedMail`
  - `passwordResetEmail(input: { displayName: string; url: string }): RenderedMail`
  - `class MailService { send(message: MailMessage): Promise<void> }`
  - `class MailModule`

---

- [ ] **Step 1: Write the templates**

Create `apps/api/src/mail/mail.templates.ts`:

```ts
/**
 * Pure functions from data to a message. No I/O, no configuration, no
 * dependency on how delivery happens — so what a mail says can be changed and
 * read without touching the transport, and the transport without touching the
 * words.
 *
 * Deliberately no template library. mjml, handlebars and react-email all earn
 * their place at some number of templates; that number is not two.
 */

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

const BRAND = 'PokeDrop';

/**
 * Styles are inline rather than in a <style> block: a good share of mail
 * clients strip the head, and a stripped stylesheet leaves an unreadable page
 * rather than a plain one.
 */
function layout(heading: string, paragraph: string, cta: string, url: string): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1a1a1a;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <p style="margin:0 0 24px;font-size:18px;font-weight:600;">${BRAND}</p>
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;">${heading}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#444;">${paragraph}</p>
      <p style="margin:0 0 24px;">
        <a href="${url}" style="display:inline-block;padding:12px 20px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;">${cta}</a>
      </p>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#777;">
        If the button does not work, paste this into your browser:<br />
        <span style="word-break:break-all;">${url}</span>
      </p>
    </div>
  </body>
</html>`;
}

/**
 * Every template carries a text part as well as HTML. It is not decoration:
 * its absence is one of the signals spam filters weigh, and it is what a
 * plain-text client shows.
 */
function plain(heading: string, paragraph: string, url: string): string {
  return `${BRAND}

${heading}

${paragraph}

${url}
`;
}

export function verificationEmail(input: { displayName: string; url: string }): RenderedMail {
  const heading = `Confirm your email, ${input.displayName}`;
  const paragraph =
    'Confirming the address finishes setting up your account. The link is good for one hour.';

  return {
    subject: `Confirm your ${BRAND} email`,
    html: layout(heading, paragraph, 'Confirm email', input.url),
    text: plain(heading, paragraph, input.url),
  };
}

export function passwordResetEmail(input: { displayName: string; url: string }): RenderedMail {
  const heading = `Reset your password, ${input.displayName}`;
  const paragraph =
    'Use the link below to choose a new password. It works once and expires in an hour. ' +
    'If you did not ask for this, nothing has changed and you can ignore this message.';

  return {
    subject: `Reset your ${BRAND} password`,
    html: layout(heading, paragraph, 'Reset password', input.url),
    text: plain(heading, paragraph, input.url),
  };
}
```

- [ ] **Step 2: Write the service**

Create `apps/api/src/mail/mail.service.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config/index.js';

/** Enough for a healthy relay, short enough that a sick one cannot hold a request. */
const CONNECTION_TIMEOUT_MS = 5_000;
const GREETING_TIMEOUT_MS = 5_000;
const SOCKET_TIMEOUT_MS = 10_000;

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Owns the single nodemailer transporter.
 *
 * `send` throws on failure. Whether a failure should fail the request is the
 * caller's decision, not this service's — see the delivery policy in
 * auth.factory.ts, where the answer is no because the user row is written
 * before the mail is sent.
 *
 * Deliberately no `transporter.verify()` at startup, which is where this
 * differs from RedisService. Redis is on the path of every request — the cache,
 * and the rate limiter since PD-36 — so a bad URL there should stop the boot.
 * Mail is on the path of two flows that already treat delivery failure as
 * non-fatal; refusing to boot for a briefly unreachable relay would contradict
 * that policy and turn a degraded feature into a total outage.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);

  private readonly transporter: Transporter;

  private readonly from: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.from = config.mail.from;
    this.transporter = createTransport(config.mail.smtpUrl, {
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      greetingTimeout: GREETING_TIMEOUT_MS,
      socketTimeout: SOCKET_TIMEOUT_MS,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...message });

    // The recipient's address is deliberately absent. An application log is not
    // a place to accumulate user email addresses, and the relay's own log has
    // the delivery record if one is ever needed.
    this.logger.log(`Sent: ${message.subject}`);
  }

  onModuleDestroy(): void {
    // Releases pooled connections on SIGTERM, alongside the Prisma and Redis
    // shutdowns.
    this.transporter.close();
  }
}
```

- [ ] **Step 3: Write the module and the barrel**

Create `apps/api/src/mail/mail.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service.js';

/**
 * Global for the same reason RedisModule is: the auth module needs it, PD-31
 * and PD-32 will, and making each declare the import would be noise.
 */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
```

Create `apps/api/src/mail/index.ts`:

```ts
export { MailModule } from './mail.module.js';
export { MailService } from './mail.service.js';
export type { MailMessage } from './mail.service.js';
export { passwordResetEmail, verificationEmail } from './mail.templates.js';
export type { RenderedMail } from './mail.templates.js';
```

- [ ] **Step 4: Register the module**

In `apps/api/src/app.module.ts`, add the import:

```ts
import { MailModule } from './mail/index.js';
```

and add `MailModule` to the `imports` array, after `ThrottleModule`.

- [ ] **Step 5: Build**

```bash
pnpm typecheck && pnpm --filter @pokedrop/api build 2>&1 | tail -2
```

Expected: `Done` for both apps, then the build.

- [ ] **Step 6: Drive the service directly and read the result out of Mailpit**

Nothing calls it yet, so exercise it as a library. This is the red/green cycle for this task.

```bash
source "$SCRATCH/env.sh"
curl -s -X DELETE "$MAILPIT/api/v1/messages" > /dev/null

cat > apps/api/dist/mail-probe.mjs <<'EOF'
import { MailService } from './mail/mail.service.js';
import { verificationEmail, passwordResetEmail } from './mail/mail.templates.js';

// MailService reads only config.mail, so a stub standing in for APP_CONFIG is
// enough to drive it without booting Nest.
const config = { mail: { smtpUrl: 'smtp://localhost:1025', from: 'PokeDrop <no-reply@pokedrop.local>' } };
const mail = new MailService(config);

await mail.send({
  to: 'probe@example.com',
  ...verificationEmail({ displayName: 'Probe', url: 'https://example.com/verify?token=abc' }),
});
await mail.send({
  to: 'probe@example.com',
  ...passwordResetEmail({ displayName: 'Probe', url: 'https://example.com/reset?token=xyz' }),
});

mail.onModuleDestroy();
console.log('sent 2');
EOF
cd apps/api && node dist/mail-probe.mjs; cd ../..

echo "--- what Mailpit received ---"
curl -s "$MAILPIT/api/v1/messages" | python -c "
import json,sys
d = json.load(sys.stdin)
for m in d.get('messages', []):
    to = ', '.join(a.get('Address','') for a in m.get('To', []))
    print(f\"{m.get('From',{}).get('Address','?'):35} -> {to:22} {m.get('Subject')}\")
"
```

Expected: `sent 2`, then two rows — one `Confirm your PokeDrop email`, one `Reset your PokeDrop password`, both from `no-reply@pokedrop.local` to `probe@example.com`.

If the listing key is not `messages` or the fields are named differently, use what Task 1 Step 6 recorded.

- [ ] **Step 7: Confirm both body parts exist and carry the link**

A mail with an empty text part is the defect this step exists to catch, and it is invisible in any HTML-rendering client.

```bash
source "$SCRATCH/env.sh"
ID=$(curl -s "$MAILPIT/api/v1/messages" | python -c "import json,sys; print(json.load(sys.stdin)['messages'][0]['ID'])")
curl -s "$MAILPIT/api/v1/message/$ID" | python -c "
import json,sys
m = json.load(sys.stdin)
text, html = m.get('Text',''), m.get('HTML','')
print('text length:', len(text))
print('html length:', len(html))
print('link in text:', 'example.com' in text)
print('link in html:', 'example.com' in html)
"
rm -f apps/api/dist/mail-probe.mjs
```

Expected: both lengths well above zero and both `True`. If the per-message path differs, use what Task 1 Step 6 recorded.

- [ ] **Step 8: Lint and commit**

```bash
pnpm lint
git add apps/api/src/mail/ apps/api/src/app.module.ts
git commit -F - <<'EOF'
[PD-132]: add the mail module

One method over a nodemailer transporter, with the templates in their own
file as pure functions so what a mail says can change without touching
how it is delivered.

send throws; whether that should fail the request belongs to the caller.
No verify() at startup, unlike RedisService: redis is on the path of
every request, mail is on two flows that already treat a delivery failure
as non-fatal.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 3: Wire it into Better Auth

**Files:**
- Modify: `apps/api/src/auth/auth.factory.ts`
- Modify: `apps/api/src/auth/auth.module.ts`

**Interfaces:**
- Consumes: `MailService`, `verificationEmail`, `passwordResetEmail`, `RenderedMail` from `../mail/index.js` (Task 2).
- Produces: `buildAuth(prisma: PrismaService, config: AppConfig, mail: MailService)` — one argument more than before. No later task consumes it.

---

- [ ] **Step 1: Measure the current state — signing up sends nothing**

```bash
source "$SCRATCH/env.sh"
startapi
curl -s -X DELETE "$MAILPIT/api/v1/messages" > /dev/null
$PSQL -c "delete from users where email like 'pd132-%';" > /dev/null
curl -s -o /dev/null -X POST "$API/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd132-a@example.com","password":"correct-horse-battery","name":"PD132 A"}'
echo -n "messages in Mailpit after sign-up: "
curl -s "$MAILPIT/api/v1/messages" | python -c "import json,sys; print(len(json.load(sys.stdin).get('messages', [])))"
echo -n "emailVerified in the database: "
$PSQL -c "select \"emailVerified\" from users where email = 'pd132-a@example.com';"
```

Expected: `0` messages, and `f` for `emailVerified`. Nobody proves they own the address, and nothing asks them to.

- [ ] **Step 2: Wire the callbacks**

In `apps/api/src/auth/auth.factory.ts`, add the imports:

```ts
import { Logger } from '@nestjs/common';
import {
  MailService,
  passwordResetEmail,
  verificationEmail,
  type RenderedMail,
} from '../mail/index.js';
```

Change the signature and add a delivery helper at the top of the function body:

```ts
export function buildAuth(prisma: PrismaService, config: AppConfig, mail: MailService) {
  if (!config.auth.secret) {
    throw new Error('AUTH_SECRET is required. Generate one with: openssl rand -base64 32');
  }

  const logger = new Logger('AuthMail');

  /**
   * The delivery policy for auth mail: log a failure, never rethrow it.
   *
   * Better Auth writes the user row before calling these, so failing the
   * response would report a failed sign-up for one that partly succeeded — and
   * the caller's retry would then hit "that address is already taken", which is
   * the worst of both outcomes. The recovery path is the resend endpoint in
   * PD-31.
   *
   * `error` rather than `warn`: a relay that will not accept mail is a real
   * failure, even though it is not the caller's.
   */
  const deliver = async (to: string, rendered: RenderedMail): Promise<void> => {
    try {
      await mail.send({ to, ...rendered });
    } catch (error) {
      logger.error(
        `Failed to deliver "${rendered.subject}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };
```

Then add the `emailVerification` block, next to `emailAndPassword`:

```ts
    emailVerification: {
      /**
       * Explicitly true, and this is load-bearing. The default is `undefined`,
       * which means "follow requireEmailVerification" — and that is false, so
       * without this line no verification mail is ever sent and the transport
       * looks broken.
       */
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        // `user.name`, not `user.displayName`: the user.fields mapping below
        // renames the column, so the provider's model field is `name`.
        await deliver(user.email, verificationEmail({ displayName: user.name, url }));
      },
    },
```

and inside the existing `emailAndPassword` block, after `requireEmailVerification`:

```ts
      sendResetPassword: async ({ user, url }) => {
        await deliver(user.email, passwordResetEmail({ displayName: user.name, url }));
      },
```

`requireEmailVerification` stays `false`. Update its comment, which currently says PD-31 turns it on "together with the verification email" — the mail exists now, and what it is still waiting for is the resend endpoint:

```ts
      /**
       * PD-31 turns this on. Not here: the transport exists as of PD-132, but
       * making verification mandatory while the token lives one hour and no
       * resend endpoint exists would strand anyone who missed the window.
       */
      requireEmailVerification: false,
```

- [ ] **Step 3: Inject the service**

In `apps/api/src/auth/auth.module.ts`:

```ts
import { MailService } from '../mail/index.js';
```

and change the provider:

```ts
    {
      provide: AUTH_INSTANCE,
      inject: [PrismaService, APP_CONFIG, MailService],
      useFactory: (prisma: PrismaService, config: AppConfig, mail: MailService) =>
        buildAuth(prisma, config, mail),
    },
```

- [ ] **Step 4: Confirm a sign-up now produces a mail**

```bash
source "$SCRATCH/env.sh"
pnpm typecheck && pnpm --filter @pokedrop/api build 2>&1 | tail -2
startapi
curl -s -X DELETE "$MAILPIT/api/v1/messages" > /dev/null
$PSQL -c "delete from users where email like 'pd132-%';" > /dev/null
curl -s -o /dev/null -X POST "$API/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd132-a@example.com","password":"correct-horse-battery","name":"PD132 A"}'
curl -s "$MAILPIT/api/v1/messages" | python -c "
import json,sys
for m in json.load(sys.stdin).get('messages', []):
    print(m.get('Subject'), '->', ', '.join(a.get('Address','') for a in m.get('To', [])))
"
```

Expected: one row, `Confirm your PokeDrop email -> pd132-a@example.com`. Where Step 1 measured zero.

- [ ] **Step 5: Follow the link and confirm it verifies the account — this is AC1**

The claim that matters. A mail that arrives but whose link does nothing is the failure this step exists to catch.

```bash
source "$SCRATCH/env.sh"
ID=$(curl -s "$MAILPIT/api/v1/messages" | python -c "import json,sys; print(json.load(sys.stdin)['messages'][0]['ID'])")
LINK=$(curl -s "$MAILPIT/api/v1/message/$ID" | python -c "
import json,sys,re
m = json.load(sys.stdin)
print(re.search(r'https?://[^\s\"<>]+verify-email[^\s\"<>]*', m.get('Text','')).group(0))
")
echo "link: $LINK"
echo -n "emailVerified before: "; $PSQL -c "select \"emailVerified\" from users where email = 'pd132-a@example.com';"
curl -s -o /dev/null -w 'following the link: %{http_code}\n' -L "$LINK"
echo -n "emailVerified after:  "; $PSQL -c "select \"emailVerified\" from users where email = 'pd132-a@example.com';"
```

Expected: `f` before, a 2xx or 3xx from the link, `t` after. The link is taken out of the delivered message rather than constructed, so this measures the whole chain — template, transport, and the token Better Auth put in it.

- [ ] **Step 6: Confirm the reset link works — this is AC2**

```bash
source "$SCRATCH/env.sh"
curl -s -X DELETE "$MAILPIT/api/v1/messages" > /dev/null
curl -s -o /dev/null -X POST "$API/api/auth/request-password-reset" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d "{\"email\":\"pd132-a@example.com\",\"redirectTo\":\"$WEB/reset-password\"}"
ID=$(curl -s "$MAILPIT/api/v1/messages" | python -c "import json,sys; print(json.load(sys.stdin)['messages'][0]['ID'])")
curl -s "$MAILPIT/api/v1/message/$ID" | python -c "
import json,sys,re
m = json.load(sys.stdin)
print('subject:', m.get('Subject'))
t = re.search(r'token=([A-Za-z0-9._-]+)', m.get('Text',''))
print('token:', t.group(1) if t else 'NOT FOUND')
" | tee "$SCRATCH/reset.txt"
TOKEN=$(grep '^token:' "$SCRATCH/reset.txt" | cut -d' ' -f2)

curl -s -o /dev/null -w 'reset-password: %{http_code}\n' -X POST "$API/api/auth/reset-password" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d "{\"newPassword\":\"brand-new-passphrase\",\"token\":\"$TOKEN\"}"
curl -s -o /dev/null -w 'sign-in with the NEW password: %{http_code}\n' -X POST "$API/api/auth/sign-in/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd132-a@example.com","password":"brand-new-passphrase"}'
curl -s -o /dev/null -w 'sign-in with the OLD password: %{http_code}\n' -X POST "$API/api/auth/sign-in/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd132-a@example.com","password":"correct-horse-battery"}'
```

Expected: subject `Reset your PokeDrop password`, a token, `200` from reset, `200` signing in with the new password, `401` with the old one. The last line is what proves the reset took effect rather than merely returning 200.

If `request-password-reset` answers 404, the route name differs in this version — list what the handler accepts and record the real one, the way PD-29 did for `sign-up/email`.

- [ ] **Step 7: Confirm a dead relay breaks neither sign-up nor the boot — this is AC3**

Both halves of the failure policy, measured at once.

```bash
source "$SCRATCH/env.sh"
startapi MAIL_SMTP_URL=smtp://localhost:1099
echo -n "the API booted with an unreachable relay: "
curl -s -o /dev/null -w '%{http_code}\n' "$API/api/v1/health/live"
$PSQL -c "delete from users where email like 'pd132-b%';" > /dev/null
echo -n "sign-up with the relay down: "
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' -H "Origin: $WEB" \
  -d '{"email":"pd132-b@example.com","password":"correct-horse-battery","name":"PD132 B"}'
echo -n "the user row exists anyway: "
$PSQL -c "select count(*) from users where email = 'pd132-b@example.com';"
echo "--- what it logged ---"
grep -o 'Failed to deliver[^"]*' "$SCRATCH/api.log" | tail -1
```

Expected: `200` from health — the boot does not depend on the relay; `200` from sign-up; `1` user row; and a `Failed to deliver "Confirm your PokeDrop email": …` line in the log. Sign-up taking noticeably longer than usual is the connection timeout doing its job, and is expected.

- [ ] **Step 8: Lint and commit**

```bash
source "$SCRATCH/env.sh"
startapi
pnpm lint
git add apps/api/src/auth/auth.factory.ts apps/api/src/auth/auth.module.ts
git commit -F - <<'EOF'
[PD-132]: send the verification and reset mail from better auth

sendOnSignUp is explicitly true because its default means "follow
requireEmailVerification", which is false -- without the line no mail is
ever sent and the transport looks broken.

Delivery failure is logged and not rethrown. The user row is written
before the mail is sent, so failing the response would report a failed
sign-up for one that partly succeeded, and the retry would hit "that
address is already taken".

requireEmailVerification stays false: the transport exists now, but the
resend endpoint that makes mandatory verification survivable does not.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Task 4: Documentation and close-out

**Files:**
- Modify: `apps/api/src/auth/README.md`

**Interfaces:**
- Consumes: the measured results from Tasks 1-3. Every claim written here comes from a command that ran.

---

- [ ] **Step 1: Document what is sent and what happens when it fails**

In `apps/api/src/auth/README.md`, insert before `## Sessions`:

```markdown
## Mail

Two messages, both Better Auth's own flows. The provider generates the token, builds the URL and enforces expiry and single use; this module only delivers.

| Trigger | Template | Route the link hits |
| --- | --- | --- |
| sign-up | `verificationEmail` | `GET /api/auth/verify-email` |
| `POST /api/auth/request-password-reset` | `passwordResetEmail` | `POST /api/auth/reset-password` |

**`sendOnSignUp: true` is load-bearing.** Its default is `undefined`, which means "follow `requireEmailVerification`" — and that is `false`. Remove the line and no verification mail is ever sent, which looks exactly like a broken transport.

**Delivery failure is logged, not raised.** Better Auth writes the user row before calling the callback, so failing the response would report a failed sign-up for one that partly succeeded, and the caller's retry would then hit "that address is already taken". Measured: with the relay unreachable, sign-up returns 200, the user row exists, and the log carries `Failed to deliver`. The recovery path is the resend endpoint PD-31 adds.

**The boot does not depend on the relay.** `MailService` does not call `transporter.verify()` at startup, unlike `RedisService`, which pings and fails the boot on a bad URL. Redis is on the path of every request; mail is on two flows that already treat a delivery failure as non-fatal.

**`requireEmailVerification` is still `false`.** The transport exists, but turning verification on while the token lives an hour and no resend endpoint exists would strand anyone who missed the window. PD-31 turns it on together with resend, its cooldown and the welcome grant.

Local mail goes to Mailpit and nowhere else — read it at <http://localhost:8025>.
```

- [ ] **Step 2: Format, lint and commit**

```bash
pnpm format:check || pnpm format
pnpm typecheck && pnpm lint
git add apps/api/src/auth/README.md
git commit -F - <<'EOF'
[PD-132]: document what the auth module sends and when it fails

Records the two messages, why sendOnSignUp must be explicit, and the two
behaviours that are easy to assume wrongly: a delivery failure does not
fail the request, and an unreachable relay does not stop the boot.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 3: Clean up the measurement state**

```bash
source "$SCRATCH/env.sh"
stopapi
$PSQL -c "delete from users where email like 'pd132-%';"
curl -s -X DELETE "$MAILPIT/api/v1/messages" > /dev/null
rm -f "$SCRATCH/reset.txt" apps/api/dist/mail-probe.mjs
git status --porcelain
```

Expected: `git status --porcelain` prints nothing.

- [ ] **Step 4: Push and confirm CI**

```bash
git push
```

Confirm all four jobs pass — typecheck, lint, build, migrations. `migrations` is unaffected; this ticket changes no schema, but a green run is the claim rather than the expectation.

- [ ] **Step 5: Write the forward notes**

Comment on **PD-31**:

> **PD-132 note.** The transport is in. `sendVerificationEmail` is wired and measured end to end: the link out of the delivered mail flips `users."emailVerified"`.
>
> What is left here, and why each was deliberately not done in PD-132:
> - **`requireEmailVerification: true`** — turn it on in the same change as the resend endpoint and its cooldown. On its own it strands anyone who misses the one-hour token.
> - **`WEB_BASE_URL`** — still needed. Better Auth builds the link from `AUTH_BASE_URL`, so today it points at the API. Once the frontend sends `callbackURL` on sign-up, the link can land on a page; nothing in PD-132 read the web app's address, so the variable was not added there.
> - **The welcome grant** hangs off `emailVerification.afterEmailVerification(user, request)`.
> - **The third template**, for the identical-response enumeration pattern, belongs with whichever way you decide that trade. `mail.templates.ts` takes another pure function.

Comment on **PD-32**:

> **PD-132 note.** `sendResetPassword` is wired and measured: requesting a reset delivers a mail, its token completes `POST /api/auth/reset-password`, the new password signs in and the old one returns 401.
>
> What is left is this ticket's own criteria — single use, expiry, and invalidating other sessions. `emailAndPassword.onPasswordReset(data: { user }, request?)` is the hook for the last of those, and `resetPasswordTokenExpiresIn` (default one hour) is the first.

- [ ] **Step 6: Close PD-132**

Set it to Done, recording each criterion against its measurement: AC1 the link flipping `emailVerified`, AC2 the reset chain ending in a 401 for the old password, AC3 the unreachable relay leaving both the boot and sign-up intact.

---

## Self-Review

**Spec coverage.** The `mail/` module and its four files → Task 2. `MAIL_SMTP_URL` / `MAIL_FROM` and the `mail` namespace → Task 1 Steps 7-9. Mailpit in Compose → Task 1 Steps 5-6. Both templates with both body parts → Task 2 Steps 1 and 7. `buildAuth` taking `MailService` → Task 3 Steps 2-3. The three decisions (`requireEmailVerification` stays false, no `WEB_BASE_URL`, no third template) → Global Constraints, plus Task 3 Step 2's comment and Task 4 Step 5's forward note. Failure handling and the absence of `verify()` → Task 2 Step 2 and Task 3 Steps 2 and 7. Verification rows 1-7 all appear: row 1 → Task 3 Step 4; row 2 → Task 3 Step 5; row 3 → Task 2 Step 7; row 4 → Task 3 Step 6; rows 5 and 6 → Task 3 Step 7; row 7 → Task 2 Step 6. Documentation → Task 4 Step 1 plus the README line in Task 1 Step 10.

**Placeholder scan.** Clean. Two steps carry genuine unknowns about existing systems rather than deferred decisions, and both name the fallback: Task 1 Step 6 records Mailpit's real API field names instead of assuming them, and Task 3 Step 6 says what to do if `request-password-reset` is named differently in this version — the same problem PD-29 hit when `docs/API.md` claimed `sign-up` rather than `sign-up/email`.

**Type consistency.** `MailMessage`, `RenderedMail`, `MailService.send`, `verificationEmail`, `passwordResetEmail`, `MailModule`, `config.mail.smtpUrl` and `config.mail.from` are spelled identically in every task. Task 2's `send(message: MailMessage)` matches Task 3's call, which spreads a `RenderedMail` over `{ to }` — the three fields of `RenderedMail` plus `to` are exactly `MailMessage`.

**One risk the plan cannot retire in advance.** Task 3 Step 5 parses a URL out of the message body with a regular expression anchored on `verify-email`. If Better Auth's link shape differs, that match fails and the step reports it rather than passing silently — but the fix is to read the delivered body and adjust the pattern, not to skip the measurement.
