# Phase 5C inert Ubuntu Reel runtime gate report

Status: ready for independent review; Phase 6 not started.

Timestamp: 2026-08-22T15:32:23+10:00

Correction timestamp: 2026-08-22T15:50:00+10:00

## Scope

This gate built and proved a dedicated, inert Ubuntu/server-side Reel media/Codex runtime for future exact one-job Phase 5 pilots.

Supervisor review of the first submission found one runtime blocker: the
packaged one-shot runner still used a workstation-oriented
`ssh ... docker exec ... psql` local PostgreSQL path, while the dedicated image
did not contain SSH, Docker, or psql and had no local control-plane secret
references. This corrective pass replaced that dependency with a
container-native PostgreSQL path and added no-live control-plane probes.

Explicitly not performed:

- no Phase 5 pre-intake arm;
- no live Reel, carousel, retrieval, note, or backlog processing;
- no local production claim or execution;
- no publication, reaction, Instagram outbound, D1 mutation, R2 write, or KV write;
- no Cloudflare authority change;
- no credential rotation, copying, plaintext inspection, or exposure;
- no paid resource creation;
- no Phase 6 work.

Cloudflare remains the sole general production authority.

## Commits and deployment state

- Initial runtime/source commit: `2f9f8e4a843ac994f53aa6836a4f406e4380a835`
  (`Add inert Phase 5 Reel runner runtime`).
- Corrective runtime/source commit: `e42cb63100b55302416e616e53d369b0d31477e9`
  (`Add native control path to Phase 5 runner runtime`).
- Worker deployment: unchanged from Phase 5B; no Worker deploy was required for this gate.
- Server project path: `/srv/cartdotcom/instagram-reel-brain`.
- Server image: `cartdotcom-instagram-reel-brain-phase5-runner:latest`.
- Corrected image ID: `sha256:a3bbdc7a1ee58214c895c85a64103c49dc0e13a46fd4d168a6622baec2a74d64`.
- Corrected image size: `443614754` bytes.
- Corrected image created: `2026-08-22T05:47:28.2922611Z`.
- Runtime service state after tests: no `phase5-runner` container is running.

The runtime was built on Ubuntu with `docker compose --profile phase5-runner build --quiet phase5-runner`.

## Files changed

Runtime and configuration:

- `deployment/self-hosted/instagram-reel-brain/compose.yaml`
- `deployment/self-hosted/instagram-reel-brain/.env.example`
- `deployment/self-hosted/instagram-reel-brain/phase5-runner/Dockerfile`
- `deployment/self-hosted/instagram-reel-brain/phase5-runner/README.md`
- `deployment/self-hosted/instagram-reel-brain/phase5-runner/phase5_runner_probe.py`
- `deployment/self-hosted/instagram-reel-brain/phase5-runner/container/app.py`
- `deployment/self-hosted/instagram-reel-brain/phase5-runner/container/requirements.txt`
- `deployment/self-hosted/instagram-reel-brain/phase5-runner/container/synthesis-output.schema.json`

Tests:

- `deployment/self-hosted/instagram-reel-brain/tests/phase5-runtime.test.mjs`
- `deployment/self-hosted/instagram-reel-brain/tests/scaffold-config.test.mjs`

No unrelated News or price-watch working-tree changes were staged or committed.

## Runtime design

The new `phase5-runner` Compose service is profile-gated:

- profile: `phase5-runner`;
- `restart: "no"`;
- no selector, scheduler, claim loop, or enabled execution path;
- no host ports;
- networks: `reel-runtime` and `reel-egress` only;
- no `cartdotcom-edge` membership;
- required internal PostgreSQL network only: `platform-data` external network
  `cartdotcom-data`, attached only to the stopped `phase5-runner` profile
  service;
- `read_only: true`;
- writable tmpfs only for `/work`, `/tmp`, and `/home/node`;
- `mem_limit: 768m`;
- `cpus: 0.15`;
- `pids_limit: 256`;
- `no-new-privileges:true`;
- all normal Reel execution/mutation flags remain false.

The image packages:

- `node:22-bookworm-slim`;
- Python 3.11;
- ffmpeg/ffprobe;
- `yt-dlp`;
- `gallery-dl`;
- `psycopg[binary]`;
- Codex CLI `0.147.0`;
- the exact packaged processor code and schema from `deployment/instagram-reel-brain/container`;
- the disabled-by-default exact one-job runner `scripts/phase5_one_job_runner.py`.

