# Instagram Reel Brain Phase 3 Gate Report

Status: blocked, not approved for Phase 4

Timestamp: 2026-08-21 04:20 Australia/Brisbane

Source commit at start: `73711e8`

Cloudflare remains the sole production authority.

## Scope executed

- Captured a read-only D1 export for `cartdotcom-instagram-reel-brain`.
- Preserved the raw SQL export under an ignored, ACL-restricted Phase 3 run directory.
- Generated a redacted D1 table/schema inventory from the immutable export.
- Imported the D1 snapshot into a non-authoritative PostgreSQL shadow schema.
- Generated an R2 transfer manifest from D1-referenced object keys.
- Checked R2 cost using current Cloudflare R2 pricing.
- Stopped before artifact transfer because full R2 object reconciliation is blocked.

No production D1 rows, R2 objects, KV keys, queues, Workers, Pages, Meta callback,
Instagram outbound operations, local dispatch, Codex execution, publication, or
processing authority were changed.

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

The D1 export was imported into `reel_phase3_shadow_20260821_040408` as raw
JSONB rows with table metadata and state-count tables.

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

## R2 blocker

Phase 3 is blocked before artifact transfer.

The D1-derived object manifest contains 5,120 expected keys, while Cloudflare
bucket info reports 5,673 objects. The 553-object difference is unexplained.

Attempted full R2 object listing through the official Cloudflare REST endpoint
`GET /accounts/{account_id}/r2/buckets/{bucket_name}/objects`, documented at
<https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/list/>.

Result:

- The endpoint rejected the available `CLOUDFLARE_API_TOKEN` with
  `Authentication error`.
- Wrangler OAuth can list buckets and fetch bucket info, but Wrangler `4.120.0`
  does not expose an object-list command.
- R2 artifact download was not started because the gate requires object count,
  byte, checksum, and manifest reconciliation before copying.

This is an unexplained object-count mismatch and therefore a Phase 3 blocker.

## Health and resource checks

Before Phase 3:

- Six Reel self-hosted services healthy.
- News Signal services healthy.
- Live Cloudflare health: not mutated.

After blocked stop:

- Six Reel self-hosted services healthy.
- News Signal services healthy.
- Live Cloudflare `/health` returned:

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
- `cartdotcom-news-corpus-archiver-1` was at `365.3MiB / 384MiB`; this was
  already near its limit and no Reel artifact transfer was started.

## Verification run

Commands:

```powershell
python -m py_compile scripts\phase3_shadow_migration.py
npm test
python -m unittest tests.test_media_processor_api -v
npm run typecheck
npm test
docker compose -f deployment\self-hosted\instagram-reel-brain\compose.yaml config --quiet
```

Results:

- Phase 3 script compile: passed.
- Self-hosted Node tests: 41 total; 40 passed; 1 skipped on Windows because
  symlink creation is unavailable.
- Self-hosted media API tests: 3/3 passed.
- Cloud Reel TypeScript typecheck: passed.
- Cloud Reel Node tests: 63/63 passed.
- Compose validation: passed.

`python -m pytest tests\test_media_processor_api.py -q` was attempted first and
failed because this desktop Python environment does not have `pytest`
installed. The test file is `unittest`-based and passed with
`python -m unittest`.

## Files changed

- `.gitignore`
  - ignored `deployment/self-hosted/instagram-reel-brain/runs/`
  - ignored `deployment/self-hosted/instagram-reel-brain/.phase3-current-run`
- `deployment/self-hosted/instagram-reel-brain/scripts/phase3_shadow_migration.py`
  - added manual Phase 3 D1 inventory/import and R2 manifest/copy tooling
- `deployment/self-hosted/instagram-reel-brain/docs/PHASE_3_GATE_REPORT_2026-08-21.md`
  - added this blocked gate report
- `deployment/self-hosted/instagram-reel-brain/docs/INSTAGRAM_REEL_MIGRATION_STATE.md`
  - updated current state to Phase 3 blocked
- `deployment/self-hosted/instagram-reel-brain/docs/CHANGELOG.md`
  - added Phase 3 blocked entry
- `deployment/self-hosted/instagram-reel-brain/README.md`
  - added Phase 3 operator note

Raw run files are intentionally outside Git.

## Rollback and cleanup

No production rollback is required because no production state was mutated.

Non-destructive cleanup, if explicitly approved later:

```bash
# Preserve evidence by renaming, not deleting.
docker exec -i cartdotcom-platform-postgres-1 psql -U cartdotcom -d cartdotcom -v ON_ERROR_STOP=1 -q <<'SQL'
ALTER SCHEMA reel_phase3_shadow_20260821_040408 RENAME TO reel_phase3_shadow_20260821_040408_blocked_preserved;
SQL
```

Do not delete:

- the D1 export,
- the redacted manifests,
- the server-side import SQL,
- the PostgreSQL shadow schema,
- or this gate report

until independent review has completed.

## Required next action

Resolve full R2 object inventory access without rotating or exposing secrets.

Acceptable paths:

1. Provide or approve a read-only R2 object-list credential through the normal
   secret channel.
2. Use an approved Cloudflare connector/tool that can list R2 objects without
   exposing secret values.
3. Add a bounded, reviewed, read-only Cloudflare Worker/admin endpoint in a
   later approved scope if connector/credential access is unavailable.

After complete R2 inventory is available:

1. Reconcile the 5,673 Cloudflare objects against the D1-derived 5,120 keys.
2. Classify every extra object as expected orphan, stale library artifact, or
   mismatch.
3. Only then run the resumable R2 copy.
4. Continue Phase 3 parity checks.

Phase 4 remains blocked.
