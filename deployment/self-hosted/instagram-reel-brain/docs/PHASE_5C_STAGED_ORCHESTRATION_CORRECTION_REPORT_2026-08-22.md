# Phase 5C staged orchestration correction gate report

Status: ready for independent supervisor review; Phase 6 not started.

Timestamp: 2026-08-22T17:08:20.6600469+10:00

Commit: `db79057`

## Scope

This correction finishes only the Phase 5C staged-orchestration gate. It adds a runnable host-side exact one-shot wrapper and staged control/compute/finalize commands for the already split, inert Ubuntu runtime.

Explicitly not performed:

- no Phase 5 pre-intake arm;
- no live Reel, carousel, retrieval, note, or backlog processing;
- no local production claim or execution;
- no production D1/R2/KV mutation;
- no publication, reaction, Instagram outbound action, or Pages publish;
- no Worker deploy or Cloudflare authority change;
- no Phase 5/admin Worker token creation, rotation, installation, or plaintext inspection;
- no paid resource creation;
- no Phase 6 work.

Cloudflare remains the sole general production authority.

## Supervisor blocker corrected

The previous split-control/compute runtime was secure but not operational: `phase5-control` could not load the processor, `phase5-compute` had no PostgreSQL/admin-token control access, and no host wrapper existed to run control -> compute -> control-finalize while preserving crash/restart semantics.

This correction adds:

- `scripts/phase5_staged_runner.py`, copied into the Phase 5 image as `/opt/reel/phase5_staged_runner.py`, with explicit staged commands:
  - `control-start`
  - `compute-run`
  - `control-finalize`
  - `control-abort`
  - `synthetic-init`
  - `synthetic-drop`
  - `status`
- `scripts/phase5_one_job_orchestrator.py`, a host-side wrapper that contains no production credential values and invokes `phase5-control`, then `phase5-compute`, then `phase5-control` again through `docker compose run --rm --no-deps --entrypoint python3`.
- a private per-job checkpoint protocol with `CHECKPOINT_VERSION = 1`, mode `0700` parent directories, mode `0600` checkpoint files, atomic writes, exact `pilot_key`/`job_id`/`source_message_id`/`lease_owner` binding, monotonic stages, and fail-closed tamper checks.
- checkpoint-stage-aware restart logic: after processor completion or cloud finalize, the wrapper skips earlier stages and resumes forward, preventing duplicate Codex/publication/reaction/finalize work.
- synthetic-only fake Worker orchestration over the Docker network gateway, not `--add-host`, Docker socket, privileged containers, or host networking.

## Files changed

Runtime/source:

- `deployment/self-hosted/instagram-reel-brain/scripts/phase5_staged_runner.py`
- `deployment/self-hosted/instagram-reel-brain/scripts/phase5_one_job_orchestrator.py`
- `deployment/self-hosted/instagram-reel-brain/phase5-runner/Dockerfile`
- `deployment/self-hosted/instagram-reel-brain/phase5-runner/README.md`

Tests:

- `deployment/self-hosted/instagram-reel-brain/tests/phase5-pilot.test.mjs`
- `deployment/self-hosted/instagram-reel-brain/tests/phase5-runtime.test.mjs`

Docs/state:

- `deployment/self-hosted/instagram-reel-brain/docs/PHASE_5C_STAGED_ORCHESTRATION_CORRECTION_REPORT_2026-08-22.md`
- `deployment/self-hosted/instagram-reel-brain/docs/INSTAGRAM_REEL_MIGRATION_STATE.md`
- `deployment/self-hosted/instagram-reel-brain/docs/CHANGELOG.md`
- `Vault/10-Projects/Instagram-Reels-Research-System/Project.md`
- `Vault/10-Projects/Instagram-Reels-Research-System/Development-History/cloud-pipeline/index.md`
- `Vault/10-Projects/Instagram-Reels-Research-System/Development-History/cloud-pipeline/2026-08-22_17-08-20_phase5c-staged-orchestration.md`

No unrelated News or price-watch files were staged or committed.

## Server deployment state

Server project path: `/srv/cartdotcom/instagram-reel-brain`.

Copied to server:

