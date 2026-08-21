# Phase 4 historical replay validation — 2026-08-21

Status: bounded read-only historical replay validation completed; Phase 5 remains blocked pending independent review.

Cloudflare remains the sole production processing authority. This validation used the real authenticated GET-only Phase 4 Worker mirror route to copy a fixed historical slice into a separate non-authoritative PostgreSQL schema and object root. It did not write to production D1/R2/KV, did not claim, consume, requeue, resynthesise, or process backlog items, did not call Codex, did not publish, did not send Instagram reactions/messages, and did not change processing authority.

## Approved immutable slice

- Inclusive lower watermark: `2026-08-19T04:19:57Z`
- Exclusive upper watermark: `2026-08-21T01:42:46Z`
- Status: `complete` only
- Expected counts:
  - jobs: `50`
  - media mix: `44` reels, `6` post/carousels
  - job events: `200`
  - artifacts: `722`
  - resources: `258`

The live Phase 4 original watermark remains `2026-08-21T01:42:46Z`. The live mirror schema and run directory were preserved:

- live schema: `reel_phase4_shadow_20260821_014246`
- live run directory: `/srv/cartdotcom/reel-brain-runs/phase4-shadow/2026-08-21_01-42-46`
- corrected live observation start remains `2026-08-21T03:01:28Z`

## Code and deployment

Source commit: `fb42de7` (`Set phase4 replay slice watermark`).

Changed files:

- `deployment/instagram-reel-brain/src/phase4-mirror.ts`
- `deployment/instagram-reel-brain/tests/phase4-mirror.test.mjs`

Implementation:

- `PHASE4_REPLAY_WATERMARK` changed from `2026-08-19T05:18:26.000Z` to `2026-08-19T04:19:57.000Z`.
- The focused replay-scope test now proves:
  - a complete job before `2026-08-19T04:19:57Z` is excluded,
  - a complete job exactly at `2026-08-19T04:19:57Z` is included,
  - a failed job inside the window is excluded,
  - a post-live complete job is excluded.

Worker versions:

- `dfbc9b8e-e442-45c1-a71a-57907606d393`: deployed corrected replay lower watermark.
- `77de0a23-ce02-4566-8da4-d577b7bf73ae`: temporary replay-token secret install.
- `710dd991-3780-43a5-b60a-8616788c49d3`: temporary replay-token secret removal; current Worker at report time.

## Replay credential

A fresh temporary replay-only credential was generated from 48 random bytes and installed as Worker secret `PHASE4_REPLAY_TOKEN`. It was stored only on the Ubuntu server at:

- `/srv/cartdotcom/reel-brain-secrets/phase4-replay-token-20260821-corrected`

The file was mode `0600`, 66 bytes including newline. The plaintext was not printed, logged, committed, placed in URLs, passed as a process argument, or stored in Git.

Scope verification:

- normal mirror token with watermark `2026-08-21T01:42:45.999Z`: HTTP `403`
- replay token with exact watermark `2026-08-19T04:19:57.000Z`: HTTP `200`, first page count `50`
- replay token with watermark `2026-08-19T04:19:56.999Z`: HTTP `403`
- replay token with watermark `2026-08-21T01:42:46.000Z`: HTTP `403`

After validation:

- `PHASE4_REPLAY_TOKEN` was deleted from the Worker.
- `/srv/cartdotcom/reel-brain-secrets/phase4-replay-token-20260821-corrected` was removed.
- Worker `/health` remained ok with `ingest_mode=live` and `backlog_processing=false`.

## Isolated replay target

- replay schema: `reel_phase4_replay_20260821_031920`
- replay run directory: `/srv/cartdotcom/reel-brain-runs/phase4-replay/2026-08-21_03-19-20`
- replay object root: `/srv/cartdotcom/reel-brain-runs/phase4-replay/2026-08-21_03-19-20/objects`
- replay logs: `/srv/cartdotcom/reel-brain-runs/phase4-replay/2026-08-21_03-19-20/logs`

The target was created with:

```sh
python3 /srv/cartdotcom/instagram-reel-brain/scripts/phase4_shadow_mirror.py init-schema \
  --schema reel_phase4_replay_20260821_031920 \
  --watermark 2026-08-19T04:19:57Z \
  --run-dir /srv/cartdotcom/reel-brain-runs/phase4-replay/2026-08-21_03-19-20 \
  --output /srv/cartdotcom/reel-brain-runs/phase4-replay/2026-08-21_03-19-20/init-schema-report.json
```

## Interruption/restart and drain evidence

The first pass intentionally used a small page limit to create a committed cursor checkpoint:

