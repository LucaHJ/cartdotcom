#!/usr/bin/env bash
set -euo pipefail

platform_dir="/srv/platform"
backup_dir="/srv/backups/postgres"
timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
final_path="${backup_dir}/cartdotcom-${timestamp}.dump"
temporary_path="${final_path}.partial"

umask 077
install -d -m 0700 "${backup_dir}"
cd "${platform_dir}"

cleanup() {
  rm -f "${temporary_path}"
}
trap cleanup EXIT

docker compose exec -T postgres pg_dump \
  --username cartdotcom \
  --dbname cartdotcom \
  --format custom \
  --no-owner \
  --no-privileges >"${temporary_path}"

docker compose exec -T postgres pg_restore --list <"${temporary_path}" >/dev/null
mv "${temporary_path}" "${final_path}"
trap - EXIT

/srv/platform/scripts/upload-postgres-offsite.sh "${final_path}"

find "${backup_dir}" -type f -name 'cartdotcom-*.dump' -mtime +14 -delete
find "${backup_dir}" -type f -name 'cartdotcom-*.dump.offsite' -mtime +14 -delete
echo "Created verified PostgreSQL backup: ${final_path}"
