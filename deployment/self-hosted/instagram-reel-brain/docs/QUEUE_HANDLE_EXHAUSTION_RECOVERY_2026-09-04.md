# Reel queue handle-exhaustion recovery

Recorded: 2026-09-04 Australia/Brisbane (server timestamps below are UTC).
Scope: repair current live intake; no historical backlog or authority change.

## Cause and impact

At 2026-09-03T14:13Z, origin PID 83975 held 1,023 descriptors against its
1,024 soft limit: 509 SQLite database handles, 508 WAL handles, one shared-memory
handle, and process/socket/log descriptors. `OriginState._connect()` returned a
SQLite connection used as a transaction context manager, which did not close
it. GC-dependent cleanup eventually exhausted handles. The origin still ran,
but wake/manifest/health requests failed with `unable to open database file`.
Last successful drain was 2026-09-03T03:11:27.836Z.

Both dispatchers repeatedly reported `mirror_pending`. D1 retained eleven
queued/queued jobs with attempts=0, not eight by the time of inspection. Five
unclaimed six-hour fences had also expired. Legacy status checks verified cloud
configuration/connectivity, not Ubuntu handover or actual queue progress. The
origin watchdog tested PID identity only and also inherited its lock into the
origin process, preventing subsequent watchdog checks from acquiring it.

## Repair

Code commit: `ffb7e08`. Worker deployment:
`b913cb2d-b2d9-481b-8b58-e57a0659e7cb` (Worker only, no container rollout).

- `scripts/phase7_origin.py`: `_connect()` now explicitly closes in `finally`
  after commit/rollback, including PRAGMA failure. `mirror_health()` returns
  red storage-unavailable status rather than throwing; completed-drain age
  over 600 seconds is stale. `_drain()` persists timeout/spawn failures as
  failed receipts. Failed wake receipt writes return HTTP 503.
- `scripts/phase7_origin_watchdog.sh`: checks HTTP responsiveness, restarts
  only after three consecutive transport/storage failures, preserves logs,
  verifies exact PID identity, refuses a second process if termination fails,
  and closes inherited descriptor 9. Semantic data divergence does NOT cause
  an automatic restart. Cron cadence remains one minute.
- Worker `src/pipeline-health.ts` and `handleReelLibraryStatus()`: bounded
  five-second origin probe, freshness validation, and independent queue progress
  check. Ten-minute waiting queue without a processor and twenty-minute stale
  running state are red. The existing UI renders both new check rows and its
  overall indicator from those values; no Pages deployment was needed.
- Worker `src/queued-fence-renewal.ts` plus `phase6NextCandidate()` and
  `handlePhase6Claim()`: expired never-started reservations remain selectable;
  authenticated exact claim renews a short/expired reservation to six hours in
  an audited D1 batch. This requires current self-hosted generation, exact
  source/job/pilot identity, post-cutover creation, no pilot backlog, attempts=0,
  no prior start/completion/publication/callback/owner. No execution lease or
  previously processed job is implicitly revived. Normal two-slot claims and
  execution-expiry bounds remain unchanged.

## Evidence

- Cloud typecheck and 140/140 Node tests passed, including connected SQLite
  renewal, rollback injection, stale origin, deadline, and queue-progress tests.
- Full self-hosted Node suite: 75 passed, one expected Windows symlink skip;
  includes isolated connected PostgreSQL repository/transaction tests.
- Python dispatcher regressions: 10/10 passed. New origin tests: 6/6 on Ubuntu,
  including 2,000 reads with GC disabled and no descriptor growth, commit/rollback
  close checks, timeout receipt persistence, and executable synthetic watchdog
  restart after three failures. Lock reacquisition succeeded while the new
  synthetic origin remained running. No production kill was used for that test.
- Existing origin HTTP tests: 4/4 passed. Python compilation, shell syntax, and
  Worker dry-run passed.
- At 14:15Z the repaired origin resumed the existing cursor; no cursor reset,
  job replay, database deletion, or backlog enable was needed. The production
  descriptor count remains four between requests. Exact safety-wake receipt
  completed successfully; current mirror errors/divergences both zero.
- First recovered job `d353a371-0284-4a42-9553-07d15701ba55` completed on attempt 1
  in 254.6 seconds. Expired oldest job `dd20d4ea-7401-449d-83cc-df592a9942e7`
  automatically renewed at 14:20:53.890Z (old expiry 11:10:24.038Z; new expiry
  20:20:53.890Z), then entered downloading on attempt 1.
- At 14:23Z both D1 and PostgreSQL showed one complete, two running and eight
  queued from this incident. Remaining work continues under the normal bounded
  dispatchers; this report does not claim all eleven have completed.
- Final 14:24Z D1 check: two complete, two synthesising, seven queued. The two
  oldest expired reservations have both renewed and started automatically, with
  one renewal audit each. Descriptor count is 4 idle / 6 during a live request.
- Browser verification at `/backend/reel-library`, Status: both new check rows
  visible; healthy fresh handover and processing/queued counts display correctly.
- News/Reel/Caddy/PostgreSQL remained healthy. Host disk 17% used, ~12 GiB RAM
  available. No service limits, credentials, authority generation or backlog
  settings were changed.

## Evidence paths and rollback

Server backup: `/srv/cartdotcom/instagram-reel-brain/backups/queue-fd-20260903T1420Z/`
contains pre-change origin scripts, origin log and the intact SQLite/WAL/SHM set.
Preserve those together; do not discard the WAL. Synthetic Ubuntu suite:
`/srv/cartdotcom/instagram-reel-brain/runs/queue-fd-test-20260903/`.

Worker rollback, if required: `npx wrangler rollback 38449414-57ff-444e-976e-4c3f07d88007`.
This restores the previous Worker, but removes expired-queue repair and operational
dashboard checks. Prefer a forward repair; do not roll back the connection-closing
fix. No D1 schema migration was applied. Renewal audit events must be retained.

Origin restart: verify the exact PID from `runs/phase7-origin/origin.pid`, terminate
only that process, then run `bash scripts/phase7_origin_watchdog.sh`. A restart
never clears SQLite or PostgreSQL state; the next safety/push wake resumes from
committed cursors. Restoring old origin code reintroduces the descriptor leak.

## Remaining limits

The descriptor-exhaustion failure is fixed and regression-tested, not a guarantee
against all future outages. Independent queue and handover checks now expose
other stalls; genuine mirror/data conflicts remain fail-closed for investigation.
Backlog stays disabled and Phase 8 is not advanced by this incident repair.
