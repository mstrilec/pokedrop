# Email transport

Design, 2026-09-17. Milestone M2 · Auth & RBAC.

The prerequisite PD-31 and PD-32 both consume and neither describes.

---

## Why this is its own piece

Three things in the codebase are waiting on it, and all three are already written down.

**`requireEmailVerification` is `false` in `auth.factory.ts`.** The comment there says why: turning it on without something to send the mail would lock out every account the moment it is created. So today anyone can register against an address they do not own and use it immediately.

**The 1,000-coin welcome grant has nothing to hang from.** PD-31 ties it to verification, because verification is what unlocks the economy. No mail means no verification event, and moving the grant to sign-up instead would let a script mint currency by creating accounts.

**Password reset does not exist as a concept.** PD-32 is entirely "send a single-use link".

There is a fourth, less obvious. PD-31 owns the only real fix for sign-up account enumeration, and that fix *is* an email: answer identically whether or not the account exists, and let a mail tell the real person which case it was. PD-30 measured why nothing else works — a duplicate registration answers 422, and any status distinct from success is itself the oracle, so no wording change closes it.

None of those three tickets describes the transport. Each assumes it. That is what this piece is.

## What it is not

It is smaller than "build email" suggests. Better Auth already generates the tokens, builds the URLs, enforces expiry and single use, and serves `/api/auth/verify-email` and `/api/auth/reset-password`. The entire integration is two optional callbacks:

```ts
emailVerification: {
  sendVerificationEmail: async ({ user, url, token }) => { /* deliver */ },
},
emailAndPassword: {
  sendResetPassword: async ({ user, url, token }) => { /* deliver */ },
},
```

The job is to put a string in front of a person. Everything genuinely hard about email — SPF, DKIM, DMARC, a domain with a reputation — is DNS work outside this repository, and is called out under *Out of scope*.

---

## Architecture

```
auth.factory.ts ──▶ MailService.send({ to, subject, html, text })
                          │
                          ├── nodemailer transporter, built from MAIL_SMTP_URL
                          │
        development ──────┴──────▶ Mailpit  (SMTP :1025, HTTP UI + API :8025)
        production ───────────────▶ any SMTP relay
```

### `apps/api/src/mail/`

| File | Responsibility |
| --- | --- |
| `mail.service.ts` | owns the nodemailer transporter and its lifecycle; one method, `send` |
| `mail.templates.ts` | pure functions from data to `{ subject, html, text }`; no I/O |
| `mail.module.ts` | `@Global`, provides `MailService` |
| `index.ts` | the module's public surface |

The split is the point: `mail.templates.ts` has no dependencies and no side effects, so what a message says can be changed and read without touching how it is delivered, and vice versa.

### Interfaces

```ts
export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

export function verificationEmail(input: { displayName: string; url: string }): RenderedMail;
export function passwordResetEmail(input: { displayName: string; url: string }): RenderedMail;

@Injectable()
export class MailService implements OnModuleDestroy {
  send(message: MailMessage): Promise<void>;
}
```

A callback is then one line of intent:

```ts
sendVerificationEmail: async ({ user, url }) => {
  await mail.send({ to: user.email, ...verificationEmail({ displayName: user.name, url }) });
},
```

`user.name` rather than `user.displayName`: the `user.fields` mapping in `auth.factory.ts` renames the column, so the provider's model field is `name`.

`buildAuth(prisma, config)` becomes `buildAuth(prisma, config, mail)`. Everything provider-specific stays behind the `auth` folder, as `apps/api/src/auth/README.md` requires.

### Both `html` and `text`, always

A text part is not decoration. Its absence is one of the signals spam filters weigh, and it is what a plain-text client displays. Two templates, two bodies each — cheap now, invisible to add later once the habit is missing.

### No template library

`mjml`, `handlebars` and `react-email` all earn their place at some number of templates. That number is not two. Plain functions returning a string are less surface than the thing they would save.

---

## Configuration

