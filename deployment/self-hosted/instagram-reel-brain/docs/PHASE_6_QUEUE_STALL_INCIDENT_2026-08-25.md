# Phase 6 Serial Queue Stall Incident — 2026-08-25

## Outcome

The production serial queue is processing again. The exact stalled Reel
`328ca9d8-7b14-4ab9-bd97-5fba1070bd44` (`Dcb3948pt2T`) completed at
`2026-08-25T10:42:29Z` with six frames and three resources. The next queued job
`5c23cc76-4568-4957-97de-f7d4d179ac06` then entered exact local processing
automatically. Cloudflare remains intake/data/recovery authority, Ubuntu
generation 2 remains the sole new-job processor, and backlog processing is
still disabled.

## Detection and impact

- Reported symptom: newly sent Reels received the queued reaction but never
  progressed to download or synthesis.
- First read-only sample: one `local_processing` fence, one stale PostgreSQL
  lease and twelve later armed jobs.
- Blocking job: `328ca9d8-7b14-4ab9-bd97-5fba1070bd44`.
- Original failure: FFmpeg's sequential `fps=1/4` extraction exceeded 120
  seconds on the downloaded Reel.
- Serial safety then worked too aggressively: later jobs could not pass the
  abandoned exact lease.

## Root causes

1. `inspect_and_extract()` decoded sequentially from the start of the video to
   produce up to eight frames. One slow/awkward encoding exceeded the single
   120-second command limit.
2. `phase6_dispatcher.py` did not pass `--abort-on-compute-failure`, so the
   guarded rollback path was available but unused in normal Phase 6 dispatch.
3. `phase6_dispatch_control.py` treated the exact job's expected
   `local_processing` 409 as an unrecoverable new-claim conflict rather than a
   restart signal.
4. A data-changing PostgreSQL CTE returned `inserted=1, events=1, existing=0`;
   validation looked only at the base-table `existing` snapshot and falsely
   rejected the successful first insertion.
5. During the corrective dispatcher restart, an already-started child became
   orphaned because the flock file descriptor was not inherited. The old child
   was stopped before publication and only the corrected compute was retained.

## Corrective changes

### Commit `14c31d9`

- `phase5-runner/container/app.py` and the matching cloud processor source:
  bounded input-seek frame extraction, 20-second per-frame limits, and optional
  frame/audio timeout handling.
- `scripts/phase6_dispatch_control.py`: parse an allowed 409 response,
  reconcile only the exact generation/job/source/owner fence, and correctly
  accept either a fresh insert+event or a matching existing lease.
- `scripts/phase6_dispatcher.py`: always request guarded abort after a genuine
  pre-publication compute failure and report an abort distinctly from success.
- Connected helper and media-timeout tests.

### Commit `2a856f1`

- The dispatcher passes its held flock descriptor to the exact orchestrator.
  A dispatcher crash/restart can no longer overlap a still-running orphaned
  child; watchdog replacements fail closed until the child releases the lock.

## Verification

- Self-hosted Node: 68 passed, one expected Windows symlink skip.
- Focused Python: 7 passed.
- Cloud processor Python: 9 passed.
- Python compile/static checks passed.
- Corrected images:
  - control: `sha256:9e1a9b98152e82c889a3243c946ca4a09bb991d8e94eaa67d487cae276038b8e`
  - compute: `sha256:35be625ac4eff7d1d7b1462dc08a327e1601c42514509a9c49aa95248dcb466b`
- The recovered job crossed the prior fault, generated six usable frames,
  completed synthesis/publication/finalization and left no active processing
  fence.
- The next post-watermark job was claimed automatically with concurrency one.
- News and Reel containers remained healthy and within their limits.

## Backup and rollback

Pre-change server files are preserved at:

`/srv/cartdotcom/instagram-reel-brain/backups/phase6-incident-20260825T1036Z`

Rollback is non-destructive: stop the dispatcher only after proving no child
or compute container remains, restore the three backed-up files, rebuild the
two stopped/profile-gated Phase 5 images, then run the authority-aware
dispatcher watchdog. Do not delete checkpoints or queued jobs.

## Remaining gate effect

This is a valid Phase 6 soak failure and must not be erased from gate evidence.
Phase 7 remains outside this incident scope.
