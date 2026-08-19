# Dashboard Outage Snapshots

The public Cloudflare Worker remains the dashboard entry point after the news
backend moves to the Ubuntu server. It normally proxies authenticated API calls
to the local server through a Cloudflare Tunnel. If that origin is unavailable,
supported GET requests are answered from the latest private R2 snapshot.

The public dashboard credential and private server credential remain separate.
Cloudflare validates the user's existing dashboard token, then replaces it with
the server-only origin token before forwarding a live API or WebSocket request.

## Current state

- Cloudflare snapshot upload, validation, storage, and fallback code is
  deployed.
- The server publisher is running and refreshes the snapshot every five minutes
  on exact five-minute boundaries.
- The public gateway is not yet proxying to the server because
  `SELF_HOSTED_API_ORIGIN` is intentionally unset during staging.
- Cloudflare remains the production processing authority until final cutover.

## Snapshot contents

The bundle contains the API payloads needed for the current dashboard widgets,
tables, accuracy heatmap, prediction movement graph, prediction outcomes,
source table, source activity chart, ticker pipeline table, job table, archived
failures, article-impact list, and model-experiment history.

It does not contain bearer tokens, upload credentials, Codex authentication,
database credentials, or full article plaintext. The private R2 object key is
`_system/dashboard/latest-v1.json` in the existing article-corpus bucket.

## Publishing

The `dashboard-snapshot` container reads the local compatibility API using the
dashboard token. It has no PostgreSQL password or database network access. It
collects endpoints sequentially to avoid competing analytics queries exhausting
PostgreSQL shared memory, hashes the complete response map, and uploads it with
a dedicated credential stored at:

```text
/srv/platform/secrets/snapshot_upload_token
```

Cloudflare checks the credential, 4 MiB size limit, schema, response count,
timestamp, and SHA-256 hash before atomically replacing the latest R2 object. A
partial collection is never uploaded.

## Dashboard outage behavior

Snapshot responses carry these headers:

```text
X-News-Signal-Mode: snapshot
X-News-Signal-Snapshot-At: <UTC timestamp>
```

The existing dashboard then shows a dated `Offline snapshot` banner. Tabs,
theme selection, token controls, external article links, tables, and graphs
remain available. Mutations, filters, source-period navigation, outcome sorting,
heatmap selection, and infinite scrolling are disabled because the snapshot is
a fixed dataset.

While in snapshot mode, the browser probes `/api/status/live` every 30 seconds.
When Cloudflare receives a successful live response, the dashboard removes the
banner, reloads all current data, reconnects its WebSocket, and restores full
controls automatically.

## Operations

Check the publisher:

```bash
cd /srv/cartdotcom/news
docker compose ps dashboard-snapshot
docker compose logs --tail=100 dashboard-snapshot
docker exec cartdotcom-news-dashboard-snapshot-1 \
  wget -qO- http://127.0.0.1:3004/healthz
```

Check private Cloudflare snapshot metadata using the current public dashboard
token without printing it:

```bash
read -rsp "Current Cloudflare dashboard token: " TOKEN
echo
curl --fail --silent \
  -H "Authorization: Bearer ${TOKEN}" \
  https://cartdotcom-news-signal-container.lucajeannin.workers.dev/api/snapshot/status
unset TOKEN
```

The snapshot must not be treated as an off-host PostgreSQL or article-corpus
backup. It is only a compact continuity view of recent dashboard data.
