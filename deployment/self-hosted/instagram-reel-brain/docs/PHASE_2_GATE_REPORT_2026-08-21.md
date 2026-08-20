# Phase 2 corrective local contract and fixture gate report

Status: corrective implementation complete; awaiting independent review.

Recorded at: 2026-08-21T03:20:21+10:00 Australia/Brisbane

Cloudflare remains the sole production authority. This Phase 2 work does not
authorise production import, R2 backfill, live or shadow intake, local dispatch,
Codex execution, publication, Instagram outbound operations, auth rotation, real
backlog enumeration, real backlog replay, production delta mirroring, or Phase 3.

## Supervisor defects addressed

1. Authority fence
   - `src/domain/authority.js` now exports `PHASE2_PROHIBITED_FLAGS` directly
     from the complete flag map.
   - `assertPhase2FixtureAuthority()` checks every prohibited flag, including
     `mutations` and `archiver`.
   - `tests/phase2-domain.test.mjs` asserts each individual prohibited flag is
     rejected while authority stays `cloud`.

2. Real PostgreSQL integration gate
   - Added connected PostgreSQL tests against an isolated generated schema on
     the server PostgreSQL container.
   - Test schema shape: `reel_phase2_test_<pid>_<timestamp>`.
   - Migrations `0001_phase1_inert_schema.sql` and
     `0002_phase2_local_contracts.sql` are applied into that generated schema,
     then the schema is dropped after the test run.
   - No production rows are imported, selected, replayed, or modified.
   - `PostgresReelRepository` now validates schema names.
   - `markStage()`, `completeJob()`, and `failJob()` now insert events only when
     their guarded job update returns a row. Lost completion/failure guards
     return `null` and create no false terminal event.

3. Object-store confinement
   - `src/storage/local-object-store.js` now checks real parent paths, rejects
     symlink targets with `lstat()`, and verifies final object realpaths remain
     inside the configured storage root.
   - The symlink traversal test attempts a real symlink and skips only when the
     local platform refuses symlink creation. On this Windows host it skipped
     with `EPERM`; the test will execute on platforms with symlink capability.

4. Media processor scope
   - `services/media-processor-api/app.py` now imports and calls the existing
     cloud processor function `inspect_and_extract()` through a fixture-only
     internal API path.
   - Processing remains disabled by default and requires:
     - `REEL_MEDIA_PROCESSOR_ENABLED=true`
     - `REEL_MEDIA_FIXTURE_ONLY=true`
     - `REEL_INTERNAL_API_TOKEN`
     - source paths confined to `REEL_TEST_STORAGE_ROOT`
   - Added malformed JSON, body-size, job-id, root, token, disabled-state, and
     synthetic media tests.
   - The end-to-end fixture uses a generated five-second local MP4 and produces
     frame output through the existing extractor without network, production
     data, Codex, publication, or outbound actions.

5. Scrubbed import fixture
   - Added `fixtures/synthetic/scrubbed-d1-export.json`.
   - Added `src/repositories/scrubbed-importer.js`.
   - The fixture is deterministic and synthetic only. It contains no real user
     content, real article/media content, or credentials.
   - The connected PostgreSQL test imports it into the isolated schema and test
     object root only.

## Local files changed for this corrective gate

- `deployment/self-hosted/instagram-reel-brain/docs/PHASE_2_GATE_REPORT_2026-08-21.md`
- `deployment/self-hosted/instagram-reel-brain/fixtures/synthetic/scrubbed-d1-export.json`
- `deployment/self-hosted/instagram-reel-brain/services/media-processor-api/app.py`
- `deployment/self-hosted/instagram-reel-brain/src/domain/authority.js`
- `deployment/self-hosted/instagram-reel-brain/src/repositories/postgres-reel-repository.js`
- `deployment/self-hosted/instagram-reel-brain/src/repositories/scrubbed-importer.js`
- `deployment/self-hosted/instagram-reel-brain/src/storage/local-object-store.js`
- `deployment/self-hosted/instagram-reel-brain/tests/phase2-domain.test.mjs`
- `deployment/self-hosted/instagram-reel-brain/tests/phase2-postgres-connected.test.mjs`
- `deployment/self-hosted/instagram-reel-brain/tests/phase2-repository.test.mjs`
- `deployment/self-hosted/instagram-reel-brain/tests/phase2-storage-adapters.test.mjs`
- `deployment/self-hosted/instagram-reel-brain/tests/test_media_processor_api.py`

