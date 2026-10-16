# Deployment

Where PokeDrop runs, how a release goes out, the first admin, and what to do when something breaks. Built in M14 (PD-128).

This is a diploma project with one environment: production, on a home server. No staging, no registry, no monitoring stack, no backups — each was cut on purpose (PD-127, PD-128, PD-129).

---

## Where it lives

```
Internet ──HTTPS──▶ Tailscale Funnel (:443) ──▶ tailscaled on the host
                                                     │ http://127.0.0.1:3000
                                                     ▼
                        docker compose project "pokedrop-prod" (compose.production.yml)
                        ├─ web       Next.js standalone server   127.0.0.1:3000 → 3000
                        │             └─ /api/* rewrite ──▶ api:4000
                        ├─ api       NestJS (image pokedrop-api, `node dist/main`)
                        ├─ worker    BullMQ (same image, `node dist/worker`)
                        ├─ postgres  17, volume postgres-data
                        └─ redis     7.4 with AOF, volume redis-data
```

- **Host:** `strlts-server`, Ubuntu 24.04 LTS, i5-9400F, 31 GB RAM. It also runs a Minecraft and a Valheim server; their ports and `ufw` rules are not ours to touch.
- **Public URL:** `https://strlts-server.<tailnet>.ts.net`. Funnel gives a free HTTPS name with no domain and no port open on the router.
- **Only the web server is published, and only on `127.0.0.1`.** Docker's port publishing bypasses `ufw`, so a `0.0.0.0` mapping would be open to the LAN whatever the firewall says. The API, Postgres and Redis have no published port at all.
- **Resources:** each service has a memory limit (about 450 MB used in total when idle) and half the default CPU weight (`cpu_shares: 512`), so the game servers win under contention.

## The images

One [Dockerfile](../Dockerfile), two targets, both built **on the host** — there is no registry.

| Target | Contents | Runs as |
| --- | --- | --- |
| `api` | production dependencies of `@pokedrop/api`, the built `dist`, the Prisma client and the migration engine | `api` (`node dist/main`), `worker` (`node dist/worker`), `migrate` (`prisma migrate deploy`) |
| `web` | Next's `output: 'standalone'` server with `.next/static` | `web` (`node apps/web/server.js`) |

- `API_INTERNAL_URL` is a **build** argument for `web` (`http://api:4000`): the `/api` rewrite is fixed at `next build`. It is also set at run time for server renders.
- The `runtime` stage installs OpenSSL before anything touches Prisma: Prisma picks its migration engine by the OpenSSL it finds at install time, and without it downloaded the `openssl-1.1.x` build, which does not exist on Debian 12.
- The `api` image is about 1.5 GB. `better-auth` declares `next` and `react` as optional peers and pnpm installs them; it works, and the disk has room, so it stays.
- `next.config.ts` sets `output: 'standalone'` and `outputFileTracingRoot` to the workspace root, so a local `pnpm build` also writes `.next/standalone`. Harmless.

## Configuration

`.env.production` in the checkout on the host, mode `600`, never committed. Start from [`.env.production.example`](../.env.production.example); every value is explained there. The ones that matter most:

- `WEB_BASE_URL`, `AUTH_BASE_URL`, `CORS_ORIGINS` — the Funnel URL. A wrong `WEB_BASE_URL` sends verification mails whose link ends on an error page.
- `TRUST_PROXY_HOPS=1` — Funnel overwrites `X-Forwarded-For` with the real client address (tailscale `ipn/ipnlocal/serve.go`) and Next passes it on untouched ([API.md](API.md), *How the web app reaches the API*).
- `NODE_ENV=production` — secure cookies (`__Secure-better-auth.session_token`), and the config module ignores any `.env` file: the values reach the containers through `env_file`.
- `MAIL_SMTP_URL` — Gmail SMTP with an app password. Every account must verify its email, so without working mail nobody can sign in.
- No `POKEMONTCG_API_KEY`: the key is paid since pokemontcg.io joined Scrydex, and the keyless 1,000 requests a day is enough.
- Values must not contain `$`: compose interpolates it, in `env_file` as well.

## Releasing

```bash
cd ~/pokedrop
deploy/deploy.sh
```

[`deploy/deploy.sh`](../deploy/deploy.sh): `git pull --ff-only` → `docker compose build` → start Postgres and Redis → **`migrate`**, a one-off container from the API image → start `api`, `worker`, `web` and wait for their health checks → check `/api/v1/health/ready` and `/` through the web server. Any failure stops the script with a non-zero exit and says which check failed.

**The application never migrates** ([Migrations.md](Migrations.md)); `migrate` is the release step, and it sits behind the compose profile `release` so `up` never starts it.

**Rollback:** check out the previous commit and release it as it is. Migrations roll forward only — if the bad release migrated, write a reversing migration as [Migrations.md](Migrations.md) describes.

```bash
git checkout <previous-commit>
deploy/deploy.sh --no-pull
```