- `/srv/cartdotcom/instagram-reel-brain/scripts/phase5_staged_runner.py`
- `/srv/cartdotcom/instagram-reel-brain/scripts/phase5_one_job_orchestrator.py`
- `/srv/cartdotcom/instagram-reel-brain/phase5-runner/Dockerfile`
- `/srv/cartdotcom/instagram-reel-brain/phase5-runner/README.md`
- `/srv/cartdotcom/instagram-reel-brain/tests/phase5-runtime.test.mjs`
- `/srv/cartdotcom/instagram-reel-brain/tests/phase5-pilot.test.mjs`

Final server file hashes:

```text
e876fbed337e0612038e6ddbadb411ed80a1b052fb726691fb6280345bba9a2d  /srv/cartdotcom/instagram-reel-brain/scripts/phase5_staged_runner.py
70c99754cdfa168b257237854dc0a0d87fed6dd435186da24f527801c7006e04  /srv/cartdotcom/instagram-reel-brain/scripts/phase5_one_job_orchestrator.py
d05b7ba8e392624828eddab63dc37bc7b815468982ccbe5860d1bac757f22c7a  /srv/cartdotcom/instagram-reel-brain/phase5-runner/Dockerfile
1b71072f31e7a3f1a588d968e8f2ca9bf0970b29788901cb4643f0541cf79fb5  /srv/cartdotcom/instagram-reel-brain/phase5-runner/README.md
49f49f4fb9db6bb576d2c63db57e04278f65adf3bf9bac6d57895ae8017065bd  /srv/cartdotcom/instagram-reel-brain/tests/phase5-runtime.test.mjs
6c7b26fd5701abc90f249f904dab2c4261a5ef8db9ff2c0e9a35fa96091049e8  /srv/cartdotcom/instagram-reel-brain/tests/phase5-pilot.test.mjs
```

Final image identities after the correction:

```text
cartdotcom-instagram-reel-brain-phase5-control:latest sha256:cdeaa4c2c92e9ece8e16d6532cabd447d99fc9f715a6cb641968ece4ec8b51b7 443632338 bytes
cartdotcom-instagram-reel-brain-phase5-compute:latest sha256:ec0e8a1585051f75eef8afe5bb884afbde6e4ef73d3af23803fbbbd524e2070b 443632338 bytes
```

Runtime state after verification: no `phase5-control` or `phase5-compute` container running.

## Ubuntu staged synthetic proof

Command:

```bash
cd /srv/cartdotcom/instagram-reel-brain
python3 scripts/phase5_one_job_orchestrator.py \
  --synthetic-case all \
  --project-dir /srv/cartdotcom/instagram-reel-brain \
  --pilot-key fixture-pilot \
  --job-id fixture-job \
  --source-message-id fixture-message \
  --use-fake-codex \
  --container-timeout 600 \
  --timeout-seconds 600
```

Result: `ok=true`.

Covered synthetic cases:

- `complete`: control -> compute -> finalize completed.
- `after-start`: restart resumed from `ready_for_compute`.
- `after-compute`: restart skipped compute and finalized.
- `after-processor-before-checkpoint`: restart called control reconciliation, detected `processor_already_complete`, skipped compute, and finalized.
- `after-cloud-finalize-before-local-complete`: restart skipped start/compute and forward-finalized local completion.
- `duplicate`: second invocation skipped start/compute/finalize and returned status only.
- `short-authority`: stopped with `compute_calls=0`.
- `compute-failure-abort`: exact pre-publication abort rolled back.
- `tampered-checkpoint`: failed closed.

Two no-live defects were found and corrected during this gate:

1. Docker Compose v5.5 rejected `docker compose run --add-host`; the wrapper now discovers `cartdotcom-reel-egress` gateway through `docker network inspect` and uses that only for the synthetic fake Worker URL.
2. psycopg rejected multi-statement prepared SQL in the synthetic schema setup; the synthetic init path now executes one statement per call.

## Tests and probes

Local/self-hosted:

```text
npm test
tests 63; pass 62; skipped 1 expected Windows symlink skip; fail 0

python -m py_compile scripts\phase5_staged_runner.py scripts\phase5_one_job_orchestrator.py scripts\phase5_one_job_runner.py phase5-runner\phase5_runner_probe.py phase5-runner\container\app.py
passed
```

