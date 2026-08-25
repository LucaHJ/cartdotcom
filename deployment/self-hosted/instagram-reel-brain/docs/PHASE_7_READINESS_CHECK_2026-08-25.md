# Phase 7 Readiness Check

Checked: `2026-08-25T13:24:08.378Z`

Outcome: **not ready; Phase 7 was not started.**

## Gate evidence

The authoritative command was:

```bash
python3 scripts/phase6_soak_monitor.py gate --generation 2
```

It reported:

- 726 Phase 6 samples;
- 64 completed genuine post-watermark jobs;
- 46 failed samples;
- `duration_elapsed=false`;
- nominal original not-before time `2026-08-30T01:17:09.133Z`.

Three failed samples saw an ephemeral one-shot control container in Docker's
`removing` state. Forty-three failed samples recorded the genuine stale-lease
incident from `2026-08-25T07:10Z` through `10:40Z`. The latter is material Phase
6 evidence and cannot be discarded or relabelled merely because the repair is
now healthy.

Current state at the check was healthy and idle: generation 2 self-hosted
authority, backlog disabled, zero queued/running jobs, zero active/stale leases,
zero mirror errors/divergences, zero duplicate completions and zero publication
drift. Both dispatcher identities and all required containers were healthy.

## Required next gate

Preserve the original samples and establish a distinct post-repair observation
window. Phase 7 requires a genuinely clean seven-day window and independent
review; a current clean snapshot is not a substitute.

## Phase 7 event-driven handover target

The normal handover should no longer depend on the 15-second, ten-surface D1
mirror cycle:

1. Cloudflare verifies the Meta webhook and durably commits it to the D1 edge
   spool.
2. Cloudflare sends an authenticated private wake to Ubuntu.
3. Ubuntu drains the durable spool by committed cursor and idempotency key into
   authoritative PostgreSQL.
4. A lost wake is recovered by a slow reconciliation poll; duplicate wakes are
   harmless.

The signal is deliberately a wake hint, not the job payload or authority. D1
retains the outage/recovery ledger, and PostgreSQL becomes authoritative only
after the gated Phase 7 cutover.