Measured 2026-10-15 on the development machine with a test `.env.production`: the script built both images, applied all 23 migrations to an empty database, and brought all five services up healthy. Through the web server: sign-up 200 → the verification link pointed at the web origin, 302 to `/verify-email` → sign-in 200 with a `Secure` `__Secure-` cookie → `GET /api/v1/users/me` 200 → `/dashboard` 200. Two `X-Forwarded-For` addresses drew from separate rate-limit buckets. A card image went through the optimizer into the `web-image-cache` volume, owned by `node`.

First release on the host, 2026-10-16: the build took 97 s, all 23 migrations applied, both checks ok. From the internet, `/` answered 200 in 1.3 s and `/api/v1/health/ready` 200 in 0.4 s through Funnel; from the LAN, ports 3000, 4000, 5432 and 6379 on the host did not answer. A sign-up from a phone on mobile data got its verification mail from Gmail, and its link signed the account in.

**Two Funnel traps from that first release.** `tailscale funnel --bg 3000` prints *Funnel is not enabled on your tailnet* with a link and then still says *Success*: the local proxy is configured, but the public DNS records appear only once the link is approved and the command is run again. And a lookup made before that is cached as "no address" — Cloudflare's resolver, the router and Firefox's DNS-over-HTTPS kept answering it for several minutes after Google's resolver already had the addresses. `ipconfig /flushdns` and Firefox's `about:networking#dns` clear the local part; the rest expires on its own.

**Better Auth adds its own limit in production**, in memory and per address: after three failed sign-ins within ten seconds the fourth answered 429, before our own 10-per-15-minutes limit was reached. It is on by default when `NODE_ENV=production` and was never visible in development.

## Data

No backups, on purpose: a diploma project with one environment. Accounts, inventories, decks and trades exist only in the `postgres-data` volume.

**Syncs run only on request.** `SYNC_SCHEDULES=false` makes the worker drop its crons at start (catalog at 03:00 UTC, the full price sweep at 04:00, the active-card refresh four times a day), so the catalog and prices change only when an admin presses **Run now** on `/admin/sync` — catalog first, then prices. The worker logs `Sync schedules off` when it starts.

**Pack templates.** [`deploy/pack-templates.sql`](../deploy/pack-templates.sql) creates four packs modelled on real boosters, after the catalog is in. It refuses to write anything if a set lacks a rarity it names, and leaves an existing template alone, so it is safe to run again:

```bash
docker compose -f compose.production.yml --env-file .env.production   exec -T postgres psql -U pokedrop -d pokedrop -v ON_ERROR_STOP=1 < deploy/pack-templates.sql
```

| Pack | Set | Cost | Cards | Built from |
| --- | --- | --- | --- | --- |
| Base Set | `base1` | 500 | 5 C · 3 U · 1 rare slot (Rare Holo 1 in 3) | the 1999 pack: 11 cards, two of them basic Energy |
| Evolving Skies | `swsh7` | 300 | 5 C · 3 U · reverse · rare slot (V 1/9.4, VMAX 1/17.7, Ultra 1/25, Rainbow 1/90, Secret 1/110) | Card Codex's per-pack rates for SWSH7 |
| Scarlet & Violet | `sv1` | 150 | 4 C · 3 U · reverse · reverse-or-hit (IR 1/13, SIR 1/31, Hyper 1/55) · rare slot (Double Rare 1/7.1, Ultra 1/14.7) | Card Codex's rates for SV1 and SV2, which agree |
| Scarlet & Violet 151 | `sv3pt5` | 200 | as Scarlet & Violet | the same era structure; no per-set table was found |

Basic Energy is left out — the catalog gives it no rarity, so it can never be drawn — and a reverse-holo slot draws an ordinary Common, Uncommon or Rare at the rates reverse holos appear, because the mirror has no foil variants. Pull rates are community estimates from large openings; The Pokémon Company publishes none. Costs keep the real price order (modern < 151 < Evolving Skies < vintage) against the 1,000-coin welcome grant, and can be changed on `/admin/packs` like everything else here.

**First admin.** There is no sign-up path to `ADMIN` (`docs/DataModel.md`, `input: false`). Register and verify the account on the site, then promote it once on the host:

```bash
cd ~/pokedrop
docker compose -f compose.production.yml --env-file .env.production exec postgres   psql -U pokedrop -d pokedrop -c "UPDATE users SET role = 'ADMIN' WHERE email = '<email>' AND \"emailVerified\" RETURNING email, role;"
```

The role is read from the database on every request, so the next page load has the admin area. Further admins are promoted from the admin users page.

## When something breaks

All commands run in `~/pokedrop`; `c` stands for `docker compose -f compose.production.yml --env-file .env.production`.

| Symptom | First look | Usual fix |
| --- | --- | --- |
| Site does not open | `c ps`; `tailscale funnel status` | `c up -d`; re-enable Funnel |
| 502 or errors on pages | `c logs --tail 100 web api` | the API is down or unhealthy: `c restart api` |
| Nobody can sign in, sign-up says OK | `c logs api \| grep -i mail` | the Gmail app password or `MAIL_SMTP_URL` is wrong |
| Catalog or prices stale | the admin sync page; `c logs --tail 100 worker` | re-run the sync from the admin page |
| Disk filling | `docker system df` | `docker image prune -f` |

Logs rotate at 10 MB × 3 files per container.
