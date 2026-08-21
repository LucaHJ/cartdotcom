# Phase 4 timestamp correction and historical validation blocker — 2026-08-21

Status: live Phase 4 mirror correction deployed and verified; historical acceleration validation blocked by source-count mismatch.

Cloudflare remains the sole production processing authority. This work changed only the read-only Phase 4 mirror endpoint and its tests. It did not enable local intake, local job claims, local dispatch, Codex execution, publication, Instagram outbound operations, auth rotation, backlog processing, or Phase 5.

## Trigger

The Phase 4 observation gate was suspended after production evidence showed valid post-watermark jobs were not mirrored:

- Original Phase 4 watermark: `2026-08-21T01:42:46Z`.
- Production jobs created after that watermark:
  - `97d86b99-88d7-4618-a242-021806dc6adb`, shortcode `DcOUTdiz3yZ`, created `2026-08-21 02:33:57 UTC`.
  - `1f05c43e-2e56-40f0-9d38-e072558ed104`, shortcode `DcGZwjwE3ui`, created `2026-08-21 02:38:29 UTC`.
- Live mirror polls at `02:35`, `02:40`, `02:45`, and `02:50 UTC` still reported `rows=0`.
- Direct D1 comparison using the original watermark returned:
  - raw string predicate: `0`
  - `datetime()`-normalised predicate: `2`

Cause: D1 stores timestamps as `YYYY-MM-DD HH:MM:SS`; the Phase 4 endpoint compared them lexically against ISO `T/Z` watermark and cursor strings.

## Code changes

Commit: `28c1d5c` (`Fix phase4 mirror timestamp scoping`).

Changed files:

- `deployment/instagram-reel-brain/src/phase4-mirror.ts`
- `deployment/instagram-reel-brain/src/index.ts`
- `deployment/instagram-reel-brain/tests/phase4-mirror.test.mjs`

Implementation details:

- `phase4DeltaQuery()` now wraps all cursor, watermark, and extra `created_at` predicates in SQLite `datetime(...)`.
- `phase4DeltaQuery()` now returns normalised `mirror_updated_at` values using `strftime('%Y-%m-%dT%H:%M:%fZ', datetime(...))`.
- Cursor ordering remains deterministic: normalised timestamp ascending, then table key ascending.
- `dm_commands`, `pending_dm_parts`, carousel resolutions, webhook events, jobs, job events, artifacts, and resources all retain explicit post-watermark `created_at` fences.
- `phase4MirrorScopeForToken()` binds the normal mirror token to minimum watermark `2026-08-21T01:42:46.000Z`.
- `phase4WatermarkAllowed()` rejects normal-token requests below that watermark.
- Optional `PHASE4_REPLAY_TOKEN` support is scoped to the delegated historical cutoff `2026-08-19T05:18:26.000Z`, complete jobs only, and before the live watermark.
- `phase4ObjectAccessQuery()` now applies normalised timestamp authorisation and uses bounded `EXISTS` clauses instead of a compound `UNION`, avoiding D1 `too many terms in compound SELECT`.
- The endpoint still accepts only authenticated `GET` requests and exposes no mutation surface.

## Deployment

Worker deployments during the correction:

- `6b996b47-1efc-4d51-be4f-9a75e0352a54`: first timestamp-scope deployment.
- `e655c493-fc02-4d01-98e6-5cd1659fe77d`: object-authorisation `EXISTS` deployment after D1 rejected the prior `UNION` query.
- `d4240023-fd6e-437b-aa52-64645103f5e7`: temporary secret-change version after installing `PHASE4_REPLAY_TOKEN`.
- `b7d06948-4cd5-4d59-a88d-56049b0ce53d`: temporary replay secret removed; current Worker version at report time.

Commands used:

```powershell
Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
npm run typecheck
npm test
npx wrangler deploy --containers-rollout=none
```

Production idle/backlog check immediately before the object-authorisation deployment:

- active queue/running job status query: no rows
- pending unconsumed DM parts: `49`
- `/health`: `ok`, `ingest_mode=live`, `backlog_processing=false`

## Live mirror verification

The exact failing object request was retested after `e655c493-fc02-4d01-98e6-5cd1659fe77d`:

- key: `library/media/attribution-error-and-culture-dcgzwjwe3ui.html`
- response: HTTP `200`
- content type: `text/html; charset=utf-8`
- size header: `3428`

The existing supervised live mirror then succeeded through the normal loop:

- `2026-08-21T03:01:28.730902Z`: `rows=134`, `objects_checked=92`, `ok=true`
- `2026-08-21T03:06:35.929647Z`: `rows=41`, `objects_checked=24`, `ok=true`

