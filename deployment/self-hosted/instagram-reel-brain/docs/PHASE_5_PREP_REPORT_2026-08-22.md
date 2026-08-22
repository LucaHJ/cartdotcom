# Phase 5 Preparation Gate Report — 2026-08-22

## Result

Phase 4 was independently accepted and Phase 5 preparation is implemented for a single controlled-compute pilot. No live pilot job has been selected or processed. Cloudflare remains the sole production authority except for a future explicitly fenced one-job local pilot.

## Phase 4 evidence recorded before Phase 5

The independently accepted Phase 4 gate evidence was recorded as:

- Corrected observation window: `2026-08-21T03:01:28Z` through after `2026-08-21T15:01:28Z`.
- Mirror polls: `144`.
- Mirror failures: `0`.
- Live row versions: `409`.
- Current object receipts: `279`.
- Divergences: `0`.
- Mirror errors: `0`.
- Nonempty polls: `12`.
- Health samples: `144`.
- Cloudflare/backlog health failures: `0`.
- Docker health failures: `0`.
- Historical replay remains exactly:
  - `50` jobs.
  - `200` job events.
  - `722` artifacts.
  - `258` resources.
  - `1,075` object receipts.
  - `0` divergences.
  - `0` errors.
- Worker health: `ok`, `ingest_mode=live`, `backlog_processing=false`.
- Reel, News, Caddy, and PostgreSQL services: healthy.

Additional live check during this Phase 5 prep at `2026-08-22T11:50+10:00`:

- Cloudflare Worker `/health`: `ok`, `ingest_mode=live`, `backlog_processing=false`.
- Production D1 jobs: `241 complete`, `4 failed`; no queued/running jobs.
- Active backlog pilots: `0`.
- Phase 5 fences after deployment: `0`.
- Docker services matching Reel, News, Caddy, and PostgreSQL: all healthy.

## Implemented Phase 5 preparation

### Cloud Worker fence

Added an admin-only, one-job Phase 5 local pilot fence:

- `POST /api/admin/phase5/local-pilot/fence`
- `POST /api/admin/phase5/local-pilot/rollback`

Both routes are behind the existing `ADMIN_TOKEN` gate. They require exact durable job identity and exact confirmation phrases. They do not expose unauthenticated routes, new credentials, paid resources, or mutation authority outside the bounded fence table/job-event audit.

Cloud D1 migration:

- `deployment/instagram-reel-brain/migrations/0021_phase5_local_pilot_fence.sql`
- Table: `phase5_local_pilot_fences`
- Active statuses: `armed`, `local_claimed`, `local_processing`
- Terminal statuses: `local_complete`, `rolled_back`, `expired`

The cloud queue processor now checks `phase5_local_pilot_fences` before it marks a job `running` or starts the container. If the exact job is actively fenced, it writes a deduplicated `phase5_local_fenced` audit event and returns without cloud processing. Rollback marks the fence `rolled_back`, resets the job to `queued` unless already complete, records `phase5_local_rollback`, and queues exactly that job back to Cloudflare.

New-share fence:

- The fence route refuses jobs older than `2026-08-21T15:01:28.000Z`.
- It refuses historical pilot/backlog jobs.
- It refuses non-queued jobs.
- It refuses a mismatched `source_message_id`.
- It refuses a second active fence for a different job.

Deployment:

- D1 migration applied remotely: `0021_phase5_local_pilot_fence.sql`.
- Worker version deployed: `4e80693d-cb8f-4728-9528-1f2e6d700d32`.
- First deploy attempt failed because local Docker was unavailable for container image rebuild.
- Successful deploy used `wrangler deploy --containers-rollout=none`; no container rollout occurred.

### Self-hosted local lease and synthetic path

Added non-authoritative local Phase 5 lease tables:

- `deployment/self-hosted/instagram-reel-brain/migrations/0005_phase5_controlled_pilot.sql`
- `phase5_pilot_leases`
- `phase5_pilot_events`

The local migration enforces one active lease at the database level via partial unique index `phase5_pilot_leases_one_active_idx`.

Added repository methods:

- `createPhase5PilotLease()`
- `claimPhase5PilotLease()`
- `heartbeatPhase5PilotLease()`
- `markPhase5PilotProcessing()`
- `completePhase5PilotLease()`
- `rollbackPhase5PilotLease()`
- `insertPhase5PilotEvent()`

Added synthetic-only pipeline:

- `deployment/self-hosted/instagram-reel-brain/src/domain/phase5-synthetic-pipeline.js`

The synthetic pipeline exercises:

