# Instagram Reel Self-Hosted Changelog

## 2026-08-21

- Started bounded Phase 3 shadow migration after Phase 2 acceptance.
- Captured a read-only D1 export, imported it into an isolated
  non-authoritative PostgreSQL shadow schema, and reconciled all D1 table row
  counts.
- Resolved R2 object inventory through a local-only Wrangler dev Worker with a
  `remote: true` R2 binding; no Worker was deployed.
- Reconciled all 5,673 R2 bucket objects against 5,120 D1-derived keys,
  classified 553 unreferenced objects, and copied every bucket object into the
  ignored shadow root with size verification and local SHA-256 checkpoints.
- Corrected Phase 3 after review by placing the full shadow on the Ubuntu
  server, verifying all 5,673 objects and 1,527,301,212 bytes server-side, and
  preserving the earlier one-file server run as audit evidence.
- Added a separate typed operational PostgreSQL shadow schema
  `reel_phase3_operational_20260821_040408` with explicit D1 drift handling,
  runtime-secret redaction, row/FK/unique checks, and read-only repository/API
  parity checks.
- Generated local library manifests and read-only parity reports; Phase 3 is
  complete for independent review and Phase 4 remains blocked.
- Adjudicated the deadline-only synthetic stress stop as a monitor false
  positive; raw gate evidence remains preserved.
- Approved bounded Phase 2 contract and isolated-fixture implementation after
  the amended health gate passed.
- Kept Cloudflare as sole production authority and retained all intake,
  dispatch, Codex, outbound, mutation, publication, data-import, and backlog
  controls in their disabled Phase 1 state.

## 2026-08-20

- Added Phase 1 inert Compose scaffold.
- Added isolated Reel runtime and egress networks.
- Added health checks, resource ceilings, PID limits, no-new-privileges, backup
  definition, secret contract, and verification script.
- No ingress, production data migration, Cloudflare mutation, Meta callback
  change, Codex execution, outbound delivery, or backlog processing.
