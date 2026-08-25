# Phase 6 Concurrency-Two Performance Change

Date: 2026-08-25

Source commits: `4e4c86f`, `302eaba`

Worker version: `b20c3661-ea53-4622-8f92-e7604d9a1309`

Observation start: `2026-08-25T12:47:56.931Z` (`2026-08-25 22:47:56.931 AEST`)

## Outcome

The Ubuntu Phase 6 processing limit is now two exact concurrent jobs. Two
credential-free dispatcher slots run as `phase6-local-worker-1` and
`phase6-local-worker-2`. Cloud and PostgreSQL claims are independently bounded,
backlog processing remains disabled, and Ubuntu remains generation-2 processing
authority.

Only one speculative Reel prefetch may run at a time. At worst declared
overlap, the Reel project remains within the approved `2 CPU / 2.5 GiB`
ceiling: six inert services, two `0.50` CPU / `640 MiB` compute containers, one
`0.25` CPU / `256 MiB` prefetch, and two brief `0.05` CPU / `128 MiB` controls.

## Fencing and recovery

- Worker claims accept only the two configured identities and atomically
  refuse a third active fence.
- PostgreSQL migration `0007_phase6_concurrency_two.sql` replaces the former
  global one-active index with a partial unique active-owner index.
- Local lease insertion takes a transaction-scoped advisory capacity lock and
  verifies fewer than two active leases before insertion.
- Each dispatcher has a separate inherited `flock`; duplicate processes for
  one slot cannot run the same work.
- The watchdog maintains both exact PIDs at boot and every minute. Rollback to
  cloud authority stops both.
- Prefetch uses a global non-blocking `flock`, so two synthesis jobs cannot
  create two speculative download containers.

## Performance evidence

The existing seven valid pre-change jobs form the frozen baseline:

| Metric | Baseline average |
| --- | ---: |
| Orchestration | 250.413 s |
| Processor total | 230.251 s |
| Download | 3.220 s |
| Media preparation | 16.897 s |
| Codex | 189.538 s |
| Completion/publication | 20.594 s |
| Prefetch hit rate | 42.9% |

New records also capture dispatcher slot, queue wait and control/handover time.
The minute watchdog atomically refreshes
`/srv/cartdotcom/instagram-reel-brain/runs/phase6-concurrency2/latest.json`.

The first natural post-change Reel completed after the initial deployment
check. Its dispatch-to-completion orchestration time was `207.568 s` (`17.11%`
below baseline), with `189.602 s` processor total, `5.103 s` download,
`20.387 s` media preparation, `139.810 s` Codex, `24.299 s` completion and
`17.966 s` control/handover overhead. It waited `274.478 s` between cloud
creation and local dispatch because the local mirror had not yet received the
job. That mirror/handover wait is presently a larger latency source than local
processing. This is only one sample and did not exercise two-job overlap.

Natural new shares will continue populating the report automatically; no
backlog or synthetic production item was created. The report measures stage
averages, prefetch hit rate, peak overlap and jobs per hour against the frozen
baseline.

## Handover polling correction

Commit `302eaba` replaced the Phase 4 observation-era five-minute mirror sleep
with a 15-second sleep and reduced each dispatcher slot's default poll from 20
seconds to 10 seconds. The mirror is an incremental ten-surface D1 pull, so 15
seconds is the lowest prudent steady-state interval: it removes most visible
handover delay without turning the migration bridge into a continuous request
loop. This bridge is temporary; Phase 7 is expected to make PostgreSQL the
authoritative processing store and remove it from the primary handover path.

The production loops were restarted only after both in-flight Reels reached a
terminal state. Observed mirror completion timestamps after restart were
`13:12:41.310Z`, `13:12:57.018Z`, `13:13:14.326Z`, and `13:13:29.857Z`, a
15.5-17.3 second completion cadence including query time. Natural Reel job
`5ed65d02-49f3-4766-a935-53891f332507` was created at `13:12:35Z` and locally
dispatched at `13:12:44Z`: a measured `9.000 s` queue wait versus the previous
`274.478 s`. It then completed normally. This is the first end-to-end
post-change sample; later natural Reels remain automatically tracked.

## Verification

- Cloud typecheck passed; cloud Node tests passed `113/113`.
- Self-hosted Node tests passed `70` with the expected Windows symlink skip.
- Focused Python runtime/performance tests passed `11/11`.
- Connected isolated PostgreSQL tests proved two different owners can be
  active and a duplicate active owner is rejected.
- Production had zero queued/running jobs and active Phase 6 fences/leases,
  backlog off, two matching dispatcher PIDs, zero mirror divergences/errors,
  and a clean soak sample.
- Reel, News, Caddy and PostgreSQL containers were healthy after deployment.
- Focused polling tests passed: Node `9/9`, Python mirror/runtime `18/18`, and
  the mirror mutation-surface static check passed.
- The live mirror command contains `--interval-seconds 15`; both dispatcher
  slots restarted with the 10-second source default. Authority remained
  generation 2 and historical backlog processing remained disabled.

## Backups and rollback

Pre-change scripts, Compose config and a PostgreSQL schema dump are in
`/srv/cartdotcom/backups/reel/concurrency2-20260825T124645Z`.

The pre-polling-change mirror watchdog and dispatcher are preserved in
`/srv/cartdotcom/backups/reel/handover-poll-20260825T130701Z`.

To roll back, first prove neither slot is processing. Restore the backed-up
scripts and Compose file, restore the former single-active lease index only
after proving at most one active lease, roll back the Worker, recreate the
inert services and invoke the watchdog. Verify one dispatcher, backlog off,
generation-2 authority and all service health. Preserve performance evidence.
