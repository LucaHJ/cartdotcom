#!/usr/bin/env sh
set -eu

RUN_DIR="/srv/cartdotcom/reel-brain-runs/phase4-shadow/2026-08-21_01-42-46"
LOCK_FILE="$RUN_DIR/health-sampler.lock"
LOG_FILE="$RUN_DIR/health-supervised.log"

mkdir -p "$RUN_DIR"

(
  flock -n 9 || exit 0
  nice -n 10 ionice -c2 -n7 \
    python3 /srv/cartdotcom/instagram-reel-brain/scripts/phase4_health_sample.py \
      --run-dir "$RUN_DIR" \
      >> "$LOG_FILE" 2>&1
) 9>"$LOCK_FILE"
