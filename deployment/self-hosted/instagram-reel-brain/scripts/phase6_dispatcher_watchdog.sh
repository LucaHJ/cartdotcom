#!/usr/bin/env bash
set -euo pipefail

ROOT=/srv/cartdotcom/instagram-reel-brain
RUN_ROOT="$ROOT/runs"
LOCK_FILE="$RUN_ROOT/phase6-dispatcher-watchdog.lock"
GENERATION_FILE="$RUN_ROOT/phase6-generation"
CONCURRENCY=2

generation="$(cat "$GENERATION_FILE" 2>/dev/null || true)"
[[ "$generation" =~ ^[0-9]+$ ]] || exit 0
mkdir -p "$RUN_ROOT"
chmod 0700 "$RUN_ROOT"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

authority="$(curl -fsS --max-time 20 https://cartdotcom-instagram-reel-brain.lucajeannin.workers.dev/health \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("processing_authority", "unknown"))')"

# Retire the generation-1 single-slot launcher without touching an unrelated PID.
legacy_pid_file="$RUN_ROOT/phase6-dispatcher.pid"
if [[ -f "$legacy_pid_file" ]]; then
  legacy_pid="$(cat "$legacy_pid_file" 2>/dev/null || true)"
  if [[ "$legacy_pid" =~ ^[0-9]+$ ]] && kill -0 "$legacy_pid" 2>/dev/null; then
    legacy_cmd="$(tr '\0' ' ' < "/proc/$legacy_pid/cmdline" 2>/dev/null || true)"
    if [[ "$legacy_cmd" == *"$ROOT/scripts/phase6_dispatcher.py --generation"* && "$legacy_cmd" != *"--slot"* ]]; then
      kill "$legacy_pid"
    fi
  fi
  mv -f "$legacy_pid_file" "$legacy_pid_file.legacy" 2>/dev/null || true
fi

for slot in $(seq 1 "$CONCURRENCY"); do
  pid_file="$RUN_ROOT/phase6-dispatcher-$slot.pid"
  log_file="$RUN_ROOT/phase6-dispatcher-$slot.log"
  expected="$ROOT/scripts/phase6_dispatcher.py --generation $generation --slot $slot"
  valid_pid=""
  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      command_line="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
      if [[ "$command_line" == *"$expected"* ]]; then
        valid_pid="$pid"
      elif [[ "$command_line" == *"$ROOT/scripts/phase6_dispatcher.py --generation"* ]]; then
        kill "$pid"
      fi
    fi
  fi

  if [[ "$authority" != "self_hosted" ]]; then
    [[ -z "$valid_pid" ]] || kill "$valid_pid"
    rm -f "$pid_file"
    continue
  fi

  if [[ -z "$valid_pid" ]]; then
    rm -f "$pid_file"
    cd "$ROOT"
    nohup python3 "$ROOT/scripts/phase6_dispatcher.py" --generation "$generation" --slot "$slot" >>"$log_file" 2>&1 < /dev/null &
    pid=$!
    printf '%s\n' "$pid" > "$pid_file"
    chmod 0600 "$pid_file" "$log_file"
    sleep 1
    kill -0 "$pid"
  fi
done

if [[ "$authority" == "self_hosted" ]]; then
  python3 "$ROOT/scripts/phase6_performance_report.py" >/dev/null 2>&1 || true
fi
