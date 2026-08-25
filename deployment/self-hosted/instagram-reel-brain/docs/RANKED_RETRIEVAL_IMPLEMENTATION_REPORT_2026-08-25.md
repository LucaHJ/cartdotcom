# Ranked Retrieval Implementation Report

Date: 2026-08-25

Status: implemented, deployed, backfilled and verified. Phase 6 generation 2
processing authority remains unchanged.

## Incident

Two Instagram queries both returned newest completed Reel `Dad01vtsVD3`:

- `Find me the video of the swordsman playing with his cat`
- `Send me the video of the war movie titled Cherry`

The correct existing Reels were `DbkYou1ph6B` and `DcbSU6ntnEF`. The old
`handleSearchQuery()` retained weak terms, used `%term%` substring matches
joined with `OR`, assigned no relevance, and ordered by `completed_at DESC`.

## Implementation

Commits:

- `8992658` — ranked document/index model, migration, completion indexing,
  command parsing and regression coverage;
- `43e50b0` — exact-confirmation maintenance route using the existing
  control-only credential;
- `c1f0c03` — bounded read-only retrieval diagnostic route;
- `b7a6364` — strips transcript/research document fields from API and Instagram
  results.

Final Worker version:

`282c170a-cafb-48c8-9317-e0cd878e774a`

Schema migration:

`deployment/instagram-reel-brain/migrations/0025_ranked_retrieval_index.sql`

The derived index contains one bounded document per completed job covering:

- title, author, caption and attached instructions;
- synthesis and visual summary;
- transcript;
- captured comments;
- resource names, types, summaries and guides;
- claims and evidence text.

Query processing removes request scaffolding and weak stop words, deduplicates
and stems terms, applies conservative aliases, matches exact tokens rather than
substrings, weights strong fields, measures query-term coverage, and requires a
confidence margin. Recency is only a final tie-breaker. `ambiguous` returns up
to three labelled source links and never selects the first candidate for
automatic delivery.

New completions build their index before the job becomes `complete`. Historical
reindexing reads stored synthesis/R2 objects only; it performs no Codex call,
media processing, publication, queueing, reaction, or Instagram delivery.

## Backup and production migration

Pre-change D1 export:

`deployment/self-hosted/instagram-reel-brain/backups/d1-pre-ranked-retrieval-20260825T153100.sql`

- bytes: `16,306,445`
- SHA-256:
  `0B5F91AA826CD4A11F8231D71DD0D6131F88624A39A8133F6BCCCD8686307A75`

Migration `0025` applied remotely in `1.51 ms`. The index backfill ran in 31
batches of at most ten completed jobs:

- completed/indexable jobs: `302`;
- indexed documents: `302`;
- unique job-term rows: `118,915`;
- missing documents: `0`;
- missing content hashes: `0`;
- backfill failures: `0`.

An exact second reindex of Cherry job
`31f2fa08-dda8-4b8d-b705-533712be8ce8` preserved all counts, proving the
replacement path is idempotent. D1 grew from approximately `17.8 MB` to
`43.5 MB`; no paid resource was created.

## Real-data verification

| Query | Decision | Selected job / Reel | Score | Coverage |
|---|---|---|---:|---:|
| swordsman playing with his cat | match | `9602911c-7637-4657-b9f5-b6fc4d33d6cc` / `DbkYou1ph6B` | 39 | 1.0 |
| war movie titled Cherry | match | `31f2fa08-dda8-4b8d-b705-533712be8ce8` / `DcbSU6ntnEF` | 44 | 1.0 |
| highest grossing movies adjusted for inflation | match | `f74f0619-c6a6-46c2-8b97-6d0fc0b62a13` / `DcOWkMakZ2k` | 90 | 1.0 |

Returned matches contain delivery metadata and score evidence only; indexed
transcript/resource bodies are absent from responses.

## Tests and health

- TypeScript typecheck: passed.
- Worker Node suite: `110/110` passed.
- Python media/recovery suite: `9/9` passed.
- Local D1 migrations through `0025`: passed.
- Worker dry-run with `--containers-rollout=none`: passed.
- Production active jobs after backfill: `0`.
- Phase 6: generation `2`, mode `self_hosted`, backlog disabled, no active
  leases/fences/arms.
- Worker `/health`: healthy.
- Phase 6 dispatcher/soak monitor: healthy with no failures.
- All Reel and News containers: healthy; no material resource regression.

No Instagram message was sent during verification. The next user query will
exercise the same ranked path and normal outbound adapter.

## Rollback

The non-destructive rollback is to deploy pre-retrieval Worker version
`8d2a839c-d16f-4ed6-9883-50e37867c95f`. The old Worker ignores the additive
retrieval tables. Preserve the tables and D1 export for diagnosis; do not drop
or delete them as routine rollback. Phase 6 processing authority requires no
change for retrieval rollback.
