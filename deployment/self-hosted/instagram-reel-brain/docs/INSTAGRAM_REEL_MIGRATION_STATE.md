# Instagram Reel Migration State

Status: Phase 3 shadow data migration completed for independent review.

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
- Local R2 shadow copy of all 5,673 bucket objects under ignored `runs/`.
- Local library manifests generated from copied data only.

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
- Phase 4 shadow live intake.
- Production delta mirroring.

## Limits

- Total Reel project memory ceiling: 1.75 GiB.
- Total Reel project CPU ceiling: 1.85 cores.
- Worker concurrency: 1.
- PID limit: 128 per service.
- No host ports.
- No shared `cartdotcom-edge` or `cartdotcom-data` membership in Phase 1.

## Current gate

Phase 3 is waiting for independent review. Phase 4 remains blocked. Cloudflare
is still the sole production authority.
