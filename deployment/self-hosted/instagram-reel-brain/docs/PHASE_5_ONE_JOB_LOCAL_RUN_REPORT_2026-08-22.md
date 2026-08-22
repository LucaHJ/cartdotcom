# Phase 5 one-job local runner gate report — 2026-08-22

Report timestamp: 2026-08-22T13:01:11+10:00

## Scope

Approved bounded stage: process exactly one pre-intake captured Reel job locally, then stop for supervisor review.

Exact pilot:

- Pilot key: `phase5-next-reel-20260822-122532`
- Job id: `b14b79a0-9264-4613-9421-9920cba053c3`
- Source message id: `aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQxNDM3ODExNDU0ODI0OjM0MDI4MjM2Njg0MTcxMDMwMTI0NDI1OTY0MTgwMDA0NTY2ODc1NDozMjk3MTA3NTY1NjE3ODAyMTkxMTMzMjU4ODYzMDMxMDkxMgZDZD`
- Lease owner: `phase5-local-worker-1`
- Source URL: `https://www.instagram.com/reel/DcRqZUgxTTJ/`

Still prohibited and unchanged: unrestricted local claims, backlog processing, carousel/retrieval pilots, Phase 6, local authority cutover, auth rotation, and any historical replay/processing.

## Code changes

- `deployment/instagram-reel-brain/src/phase5-pilot.ts`
  - Added exact lease-renewal confirmation and bounded six-hour renewal validation.
- `deployment/instagram-reel-brain/src/index.ts`
  - Added admin-only exact Phase 5 renewal route.
  - Hardened renewal as a guarded update checked by affected-row count before audit insertion.
  - Added callback fence validation: when a Phase 5 fence exists for a job, upload/transcription/stage/complete callbacks only pass while the fence is `local_processing`, unexpired, and has a local lease owner.
- `deployment/instagram-reel-brain/tests/phase5-pilot.test.mjs`
  - Added renewal and callback-fence tests.
- `deployment/self-hosted/instagram-reel-brain/src/domain/phase5-pilot.js`
  - Added local renewal confirmation and six-hour renewal cap.
- `deployment/self-hosted/instagram-reel-brain/src/repositories/postgres-reel-repository.js`
  - Added exact local lease-renewal method guarded by local lease, exact source message, queued job, and no completion/publication evidence.
- `deployment/self-hosted/instagram-reel-brain/scripts/phase5_exact_pilot_guard.py`
  - Added secret-free operator utility for exact local checks plus authenticated cloud renew/rollback calls.
- `deployment/self-hosted/instagram-reel-brain/scripts/phase5_one_job_runner.py`
  - Added disabled-by-default one-shot runner requiring exact pilot/job/source/owner plus exact live-run confirmation.
  - Runner verifies cloud fence and local lease, mints one callback token for the exact job, starts the job through guarded D1 mutation, imports the production processor, strips returned auth data from output, marks cloud fence/local lease complete, and exits.
- `deployment/self-hosted/instagram-reel-brain/tests/phase5-pilot.test.mjs`
  - Added guard and runner tests.

## Deployments

- Worker renewal route deployed initially as `a5d7d24c-8c49-45e2-a8dc-877e5b8b1af4`.
- Final Worker callback-fence guard deployed as `b24cf2ea-1536-42d3-8647-7a700eeccc16`.
- Deployment command used the existing logged-in Wrangler session with the stale `CLOUDFLARE_API_TOKEN` override removed:

```powershell
Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
npx wrangler deploy --containers-rollout=none
```

No container rollout, paid resource, credential rotation, or new production resource was performed.

## Lease renewal evidence

The original cloud/local lease expiring at `2026-08-22T03:31:30.030Z` was renewed before broader implementation.

Renewed cloud fence:

- `status='local_claimed'`
- `local_lease_owner='phase5-local-worker-1'`
- `local_lease_expires_at='2026-08-22T08:40:59.535Z'`
- `expires_at='2026-08-22T08:40:59.535Z'`
- Audit event: `phase5_local_lease_renewed`

Renewed local PostgreSQL lease in schema `reel_phase4_shadow_20260821_014246`:

- `status='leased'`
- `lease_owner='phase5-local-worker-1'`
- `lease_expires_at='2026-08-22T08:40:59.535+00:00'`
- Local event: `lease_renewed`

## Test evidence

Cloud:

```powershell
npm run typecheck
npm test
```

Result: typecheck passed; Node tests passed `86/86`.

Self-hosted:

```powershell
npm test
```

Result: `52` passed, `1` expected Windows symlink skip.

Read-only media smoke before live start:

```powershell
python deployment/instagram-reel-brain/container/app.py --local-smoke https://www.instagram.com/reel/DcRqZUgxTTJ/ <temp>
```

Result: download, audio extraction, and frame extraction passed.

- Video bytes: `1,697,327`
- Audio extracted: yes
- Frames extracted: `3`
- Metadata author: `calituresdream`
- Description: `what is that??`

## Live one-job run

Command shape:

```powershell
python scripts/phase5_one_job_runner.py `
  --pilot-key phase5-next-reel-20260822-122532 `
  --job-id b14b79a0-9264-4613-9421-9920cba053c3 `
  --source-message-id <exact source message id> `
  --lease-owner phase5-local-worker-1 `
  --confirm-live-run "RUN EXACT PHASE 5 LOCAL PILOT b14b79a0-9264-4613-9421-9920cba053c3"
