#!/usr/bin/env bash
set -euo pipefail

ROOT=/srv/cartdotcom/instagram-reel-brain
RUN_ROOT="$ROOT/runs"
PID_FILE="$RUN_ROOT/phase6-dispatcher.pid"
LOG_FILE="$RUN_ROOT/phase6-dispatcher.log"
LOCK_FILE="$RUN_ROOT/phase6-dispatcher-watchdog.lock"
EXPECTED="python3 $ROOT/scripts/phase6_dispatcher.py --generation 1"

mkdir -p "$RUN_ROOT"
chmod 0700 "$RUN_ROOT"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

authority="$(curl -fsS --max-time 20 https://cartdotcom-instagram-reel-brain.lucajeannin.workers.dev/health \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("processing_authority", "unknown"))')"

valid_pid=""
if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    command_line="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    if [[ "$command_line" == *"$EXPECTED"* ]]; then
      valid_pid="$pid"
    fi
  fi
fi

if [[ "$authority" != "self_hosted" ]]; then
  if [[ -n "$valid_pid" ]]; then
    kill "$valid_pid"
  fi
  rm -f "$PID_FILE"
  exit 0
fi

if [[ -n "$valid_pid" ]]; then
  exit 0
fi

rm -f "$PID_FILE"
cd "$ROOT"
nohup python3 "$ROOT/scripts/phase6_dispatcher.py" --generation 1 >>"$LOG_FILE" 2>&1 < /dev/null &
pid=$!
printf '%s\n' "$pid" > "$PID_FILE"
chmod 0600 "$PID_FILE" "$LOG_FILE"
sleep 1
kill -0 "$pid"

