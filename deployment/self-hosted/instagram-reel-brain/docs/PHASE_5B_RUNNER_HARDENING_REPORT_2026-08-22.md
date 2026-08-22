# Phase 5B Runner Hardening Gate Report — 2026-08-22

Status: stopped for independent supervisor review. Phase 5 case 1 of 3 remains
accepted, but Phase 5 is not complete and Phase 6 is still blocked.

## Scope

Approved bounded task:

- Harden the reusable exact one-shot Phase 5 runner before any second live
  case.
- Replace operational direct Wrangler/D1 mutation with an authenticated
  exact-job Worker control surface.
- Package a disabled-by-default exact one-shot runner on Ubuntu.
- Run no live job, arm no Phase 5 capture, process no carousel/retrieval/note,
  enumerate no backlog, and make no authority cutover.

## Code and deployment identifiers

- Source commit: `918a496` (`Harden Phase 5 exact runner controls`).
- Worker deployment: `8d408b01-5323-40f3-847c-559320869be9`.
- Previous accepted one-job Worker version: `b24cf2ea-1536-42d3-8647-7a700eeccc16`.

## Files changed

Repository files:

- `deployment/instagram-reel-brain/src/phase5-pilot.ts`
  - Added exact Phase 5 start/finalize/abort confirmations and validators.
  - Added bounded callback-token expiry and idempotency marker generation.
- `deployment/instagram-reel-brain/src/index.ts`
  - Added admin-only exact-job routes:
    - `POST /api/admin/phase5/local-pilot/start`
    - `POST /api/admin/phase5/local-pilot/finalize`
    - `POST /api/admin/phase5/local-pilot/abort`
  - Start requires exact `pilot_key`, `job_id`, `source_message_id`,
    `lease_owner`, idempotency key, and callback-token hash.
  - Start moves the fence to `local_processing`, moves the job to
    `running/downloading`, writes audit once, reacts only after a guarded job
    transition, compensates a lost job update, and checks postconditions.
  - Finalize moves only exact `local_processing` fences to `local_complete`
    when the job is already `complete`, writes audit once only after the guard,
    and checks postconditions.
  - Abort is exact and pre-publication only. It returns the job to cloud queue
    after guarded rollback state exists, and repeat calls are idempotent.
- `deployment/instagram-reel-brain/tests/phase5-pilot.test.mjs`
  - Added validation and route/guard tests for exact runner control.
- `deployment/self-hosted/instagram-reel-brain/scripts/phase5_one_job_runner.py`
  - Replaced direct production Wrangler/D1 mutation with authenticated HTTPS
    Worker control calls.
  - Added checkpointed crash/restart stages:
    `callback_token_minted`, `cloud_started`, `local_processing`,
    `processor_loaded`, `processor_started`, `processor_complete`,
    `cloud_finalized`, `complete`, and `rolled_back`.
  - Added one-command exact pre-publication rollback:
    `--rollback-only --confirm-rollback "ROLL BACK EXACT PHASE 5 RUNNER <job_id>"`.
  - Added guarded local PostgreSQL CTE transitions that write events only from
    the updated row and fail closed otherwise.
  - Added Ubuntu run-root support:
    `/srv/cartdotcom/reel-brain-runs/phase5-runner` when present.
- `deployment/self-hosted/instagram-reel-brain/tests/phase5-pilot.test.mjs`
  - Updated runner architecture assertions.
- `deployment/self-hosted/instagram-reel-brain/tests/phase5-postgres-connected.test.mjs`
  - Added connected PostgreSQL proof that lost guarded Phase 5 local
    transitions write no events and duplicate completion adds no event.

Server-side inert files copied:

- `/srv/cartdotcom/instagram-reel-brain/scripts/phase5_one_job_runner.py`
  - mode: `0700`
- `/srv/cartdotcom/instagram-reel-brain/phase5-runner/container/app.py`
  - mode: `0600`
- `/srv/cartdotcom/instagram-reel-brain/migrations/0005_phase5_controlled_pilot.sql`
  - mode: `0600`

No service, scheduler, selector, claim loop, backlog reader, or live runner was
enabled on Ubuntu.

## Tests and verification

Local workstation:

- `npm run typecheck` in `deployment/instagram-reel-brain`: passed.
- `npm test` in `deployment/instagram-reel-brain`: 88/88 Node tests passed.
- `python -m unittest container.test_app -v` in
  `deployment/instagram-reel-brain`: 9/9 Python tests passed.
- `npm test` in `deployment/self-hosted/instagram-reel-brain`: 53 passed,
  1 expected Windows symlink skip.
- `python -m unittest discover -s tests -p "test_*.py" -v` in
  `deployment/self-hosted/instagram-reel-brain`: 17/17 Python/media/mirror
  tests passed.
- Secret-literal scan over the scoped diff: no OpenAI key pattern, bearer
  literal, or obvious token literal matched.

