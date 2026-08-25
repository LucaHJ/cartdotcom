# Instagram Reel Migration State

Status: Phase 4 shadow live intake observation passed independent review.
Phase 5 controlled compute is complete. The exact Reel and carousel jobs
completed locally, and a new retrieval command returned the exact carousel
result through a successful outbound link event. All three required cases
passed with rollback/recovery evidence and no News regression.
Phase 5B runner hardening is accepted. Phase 5C has built the inert Ubuntu
runtime, corrected native-control and control/compute secret isolation, added
the staged host orchestrator, authenticated control checkpoints, and installed
a dedicated narrow Worker control token as a control-only mode-0600 server
file. Phase 6 processing authority is now local on generation 2 with a durable
watermark of `2026-08-23T01:17:09.133Z`. The serial dispatcher is supervised,
historical backlog remains disabled, and the required seven-day soak is active.

Phase 6 performance was tuned on `2026-08-25` in commit `c1e3765` and Worker
version `4ff08465-a579-4b4e-b1aa-c1a39d6ede86`. Exact synthesis remains
serial, but its compute limit is now `0.50` CPU. A separate secret-free
`phase6-prefetch` service may download only the next armed Reel while the
current exact job is already in `synthesizing`; the read-only Worker route does
not claim or mutate that job. Cache manifests bind the job, source message and
URL and verify every file by size and SHA-256 before handoff. The first three
production jobs after deployment averaged `208.5` D1 processing seconds,
`12.4%` below the prior non-stalled Ubuntu average of `238.1` seconds. The two
cache hits reduced the in-job download stage to `0.009` and `0.006` seconds.
The full declared Reel project remains bounded to `1.30` CPU and `1,792 MiB`.
Detailed evidence is in `PHASE_6_PERFORMANCE_PREFETCH_2026-08-25.md`.

On `2026-08-25`, Phase 6 encountered and recovered its first valid soak
failure. Exact Reel job `328ca9d8-7b14-4ab9-bd97-5fba1070bd44` timed out in
the original sequential FFmpeg frame filter, leaving one stale
`local_processing` fence/lease and preventing later serial claims. Commits
`14c31d9` and `2a856f1` add bounded seek-based sampling, optional media timeout
handling, exact active-fence restart reconciliation, guarded pre-publication
abort on compute failure, correct new-lease verification, and inherited
dispatcher locking across the orchestrator child. The exact stalled job
completed at `2026-08-25T10:42:29Z` with six frames and three resources, after
which the next queued job started automatically. The incident did not enable
historical backlog work, change authority generation 2, or deploy a Worker.
The Phase 6 soak must account for this valid failure before any later gate.

On `2026-08-25`, the user-visible retrieval defect was repaired without changing
processing authority. Cloudflare now maintains derived `retrieval_documents`
and `retrieval_terms` tables populated from completed synthesis JSON. All 302
completed jobs are indexed with 118,915 unique job-term rows. Ranked retrieval
uses distinctive token coverage, conservative aliases, field weights and a
confidence margin; ambiguous searches return candidates instead of an
automatic link. Worker version is
`282c170a-cafb-48c8-9317-e0cd878e774a`. The Phase 6 soak remains active and
generation 2 remains the sole new-job processor.

An attempted native retrieval reply in commit `10f8727` was disproved by two
live tests: Meta rejected both exact fresh webhook message IDs with HTTP 400,
code `100`, subcode `2534002`, while the same IDs remained valid for reactions.
The Instagram-login Send API does not document an outbound inline-reply
operation, and its native media-share operation is limited to media owned by
the professional account. Commit `fa489d4` removed the failed call; Worker
version `7dbf5ffb-c80d-4b73-b803-0c18e1b3b2b8` sends the canonical URL once for
normal retrieval and retains contextual MP4 delivery for explicit archive
requests. A true reply-to-original-share experience would require a separate
authenticated Instagram-web automation boundary and is not part of the
supported Meta API pipeline. Phase 6 authority and backlog state are unchanged.

Cloudflare remains authoritative for intake, edge spool, D1 recovery ledger,
R2/KV, callbacks, and recovery deployment. The Ubuntu serial runner is the sole
new-job processing authority. Cloudflare Container claims are disabled by the
durable authority record. Historical backlog remains disabled.

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

- Phase 6 processing authority generation 2 in `self_hosted` mode.
- Cloudflare intake and edge spool with post-watermark automatic local fences.
- Ubuntu serial dispatcher supervised every minute and at reboot.
- Seven-day soak sampling every five minutes.
- Serial `0.50` CPU synthesis plus one read-only `0.25` CPU Reel media
  prefetch during the active job's synthesis stage.

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
- Narrow-token Cloudflare Phase 5 arm/fence/rollback/renew endpoints. The
  dedicated `PHASE5_CONTROL_TOKEN` is accepted only for Phase 5 local-pilot
  routes; the existing broad admin token remains an operator fallback.
- Narrow-token Cloudflare Phase 5 exact local runner start/finalize/abort
  endpoints on Worker version `a1ed3971-9604-4961-a62a-d166b73fba08` after
  narrow secret installation.
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
- Dedicated inert Phase 5C split runtime images after authenticated checkpoint
  correction:
  `cartdotcom-instagram-reel-brain-phase5-control:latest`
  (`sha256:d5f7ca1814d572eaaf49b85918292f04c4a2caf1988346e3dce0cbaf7d071b3f`)
  and `cartdotcom-instagram-reel-brain-phase5-compute:latest`
  (`sha256:ababd6f3a1ef297952193f01411ecc5ffc5135c8f3e958f08acc7410c35e3cdc`).
