#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p output backups
exec 9>output/discovery.lock
flock -n 9 || exit 0
trap 'printf "Discovery or publication failed at %s\n" "$(date -u +%FT%TZ)" > output/last-error.txt' 0
# The source stays pinned to the audited 1950–2025 snapshot. Each run explores
# all history and advances one decade, retaining previously found era stories.
timeout 30m docker compose run --rm discover
python3 pipeline/verify.py
python3 pipeline/publish.py
tar -czf backups/latest-publication.tar.gz output/snapshot.json output/discoveries.json output/discovery-archive.json output/published.json
printf 'OK %s\n' "$(date -u +%FT%TZ)" > output/job-status.txt
rm -f output/last-error.txt
trap - 0
