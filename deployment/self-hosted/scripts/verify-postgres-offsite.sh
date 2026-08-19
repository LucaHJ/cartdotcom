#!/usr/bin/env bash
set -euo pipefail

timestamp="${1:-}"
download_url="${OFFSITE_DOWNLOAD_URL:-https://cartdotcom-news-signal-container.lucajeannin.workers.dev/api/internal/offsite-object}"
token_file="/srv/platform/secrets/offsite_backup_token"

if [[ ! "${timestamp}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
  echo "Usage: $0 YYYYMMDDTHHMMSSZ" >&2
  exit 1
fi
if [[ ! -s "${token_file}" ]]; then
  echo "Off-site backup token is not configured." >&2
  exit 1
fi

work_dir="/srv/backups/offsite-verify/${timestamp}"
manifest="${work_dir}/manifest.json"
reconstructed="${work_dir}/cartdotcom-${timestamp}.dump"
token="$(cat "${token_file}")"
umask 077
install -d -m 0700 "${work_dir}"
cleanup() {
  find "${work_dir}" -type f -delete
  rmdir "${work_dir}" 2>/dev/null || true
}
trap cleanup EXIT

download_object() {
  local key="$1"
  local destination="$2"
  local headers="${destination}.headers"
  local remote_hash
  local actual_hash
  curl --fail --silent --show-error --retry 5 --retry-all-errors \
    --max-time 180 \
    --get \
    --header "Authorization: Bearer ${token}" \
    --data-urlencode "key=${key}" \
    --dump-header "${headers}" \
    --output "${destination}" \
    "${download_url}"
  remote_hash="$(awk 'tolower($1) == "x-content-sha256:" {gsub(/\r/, "", $2); print $2}' "${headers}" | tail -n 1)"
  actual_hash="$(sha256sum "${destination}" | awk '{print $1}')"
  rm -f "${headers}"
  if [[ ! "${remote_hash}" =~ ^[a-f0-9]{64}$ || "${remote_hash}" != "${actual_hash}" ]]; then
    echo "Stored-object integrity check failed for ${key}." >&2
    exit 1
  fi
}

download_object "_backups/postgres/${timestamp}/manifest.json" "${manifest}"
mapfile -t manifest_data < <(python3 - "${manifest}" "${timestamp}" <<'PY'
import json
import re
import sys

path, timestamp = sys.argv[1:]
with open(path, "r", encoding="utf-8") as handle:
    manifest = json.load(handle)
if manifest.get("version") != 1:
    raise SystemExit("Unsupported off-site backup manifest version")
if manifest.get("dump_name") != f"cartdotcom-{timestamp}.dump":
    raise SystemExit("Off-site backup manifest name does not match the requested timestamp")
chunks = manifest.get("chunks")
if not isinstance(chunks, list) or len(chunks) != manifest.get("chunk_count") or not chunks:
    raise SystemExit("Off-site backup manifest has an invalid chunk list")
seen = set()
for index, chunk in enumerate(chunks):
    name = chunk.get("name", "")
    digest = chunk.get("sha256", "")
    size = chunk.get("bytes")
    if name != f"part-{index:04d}" or not re.fullmatch(r"[a-f0-9]{64}", digest) or not isinstance(size, int) or size <= 0:
        raise SystemExit("Off-site backup manifest contains an invalid chunk")
    if name in seen:
        raise SystemExit("Off-site backup manifest contains duplicate chunks")
    seen.add(name)
    print(f"CHUNK\t{name}\t{size}\t{digest}")
dump_size = manifest.get("dump_bytes")
dump_hash = manifest.get("dump_sha256", "")
if not isinstance(dump_size, int) or dump_size <= 0 or not re.fullmatch(r"[a-f0-9]{64}", dump_hash):
    raise SystemExit("Off-site backup manifest has invalid dump integrity fields")
print(f"DUMP\t{dump_size}\t{dump_hash}")
PY
)

expected_dump_bytes=""
expected_dump_hash=""
chunk_paths=()
for row in "${manifest_data[@]}"; do
  IFS=$'\t' read -r kind field1 field2 field3 <<<"${row}"
  if [[ "${kind}" == "DUMP" ]]; then
    expected_dump_bytes="${field1}"
    expected_dump_hash="${field2}"
    continue
  fi
  chunk_name="${field1}"
  expected_bytes="${field2}"
  expected_hash="${field3}"
  chunk_path="${work_dir}/${chunk_name}"
  download_object "_backups/postgres/${timestamp}/${chunk_name}" "${chunk_path}"
  actual_bytes="$(stat -c '%s' "${chunk_path}")"
  actual_hash="$(sha256sum "${chunk_path}" | awk '{print $1}')"
  if [[ "${actual_bytes}" != "${expected_bytes}" || "${actual_hash}" != "${expected_hash}" ]]; then
    echo "Integrity check failed for ${chunk_name}." >&2
    exit 1
  fi
  chunk_paths+=("${chunk_path}")
done

if [[ ${#chunk_paths[@]} -eq 0 || -z "${expected_dump_bytes}" || -z "${expected_dump_hash}" ]]; then
  echo "Off-site backup manifest did not produce a complete restore plan." >&2
  exit 1
fi

cat "${chunk_paths[@]}" >"${reconstructed}"
actual_dump_bytes="$(stat -c '%s' "${reconstructed}")"
actual_dump_hash="$(sha256sum "${reconstructed}" | awk '{print $1}')"
if [[ "${actual_dump_bytes}" != "${expected_dump_bytes}" || "${actual_dump_hash}" != "${expected_dump_hash}" ]]; then
  echo "Reconstructed off-site dump failed its complete integrity check." >&2
  exit 1
fi

cd /srv/platform
docker compose exec -T postgres pg_restore --list <"${reconstructed}" >/dev/null
echo "Verified complete off-site PostgreSQL backup cartdotcom-${timestamp}.dump (${actual_dump_bytes} bytes)."
