# Instagram Reel Brain Phase 3 Gate Report

Status: completed for independent review; not approved for Phase 4

Initial Phase 3 run timestamp: 2026-08-21 04:20 Australia/Brisbane

Initial corrective completion timestamp: 2026-08-21 05:22 Australia/Brisbane

Second corrective completion timestamp: 2026-08-21 05:42 Australia/Brisbane

Source commit at Phase 3 start: `73711e8`

Prior blocked-report commit: `fd32ce7`

Prior incomplete corrective commit: `30912df`

Cloudflare remains the sole production authority.

## Scope executed

- Captured a read-only D1 export for `cartdotcom-instagram-reel-brain`.
- Preserved the raw SQL export under an ignored, ACL-restricted Phase 3 run directory.
- Generated a redacted D1 table/schema inventory from the immutable export.
- Imported the D1 snapshot into a non-authoritative PostgreSQL JSONB audit
  schema and then into a separate typed operational shadow schema.
- Generated an R2 transfer manifest from D1-referenced object keys.
- Checked R2 cost using current Cloudflare R2 pricing.
- Created a local-only migration Worker with a remote R2 binding for
  paginated read-only object listing.
- Reconciled all R2 objects against D1-derived object keys.
- Copied every R2 object into the ignored workstation shadow root with restart
  checkpoints, size verification, and local SHA-256.
- Transferred the complete shadow run to the Ubuntu server under the
  authoritative Phase 3 run path and reverified all R2 objects server-side.
- Generated local library manifests from copied data and reconciled D1 library
  object keys.
- Ran read-only parity checks for jobs, status, notes, resources, retrieval
  metadata, searchability, relational samples, and library paths against the
  typed operational PostgreSQL schema.

No production D1 rows, R2 objects, KV keys, queues, Workers, Pages, Meta
callback, Instagram outbound operations, local dispatch, Codex execution,
publication, or processing authority were changed.

## Run paths

Local ignored run root:

```text
C:\Users\User\Documents\GitHub\cartdotcom\deployment\self-hosted\instagram-reel-brain\runs\phase3-shadow\2026-08-21_04-04-08
```

Server shadow run root:

```text
/srv/cartdotcom/reel-brain-runs/phase3-shadow/2026-08-21_04-04-08
```

PostgreSQL shadow schema:

```text
reel_phase3_shadow_20260821_040408
```

PostgreSQL typed operational shadow schema:

```text
reel_phase3_operational_20260821_040408
```

The original server directory that contained only the earlier PostgreSQL import
SQL was preserved, not overwritten:

```text
/srv/cartdotcom/reel-brain-runs/phase3-shadow/2026-08-21_04-04-08.server-audit-preserved-20260820193332
```

## D1 snapshot

Read-only export:

```text
runs\phase3-shadow\2026-08-21_04-04-08\d1\cartdotcom-instagram-reel-brain-full.sql
```

- Bytes: `11978682`
- SHA-256: `68fd0d271b0c37e67454130ffa967aed7d37a1e7c29a403fb31f60f4b301a100`
- Manifest: `d1\d1-export-manifest.redacted.json`
- SQLite derivative for inventory only: `d1\snapshot.sqlite`
- Inventory: `d1\d1-inventory.redacted.json`

The raw SQL file is outside Git and marked read-only locally. The run directory
has Windows ACL inheritance removed and grants only the current user full
control.

## D1 table counts and terminal state

| Table | Rows |
|---|---:|
| `artifacts` | 3341 |
| `d1_migrations` | 20 |
| `dm_commands` | 281 |
| `inbound_webhook_events` | 243 |
| `instagram_carousel_resolutions` | 77 |
| `job_events` | 1150 |
| `jobs` | 219 |
| `notes` | 0 |
| `outbound_events` | 1134 |
| `pending_dm_parts` | 37 |
| `pilot_candidate_cache` | 3 |
| `pilot_items` | 40 |
| `pilot_runs` | 4 |
| `resources` | 1428 |
| `runtime_secrets` | 2 |
| `settings` | 12 |