Ubuntu no-live evidence:

- `python3 -m py_compile` passed for:
  - `/srv/cartdotcom/instagram-reel-brain/scripts/phase5_one_job_runner.py`
  - `/srv/cartdotcom/instagram-reel-brain/phase5-runner/container/app.py`
- Isolated synthetic schema:
  `reel_phase5b_runner_test_20260822133451`.
- Runner dry-run, cloud control skipped, no production touch:
  - exact local lease found as `leased`
  - job found as `queued`
  - checkpoint root resolved to
    `/srv/cartdotcom/reel-brain-runs/phase5-runner/phase5b-runner_phase5b-job.json`
- Synthetic one-command rollback used a local fake Worker on `127.0.0.1`:
  - command returned `ok=true`, `rolled_back=true`
  - isolated schema result: `leases=1`, `events=1`
  - production Worker/D1/R2 were not touched by this rollback test.

Production checks:

- Pre-deploy D1 check: no queued/running jobs, no active Phase 5 fences, no
  armed Phase 5 arms.
- Deploy command:
  `npx wrangler deploy --containers-rollout=none`.
- Post-deploy `/health`:
  - `ok=true`
  - `ingest_mode=live`
  - `backlog_processing=false`
  - `model=gpt-5.6-luna`
- Post-deploy D1 check: no queued/running jobs, no active Phase 5 fences, no
  armed Phase 5 arms.
- Unauthenticated `POST /api/admin/phase5/local-pilot/start`: HTTP `401`.

Server health:

- Reel containers: all six healthy.
- News containers: all healthy.
- Caddy and PostgreSQL: healthy.
- A transient PostgreSQL CPU spike occurred during/after connected tests and
  was traced read-only to a News market/observation query, not Reel migration
  work. Follow-up sample returned to `0.01%` CPU, `280.2MiB / 3GiB`, with zero
  active non-idle PostgreSQL sessions.

## Enabled/disabled state after this gate

Enabled:

- Cloudflare remains the only production processing authority.
- Admin-only exact Phase 5 start/finalize/abort control routes are deployed.
- The Ubuntu exact runner file is present but inert.
- The Ubuntu synthetic test schema remains as evidence.

Disabled / not performed:

- No live Phase 5 arm.
- No second live job.
- No carousel, retrieval, or note case.
- No historical backlog enumeration, replay, or processing.
- No local scheduler, selector, general claim loop, Codex loop, publisher loop,
  or Instagram outbound loop.
- No production D1/R2/KV mutation outside the Worker deploy and read-only
  health/idle checks.
- No credential rotation and no secret plaintext copied into source, logs,
  chat, reports, or command output.

## Ubuntu Codex/runtime readiness

Read-only inspection found:

- Existing News Codex runner container:
  - image: `cartdotcom-news-codex-runner`
  - user: `node`
  - command: `node server.js`
  - Codex CLI inside container: `codex-cli 0.148.0`
  - host auth mount: `/home/lucaj/.codex -> /codex-auth`
- Host Codex auth:
  - `/home/lucaj/.codex/auth.json`
  - mode `0600`
  - contents were not read.
- Host Codex CLI: missing.
- Host Python processor import: blocked by missing `yt_dlp`.
- Existing News Codex container is not a media runner:
  - no `python3`
  - no `ffmpeg`
  - no `gallery-dl`

Conclusion: non-auth readiness is improved, but Ubuntu is not yet durable live
runner parity. A future bounded stage needs a dedicated Reel runner runtime
image or equivalent host runtime containing Python media dependencies,
`ffmpeg`, `gallery-dl`, `yt-dlp`, Codex CLI, and the existing auth mounted or
referenced without copying secret values. No live job should run from Ubuntu
until that runtime is independently reviewed.

## Rollback / cleanup

Immediate Worker rollback:

1. Use Cloudflare Worker rollback to previous version
   `b24cf2ea-1536-42d3-8647-7a700eeccc16`, or redeploy source before commit
   `918a496`.
2. Confirm `/health` is `ok=true` and `backlog_processing=false`.
3. Confirm no queued/running jobs and no active Phase 5 fences/arms.

Ubuntu runner rollback:

1. Move, do not delete, the inert runner evidence:
   `/srv/cartdotcom/instagram-reel-brain/scripts/phase5_one_job_runner.py`.
2. Move, do not delete, the copied processor file:
   `/srv/cartdotcom/instagram-reel-brain/phase5-runner/container/app.py`.
3. No services need stopping because none were installed or enabled.

Synthetic evidence cleanup, if explicitly approved later:

```sql
DROP SCHEMA IF EXISTS reel_phase5b_runner_test_20260822133451 CASCADE;
```

## Remaining risks

- The new exact Worker control surface has not yet been exercised with a second
  real live job.
- D1 does not provide the same repository transaction contract as PostgreSQL;
  the Worker start path uses guarded transitions, compensation, idempotency,
  and postconditions rather than a single multi-row transaction.
