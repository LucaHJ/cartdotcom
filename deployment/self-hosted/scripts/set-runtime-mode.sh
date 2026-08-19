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
    ingestion=false
    workers=false
    runner=false
    market=false
    ;;
  active)
    if [[ "${confirmation}" != "--confirm-cloudflare-cutover" ]]; then
      echo "Active mode requires: set-runtime-mode.sh active --confirm-cloudflare-cutover" >&2
      exit 2
    fi
    if [[ ! -s /home/lucaj/.codex/auth.json ]]; then
      echo "Codex authentication is missing; run codex login --device-auth first." >&2
      exit 1
    fi
    ingestion=true
    workers=true
    runner=true
    market=true
    ;;
  *)
    echo "Usage: set-runtime-mode.sh staging|active [--confirm-cloudflare-cutover]" >&2
    exit 2
    ;;
esac

temp_file="$(mktemp "${runtime_dir}/.env.XXXXXX")"
chmod 0600 "${temp_file}"
{
  printf 'INGESTION_ENABLED=%s\n' "${ingestion}"
  printf 'WORKERS_ENABLED=%s\n' "${workers}"
  printf 'RUNNER_ENABLED=%s\n' "${runner}"
  printf 'MARKET_TRACKER_ENABLED=%s\n' "${market}"
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
docker compose up -d --wait news-scheduler news-worker codex-runner market-tracker
echo "Cartdotcom runtime is now in ${mode} mode."
