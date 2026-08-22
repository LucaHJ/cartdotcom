# Instagram Reel Brain - Operator Guide

This is the durable entry point for operating, recovering, and extending the
self-hosted Instagram Reel system. Read this file before changing runtime mode,
credentials, queues, or Cloudflare authority.

## Current Authority

- Cloudflare Worker/D1/R2/KV remain the production intake and general
  processing authority.
- Local PostgreSQL and object storage are mirrored and available for bounded
  migration work.
- Phase 5 control and compute services are profile-gated one-shot containers.
- No selector, scheduler, claim loop, or backlog consumer is enabled locally.
- Never run cloud and local processing authority for the same exact job.

## Runtime Map

Server root:

`/srv/cartdotcom/instagram-reel-brain`

Important files:

- `compose.yaml`: normal Reel services plus stopped Phase 5 profiles.
- `scripts/phase5_one_job_orchestrator.py`: credential-free host orchestrator.
- `scripts/phase5_staged_runner.py`: staged control/compute commands.
- `scripts/phase5_one_job_runner.py`: legacy exact runner and shared control
  helpers; do not use it as the split production entry point.
- `docs/INSTAGRAM_REEL_MIGRATION_STATE.md`: migration ledger and current gate.
- `docs/PHASE_5C_CHECKPOINT_INTEGRITY_REPORT_2026-08-23.md`: current staged
  handoff proof.

Services:

- `phase5-control`: PostgreSQL and Worker control only; no Codex auth or media
  processor.
- `phase5-compute`: media and Codex only; no PostgreSQL password, Worker admin
  token, or platform-data network.

Run roots:

- `/srv/cartdotcom/reel-brain-runs/phase5-control`: signed authoritative state.
- `/srv/cartdotcom/reel-brain-runs/phase5-compute`: untrusted compute results.

## Safety Invariants

1. Use an exact pilot key, job id, source message id, and lease owner.
2. Keep concurrency at one until the migration plan explicitly raises it.
3. Keep backlog processing false unless a later approved gate changes it.
4. Never select or process historical backlog as a pilot.
5. Mount Worker control and PostgreSQL secrets only into `phase5-control`.
6. Mount Codex auth only into `phase5-compute`.
7. Do not mount the Docker socket into either container.
8. Abort only before publication. After durable publication, recover forward.
9. Leave Cloudflare intake and recovery available until Phase 7 gates pass.
10. Do not retire Cloudflare components without the final retirement approval.

## Normal Inspection

```bash
cd /srv/cartdotcom/instagram-reel-brain
docker compose ps
docker compose --profile phase5-runner ps -a
docker ps --format '{{.Names}} {{.Status}}'
```

Worker health:

```bash
curl -fsS https://cartdotcom-instagram-reel-brain.lucajeannin.workers.dev/health
```

Expected while migration is gated:

- `ok: true`
- `ingest_mode: live`
- `backlog_processing: false`
- no running `phase5-control` or `phase5-compute` container

## Exact One-Shot Flow

Do not run a live flow without a separately recorded exact fence and an
approved control-token file. The orchestrator deliberately requires all exact
identifiers and the token file:

```bash
python3 scripts/phase5_one_job_orchestrator.py \
  --project-dir /srv/cartdotcom/instagram-reel-brain \
  --pilot-key '<exact-pilot-key>' \
  --job-id '<exact-job-id>' \
  --source-message-id '<exact-source-message-id>' \
  --lease-owner phase5-local-worker-1 \
  --admin-token-host-file '<approved-mode-0600-file>'
```

The host invokes:

1. `phase5-control control-start`
2. `phase5-compute compute-run`
3. `phase5-control control-finalize`
4. `phase5-control status`

Every restart repeats this sequence. Container-level idempotency and signed
state decide whether work should resume, finalize, or return complete.

## Troubleshooting

### Control checkpoint signature mismatch

Do not edit the checkpoint. Confirm that the same approved Worker control token
file is mounted and that exact identifiers match. If the file was genuinely
corrupted before publication, use the exact rollback path. If publication may
have occurred, inspect Worker/D1 state and recover forward.

### Compute result control-state digest mismatch

The result belongs to another or older control state. Do not finalize it.
Preserve both files for audit, reconcile Worker state through `control-start`,
and rerun compute only if Worker state proves processing did not complete.

### Compute cannot write `/runs/control`

This is expected. The control mount is read-only in compute. Compute writes only
under `/runs/compute`.

### Callback authority is short or expired

Do not start compute. Reconcile through `control-start`; it may renew both exact
execution leases within the overall fence. If the overall fence is too short,
perform an exact pre-publication abort.

### Crash after processor completion

Rerun the same exact host command. `control-start` checks Worker state. If the
completion callback is durable, compute is skipped and finalization proceeds.

### Crash after cloud finalize

Rerun the same exact host command. Control state and Worker state lead to local
completion without repeating Codex, publication, or reactions.

### News health changes during Reel work

Stop the bounded Reel stage. Capture `docker stats`, active PostgreSQL queries,
and News container health. Do not continue cutover work until News returns to
its prior healthy baseline.

## Backups and Rollback

Runtime backups are stored under:

`/srv/cartdotcom/instagram-reel-brain/backups`

Remove only stopped one-shot containers with:

```bash
docker compose --profile phase5-runner rm -f phase5-control phase5-compute
```

Do not delete PostgreSQL schemas, R2 objects, D1 rows, KV records, credentials,
or Cloudflare services as a routine rollback. Use the gate-specific report and
its exact reversible procedure.

## Documentation Discipline

For each migration milestone:

1. update `INSTAGRAM_REEL_MIGRATION_STATE.md`;
2. add or update a dated gate report;
3. record commits, image ids, tests, health, backups, and rollback;
4. copy the docs directory to the server;
5. provide the implementation task with a documentation-only milestone note.