- The admin-only legacy rollback endpoint remains present for compatibility;
  the hardened runner uses the newer exact abort route.
- The runner checkpoint stores the callback token in an ignored `0600` file so
  crash/restart can continue after start. This is necessary for recovery but
  must stay outside Git and web roots.
- Ubuntu live execution is blocked until a dedicated Reel media/Codex runtime
  is provided and reviewed.

## Proposed next bounded stage

Do not process a second live case yet. The next bounded stage should build or
configure a dedicated inert Reel runner runtime on Ubuntu, using the existing
server Codex auth path without reading or copying secret plaintext, and prove
fixture processor execution plus Codex availability without touching production
data or Instagram.

---

## Corrective addendum — crash/restart recovery gate — 2026-08-22 14:09 AEST

Status: corrected and redeployed for independent supervisor review. Phase 5B
remains no-live; Phase 5 case 2, carousel/retrieval/note cases, backlog work,
runtime-image deployment, and Phase 6 remain blocked.

### Supervisor findings addressed

The original Phase 5B report was not accepted because restart recovery still had
four correctness gaps:

1. A crash after processor-side cloud completion but before local checkpoint or
   finalize could not restart, because the runner always called cloud start and
   the Worker returned `409` for `local_processing + complete`.
2. A partial start could strand durable state as `local_processing + queued` if
   the fence update won and the job update lost or the process died between
   them.
3. Missing start/finalize audit markers were treated as hard failures or silent
   idempotent success instead of being repaired.
4. The reported test evidence was too source-pattern-heavy and did not execute
   the recovery state matrix.

### Code changes in this correction

Repository files changed:

- `deployment/instagram-reel-brain/src/phase5-pilot.ts`
  - Added `normaliseOptionalPhase5CallbackTokenHash()` so restart probes can
    omit callback-token hash when the cloud job is already complete.
  - Added shared executable decision helpers:
    - `phase5StartRecoveryDecision()`
    - `phase5FinalizeRecoveryDecision()`
    - `phase5AbortRecoveryDecision()`
    - `phase5SnapshotHasPublication()`
  - Explicit start decisions now cover:
    - `local_claimed + queued -> guarded_start`
    - `local_processing + running + same callback hash -> resume_running`
      with missing-audit repair
    - `local_processing + complete -> processor_already_complete` without
      requiring callback plaintext/hash recreation
    - `local_processing + queued -> repair_queued_start`
    - `local_complete + complete -> cloud_already_finalized`
    - mismatched owner/source/hash/publication state -> fail closed
  - Explicit finalize decisions now repair missing finalize audit markers before
    returning idempotent success.
  - Abort is documented and classified as guarded/idempotent/requeue-audit-
    missing/fail-closed. Queue delivery remains at-least-once; processing safety
    comes from the fence/job guards, not transport exactly-once.
- `deployment/instagram-reel-brain/src/index.ts`
  - Replaced inline start/finalize/abort branching with the shared decision
    helpers.
  - Added `phase5InsertControlMarker()`, `phase5EnsureStartAudit()`, and
    `phase5EnsureFinalizeAudit()` for idempotent audit repair.
  - Added `phase5RepairQueuedStart()` to recover exact
    `local_processing + queued` partial starts without widening job selection.
  - Start now verifies compensation affected rows and postconditions. A lost
    job transition returns either `compensated_to_local_claimed` with
    `retryable_start=true`, or `ambiguous_partial_start` fail-closed with exact
    current state.
  - Start now reports `processor_already_complete` or `cloud_already_finalized`
    so the runner can skip processor/Codex/publication/reactions and continue
    forward to finalize/local completion.
  - Finalize now repairs a missing exact finalize marker for
    `local_complete + complete` before returning idempotent success.
- `deployment/instagram-reel-brain/tests/phase5-pilot.test.mjs`
  - Added executable recovery-decision and simulation tests for:
    - after fence update
    - after job update before audit
    - after audit before response
    - processor callbacks complete before checkpoint
    - cloud finalize before audit
    - cloud finalize before local completion
    - duplicate abort delivery classification
  - Existing route-shape assertions were updated to check the new shared
    production helper path rather than stale inline source patterns.
- `deployment/self-hosted/instagram-reel-brain/scripts/phase5_one_job_runner.py`
  - `cloud_start()` now sends callback-token hash only when the checkpoint has
    one. A first start probe can therefore recover an already-complete cloud job
    without recreating callback plaintext/hash.
  - Added bounded handling for `requires_callback_token`,
    `callback_hash_required`, and `retryable_start` responses.
  - Added `ensure_idempotency_key()` so idempotency can exist without minting a
    callback token.
  - `verify_local()` now treats a leased/processing local row with completed
    job/publication evidence as forward-recoverable.
  - When Worker start returns `processor_already_complete`, the runner writes a
    non-sensitive recovered result summary and skips `processor.process()`.
