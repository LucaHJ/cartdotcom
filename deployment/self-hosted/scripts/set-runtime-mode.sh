#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"
confirmation="${2:-}"
runtime_dir="/srv/cartdotcom/news"
env_file="${runtime_dir}/.env"
snapshot_upload_url="$(sed -n 's/^SNAPSHOT_UPLOAD_URL=//p' "${env_file}" 2>/dev/null | tail -n 1)"
snapshot_interval_ms="$(sed -n 's/^SNAPSHOT_INTERVAL_MS=//p' "${env_file}" 2>/dev/null | tail -n 1)"

case "${mode}" in
  staging)
    authority=cloudflare
    ingestion=false
    mutations=false
    workers=false
    runner=false
    market=false
    corpus=false
    ;;
  active)
    if [[ "${confirmation}" != "--confirm-cloudflare-disabled" ]]; then
      echo "Active mode requires: set-runtime-mode.sh active --confirm-cloudflare-disabled" >&2
      exit 2
    fi
    if [[ ! -s /home/lucaj/.codex/auth.json ]]; then
      echo "Codex authentication is missing; run codex login --device-auth first." >&2
      exit 1
    fi
    authority=self_hosted
    ingestion=true
    mutations=true
    workers=true
    runner=true
    market=true
    corpus=true
    ;;
  *)
    echo "Usage: set-runtime-mode.sh staging|active [--confirm-cloudflare-disabled]" >&2
    exit 2
    ;;
esac

temp_file="$(mktemp "${runtime_dir}/.env.XXXXXX")"
chmod 0600 "${temp_file}"
{
  printf 'INGESTION_ENABLED=%s\n' "${ingestion}"
  printf 'API_MUTATIONS_ENABLED=%s\n' "${mutations}"
  printf 'WORKERS_ENABLED=%s\n' "${workers}"
  printf 'RUNNER_ENABLED=%s\n' "${runner}"
  printf 'MARKET_TRACKER_ENABLED=%s\n' "${market}"
  printf 'CORPUS_ARCHIVER_ENABLED=%s\n' "${corpus}"
  printf 'WORKER_CONCURRENCY=8\n'
  printf 'RUNNER_CONCURRENCY=8\n'
  printf 'MARKET_TRACKER_CONCURRENCY=4\n'
  printf 'CODEX_RESEARCH_MODEL=gpt-5.6-luna\n'
  printf 'CODEX_RESEARCH_REASONING_EFFORT=medium\n'
  if [[ -n "${snapshot_upload_url}" ]]; then
    printf 'SNAPSHOT_UPLOAD_URL=%s\n' "${snapshot_upload_url}"
  fi
  printf 'SNAPSHOT_INTERVAL_MS=%s\n' "${snapshot_interval_ms:-300000}"
} >"${temp_file}"
mv "${temp_file}" "${env_file}"

cd "${runtime_dir}"
docker compose --profile tools run --rm migrate

if [[ "${mode}" == "staging" ]]; then
  cd /srv/platform
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U cartdotcom -d cartdotcom \
    -c "UPDATE runtime_authority SET owner = 'cloudflare', epoch = epoch + 1, updated_at = CURRENT_TIMESTAMP, note = 'Local runtime placed in staging mode.' WHERE scope = 'news-processing';"
  cd "${runtime_dir}"
fi

if [[ "${mode}" == "active" ]]; then
  /srv/platform/scripts/reconcile-news-runtime.sh
fi

docker compose up -d --wait news-api news-scheduler news-worker codex-runner auth-rotator market-tracker corpus-archiver

if [[ "${mode}" == "active" ]]; then
  cd /srv/platform
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U cartdotcom -d cartdotcom \
    -c "UPDATE runtime_authority SET owner = 'self_hosted', epoch = epoch + 1, updated_at = CURRENT_TIMESTAMP, note = 'Cloudflare processing confirmed disabled before local activation.' WHERE scope = 'news-processing';"
fi
echo "Cartdotcom runtime is now in ${mode} mode."
