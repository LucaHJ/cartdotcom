# Phase 7 Primary Data Cutover Report

Cutover completed: `2026-08-26T00:39:05+10:00`

Status: **Phase 7 active by explicit user override; Phase 8 remains blocked.**

## Decision and preserved evidence

The normal Phase 6 seven-day gate did not pass. The immutable Phase 6 evidence
still contains the 25 August stale-lease incident, 46 failed samples, and an
incomplete duration. At `2026-08-26` the user explicitly directed the system
to move to Phase 7 immediately. This report records that decision as risk
acceptance, not as a retroactive Phase 6 pass.

Before changing the primary data path, the operator captured:

- D1 export: `/srv/backups/instagram-reel-brain/phase7-override-20260825T133007Z/d1-pre-phase7.sql`
- D1 SHA-256: `8a11a0585b6e8a066d323a2bfff9cfb8c33570c17de5c558dc24cf903975a285`
- PostgreSQL, authority, runtime, Caddy, and object-manifest evidence under
  `/srv/backups/instagram-reel-brain/phase7-override-20260825T133007Z`
- ignored local snapshot/run evidence under
  `deployment/self-hosted/instagram-reel-brain/runs/phase7-override-20260825T133007Z`

No historical backlog was selected or processed.

## Active architecture

- Cloudflare continues to verify Meta webhooks and durably spool intake in D1.
- Ubuntu generation 2 remains the only processing authority, with two bounded
  dispatcher slots and historical backlog disabled.
- The authoritative typed local data schema is
  `reel_phase7_primary_20260825_133007`.
- A Worker wake is sent only after durable edge mutation. The private VPC
  Service `cartdotcom-reel-origin`
  (`01a03937-03e2-7632-9c9d-b34eaf45913d`) forwards it to Ubuntu. The wake is
  a latency hint; cursor/idempotency state remains durable.
- The dispatchers use event wakes normally and a 300-second poll only as a
  recovery safety net.
- Local disk is first-write storage for new artifacts/library pages; R2/KV
  remain offsite mirrors and outage fallback.
- Authenticated Reel Library reads use the Ubuntu origin first and the existing
  KV static copy after origin failure.
- Cloudflare Container claims remain disabled by authority generation 2.

## Deployment identifiers

- Worker versions during the cutover:
  - private VPC/local-first bridge: `f3c90d13-6b8d-40e8-aae6-af8ae4b4de23`
  - read-only object recovery surface: `d9c8e2bb-1f17-4749-92f5-5a4ea4a42b49`
- Pages deployment: `https://5b7c904c.cartdotcom.pages.dev`
- Source commits preceding final corrective commit:
  - `323d645` — Phase 7 local-primary bridge
  - `9fa32ba` — library backfill surface
  - `7594688` — private VPC origin routing
- Dedicated secret: `PHASE7_ORIGIN_TOKEN`, stored only as a Worker/Pages
  secret and `/srv/cartdotcom/reel-brain-secrets/phase7-origin-token` mode
  `0600`. Plaintext was not recorded.

## Data reconciliation

The typed D1 import and post-snapshot delta drain produced:

- jobs: `335`
- artifacts: `5,050`
- resources: `2,243`
- job events: `1,906`
- retrieval terms: `132,846`
- delta row versions: `2,114`
- delta divergences/errors: `0/0`

Local object reconciliation verified all `5,050` database-referenced objects,
`2,007,909,616` bytes, against their stored size and SHA-256. The first pass
found 140 missing files; the bounded authenticated GET-only R2 recovery
surface restored them and the second pass passed. A further 3,257 unreferenced
local objects were retained as orphan/superseded evidence and were not deleted.

The complete Reel Library contains 2,491 verified HTML files. Its origin
receipt manifest also contains 2,491 entries.

Evidence:

- `/srv/cartdotcom/reel-brain-runs/phase7-primary/20260825T133007Z/artifact-reconciliation.json`
- `/srv/cartdotcom/reel-brain-runs/phase7-primary/20260825T133007Z/library-backfill-report.json`
- `/srv/cartdotcom/reel-brain-runs/phase7-primary/20260825T133007Z/last-poll.json`

## Recovery tests

- Local-origin outage: private origin returned `502`; authenticated KV static
  fallback remained `200` with 2,491 files; watchdog restoration returned the
  private origin to `200` automatically.
- Dispatcher interruption: both exact dispatcher PIDs were stopped and
  watchdog-restored with the Phase 7 schema and 300-second safety poll. No job
  was created or replayed.
- Database restore: the post-cutover custom dump restored into isolated
  database `cartdotcom_phase7_restore_20260825`; counts matched
  `335,5050,2243,1906,132846` for jobs, artifacts, resources, events, and
  retrieval terms.
- Artifact restore: three objects were fetched into an empty isolated root and
  verified by size/SHA-256 (`2,473,130` bytes, zero failures).
- Safety poll: authenticated five-minute wake accepted; cursor drain returned
  zero rows without replay.

The host account has no unattended sudo authority, so a physical Ubuntu reboot
was not performed. Process-loss plus `@reboot`/minute watchdog recovery was
exercised instead. A physical reboot remains a Phase 7 observation item, not a
reason to relabel Phase 6 as passed.

## Test evidence

- Cloud Worker typecheck: pass.
- Cloud Worker Node tests: `114/114` pass.
- Self-hosted Node tests: `73` pass, `1` expected Windows symlink skip.
- Pages Phase 7 tests: `2/2` pass.
- Self-hosted Python tests: `30/30` pass.
- Cloud media Python tests: `9/9` pass.
- Production auth/method checks: unauthenticated private-origin access `401`;
  non-GET proxy access `405`; authenticated VPC health `200`.

## Production state after cutover

- Worker health: `ok`, `ingest_mode=live`, `processing_authority=self_hosted`,
  `authority_generation=2`, `backlog_processing=false`.
- Authority row: local dispatch/Codex/outbound enabled; backlog disabled.
- Active queued/running jobs: `0` at final inspection.
- Reel, News, Caddy, and PostgreSQL containers: healthy.
- News API: ready with database available.
- Host: 15 GiB RAM, approximately 2.0 GiB used; 298 GiB disk available.

## Rollback

The processing rollback remains one guarded command:

```bash
cd /srv/cartdotcom/instagram-reel-brain
python3 scripts/phase6_authority.py rollback-cloud --generation 2
```

It fails closed while local work is active. After rollback, the dispatcher
watchdog stops local claims, D1/R2/KV remain available, and Reel Library reads
fall back automatically to the static cloud copy. Do not delete the Phase 7
schema, local object roots, restore database, or cutover evidence during
rollback.

## Remaining Phase 7 observation

- The next genuine Instagram item is the first end-to-end proof of the newly
  deployed Worker push wake; the five-minute poll remains the lossless safety
  path if that hint fails.
- Complete one controlled physical-server reboot when unattended reboot
  authority is available and verify News plus Reel recovery.
- Phase 8 decommission is not authorised. Cloudflare D1, R2, KV, intake,
  callbacks, and the recovery deployment remain active.