- `deployment/self-hosted/instagram-reel-brain/tests/phase5-pilot.test.mjs`
  - Added assertions that the runner recognises
    `processor_already_complete`, `requires_callback_token`, `retryable_start`,
    and reaches the cloud-complete recovery branch before the processor call
    site.

### Verification after correction

Workstation:

- `npm run typecheck` in `deployment/instagram-reel-brain`: passed.
- `npm test -- --test-name-pattern "Phase 5"` in
  `deployment/instagram-reel-brain`: 92/92 matching tests passed.
- `npm test` in `deployment/instagram-reel-brain`: 92/92 Node tests passed.
- `npm test` in `deployment/self-hosted/instagram-reel-brain`: 53 passed,
  1 expected Windows symlink skip.
- `python -m unittest tests.test_media_processor_api tests.test_phase4_shadow_mirror tests.test_phase4_shadow_mirror_connected`
  in `deployment/self-hosted/instagram-reel-brain`: 17/17 tests passed.
- `python -m py_compile` passed for:
  - `deployment/self-hosted/instagram-reel-brain/scripts/phase5_one_job_runner.py`
  - `deployment/self-hosted/instagram-reel-brain/scripts/phase5_exact_pilot_guard.py`
  - `deployment/self-hosted/instagram-reel-brain/scripts/phase4_shadow_mirror.py`

Deployment:

- Corrective source commit: `121da3d`
- Initial `npx wrangler deploy` correctly stopped before deploy because Docker
  Desktop was not running and Wrangler attempted a container build.
- Worker-only deploy used:
  `npx wrangler deploy --containers-rollout=none`
- Corrective Worker version:
  `98d34e1f-912a-4209-887a-450243444b7c`
- No container/runtime image rollout was performed.

Production state:

- Pre-deploy D1 idle check used database name
  `cartdotcom-instagram-reel-brain` because the `REEL_DB` binding alias query
  returned Cloudflare API code `7403` while direct database-name execution
  succeeded.
- Pre-deploy:
  - queued/running jobs: `0`
  - active Phase 5 fences: `0`
  - armed Phase 5 captures: `0`
  - active non-pilot jobs: `0`
- Post-deploy `/health`:
  - `ok=true`
  - `ingest_mode=live`
  - `backlog_processing=false`
  - `model=gpt-5.6-luna`
- Post-deploy:
  - queued/running jobs: `0`
  - active Phase 5 fences: `0`
  - armed Phase 5 captures: `0`
  - active non-pilot jobs: `0`

Server health after correction:

- Reel services: all six healthy.
- News services: healthy.
- Caddy and PostgreSQL: healthy.
- Resource sample:
  - Reel API: `16.47MiB / 256MiB`
  - Reel worker: `16.1MiB / 768MiB`
  - News worker: `35.57MiB / 4GiB`
  - News Codex runner: `178.2MiB / 3GiB`
  - PostgreSQL: `277.7MiB / 3GiB`

### Enabled/disabled state after correction

Enabled:

- Cloudflare remains sole general production processing authority.
- Admin-only exact start/finalize/abort routes remain deployed.
- Ubuntu one-shot runner file remains inert and disabled by default.

Disabled / not performed:

- No live Phase 5 arm.
- No live job.
- No carousel, retrieval, or note case.
- No historical backlog enumeration/replay/processing.
- No dedicated runtime image deployment.
- No local scheduler, selector, general claim loop, Codex execution loop,
  publication loop, or Instagram outbound loop.
- No credential rotation and no secret plaintext exposure.

### Rollback

Immediate Worker rollback:

1. Roll the Worker back from version
   `98d34e1f-912a-4209-887a-450243444b7c` to the previous Phase 5B version
   `8d408b01-5323-40f3-847c-559320869be9`, or redeploy source before the
   corrective commit.
2. Confirm `/health` returns `ok=true` and `backlog_processing=false`.
3. Confirm D1 has zero queued/running jobs, zero active Phase 5 fences, and zero
   armed Phase 5 captures.

If a future exact pilot is captured but not published, use the existing exact
pre-publication abort path. Once publication exists, rollback must use the
documented forward-recovery/finalize path; abort remains pre-publication only.

### Remaining risks

- The corrected recovery state machine has executable unit/simulation coverage,
  but has not yet been exercised with a second real live job.
- D1 still does not provide a multi-row transaction contract equivalent to the
  local PostgreSQL repository; safety depends on guarded updates, audit repair,
  compensation checks, and exact postconditions.
- Queue retry remains at-least-once. Duplicate queue deliveries are expected to
  be refused or made idempotent by cloud claim/fence guards; this report does
  not claim exactly-once queue transport.
- Ubuntu durable live-runner parity is still blocked on a dedicated Reel
  media/Codex runtime. No second live case should run until the supervisor
  approves the next bounded stage.

## Expiry-bound recovery correction addendum

