# Phase 5 inert Reel runner runtime

This directory packages the dedicated Ubuntu/server-side runtime for the exact
one-job Phase 5 runner. It is intentionally inert and split across two
profile-gated service roles:

- `phase5-control` performs exact-job control/reconciliation only;
- `phase5-compute` performs media/Codex work only;
- both services are under the `phase5-runner` profile;
- `restart` is disabled;
- no selector, scheduler, claim loop, or enabled execution path is installed;
- the existing Codex `auth.json` is mounted read-only only into
  `phase5-compute` at `/codex-auth/auth.json` and linked into a writable tmpfs
  `CODEX_HOME`;
- native PostgreSQL control uses the internal `cartdotcom-data` network only
  from `phase5-control`, with a read-only password-file mount at
  `/run/control-secrets/postgres_password`;
- Worker exact-control auth must use a read-only token file only in
  `phase5-control` at `/run/control-secrets/phase5_admin_token`; no production
  token file is created by this image or stored in Compose;
- `phase5-compute` has no PostgreSQL password, no Worker admin token, no
  `REEL_PHASE5_PG_*` environment, and no `cartdotcom-data` network;
- the Docker socket, Docker CLI, SSH client, and privileged capabilities are not
  required by the container-native path;
- Instagram credentials are not part of normal startup.

The default command is a redacted readiness probe:

```bash
docker compose --profile phase5-runner run --rm --no-deps phase5-control inert-health
docker compose --profile phase5-runner run --rm --no-deps phase5-compute inert-health
```

Additional no-live readiness probes:

```bash
docker compose --profile phase5-runner run --rm --no-deps phase5-control native-control
docker compose --profile phase5-runner run --rm --no-deps phase5-control fake-worker-control
docker compose --profile phase5-runner run --rm --no-deps phase5-control control-fail-closed
docker compose --profile phase5-runner run --rm --no-deps phase5-control control-secret-canary
docker compose --profile phase5-runner run --rm --no-deps phase5-compute compute-secret-canary
docker compose --profile phase5-runner run --rm --no-deps phase5-compute fixture-media
```

Live local processing still requires a host-side exact, confirmed one-shot
wrapper that invokes control, then compute, then control-finalize for one fenced
job. These services must not be used for backlog or general worker execution.
