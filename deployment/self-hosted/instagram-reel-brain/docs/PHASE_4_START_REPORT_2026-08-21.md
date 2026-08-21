# Phase 4 shadow live intake start report — 2026-08-21

Status: started for independent review.

Cloudflare remains the sole production processing authority. This phase starts
a post-watermark, read-only, authenticated pull mirror from Cloudflare to an
isolated local PostgreSQL schema and object root on the Ubuntu server. It does
not enable local intake, job claims, dispatch, Codex, publication, Instagram
outbound operations, auth rotation, backlog processing, or any Phase 5 work.

## Start watermark

- Watermark: `2026-08-21T01:42:46Z`.
- Server run directory:
  `/srv/cartdotcom/reel-brain-runs/phase4-shadow/2026-08-21_01-42-46`.
- Local shadow schema: `reel_phase4_shadow_20260821_014246`.
- Object root:
  `/srv/cartdotcom/reel-brain-runs/phase4-shadow/2026-08-21_01-42-46/objects`.
- Mirror token file:
  `/srv/cartdotcom/reel-brain-secrets/phase4-mirror-token`.
- Token file mode: `0600`.
- Historical pending DM parts at preflight: 46 unconsumed rows. They are
  excluded by the start watermark and are not processed, replayed, or claimed.

## Worker backup and deployment

- Implementation commit: `fa7eb3c` (amended after report finalisation).
- Previous live deployment version recorded before deploy:
  `ad8103cc-2995-4ee8-9ed1-d1dee24ad6c1`.
- Deployment inventory command:
  `npx wrangler deployments list`.
- New Worker version:
  `03f8aeb4-25b7-4b6c-b7d3-dc2fd12f2f83`.
- Initial `npx wrangler deploy` failed because local Docker Desktop was not
  available to rebuild the configured container image.
- Final deploy command:
  `npx wrangler deploy --containers-rollout=none`.
- Container image rollout: explicitly disabled. No container code or image was
  changed.
- New secret: `PHASE4_MIRROR_TOKEN`, installed through Wrangler's secret input
  path. The plaintext was not printed, committed, logged, placed in URLs, or
  passed as a process argument.

Immediate rollback:

1. Roll back the Worker to version `ad8103cc-2995-4ee8-9ed1-d1dee24ad6c1` from
   the Cloudflare dashboard or `wrangler deployments rollback` if available.
2. Stop local mirror observation:
   `kill $(cat /srv/cartdotcom/reel-brain-runs/phase4-shadow/2026-08-21_01-42-46/mirror-loop.pid)`.
3. Stop local health sampling:
   `kill $(cat /srv/cartdotcom/reel-brain-runs/phase4-shadow/2026-08-21_01-42-46/health-monitor.pid)`.
4. Disable, rename, or leave inert the shadow schema and run directory for
   evidence preservation. Do not delete Phase 3 or Phase 4 evidence during
   rollback.

## Endpoint contract

- `GET /api/phase4/mirror/delta`
  - Requires `Authorization: Bearer <PHASE4_MIRROR_TOKEN>`.
  - Rejects missing/invalid token with `401`.
  - Rejects non-GET methods with `405`.
  - Requires an ISO `watermark`.
  - Allows only these tables:
    `jobs`, `job_events`, `artifacts`, `resources`, `notes`, `dm_commands`,
    `outbound_events`, `pending_dm_parts`,
    `instagram_carousel_resolutions`, `inbound_webhook_events`.
  - Paginates with a bounded limit, capped at 200.
  - Returns only rows scoped at or after the Phase 4 watermark. Mutable tables
    use update-aware `mirror_updated_at` cursors so completed-job state is not
    missed after an initial queued row is mirrored.
  - Excludes `runtime_secrets`, `settings`, `upload_token_hash`, and
    `upload_token_expires_at`.
- `GET /api/phase4/mirror/object`
  - Requires the same bearer token.
  - Rejects non-GET methods.
  - Rejects traversal/absolute object keys.
  - Returns an R2 object only if the key is referenced by a post-watermark job,
    resource, or artifact row.
  - Does not expose any PUT, DELETE, multipart, queue, admin, intake, or
    backlog operation.

Live endpoint checks from the Ubuntu server:

- Unauthenticated GET to `/api/phase4/mirror/delta`: `401`.
- Authenticated POST to `/api/phase4/mirror/delta`: `405`.
- Authenticated GET to `/api/phase4/mirror/delta`: `200`, table `jobs`, count
  `0`.
