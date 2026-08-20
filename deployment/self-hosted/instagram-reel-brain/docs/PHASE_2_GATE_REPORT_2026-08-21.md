# Phase 2 corrective local contract and fixture gate report

Status: corrective implementation complete; awaiting independent review.

Last updated at: 2026-08-21T03:52:10+10:00 Australia/Brisbane

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

6. Persistent PostgreSQL session and atomic transitions
   - The connected PostgreSQL harness now keeps one persistent
     `ssh -> docker exec -> psql` process open per connected client.
   - Repository `withTransaction()` is now exercised against one real database
     session; `BEGIN`, callback queries, and `COMMIT`/`ROLLBACK` no longer run
     in separate `psql` sessions.
   - Public state-transition methods `markStage()`, `completeJob()`, and
     `failJob()` are atomic by construction. Each method now wraps its guarded
     state update and job-event insert in `withTransaction()`.
   - The mutation bodies are private class methods, so callers cannot bypass
     the transaction boundary through the public repository API.
   - Added a connected interruption test that throws after the state update and
     before event insertion. The real PostgreSQL rollback leaves the job state
     and event table unchanged.

7. Linux object-store symlink gate
   - Copied the corrected `local-object-store.js`,
     `disabled-adapters.js`, and `phase2-storage-adapters.test.mjs` into a
     temporary directory on the Ubuntu server.
   - Ran the copied test surface with the already-present `node:22-alpine`
     Docker image.
   - The symlink escape test executed and passed on Linux with zero skips.

8. Execution-context-specific transaction nesting
   - Replaced repository-global `transactionDepth` with `AsyncLocalStorage`
     keyed by the current async execution context.
   - Added a WeakMap-backed async mutex keyed by the client object, so unrelated
     top-level transactions sharing a single-session client are serialized
     rather than joined.
   - Genuine nested calls in the same async transaction context reuse the
     existing transaction.
   - Unrelated concurrent public transitions cannot interleave into one
     transaction. A failing transition rolls back only its own state update; a
     concurrent succeeding transition begins after that rollback and commits
     independently.

9. Context-aware standalone query isolation
   - Added one repository query gate used by every job, event, resource, and
     artifact SQL operation.
   - When the current async context owns this client's transaction, the query
     executes directly inside that transaction.
   - Otherwise the query acquires the same client lock used by
     `withTransaction()` for the duration of that standalone statement.
   - `insertJobEvent()` remains callable inside a transaction without deadlock
     because the transaction-owning async context bypasses the standalone lock.
   - Audited `PostgresReelRepository`: the only direct `this.client.query` call
     is the private raw-query helper used by the context-aware gate and
     transaction-control statements. All repository SQL operation call sites use
     `this.query()`.
   - Added fixture and connected PostgreSQL tests where a transaction pauses and
     fails while unrelated `createJob()`, `upsertResource()`, and
     `recordArtifactWrite()` calls are started. Those calls wait until rollback,
     then commit independently and persist.

## Local files changed for this corrective gate

- `deployment/self-hosted/instagram-reel-brain/docs/PHASE_2_GATE_REPORT_2026-08-21.md`
- `deployment/self-hosted/instagram-reel-brain/fixtures/synthetic/scrubbed-d1-export.json`
- `deployment/self-hosted/instagram-reel-brain/services/media-processor-api/app.py`
- `deployment/self-hosted/instagram-reel-brain/src/domain/authority.js`
- `deployment/self-hosted/instagram-reel-brain/src/repositories/fixture-client.js`
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
41 tests
40 passed
0 failed
1 skipped: symlink creation unavailable on this Windows host: EPERM
```

Connected PostgreSQL coverage inside `npm test`:

- Partial unique dedupe allows one active job per dedupe key and allows an
  explicit duplicate-status row.
- Concurrent `FOR UPDATE SKIP LOCKED` claim skips a locked queued row.
- Completion/failure affected-row guards append events only when the guarded
  update changes a row.
- Repository `withTransaction()` rollback uses one persistent PostgreSQL
  session and leaves no interrupted state or event.
- Public transition interruption between state update and event insertion rolls
  back both the state update and event insertion.
- Genuine nested calls share one transaction context.
- Unrelated concurrent top-level public transitions on one client are serialized
  and cannot share an outer transaction accidentally.
- Transaction state is released after both rollback and commit.
- Connected PostgreSQL proves unrelated concurrent transitions do not share a
  transaction; the failing transition rolls back while the succeeding transition
  commits separately.
- Standalone `createJob()`, `upsertResource()`, and `recordArtifactWrite()`
  calls started during an unrelated open transaction wait for rollback, then
  commit independently and survive the failed transaction.
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

Ubuntu object-store symlink gate:

```text
ssh cartdotcom-server
docker run --rm -v /tmp/reel-phase2-symlink-<timestamp>:/work -w /work node:22-alpine \
  node --test tests/phase2-storage-adapters.test.mjs

4 tests
4 passed
0 failed
0 skipped
```

The temporary server directory was removed after the test. No Reel service was
deployed, enabled, restarted, or connected to real Reel data.

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

Server read-only health check at 2026-08-20T17:51:50Z
(2026-08-21T03:51:50+10:00 Brisbane):

- Six Reel services were running and healthy:
  - `reel-api`
  - `reel-dispatcher`
  - `reel-worker`
  - `reel-publisher`
  - `reel-archiver`
  - `reel-auth-rotator`
- News Signal services were running and healthy.
- Available memory: 14,021 MiB.
- Root volume: 313 GiB available, 6% used.
- Load average: `0.46, 0.55, 0.63`.

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

The earlier Phase 2 baseline commit was `0a4d156`. The corrective implementation
was committed separately as `1ded965`; the report-only reference update was
`d964e75`. The second bounded corrective follow-up was committed as `4c86829`,
with report reference `dac5e08`. A third bounded transaction-context follow-up
was committed as `67c4861`, with report reference `5481103`. A final standalone
query isolation commit is expected after this report update is staged with only
Reel Phase 2 files.

## Rollback

Local rollback after commit:

```bash
git revert <phase-2-corrective-commit>
```

No server rollback is required because no corrective Phase 2 service was
deployed or enabled on the server. Existing Phase 1 health services remain
unchanged.

## Remaining risks and next gate

- The real symlink traversal test still cannot execute on this Windows host
  because symlink creation returns `EPERM`, but the same corrected source was
  run on the Ubuntu server and passed.
- Disabled adapters intentionally provide interfaces but no live capability.
- No production D1/R2/KV parity, artifact backfill, local processing authority,
  shadow intake, or backlog processing has been attempted.
- Phase 3 remains blocked until this corrected Phase 2 report is independently
  reviewed and explicitly accepted.