Corrected formal observation start: `2026-08-21T03:01:28Z`, the first nonempty successful supervised mirror poll after the timestamp/object correction.

Live shadow schema at `2026-08-21T03:06:44Z`:

- schema: `reel_phase4_shadow_20260821_014246`
- run directory: `/srv/cartdotcom/reel-brain-runs/phase4-shadow/2026-08-21_01-42-46`
- jobs: `6`
- job events: `21`
- artifacts: `81`
- resources: `24`
- notes: `0`
- DM commands: `6`
- outbound events: `22`
- pending DM parts: `6`
- carousel resolutions: `1`
- inbound webhook events: `6`
- row versions: `175`
- typed hashes: `173`
- object receipts: `113`
- divergences: `0`
- mirror errors: `0`

The two originally missed jobs are present locally:

- `97d86b99-88d7-4618-a242-021806dc6adb` / `DcOUTdiz3yZ` / `complete`
- `1f05c43e-2e56-40f0-9d38-e072558ed104` / `DcGZwjwE3ui` / `complete`

Additional post-watermark jobs arrived during the correction window and were mirrored as normal Phase 4 live data. They were not historical backlog work and were not claimed or processed locally.

## Temporary historical replay credential

A cryptographically random temporary replay credential was generated in memory only. It was installed as Worker secret `PHASE4_REPLAY_TOKEN` and written only to:

- `/srv/cartdotcom/reel-brain-secrets/phase4-replay-token-20260821`

The server file was mode `0600`, 66 bytes including newline. The plaintext was not printed, committed, logged, placed in URLs, or passed as a process argument.

Scope verification before revocation:

- normal token with watermark `2026-08-21T01:42:45.999Z`: HTTP `403`
- replay token with exact watermark `2026-08-19T05:18:26.000Z`: HTTP `200`
- replay token with watermark `2026-08-19T05:18:25.999Z`: HTTP `403`
- replay token with watermark `2026-08-21T01:42:46.000Z`: HTTP `403`

The replay credential was revoked after the source-count blocker was found:

- `npx wrangler secret delete PHASE4_REPLAY_TOKEN --name cartdotcom-instagram-reel-brain`
- server secret file removed
- current post-revocation Worker version: `b7d06948-4cd5-4d59-a88d-56049b0ce53d`

No historical replay schema, run directory, or object root was created.

## Historical acceleration blocker

Delegated historical validation required exactly the 50 newest completed historical jobs at cutoff `2026-08-19 05:18:26 UTC`, with previously reported aggregates:

- jobs: `50`
- job events: `200`
- artifacts: `731`
- resources: `268`

Read-only D1 checks at report time did not match that evidence.

Using the exact delegated cutoff and original live watermark:

- jobs: `48`
- job events: `192`
- artifacts: `697`
- resources: `251`

Using the 50 newest completed jobs before the live watermark:

- jobs: `50`
- job events: `200`
- artifacts: `722`
- resources: `258`
- 50th-newest created-at boundary: `2026-08-19 04:19:57 UTC`

This is a material data/scope mismatch. The validation was stopped rather than silently widening the replay token, replaying a different historical slice, or discarding missing rows.

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

At `2026-08-21T03:06:44Z`:

- Cloudflare `/health`: `ok`, `ingest_mode=live`, `backlog_processing=false`
- Reel containers: healthy
- News Signal containers: healthy
- Caddy/PostgreSQL: healthy
- `/srv`: 311 GiB available, 7% used
- PostgreSQL Docker stats sample: `2.84%`, `296.3MiB / 3GiB`
- No material News Signal regression observed

## Rollback

If the timestamp correction must be rolled back:

1. Use Wrangler deployments to roll the Worker back to the pre-correction version `dda475df-5a3b-4b6f-bcbb-d538c4f96f18`.
2. Leave the local shadow schema and run directory intact as evidence.
3. Stop the Phase 4 mirror watchdog if the endpoint is rolled back, because the old endpoint will again miss same-day D1 rows after ISO watermarks.
4. Do not delete Phase 3 or Phase 4 evidence directories.

If the replay credential must be confirmed disabled:

1. Verify `PHASE4_REPLAY_TOKEN` is absent from the Worker secrets.
2. Verify `/srv/cartdotcom/reel-brain-secrets/phase4-replay-token-20260821` does not exist.
3. Verify a normal token still receives `403` for a watermark earlier than `2026-08-21T01:42:46Z`.

## Remaining risks

- Phase 4 gate observation restarted at `2026-08-21T03:01:28Z`; the gate has not passed.
- Historical acceleration is blocked until the supervisor reconciles the delegated cutoff/count mismatch.
- New post-watermark Instagram inputs are being mirrored read-only, but local processing authority remains disabled.
- Phase 5 remains blocked pending independent review.
