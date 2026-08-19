#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd -- "${script_dir}/.." && pwd)"
cd "${root_dir}"

docker compose config --quiet
docker compose ps

postgres_id="$(docker compose ps -q postgres)"
caddy_id="$(docker compose ps -q caddy)"

for container_id in "${postgres_id}" "${caddy_id}"; do
  if [[ -z "${container_id}" ]]; then
    echo "Expected platform container is missing." >&2
    exit 1
  fi
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}")"
  if [[ "${status}" != "healthy" ]]; then
    echo "Container ${container_id} is ${status}, not healthy." >&2
    exit 1
  fi
done

response="$(curl --fail --silent http://127.0.0.1:8080/health)"
[[ "${response}" == "healthy" ]]
echo "Cartdotcom platform foundation is healthy."