Timestamp: `2026-08-22T14:32:51+10:00`

Supervisor review found one remaining Phase 5B defect: start/restart recovery
for `local_processing + running/queued` states did not account for the overall
fence expiry, the local processing lease expiry, or the callback/upload-token
expiry. A delayed restart could therefore resume the runner even though
`validateCallback()` would reject every processor callback.

### Correction

Commit `739b01f` changes only the Reel Worker Phase 5 control code and its
tests:

- `deployment/instagram-reel-brain/src/phase5-pilot.ts`
  - `phase5StartRecoveryDecision()` now accepts an explicit `now` value.
  - `Phase5ControlSnapshot` includes `expires_at` and
    `local_lease_expires_at`.
  - `local_claimed + queued`, `local_processing + running`, and
    `local_processing + queued` fail closed with
    `fence_expired_abort_required` when the overall fence expiry has passed.
  - `local_processing + running` returns `resume_running` only when the exact
    callback hash matches and both the job callback expiry and fence local
    lease expiry are still valid.
  - If only the short execution leases have expired but the exact hash still
    matches and the overall fence is valid, the decision is
    `renew_processing_lease`.
  - `processor_already_complete` and `cloud_already_finalized` remain forward
    recovery paths that do not renew execution authority or permit processor
    work.
- `deployment/instagram-reel-brain/src/index.ts`
  - `handlePhase5StartLocalProcessing()` uses one request timestamp for both
    request validation and recovery decisions.
  - Added `phase5RenewProcessingLease()`, which refreshes both
    `jobs.upload_token_expires_at` and
    `phase5_local_pilot_fences.local_lease_expires_at` for the exact
    pilot/job/source/owner/hash only, with guarded affected-row checks and a
    postcondition before returning `started=true`.
  - `phase5RepairQueuedStart()` now refreshes/verifies both the local fence
    lease and job callback expiry while moving a partial `local_processing +
    queued` state to `running`.
  - Start-route JSON failures include `prepublication_abort_required` when a
    stale fence or failed renewal means the runner must not load the processor.
- `deployment/instagram-reel-brain/tests/phase5-pilot.test.mjs`
  - Added executable state-machine and simulation tests for just-before and
    just-after expiry, callback/local lease expiry, overall fence expiry,
    mismatched hash, queued partial-start repair, successful bounded renewal,
    renewal/repair partial failure, and the guarantee that failed/expired
    recovery never invokes `processor.process()`.

### Verification after expiry correction

Workstation:

- `npm run typecheck` in `deployment/instagram-reel-brain`: passed.
- `npm test` in `deployment/instagram-reel-brain`: 94/94 Node tests passed.
- Focused Phase 5 test file through the Node runner: 94/94 loaded tests passed.
- `npm test` in `deployment/self-hosted/instagram-reel-brain`: 53 passed,
  1 expected Windows symlink skip.
- `python -m unittest container.test_app -v` in
  `deployment/instagram-reel-brain`: 9/9 Python tests passed.
- `python tests/test_media_processor_api.py` in
  `deployment/self-hosted/instagram-reel-brain`: 3/3 passed.
- `python tests/test_phase4_shadow_mirror.py` in
  `deployment/self-hosted/instagram-reel-brain`: 9/9 passed.
- `python tests/test_phase4_shadow_mirror_connected.py` in
  `deployment/self-hosted/instagram-reel-brain`: 5/5 passed.
- `python -m py_compile` passed for:
  - `deployment/self-hosted/instagram-reel-brain/scripts/phase5_one_job_runner.py`
  - `deployment/self-hosted/instagram-reel-brain/services/media-processor-api/app.py`
- `docker compose -f compose.yaml config --quiet` in
  `deployment/self-hosted/instagram-reel-brain`: passed.

Deployment gate:

- The unrelated normal cloud job
  `2f307553-9b66-499c-b012-04d9ca137b22` was not touched. It was observed
  `running/synthesizing` before deployment work and reached terminal
  `complete/complete` at `2026-08-22 04:27:47` UTC before deploy.
- Immediate pre-deploy D1 state:
  - queued/running jobs: `0`
  - active Phase 5 fences: `0`
  - job `2f307553-9b66-499c-b012-04d9ca137b22`: `complete/complete`
- Pre-deploy Worker `/health`:
  - `ok=true`
  - `ingest_mode=live`
  - `backlog_processing=false`

Deployment:

- Worker-only deploy command:
  `npx wrangler deploy --containers-rollout=none`
- Corrective Worker version:
  `1b7055bd-0a18-41c3-a3f2-17972c8d145b`
- No container/runtime image rollout was performed.

Post-deploy state:

- Worker `/health`: `ok=true`, `ingest_mode=live`,
  `backlog_processing=false`, `model=gpt-5.6-luna`.
- D1:
  - queued/running jobs: `0`
  - active Phase 5 fences: `0`
  - active Phase 5 arms: `0`
  - backlog queued/running jobs: `0`
