# Instagram Reel Self-Hosted Changelog

## 2026-08-22

- Corrected the Phase 5C security blocker in commit `aff756d`: the runtime is
  now split into stopped/profile-gated `phase5-control` and `phase5-compute`
  services. PostgreSQL and future Worker control secrets are available only to
  `phase5-control`; Codex auth and media processing are available only to
  `phase5-compute`. Canary probes proved control can read synthetic control
  secrets while shell/Codex execution inside compute cannot stat/read/hash them,
  and the processor now launches Codex with a minimal sanitised environment.
  Final images are
  `cartdotcom-instagram-reel-brain-phase5-control:latest`
  (`sha256:a69e4104f873fa11ac84bf165d0c1881f6821c19896e3b16c79ef7b31a449305`) and
  `cartdotcom-instagram-reel-brain-phase5-compute:latest`
  (`sha256:27781d361c78ea5bb53180073b397bb1a615246a7faeafdef8a71af8caa7c475`).
  No real Worker control token was created, no live arm/job/backlog/authority
  work occurred, and both services remain stopped.
- Added the dedicated inert Phase 5C Reel media/Codex runtime in commit
  `2f9f8e4`: `phase5-runner` is profile-gated, `restart: "no"`, read-only
  root filesystem, no selector/scheduler/claim loop, isolated Reel
  runtime/egress networks only, and all execution/mutation flags disabled.
- Built Ubuntu image
  `cartdotcom-instagram-reel-brain-phase5-runner:latest`
  (`sha256:a3bbdc7a1ee58214c895c85a64103c49dc0e13a46fd4d168a6622baec2a74d64`,
  `443614754` bytes) and proved inert health, dependency versions,
  fail-closed runner invocation, no-network synthetic media extraction/fake
  Codex, and one redacted Codex CLI auth smoke. The runtime remains stopped and
  no live job, arm, backlog, publication, reaction, or authority change
  occurred.
- Corrected the Phase 5C runtime blocker in commit `e42cb63`: the exact runner
  now has container-native PostgreSQL control through `psycopg` and a read-only
  `/run/secrets/postgres_password` mount, while the old SSH/Docker/psql path is
  explicit `legacy-ssh` mode only. Ubuntu probes now prove exact dry-run,
  guarded local transition, restart, rollback, fake Worker token-file control,
  and fail-closed missing-PG/bad-token behaviour before processor import. No
  existing server Phase 5/admin Worker token file was found, so live use remains
  blocked pending an approved token-file mount.
- Accepted the first exact Reel local pilot
  `b14b79a0-9264-4613-9421-9920cba053c3` as Phase 5 case 1 of 3 after
  independent review; Phase 5 and Phase 6 remain blocked.
- Completed bounded Phase 5B runner hardening in commit `918a496` and deployed
  Worker version `8d408b01-5323-40f3-847c-559320869be9`.
- Added admin-only exact start/finalize/abort Worker control routes and moved
  the self-hosted runner away from operational direct Wrangler/D1 mutation.
- Added checkpointed crash/restart stages and one-command exact
  pre-publication rollback to `scripts/phase5_one_job_runner.py`.
- Copied the disabled-by-default Ubuntu runner to
  `/srv/cartdotcom/instagram-reel-brain/scripts/phase5_one_job_runner.py` and
  the cloud processor source to
  `/srv/cartdotcom/instagram-reel-brain/phase5-runner/container/app.py`.
- Proved Ubuntu no-live dry-run and synthetic rollback against isolated schema
  `reel_phase5b_runner_test_20260822133451`; no real job, arm, backlog,
  carousel, retrieval, note, Codex execution, publication, or Instagram
  outbound action occurred.
- Recorded the remaining Ubuntu runtime blocker: host Codex CLI and media
  dependencies are absent, while the News Codex runner has Codex/auth but not
  the Python/media stack required by the Reel processor. A dedicated Reel
  runner runtime is needed before the next live local case.

## 2026-08-21

- Completed the corrected Phase 4 historical replay validation after
  independent reconciliation of the replay slice. The immutable read-only
  slice is `2026-08-19T04:19:57Z <= created_at < 2026-08-21T01:42:46Z`,
  `status=complete`; it validated 50 jobs, 44 reels, 6 post/carousels, 200 job
  events, 722 artifacts, 258 resources, 1,075 object receipts, 0 divergences,
  and 0 mirror errors in isolated schema `reel_phase4_replay_20260821_031920`.
- Deployed replay-scope Worker version `dfbc9b8e-e442-45c1-a71a-57907606d393`;
  temporary replay-token versions `77de0a23-ce02-4566-8da4-d577b7bf73ae` and
  `710dd991-3780-43a5-b60a-8616788c49d3` installed and then removed
  `PHASE4_REPLAY_TOKEN` without retaining plaintext.
- Proved replay restart/idempotency with a first committed 25-row checkpoint,
  resumed full drain, then a zero-row second pass. No production D1/R2/KV
  writes, backlog consumption, Codex execution, publication, Instagram outbound
  action, or authority change occurred.
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
