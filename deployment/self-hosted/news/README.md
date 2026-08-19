# Self-Hosted News Service

This service is the production backend for the existing Cloudflare News Signal
dashboard. It serves PostgreSQL-backed APIs, authenticated WebSocket events,
the filesystem article corpus, source ingestion, Codex synthesis, and market
tracking. Cloudflare proxies to it through a private VPC Service binding.

## Start or rebuild

```bash
cd /srv/cartdotcom/news
docker compose build
docker compose run --rm migrate
docker compose up -d --wait
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
pagination, WebSocket authentication, unauthorized rejection, and the retired
simulation response. Never put the dashboard token in Git or a shell-history
file.
