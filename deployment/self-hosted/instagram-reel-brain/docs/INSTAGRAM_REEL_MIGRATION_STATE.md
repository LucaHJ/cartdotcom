# Instagram Reel Migration State

Status: Phase 4 shadow live intake observation passed independent review.
Bounded Phase 5 preparation is implemented and deployed. The first live
controlled-compute pilot was pre-intake captured, locally claimed, renewed,
and completed for one exact Reel job and accepted as Phase 5 case 1 of 3.
Phase 5B runner hardening is accepted. Phase 5C has built the inert Ubuntu
runtime, corrected the native-control and control/compute secret-isolation
blockers, and added the missing staged host orchestrator for control -> compute
-> control-finalize recovery. It is stopped for independent supervisor review
before any real Worker control token, second pilot, carousel/retrieval case,
Phase 6 work, or general authority change.

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
preparation is recorded in `PHASE_5_PREP_REPORT_2026-08-22.md`; the first
one-job local run is recorded in
`PHASE_5_ONE_JOB_LOCAL_RUN_REPORT_2026-08-22.md`; Phase 5B runner hardening is
recorded in `PHASE_5B_RUNNER_HARDENING_REPORT_2026-08-22.md`.

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
- Admin-only Cloudflare Phase 5 arm/fence/rollback/renew endpoints.
- Admin-only Cloudflare Phase 5 exact local runner start/finalize/abort
  endpoints on corrected Worker version
  `98d34e1f-912a-4209-887a-450243444b7c`.
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
- Hardened disabled-by-default Phase 5B Ubuntu runner copy:
  `/srv/cartdotcom/instagram-reel-brain/scripts/phase5_one_job_runner.py`.
- Phase 5B runner hardening report:
  `PHASE_5B_RUNNER_HARDENING_REPORT_2026-08-22.md`.
- Dedicated inert Phase 5C split runtime images after the staged-orchestration
  correction:
  `cartdotcom-instagram-reel-brain-phase5-control:latest`
  (`sha256:cdeaa4c2c92e9ece8e16d6532cabd447d99fc9f715a6cb641968ece4ec8b51b7`)
  and `cartdotcom-instagram-reel-brain-phase5-compute:latest`
  (`sha256:ec0e8a1585051f75eef8afe5bb884afbde6e4ef73d3af23803fbbbd524e2070b`).
- Phase 5C inert runtime report:
  `PHASE_5C_INERT_RUNTIME_REPORT_2026-08-22.md`.
- Phase 5C staged-orchestration correction report:
  `PHASE_5C_STAGED_ORCHESTRATION_CORRECTION_REPORT_2026-08-22.md`.

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
  dedicated inert Ubuntu Reel runtime.
- Ubuntu live local execution. Dedicated inert control and compute runtimes now
  exist, but they have no selector, scheduler, claim loop, enabled execution
  path, or approval for live use before independent review. The staged host
  wrapper exists only for exact, confirmed one-job orchestration after future
  approval. A real Worker exact-control token file is not yet present on the
  server for this runtime and must not be created until separately approved.
- Reuse of missed manual-race job `35004cbd-a428-419f-93bf-96c3bcb54598`;
  it completed under cloud authority and is permanently excluded as the first
  local pilot.
- Phase 6 or general production authority cutover.

## Limits

- Active inert Reel service memory ceiling: 1.75 GiB.
- Active inert Reel service CPU ceiling: 1.85 cores.
- Reel service ceiling with the stopped `phase5-runner` profile included:
  2528 MiB memory and 2.0 CPU cores.
- Worker concurrency: 1.
- PID limit: 128 per existing inert service, 128 for profile-gated
  `phase5-control`, and 256 for profile-gated `phase5-compute`.
- No host ports.
- No shared `cartdotcom-edge` membership. Only stopped/profile-gated
  `phase5-control` may attach to `cartdotcom-data`, and only for native
  PostgreSQL control-plane checks. `phase5-compute` has no data-network
  attachment and no PostgreSQL or Worker control secret mount.

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