- Media artifact write.
- Transcript artifact write.
- Codex output schema artifact write.
- Token accounting.
- Reaction targeting audit.
- HTML publication artifact write.
- Private playback manifest artifact write.
- R2 mirror receipt artifact write.

It uses local fixtures only and does not call Instagram, Codex, Cloudflare R2/KV/Queues, Browser Rendering, or any outbound service.

## Enabled state

- Cloudflare production intake remains live.
- Cloudflare D1/R2/KV remain available.
- Cloudflare queue remains the default processing authority.
- Empty Phase 5 fence table exists in D1.
- Worker can fence exactly one explicitly identified new queued job after admin approval.
- Local repository can record one synthetic/pilot lease in isolated PostgreSQL schemas.
- Synthetic-only local processing harness exists for tests.

## Disabled state

- No local live intake.
- No unrestricted local claims.
- No general local Codex execution.
- No general publication or outbound delivery.
- No Instagram reactions/messages from local services.
- No auth rotation.
- No backlog processing.
- No historical backlog enumeration/replay/selection.
- No Phase 6 authority cutover.
- No live Phase 5 pilot job selected yet.

## Verification

Commands run:

```powershell
npm run typecheck
npm test
```

from `deployment/instagram-reel-brain`:

- TypeScript: passed.
- Cloud Node tests: `79/79` passed.

```powershell
npm test
```

from `deployment/self-hosted/instagram-reel-brain`:

- Self-hosted Node tests: `49` passed, `1` expected Windows symlink skip, `0` failed.
- Connected isolated PostgreSQL Phase 5 test passed and proved:
  - one active lease enforced by `phase5_pilot_leases_one_active_idx`;
  - exact-job claim;
  - wrong-job claim refusal;
  - rollback event persistence.

```powershell
python -m unittest tests.test_media_processor_api tests.test_phase4_shadow_mirror tests.test_phase4_shadow_mirror_connected
```

from `deployment/self-hosted/instagram-reel-brain`:

- Python/media tests: `17/17` passed.

Production/server verification:

```powershell
Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
npx wrangler d1 execute REEL_DB --remote --command "<read-only status queries>"
Invoke-WebRequest https://cartdotcom-instagram-reel-brain.lucajeannin.workers.dev/health
ssh cartdotcom-server "docker ps ..."
ssh cartdotcom-server "docker stats --no-stream ..."
```

Results:

- Worker health `ok`.
- `ingest_mode=live`.
- `backlog_processing=false`.
- Production jobs unchanged after deploy: `241 complete`, `4 failed`.
- Active backlog pilots: `0`.
- Phase 5 fences: `0`.
- Active Phase 5 fences: `0`.
- Reel, News, Caddy, PostgreSQL containers: healthy.

## Rollback

One-command rollback for a fenced pilot job:

```http
POST /api/admin/phase5/local-pilot/rollback
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json

{
  "pilot_key": "<exact pilot key>",
  "job_id": "<exact job id>",
  "confirm_rollback": "ROLL BACK PHASE 5 LOCAL PILOT JOB",
  "reason": "<operator reason>"
}
```

Expected effect:

- Fence status becomes `rolled_back`.
- Job is reset to `queued` unless already `complete`.
- `phase5_local_rollback` job event is written.
- Exactly that job is sent back to the Cloudflare queue.
- Repeat calls are idempotent after `rolled_back`.

Deployment rollback:

```powershell
Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
npx wrangler rollback
```

The D1 table is empty and inert unless an admin explicitly creates a fence. If needed, a later migration can mark all active fences `rolled_back`; do not drop the table if it contains evidence.

## Readiness gate for first live pilot

Stop point reached. A live Phase 5 pilot must not start until a brand-new Reel share is explicitly identified.

Minimal user action:

1. Send one brand-new test Reel to the Instagram system account.
2. Tell the operator this exact share is the Phase 5 pilot candidate.
3. The operator must identify the durable `job_id` and `source_message_id`, then create the cloud fence for that exact queued job.

After the fence exists, only that one job may be processed locally. A separate gate report is required before any carousel, retrieval case, second pilot, Phase 6 work, or general authority cutover.

## Remaining risks

- The cloud fence/admin endpoints are deployed but have not yet been exercised against a real new share because no new pilot share has been explicitly identified.
- The local synthetic path proves stage plumbing and storage contracts only; real Codex/media execution remains gated to the first fenced job.
- If a fenced job expires before local processing starts, cloud processing will not automatically run until rollback/requeue is issued.
- Container deploy still requires local Docker unless using `--containers-rollout=none`; this was acceptable for this Worker-only change.
