# Cartdotcom Self-Hosted Platform

This directory contains the single-server replacement for the Cloudflare-hosted
Cartdotcom services. Cloudflare remains production until the parity and cutover
checks in `docs/MIGRATION_RUNBOOK.md` have passed.

## Current stage

The current shadow stage provides:

- Docker Engine and Docker Compose on Ubuntu Server 24.04 LTS.
- A private PostgreSQL database for durable application state.
- A Caddy gateway bound to server loopback while the deployment is staged.
- A root-owned secrets area and separate `/srv` directories for each workload.
- Server-local operating and application-onboarding documentation.
- A durable scheduler, eight-slot Codex worker/runner split, and market tracker,
  all guarded off while Cloudflare remains authoritative.
- A full-page article extractor, filesystem corpus archiver, isolated Codex
  credential rotator, and database-backed single-writer authority guard.
- The existing dashboard, token authentication, live WebSocket signals, and
  PostgreSQL-backed compatibility read APIs.
- A five-minute, private Cloudflare dashboard snapshot that preserves the
  latest tables and charts when the physical server is unavailable.

It does not redirect production traffic. A verified D1 snapshot and all 76,248
stored R2 article corpus objects are imported into the self-hosted staging stack.

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

The gateway initially listens only on `127.0.0.1:8080`. Public or LAN ingress is
enabled only during the cutover stage.

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
