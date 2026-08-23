# Phase 6 Processing Cutover and Soak Start

Date: 2026-08-23

Status: processing cutover complete; required seven-day soak in progress.

## Authority

- Durable authority generation: 2
- Mode: `self_hosted`
- Cutover watermark: `2026-08-23T01:17:09.133Z`
- Earliest valid soak completion: `2026-08-30T01:17:09.133Z`
  (`2026-08-30 11:17:09.133 Australia/Brisbane`)
- Local concurrency: 1
- Historical backlog: disabled
- Cloudflare intake, D1 edge spool, R2/KV, callback surface, and recovery
  deployment: retained
- Cloudflare Container job claims: disabled by the durable authority record

## Implementation

- Commit `d58f510` added the D1 authority record, guarded transition/local/cloud
  routes, post-watermark automatic job fences, exact serial claims, local
  authority audit migration, control-container adapter, and host dispatcher.
- Commit `4aa095f` exposed authority generation/mode on Worker health.
- Commit `f7eadc9` added the credential-free authority wrapper and one-command
  rollback.
- Commits `9570b9c`, `7d01192`, and `be6be2c` added the reboot watchdog, dynamic
  generation handling, and correct lock-descriptor isolation.
- Commit `bf2a0f8` added the seven-day soak sampler and gate evaluator.
- Worker version: `8d2a839c-d16f-4ed6-9883-50e37867c95f`.

The Worker accepts intake in all modes. In `transition` and `self_hosted`, only
new jobs created at or after the recorded watermark receive Phase 6 fences.
Cloud queue delivery remains durable but acknowledges job work without running
the Cloudflare Container whenever authority is not `cloud`. Carousel metadata
resolution remains an intake operation and can create the fenced job before
local processing.

The Ubuntu dispatcher runs one exact job at a time. Its host process has no
credential values; it mounts the narrow Worker token and PostgreSQL password
only into `phase5-control`, then invokes the accepted split control/compute
orchestrator. Codex/media compute cannot access control secrets.

## Backup And Reconciliation

- D1 export:
  `deployment/self-hosted/instagram-reel-brain/backups/d1-pre-phase6-20260823T110942.sql`
- PostgreSQL dump:
  `/srv/backups/instagram-reel-brain/postgres-pre-phase6-20260823T110942.dump`
  (mode `0600`, 1,392,422 bytes)
- Final transition mirror poll imported zero additional rows.
- Reconciled mirror: 1,334 row versions, 875 verified object receipts, zero
  divergences, zero mirror errors, and zero active leases.

## Rollback Proof

The production one-command rollback was exercised while idle:

```bash
python3 scripts/phase6_authority.py rollback-cloud --generation 1
```

It performed `self_hosted -> transition -> cloud`, requeued zero jobs, stopped
the authority-aware dispatcher, and preserved backlog-off state. The system was
then cut over again through generation 2 after another zero-row final mirror
poll. This proves rollback is an authority change, not a rebuild or data reset.

## Supervision

- Dispatcher PID/log/generation:
  `/srv/cartdotcom/instagram-reel-brain/runs/phase6-dispatcher.*`
- Dispatcher watchdog: every minute and `@reboot` in the `lucaj` crontab.
- Soak sampler: every five minutes in the `lucaj` crontab.
- Soak state and evidence:
  `/srv/cartdotcom/instagram-reel-brain/runs/phase6-soak/`

The first sample passed with correct generation-2 authority, backlog off,
correct dispatcher identity, 18 relevant healthy containers, no stale or
parallel leases, and no mirror, duplicate-completion, or publication failures.

## Gate

Do not start Phase 7 before `2026-08-30T01:17:09.133Z`. At that time run:

```bash
python3 scripts/phase6_soak_monitor.py gate --generation 2
```

The gate requires the full duration, no failed samples, current clean health,
and at least one genuine completed post-watermark job. Any hard failure must
stop advancement and be reconciled or rolled back; it must not be waived.