- command limit: `25`
- result: `rows=125`, `objects_checked=166`, `ok=true`
- after first pass:
  - jobs: `25`
  - job events: `25`
  - artifacts: `25`
  - resources: `25`
  - outbound events: `25`
  - divergences: `0`
  - mirror errors: `0`

The replay then resumed from PostgreSQL cursors with limit `200` and drained every page:

- drain pass 1: `rows=775`, `objects_checked=517`
- drain pass 2: `rows=233`, `objects_checked=233`
- drain pass 3: `rows=200`, `objects_checked=200`
- drain pass 4: `rows=97`, `objects_checked=97`
- drain pass 5: `rows=0`, `objects_checked=0`

Explicit idempotent second pass:

- `rows=0`
- `objects_checked=0`
- counts unchanged

This proves restart from committed cursors and idempotent no-replay behaviour for the completed slice.

## Final replay counts

At completion:

- jobs: `50`
- media mix: `44` reels, `6` post/carousels
- job status: `complete=50`
- job events: `200`
- artifacts: `722`
- resources: `258`
- outbound events: `200`
- notes: `0`
- DM commands: `0`
- pending DM parts: `0`
- carousel resolutions: `0`
- inbound webhook events: `0`
- row versions: `1430`
- typed hashes: `1430`
- object receipts: `1075`
- divergence rows: `0`
- mirror error rows: `0`
- cursor `rows_seen` sum: `1430`

The replay object root contains `1075` files and uses approximately `268M`.

Representative boundary jobs:

- first lower-bound job: `daa6517f-522b-4a55-8b43-af5af1cbe008` / `DcL8hKrMnrR` / `2026-08-19 04:19:57 UTC`
- latest job in slice: `b09737b7-0e42-4179-9965-1c88ec7ac51d` / `DbavsLOjMS-` / `2026-08-21 01:15:57 UTC`

## Object verification

- object receipts: `1075`
- unverified receipts: `0`
- artifact receipt mismatches: `0`

Verification checked local object receipts against expected artifact `source_byte_size` and `source_sha256` where present. Objects were downloaded through the GET-only Worker object endpoint into the isolated replay object root using the mirror's temp-file plus verification path.

## Live mirror preservation

Final live mirror sample after replay:

- live schema: `reel_phase4_shadow_20260821_014246`
- live cursor `rows_seen` sum: `206`
- row versions: `206`
- object receipts: `139`
- divergences: `0`
- mirror errors: `0`

The live original watermark and live run directory were not reset or rewritten.

## Tests

Cloud Reel:

- `npm run typecheck`: passed
- `npm test`: 73/73 passed

Self-hosted Reel:

- `npm --prefix deployment/self-hosted/instagram-reel-brain test`: 45/46 passed, 1 expected Windows symlink skip
- `python deployment/self-hosted/instagram-reel-brain/tests/test_phase4_shadow_mirror.py`: 9/9 passed
- `python deployment/self-hosted/instagram-reel-brain/tests/test_phase4_shadow_mirror_connected.py`: 5/5 passed
- `python deployment/self-hosted/instagram-reel-brain/tests/test_media_processor_api.py`: 3/3 passed

## Health and resources

Final health sample at `2026-08-21T03:26:45Z`:

- Cloudflare `/health`: `ok`, `ingest_mode=live`, `backlog_processing=false`
- Reel containers: healthy
- News Signal containers: healthy
- Caddy/PostgreSQL: healthy
- `/srv`: 311 GiB available, 7% used
- PostgreSQL Docker stats sample: `6.51%`, `278MiB / 3GiB`
- No material News Signal regression observed

## Rollback and cleanup

No production data rollback is required because the validation was read-only against Cloudflare.

If operator cleanup is later approved, preserve evidence first, then non-destructively rename the replay schema/run directory. Do not delete evidence during the Phase 4 review window.

Immediate safety checks:

1. Confirm `PHASE4_REPLAY_TOKEN` is absent from Worker secrets.
2. Confirm `/srv/cartdotcom/reel-brain-secrets/phase4-replay-token-20260821-corrected` does not exist.
3. Leave `reel_phase4_replay_20260821_031920` and `/srv/cartdotcom/reel-brain-runs/phase4-replay/2026-08-21_03-19-20` intact for review.

## Remaining gate state

The historical replay validation is complete, but Phase 5 is not approved.

The accelerated live observation remains measured from `2026-08-21T03:01:28Z` and still requires independent review after the documented 12-hour live observation condition is satisfied with at least one genuine new input, zero unexplained divergence/error, stable restart/cursors, and no News regression.
