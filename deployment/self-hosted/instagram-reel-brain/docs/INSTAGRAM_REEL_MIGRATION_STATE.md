# Instagram Reel Migration State

Status: Phase 4 shadow live intake observation passed independent review.
Bounded Phase 5 preparation is implemented and deployed. The first live
controlled-compute pilot was pre-intake captured, locally claimed, renewed,
and completed for one exact Reel job. Phase 5 is stopped for independent
supervisor review before any second pilot or Phase 6 work.

Cloudflare remains the only production authority. The local scaffold does not
receive Meta callbacks, claim jobs, call Codex, send Instagram output, publish
Pages/KV/R2 data, or process backlog except for a future exactly fenced
one-job Phase 5 pilot after explicit approval.

Phase 3 is recorded in `PHASE_3_GATE_REPORT_2026-08-21.md`. Phase 4 start is
recorded in `PHASE_4_START_REPORT_2026-08-21.md`; the current timestamp
correction and historical validation blocker are recorded in
`PHASE_4_TIMESTAMP_CORRECTION_REPORT_2026-08-21.md`; the completed corrected
historical replay validation is recorded in
`PHASE_4_HISTORICAL_REPLAY_VALIDATION_REPORT_2026-08-21.md`. Phase 5
preparation is recorded in `PHASE_5_PREP_REPORT_2026-08-22.md`.

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
- Non-authoritative Phase 4 historical replay validation schema
  `reel_phase4_replay_20260821_031920`, run directory
  `/srv/cartdotcom/reel-brain-runs/phase4-replay/2026-08-21_03-19-20`, and
  object root with 1,075 verified copied objects for the approved slice
  `2026-08-19T04:19:57Z <= created_at < 2026-08-21T01:42:46Z`.
- Cron-supervised Phase 4 mirror watchdog and health sampler for the
  observation gate. The old raw `nohup` PIDs are stopped and preserved only as
  evidence. The mirror watchdog now verifies process command identity before
  trusting `mirror-supervised.pid`; corrected mirror PID `3168918` is running
  after a stale/reused-PID replacement test.
- Empty production D1 Phase 5 fence table `phase5_local_pilot_fences`, created
  by migration `0021_phase5_local_pilot_fence.sql`.
- Empty production D1 Phase 5 pre-intake arm table `phase5_preintake_arms`,
  created by migration `0022_phase5_preintake_arm.sql`.
- Admin-only Cloudflare Phase 5 arm/fence/rollback/renew endpoints on Worker
  version `b24cf2ea-1536-42d3-8647-7a700eeccc16`.
- Non-authoritative local Phase 5 lease/event tables from
  `0005_phase5_controlled_pilot.sql`, with one-active-lease enforcement through
  `phase5_pilot_leases_one_active_idx`.
- Exact local claim report:
  `PHASE_5_LOCAL_CLAIM_REPORT_2026-08-22.md`.
- Synthetic-only local Phase 5 harness for media, transcription, Codex schema,
  token accounting, reaction audit, publication artifact, private playback, and
  R2-mirror receipt checks.
- Secret-free Phase 5 exact-job guard script
  `scripts/phase5_exact_pilot_guard.py`.
- Disabled-by-default Phase 5 one-shot local runner
  `scripts/phase5_one_job_runner.py`, exercised once for exact completed job
  `b14b79a0-9264-4613-9421-9920cba053c3`.
- First one-job local runner report:
  `PHASE_5_ONE_JOB_LOCAL_RUN_REPORT_2026-08-22.md`.

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
- Unrestricted local job claims. The only local claim recorded is exact job
  `b14b79a0-9264-4613-9421-9920cba053c3`.
- General local Codex execution outside the one completed exact pilot.
- General local publisher outside the one completed exact pilot.
- General Instagram outbound actions outside the one completed exact pilot's
  normal source-message status reactions.
- Historical backlog enumeration, replay, selection, or processing.
- Production D1/R2/KV mutation.
- Phase 5 authority cutover.
- Temporary historical replay credential `PHASE4_REPLAY_TOKEN`; the corrected
  replay credential was created only for validation, then revoked and removed
  from the Ubuntu server after validation completed.
- Unrestricted Phase 5 local claims; only the reviewed exact pre-intake pilot
  job has been processed locally.
- Additional live Phase 5 pilot execution before independent review of the
  first completed one-job run.
- Reuse of missed manual-race job `35004cbd-a428-419f-93bf-96c3bcb54598`;
  it completed under cloud authority and is permanently excluded as the first
  local pilot.
- Phase 6 or general production authority cutover.

## Limits

- Total Reel project memory ceiling: 1.75 GiB.
- Total Reel project CPU ceiling: 1.85 cores.
- Worker concurrency: 1.
- PID limit: 128 per service.
- No host ports.
- No shared `cartdotcom-edge` or `cartdotcom-data` membership in Phase 1.

## Current gate

Phase 4 passed independent review with corrected observation from
`2026-08-21T03:01:28Z` through after `2026-08-21T15:01:28Z`: 144 mirror polls,
0 failures, 409 live row versions, 279 current object receipts, 0 divergences,
0 mirror errors, 12 nonempty polls, and 144 health samples with no
Cloudflare/backlog or Docker health failure. The historical replay remains
exactly 50 jobs, 200 events, 722 artifacts, 258 resources, 1,075 object
receipts, 0 divergences, and 0 errors.

Phase 5 preparation is complete through the corrected readiness gate. The first
manual live attempt exposed an invalid operator race: job
`35004cbd-a428-419f-93bf-96c3bcb54598` was claimed by the cloud queue before it
could be fenced and completed under cloud authority. The replacement mechanism
is pre-intake arming: an admin must arm capture of the next new Reel for the
exact allowlisted sender, with a maximum 15-minute expiry, before the user sends
the Reel. Intake consumes the arm and creates the exact active fence before any
cloud queue message is published. This was exercised with arm
`phase5-next-reel-20260822-122532`, which captured job
`b14b79a0-9264-4613-9421-9920cba053c3`. The cloud fence is now
`local_claimed`, and the local shadow schema `reel_phase4_shadow_20260821_014246`
contains a matching `leased` Phase 5 pilot lease for owner
  `phase5-local-worker-1`. The exact lease was renewed to
  `2026-08-22T08:40:59.535Z` before live execution. The bounded one-shot local
  runner then completed the exact Reel job
  `b14b79a0-9264-4613-9421-9920cba053c3`; the job is complete, the cloud fence is
  `local_complete`, the local lease is `completed`, production queued/running
  job count is zero, and active Phase 5 fence count is zero. The result is
  recorded in `PHASE_5_ONE_JOB_LOCAL_RUN_REPORT_2026-08-22.md`.

No carousel, retrieval case, second pilot, Phase 6 work, or authority cutover is
approved before this first pre-armed Reel receives independent review.
