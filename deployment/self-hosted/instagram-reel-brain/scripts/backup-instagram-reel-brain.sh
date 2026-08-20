#!/usr/bin/env bash
set -euo pipefail

backup_root="${REEL_BACKUP_ROOT:-/srv/backups/instagram-reel-brain}"
data_root="${REEL_DATA_ROOT:-/srv/cartdotcom/reel-brain-data}"
timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
backup_path="${backup_root}/phase1-scaffold-${timestamp}.tar.gz"
temporary_path="${backup_path}.partial"

umask 077
install -d -m 0700 "${backup_root}"

cleanup() {
  rm -f "${temporary_path}"
}
trap cleanup EXIT

tar \
  --create \
  --gzip \
  --file "${temporary_path}" \
  --directory / \
  --ignore-failed-read \
  srv/cartdotcom/instagram-reel-brain \
  "${data_root#/}" 2>/tmp/reel-brain-backup-warnings.log

gzip --test "${temporary_path}"
mv "${temporary_path}" "${backup_path}"
trap - EXIT

find "${backup_root}" -type f -name 'phase1-scaffold-*.tar.gz' -mtime +14 -delete
echo "Created Instagram Reel Brain scaffold backup: ${backup_path}"