Job state from the snapshot:

- `complete`: 215
- `failed`: 4
- `queued`: 0
- `running`: 0

Pilot state:

- `complete`: 4
- active/selecting/running pilot runs: 0

Pending DM parts:

- Total rows: 37
- Unconsumed rows: 36
- These were copied only as migration data and were not selected, claimed,
  queued, replayed, or processed.

## PostgreSQL shadow import

The D1 export was first imported into `reel_phase3_shadow_20260821_040408` as
raw JSONB rows with table metadata and state-count tables. This schema is now
classified as preserved audit evidence only. It is not the operational migration
target.

Import report:

```text
runs\phase3-shadow\2026-08-21_04-04-08\d1\postgres-shadow-import-report.json
```

All table row-count checks passed:

- 16 table-count checks ok.
- `authority:cloudflare_remains_authority` ok.

Runtime secret handling:

- `runtime_secrets` rows were counted.
- `ciphertext` and `iv` were not imported as plaintext into PostgreSQL.
- Those fields were imported only as `{ redacted, sha256, byte_length }`.

## PostgreSQL typed operational shadow import

A separate non-authoritative operational schema was created by applying the
local Reel PostgreSQL migrations and then importing the production D1 snapshot
through an explicit deterministic mapper:

```text
reel_phase3_operational_20260821_040408
```

Operational import report:

```text
d1\postgres-operational-import-report.json
/srv/cartdotcom/reel-brain-runs/phase3-shadow/2026-08-21_04-04-08/d1/postgres-operational-import-report.json
```

Read-only repository/API parity report:

```text
d1\postgres-operational-read-api-parity-report.json
/srv/cartdotcom/reel-brain-runs/phase3-shadow/2026-08-21_04-04-08/d1/postgres-operational-read-api-parity-report.json
```

Schema drift handled explicitly:

- Added `0003_phase3_cloud_schema_drift.sql`.
- `jobs.dedupe_key` is nullable because four historical D1 jobs have no
  dedupe key; `source_dedupe_key_missing=true` records those rows.
- D1-compatible uniqueness is enforced for non-null `jobs.dedupe_key` and
  non-null `jobs.source_message_id`.
- `resources.guide_markdown_key`, `resources.guide_html_key`, and
  `resources.evidence_json` are retained.
- D1 artifact IDs are retained in `artifacts.source_artifact_id`; D1
  `kind`, `byte_size`, and `sha256` are retained in typed columns while the
  Phase 2 repository-facing `checksum_sha256` and `byte_length` columns remain
  populated.
- Global `artifacts.object_key` uniqueness is enforced to match D1.
- `instagram_carousel_resolutions.waiting_for_auth` is allowed because it is
  present in the production D1 snapshot.
- D1 operational tables added to the local disabled schema: `notes`,
  `settings`, `runtime_secrets`, `dm_commands`, `outbound_events`,
  `pilot_runs`, `pilot_items`, `pilot_candidate_cache`,
  `inbound_webhook_events`, and `d1_migrations`.
- Runtime secret `ciphertext` and `iv` values are not imported. The typed
  operational table stores `__REDACTED__` plus SHA-256 evidence fields only.

Typed import checks passed:

- 20/20 table row-count checks passed.
- Foreign-key checks passed for resources, artifacts, and job events.
- D1 uniqueness checks passed for artifact object keys, job dedupe keys where
  non-null, and resource `(job_id, slug)`.
- Runtime secret redaction check passed.

Typed parity results:

- Jobs by status: `complete=215`, `failed=4`.
- Notes: 0.
- Resources: 1,428.
- Jobs with original video keys: 219.
- Jobs with audio keys: 178.
- Jobs with library paths: 215.
- Resources with library paths: 1,428.
- Searchable jobs: 215.
- Searchable resources: 1,428.
- Job HTML keys: 215.
- Resource guide HTML keys: 1,428.
- Read-only repository methods returned coherent status, search, notes,
  retrieval metadata, and library path samples from the typed schema.