| Variable | Example | Purpose |
| --- | --- | --- |
| `MAIL_SMTP_URL` | `smtp://localhost:1025` | the relay; one URL rather than five variables, which nodemailer parses natively |
| `MAIL_FROM` | `PokeDrop <no-reply@pokedrop.local>` | envelope sender |

A single URL carries host, port, credentials and the TLS mode: `smtp://` is plain or STARTTLS, `smtps://` is implicit TLS on 465. Changing vendor — Resend, SES, Postmark, Mailgun, Brevo — is then an environment change, not a code change. That is the whole reason SMTP was chosen over a vendor's HTTP SDK, which would have put the vendor's name in the source.

### Mailpit in Compose

```yaml
mailpit:
  image: axllent/mailpit:v1.31
  container_name: pokedrop-mailpit
  ports:
    - '${MAILPIT_SMTP_PORT:-1025}:1025'
    - '${MAILPIT_UI_PORT:-8025}:8025'
```

Pinned to a minor tag, consistent with `postgres:17-alpine` and `redis:7.4-alpine`; `latest` is how a working environment changes under you.

The reason Mailpit beats a vendor's sandbox is not that it accepts mail — it is that it has an **HTTP API**. `GET /api/v1/messages` returns what was received, so a test can pull the verification link out of the message body and follow it. That is the difference between "a mail was probably sent" and "the link in the mail verifies the account", and it is what makes the verification plan below possible at all.

---

## Three decisions taken here, with their reasons

### `requireEmailVerification` stays `false`

PD-31's note says to turn it on "in the same change that can actually send the mail", but that note was written assuming PD-31 would build the transport itself.

Turning it on here makes verification mandatory while the token lives one hour and **no resend endpoint exists**. A user who misses the window is stuck with no way out. PD-31 turns it on together with resend, its cooldown, and the grant — the three things that make mandatory verification survivable.

### `WEB_BASE_URL` is not added

This reverses a gap identified earlier in conversation, and the reversal is the point of writing it down.

The template receives a finished `url` from Better Auth and renders it as-is. Nothing in this piece reads the web application's address. The variable becomes necessary when the frontend starts sending `callbackURL` on sign-up so the link lands on a page rather than on the API's bare response — which is PD-31 and frontend work.

Adding configuration that nothing here reads would contradict the argument already standing in `app.config.ts` about cache TTLs: variables nobody sets are surface to keep in sync. It goes to PD-31 as a forward note instead.

### The "you already have an account" template is not written

It is needed only if PD-31 adopts the identical-response pattern against enumeration, and that ticket explicitly leaves the decision open because the pattern costs the honest case — someone who forgot they registered sees "check your email" instead of a plain answer.

Two templates that are certainly needed; the third arrives with the decision that requires it.

---

## Failure handling

`MailService.send` throws. The Better Auth callbacks **catch, log at `error`, and do not rethrow.**

The user row is written before the mail is sent. Failing the response would report "sign-up failed" for a sign-up that partly succeeded, and the retry would hit "that address is already taken" — the worst of both outcomes. The recovery path is the resend endpoint in PD-31, not a 500 in the caller's face. `error` rather than `warn` because a relay that will not accept mail is a real failure, even though it is not the caller's.

The transporter sets `connectionTimeout`, `greetingTimeout` and `socketTimeout` so a hung relay cannot hold an HTTP request open.

### The boot does not depend on the relay

`MailService` deliberately does **not** call `transporter.verify()` at startup, and this differs from `RedisService`, which pings and fails the boot on a bad URL.

The difference is not inconsistency. Redis is on the path of every request — the cache and, since PD-36, the rate limiter. Mail is on the path of two flows that already treat delivery failure as non-fatal. Refusing to boot for a relay that is briefly unreachable would contradict that policy and convert a degraded feature into a total outage.

`onModuleDestroy` closes the transporter, so pooled connections are released on SIGTERM alongside the Redis and Prisma shutdowns.

---

## Verification plan

Every row is a command against the running stack. Mailpit's API is what makes rows 2 and 4 possible.

