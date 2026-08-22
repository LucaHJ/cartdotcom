# Phase 5 inert Reel runner image

This directory packages a dedicated Ubuntu/server-side runtime for the exact
one-job Phase 5 runner. It is intentionally inert:

- the Compose service is under the `phase5-runner` profile;
- `restart` is disabled;
- no selector, scheduler, claim loop, or enabled execution path is installed;
- the existing Codex `auth.json` is mounted read-only at `/codex-auth/auth.json`
  and linked into a writable tmpfs `CODEX_HOME`;
- native PostgreSQL control uses the internal `cartdotcom-data` network and a
  read-only password-file mount at `/run/secrets/postgres_password`;
- Worker exact-control auth must use a read-only token file at
  `/run/secrets/phase5_admin_token`; no production token file is created by
  this image or stored in Compose;
- the Docker socket, Docker CLI, SSH client, and privileged capabilities are not
  required by the container-native path;
- Instagram credentials are not part of normal startup.

The default command is a redacted readiness probe:

```bash
docker compose --profile phase5-runner run --rm --no-deps phase5-runner inert-health
```

Additional no-live readiness probes:

```bash
docker compose --profile phase5-runner run --rm --no-deps phase5-runner native-control
docker compose --profile phase5-runner run --rm --no-deps phase5-runner fake-worker-control
docker compose --profile phase5-runner run --rm --no-deps phase5-runner control-fail-closed
```

Live local processing still requires a separate exact, confirmed invocation of
`/opt/reel/phase5_one_job_runner.py` for one fenced job. This image must not be
used for backlog or general worker execution.
