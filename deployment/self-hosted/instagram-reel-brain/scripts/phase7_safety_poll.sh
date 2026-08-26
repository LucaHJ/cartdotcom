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

# Wake acceptance is not mirror completion. Wait for this exact receipt so a
# persistent drain failure cannot masquerade as a successful safety poll.
health_file="$(mktemp "$ROOT/runs/phase7-health.XXXXXX")"
trap 'rm -f "$health_file"' EXIT
for _attempt in $(seq 1 48); do
  http_status="$(curl --silent --show-error --max-time 10 --noproxy '*' \
    --output "$health_file" --write-out '%{http_code}' \
    "http://172.19.0.1:3110/healthz?wake_id=$wake_id" || true)"
  if grep -Fq "\"wake_id\":\"$wake_id\"" "$health_file" && [[ "$http_status" != "202" ]]; then
    if [[ "$http_status" == "200" ]] && grep -Fq '"ok":true' "$health_file"; then
      exit 0
    fi
    echo "phase7_mirror_drain_failed wake_id=$wake_id health=$(cat "$health_file")" >&2
    exit 1
  fi
  sleep 5
done
echo "phase7_mirror_drain_timeout wake_id=$wake_id" >&2
exit 1