## R2 cost check

Cloudflare's current R2 pricing states that Standard storage includes a free
tier of 10 GB-month, 1 million Class A operations, 10 million Class B
operations, and free egress. Source: <https://developers.cloudflare.com/r2/pricing/>

Bucket info from Wrangler:

- Bucket: `cartdotcom-instagram-reel-brain`
- Storage class: Standard
- Bucket objects: 5,673
- Bucket size: 1.53 GB

D1-derived transfer manifest:

- Manifest path: `r2\r2-shadow-manifest.json`
- Referenced object keys: 5,120
- Projected Class B GET operations: 5,120
- Projected Class A/list operations: 1
- Projected egress: 1.53 GB
- Cost gate: covered by the Standard free tier if the bucket is only Standard storage.

## R2 inventory correction

The earlier R2 list blocker was resolved without new credentials or production
deployment.

Added local-only files:

```text
tools/r2-inventory-worker/wrangler.jsonc
tools/r2-inventory-worker/src/index.js
tests/phase3-r2-inventory-worker.test.mjs
```

The Worker was run only through local `wrangler dev` on `127.0.0.1:8791`.
It was not deployed and no route/resource was created. Its only binding was:

```json
{
  "binding": "REEL_ARCHIVE",
  "bucket_name": "cartdotcom-instagram-reel-brain",
  "remote": true
}
```

The only endpoint was `GET /inventory/r2/list`. Static tests assert that R2
mutation calls (`put`, `delete`, multipart upload, `get`, and `head`) are
absent and that D1, KV, Queue, AI, Browser, Durable Object, Container, route,
and trigger bindings are absent.

Full R2 manifest:

```text
r2\r2-cloudflare-full-object-manifest.json
```

- Objects: 5,673
- Bytes: 1,527,301,212
- Manifest SHA-256: `66bdcfd6f525e7e115a2dd4ed3cf3e44f0fb5356680732852e1f56d8d6f4fe70`

## R2 reconciliation and copy

Reconciliation report:

```text
r2\r2-reconciliation-report.json
```

- D1-derived object keys: 5,120
- Cloudflare bucket objects: 5,673
- Referenced objects present: 5,120
- Missing D1-referenced objects: 0
- Extra/unreferenced objects: 553

Extra object classification:

- `unreferenced_library_object`: 122
- `unreferenced_reel_artifact`: 201
- `unreferenced_superseded_attempt_artifact`: 230

No extra object was discarded. Every bucket object was included in the transfer
manifest.

Transfer manifest:

```text
r2\r2-shadow-transfer-manifest.json
```

Copy root:

```text
r2\objects
```

Copy result:

- Expected objects: 5,673
- Copied this run: 5,408
- Skipped from existing checkpoint: 265
- Failed: 0
- Verified local objects: 5,673
- Verified local bytes: 1,527,301,212
- Checkpoint: `r2\r2-shadow-copy-checkpoint.jsonl`
- Verify report: `r2\r2-shadow-copy-verify-report.json`

Each object was written through a `.tmp-phase3` temp file followed by rename.
Verification rehashed local files and checked each file size against the
Cloudflare object listing. ETags were preserved as metadata only and were not
treated as SHA-256.

## Ubuntu server shadow placement and verification

The workstation run was preserved as evidence and then streamed to the Ubuntu
server with `tar` over SSH into a temporary incoming directory. The previous
server directory containing only the earlier 14 MB PostgreSQL import SQL was
renamed to the preserved path listed above. The incoming directory was then
moved into the final Phase 3 server run path.

Server final path:

```text
/srv/cartdotcom/reel-brain-runs/phase3-shadow/2026-08-21_04-04-08
```

Server-side verification report:

```text
/srv/cartdotcom/reel-brain-runs/phase3-shadow/2026-08-21_04-04-08/reports/server-r2-shadow-verify.json
```

Server verification results:

