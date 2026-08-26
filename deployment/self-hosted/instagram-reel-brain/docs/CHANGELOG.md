# Instagram Reel Self-Hosted Changelog

## 2026-08-26

- Recovered five new Reels stranded at `queued` after a legitimate corrective
  synthesis replaced D1 resource ids while retaining the same `(job_id, slug)`
  identities. The Phase 7 PostgreSQL mirror now audits and accepts only newer
  semantic replacements, clears stale local resources when a completed cloud
  job is reset to queued, and fails closed on older or locally divergent rows.
  Origin health now reflects mirror-drain outcomes, and each safety poll waits
  for its own exact wake receipt instead of treating wake acceptance as
  completion. All five affected jobs completed in one attempt; production
  ended idle with zero mirror divergences/errors and backlog disabled.
- Activated Phase 7 by explicit user override while preserving the failed and
  incomplete Phase 6 soak as historical evidence. PostgreSQL schema
  `reel_phase7_primary_20260825_133007`, local object/library roots, private
  VPC wake delivery, and 300-second safety polling are active. Cloudflare
  continues to provide Meta intake, D1 durable spool/recovery, R2/KV mirrors,
  callbacks, and rollback.
- Reconciled 335 jobs, 5,050 artifacts, 2,243 resources, 1,906 events, and
  132,846 retrieval terms. All 5,050 referenced artifact files
  (2,007,909,616 bytes) and 2,491 library pages verified. A bounded
  authenticated GET-only recovery route restored 140 missing R2 objects;
  orphan/superseded objects were preserved.
- Passed local-origin outage/static-fallback recovery, dispatcher/origin
  interruption recovery, isolated PostgreSQL restore, artifact restore sample,
  Worker/Pages auth scope, and regression tests. A physical host reboot and
  the first genuine post-deployment wake remain observation items. Phase 8 is
  not authorised.

## 2026-08-25

- Reduced the temporary cloud-to-Ubuntu handover bridge in commit `302eaba`:
  the ten-surface incremental mirror now sleeps 15 seconds between cycles and
  each of the two dispatchers polls every 10 seconds. The previous five-minute
  Phase 4 observation interval caused a measured 274.478-second queue wait.
  Live mirror completions now occur about 15.5-17.3 seconds apart. Backlog and
  authority settings were unchanged, and the old scripts are backed up under
  `/srv/cartdotcom/backups/reel/handover-poll-20260825T130701Z`.

- Raised Phase 6 processing concurrency from one to two in commit `4e4c86f`
  and Worker version `b20c3661-ea53-4622-8f92-e7604d9a1309`. Two exact worker
  identities are fenced in D1 and PostgreSQL, each dispatcher has an inherited
  slot lock, and speculative prefetch remains globally limited to one. New
  telemetry records queue wait, download, media preparation, Codex,
  completion, orchestration, control/handover, prefetch hits, overlap and
  throughput. The baseline is seven jobs averaging 250.413 seconds of
  orchestration; natural post-change shares are tracked automatically from
  `2026-08-25T12:47:56.931Z`. Backlog remains disabled.

- Increased the Phase 6 synthesis container from `0.10` to `0.50` CPU and
  added a secret-free `0.25` CPU Reel-only prefetch service in commit
  `c1e3765` / Worker version `4ff08465-a579-4b4e-b1aa-c1a39d6ede86`.
  The authenticated read-only endpoint exposes only the next armed,
  post-watermark Reel while the exact active job is already synthesising; it
  never claims or mutates the next job. Downloads are written atomically to an
  exact job/URL-bound SHA-256 manifest and consumed only after verification.
  Three production jobs averaged `208.5` D1 processing seconds versus the
  prior non-stalled Ubuntu average of `238.1` seconds, a `12.4%` reduction.
  Two prefetched jobs loaded their media in `0.009` and `0.006` seconds. The
  inert service limits were reduced so the full declared project remains at
  `1.30` CPU and `1,792 MiB` even when synthesis and prefetch overlap.

- Recovered a Phase 6 serial-queue stall in commits `14c31d9` and `2a856f1`.
  Reel job `328ca9d8-7b14-4ab9-bd97-5fba1070bd44` timed out while extracting
  frames and remained `local_processing`; the exact stale lease then blocked
  all later work. Frame sampling now uses bounded input seeks, optional
  frame/audio timeouts no longer fail the whole media probe, claim conflicts
  for the same exact processing fence reconcile into restart, compute failure
  invokes the existing guarded pre-publication abort, and a newly inserted
  PostgreSQL lease is verified correctly. The dispatcher flock is inherited by
  its orchestrator child so a dispatcher restart cannot duplicate an orphaned
  compute process. The affected Reel completed with six frames and three
  resources, and the next queued job started automatically. Backlog mode and
  processing authority were not changed.