```

Runner result:

```json
{
  "ok": true,
  "job_id": "b14b79a0-9264-4613-9421-9920cba053c3",
  "pilot_key": "phase5-next-reel-20260822-122532",
  "result": {
    "ok": true,
    "job_id": "b14b79a0-9264-4613-9421-9920cba053c3",
    "shortcode": "DcRqZUgxTTJ",
    "frames": 3,
    "carousel_items": 0,
    "resources": 4,
    "resumed_research": false
  }
}
```

## Production result

Cloud D1 job state:

- `status='complete'`
- `stage='complete'`
- title: `Video by calituresdream`
- author: `calituresdream`
- description: `what is that??`
- `processing_seconds=85.3`
- `completed_at='2026-08-22 02:59:52'`
- `html_key='library/reels/b14b79a0-9264-4613-9421-9920cba053c3/index.html'`
- `library_path='reels/calituresdream/dcrqzugxttj/index.html'`

Token accounting:

- input: `80,848`
- cached input: `44,800`
- output: `2,807`
- reasoning output: `623`
- total: `83,655`

Artifacts recorded in D1/R2:

- video: `reels/DcRqZUgxTTJ/b14b79a0-9264-4613-9421-9920cba053c3/video/attempt-1/original.mp4`, `1,697,327` bytes
- audio: `reels/DcRqZUgxTTJ/b14b79a0-9264-4613-9421-9920cba053c3/audio/attempt-1/audio.mp3`, `161,424` bytes
- transcript: `reels/DcRqZUgxTTJ/b14b79a0-9264-4613-9421-9920cba053c3/transcript/attempt-1/transcript.json`, `68` bytes
- synthesis: `reels/DcRqZUgxTTJ/b14b79a0-9264-4613-9421-9920cba053c3/synthesis/attempt-1/synthesis.json`, `12,725` bytes
- metadata: `metadata.json` and `media-probe.json`
- comments: `comments.json`
- frames: `frame-01.jpg`, `frame-02.jpg`, `frame-03.jpg`

Resources published:

- `Elytra` — `other` — `https://minecraft.wiki/w/Elytra`
- `End City` — `place` — `https://minecraft.wiki/w/End_City`
- `Minecraft` — `software` — `https://www.minecraft.net/en-us/about-minecraft`
- `Vibrant Visuals` — `technique` — `https://www.minecraft.net/en-us/vibrant-visuals-update`

Cloud Phase 5 fence:

- `status='local_complete'`
- `local_lease_owner='phase5-local-worker-1'`
- `completed_at='2026-08-22 02:59:56'`
- `rollback_at=NULL`

Local PostgreSQL lease:

- schema: `reel_phase4_shadow_20260821_014246`
- `status='completed'`
- `lease_owner='phase5-local-worker-1'`
- `completed_at='2026-08-22T02:59:56.768965+00:00'`
- `rollback_at=NULL`

## Reactions and publication

Cloud job events show the status path:

- `phase5_local_processing`
- `synthesizing` with emoji `💬`
- `complete` with emoji `✅`
- `phase5_local_complete` with emoji `✅`

The production `setStage()` callback path was used for synthesis and completion, so Instagram reaction targeting used the same source message id as cloud processing.

The public HTML fetch through `/api/jobs/<id>/html` correctly returned `Unauthorised` without admin credentials; this was expected because that API is admin-gated. Publication evidence is therefore D1/R2-backed rather than an unauthenticated page fetch.

## Post-run health and idle state

Cloudflare health:

```json
{
  "ok": true,
  "service": "cartdotcom-instagram-reel-brain",
  "ingest_mode": "live",
  "backlog_processing": false,
  "model": "gpt-5.6-luna"
}
```

Production queue/fence state after completion:

- queued/running jobs: none
- active Phase 5 fences: `0`

Local mirror:

- row versions: `822`
- object receipts: `538`
- divergences: `0`
- errors: `0`

Server containers:

- all Reel containers healthy
- all News containers healthy
- Caddy healthy
- PostgreSQL healthy

## Rollback procedure

The one-command cloud rollback remains:

```powershell
$env:PHASE5_ADMIN_TOKEN = '<from secret store>'
python deployment/self-hosted/instagram-reel-brain/scripts/phase5_exact_pilot_guard.py rollback-cloud `
  --pilot-key phase5-next-reel-20260822-122532 `
  --job-id b14b79a0-9264-4613-9421-9920cba053c3 `
  --source-message-id <exact source message id> `
  --lease-owner phase5-local-worker-1 `
  --reason operator_requested_phase5_local_rollback
```

Because this job is now complete, rollback should not be used unless explicitly directed after review; the cloud rollback route refuses completed jobs.

For pre-completion failures, the rollback route restores the exact job to Cloudflare queue and marks the active Phase 5 fence rolled back. It does not process historical backlog.

## Remaining risks and next gate

- The one-shot runner executed from the workstation because the Ubuntu server does not currently have Codex auth and media/Codex runtime parity ready for live execution. This is acceptable only for this bounded pilot evidence; a durable server runner remains future work before broader local authority.
- The runner depends on the existing local Codex auth file. No auth value was printed or committed.
- No second pilot, carousel, retrieval, backlog, or Phase 6 work is approved.

Recommended next bounded stage for supervisor review:

1. Independently inspect job `b14b79a0-9264-4613-9421-9920cba053c3`, R2 artifacts, published library output, and Instagram reaction result.
2. Decide whether to approve one additional exact Reel pilot with a server-hosted runner readiness requirement, or require server Codex/media runtime provisioning before any further live local processing.