The default entrypoint is a redacted readiness probe, not the live runner.

## Credential handling

The runtime does not copy or print Codex credential plaintext.

Server Codex auth is referenced as:

- host source: `/home/lucaj/.codex/auth.json`;
- container mount: `/codex-auth/auth.json`;
- mount mode: read-only;
- container `CODEX_HOME`: `/home/node/.codex`, backed by tmpfs;
- readiness probe creates a symlink from `CODEX_HOME/auth.json` to `/codex-auth/auth.json`.

Redacted auth status from the final probe:

- auth file present: true;
- auth file mode: `0600`;
- auth file uid/gid: `1000/1000`;
- auth file size: `3832` bytes;
- auth file readable by runtime user: true;
- `auth_file_is_symlink`: true;
- `auth_link_matches_source`: true.

No Instagram credentials or cookies are present during inert startup.

PostgreSQL control-plane credential handling:

- host source: `/srv/platform/secrets/postgres_password`;
- container mount: `/run/secrets/postgres_password`;
- mount mode: read-only;
- observed container metadata: mode `0600`, uid `1000`, gid `987`, size `65`
  bytes, readable by runtime UID;
- the password is read only by `psycopg` connection setup and is not placed in
  argv, image layers, Compose-rendered output, logs, checkpoints, or Git.

Worker exact-control credential handling:

- runner now requires `--admin-token-file` by default;
- legacy environment-token fallback exists only with explicit
  `--allow-admin-token-env` for workstation legacy mode;
- Compose references `/run/secrets/phase5_admin_token` through
  `REEL_PHASE5_ADMIN_TOKEN_FILE`;
- no existing server Phase 5/admin token file was found under the approved
  server secret locations, so no real Worker token was mounted or used in this
  no-live corrective gate;
- a synthetic 0600 token file was used only against a local fake Worker server
  inside the probe.

## Dependency versions proven in container

Final `tool-versions` probe:

- Codex CLI: `codex-cli 0.147.0`
- Python: `Python 3.11.2`
- Node: `v22.23.2`
- npm: `10.9.8`
- ffmpeg: `5.1.9-0+deb12u1`
- ffprobe: `5.1.9-0+deb12u1`
- `yt-dlp`: `2026.07.04`
- `gallery-dl`: `1.32.9`
- `psycopg`: `3.2.9`

## Runtime probes

All probes were run on Ubuntu under:

```bash
cd /srv/cartdotcom/instagram-reel-brain
docker compose --profile phase5-runner run --rm --no-deps phase5-runner <probe>
```

Results:

- `inert-health`: passed. All execution/mutation flags false, processor and runner present, no Instagram secret env.
- `runner-fail-closed`: passed. Running without exact live confirmation returned non-zero before cloud control or processor execution.
- `fixture-media`: passed. A local synthetic MP4 was generated and inspected; ffprobe found 2 streams; audio bytes `49300`; frame count `1`; video bytes `42827`; fake Codex synthesis returned `Fixture synthesis completed without a live model call.` No network, callbacks, publication, or production credentials were used.
- `native-control`: passed. The runner created and queried only isolated
  schema `reel_phase5c_runtime_probe_1_1787377654`, then dropped it. Exact
  `--dry-run --skip-cloud-control` reached the synthetic `leased/queued` row
  through native PostgreSQL; guarded local transition moved it to
  `processing`; restart dry-run saw `processing/queued`; a separate synthetic
  lease rolled back to `rolled_back`.
- `fake-worker-control`: passed. A local HTTP fake Worker accepted exact
  start/finalize/abort calls only with a synthetic 0600 token file; missing
  token file failed closed.
- `control-fail-closed`: passed. Missing PostgreSQL password file and incorrect
  Worker token file both failed closed; the checkpoint stopped at
  `idempotency_key_minted`, and `processor_loaded=false`.
- `codex-smoke`: passed. Codex CLI auth was usable through the read-only auth-file mount and writable tmpfs `CODEX_HOME`. Raw model output was not printed. Bounded usage evidence:
  - input tokens: `12181`;
  - cached input tokens: `8960`;
  - cache write input tokens: `0`;
  - output tokens: `5`;
  - reasoning output tokens: `0`;
  - stdout lines: `4`.

The earlier failed `codex-smoke` with a read-only `CODEX_HOME` was corrected by narrowing the auth mount to `auth.json` and moving transient CLI state into tmpfs.

## Test evidence

Local/self-hosted:

