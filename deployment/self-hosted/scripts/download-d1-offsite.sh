#!/usr/bin/env bash
set -euo pipefail

timestamp="${1:-}"
destination="${2:-/srv/cartdotcom/imports/cartdotcom-news-signal-${timestamp}.sql}"
download_url="${OFFSITE_DOWNLOAD_URL:-https://cartdotcom-news-signal-container.lucajeannin.workers.dev/api/internal/offsite-object}"
token_file="/srv/platform/secrets/offsite_backup_token"

if [[ ! "${timestamp}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
  echo "Usage: $0 YYYYMMDDTHHMMSSZ [destination.sql]" >&2
  exit 1
fi
if [[ ! -s "${token_file}" ]]; then
  echo "Off-site backup token is not configured." >&2
  exit 1
fi

work_dir="/srv/backups/d1-download/${timestamp}"
manifest="${work_dir}/manifest.json"
reconstructed="${work_dir}/cartdotcom-news-signal-${timestamp}.sql"
token="$(cat "${token_file}")"
umask 077
install -d -m 0700 "${work_dir}" "$(dirname "${destination}")"
cleanup() {
  find "${work_dir}" -type f -delete
  rmdir "${work_dir}" 2>/dev/null || true
}
trap cleanup EXIT

download_object() {
  local key="$1"
  local output="$2"
  local headers="${output}.headers"
  local remote_hash
  local actual_hash
  curl --fail --silent --show-error --retry 5 --retry-all-errors \
    --max-time 180 \
    --get \
    --header "Authorization: Bearer ${token}" \
    --data-urlencode "key=${key}" \
    --dump-header "${headers}" \
    --output "${output}" \
    "${download_url}"
  remote_hash="$(awk 'tolower($1) == "x-content-sha256:" {gsub(/\r/, "", $2); print $2}' "${headers}" | tail -n 1)"
  actual_hash="$(sha256sum "${output}" | awk '{print $1}')"
  rm -f "${headers}"
  if [[ ! "${remote_hash}" =~ ^[a-f0-9]{64}$ || "${remote_hash}" != "${actual_hash}" ]]; then
    echo "Stored-object integrity check failed for ${key}." >&2
    exit 1
  fi
}

download_object "_backups/d1/${timestamp}/manifest.json" "${manifest}"
mapfile -t manifest_data < <(python3 - "${manifest}" <<'PY'
import json
import re
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    manifest = json.load(handle)
if manifest.get("version") != 1 or manifest.get("backup_kind") != "d1":
    raise SystemExit("Unsupported D1 backup manifest")
chunks = manifest.get("chunks")
if not isinstance(chunks, list) or len(chunks) != manifest.get("chunk_count") or not chunks:
    raise SystemExit("D1 backup manifest has an invalid chunk list")
for index, chunk in enumerate(chunks):
    name = chunk.get("name", "")
    digest = chunk.get("sha256", "")
    size = chunk.get("bytes")
    if name != f"part-{index:04d}" or not re.fullmatch(r"[a-f0-9]{64}", digest) or not isinstance(size, int) or size <= 0:
        raise SystemExit("D1 backup manifest contains an invalid chunk")
    print(f"CHUNK\t{name}\t{size}\t{digest}")
export_size = manifest.get("export_bytes")
export_hash = manifest.get("export_sha256", "")
if not isinstance(export_size, int) or export_size <= 0 or not re.fullmatch(r"[a-f0-9]{64}", export_hash):
    raise SystemExit("D1 backup manifest has invalid export integrity fields")
print(f"EXPORT\t{export_size}\t{export_hash}")
PY
)

expected_bytes=""
expected_hash=""
chunk_paths=()
for row in "${manifest_data[@]}"; do
  IFS=$'\t' read -r kind field1 field2 field3 <<<"${row}"
  if [[ "${kind}" == "EXPORT" ]]; then
    expected_bytes="${field1}"
    expected_hash="${field2}"
    continue
  fi
  chunk_path="${work_dir}/${field1}"
  download_object "_backups/d1/${timestamp}/${field1}" "${chunk_path}"
  if [[ "$(stat -c '%s' "${chunk_path}")" != "${field2}" || "$(sha256sum "${chunk_path}" | awk '{print $1}')" != "${field3}" ]]; then
    echo "Integrity check failed for ${field1}." >&2
    exit 1
  fi
  chunk_paths+=("${chunk_path}")
done

cat "${chunk_paths[@]}" >"${reconstructed}"
if [[ "$(stat -c '%s' "${reconstructed}")" != "${expected_bytes}" || "$(sha256sum "${reconstructed}" | awk '{print $1}')" != "${expected_hash}" ]]; then
  echo "Reconstructed D1 export failed its complete integrity check." >&2
  exit 1
fi
mv "${reconstructed}" "${destination}"
echo "Downloaded and verified D1 export at ${destination} (${expected_bytes} bytes)."
