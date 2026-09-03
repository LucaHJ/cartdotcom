#!/usr/bin/env bash
set -euo pipefail

ROOT="${REEL_ORIGIN_WATCHDOG_ROOT:-/srv/cartdotcom/instagram-reel-brain}"
RUN_DIR="$ROOT/runs/phase7-origin"
PID_FILE="$RUN_DIR/origin.pid"
LOCK_FILE="$RUN_DIR/watchdog.lock"
LOG_FILE="$RUN_DIR/origin.log"
FAILURE_FILE="$RUN_DIR/health-failures"
EXPECTED="$ROOT/scripts/phase7_origin.py --token-file /srv/cartdotcom/reel-brain-secrets/phase7-origin-token"

mkdir -p "$RUN_DIR"
chmod 0700 "$RUN_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

valid_pid=""
if [[ -s "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    [[ "$cmdline" == *"$EXPECTED"* ]] && valid_pid="$pid"
  fi
fi

if [[ -n "$valid_pid" ]]; then
  # A live PID can have exhausted descriptors and serve no requests. Only
  # restart transport/storage failures, not a legitimate mirror divergence.
  health="$(curl --silent --show-error --max-time 5 --noproxy '*' http://172.19.0.1:3110/healthz 2>/dev/null || true)"
  if [[ -n "$health" && "$health" == *'"service":"phase7-origin"'* && "$health" != *'"mirror_state":"storage_unavailable"'* ]]; then
    printf '0\n' > "$FAILURE_FILE"
    exit 0
  fi
  failures="$(cat "$FAILURE_FILE" 2>/dev/null || true)"
  [[ "$failures" =~ ^[0-9]+$ ]] || failures=0
  failures=$((failures + 1))
  printf '%s\n' "$failures" > "$FAILURE_FILE"
  [[ "$failures" -ge 3 ]] || exit 0
  printf '%s phase7_origin_unresponsive_restart pid=%s failures=%s\n' "$(date -u +%FT%TZ)" "$valid_pid" "$failures" >> "$LOG_FILE"
  kill -TERM "$valid_pid"
  for _attempt in $(seq 1 10); do
    kill -0 "$valid_pid" 2>/dev/null || break
    sleep 1
  done
  # Never start a second origin while the old one might still be alive.
  kill -0 "$valid_pid" 2>/dev/null && exit 1
fi

rm -f "$PID_FILE"
nohup nice -n 10 ionice -c2 -n7 python3 "$ROOT/scripts/phase7_origin.py" \
  --token-file /srv/cartdotcom/reel-brain-secrets/phase7-origin-token \
  --schema reel_phase7_primary_20260825_133007 \
  --watermark 2026-08-25T13:30:07Z \
  --mirror-run-dir /srv/cartdotcom/reel-brain-runs/phase7-primary/20260825T133007Z \
  --mirror-object-root /srv/cartdotcom/reel-brain-data/objects \
  >>"$LOG_FILE" 2>&1 < /dev/null 9>&- &
pid=$!
printf '%s\n' "$pid" > "$PID_FILE"
chmod 0600 "$PID_FILE" "$LOG_FILE"
sleep 1
kill -0 "$pid"
printf '0\n' > "$FAILURE_FILE"
