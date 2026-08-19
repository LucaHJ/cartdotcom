# News API Compatibility Matrix

The self-hosted implementation keeps the Cloudflare Worker URLs and response
shapes so the existing dashboard does not require a rewrite. Production remains
on Cloudflare until all required rows are marked verified.

| Route group | Purpose | Self-hosted status |
|---|---|---|
| `/health` | Service and route discovery | Verified live/readiness endpoints |
| `/api/status`, `/api/status/live` | Dashboard counts and worker telemetry | Verified |
| `/api/snapshot/status` | Private Cloudflare snapshot metadata | Verified on Cloudflare |
| `/api/events` | Near-real-time dashboard notifications | Verified authenticated WebSocket and PostgreSQL notifications |
| `/api/sources`, `/api/source-*` | Sources, checks, statistics, and activity | Verified read paths |
| `/api/articles*` | Article metadata, text, archive, and backfill | Reads and manual archive implemented; full-page capture runs before local synthesis |
| `/api/corpus*` | Full article object storage | Filesystem adapter and all 76,248 stored R2 objects verified |
| `/api/jobs*`, `/api/results` | Queue state, failures, and analysis results | Verified read paths |
| `/api/ticker-signals`, `/api/market-impacts` | Legacy aggregated analysis | Not called by the current dashboard; excluded from cutover scope |
| `/api/predictions*` | Outcomes, accuracy matrix, and daily movement | Verified read paths; mutations owned by market tracker |
| `/api/model-experiments*` | Luna/Terra experiment history and controls | History/report verified; the completed one-off experiment is retained read-only |
| `/api/ingest`, `/api/process-*` | Feed checks and queue dispatch | Manual ingestion command and pending-job dispatch implemented behind authority guard |
| `/api/research/*` | Recovery, authentication rotation, and reanalysis | Queue recovery, failed-job remediation, and atomic Codex auth rotation implemented |
| `/api/simulation*` | Decommissioned paper trading routes | Must continue returning HTTP 410 |
| `/container/*` | Codex worker diagnostics and research | Replaced by isolated local worker/runner health services |

## Implemented staging-only routes

These routes are intentionally namespaced and are not part of the final public
contract:

- `GET /api/self-hosted/health/live`
- `GET /api/self-hosted/health/ready`
- `GET /api/self-hosted/status`

## Verification rule

A route is complete only when tests compare status code, required headers,
response keys, filtering, pagination, authentication, and representative
database results against the current Cloudflare implementation.

The executable dashboard contract check is
`news/api/dashboard-contract-check.js`. The 2026-08-19 staging audit passed 20
functional checks plus authenticated desktop and mobile visual checks. See
`DASHBOARD_AUDIT.md` for the exact scope.

All local mutations require both `API_MUTATIONS_ENABLED=true` and the durable
`runtime_authority.owner = 'self_hosted'` record. The scheduler, research
worker, market tracker, and corpus archiver independently enforce the same
authority record before claiming work.

During a self-hosted outage, Cloudflare can answer the dashboard's supported
GET routes from the latest snapshot. Responses include
`X-News-Signal-Mode: snapshot` and `X-News-Signal-Snapshot-At`. Mutation routes
never fall back and return HTTP 503 when the local origin is unavailable.
