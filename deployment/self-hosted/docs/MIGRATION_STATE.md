# Current Migration State

Last verified: 2026-08-19T08:15:08Z

## Authority and safety state

- Cloudflare remains the production authority.
- The self-hosted database is a read-only staging snapshot.
- Local source ingestion, queue dispatch, Codex execution, prediction price
  updates, email, and public ingress are disabled.
- The local scheduler runs in disabled staging mode and publishes a heartbeat.
  Its durable run history and isolated lease queue are installed, but it does
  not fetch sources until the explicit cutover setting is changed.
- An eight-slot database worker and separately isolated Codex runner are
  deployed in disabled staging mode. The runner uses `gpt-5.6-luna` at medium
  reasoning effort and cannot access PostgreSQL credentials or its network.
- A four-slot market tracker is deployed in disabled staging mode. It records
  fixed prediction intervals and monotonically growing daily histories from
  Yahoo Finance without applying opposite-call exclusion rules.
- The Caddy gateway listens on server loopback only (`127.0.0.1:8080`).
- The current dashboard HTML is served through that loopback gateway with a
  server-held token. Authenticated WebSocket updates are backed by PostgreSQL
  notifications rather than timed dashboard polling.
- The server publishes a complete dashboard read snapshot to private Cloudflare
  R2 every five minutes. The first production snapshot was verified at
  `2026-08-19T08:15:03Z` with 12 response groups and a 1,272,652-byte bundle.
- Cloudflare snapshot support is deployed, but `SELF_HOSTED_API_ORIGIN` is not
  set. Cloudflare therefore remains authoritative and the outage fallback path
  stays dormant until the final traffic cutover.

## Imported D1 snapshot

| Field | Value |
|---|---|
| Export timestamp | `2026-08-19T05:06:15Z` |
| Export file | `/srv/cartdotcom/imports/cartdotcom-news-signal-20260819T050615Z.sql` |
| Export size | 1,301,227,717 bytes |
| SHA-256 | `a7f145a144a202bd9dc8aa8e6c5c072b670db468b94927245389e1236d19c0d9` |
| PostgreSQL size after import | 1,173 MB |
| Unknown tables | None |
| Post-import backup | `/srv/backups/postgres/cartdotcom-20260819T052010Z.dump` |

## Imported R2 article corpus

| Field | Value |
|---|---|
| Stored objects in manifest | 76,248 |
| Verified local objects | 76,248 |
| Exported object bytes | 594,781,229 bytes |
| Server archive | `/srv/cartdotcom/imports/cartdotcom-article-corpus-20260819T1708.tar` |
| Archive size | 692,511,232 bytes |
| Archive SHA-256 | `e52536fef29c4f8e2c2bdd9819af82abac1eb2db228777a38c0bcd7136dd3b35` |
| Extracted path | `/srv/cartdotcom/article-corpus` |

Every stored object was checked against both `object_bytes` and the
`content_sha256` hash of its `content.plaintext` field. The post-extraction API
check returned a matching article ID with plaintext, analysis, and schema
version from `/api/corpus/article`. The eight remaining corpus metadata rows are
pending records and were never stored in R2; there are zero failed records.

## Key row counts

| Table | Rows |
|---|---:|
| `sources` | 81 |
| `articles` | 86,557 |
| `research_jobs` | 86,557 |
| `research_results` | 76,257 |
| `prediction_outcomes` | 58,420 |
| `prediction_daily_points` | 11,574 |
| `prediction_daily_points_v2` | 382,562 |
| `source_checks` | 9,182 |
| `source_check_details` | 723,249 |
| `feed_item_ledger` | 88,087 |
| `article_corpus_objects` | 76,256 |

The importer validated all 32 application tables and imported the same number of
rows it found in each source table. The legacy `prediction_daily_points` table
was discovered during validation and added to the compatibility schema before
the import.

## Healthy staging endpoints

- `/api/status`
- `/api/status/live`
- `/api/sources`
- `/api/source-checks`
- `/api/source-check-details`
- `/api/articles`
- `/api/articles/content`
- `/api/jobs`
- `/api/jobs/failures`
- `/api/corpus/status`
- `/api/corpus/objects`
- `/api/corpus/article` (filesystem adapter and migrated objects verified)
- `/api/results`, `/api/model-experiments`
- `/api/predictions/summary`, `/api/predictions/daily`, `/api/predictions/outcomes`
- `/api/source-stats`, `/api/source-activity`, `/api/diagnostics/ticker-pipeline`
- `/api/events` (authenticated WebSocket)

All mutating `/api/*` calls currently return `503 migration_read_only`.

## Dashboard verification

The dashboard contract suite passed all 20 checks against the loopback staging
gateway. This includes every route called by the current UI, cursor pagination,
authenticated WebSockets, unauthorized rejection, HTTP 410 for retired paper
simulation routes, and the read-only mutation guard.

Authenticated visual checks passed at 1440x900 and 390x844. Prediction,
Overview, Sources, settings, source day/month/year charts, theme switching,
sticky prediction headers, and infinite outcome loading all rendered without
console errors or page-level horizontal overflow. Heatmap columns were widened
after the audit found 6-11 pixel text overflow; the corrected build reports no
overflowing heatmap cells at either viewport.

## Next work

1. Implement the dashboard's cutover-only mutation controls behind the runtime
   safety flags, including manual ingestion and queue administration.
2. Configure off-host PostgreSQL and corpus backups and test a full restore.
3. Repeat a fresh snapshot/delta import immediately before cutover.
4. Run shadow comparisons, then enable local ingestion and workers gradually.
5. Establish the authenticated Cloudflare Tunnel origin, set
   `SELF_HOSTED_API_ORIGIN`, and exercise live-to-snapshot-to-live recovery.
6. Move dashboard traffic only after the rollback procedure is exercised.