- Server:
  - Reel services: all six healthy.
  - News services: healthy.
  - Caddy and PostgreSQL: healthy.
  - Host memory sample: `15Gi` total, `1.7Gi` used, `13Gi` available.

### Enabled/disabled state after expiry correction

Enabled:

- Cloudflare remains the sole general production processing authority.
- Admin-only exact Phase 5 start/finalize/abort routes remain deployed.

Disabled / not performed:

- No live Phase 5 arm.
- No live local job.
- No carousel, retrieval, or note case.
- No historical backlog enumeration/replay/processing.
- No dedicated runtime image deployment.
- No local scheduler, selector, general claim loop, Codex execution loop,
  publication loop, or Instagram outbound loop.
- No credential rotation and no secret plaintext exposure.

### Rollback

Immediate Worker rollback:

1. Roll the Worker back from version
   `1b7055bd-0a18-41c3-a3f2-17972c8d145b` to previous version
   `98d34e1f-912a-4209-887a-450243444b7c`, or redeploy source before commit
   `739b01f`.
2. Confirm `/health` returns `ok=true` and `backlog_processing=false`.
3. Confirm D1 has zero queued/running jobs, zero active Phase 5 fences, and
   zero armed Phase 5 captures.

If a future exact pilot has an expired overall fence before publication, use the
exact pre-publication abort path rather than restarting processor work. If cloud
completion/publication is already durable, use forward finalize recovery only.

### Remaining risks after expiry correction

- The expiry-aware recovery paths are covered by executable tests and
  production deployment/idle checks, but they have not yet been exercised on a
  second real live job.
- D1 guarded multi-row updates still rely on affected-row checks and
  postconditions rather than PostgreSQL-style repository transactions.
- Ubuntu durable live-runner parity is still blocked on a dedicated Reel
  media/Codex runtime. No second live case should run until the supervisor
  approves the next bounded stage.

## Short running-lease restart correction addendum

Timestamp: `2026-08-22T15:03:44+10:00`

Supervisor review accepted the overall-fence bound, but found one remaining
executable restart defect: `phase5StartRecoveryDecision()` could return
`resume_running` when stored `upload_token_expires_at` and
`local_lease_expires_at` were only barely greater than `now`, even though the
new start request had a much longer safe effective execution window. The runner
would then call `processor.process()` immediately and could lose callback
authority mid-run.

### Correction

Commit `08c94a3` changes only the Phase 5 recovery predicate and executable
tests:

- `deployment/instagram-reel-brain/src/phase5-pilot.ts`
  - `resume_running` now requires stored callback and local-lease expiries to:
    - be valid after `now`;
    - be equal to each other;
    - be no later than the overall fence;
    - cover the newly computed `effectiveTokenExpiresAt`.
  - If either stored expiry is earlier than the effective requested window,
    recovery returns `renew_processing_lease` instead of `resume_running`.
  - The prior 30-second overall-fence safety margin and five-minute minimum safe
    processing window remain unchanged.
- `deployment/instagram-reel-brain/tests/phase5-pilot.test.mjs`
  - Added executable reproduction coverage for stored running leases expiring
    one second after `now` with one hour of overall/requested authority.
  - Proves `renew_processing_lease` is required, successful renewal writes the
    effective expiry, failed renewal produces zero processor calls, and
    sufficiently long existing leases still resume without a renewal write.
- `deployment/self-hosted/instagram-reel-brain/tests/phase5-pilot.test.mjs`
  - Verifies the one-shot runner records the Worker-returned effective/renewed
    `token_expires_at` before processor execution.
  - Verifies failed cloud start or failed processing-lease renewal exits before
    `processor.process(payload)`.

No live arm, live local job, runtime image, carousel/retrieval/note case,
backlog work, or Phase 6 work was started.

### Verification

Workstation:

- Focused Cloud Phase 5 test command:
  `npm test -- --test-reporter=spec tests/phase5-pilot.test.mjs` in
  `deployment/instagram-reel-brain` — 96/96 loaded tests passed.
- Focused self-hosted Phase 5 test command:
  `npm test -- --test-reporter=spec tests/phase5-pilot.test.mjs` in
  `deployment/self-hosted/instagram-reel-brain` — 53 passed, 1 expected Windows
  symlink skip.
- `npm run typecheck` in `deployment/instagram-reel-brain`: passed.
- `npm test` in `deployment/instagram-reel-brain`: 96/96 Node tests passed.
- `npm test` in `deployment/self-hosted/instagram-reel-brain`: 53 passed,
  1 expected Windows symlink skip.
- `python -m unittest container.test_app -v` in
  `deployment/instagram-reel-brain`: 9/9 Python tests passed.
- `python tests/test_media_processor_api.py` in
  `deployment/self-hosted/instagram-reel-brain`: 3/3 passed.
