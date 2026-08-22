# Phase 5C inert Ubuntu Reel runtime gate report

Status: ready for independent review; Phase 6 not started.

Timestamp: 2026-08-22T16:21:00+10:00

## Scope

This gate built and proved an inert Ubuntu/server-side runtime for future exact one-job Phase 5 pilots. It remains no-live.

Explicitly not performed:

- no Phase 5 pre-intake arm;
- no live Reel, carousel, retrieval, note, or backlog processing;
- no local production claim or execution;
- no publication, reaction, Instagram outbound, D1 mutation, R2 write, or KV write;
- no Cloudflare authority change;
- no credential creation, rotation, copying, plaintext inspection, or exposure;
- no paid resource creation;
- no Phase 6 work.

Cloudflare remains the sole general production authority.

## Supervisor blockers corrected

1. `e42cb63100b55302416e616e53d369b0d31477e9` replaced the workstation-only local PostgreSQL path with a container-native psycopg path and exact control probes.
2. `aff756d` corrected the remaining security defect: control-plane secrets are no longer mounted into the same service boundary that runs Codex/media.

The runtime is now split into two profile-gated service roles:

- `phase5-control`: exact-job control/reconciliation only. It has native PostgreSQL access, the control secret mount, and the internal data network. It has no Codex auth mount and blanks the inherited Codex/processor defaults.
- `phase5-compute`: media/Codex only. It has the read-only Codex auth mount and egress. It has no PostgreSQL password, no Worker admin token reference, no `REEL_PHASE5_PG*` env, and no `cartdotcom-data` network.

The old monolithic `phase5_one_job_runner.py` also now fails closed if invoked in the `phase5-control` role and attempts to load the media/Codex processor.

## Commits and deployment state

- Initial runtime/source commit: `2f9f8e4a843ac994f53aa6836a4f406e4380a835`.
- Native-control correction commit: `e42cb63100b55302416e616e53d369b0d31477e9`.
- Split-boundary security correction commit: `aff756d`.
- Worker deployment: unchanged from Phase 5B; no Worker deploy was required for this gate.
- Server project path: `/srv/cartdotcom/instagram-reel-brain`.
- Final control image: `cartdotcom-instagram-reel-brain-phase5-control:latest`
  - ID: `sha256:a69e4104f873fa11ac84bf165d0c1881f6821c19896e3b16c79ef7b31a449305`
  - size: `443618722` bytes
  - created: `2026-08-22T06:20:17.131858597Z`
- Final compute image: `cartdotcom-instagram-reel-brain-phase5-compute:latest`
  - ID: `sha256:27781d361c78ea5bb53180073b397bb1a615246a7faeafdef8a71af8caa7c475`
  - size: `443618722` bytes
  - created: `2026-08-22T06:20:17.131858597Z`
- Runtime service state after tests: no Phase 5 control/compute container is running.

Build command:

```bash
cd /srv/cartdotcom/instagram-reel-brain
docker compose --profile phase5-runner build --quiet phase5-control phase5-compute
```

## Files changed

Runtime and configuration:

- `deployment/instagram-reel-brain/container/app.py`
- `deployment/self-hosted/instagram-reel-brain/.env.example`
- `deployment/self-hosted/instagram-reel-brain/compose.yaml`
- `deployment/self-hosted/instagram-reel-brain/phase5-runner/README.md`
- `deployment/self-hosted/instagram-reel-brain/phase5-runner/container/app.py`
- `deployment/self-hosted/instagram-reel-brain/phase5-runner/phase5_runner_probe.py`
- `deployment/self-hosted/instagram-reel-brain/scripts/phase5_one_job_runner.py`

Tests:

- `deployment/self-hosted/instagram-reel-brain/tests/phase5-pilot.test.mjs`
- `deployment/self-hosted/instagram-reel-brain/tests/phase5-runtime.test.mjs`
- `deployment/self-hosted/instagram-reel-brain/tests/scaffold-config.test.mjs`

No unrelated News or price-watch working-tree changes were staged or committed.

## Runtime design

