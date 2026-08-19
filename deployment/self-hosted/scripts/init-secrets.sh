#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd -- "${script_dir}/.." && pwd)"
secret_dir="${root_dir}/secrets"
password_file="${secret_dir}/postgres_password"
dashboard_token_file="${secret_dir}/dashboard_token"
snapshot_upload_token_file="${secret_dir}/snapshot_upload_token"
runtime_control_token_file="${secret_dir}/runtime_control_token"
offsite_backup_token_file="${secret_dir}/offsite_backup_token"

install -d -m 0700 "${secret_dir}"
if [[ ! -s "${password_file}" ]]; then
  umask 077
  openssl rand -hex 32 >"${password_file}"
  echo "Created PostgreSQL password file."
else
  echo "PostgreSQL password file already exists; leaving it unchanged."
fi

if [[ ! -s "${offsite_backup_token_file}" ]]; then
  umask 077
  openssl rand -hex 32 >"${offsite_backup_token_file}"
  echo "Created off-site backup token file."
else
  echo "Off-site backup token file already exists; leaving it unchanged."
fi

if [[ ! -s "${runtime_control_token_file}" ]]; then
  umask 077
  openssl rand -hex 32 >"${runtime_control_token_file}"
  echo "Created internal runtime control token file."
else
  echo "Internal runtime control token file already exists; leaving it unchanged."
fi

if [[ ! -s "${dashboard_token_file}" ]]; then
  umask 077
  openssl rand -hex 32 >"${dashboard_token_file}"
  echo "Created dashboard token file."
else
  echo "Dashboard token file already exists; leaving it unchanged."
fi

if [[ ! -s "${snapshot_upload_token_file}" ]]; then
  umask 077
  openssl rand -hex 32 >"${snapshot_upload_token_file}"
  echo "Created dashboard snapshot upload token file."
else
  echo "Dashboard snapshot upload token file already exists; leaving it unchanged."
fi
