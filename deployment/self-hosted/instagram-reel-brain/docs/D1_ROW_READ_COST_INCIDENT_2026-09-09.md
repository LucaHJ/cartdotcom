# D1 row-read cost incident — 2026-09-09

## Outcome

The unexpected D1 charge was caused by the Phase 7 cloud-to-local recovery
mirror repeatedly scanning old D1 history. It was not caused by local media,
Codex, or library storage. The fix is deployed in commit `f8ca955`, Worker
version `792b5e0c-cc35-41dd-9c11-042a7a1baf9d`, with migration
`0028_phase7_mirror_cost_indexes.sql` applied.

## Impact and diagnosis

Immediately before remediation, D1 reported `4,496,491,852` rows read across
`27,139` queries in the preceding 24 hours. Seven-day Insights attributed most
of the scan volume to Phase 4/7 mirror queries over `resources` (7.556 billion
rows), `artifacts` (7.352 billion), and `retrieval_documents` (7.164 billion).
Those scans explain the reported roughly USD 21 charge once the paid-plan
monthly allowance was exhausted.

The main query defects were:

- every incremental poll retained the original August watermark as an OR
  predicate, so D1 repeatedly scanned from that old boundary instead of only
  after the committed cursor;
- `datetime(column)` wrapped indexed timestamp columns and prevented efficient
  index range scans;
- child-table queries repeatedly evaluated correlated parent-job scope; and
- successful read-only thumbnail compatibility POSTs triggered full push-wake
  drains. Server receipts recorded 1,306 drains in 24 hours, including 471
  thumbnail requests that did not represent new intake.

## Correction

- Live cursors now use raw indexed timestamp columns compared with
  `datetime(?)`; the decoded cursor remains clamped to the authorised minimum
  watermark without retaining a redundant historic predicate.
- Live child-table deltas use their own post-watermark timestamps. Exact
  bounded historical replay semantics remain unchanged.
- Read-only status/media compatibility POST routes no longer emit Phase 7
  wakes. Webhooks, callbacks, and control mutations still do.
- Migration `0028_phase7_mirror_cost_indexes.sql` adds cursor indexes for jobs,
  events, artifacts, resources, notes, outbound events, carousel/inbound rows,
  and generated guide keys.

## Verification

- TypeScript typecheck passed.
- Cloud Worker tests passed: 145/145.
- Wrangler dry-run passed with `--containers-rollout=none`.
- Production `EXPLAIN QUERY PLAN` now selects the artifact and resource cursor
  indexes.
- Equivalent production current-cursor reads changed from 7,787 to 2 rows for
  artifacts, 3,473 to 2 for resources, and remained 2 for retrieval documents.
  Retrieval-term reads fell to 457. The measured core idle drain is therefore
  about 463 rows rather than roughly 3.28 million, a reduction greater than
  7,000 times for that path.
- A manual safety poll after deployment completed with zero rows and zero
  objects, while origin, Worker, Reel, News, Caddy and PostgreSQL health stayed
  green. D1 backlog processing remains disabled and no job was replayed.

The Cloudflare dashboard's rolling 24-hour value will retain pre-fix reads
until they age out. Previously accrued charges are not reversed by the code
change. Recheck D1 rows-read after a complete 24-hour window and the monthly
billing total after the normal billing delay.

## Rollback

Roll the Worker back to its prior deployment only if the live delta mirror
shows a correctness regression. The added indexes are non-destructive; they can
be removed with explicit `DROP INDEX IF EXISTS` statements if necessary, but
should normally remain. Do not reset the mirror cursor or original watermark.

