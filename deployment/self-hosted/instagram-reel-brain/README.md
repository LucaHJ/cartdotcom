# Instagram Reel Brain Self-Hosted Runtime

Current state: Phase 7 local-primary data path is active under the explicit
2026-08-26 user override. Ubuntu generation 2 is the only new-job processor;
PostgreSQL schema `reel_phase7_primary_20260825_133007` and
`/srv/cartdotcom/reel-brain-data` hold the local primary copy. Cloudflare
continues to provide Meta intake, durable D1 edge spool/recovery, R2/KV mirror
and fallback, callbacks, and rollback. Historical backlog remains disabled.

See `docs/PHASE_7_CUTOVER_REPORT_2026-08-26.md` and
`docs/OPERATOR_GUIDE.md` before operating the service. Phase 8 is not
authorised.

This repository began as the Phase 1 inert scaffold. The six original Compose
services remain health-only and fail closed, while the credential-separated
one-shot control/compute runtime is invoked by two host-supervised exact
dispatchers.

## Services

- `reel-api`
- `reel-dispatcher`
- `reel-worker`
- `reel-publisher`
- `reel-archiver`
- `reel-auth-rotator`

## Safety State

- D1 authority: `mode=self_hosted`, `generation=2`
- local dispatcher slots: `2`
- dispatcher safety poll: `300` seconds
- `REEL_INTAKE_ENABLED=false`
- `REEL_DISPATCH_ENABLED=false`
- `REEL_WORKER_ENABLED=false`
- `REEL_CODEX_ENABLED=false`
- `REEL_OUTBOUND_ENABLED=false`
- `REEL_MUTATIONS_ENABLED=false`
- `REEL_BACKLOG_ENABLED=false`
- historical backlog processing: disabled

The private Phase 7 origin binds only to Docker bridge address
`172.19.0.1:3110` and is reachable from Cloudflare through the dedicated VPC
Service. No public host port or Docker socket is exposed.

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

The Phase 1 gate passed on 2026-08-21. Its original evidence remains in
`docs/PHASE_1_GATE_REPORT_2026-08-21.md`; current authority is described only
by the Phase 7 report and operator guide. Backlog work remains prohibited.

## Historical Phase 3 shadow migration tooling

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

## Historical shortened Phase 1 health gate

The bounded synthetic health-gate workload is intentionally separate from
production ingestion and never processes the Instagram backlog. It exercises
the isolated Reel network, health endpoints, CPU, memory, and the Reel runs
volume while Cloudflare was the sole processing authority at that phase.

Start it with an explicit UTC deadline:

```bash
REEL_STRESS_DEADLINE_EPOCH=<epoch> docker compose -f compose.health-gate.yaml up -d
```

`scripts/health-gate-monitor.sh` records both Reel and News container health.
The server cron entry runs it every five minutes and removes itself after the
deadline. Results are written under
`/srv/cartdotcom/reel-brain-runs/health-gate`.
