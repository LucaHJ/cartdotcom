#!/usr/bin/env bash
set -euo pipefail

ROOT=/srv/cartdotcom/instagram-reel-brain
TOKEN_FILE=/srv/cartdotcom/reel-brain-secrets/phase7-origin-token
LOCK_FILE="$ROOT/runs/phase7-safety-poll.lock"

[[ -r "$TOKEN_FILE" ]] || exit 1
mkdir -p "$ROOT/runs"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

token="$(tr -d '\r\n' < "$TOKEN_FILE")"
wake_id="phase7-safety-$(date -u +%Y%m%dT%H%M%SZ)"
curl --fail --silent --show-error --max-time 20 --noproxy '*' \
  -H "Authorization: Bearer $token" \
  -H "Content-Type: application/json" \
  --data "{\"wake_id\":\"$wake_id\",\"path\":\"safety-poll\"}" \
  http://172.19.0.1:3110/v1/wake >/dev/null
