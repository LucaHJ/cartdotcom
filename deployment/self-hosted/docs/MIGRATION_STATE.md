# Current Migration State

Last verified: 2026-08-19T14:32:00Z

## Production authority

- The Ubuntu server is the sole news-processing authority. The database record
  is `news-processing|self_hosted`, and the Cloudflare Worker is deployed with
  `PROCESSING_AUTHORITY=self_hosted`.
- Cloudflare remains the public dashboard entry point. Authenticated API and
  WebSocket traffic is proxied through the private Workers VPC Service binding
  `SELF_HOSTED_API`; the server has no public hostname or router port.
- `SELF_HOSTED_PROXY_ENABLED=true` and `CORPUS_EXPORT_ENABLED=false`.
- The local scheduler, eight Codex worker slots, market tracker, corpus
  archiver, dashboard snapshot publisher, and credential rotator are active.
- The source scheduler checks all 81 sources on exact five-minute boundaries.
  The first verified post-cutover checks ran at `14:20:00`, `14:25:00`, and
  `14:30:00` UTC.
- The Codex runner uses `gpt-5.6-luna` with medium reasoning effort. It has no
  PostgreSQL credentials, and the queue worker has no Codex credentials.
- Cloudflare receives a complete private dashboard snapshot every five minutes.
  If the server or tunnel is unavailable, supported reads fall back to that
  snapshot and mutations fail closed.

## Final data handoff

The final D1 export was taken after Cloudflare processing was disabled and
before local authority was activated.

| Field | Value |
|---|---|
| Final D1 export timestamp | `2026-08-19T14:06:27Z` |
| Export bytes | 1,322,967,414 |
| Export chunks | 40 |
| Imported application tables | 32 |
| Unknown tables | None |
| Final R2 delta objects downloaded | 91 |
| Verified migrated corpus objects | 77,670 |
| Local corpus path | `/srv/cartdotcom/article-corpus` |

The final import contained 87,986 articles and jobs, 77,689 research results,
59,683 prediction outcomes, 77,688 corpus metadata rows, 9,294 source checks,
and all 81 sources. Temporary D1 SQL exports were removed only after the first
post-cutover PostgreSQL backup was uploaded and restored successfully.

## Current production counts

Counts observed at `2026-08-19T14:31:52Z` while local processing was active:

| Table | Rows |
|---|---:|
| `sources` | 81 |
| `articles` | 88,106 |
| `research_jobs` | 88,106 |
| `research_results` | 77,814 |
| `prediction_outcomes` | 59,768 |
| `prediction_daily_points` | 11,574 |
| `prediction_daily_points_v2` | 396,912 |
| `source_checks` | 9,297 |
| `source_check_details` | 732,564 |
| `feed_item_ledger` | 89,681 |
| `article_corpus_objects` | 77,813 |

The local queue had completed 133 jobs and had no pending or running work at
that instant. These values are expected to increase continuously.

## Verification completed

- All services passed `/srv/platform/scripts/health-audit.sh`: PostgreSQL,
  Caddy, API, scheduler, worker, Codex runner, credential rotator, market
  tracker, corpus archiver, snapshot publisher, cloudflared, and gateway.
- A real bounded local Codex synthesis completed successfully before cutover.
- The public dashboard loaded its widgets, accuracy tables, charts, outcomes,
  and authenticated live updates through Worker -> VPC Service -> Tunnel ->
  local API.
- The source scheduler checked 81/81 sources at exact boundaries and queued new
  articles for all eight local workers.
- The private tunnel was stopped deliberately while processing remained live.
  Cloudflare served the `2026-08-19T14:25:01Z` snapshot, displayed the offline
  banner, and disabled fixed-data controls. After the tunnel restarted, the
  dashboard returned to live data and reconnected its update stream.
- PostgreSQL backup `cartdotcom-20260819T142941Z.dump` is 285,499,674 bytes.
  It was uploaded to private R2 in nine verified chunks, downloaded again,
  reconstructed, hash-checked, and accepted by `pg_restore --list`.

## Failure behavior

- A server power outage stops ingestion, inference, price tracking, and live
  API writes. Durable PostgreSQL leases and queue records allow work to resume
  after Docker restarts.
- The public page remains available from Cloudflare and serves the most recent
  snapshot. It is intentionally read-only until the private origin recovers.
- Cloudflare does not become a second processing authority automatically. This
  prevents duplicate source checks and duplicate Codex calls.
- Hardware loss still requires restoration of PostgreSQL and the article corpus
  onto replacement hardware. The verified R2 database backup covers
  PostgreSQL; corpus mirroring and the retained Cloudflare corpus remain the
  off-host source for article files.

## Remaining observation work

1. Keep Cloudflare rollback resources during the 7-14 day observation period.
2. Watch source failure rates, worker leases, price tracking, disk space, and
   daily offsite backup verification.
3. Remove temporary Cloudflare migration permissions after the observation
   checks no longer require another D1 export.
4. Decommission paid Cloudflare compute resources only after their replacement
   is proven unnecessary; retain the Worker, VPC binding, tunnel, R2 snapshot,
   and backup paths required by the current hybrid design.