- Expected objects: 5,673.
- Verified objects: 5,673.
- Expected bytes: 1,527,301,212.
- Verified bytes: 1,527,301,212.
- Missing objects: 0.
- SHA-256 mismatches: 0.
- Failed checkpoint records: 0.
- Final object files under `r2/objects`: 5,673.
- Run directory permissions restricted to owner access: `drwx------`.
- The shadow data is not mounted into active services.
- `/srv` after transfer: 349 GB total, 20 GB used, 311 GB available.

## Local library import/rebuild and parity

The generated library was reconstructed from copied `library/` objects and D1
`html_key` / `guide_html_key` metadata only.

Reports:

```text
library\library-shadow-manifest.json
library\library-readable-path-manifest.json
library\library-parity-report.json
```

Results:

- Cloudflare/R2 library objects copied locally: 1,677
- D1 library object keys: 1,555
- D1 library object keys missing from Cloudflare: 0
- D1 library object keys missing from local copy: 0
- Extra copied library objects: 122

The 122 extra library objects are the same deterministic
`unreferenced_library_object` class from R2 reconciliation. They were preserved
in the local shadow root and listed in the parity report.

## Read-only D1 parity

Report:

```text
d1\d1-readonly-parity-report.json
```

Results:

- Jobs by status: `complete=215`, `failed=4`
- Notes: 0
- Resources: 1,428
- Jobs with original video keys: 219
- Jobs with audio keys: 178
- Jobs with library paths: 215
- Resources with library paths: 1,428
- Searchable jobs: 215
- Searchable resources: 1,428
- Duplicate active dedupe keys: 0
- Resources missing jobs: 0
- Artifacts missing jobs: 0
- Events missing jobs: 0
- Sampled 10 recent relational job records with resource/artifact/event counts.

## Health and resource checks

Before/during Phase 3:

- Six Reel self-hosted services healthy.
- News Signal services healthy.
- Live Cloudflare health: not mutated.

After Phase 3 correction:

- Six Reel self-hosted services healthy.
- News Signal services healthy.
- Live Cloudflare Worker `/health` returned:

```json
{
  "ok": true,
  "service": "cartdotcom-instagram-reel-brain",
  "ingest_mode": "live",
  "backlog_processing": false,
  "model": "gpt-5.6-luna"
}
```

Representative after-state Docker resource readings:

- Reel services remained below their configured memory limits.
- News services remained healthy.
- `cartdotcom-news-corpus-archiver-1` remained near its configured limit at
  `364.8MiB / 384MiB`; it stayed healthy.
- `cartdotcom-platform-postgres-1` reported `267.8MiB / 3GiB`.
- PostgreSQL operational shadow imported D1 rows: 7,991.
- `/srv` reported 311 GB available after the server-side R2 shadow transfer.

## Verification run

Commands:

```powershell
python -m py_compile scripts\phase3_shadow_migration.py
node --test tests\phase3-r2-inventory-worker.test.mjs
npm test
python -m unittest tests.test_media_processor_api -v
npm run typecheck
npm test
docker compose -f deployment\self-hosted\instagram-reel-brain\compose.yaml config --quiet
```

Results:

- Phase 3 script compile: passed.
- R2 inventory Worker static tests: 2/2 passed.
- Self-hosted Node tests: 46 total; 45 passed; 1 skipped on Windows because
  symlink creation is unavailable.
- Self-hosted media API tests: 3/3 passed.
- Cloud Reel TypeScript typecheck: passed.
- Cloud Reel Node tests: 63/63 passed.
- Compose validation: passed.
- Live Cloudflare Worker `/health`: `ok`, `ingest_mode=live`,
  `backlog_processing=false`.
- Production D1 active queue query: 0 active rows returned.
- Server Docker health: all Reel and News containers healthy.

`python -m pytest tests\test_media_processor_api.py -q` was attempted first and
failed because this desktop Python environment does not have `pytest`
installed. The test file is `unittest`-based and passed with
`python -m unittest`.

## Files changed

