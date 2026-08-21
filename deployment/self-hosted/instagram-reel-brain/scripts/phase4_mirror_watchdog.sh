#!/usr/bin/env sh
set -eu

RUN_DIR="/srv/cartdotcom/reel-brain-runs/phase4-shadow/2026-08-21_01-42-46"
PID_FILE="$RUN_DIR/mirror-supervised.pid"
LOCK_FILE="$RUN_DIR/mirror-supervisor.lock"
LOG_FILE="$RUN_DIR/mirror-supervised.log"

mkdir -p "$RUN_DIR"

(
  flock -n 9 || exit 0
  if [ -s "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    exit 0
  fi
  nohup nice -n 10 ionice -c2 -n7 \
    python3 /srv/cartdotcom/instagram-reel-brain/scripts/phase4_shadow_mirror.py loop \
      --schema reel_phase4_shadow_20260821_014246 \
      --watermark 2026-08-21T01:42:46Z \
      --run-dir "$RUN_DIR" \
      --object-root "$RUN_DIR/objects" \
      --token-file /srv/cartdotcom/reel-brain-secrets/phase4-mirror-token \
      --limit 100 \
      --interval-seconds 300 \
      >> "$LOG_FILE" 2>&1 &
  echo "$!" > "$PID_FILE"
) 9>"$LOCK_FILE"
