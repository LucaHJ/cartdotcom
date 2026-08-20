# Instagram Reel Brain Self-Hosted Scaffold

This is the Phase 1 inert local application scaffold from the migration plan.

It is intentionally not a processor yet. Cloudflare remains production
authority, and the local containers expose only health checks on private Docker
networks.

## Services

- `reel-api`
- `reel-dispatcher`
- `reel-worker`
- `reel-publisher`
- `reel-archiver`
- `reel-auth-rotator`

## Safety State

- `REEL_PROCESSING_AUTHORITY=cloud`
- `REEL_INTAKE_ENABLED=false`
- `REEL_DISPATCH_ENABLED=false`
- `REEL_WORKER_ENABLED=false`
- `REEL_CODEX_ENABLED=false`
- `REEL_OUTBOUND_ENABLED=false`
- `REEL_MUTATIONS_ENABLED=false`
- `REEL_BACKLOG_ENABLED=false`
- `REEL_WORKER_CONCURRENCY=1`

No service publishes a host port, joins the shared platform edge/data networks,
reads production secrets, or modifies production Cloudflare resources.

## Server Paths

```text
/srv/cartdotcom/instagram-reel-brain   Compose project source
/srv/cartdotcom/reel-brain-data        Future local artifact/data root
/srv/cartdotcom/reel-brain-runs        Future per-job work root
/srv/backups/instagram-reel-brain      Future backup staging
```

## Verify

```bash
npm test
docker compose config --quiet
docker compose up -d --build --wait
./scripts/verify-scaffold.sh
```

The Phase 1 gate passed on 2026-08-21. Only the bounded Phase 2 contract and
isolated-fixture work described in
`docs/PHASE_1_GATE_REPORT_2026-08-21.md` is approved. Do not begin production
data migration, ingress provisioning, local processing, or backlog work.

## Phase 3 shadow migration tooling

Phase 3 is a manual operator workflow only. The tooling in
`scripts/phase3_shadow_migration.py` can inventory a captured D1 export, import
it into non-authoritative PostgreSQL audit and typed operational shadow
schemas, reconcile/copy R2 artifacts, verify workstation and server shadow
copies, and produce library/D1/PostgreSQL parity reports.

The Phase 3 gate is complete for independent review. See
`docs/PHASE_3_GATE_REPORT_2026-08-21.md`.

The tool does not run as a service and has no intake, dispatch, Codex,
publication, Instagram outbound, auth-rotation, or backlog authority.

The local R2 inventory Worker under `tools/r2-inventory-worker/` is for local
`wrangler dev` only. It is GET-only, list-only, and must not be deployed.

## Shortened Phase 1 health gate

The bounded synthetic health-gate workload is intentionally separate from
production ingestion and never processes the Instagram backlog. It exercises
the isolated Reel network, health endpoints, CPU, memory, and the Reel runs
volume while Cloudflare remains the sole processing authority.

Start it with an explicit UTC deadline:

```bash
REEL_STRESS_DEADLINE_EPOCH=<epoch> docker compose -f compose.health-gate.yaml up -d
```

`scripts/health-gate-monitor.sh` records both Reel and News container health.
The server cron entry runs it every five minutes and removes itself after the
deadline. Results are written under
`/srv/cartdotcom/reel-brain-runs/health-gate`.