Pre-existing unrelated News Signal and price-watch working-tree changes were
not modified for this corrective gate and must not be treated as Reel Phase 2
evidence.

## Enabled and disabled state

Still enabled:

- Existing six inert Reel health services from Phase 1.
- Existing isolated `cartdotcom-reel-runtime` and `cartdotcom-reel-egress`
  networks.
- Local and connected synthetic/fixture tests.

Still disabled:

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
- Media processor execution by default.
- Cloudflare Whisper, Browser Rendering, R2 mirror, KV/library publication,
  and Instagram outbound adapters.

No host ports, production callbacks, production D1/R2/KV import, production
database writes, real Instagram inbox enumeration, real backlog selection, or
authority changes were performed.

## Test evidence

Self-hosted Reel Node tests:

```text
deployment/self-hosted/instagram-reel-brain> npm test
33 tests
32 passed
0 failed
1 skipped: symlink creation unavailable on this Windows host: EPERM
```

Connected PostgreSQL coverage inside `npm test`:

- Partial unique dedupe allows one active job per dedupe key and allows an
  explicit duplicate-status row.
- Concurrent `FOR UPDATE SKIP LOCKED` claim skips a locked queued row.
- Completion/failure affected-row guards append events only when the guarded
  update changes a row.
- Transaction rollback leaves no interrupted event.
- Resource upsert and artifact write tracking are idempotent.
- Carousel status and pending-part kind constraints reject invalid values.
- Scrubbed D1-shaped export imports into an isolated PostgreSQL schema and test
  object root.
- Schema-name validation rejects unsafe schema names.

Self-hosted Reel Python tests:

```text
deployment/self-hosted/instagram-reel-brain> python -m unittest discover -s tests -p "test_*.py"
3 tests passed
```

Python coverage:

- Disabled-by-default media API refuses fixture processing.
- Malformed JSON returns `400 malformed_json`.
- Oversized body returns `413 request_body_too_large`.
- Synthetic fixture MP4 is processed through the existing cloud
  `inspect_and_extract()` function and emits at least one archived frame.

Additional syntax/config checks:

```text
deployment/self-hosted/instagram-reel-brain> python -m py_compile services\media-processor-api\app.py
passed

deployment/self-hosted/instagram-reel-brain> docker compose -f compose.yaml config --quiet
passed
```

Existing cloud Reel verification, unchanged authority:

```text
deployment/instagram-reel-brain> npm run typecheck
passed

deployment/instagram-reel-brain> npm test
63/63 tests passed

deployment/instagram-reel-brain> python -m unittest discover -s container -p "test*.py"
9/9 tests passed
```

## Health and production idle evidence

Server read-only health check at 2026-08-20T17:18:52Z
(2026-08-21T03:18:52+10:00 Brisbane):

- Six Reel services were running and healthy:
  - `reel-api`
  - `reel-dispatcher`
  - `reel-worker`
  - `reel-publisher`
  - `reel-archiver`
  - `reel-auth-rotator`
- News Signal services were running and healthy.
- Available memory: 14,001 MiB.
- Root volume: 313 GiB available, 6% used.
- Load average: `0.33, 0.89, 0.90`.

Cloudflare Worker `/health`:

```json
{
  "ok": true,
  "service": "cartdotcom-instagram-reel-brain",
  "ingest_mode": "live",
  "backlog_processing": false,
  "model": "gpt-5.6-luna"
}
```

Remote D1 idle/backlog-off query, with `CLOUDFLARE_API_TOKEN` override removed:

```text
active_jobs = 0
pending_dm_parts = 0
carousel_active = 0
backlog_runs = 0
rows_written = 0
changed_db = false
```

## Commit

The earlier Phase 2 baseline commit was `0a4d156`. This corrective gate should
be committed separately after this report is reviewed locally and staged with
only Reel Phase 2 files.

## Rollback

Local rollback after commit:

```bash
git revert <phase-2-corrective-commit>
```

No server rollback is required because no corrective Phase 2 service was
deployed or enabled on the server. Existing Phase 1 health services remain
unchanged.

## Remaining risks and next gate

- The real symlink traversal test was present but could not execute on this
  Windows host because symlink creation returned `EPERM`; it should be run on a
  symlink-capable host before any object-store path is trusted with real data.
- Disabled adapters intentionally provide interfaces but no live capability.
- No production D1/R2/KV parity, artifact backfill, local processing authority,
  shadow intake, or backlog processing has been attempted.
- Phase 3 remains blocked until this corrected Phase 2 report is independently
  reviewed and explicitly accepted.
