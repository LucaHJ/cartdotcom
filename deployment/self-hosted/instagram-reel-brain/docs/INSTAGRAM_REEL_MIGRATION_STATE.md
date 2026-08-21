# Instagram Reel Migration State

Status: Phase 4 shadow live intake observation restarted after timestamp
correction; historical acceleration validation is blocked by a source-count
mismatch and requires independent review.

Cloudflare remains the only production authority. The local scaffold does not
receive Meta callbacks, claim jobs, call Codex, send Instagram output, publish
Pages/KV/R2 data, or process backlog.

Phase 3 is recorded in `PHASE_3_GATE_REPORT_2026-08-21.md`. Phase 4 start is
recorded in `PHASE_4_START_REPORT_2026-08-21.md`; the current timestamp
correction and historical validation blocker are recorded in
`PHASE_4_TIMESTAMP_CORRECTION_REPORT_2026-08-21.md`.

## Enabled

- Six container-internal health endpoints.
- Isolated Docker networks `cartdotcom-reel-runtime` and
  `cartdotcom-reel-egress`.
- Empty local storage roots prepared for later phases.
- Example backup and secret contracts.
- Non-authoritative Phase 3 PostgreSQL JSONB audit schema
  `reel_phase3_shadow_20260821_040408`.
- Non-authoritative Phase 3 typed operational shadow schema
  `reel_phase3_operational_20260821_040408`.
- ACL-restricted workstation and server Phase 3 D1 snapshots under ignored
  run paths.
- Server-side R2 shadow copy of all 5,673 bucket objects under
  `/srv/cartdotcom/reel-brain-runs/phase3-shadow/2026-08-21_04-04-08`.
- Local library manifests generated from copied data only.
- Dedicated Phase 4 mirror credential `PHASE4_MIRROR_TOKEN`, stored as a
  Cloudflare Worker secret and on the Ubuntu server at
  `/srv/cartdotcom/reel-brain-secrets/phase4-mirror-token` with mode `0600`.
- Read-only authenticated Phase 4 Worker endpoints on corrected Worker version
  `b7d06948-4cd5-4d59-a88d-56049b0ce53d`:
  `/api/phase4/mirror/delta` and `/api/phase4/mirror/object`.
- Non-authoritative Phase 4 shadow schema
  `reel_phase4_shadow_20260821_014246`.
- Phase 4 start watermark `2026-08-21T01:42:46Z`; latest corrected formal
  observation start `2026-08-21T03:01:28Z` after the timestamp-normalised
  endpoint mirrored nonempty live rows successfully.
- Server-side Phase 4 mirror run directory
  `/srv/cartdotcom/reel-brain-runs/phase4-shadow/2026-08-21_01-42-46`.
- Cron-supervised Phase 4 mirror watchdog and health sampler for the
  observation gate. The old raw `nohup` PIDs are stopped and preserved only as
  evidence. The mirror watchdog now verifies process command identity before
  trusting `mirror-supervised.pid`; corrected mirror PID `3168918` is running
  after a stale/reused-PID replacement test.

## Disabled

- Intake.
- Dispatch.
- Worker execution.
- Codex.
- Outbound delivery.
- Mutations.
- Backlog.
- Publisher.
- Archiver.
- Auth rotation.
- Local processing authority.
- Local job claims.
- Local Codex execution.
- Local publisher.
- Instagram outbound actions.
- Historical backlog enumeration, replay, selection, or processing.
- Production D1/R2/KV mutation.
- Phase 5 authority cutover.
- Temporary historical replay credential `PHASE4_REPLAY_TOKEN`; it was created
  only for validation, then revoked after the delegated cutoff/count mismatch
  was found.

## Limits

- Total Reel project memory ceiling: 1.75 GiB.
- Total Reel project CPU ceiling: 1.85 cores.
- Worker concurrency: 1.
- PID limit: 128 per service.
- No host ports.
- No shared `cartdotcom-edge` or `cartdotcom-data` membership in Phase 1.

## Current gate

Phase 4 observation restarted at `2026-08-21T03:01:28Z` but is not approved for
Phase 5. Cloudflare is still the sole production authority. The mirror is
allowed to pull only post-watermark rows and referenced artifacts through
authenticated GET-only endpoints. The gate requires at least 12 hours of
corrected live post-watermark observation with at least one genuine new input,
zero unexplained divergence/error, stable restart/cursors, and no News
regression, plus independent review. The proposed historical acceleration is
blocked: exact cutoff `2026-08-19T05:18:26Z` currently returns 48 jobs / 192
events / 697 artifacts / 251 resources, while the delegated evidence expected
50 / 200 / 731 / 268.
