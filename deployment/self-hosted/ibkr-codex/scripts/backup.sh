#!/bin/sh
set -eu
export PGPASSWORD="$(cat "$PGPASSWORD_FILE")"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="/backups/ibkr-codex-${stamp}.dump"
tmp="${target}.tmp"
pg_dump --format=custom --file="$tmp"
pg_restore --list "$tmp" >/dev/null
mv "$tmp" "$target"
find /backups -type f -name 'ibkr-codex-*.dump' -mtime +14 -delete
echo "$target"

