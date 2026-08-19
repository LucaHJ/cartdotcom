# Self-Hosted News Service

This service is the compatibility target for the existing Cloudflare News
Signal dashboard. Its current read-only staging build serves the complete
dashboard, PostgreSQL-backed read APIs, authenticated WebSocket events, and the
filesystem-backed article corpus. Production ingestion remains on Cloudflare
until the cutover gates pass.

## Start in staging

```bash
cd /srv/cartdotcom/news
docker compose build
docker compose run --rm migrate
docker compose up -d news-api
curl --fail http://127.0.0.1:8080/api/self-hosted/health/ready
```

The service is not published directly. Caddy reaches it through the private
`cartdotcom-edge` network.

## Dashboard contract check

With an SSH tunnel to the staging gateway, run:

```bash
DASHBOARD_URL=http://127.0.0.1:18080 \
DASHBOARD_TOKEN=... npm run check:dashboard
```

The check covers every read route used by the current UI, prediction cursor
pagination, WebSocket authentication, unauthorized rejection, the retired
simulation response, and the staging mutation lock. Never put the dashboard
token in Git or a shell-history file.
