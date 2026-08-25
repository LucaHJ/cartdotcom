#!/usr/bin/env sh
set -eu

RUN_DIR="/srv/cartdotcom/reel-brain-runs/phase4-shadow/2026-08-21_01-42-46"
PID_FILE="$RUN_DIR/mirror-supervised.pid"
LOCK_FILE="$RUN_DIR/mirror-supervisor.lock"
LOG_FILE="$RUN_DIR/mirror-supervised.log"
EXPECTED_SCRIPT="/srv/cartdotcom/instagram-reel-brain/scripts/phase4_shadow_mirror.py"
EXPECTED_SCHEMA="reel_phase4_shadow_20260821_014246"
EXPECTED_WATERMARK="2026-08-21T01:42:46Z"
MIRROR_POLL_SECONDS=15

mkdir -p "$RUN_DIR"

pid_matches_expected_mirror() {
  pid="$1"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  if [ -r "/proc/$pid/cmdline" ]; then
    cmdline=$(tr '\000' ' ' < "/proc/$pid/cmdline")
  else
    cmdline=$(ps -p "$pid" -o args= 2>/dev/null || true)
  fi
  case "$cmdline" in
    *"phase4_shadow_mirror.py loop"*\
*"--schema $EXPECTED_SCHEMA"*\
*"--watermark $EXPECTED_WATERMARK"*\
*"--run-dir $RUN_DIR"*\
*"--token-file /srv/cartdotcom/reel-brain-secrets/phase4-mirror-token"*)
      return 0
      ;;
  esac
  case "$cmdline" in
    *"python3 $EXPECTED_SCRIPT loop"*\
*"--schema $EXPECTED_SCHEMA"*\
*"--watermark $EXPECTED_WATERMARK"*\
*"--run-dir $RUN_DIR"*)
      return 0
      ;;
  esac
  return 1
}

(
  flock -n 9 || exit 0
  existing_pid=""
  if [ -s "$PID_FILE" ]; then
    existing_pid=$(cat "$PID_FILE")
  fi
  if pid_matches_expected_mirror "$existing_pid"; then
    exit 0
  fi
  if [ -n "$existing_pid" ]; then
    printf '%s stale_or_unexpected_pid=%s replaced\n' "$(date -u +%FT%TZ)" "$existing_pid" >> "$LOG_FILE"
  fi
  nohup nice -n 10 ionice -c2 -n7 \
    python3 "$EXPECTED_SCRIPT" loop \
      --schema "$EXPECTED_SCHEMA" \
      --watermark "$EXPECTED_WATERMARK" \
      --run-dir "$RUN_DIR" \
      --object-root "$RUN_DIR/objects" \
      --token-file /srv/cartdotcom/reel-brain-secrets/phase4-mirror-token \
      --limit 100 \
      --interval-seconds "$MIRROR_POLL_SECONDS" \
      >> "$LOG_FILE" 2>&1 &
  echo "$!" > "$PID_FILE"
) 9>"$LOCK_FILE"
