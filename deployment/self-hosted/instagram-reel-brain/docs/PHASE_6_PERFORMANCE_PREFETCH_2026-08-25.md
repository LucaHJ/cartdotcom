# Phase 6 CPU and Reel Prefetch Performance Report

Date: 2026-08-25

Status: deployed and verified in production; Phase 6 generation 2 remains the
sole new-job processing authority and historical backlog remains disabled.

## Change

Commit `c1e3765` makes two bounded performance changes:

1. `phase5-compute` is raised from `0.10` to `0.50` CPU.
2. A separate `phase6-prefetch` service may download the next queued Reel while
   the current exact job is already synthesising.

The Worker exposes `/api/admin/phase6/prefetch-next` only behind the existing
Phase 5/6 control credential. It is GET-only and selects only an unclaimed
`armed` post-watermark Reel when the exact owner already has one
`local_processing` job in `running/synthesizing`. It performs no D1 mutation,
claim, reaction, callback, publication, or queue operation.

The prefetch service has no PostgreSQL password, Worker control token, Codex
authentication mount, platform-data network, selector, scheduler, or outbound
Instagram capability. It downloads to a temporary directory and atomically
renames only after writing an exact job/source-message/URL manifest containing
file sizes and SHA-256 values. The exact compute process verifies the complete
manifest before copying media into its private work directory. Invalid or
missing caches fall back to the normal exact-job download path.

## Resource Limits

The running Compose configuration declares:

- synthesis: `0.50` CPU / `640 MiB`;
- prefetch: `0.25` CPU / `256 MiB`;
- control: `0.05` CPU / `128 MiB`;
- six inert health services combined: `0.50` CPU / `768 MiB`.

Maximum declared total: `1.30` CPU and `1,792 MiB`, below the approved
two-core / 2.5-GiB Reel project ceiling. The six inert containers were
recreated with the lower limits and returned healthy.

## Production Timing Sample

The comparable pre-change baseline excludes the single 16,517.7-second stall:
44 Ubuntu-completed jobs averaged `238.1` D1 `processing_seconds`. The most
recent 55 Cloudflare-completed jobs averaged `159.6` seconds.

| Shortcode | Prefetch hit | D1 processing | Download handoff | Media preparation | Codex | Processor total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `Dcc7AsrRbK4` | no | 202.2 s | 5.597 s | 18.472 s | 174.743 s | 217.601 s |
| `DcbWV6lRHQS` | yes | 246.1 s | 0.009 s | 20.651 s | 222.707 s | 265.926 s |
| `Db9PQCuiWv_` | yes | 177.3 s | 0.006 s | 17.902 s | 156.574 s | 195.622 s |

The three-job D1 average is `208.5` seconds, `29.6` seconds or `12.4%` faster
than the prior non-stalled Ubuntu average. The two cache hits reduced the
in-job download handoff to effectively zero. Codex remained the dominant and
most variable stage, so individual jobs can still be slower than the baseline.

During this sample, prefetch downloaded 7,131,300 bytes in 8.259 seconds and
3,455,554 bytes in 7.701 seconds while the preceding jobs were synthesising.
A later audience-restricted Reel rejected the speculative public download;
that error was recorded, did not mutate the queued job, and left the normal
exact-job acquisition/abort path intact.

Durable timing evidence is stored mode 0600 at:

`/srv/cartdotcom/instagram-reel-brain/runs/phase6-performance.jsonl`

## Verification

- Cloud TypeScript typecheck: passed.
- Cloud Node tests: 111/111 passed.
- Cloud processor tests: 9/9 passed.
- Self-hosted Node tests: 69 passed, one expected Windows symlink skip.
- Self-hosted Python tests: 23/23 passed.
- Python compile, Compose validation, and scoped diff checks: passed.
- Worker version: `4ff08465-a579-4b4e-b1aa-c1a39d6ede86` deployed with
  `--containers-rollout=none`; Cloudflare Container image/authority was not
  changed.
- Ubuntu image IDs:
  - compute: `sha256:061314a178fb845d2347f4c775adcaf3280b5081057eff5734729e5752290cd3`;
  - prefetch: `sha256:f21fde5e3610e1f8ed5448401531919a5294e3d17755f4815726444bf5c55381`.
- Worker health: live, self-hosted generation 2, backlog off.
- Latest soak sample: clean, zero stale leases, divergence, duplicate
  completion, publication drift, or unhealthy containers.
- Reel, News, Caddy, and PostgreSQL services: healthy.

## Backup and Rollback

Pre-change server files are preserved mode 0600 under:

`/srv/cartdotcom/instagram-reel-brain/backups/phase6-prefetch-20260825T1120Z`

Rollback is non-destructive:

1. Stop only the dispatcher parent and allow any inherited exact orchestrator
   lock to finish.
2. Restore the six files plus `compose.yaml` from the backup directory.
3. Rebuild the stopped profile-gated control/compute images and recreate the
   six inert containers.
4. Roll Worker traffic back from version
   `4ff08465-a579-4b4e-b1aa-c1a39d6ede86` to
   `7dbf5ffb-c80d-4b73-b803-0c18e1b3b2b8`.
5. Run `scripts/phase6_dispatcher_watchdog.sh` and verify generation 2,
   backlog-off state, one exact processor, and healthy soak evidence.

No D1/R2/KV data rollback is required because prefetch is read-only and cache
files are non-authoritative local copies.
