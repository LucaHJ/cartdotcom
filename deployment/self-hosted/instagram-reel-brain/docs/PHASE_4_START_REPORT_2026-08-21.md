# Phase 4 shadow live intake start report — 2026-08-21

Status: corrected Phase 4 observation start ready for independent review.

Cloudflare remains the sole production processing authority. This phase starts
a post-watermark, read-only, authenticated pull mirror from Cloudflare to an
isolated local PostgreSQL schema and object root on the Ubuntu server. It does
not enable local intake, job claims, dispatch, Codex, publication, Instagram
outbound operations, auth rotation, backlog processing, or any Phase 5 work.

## Correction summary

Independent review found reliability defects in the initial observation start.
The original token, watermark, run directory, schema, and Phase 3 evidence were
preserved. Before correction, inspection found no nonempty mirrored live rows or
objects:

- typed operational rows in all mirrored tables: `0`
- row versions: `0`
- object receipts: `0`
- typed hashes: `0`
- mirror errors: `0`
- divergences: `0`
- filesystem cursor evidence: present, but all cursors were null and all
  row-count state was zero.

Corrected formal observation gate start:
`2026-08-21T02:05:01Z`, the first healthy supervised health sample after the
corrected Worker, corrected puller, and supervised cron watchdogs were running.

Corrections applied:

- Worker delta endpoint now returns `next_cursor` for every nonempty page,
  including a page shorter than `limit`.
- `pending_dm_parts` and `dm_commands` now require their own
  `created_at >= watermark` scope in addition to update-aware cursors, so old
  historical pending/command rows updated after the watermark are excluded.
- Puller now reads cursors from PostgreSQL as the source of truth.
- Filesystem cursor JSON is written only after the PostgreSQL transaction
  succeeds.
- Object downloads are written to temporary/quarantine paths and verified
  before final rename. Corrupt/truncated downloads or existing divergent final
  files are preserved as evidence, recorded as divergences, and block cursor
  advancement.
- Same table/source key/mirror timestamp with a different row hash is detected
  and fails closed before typed overwrite.
- Local typed-row hash state is recorded to detect unsafe same-version drift
  before overwrite.
- Raw `nohup` PID loops were stopped after supervised replacements passed.
- Native user-cron supervision was installed because system-level systemd
  required an interactive sudo password and user-systemd linger is disabled.
  The cron watchdogs are enabled at boot, single-instance via `flock`, low
  priority via `nice`/`ionice`, restart-safe, and do not contain the token
  value.

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

- Initial implementation commit: `fa7eb3c`.
- Initial report metadata commit: `879d821`.
- Corrective implementation commit:
  `7cf904e9002319de3cc5bba709678e8819e8d3b5`.
- Previous live deployment version recorded before deploy:
  `ad8103cc-2995-4ee8-9ed1-d1dee24ad6c1`.
- Deployment inventory command:
  `npx wrangler deployments list`.
- Initial Phase 4 Worker version:
  `03f8aeb4-25b7-4b6c-b7d3-dc2fd12f2f83`.
- Corrected Worker version:
  `dda475df-5a3b-4b6f-bcbb-d538c4f96f18`.
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

1. Remove the marked crontab block between
   `# BEGIN INSTAGRAM REEL PHASE4 MIRROR` and
   `# END INSTAGRAM REEL PHASE4 MIRROR`.
2. Stop supervised mirror observation:
   `kill $(cat /srv/cartdotcom/reel-brain-runs/phase4-shadow/2026-08-21_01-42-46/mirror-supervised.pid)`.
3. Roll back the Worker to version `03f8aeb4-25b7-4b6f-bcbb-d538c4f96f18` or
   the pre-Phase-4 version `ad8103cc-2995-4ee8-9ed1-d1dee24ad6c1` from the
   Cloudflare dashboard or `wrangler deployments rollback` if available.
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
  - Returns a cursor for every nonempty page, including partial final pages.
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

- Initial raw mirror loop PID: `3061014`, stopped after supervised replacement
  passed.
