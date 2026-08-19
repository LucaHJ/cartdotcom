#!/usr/bin/env bash
set -euo pipefail

failed=0
echo "$(date --iso-8601=seconds) Cartdotcom health audit"
check_url() {
  local label="$1"
  local url="$2"
  if curl --fail --silent --max-time 10 "${url}" >/dev/null; then
    printf '%s healthy\n' "${label}"
  else
    printf '%s unhealthy\n' "${label}" >&2
    failed=1
  fi
}

check_compose_health() {
  local directory="$1"
  local service="$2"
  local container_id status
  container_id="$(cd "${directory}" && docker compose ps -q "${service}")"
  if [[ -z "${container_id}" ]]; then
    printf '%s missing\n' "${service}" >&2
    failed=1
    return
  fi
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}")"
  if [[ "${status}" != "healthy" ]]; then
    printf '%s %s\n' "${service}" "${status}" >&2
    failed=1
  else
    printf '%s healthy\n' "${service}"
  fi
}

check_compose_health /srv/platform postgres
check_compose_health /srv/platform caddy
check_compose_health /srv/cartdotcom/news news-api
check_compose_health /srv/cartdotcom/news news-scheduler
check_compose_health /srv/cartdotcom/news news-worker
check_compose_health /srv/cartdotcom/news codex-runner
check_compose_health /srv/cartdotcom/news auth-rotator
check_compose_health /srv/cartdotcom/news market-tracker
check_compose_health /srv/cartdotcom/news corpus-archiver
check_compose_health /srv/cartdotcom/news dashboard-snapshot
check_compose_health /srv/cartdotcom/news cloudflared
check_url gateway http://127.0.0.1:8080/health
check_url news-api http://127.0.0.1:8080/health/ready

exit "${failed}"