Both Phase 5 services are under the `phase5-runner` profile and remain stopped/inert:

- `restart: "no"`;
- no selector, scheduler, claim loop, or enabled execution path;
- no host ports;
- no `cartdotcom-edge` membership;
- read-only root filesystem;
- writable tmpfs only for `/work`, `/tmp`, and `/home/node`;
- no Docker socket;
- no privileged mode;
- `no-new-privileges:true`;
- all normal Reel execution/mutation flags remain false.

Resource ceilings with both stopped profile services included:

- existing six Reel services: `1.85` CPU / `1760 MiB`;
- `phase5-control`: `0.05` CPU / `128 MiB`;
- `phase5-compute`: `0.10` CPU / `640 MiB`;
- total: `2.00` CPU / `2528 MiB`, still under the approved `2 CPU` / `2.5 GiB` ceiling.

## Credential and boundary handling

Control:

- native PostgreSQL path uses a read-only password file mounted only into `phase5-control`;
- the observed mounted file metadata was mode `0600`, uid `1000`, gid `987`, size `65` bytes;
- the password is read by psycopg setup only and is not placed in argv, environment for Codex, logs, checkpoints, Git, or image layers;
- Worker exact-control auth remains token-file-only for real use, but no real Phase 5/admin Worker token file exists on the server and none was created or mounted in this gate;
- synthetic Worker-token files were generated per run inside probes only.

Compute:

- Codex auth is mounted read-only only into `phase5-compute`;
- final auth probe showed `auth.json` mode `0600`, uid/gid `1000/1000`, size `3832`, symlinked into tmpfs `CODEX_HOME`;
- `phase5-compute` had no control secret env and no control secret paths present;
- no Instagram credentials/cookies are present; the runner now passes an empty cookie payload and does not read `INSTAGRAM_COOKIES_JSON`.

Processor defence-in-depth:

- `run_codex()` and `probe_codex_auth()` now call `codex_subprocess_env()`;
- Codex subprocesses receive only a minimal allowlist (`CODEX_HOME`, `HOME`, `PATH` in the server canary);
- runtime `REEL_PHASE5_*`, token-file, database, cookie, and other secret-adjacent env values are not inherited by Codex.

## Server probes

All probes were run from `/srv/cartdotcom/instagram-reel-brain`.

Control boundary:

- `docker compose --profile phase5-runner run --rm --no-deps phase5-control inert-health`: passed. Control role has control env/path metadata and no Codex auth.
- `phase5-control native-control`: passed. It created only isolated schema `reel_phase5c_runtime_probe_*`, exercised native PG dry-run, processing restart visibility, rollback, and dropped the schema. Secret path was redacted from output.
- `phase5-control fake-worker-control`: passed. Local fake Worker accepted start/finalize/abort only with a per-run synthetic 0600 token file; missing token failed closed.
- `phase5-control control-fail-closed`: passed. Missing PG file and incorrect Worker token failed closed before processor import; checkpoint stopped at `idempotency_key_minted`; `processor_loaded=false`.
- `phase5-control control-secret-canary`: passed. Parent control step could read per-run fake PG/admin secret files; output contained hashes only, with `secret_values_redacted=true` and `secret_paths_redacted=true`.

Compute boundary:

- `docker compose --profile phase5-runner run --rm --no-deps phase5-compute inert-health`: passed. Compute role had Codex auth and no control env/paths.
- `phase5-compute compute-secret-canary --codex-boundary --timeout 180`: passed. Control-secret env and paths were absent; a spawned shell could not stat/read/hash control secret paths; Codex executed successfully with no secret markers in prompt, argv, environment, or output.
- `phase5-compute fixture-media`: passed. Local synthetic MP4 generated and inspected; ffprobe streams `2`; audio bytes `49300`; frame count `1`; video bytes `42827`; fake Codex synthesis returned the fixture summary; no network/callback/publication/production credentials used.
- `phase5-compute codex-smoke --timeout 180`: passed. Codex CLI auth usable through compute-only auth mount. Usage: input `12183`, cached input `8960`, output `5`, reasoning output `0`, stdout lines `4`.