- `.gitignore`
  - ignored `deployment/self-hosted/instagram-reel-brain/runs/`
  - ignored `deployment/self-hosted/instagram-reel-brain/.phase3-current-run`
- `deployment/self-hosted/instagram-reel-brain/scripts/phase3_shadow_migration.py`
  - added manual Phase 3 D1 inventory/import, R2 manifest/reconcile/copy,
    local-copy verification, server operational import, library parity, and
    D1/PostgreSQL parity tooling
- `deployment/self-hosted/instagram-reel-brain/migrations/0003_phase3_cloud_schema_drift.sql`
  - added disabled typed operational destinations for D1 production drift
- `deployment/self-hosted/instagram-reel-brain/src/repositories/postgres-reel-repository.js`
  - added read-only status, search, notes, retrieval metadata, and library path
    query methods for parity checks
- `deployment/self-hosted/instagram-reel-brain/tests/phase2-postgres-connected.test.mjs`
  - applies the Phase 3 drift migration in connected tests and verifies
    read-only repository parity methods
- `deployment/self-hosted/instagram-reel-brain/tests/phase3-operational-shadow.test.mjs`
  - added static tests for drift destinations and secret redaction
- `deployment/self-hosted/instagram-reel-brain/tools/r2-inventory-worker/wrangler.jsonc`
  - added local-only Wrangler config with the existing R2 bucket bound as
    `remote: true`
- `deployment/self-hosted/instagram-reel-brain/tools/r2-inventory-worker/src/index.js`
  - added GET-only paginated R2 list endpoint for local development
- `deployment/self-hosted/instagram-reel-brain/tests/phase3-r2-inventory-worker.test.mjs`
  - added static assertions that mutation methods and non-R2 bindings are absent
- `deployment/self-hosted/instagram-reel-brain/docs/PHASE_3_GATE_REPORT_2026-08-21.md`
  - updated this Phase 3 gate report
- `deployment/self-hosted/instagram-reel-brain/docs/INSTAGRAM_REEL_MIGRATION_STATE.md`
  - updated current state to Phase 3 completed for review
- `deployment/self-hosted/instagram-reel-brain/docs/CHANGELOG.md`
  - added Phase 3 correction/completion entry
- `deployment/self-hosted/instagram-reel-brain/README.md`
  - added Phase 3 operator note

Raw run files are intentionally outside Git.

## Rollback and cleanup

No production rollback is required because no production state was mutated.

Non-destructive cleanup, if explicitly approved later:

```bash
# Preserve evidence by renaming, not deleting.
docker exec -i cartdotcom-platform-postgres-1 psql -U cartdotcom -d cartdotcom -v ON_ERROR_STOP=1 -q <<'SQL'
ALTER SCHEMA reel_phase3_shadow_20260821_040408 RENAME TO reel_phase3_shadow_20260821_040408_preserved;
ALTER SCHEMA reel_phase3_operational_20260821_040408 RENAME TO reel_phase3_operational_20260821_040408_preserved;
SQL
```

To disable the workstation R2 shadow copy without deletion, rename the ignored
run folder:

```powershell
Rename-Item `
  "C:\Users\User\Documents\GitHub\cartdotcom\deployment\self-hosted\instagram-reel-brain\runs\phase3-shadow\2026-08-21_04-04-08" `
  "2026-08-21_04-04-08_preserved"
```

To disable the server R2 shadow copy without deletion, rename the server run
folder:

```bash
mv /srv/cartdotcom/reel-brain-runs/phase3-shadow/2026-08-21_04-04-08 \
   /srv/cartdotcom/reel-brain-runs/phase3-shadow/2026-08-21_04-04-08_preserved
```

Do not delete:

- the D1 export,
- the redacted manifests,
- the server-side import SQL,
- the PostgreSQL shadow schema,
- the PostgreSQL typed operational shadow schema,
- the copied local R2 shadow root,
- the copied server R2 shadow root,
- the local library manifests,
- or this gate report

until independent review has completed.

## Required next action

Independent review of this Phase 3 gate report.

Phase 4 remains blocked.
