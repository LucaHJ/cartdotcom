#!/usr/bin/env bash
set -euo pipefail

lock_file="/tmp/cartdotcom-boot-recovery.lock"
exec 9>"${lock_file}"
if ! flock -n 9; then
  echo "Another Cartdotcom recovery run is active."
  exit 0
fi

echo "$(date --iso-8601=seconds) starting Cartdotcom boot recovery"

cd /srv/platform
docker compose up -d --wait

cd /srv/cartdotcom/news
docker compose run --rm migrate
docker compose up -d --wait news-api news-scheduler news-worker codex-runner auth-rotator market-tracker corpus-archiver
docker compose up -d dashboard-snapshot

curl --fail --silent --show-error http://127.0.0.1:8080/health >/dev/null
curl --fail --silent --show-error http://127.0.0.1:8080/health/ready >/dev/null

echo "$(date --iso-8601=seconds) Cartdotcom boot recovery completed"
