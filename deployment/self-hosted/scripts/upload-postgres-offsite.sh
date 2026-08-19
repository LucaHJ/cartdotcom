#!/usr/bin/env bash
set -euo pipefail

dump_path="${1:-}"
upload_url="${OFFSITE_UPLOAD_URL:-https://cartdotcom-news-signal-container.lucajeannin.workers.dev/api/internal/offsite-object}"
token_file="/srv/platform/secrets/offsite_backup_token"

if [[ ! -f "${dump_path}" ]]; then
  echo "PostgreSQL dump does not exist: ${dump_path}" >&2
  exit 1
fi
if [[ ! -s "${token_file}" ]]; then
  echo "Off-site backup token is not configured." >&2
  exit 1
fi

dump_name="$(basename "${dump_path}")"
timestamp="${dump_name#cartdotcom-}"
timestamp="${timestamp%.dump}"
if [[ ! "${timestamp}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
  echo "Unexpected backup filename: ${dump_name}" >&2
  exit 1
fi

work_dir="/srv/backups/offsite-upload/${timestamp}"
install -d -m 0700 "${work_dir}"
cleanup() {
  find "${work_dir}" -type f -delete
  rmdir "${work_dir}" 2>/dev/null || true
}
trap cleanup EXIT

split --bytes=32M --numeric-suffixes=0 --suffix-length=4 \
  --additional-suffix='' "${dump_path}" "${work_dir}/part-"

token="$(cat "${token_file}")"
chunks_json=""
chunk_count=0
for chunk in "${work_dir}"/part-*; do
  name="$(basename "${chunk}")"
  hash="$(sha256sum "${chunk}" | awk '{print $1}')"
  bytes="$(stat -c '%s' "${chunk}")"
  curl --fail --silent --show-error --retry 5 --retry-all-errors \
    --max-time 180 \
    --request POST \
    --header "Authorization: Bearer ${token}" \
    --header "Content-Type: application/octet-stream" \
    --header "X-Object-Key: _backups/postgres/${timestamp}/${name}" \
    --header "X-Content-SHA256: ${hash}" \
    --data-binary "@${chunk}" \
    "${upload_url}" >/dev/null
  separator=""
  [[ -n "${chunks_json}" ]] && separator=","
  chunks_json="${chunks_json}${separator}{\"name\":\"${name}\",\"bytes\":${bytes},\"sha256\":\"${hash}\"}"
  chunk_count=$((chunk_count + 1))
done

dump_hash="$(sha256sum "${dump_path}" | awk '{print $1}')"
dump_bytes="$(stat -c '%s' "${dump_path}")"
manifest="${work_dir}/manifest.json"
printf '{"version":1,"created_at":"%s","dump_name":"%s","dump_bytes":%s,"dump_sha256":"%s","chunk_count":%s,"chunks":[%s]}\n' \
  "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "${dump_name}" "${dump_bytes}" "${dump_hash}" "${chunk_count}" "${chunks_json}" >"${manifest}"
manifest_hash="$(sha256sum "${manifest}" | awk '{print $1}')"

curl --fail --silent --show-error --retry 5 --retry-all-errors \
  --max-time 60 \
  --request POST \
  --header "Authorization: Bearer ${token}" \
  --header "Content-Type: application/json" \
  --header "X-Object-Key: _backups/postgres/${timestamp}/manifest.json" \
  --header "X-Content-SHA256: ${manifest_hash}" \
  --data-binary "@${manifest}" \
  "${upload_url}" >/dev/null

touch "${dump_path}.offsite"
echo "Uploaded verified PostgreSQL backup ${dump_name} in ${chunk_count} chunks."
