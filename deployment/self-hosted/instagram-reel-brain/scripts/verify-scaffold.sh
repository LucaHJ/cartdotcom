#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd -- "${script_dir}/.." && pwd)"
cd "${root_dir}"

docker compose config --quiet

expected_services=(
  reel-api
  reel-dispatcher
  reel-worker
  reel-publisher
  reel-archiver
  reel-auth-rotator
)

for service in "${expected_services[@]}"; do
  container_id="$(docker compose ps -q "${service}")"
  if [[ -z "${container_id}" ]]; then
    echo "Missing container for ${service}" >&2
    exit 1
  fi

  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}")"
  if [[ "${status}" != "healthy" ]]; then
    echo "${service} is ${status}, not healthy" >&2
    exit 1
  fi

  docker compose exec -T "${service}" node -e "
    fetch('http://127.0.0.1:' + process.env.PORT + '/healthz')
      .then((response) => response.json())
      .then((payload) => {
        const enabled = payload.enabled || {};
        const enabledKeys = Object.entries(enabled).filter(([, value]) => value !== 'false');
        if (payload.phase !== 'phase1-inert') throw new Error('unexpected phase');
        if (payload.authority !== 'cloud') throw new Error('unexpected authority');
        if (payload.workerConcurrency !== 1) throw new Error('unexpected concurrency');
        if (enabledKeys.length) throw new Error('unexpected enabled flags: ' + JSON.stringify(enabledKeys));
      });
  "
done

if docker compose config | grep -E 'published:|127\.0\.0\.1|cartdotcom-edge|cartdotcom-data' >/dev/null; then
  echo "Scaffold config exposes host/shared networking unexpectedly." >&2
  exit 1
fi

echo "Instagram Reel Brain Phase 1 scaffold is inert and healthy."
