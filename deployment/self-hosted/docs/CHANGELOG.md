# Server Changelog

## 2026-08-19

- Completed the final Cloudflare D1 export after disabling Cloudflare
  processing, imported all 32 known tables, applied the final R2 corpus delta,
  and reconciled the durable local queue.
- Activated the Ubuntu server as the sole `self_hosted` processing authority
  with eight Codex worker slots, aligned source checks, market tracking, and
  corpus archiving.
- Enabled the public Worker proxy through the private Workers VPC Service and
  verified authenticated REST, WebSocket updates, charts, tables, and outcome
  pagination against the local backend.
- Exercised a controlled tunnel outage: Cloudflare served the latest private R2
  dashboard snapshot, mutations remained disabled, and the dashboard returned
  to live data after tunnel recovery.
- Created and restored the first post-cutover offsite PostgreSQL backup:
  `cartdotcom-20260819T142941Z.dump` (285,499,674 bytes in nine verified chunks).
- Removed three superseded D1 SQL migration exports after the verified backup,
  reclaiming approximately 4 GB while retaining the corpus migration archive.

- Added a PostgreSQL-backed single-writer authority guard enforced by the API,
  source scheduler, Codex worker, market tracker, and corpus archiver.
- Added Cloudflare processing and proxy flags so compute handoff and dashboard
  traffic cutover remain separate operations.
- Added full-page article extraction before synthesis and atomic structured
  article corpus storage for future local jobs.
- Added durable manual source-check commands, queue reconciliation and recovery,
  article archive mutations, and isolated Codex authentication rotation.
- Added private Workers VPC ingress support and a profiled cloudflared service;
  Cloudflare permissions are still required before provisioning it.
- Added SHA-256 verified, chunked PostgreSQL uploads with 30-day R2 retention
  and retryable mirroring for future local article corpus objects.
- Created the self-hosted platform definition and operating handbook.
- Defined isolated directories for Cartdotcom, media, and additional Codex apps.
- Added a loopback-only Caddy staging gateway and private PostgreSQL service.
- Deployed a health-checked news compatibility API with no ingestion enabled.
- Added PostgreSQL equivalents for numbered and runtime-created D1 tables.
- Added verified daily PostgreSQL backups with 14-day local retention.
- Added a validation-first D1 export importer with explicit merge/replace modes.
- Added a traversal-safe local filesystem adapter for R2 article corpus objects.
- Preserved the legacy `prediction_daily_points` table discovered in the first production snapshot.
- Imported and verified the first 32-table production D1 snapshot into read-only staging.
- Created a verified 266 MB post-import PostgreSQL backup.
- Added an exact-boundary, transaction-safe source scheduler in disabled staging mode.
- Added PostgreSQL scheduler history, service heartbeats, and leased local jobs.
- Added automatic boot restoration, recurring health audits, and outage documentation.
- Installed the Codex CLI and deployed an eight-slot worker/runner architecture.
- Isolated Codex credentials and outbound inference from PostgreSQL credentials.
- Added a fail-closed staging/active runtime switch for final cutover.
- Added durable market tracking jobs for 12h through 4y intervals and daily movement grids.
- Exposed self-hosted service heartbeat age and state through status endpoints.
- Ported prediction outcome pagination, confidence summaries, and daily movement queries to PostgreSQL.
- Synchronized and served the existing dashboard through the loopback staging gateway.
- Added a separate dashboard token, authenticated WebSockets, and PostgreSQL event notifications.
- Ported event summaries, source statistics/activity, model experiment history, and ticker pipeline diagnostics.
- Exported and integrity-checked all 76,248 stored R2 corpus objects.
- Installed the corpus on Ubuntu and verified live reads through the filesystem-backed API.
- Added a 20-check executable dashboard contract audit covering live read paths,
  cursor pagination, WebSockets, authentication, and staging safety responses.
- Completed authenticated desktop/mobile visual QA and corrected heatmap cell
  widths that allowed compact values to cross their cell boundary.
- Added a sequential, five-minute dashboard snapshot publisher with a separate
  upload credential and no direct database access.
- Added private R2 snapshot storage, integrity verification, live-origin proxy
  fallback, and fail-closed handling for mutation requests.
- Added a dated dashboard outage banner, read-only chart/table controls, and
  automatic 30-second live-service recovery probes.
- Added local and CI integration tests covering authenticated upload, private
  status, dead-origin fallback, and mutation refusal.