- `python tests/test_phase4_shadow_mirror.py` in
  `deployment/self-hosted/instagram-reel-brain`: 9/9 passed.
- `python tests/test_phase4_shadow_mirror_connected.py` in
  `deployment/self-hosted/instagram-reel-brain`: 5/5 passed.
- `python -m py_compile` passed for:
  - `deployment/self-hosted/instagram-reel-brain/scripts/phase5_one_job_runner.py`
  - `deployment/self-hosted/instagram-reel-brain/services/media-processor-api/app.py`
- `docker compose -f compose.yaml config --quiet` in
  `deployment/self-hosted/instagram-reel-brain`: passed.

Deployment:

- First deploy attempt failed before mutation because the stale
  `CLOUDFLARE_API_TOKEN` environment override was present.
- Successful Worker-only deploy command:
  `Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue; npx wrangler deploy --containers-rollout=none`
- Corrective Worker version:
  `bb85f370-31bd-4c66-ba13-ce9ff5c12b75`
- No container/runtime image rollout was performed.

Pre-deploy and post-deploy production state:

- Worker `/health`: `ok=true`, `ingest_mode=live`,
  `backlog_processing=false`, `model=gpt-5.6-luna`.
- D1 before and after deploy:
  - queued/running jobs: `0`
  - active Phase 5 fences: `0`
  - active Phase 5 arms: `0`
  - backlog queued/running jobs: `0`
- Server after deploy:
  - Reel services: all six healthy.
  - News services: all healthy.
  - Caddy and PostgreSQL: healthy.
  - Host memory sample: `15Gi` total, `1.8Gi` used, `13Gi` available.

### Enabled/disabled state after short running-lease correction

Enabled:

- Cloudflare remains the sole general production processing authority.
- Admin-only exact Phase 5 start/finalize/abort routes remain deployed.

Disabled / not performed:

- No live Phase 5 arm.
- No live local job.
- No carousel, retrieval, or note case.
- No historical backlog enumeration/replay/processing.
- No dedicated runtime image deployment.
- No local scheduler, selector, general claim loop, Codex execution loop,
  publication loop, or Instagram outbound loop.
- No credential rotation and no secret plaintext exposure.

### Rollback

Immediate Worker rollback:

1. Roll the Worker back from version
   `bb85f370-31bd-4c66-ba13-ce9ff5c12b75` to previous version
   `2400dec0-ab38-4cc4-b704-2f10d467fba2`, or redeploy source before commit
   `08c94a3`.
2. Confirm `/health` returns `ok=true` and `backlog_processing=false`.
3. Confirm D1 has zero queued/running jobs, zero active Phase 5 fences, and
   zero armed Phase 5 captures.

### Remaining risks after short running-lease correction

- The short-running-lease restart path is covered by executable tests and idle
  deploy checks, but it has not yet been exercised on a second real live job.
- D1 guarded multi-row updates still rely on affected-row checks and
  postconditions rather than PostgreSQL-style repository transactions.
- Ubuntu durable live-runner parity is still blocked on a dedicated Reel
  media/Codex runtime. No second live case should run until the supervisor
  approves the next bounded stage.

## Overall-fence execution-expiry correction addendum

Timestamp: `2026-08-22T14:50:10+10:00`

Supervisor review found one final authority-bound defect: ordinary start,
queued repair, or running renewal could mint a callback/local-lease expiry
later than the overall Phase 5 fence `expires_at`. That silently extended local
callback authority beyond the active fence lifetime.

### Correction

Commit `5af21e1` changes only the Reel Worker Phase 5 control code and tests:

- `deployment/instagram-reel-brain/src/phase5-pilot.ts`
  - Added `PHASE5_EXECUTION_EXPIRY_SAFETY_MARGIN_MS = 30000`.
  - Added `PHASE5_MIN_SAFE_PROCESSING_WINDOW_MS = 300000`.
  - Added `phase5EffectiveExecutionExpiry()`.
  - Effective execution expiry is now:
    `min(requested token expiry, overall fence expires_at - 30 seconds)`.
  - If the effective expiry leaves less than the minimum safe 5-minute window,
    start recovery returns `insufficient_fence_window_abort_required` with
    `prepublicationAbortRequired=true`.
  - `phase5StartRecoveryDecision()` now carries
    `effectiveTokenExpiresAt` for initial start, queued repair, and running
    renewal.
  - Running resume refuses/renews if existing `upload_token_expires_at` or
    `local_lease_expires_at` exceeds the overall fence or the two stored
    expiries diverge.
- `deployment/instagram-reel-brain/src/index.ts`
  - Added `phase5StartRequestWithEffectiveExpiry()`.
  - Added `phase5ExecutionExpiryPostcondition()`.
  - `phase5RenewProcessingLease()`, `phase5RepairQueuedStart()`, and the
    initial guarded start path now write only the effective expiry.
  - SQL guards now prove `datetime(expires_at) >= datetime(?)` for the
    effective expiry, not merely `expires_at > now`.
  - Postconditions assert
    `jobs.upload_token_expires_at == phase5_local_pilot_fences.local_lease_expires_at == effective expiry`
    and `effective expiry <= overall fence expires_at`.
