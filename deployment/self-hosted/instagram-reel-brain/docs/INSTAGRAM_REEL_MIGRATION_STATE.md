# Instagram Reel Migration State

Status: Phase 2 accepted; Phase 3 shadow data migration started and blocked
before R2 artifact transfer.

Cloudflare remains the only production authority. The local scaffold does not
receive Meta callbacks, claim jobs, call Codex, send Instagram output, publish
Pages/KV/R2 data, or process backlog.

The Phase 3 attempt is recorded in `PHASE_3_GATE_REPORT_2026-08-21.md`.

## Enabled

- Six container-internal health endpoints.
- Isolated Docker networks `cartdotcom-reel-runtime` and
  `cartdotcom-reel-egress`.
- Empty local storage roots prepared for later phases.
- Example backup and secret contracts.
- Non-authoritative Phase 3 PostgreSQL shadow schema
  `reel_phase3_shadow_20260821_040408`.
- ACL-restricted local Phase 3 D1 snapshot under ignored `runs/`.

## Disabled

- Intake.
- Dispatch.
- Worker execution.
- Codex.
- Outbound delivery.
- Mutations.
- Backlog.
- Publisher.
- Archiver.
- Auth rotation.
- R2 artifact transfer, blocked by unresolved object inventory mismatch.

## Limits

- Total Reel project memory ceiling: 1.75 GiB.
- Total Reel project CPU ceiling: 1.85 cores.
- Worker concurrency: 1.
- PID limit: 128 per service.
- No host ports.
- No shared `cartdotcom-edge` or `cartdotcom-data` membership in Phase 1.

## Current blocker

R2 bucket info reports 5,673 objects, while the D1-derived artifact/key
manifest contains 5,120 object keys. Full R2 object-list access is required to
reconcile the 553-object gap before any artifact transfer can safely begin.