- `docker compose -f compose.yaml config --quiet`: passed.
- `npm test` in `deployment/self-hosted/instagram-reel-brain`: 59 passed, 1 expected Windows symlink skip.
- `python tests\test_media_processor_api.py`: 3 passed.
- `python tests\test_phase4_shadow_mirror.py`: 9 passed.
- `python tests\test_phase4_shadow_mirror_connected.py`: 5 passed.

Ubuntu/server:

- `docker compose -f compose.yaml config --quiet`: passed.
- Server host has no `npm`; static runtime tests were run inside the built image with `--network none`.
- `node --test tests/phase5-runtime.test.mjs tests/scaffold-config.test.mjs`: 13 passed, 1 skipped. The skipped test is the local-only equality check against the sibling cloud processor source path, which is absent from the isolated server copy; the same equality check passed locally.
- Attempting to include `tests/phase5-pilot.test.mjs` in the isolated server
  copy fails because that copy intentionally lacks the full self-hosted `src/`
  tree. The same test passed locally as part of `npm test`.

Cloud Reel regression:

- `npm run typecheck` in `deployment/instagram-reel-brain`: passed.
- `npm test` in `deployment/instagram-reel-brain`: 96 passed.
- `python -m unittest container.test_app -v`: 9 passed.

Existing Phase 5 interruption/restart and rollback evidence remains covered by:

- cloud Node Phase 5 executable recovery simulations;
- self-hosted synthetic Phase 5 pipeline test;
- connected PostgreSQL Phase 5 lease/rollback tests;
- exact one-job runner control/recovery tests.

## Secret and artifact hygiene

Targeted secret scan over the new/changed Reel runtime files found no credential material. The only match was a test assertion containing forbidden environment-variable names.

The image does not contain the Codex auth file or PostgreSQL password file; both are received only as read-only runtime bind mounts. Probe logs include only mode, uid/gid, size, symlink status, and token counts.

No generated fixture media, Codex output, synthetic Worker token, PostgreSQL
password, Worker admin token, or credential material was committed.

Secret scans:

- local changed runtime files: no credential-shaped literal; the only match was
  a test assertion containing a forbidden environment-variable name;
- server image inspect: no match;
- server image history: no match;
- server image `/opt/reel` filesystem scan: no match.

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
- D1 command metadata: `changed_db=false`, `rows_written=0`.

Docker health:

- Reel services: all six existing services healthy.
- News services: all healthy.
- Caddy: healthy.
- PostgreSQL: healthy.

Settled resource snapshot after tests:

- memory: 15 GiB total, 13 GiB available;
- swap: 4.0 GiB total, 15 MiB used;
- disk `/`: 349 GiB total, 306 GiB available, 8% used;
- Reel services: near-zero CPU, each within configured memory limits;
- News services: healthy and within limits;
- PostgreSQL settled to `0.90%` CPU and `473.2MiB / 3GiB` after test activity.

## Rollback / removal

Non-destructive rollback for this stage:

1. Ensure no runner container is active:

   ```bash
   cd /srv/cartdotcom/instagram-reel-brain
   docker compose --profile phase5-runner ps -a
   ```

2. Remove any stopped profile containers:

   ```bash
   docker compose --profile phase5-runner rm -f phase5-runner
   ```

3. Remove the inert image:

   ```bash
   docker image rm cartdotcom-instagram-reel-brain-phase5-runner:latest
   ```

4. Revert source commit `2f9f8e4a843ac994f53aa6836a4f406e4380a835` if independent review rejects the runtime:

   ```bash
   git revert 2f9f8e4a843ac994f53aa6836a4f406e4380a835
   ```

5. Copy the reverted `compose.yaml` back to `/srv/cartdotcom/instagram-reel-brain/compose.yaml`.

No production data, D1 rows, R2 objects, KV keys, credentials, live routes, or enabled services need deletion for rollback because this gate added only inert runtime files and a stopped image.

## Remaining risks / next gate

- The Codex CLI smoke proves server-side auth usability and one minimal model call, but not a full live job in the dedicated image.
- The runtime now proves native local PostgreSQL control and fake Worker exact
  control, but no real Worker admin token file currently exists on the server
  for this runtime. Live use remains blocked until an approved existing or new
  token-file mount is provided without exposing/copying plaintext.
- The runtime still has no selector, scheduler, claim loop, or live authority; using it for a live job must remain an explicit exact one-job action after independent approval.
- The next stage should not arm or process another live item until this report is independently reviewed.
- Phase 6 remains blocked.