- Corrected the unsupported native-reply attempt in commit `fa489d4` and
  Worker version `7dbf5ffb-c80d-4b73-b803-0c18e1b3b2b8`. Two live retrievals
  selected the correct jobs but Meta rejected both `reply_to.mid` calls with
  HTTP 400, code `100`, subcode `2534002`, "Invalid message ID". The same fresh
  webhook message IDs remain valid reaction targets. Meta's Instagram-login
  Send API documents outbound text/media and inbound inline-reply webhooks, but
  no outbound inline-reply operation; media shares are restricted to media
  owned by the professional account. The Worker no longer makes the doomed
  call and has returned to one bare canonical URL per confident result.

- Changed confident Instagram retrieval delivery in commit `10f8727` and
  Worker version `090a0e9f-ea88-4831-914a-1468c5606ea7`. The Worker now looks
  up the matched completed job's original `source_message_id` and sends `.` as
  a native `reply_to` message to that share. Bare Reel URLs are retained only
  as a failed-reply or missing-message fallback; explicit archive requests keep
  the contextual MP4 flow. The prior Daigo result used the same bare-link path
  as other retrievals and only rendered differently because Instagram unfurled
  that URL. This attempted behaviour was subsequently disproved and removed as
  recorded above. No schema, backlog, processor, or authority setting changed.

- Replaced newest-first substring retrieval with a deterministic ranked search
  index in commits `8992658`, `43e50b0`, `c1f0c03`, and `b7a6364` and Worker
  version `282c170a-cafb-48c8-9317-e0cd878e774a`. Migration
  `0025_ranked_retrieval_index.sql` adds derived document and term tables.
  All 302 completed jobs were rebuilt from stored synthesis objects without
  Codex or resynthesis, producing 118,915 unique job-term rows and zero missing
  documents or hashes. The two reported live failures now select exact Reels
  `DbkYou1ph6B` and `DcbSU6ntnEF`; the prior Phase 5 retrieval regression still
  selects `DcOWkMakZ2k`. Ambiguous results return up to three candidates rather
  than silently sending the newest weak match. Phase 6 generation 2 authority,
  backlog state, dispatcher and soak configuration were unchanged.

## 2026-08-23

- Cut processing authority to the Ubuntu serial runner on generation 2 at
  watermark `2026-08-23T01:17:09.133Z`, retained Cloudflare intake/recovery,
  kept backlog disabled and concurrency one, exercised production rollback and
  re-cutover, and started the required seven-day monitored soak.

- Completed the third Phase 5 case: a new retrieval command selected exact
  carousel job `f74f0619-c6a6-46c2-8b97-6d0fc0b62a13` and sent one successful
  `reel_link` response. Phase 5 is complete; Phase 6 processing cutover and the
  required seven-day soak are next.

- Installed and verified the dedicated narrow `PHASE5_CONTROL_TOKEN` in
  commits `956d2a3` and `78110c4`; it authorizes only Phase 5 local-pilot
  routes and is mounted only into `phase5-control`.
- Added an exact carousel pre-intake arm and schema migration in commit
  `20cc589`, preserving one-active-arm enforcement across Reel and carousel
  cases.
- Corrected Cloudflare Error 1010 for the Ubuntu control client in commit
  `592fb49` by adding an explicit service User-Agent.
- Completed exact carousel pilot job
  `f74f0619-c6a6-46c2-8b97-6d0fc0b62a13`: four slides, four frames, ten
  resources, 15 mirrored artifacts, terminal fences, sampled R2 hashes all
  matching, and zero mirror divergences/errors.

## 2026-08-22

- Corrected the remaining Phase 5C operational blocker in commit
  `db79057`: added a host-side exact one-shot
  `phase5_one_job_orchestrator.py` plus staged `phase5_staged_runner.py`
  commands for control start, compute execution, control finalize, and
  pre-publication abort across the split `phase5-control` / `phase5-compute`
  containers. Ubuntu synthetic E2E now covers complete flow, crash/restart
  after start, after compute, after processor callbacks before checkpoint,
  after cloud finalize before local completion, duplicate invocation,
  short-authority zero-compute, compute failure abort, and tampered checkpoint
  fail-closed. Final images are
  `cartdotcom-instagram-reel-brain-phase5-control:latest`
  (`sha256:cdeaa4c2c92e9ece8e16d6532cabd447d99fc9f715a6cb641968ece4ec8b51b7`)
  and `cartdotcom-instagram-reel-brain-phase5-compute:latest`
  (`sha256:ec0e8a1585051f75eef8afe5bb884afbde6e4ef73d3af23803fbbbd524e2070b`),
  both `443632338` bytes. No Worker deploy, real token setup, live arm/job,
  backlog, outbound action, production mutation, or authority change occurred;
  Phase 5 services remain stopped.
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
