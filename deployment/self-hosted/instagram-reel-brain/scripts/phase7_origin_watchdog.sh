#!/usr/bin/env bash
set -euo pipefail

ROOT=/srv/cartdotcom/instagram-reel-brain
RUN_DIR="$ROOT/runs/phase7-origin"
PID_FILE="$RUN_DIR/origin.pid"
LOCK_FILE="$RUN_DIR/watchdog.lock"
LOG_FILE="$RUN_DIR/origin.log"
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
  exit 0
fi

rm -f "$PID_FILE"
nohup nice -n 10 ionice -c2 -n7 python3 "$ROOT/scripts/phase7_origin.py" \
  --token-file /srv/cartdotcom/reel-brain-secrets/phase7-origin-token \
  --schema reel_phase7_primary_20260825_133007 \
  --watermark 2026-08-25T13:30:07Z \
  --mirror-run-dir /srv/cartdotcom/reel-brain-runs/phase7-primary/20260825T133007Z \
  --mirror-object-root /srv/cartdotcom/reel-brain-data/objects \
  >>"$LOG_FILE" 2>&1 < /dev/null &
pid=$!
printf '%s\n' "$pid" > "$PID_FILE"
chmod 0600 "$PID_FILE" "$LOG_FILE"
sleep 1
kill -0 "$pid"
