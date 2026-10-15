# Deployment

Where PokeDrop runs, how a release goes out, and what to do when something breaks. Built in M14 (PD-128).

This is a diploma project with one environment: production, on a home server. No staging, no registry, no monitoring stack — each was cut on purpose (PD-127, PD-129).

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

**Better Auth adds its own limit in production**, in memory and per address: after three failed sign-ins within ten seconds the fourth answered 429, before our own 10-per-15-minutes limit was reached. It is on by default when `NODE_ENV=production` and was never visible in development.

## Backups

[`deploy/backup.sh`](../deploy/backup.sh) writes `pg_dump --format=custom` to `~/pokedrop-backups/pokedrop-<date>.dump` and keeps the newest seven. Nightly, from the deploy user's crontab, at night when nobody plays:

```
30 4 * * * $HOME/pokedrop/deploy/backup.sh >> $HOME/pokedrop-backups/backup.log 2>&1
```

The catalog and prices are re-syncable from the source; users, inventory, decks, trades and the currency ledger are not — that is what the dump is for.

**Restore** into the running database (stop the writers first):

```bash
cd ~/pokedrop
docker compose -f compose.production.yml --env-file .env.production stop api worker web
docker compose -f compose.production.yml --env-file .env.production exec -T postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < ~/pokedrop-backups/<file>.dump
deploy/deploy.sh --no-pull
```

## When something breaks

All commands run in `~/pokedrop`; `c` stands for `docker compose -f compose.production.yml --env-file .env.production`.

| Symptom | First look | Usual fix |
| --- | --- | --- |
| Site does not open | `c ps`; `tailscale funnel status` | `c up -d`; re-enable Funnel |
| 502 or errors on pages | `c logs --tail 100 web api` | the API is down or unhealthy: `c restart api` |
| Nobody can sign in, sign-up says OK | `c logs api \| grep -i mail` | the Gmail app password or `MAIL_SMTP_URL` is wrong |
| Catalog or prices stale | the admin sync page; `c logs --tail 100 worker` | re-run the sync from the admin page |
| Disk filling | `docker system df` | `docker image prune -f`; old dumps rotate themselves |

Logs rotate at 10 MB × 3 files per container.