- `deployment/instagram-reel-brain/tests/phase5-pilot.test.mjs`
  - Added executable boundary tests for:
    - seconds remaining versus multi-hour request;
    - exact 5-minute safe-window plus 30-second margin;
    - one millisecond below that boundary;
    - initial start;
    - running renewal;
    - queued repair;
    - zero processor calls when remaining authority is insufficient.

No implicit overall-fence renewal was added. Stale/insufficient overall
authority remains fail-closed and must use pre-publication abort if no
publication exists.

### Verification after final authority correction

Workstation:

- `npm run typecheck` in `deployment/instagram-reel-brain`: passed.
- `npm test` in `deployment/instagram-reel-brain`: 95/95 Node tests passed.
- Focused Phase 5 test file through the Node runner: 95/95 loaded tests passed.
- `npm test` in `deployment/self-hosted/instagram-reel-brain`: 53 passed,
  1 expected Windows symlink skip.
- `python -m unittest container.test_app -v` in
  `deployment/instagram-reel-brain`: 9/9 Python tests passed.
- `python tests/test_media_processor_api.py` in
  `deployment/self-hosted/instagram-reel-brain`: 3/3 passed.
- `python tests/test_phase4_shadow_mirror.py` in
  `deployment/self-hosted/instagram-reel-brain`: 9/9 passed.
- `python tests/test_phase4_shadow_mirror_connected.py` in
  `deployment/self-hosted/instagram-reel-brain`: 5/5 passed.
- `python -m py_compile` passed for:
  - `deployment/self-hosted/instagram-reel-brain/scripts/phase5_one_job_runner.py`
  - `deployment/self-hosted/instagram-reel-brain/services/media-processor-api/app.py`
- `docker compose -f compose.yaml config --quiet` in
  `deployment/self-hosted/instagram-reel-brain`: passed.

Deployment:

- Immediate pre-deploy Worker `/health`: `ok=true`, `ingest_mode=live`,
  `backlog_processing=false`.
- Immediate pre-deploy D1:
  - queued/running jobs: `0`
  - active Phase 5 fences: `0`
  - active Phase 5 arms: `0`
  - backlog queued/running jobs: `0`
- Worker-only deploy command:
  `npx wrangler deploy --containers-rollout=none`
- Corrective Worker version:
  `2400dec0-ab38-4cc4-b704-2f10d467fba2`
- No container/runtime image rollout was performed.

Post-deploy state:

- Worker `/health`: `ok=true`, `ingest_mode=live`,
  `backlog_processing=false`, `model=gpt-5.6-luna`.
- D1:
  - queued/running jobs: `0`
  - active Phase 5 fences: `0`
  - active Phase 5 arms: `0`
  - backlog queued/running jobs: `0`
- Server:
  - Reel services: all six healthy.
  - News services: healthy.
  - Caddy and PostgreSQL: healthy.
  - Host memory sample: `15Gi` total, `1.7Gi` used, `13Gi` available.

### Enabled/disabled state after final authority correction

Enabled:

- Cloudflare remains the sole general production processing authority.
- Admin-only exact Phase 5 start/finalize/abort routes remain deployed.

Disabled / not performed:

- No live Phase 5 arm.
- No live local job.
- No carousel, retrieval, or note case.
- No historical backlog enumeration/replay/processing.
- No dedicated runtime image deployment.
- No local scheduler, selector, general claim loop, Codex execution loop,
  publication loop, or Instagram outbound loop.
- No credential rotation and no secret plaintext exposure.

### Rollback

Immediate Worker rollback:

1. Roll the Worker back from version
   `2400dec0-ab38-4cc4-b704-2f10d467fba2` to previous version
   `1b7055bd-0a18-41c3-a3f2-17972c8d145b`, or redeploy source before commit
   `5af21e1`.
2. Confirm `/health` returns `ok=true` and `backlog_processing=false`.
3. Confirm D1 has zero queued/running jobs, zero active Phase 5 fences, and
   zero armed Phase 5 captures.

If a future exact pilot has insufficient remaining overall-fence time before
publication, use the exact pre-publication abort path rather than restarting
processor work. If publication already exists, use forward finalize recovery
only.

### Remaining risks after final authority correction

- The authority-bound expiry paths are covered by executable tests and deployed
  with idle checks, but they have not yet been exercised on a second real live
  job.
- D1 guarded multi-row updates still rely on affected-row checks and
  postconditions rather than PostgreSQL-style repository transactions.
- Ubuntu durable live-runner parity is still blocked on a dedicated Reel
  media/Codex runtime. No second live case should run until the supervisor
  approves the next bounded stage.