Phase 5B then hardened the reusable runner. Commit `918a496` added an
admin-only exact start/finalize/abort Worker control surface and replaced
operational Wrangler/D1 mutation in the local runner. Supervisor review then
found crash/restart recovery gaps, corrected in commit `121da3d` and Worker
version `98d34e1f-912a-4209-887a-450243444b7c`. A later supervisor review found
expiry-bound recovery gaps, corrected in commit `739b01f` and Worker version
`1b7055bd-0a18-41c3-a3f2-17972c8d145b`. The overall-fence authority-bound
correction is commit `5af21e1`, deployed as Worker version
`2400dec0-ab38-4cc4-b704-2f10d467fba2`: effective execution expiry became
`min(requested token expiry, overall fence expires_at - 30 seconds)`, any
remaining window below five minutes fails closed with
`insufficient_fence_window_abort_required`, initial start/running renewal/queued
repair all write only that effective expiry, SQL guards prove
`expires_at >= effective expiry`, and postconditions assert
`jobs.upload_token_expires_at == phase5_local_pilot_fences.local_lease_expires_at == effective expiry <= overall fence expires_at`.
The final short-running-lease restart correction is commit `08c94a3`, deployed
as Worker version `bb85f370-31bd-4c66-ba13-ce9ff5c12b75`: `resume_running` is
now allowed only when existing equal callback/local-lease expiries are valid,
within the overall fence, and at least as long as the newly computed effective
execution expiry; otherwise the route must first return and complete
`renew_processing_lease`, and failed/insufficient renewal stops before processor
loading. `/health` is `ok=true`, `ingest_mode=live`, and
`backlog_processing=false`. Post-deploy production state has zero queued/running
jobs, zero active Phase 5 fences, zero armed Phase 5 arms, and zero backlog
queued/running jobs. The inert Ubuntu runner remains disabled. Ubuntu full live
execution remains blocked until the dedicated Reel media/Codex runtime receives
independent review and an approved Worker token-file mount exists; see
`PHASE_5B_RUNNER_HARDENING_REPORT_2026-08-22.md`.

Phase 5B was accepted by independent supervisor review after commits `08c94a3`
and `35df777`, Worker version `bb85f370-31bd-4c66-ba13-ce9ff5c12b75`, 96/96
cloud Node tests, the self-hosted suite, clean D1 idle checks, healthy
Reel/News/Caddy/PostgreSQL services, and confirmation that Cloudflare remains
the sole general production authority.

Phase 5C then added the dedicated inert Ubuntu Reel runtime in commit
`2f9f8e4a843ac994f53aa6836a4f406e4380a835`, corrected native PostgreSQL control
in commit `e42cb63100b55302416e616e53d369b0d31477e9`, corrected the
control/compute secret boundary in commit `aff756d`, and corrected the missing
staged orchestration path in commit `db79057`.
The final server runtime is split into stopped/profile-gated services:
`phase5-control` handles exact PostgreSQL and future Worker control only, with
no Codex auth mount; and `phase5-compute` handles media/Codex only, with no
PostgreSQL password, no Worker admin token reference, no `REEL_PHASE5_PG*`
environment, and no `cartdotcom-data` network. The host-side
`phase5_one_job_orchestrator.py` now runs exact control -> compute ->
control-finalize stages with private monotonic checkpoints and forward recovery
after processor/cloud completion. Final images are
`cartdotcom-instagram-reel-brain-phase5-control:latest`
(`sha256:cdeaa4c2c92e9ece8e16d6532cabd447d99fc9f715a6cb641968ece4ec8b51b7`) and
`cartdotcom-instagram-reel-brain-phase5-compute:latest`
(`sha256:ec0e8a1585051f75eef8afe5bb884afbde6e4ef73d3af23803fbbbd524e2070b`),
both `443632338` bytes. Ubuntu probes passed inert health for both roles,
native-PG dry-run against isolated dropped synthetic schemas, guarded local
transition/restart/rollback, fake Worker token-file control, missing-PG/bad-token
fail-closed behaviour before processor import, control-secret canary, compute
secret canary through shell and Codex boundary, no-network synthetic media/fake
Codex synthesis, one redacted Codex CLI smoke using the existing server auth
mount, and the staged synthetic matrix for complete, interrupted, duplicate,
short-authority, abort, and tampered-checkpoint cases. The processor sanitises
Codex subprocess environment inheritance. No existing server Phase 5/admin
Worker token file was created or mounted, so live use remains blocked until an
approved token-file mount exists. Post-build Cloudflare `/health` remained ok
with `backlog_processing=false`; D1 had zero active jobs, active Phase 5 fences,
and armed captures; Reel/News/Caddy/PostgreSQL were healthy; and no
`reel_phase5c_staged_%` schemas or Phase 5 control/compute containers remained
active. See `PHASE_5C_INERT_RUNTIME_REPORT_2026-08-22.md` and
`PHASE_5C_STAGED_ORCHESTRATION_CORRECTION_REPORT_2026-08-22.md`.

No carousel, retrieval case, second pilot, Phase 6 work, or authority cutover is
approved before Phase 5C receives independent review.
