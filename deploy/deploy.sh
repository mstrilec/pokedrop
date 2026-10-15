#!/usr/bin/env bash
# Release PokeDrop on this host: pull, build, migrate, start, check.
#
#   deploy/deploy.sh             pull the current branch and release it
#   deploy/deploy.sh --no-pull   release the checkout as it is (a rollback:
#                                git checkout <commit> first)
#
# Migrations roll forward only (docs/Migrations.md). docs/Deployment.md has
# the whole procedure.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env.production ]]; then
  echo "deploy: .env.production is missing — copy .env.production.example and fill it in" >&2
  exit 1
fi

compose() {
  docker compose -f compose.production.yml --env-file .env.production "$@"
}

if [[ "${1:-}" != "--no-pull" ]]; then
  git pull --ff-only
fi

echo "deploy: releasing $(git rev-parse --short HEAD) — $(git log -1 --format=%s)"

compose build
compose up -d --wait postgres redis
compose run --rm migrate
compose up -d --wait --remove-orphans api worker web
docker image prune -f >/dev/null

failed=0
for url in http://127.0.0.1:3000/api/v1/health/ready http://127.0.0.1:3000/; do
  if curl -fsS -o /dev/null --max-time 15 "$url"; then
    echo "deploy: ok    $url"
  else
    echo "deploy: FAIL  $url" >&2
    failed=1
  fi
done

if [[ $failed -ne 0 ]]; then
  echo "deploy: the release is up but not healthy — see: docker compose -f compose.production.yml logs --tail 100" >&2
  exit 1
fi

echo "deploy: done"
