# Cartdotcom Self-Hosted Platform

This directory contains the production self-hosted News Signal backend.
Cloudflare remains the public gateway, private tunnel endpoint, dashboard
snapshot fallback, and offsite backup store; news processing runs on Ubuntu.

## Current production state

The deployed system provides:

- Docker Engine and Docker Compose on Ubuntu Server 24.04 LTS.
- A private PostgreSQL database for durable application state.
- A Caddy gateway bound to server loopback and a private Cloudflare Tunnel.
- A root-owned secrets area and separate `/srv` directories for each workload.
- Server-local operating and application-onboarding documentation.
- A durable scheduler, eight-slot Codex worker/runner split, and market tracker
  guarded by a database-backed single-writer authority record.
- A full-page article extractor, filesystem corpus archiver, isolated Codex
  credential rotator, and database-backed single-writer authority guard.
- The existing dashboard, token authentication, live WebSocket signals, and
  PostgreSQL-backed compatibility read APIs.
- A five-minute, private Cloudflare dashboard snapshot that preserves the
  latest tables and charts when the physical server is unavailable.

Production dashboard API traffic is routed through a private Workers VPC
Service. The final D1 state and 77,670 verified R2 article corpus objects were
imported before local processing authority was enabled.

## Layout on the server

```text
/srv/platform       Shared proxy and database configuration
/srv/cartdotcom     Cartdotcom application and worker services
/srv/media          Personal media applications
/srv/codex-lab      Other Codex workloads
/srv/backups        Local backup staging
/srv/docs           Operator documentation
/srv/platform/secrets Host-managed platform secrets
```

## Deployment

Run the host bootstrap once as root, then start the platform as the `lucaj`
account:

```bash
sudo bash bootstrap-host.sh
./scripts/init-secrets.sh
docker compose up -d
./scripts/verify-platform.sh
```

The gateway listens only on `127.0.0.1:8080`. Public access is provided through
the private Tunnel and Workers VPC Service; no LAN or router port is opened.

## Documentation

- `docs/SERVER_OPERATIONS.md`: installed components, common commands, upgrades,
  service ownership, and troubleshooting.
- `docs/ADDING_APPLICATIONS.md`: required procedure for adding another service.
- `docs/MIGRATION_RUNBOOK.md`: staged Cloudflare migration and rollback process.
- `docs/OUTAGE_RECOVERY.md`: power-loss behavior, automatic restart, durable
  queue semantics, and remaining single-host risks.
- `docs/DASHBOARD_SNAPSHOTS.md`: Cloudflare snapshot publishing, outage mode,
  recovery behavior, security boundaries, and verification commands.
- `docs/PRIVATE_INGRESS.md`: private Tunnel and Workers VPC binding setup,
  permissions, cutover guard, and failure behavior.

Never commit files from `secrets/`, `.env`, database dumps, Codex credentials,
dashboard tokens, or provider API keys.
