#!/usr/bin/env bash
# Dump the production database and keep the newest seven dumps.
# Run nightly from cron; docs/Deployment.md has the crontab line and the
# restore procedure.
set -euo pipefail

cd "$(dirname "$0")/.."

backup_dir="${BACKUP_DIR:-$HOME/pokedrop-backups}"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

file="$backup_dir/pokedrop-$(date +%Y-%m-%d-%H%M).dump"

docker compose -f compose.production.yml --env-file .env.production exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$file.partial"
mv "$file.partial" "$file"

ls -1t "$backup_dir"/pokedrop-*.dump | tail -n +8 | xargs -r rm --

echo "backup: $file ($(du -h "$file" | cut -f1))"
