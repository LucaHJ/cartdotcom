#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Deliberately manual: preserve the downloaded archive until explicitly refreshed.
mkdir -p output backups
exec 9>output/discovery.lock
flock -n 9 || { printf 'Another NBA pipeline job is running\n'; exit 1; }
if [ -f output/snapshot.json ] && [ -f output/discoveries.json ]; then
  tar -czf "backups/snapshot-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" output/snapshot.json output/discoveries.json
fi
docker compose run --rm build
docker compose run --rm discover
python3 pipeline/verify.py
