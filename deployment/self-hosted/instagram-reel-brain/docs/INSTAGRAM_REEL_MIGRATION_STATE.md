# Instagram Reel Migration State

Status: Phase 1 inert scaffold.

Cloudflare remains the only production authority. The local scaffold does not
receive Meta callbacks, claim jobs, call Codex, send Instagram output, publish
Pages/KV/R2 data, import D1/R2/KV state, or process backlog.

## Enabled

- Six container-internal health endpoints.
- Isolated Docker networks `cartdotcom-reel-runtime` and
  `cartdotcom-reel-egress`.
- Empty local storage roots prepared for later phases.
- Example backup and secret contracts.

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

## Limits

- Total Reel project memory ceiling: 1.75 GiB.
- Total Reel project CPU ceiling: 1.85 cores.
- Worker concurrency: 1.
- PID limit: 128 per service.
- No host ports.
- No shared `cartdotcom-edge` or `cartdotcom-data` membership in Phase 1.
