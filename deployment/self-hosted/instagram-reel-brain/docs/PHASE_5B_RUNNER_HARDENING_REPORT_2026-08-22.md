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
