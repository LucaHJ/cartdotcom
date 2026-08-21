# Instagram Reel Self-Hosted Changelog

## 2026-08-21

- Corrected a Phase 4 mirror timestamp bug after production D1 proved two
  post-watermark jobs were missed: D1 timestamps stored as
  `YYYY-MM-DD HH:MM:SS` are now compared through SQLite `datetime(...)` against
  ISO watermarks/cursors, object authorisation uses bounded `EXISTS` checks,
  and the normal mirror credential cannot lower its watermark below
  `2026-08-21T01:42:46Z`.
- Deployed Worker versions `6b996b47-1efc-4d51-be4f-9a75e0352a54` and
  `e655c493-fc02-4d01-98e6-5cd1659fe77d` for the correction; temporary replay
  credential versions `d4240023-fd6e-437b-aa52-64645103f5e7` and
  `b7d06948-4cd5-4d59-a88d-56049b0ce53d` were created and revoked without
  exposing plaintext.
- The existing live mirror recovered through the supervised path:
  `2026-08-21T03:01:28Z` mirrored 134 rows and 92 objects; `03:06:35Z`
  mirrored 41 additional rows and 24 objects. Local Phase 4 state had 0
  divergences and 0 mirror errors at verification.
- Blocked the proposed historical acceleration rather than widening scope:
  exact cutoff `2026-08-19T05:18:26Z` currently returns 48 jobs / 192 events /
  697 artifacts / 251 resources, while the delegated aggregate expected 50 /
  200 / 731 / 268. No historical replay schema/run/object root was created.
- Started bounded Phase 4 shadow live intake after explicit approval for a
  dedicated mirror credential.
- Added `PHASE4_MIRROR_TOKEN`, a scoped authenticated GET-only Worker mirror
  surface, local Phase 4 cursor/receipt/divergence tables, and a Python
  server-side pull mirror.
- Established Phase 4 watermark `2026-08-21T01:42:46Z` and started the
  server-side mirror/health observation under
  `/srv/cartdotcom/reel-brain-runs/phase4-shadow/2026-08-21_01-42-46`.
- Kept Cloudflare as sole production authority; no local claims, Codex,
  publication, Instagram outbound operations, auth rotation, or backlog work
  were enabled.
- Corrected Phase 4 reliability defects before any nonempty live row/object was
  mirrored: fixed partial-page cursors, enforced command/pending created-time
  watermarks, moved cursor authority to PostgreSQL, quarantined bad objects
  before final rename, added row/typed-hash conflict guards, replaced raw
  `nohup` loops with boot-enabled cron watchdog supervision, and reset the
  formal observation start to `2026-08-21T02:05:01Z`.
- Applied a second bounded Phase 4 reliability correction while live mirror
  state was still empty: row conflicts now persist divergence evidence outside
  the failing upsert transaction, actual typed-row JSON snapshots detect local
  manual drift before overwrite, the watchdog rejects stale/reused PIDs by
  command identity, and the formal observation start moved to
  `2026-08-21T02:26:10Z`. No Worker redeploy was needed.
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
