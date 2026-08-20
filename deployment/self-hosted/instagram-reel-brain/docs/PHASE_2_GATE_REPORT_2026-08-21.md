# Phase 2 local contract and fixture gate report

Status: implementation complete; awaiting independent review.

Recorded at: 2026-08-21T03:00:21+10:00 Australia/Brisbane

Cloudflare remains the sole production authority. This Phase 2 work does not
authorise production import, live/shadow intake, local dispatch, Codex
execution, publication, Instagram outbound operations, auth rotation, real
backlog enumeration, real backlog replay, production delta mirroring, or Phase 3.

## Approved boundary

Implemented only the bounded Phase 2 scope approved after the amended Phase 1
health gate:

- Cloudflare-independent domain logic in local tested modules.
- PostgreSQL repository and local object-store contracts.
- Internal-only Python media processor API wrapper.
- Disabled Cloudflare Whisper, Browser Rendering, R2 mirror, KV/library
  publication, and Instagram outbound adapters.
- Synthetic fixtures and tests only.

## Local files changed

Code and contracts:

- `.env.example`
  - Added disabled media fixture flags:
    - `REEL_MEDIA_PROCESSOR_ENABLED=false`
    - `REEL_MEDIA_FIXTURE_ONLY=true`
    - `REEL_TEST_STORAGE_ROOT=/srv/cartdotcom/reel-brain-runs/fixtures`
- `migrations/0002_phase2_local_contracts.sql`
  - Adds PostgreSQL contract tables for `jobs`, `job_events`, `resources`,
    `artifacts`, `pending_dm_parts`, and `instagram_carousel_resolutions`.
  - Adds active dedupe, queued-job, canonical-resource, artifact-idempotency,
    and pending-claim indexes/constraints.
  - Contains no production import or cloud-provider migration statement.
- `src/domain/authority.js`
  - `authorityFromEnv()`, `assertPhase2FixtureAuthority()`,
    `assertCloudAuthority()`, `assertDisabled()`, `describeAuthority()`.
- `src/domain/instagram.js`
  - Local canonical URL, shortcode, dedupe, media payload classification,
    adjacent instruction, test-audit, queue-grace, and comment-ranking helpers.
- `src/domain/artifacts.js`
  - Canonical artifact keys, library paths, slugging, and source merging.
- `src/domain/carousel.js`
  - Ordered carousel slide manifests and validation.
- `src/repositories/postgres-reel-repository.js`
  - PostgreSQL query contract for job creation, serial claim, stage/failure/
    completion events, resource upsert, artifact write tracking, and
    transaction rollback.
- `src/repositories/fixture-client.js`
  - Query-capturing fake client for implementation-connected tests.
- `src/storage/local-object-store.js`
  - Root-confined object store with SHA-256 checksums and path traversal
    protection.
- `src/adapters/disabled-adapters.js`
  - Fail-closed disabled adapters for Cloudflare Whisper, Browser Rendering,
    R2 mirror, KV/library publication, and Instagram outbound.
- `services/media-processor-api/app.py`
  - Internal-only, fixture-only Python API wrapper.
  - Defaults disabled and binds to `127.0.0.1`.
  - Refuses paths outside `REEL_TEST_STORAGE_ROOT`.
- `services/media-processor-api/README.md`
  - Operational constraints for the wrapper.
- `fixtures/synthetic/carousel.json`
  - Scrubbed synthetic carousel fixture; no real Instagram data.

Tests:

- `tests/phase2-domain.test.mjs`
- `tests/phase2-repository.test.mjs`
- `tests/phase2-storage-adapters.test.mjs`
- `tests/phase2-contract-files.test.mjs`

Pre-existing uncommitted health-gate and News Signal files were not modified by
this Phase 2 implementation and were not included in the Phase 2 commit.

## Enabled and disabled state

Still enabled:

- Existing six inert Reel health services.
- Existing isolated `cartdotcom-reel-runtime` and `cartdotcom-reel-egress`
  networks.
- Local synthetic/fixture tests.

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

Self-hosted Reel:

```text
npm test
23/23 tests passed
```

Coverage:

- Authority fence rejects self-hosted authority and enabled Codex/dispatch/
  outbound/backlog flags.
- Instagram URL canonicalisation and `instagram:<shortcode>` dedupe key.
- Native post/Reel payload classification.
- Five-minute adjacent instruction decision helpers and 12-second live grace
  delay.
- Comment ranking by likes.
- Canonical artifact key/page generation and source deduplication.
- Ordered carousel manifest generation and validation.
- PostgreSQL job insert requires pre-Codex dedupe.
- PostgreSQL serial claim SQL uses `FOR UPDATE SKIP LOCKED` and excludes
  `pilot_run_id`.
- Stage, completion, failure, resource, and artifact SQL creates auditable
  mutations.
- Transaction interruption rolls back.
- Local object store writes fixture artifacts with checksums.
- Local object store rejects traversal/root writes.
- Disabled external adapters fail closed.
- Phase 2 migration creates only local PostgreSQL contracts.
- Media API remains internal, disabled, and fixture-only by default.
- Existing Phase 1 scaffold/resource/network tests still pass.

Additional syntax/config checks:

```text
python -m py_compile services/media-processor-api/app.py
passed

docker compose -f compose.yaml config --quiet
passed
```

Existing cloud Reel verification, unchanged source:

```text
deployment/instagram-reel-brain: npm run typecheck
passed

deployment/instagram-reel-brain: npm test
63/63 tests passed

deployment/instagram-reel-brain: python -m unittest discover -s container -p "test*.py"
9/9 tests passed
```

## Health and authority evidence

Server read-only health check at 2026-08-20T16:59:31Z:

- Six Reel services were running and healthy:
  - `reel-api`
  - `reel-dispatcher`
  - `reel-worker`
  - `reel-publisher`
  - `reel-archiver`
  - `reel-auth-rotator`
- News Signal services were running and healthy.
- Available memory: about 13,995 MiB.
- Root volume: 313 GiB available, 6% used.
- Load average: `0.50, 0.58, 0.74`.

Cloudflare production read-only check:

- `/health`: `ok=true`, `ingest_mode=live`, `backlog_processing=false`,
  model `gpt-5.6-luna`.
- D1 active-state query:
  - `active_jobs = 0`
  - `pending_parts = 0`
  - `active_carousel_resolutions = 0`
  - `backlog_active = 0`

## Commit

Phase 2 implementation was committed in the `cartdotcom` repository; use the
final handoff report for the exact commit id.

## Rollback

Local rollback:

```bash
git revert <phase-2-commit>
```

No server rollback is required because no Phase 2 service was deployed or
enabled on the server. Existing Phase 1 health services remain unchanged.

## Remaining risks and next gate

- PostgreSQL tests use fixture query clients; a real isolated PostgreSQL test
  database should be added before Phase 3 data import.
- The media wrapper is a contract shell; it does not yet run the full existing
  media processor end to end.
- Disabled adapters intentionally provide interfaces but no live capability.
- No production D1/R2/KV parity or artifact backfill has been attempted.
- Phase 3 remains blocked until this Phase 2 report is independently reviewed
  and explicitly accepted.