| # | Claim | Method |
| --- | --- | --- |
| 1 | Sign-up produces a mail | sign up, then list messages from Mailpit's API |
| 2 | The link in that mail actually verifies the account | fetch the message, extract the URL from its body, follow it, then read `users."emailVerified"` in Postgres |
| 3 | The message has both parts, and they are not empty | the fetched message's text and HTML bodies |
| 4 | Password reset arrives and its token works | request a reset, extract the URL, complete it, sign in with the new password |
| 5 | A dead relay does not break sign-up | point `MAIL_SMTP_URL` at a port nothing listens on, sign up, expect success and a logged `error` |
| 6 | The boot does not depend on the relay | boot with that same dead URL, expect the API to serve `/api/v1/health/live` |
| 7 | `MAIL_FROM` reaches the envelope | read the `From` of a received message |

**Confirm Mailpit's API shape against the running container before writing the measurements.** The list endpoint is `GET /api/v1/messages`; the path for a single message's body, and the field names it uses for the text and HTML parts, are version-specific and are worth reading from the container rather than assumed — a measurement built on a guessed path fails in a way that looks like "the mail never arrived".

Row 5 matters most of the five. It is the behaviour that decides whether a relay outage degrades one feature or takes down registration.

---

## Files

| Path | Change |
| --- | --- |
| `apps/api/package.json` | add `nodemailer` |
| `apps/api/src/mail/mail.service.ts` | **new** |
| `apps/api/src/mail/mail.templates.ts` | **new** |
| `apps/api/src/mail/mail.module.ts` | **new** |
| `apps/api/src/mail/index.ts` | **new** |
| `apps/api/src/config/env.schema.ts` | `MAIL_SMTP_URL`, `MAIL_FROM` |
| `apps/api/src/config/app.config.ts` | a `mail` namespace |
| `apps/api/src/auth/auth.factory.ts` | the two callbacks; `buildAuth` takes `MailService` |
| `apps/api/src/auth/auth.module.ts` | inject `MailService` |
| `apps/api/src/app.module.ts` | import `MailModule` |
| `docker-compose.yml` | the `mailpit` service |
| `.env.example` | the two variables and the Mailpit ports |
| `apps/api/src/auth/README.md` | what is sent, when, and what happens when it fails |
| `README.md` | where to read local mail — `http://localhost:8025` |

No schema change, so no migration.

`nodemailer@10` ships a dual `exports` map with a real `import` condition and its own types, so the CommonJS-under-`nodenext` problem that cost time in PD-19 and resurfaced in PD-36 does not apply. It requires Node ≥ 20; the project is on 22.

## Out of scope

**Deliverability.** SPF, DKIM and DMARC records, and a domain with a sending reputation. This is the genuinely hard part of email and none of it is code — without it, mail from a real relay lands in spam and "verification is broken" will look like an application bug. It needs a domain, which this project does not yet have, and belongs with deployment rather than with a module.

**Queueing.** Sending happens inside the request, with timeouts. An earlier concern that this would leak timing into PD-31's enumeration fix was overstated: in that pattern both branches send a mail through the same relay, so the difference between rendering two templates is noise against one network round trip. When BullMQ arrives in PD-41, moving delivery onto it is a change behind `MailService` that no caller sees.

**The resend endpoint and its cooldown**, the welcome grant, and turning on `requireEmailVerification` — all PD-31. **The reset flow's own acceptance criteria** — PD-32.

**Bounce and complaint handling**, suppression lists, and anything resembling marketing mail. This sends two transactional messages.

## Forward notes

- **PD-31** — `WEB_BASE_URL` is still needed, for the `callbackURL` that makes the verification link land on a page instead of the API's bare response. Also: turn on `requireEmailVerification` here, not before, and only together with resend and its cooldown. The third template, for the identical-response enumeration pattern, belongs to whichever way that decision goes.
- **PD-32** — `sendResetPassword` is wired and measured; the flow's single-use, expiry and session-invalidation criteria are yours. `onPasswordReset` is the hook for invalidating other sessions.
- **PD-41** — delivery can move behind the queue without touching a caller.