- Initial raw health sampler PID: `3066074`, stopped after supervised
  replacement passed.
- Supervised mirror PID before interruption test: `3107256`, intentionally
  killed.
- Supervised mirror PID after cron watchdog restart: `3107996`.
- Supervision:
  - `@reboot /srv/cartdotcom/instagram-reel-brain/scripts/phase4_mirror_watchdog.sh`
  - `* * * * * /srv/cartdotcom/instagram-reel-brain/scripts/phase4_mirror_watchdog.sh`
  - `@reboot /srv/cartdotcom/instagram-reel-brain/scripts/phase4_health_watchdog.sh`
  - `*/5 * * * * /srv/cartdotcom/instagram-reel-brain/scripts/phase4_health_watchdog.sh`
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
  - typed hashes: 0
  - mirror errors: 0
  - divergences: 0

## Tests and verification

Cloud Worker:

- `npm run typecheck`: passed.
- `npm test`: 69/69 passed.

Self-hosted:

- `python -m py_compile scripts/phase4_shadow_mirror.py`: passed.
- `python scripts/phase4_shadow_mirror.py static-audit`: passed.
- `python tests/test_phase4_shadow_mirror.py`: 8/8 passed.
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
- Post-correction D1 active jobs: 0 queued/running/downloading/synthesising.
- Post-correction active pilots: 0.
- Post-correction active carousel resolutions: 0.

Server health/resource checks:

- Reel containers: healthy.
- News Signal containers: healthy.
- Caddy/PostgreSQL: healthy.
- `/srv`: 310 GiB available, 7% used after correction.
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
- `deployment/self-hosted/instagram-reel-brain/scripts/phase4_health_sample.py`
- `deployment/self-hosted/instagram-reel-brain/scripts/phase4_mirror_watchdog.sh`
- `deployment/self-hosted/instagram-reel-brain/scripts/phase4_health_watchdog.sh`
- `deployment/self-hosted/instagram-reel-brain/tests/test_phase4_shadow_mirror.py`
- `deployment/self-hosted/instagram-reel-brain/docs/PHASE_4_START_REPORT_2026-08-21.md`
- `deployment/self-hosted/instagram-reel-brain/docs/INSTAGRAM_REEL_MIGRATION_STATE.md`
- `deployment/self-hosted/instagram-reel-brain/docs/CHANGELOG.md`

Server-side copied files:

- `/srv/cartdotcom/instagram-reel-brain/migrations/0002_phase2_local_contracts.sql`
- `/srv/cartdotcom/instagram-reel-brain/migrations/0003_phase3_cloud_schema_drift.sql`
- `/srv/cartdotcom/instagram-reel-brain/migrations/0004_phase4_shadow_live_mirror.sql`
- `/srv/cartdotcom/instagram-reel-brain/scripts/phase4_shadow_mirror.py`
- `/srv/cartdotcom/instagram-reel-brain/scripts/phase4_health_sample.py`
- `/srv/cartdotcom/instagram-reel-brain/scripts/phase4_mirror_watchdog.sh`
- `/srv/cartdotcom/instagram-reel-brain/scripts/phase4_health_watchdog.sh`

Server-side supervisor state:

- User crontab contains the marked Phase 4 block shown above.
- Old raw PID files/logs remain preserved in the run directory.
- New supervised logs:
  - `mirror-supervised.log`
  - `health-supervised.log`
  - `health-samples.jsonl`

## Remaining risks and gate conditions

- The seven-day or 50-varied-input Phase 4 observation gate has only started;
  it has not passed.
- No post-watermark Instagram input has arrived yet, so nonempty row/object
  mirroring is proven by implementation-connected synthetic tests rather than
  live Instagram traffic.
- System-level systemd could not be installed without interactive sudo. Native
  user-cron watchdog supervision is installed instead and has passed a kill /
  restart / resume check without rebooting the server.
- The mirror endpoint is intentionally narrow. Any future need to mirror KV-only
  collection indexes must be approved separately or rebuilt locally from typed
  rows and copied R2 library files.
- Phase 5 remains blocked pending independent review.