## Test evidence

Local/self-hosted:

- `python -m py_compile scripts\phase5_one_job_runner.py phase5-runner\phase5_runner_probe.py`: passed.
- `docker compose -f compose.yaml config --quiet`: passed.
- `npm test` in `deployment/self-hosted/instagram-reel-brain`: 60 passed, 1 expected Windows symlink skip.
- `python tests\test_media_processor_api.py`: 3 passed.
- `python tests\test_phase4_shadow_mirror.py`: 9 passed.
- `python tests\test_phase4_shadow_mirror_connected.py`: 5 passed.

Cloud Reel regression:

- `npm run typecheck`: passed.
- `npm test`: 96/96 passed.
- `python -m unittest container.test_app -v`: 9/9 passed.

Ubuntu/server:

- `docker compose -f compose.yaml config --quiet`: passed.
- Static runtime/config tests inside the built image with `--network none`: 14 passed, 1 expected skip for the sibling cloud processor path absent in the isolated server copy.
- Full no-live server probes listed above: passed.

## Secret and image scans

Final server scans covered both final images:

- image config: no matches;
- image history: no matches;
- packaged `/opt/reel`: no matches.

Patterns scanned included fixed canary values, credential-shaped literals, Instagram token/cookie variable names, and exact control-secret path strings:

- `synthetic-postgres-control-secret`
- `synthetic-worker-control-secret`
- `synthetic-secret-value`
- `incorrect-synthetic-token`
- `synthetic-phase5-admin-token`
- `sk-*` style OpenAI key patterns
- `Bearer ...` token patterns
- `INSTAGRAM_ACCESS_TOKEN`
- `INSTAGRAM_COOKIES`
- `INSTAGRAM_COOKIES_JSON`
- exact control-secret path strings

The final scan output was only:

```text
IMAGE:control
IMAGE:compute
```

No generated fixture media, Codex output, synthetic Worker token, PostgreSQL password, Worker admin token, or credential material was committed.

## Production and health checks

Cloudflare Worker `/health`:

```json
{
  "ok": true,
  "service": "cartdotcom-instagram-reel-brain",
  "ingest_mode": "live",
  "backlog_processing": false,
  "model": "gpt-5.6-luna"
}
```

D1 idle check:

- `active_jobs`: 0
- `active_phase5_fences`: 0
- `active_arms`: 0
- `backlog_jobs`: 0
- D1 metadata: `changed_db=false`, `rows_written=0`.

Server health:

- Reel services: all six existing services healthy;
- News services: all healthy;
- Caddy: healthy;
- PostgreSQL: healthy;
- no active Phase 5 control/compute containers after probes;
- memory: 15 GiB total, 13 GiB available;
- swap: 4.0 GiB total, 14 MiB used;
- disk `/`: 349 GiB total, 306 GiB available, 8% used.

## Rollback / removal

Non-destructive rollback:

```bash
cd /srv/cartdotcom/instagram-reel-brain
docker compose --profile phase5-runner ps -a
docker compose --profile phase5-runner rm -f phase5-control phase5-compute
docker image rm cartdotcom-instagram-reel-brain-phase5-control:latest
docker image rm cartdotcom-instagram-reel-brain-phase5-compute:latest
```

Source rollback if independent review rejects the correction:

```bash
git revert aff756d
```

Then copy the reverted `deployment/self-hosted/instagram-reel-brain` files back to `/srv/cartdotcom/instagram-reel-brain`.

This rollback does not touch Cloudflare authority, D1/R2/KV, Instagram, News runtime, production data, or credentials.

## Remaining risks / next gate

- Real exact Worker control from Ubuntu remains blocked because no approved Phase 5/admin Worker token file exists on the server. Do not create/install it until supervisor asks for explicit user approval.
- A full live job has not been run in the split runtime. This gate proves inert split-boundary readiness only.
- The services still have no selector, scheduler, claim loop, live arm, backlog access, or general local authority.
- Phase 6 remains blocked.