- Dedicated Phase 5 Worker control secret installed in Cloudflare as
  `PHASE5_CONTROL_TOKEN` and on Ubuntu at
  `/srv/cartdotcom/instagram-reel-brain/secrets/phase5_admin_token`, mode
  `0600`, mounted only into one-shot `phase5-control` invocations.
- Phase 5C inert runtime report:
  `PHASE_5C_INERT_RUNTIME_REPORT_2026-08-22.md`.
- Phase 5C staged-orchestration correction report:
  `PHASE_5C_STAGED_ORCHESTRATION_CORRECTION_REPORT_2026-08-22.md`.
- Phase 5C authenticated checkpoint report:
  `PHASE_5C_CHECKPOINT_INTEGRITY_REPORT_2026-08-23.md`.
- Phase 5C narrow control credential report:
  `PHASE_5C_CONTROL_AUTH_REPORT_2026-08-23.md`.

## Disabled

- Cloudflare Container processing claims while authority is `self_hosted`.
- More than one local synthesis at a time.
- Historical backlog enumeration, replay, selection, and processing.
- Local direct Meta intake; Cloudflare remains the intake authority.
- Phase 7 primary-data authority cutover before the Phase 6 soak passes.
- Phase 8 retirement or deletion without explicit user approval.
- Backlog processing.
- Auth rotation.
- Temporary historical replay credential `PHASE4_REPLAY_TOKEN`; the corrected
  replay credential was created only for validation, then revoked and removed
  from the Ubuntu server after validation completed.
- Reuse of missed manual-race job `35004cbd-a428-419f-93bf-96c3bcb54598`;
  it completed under cloud authority and is permanently excluded as the first
  local pilot.

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
`backlog_processing=false`. Post-deploy production state had zero queued/running
jobs, zero active Phase 5 fences, zero armed Phase 5 arms, and zero backlog
queued/running jobs. These were Phase 5B acceptance conditions; subsequent
Phase 5C runtime and credential work is recorded below.

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
Codex subprocess environment inheritance. At that no-live gate, no server
Phase 5 Worker token file was present; the later narrow-auth gate installed and
verified it before live use. Post-build Cloudflare `/health` remained ok
with `backlog_processing=false`; D1 had zero active jobs, active Phase 5 fences,
and armed captures; Reel/News/Caddy/PostgreSQL were healthy; and no
`reel_phase5c_staged_%` schemas or Phase 5 control/compute containers remained
active. See `PHASE_5C_INERT_RUNTIME_REPORT_2026-08-22.md` and
`PHASE_5C_STAGED_ORCHESTRATION_CORRECTION_REPORT_2026-08-22.md`.

That historical Phase 5C review gate is now resolved by the authenticated
checkpoint, narrow-auth, and exact carousel evidence recorded below.
## 2026-08-23 Phase 5C checkpoint integrity correction

- Commit `fa37942` replaced the mutually writable staged checkpoint with a
  signed control-owned state and a separate untrusted compute result.
- `phase5-compute` mounts control state read-only; `phase5-control` mounts
  compute output read-only.
- The host orchestrator no longer trusts JSON stage values to skip work. Every
  invocation reconciles control, compute, finalize, and status idempotently.
- Focused Phase 5 tests passed 15/15. The Ubuntu 11-case synthetic fault matrix
  passed, including forged stage/index, result tampering, compute write denial,
  expiry, duplicate delivery, and restart boundaries.
- Final images: control
  `sha256:d5f7ca1814d572eaaf49b85918292f04c4a2caf1988346e3dce0cbaf7d071b3f`;
  compute
  `sha256:ababd6f3a1ef297952193f01411ecc5ffc5135c8f3e958f08acc7410c35e3cdc`.
- Phase 5 services remain stopped. Cloudflare remains sole production
  authority. The next gate is a control-only Worker token file followed by a
  separately fenced live carousel pilot.

## 2026-08-23 Phase 5 carousel pilot

- Commit `20cc589` added exact carousel pre-intake arming and D1 migration
  `0023_phase5_carousel_arm.sql`; Worker version
  `f74ed346-05b8-44ce-85ed-bd2f655f520e` deployed without a container rollout.
- Commit `592fb49` corrected the control client User-Agent after Cloudflare
  rejected Python urllib before any processing began.
- Exact job `f74f0619-c6a6-46c2-8b97-6d0fc0b62a13` completed locally for
  shortcode `DcOWkMakZ2k` with four carousel slides, four analysis frames,
  ten resources, and terminal cloud/local fences.
- All four slide objects, the carousel manifest, and synthesis object matched
  their recorded R2 SHA-256 hashes.
- The local mirror converged to complete with 15 artifacts, 875 verified
  object receipts, and zero divergences/errors.
- Worker health remained live with backlog off; Reel, News, Caddy, and
  PostgreSQL stayed healthy; no Phase 5 container remains active.
- See `PHASE_5_CAROUSEL_PILOT_REPORT_2026-08-23.md`.

## 2026-08-23 Phase 5 retrieval and completion

- A new command, `Find highest grossing movies adjusted for inflation`,
  completed in approximately two seconds.
- It returned exact carousel job
  `f74f0619-c6a6-46c2-8b97-6d0fc0b62a13` and its source URL with ten resources.
- Outbound event `8c6ee916-bd2b-4c3a-937c-cb2aaf842caa` sent one `reel_link`
  response with HTTP 200 and no error to the exact request message.
- All three Phase 5 cases and rollback/recovery prerequisites passed. Phase 5
  is complete. Phase 6 processing cutover subsequently completed and its
  required seven-day soak is now active.
- See `PHASE_5_RETRIEVAL_AND_COMPLETION_REPORT_2026-08-23.md`.
