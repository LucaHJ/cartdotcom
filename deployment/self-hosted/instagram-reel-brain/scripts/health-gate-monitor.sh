#!/usr/bin/env bash
set -uo pipefail

deadline_epoch="${REEL_STRESS_DEADLINE_EPOCH:-1787238000}"
project_dir="/srv/cartdotcom/instagram-reel-brain"
log_dir="/srv/cartdotcom/reel-brain-runs/health-gate"
log_file="${log_dir}/monitor.log"
failure_file="${log_dir}/failure.detected"
complete_file="${log_dir}/gate.complete"
cron_marker="# instagram-reel-health-gate"

mkdir -p "${log_dir}"

if [[ -f "${complete_file}" ]]; then
  exit 0
fi

timestamp="$(date -Is)"
now_epoch="$(date +%s)"
reel_state="$(cd "${project_dir}" && docker compose ps --format json \
  reel-api reel-dispatcher reel-worker reel-publisher reel-archiver reel-auth-rotator 2>&1)"
news_state="$(cd /srv/cartdotcom/news && docker compose ps --format json 2>&1)"
reel_unhealthy="$(printf '%s\n' "${reel_state}" | grep -Evc '"Health":"healthy"' || true)"
news_unhealthy="$(printf '%s\n' "${news_state}" | grep -Evc '"Health":"healthy"' || true)"
stress_running="$(docker inspect cartdotcom-instagram-reel-brain-reel-health-stress-1 --format '{{.State.Running}}' 2>/dev/null || echo false)"
host_state="$(uptime; free -m | sed -n '2p'; df -P /srv | tail -1)"

{
  printf '=== %s ===\n' "${timestamp}"
  printf 'reel_unhealthy_lines=%s news_unhealthy_lines=%s stress_running=%s\n' "${reel_unhealthy}" "${news_unhealthy}" "${stress_running}"
  printf '%s\n' "${host_state}"
  docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' \
    cartdotcom-instagram-reel-brain-reel-api-1 \
    cartdotcom-instagram-reel-brain-reel-dispatcher-1 \
    cartdotcom-instagram-reel-brain-reel-worker-1 \
    cartdotcom-instagram-reel-brain-reel-publisher-1 \
    cartdotcom-instagram-reel-brain-reel-archiver-1 \
    cartdotcom-instagram-reel-brain-reel-auth-rotator-1 \
    cartdotcom-instagram-reel-brain-reel-health-stress-1 2>&1 || true
} >>"${log_file}"

if [[ "${reel_unhealthy}" -ne 0 || "${news_unhealthy}" -ne 0 || "${stress_running}" != "true" ]]; then
  printf '%s reel_unhealthy=%s news_unhealthy=%s stress_running=%s\n' \
    "${timestamp}" "${reel_unhealthy}" "${news_unhealthy}" "${stress_running}" >>"${failure_file}"
fi

if (( now_epoch >= deadline_epoch )); then
  cd "${project_dir}"
  REEL_STRESS_DEADLINE_EPOCH="${deadline_epoch}" docker compose -f compose.health-gate.yaml down >>"${log_file}" 2>&1 || true
  {
    printf 'completed_at=%s\n' "$(date -Is)"
    printf 'failure_detected=%s\n' "$([[ -f "${failure_file}" ]] && echo true || echo false)"
    printf 'stress_status=%s\n' "$(tr -d '\n' < "${log_dir}/stress-status.json" 2>/dev/null || echo unavailable)"
  } >"${complete_file}"
  crontab -l 2>/dev/null | grep -Fv "${cron_marker}" | crontab -
fi