Cloud Reel regression:

```text
npm run typecheck
passed

npm test
96/96 passed

python -m unittest container.test_app
9/9 passed
```

Ubuntu/server:

```text
python3 -m py_compile scripts/phase5_staged_runner.py scripts/phase5_one_job_orchestrator.py scripts/phase5_one_job_runner.py phase5-runner/phase5_runner_probe.py
passed

docker compose --profile phase5-runner build phase5-control phase5-compute
passed

docker compose --profile phase5-runner run --rm --no-deps phase5-control inert-health
passed

docker compose --profile phase5-runner run --rm --no-deps phase5-compute inert-health
passed

docker compose --profile phase5-runner run --rm --no-deps phase5-compute compute-secret-canary --codex-boundary --timeout 180
passed; Codex boundary executed, returncode 0, marker_leak_in_output=false

docker compose --profile phase5-runner run --rm --no-deps phase5-compute tool-versions
passed; codex-cli 0.147.0, Python 3.11.2, ffmpeg/ffprobe 5.1.9, gallery-dl 1.32.9, yt-dlp 2026.07.04, psycopg 3.2.9

docker compose --profile phase5-runner run --rm --no-deps phase5-compute fixture-media
passed; network_free=true, frame_count=1, audio_bytes=49300, video_bytes=42827
```

The Ubuntu host does not have host `npm`, so Node source-tree tests were run on the workstation source checkout. The actual Ubuntu runtime was validated through the built Docker images and staged synthetic E2E path.

## Secret and isolation evidence

- `phase5-control` inert health: control env/path metadata present; no Codex auth mount.
- `phase5-compute` inert health: Codex auth mount present and read-only; no control env/paths.
- `compute-secret-canary --codex-boundary`: Codex boundary executed; `codex_env_keys` were only `CODEX_HOME`, `HOME`, and `PATH`; control secret env/paths absent; spawned shell could not stat/read/hash control secret paths; no marker leak in output.
- Final image `/opt/reel` scan found no matches for credential-shaped literals or production secret markers:
  - `sk-*`
  - `Bearer ...`
  - `INSTAGRAM_ACCESS_TOKEN`
  - `CLOUDFLARE_API_TOKEN`
  - `PGPASSWORD`
- Final image history scan found no matches for the same patterns.
- No production Phase 5/admin Worker token file was created or mounted.

## Production and health state

Cloudflare `/health`:

```json
{
  "ok": true,
  "service": "cartdotcom-instagram-reel-brain",
  "ingest_mode": "live",
  "backlog_processing": false,
  "model": "gpt-5.6-luna"
}
```

Remote D1 read-only idle check:

```text
jobs_active: 0
active_phase5_fences: 0
armed_phase5_captures: 0
rows_written: 0
changed_db: false
```

Server health:

- Reel containers: all six healthy.
- News containers: all healthy.
- Caddy: healthy.
- PostgreSQL: healthy.
- Phase 5 control/compute one-off containers: none running.
- Synthetic PostgreSQL schemas matching `reel_phase5c_staged_%`: 0.
- Host resources after verification: normal; Docker stats showed no material News degradation.

## Rollback / cleanup

No Cloudflare deployment, credential, production data, or authority change occurred.

Non-destructive runtime cleanup:

```bash
cd /srv/cartdotcom/instagram-reel-brain
docker compose --profile phase5-runner ps -a
docker compose --profile phase5-runner rm -f phase5-control phase5-compute
docker image rm cartdotcom-instagram-reel-brain-phase5-control:latest
docker image rm cartdotcom-instagram-reel-brain-phase5-compute:latest
```

Source rollback after the final commit:

```bash
git revert db79057
```

Then copy the reverted scoped files back to `/srv/cartdotcom/instagram-reel-brain`. This does not touch Cloudflare, D1/R2/KV, Instagram, News runtime, production data, or credentials.

## Remaining risks / next gate

- Live Ubuntu execution remains blocked because no approved Phase 5/admin Worker token file exists on the server.
- No live job was run in the split staged runtime in this gate.
- The runtime remains profile-gated, stopped, and has no selector, scheduler, claim loop, arm, backlog access, or general local authority.
- Phase 6 remains blocked.