- The Ubuntu Python client requires an explicit `User-Agent`; otherwise the
  request is blocked by Cloudflare error 1010 before reaching the Worker. The
  mirror script uses `phase4-shadow-mirror/1.0`.

## Server mirror state

- Mirror loop PID: `3061014`.
- Health sampler PID: `3066074`.
- Initial manual poll:
  - rows: `0`
  - objects checked: `0`
  - created at: `2026-08-21T01:42:56.589949+00:00`
- First background loop poll:
  - rows: `0`
  - objects checked: `0`
  - created at: `2026-08-21T01:43:28.903756+00:00`
- PostgreSQL schema check:
  - schema exists: true
  - `processing_authority.mode`: `cloud`
  - `dispatch_enabled`: false
  - `codex_enabled`: false
  - `outbound_enabled`: false
  - `backlog_enabled`: false
  - cursor tables: 10
  - row versions: 0
  - object receipts: 0
  - mirror errors: 0
  - divergences: 0

## Tests and verification

Cloud Worker:

- `npm run typecheck`: passed.
- `npm test`: 68/68 passed.

Self-hosted:

- `python -m py_compile scripts/phase4_shadow_mirror.py`: passed.
- `python scripts/phase4_shadow_mirror.py static-audit`: passed.
- `python tests/test_phase4_shadow_mirror.py`: 5/5 passed.
- `npm test`: 45/46 passed, with the known Windows symlink capability skip.
- `python -m unittest tests/test_media_processor_api.py`: 3/3 passed.

Production checks:

- Cloudflare `/health`: ok, `ingest_mode=live`,
  `backlog_processing=false`.
- Pre-watermark D1 active jobs: 0 queued/running/downloading/synthesising.
- Pre-watermark active pilots: 0.
- Pre-watermark active carousel resolutions: 0.
- Post-start D1 active jobs: 0 queued/running/downloading/synthesising.
- Post-start active pilots: 0.
- Post-start active carousel resolutions: 0.

Server health/resource checks:

- Reel containers: healthy.
- News Signal containers: healthy.
- Caddy/PostgreSQL: healthy.
- `/srv`: 311 GiB available, 7% used.
- Host load after mirror start: `0.82, 0.57, 0.49`.
- A transient Docker stats sample showed elevated Postgres/News CPU during
  inspection; a follow-up host/process sample showed normal host load and
  Postgres at 0.02% Docker CPU. No material News regression is evident.

## Files changed

- `deployment/instagram-reel-brain/src/index.ts`
- `deployment/instagram-reel-brain/src/phase4-mirror.ts`
- `deployment/instagram-reel-brain/tests/phase4-mirror.test.mjs`
- `deployment/self-hosted/instagram-reel-brain/migrations/0004_phase4_shadow_live_mirror.sql`
- `deployment/self-hosted/instagram-reel-brain/scripts/phase4_shadow_mirror.py`
- `deployment/self-hosted/instagram-reel-brain/tests/test_phase4_shadow_mirror.py`
- `deployment/self-hosted/instagram-reel-brain/docs/PHASE_4_START_REPORT_2026-08-21.md`
- `deployment/self-hosted/instagram-reel-brain/docs/INSTAGRAM_REEL_MIGRATION_STATE.md`
- `deployment/self-hosted/instagram-reel-brain/docs/CHANGELOG.md`

Server-side copied files:

- `/srv/cartdotcom/instagram-reel-brain/migrations/0002_phase2_local_contracts.sql`
- `/srv/cartdotcom/instagram-reel-brain/migrations/0003_phase3_cloud_schema_drift.sql`
- `/srv/cartdotcom/instagram-reel-brain/migrations/0004_phase4_shadow_live_mirror.sql`
- `/srv/cartdotcom/instagram-reel-brain/scripts/phase4_shadow_mirror.py`

## Remaining risks and gate conditions

- The seven-day or 50-varied-input Phase 4 observation gate has only started;
  it has not passed.
- No post-watermark Instagram input has arrived yet, so row/object mirroring is
  proven only for the empty live path and synthetic tests.
- The background mirror is a `nohup` process, not a systemd unit. It writes
  durable cursors and logs, but process supervision remains basic until Phase 4
  is reviewed.
- The mirror endpoint is intentionally narrow. Any future need to mirror KV-only
  collection indexes must be approved separately or rebuilt locally from typed
  rows and copied R2 library files.
- Phase 5 remains blocked pending independent review.
