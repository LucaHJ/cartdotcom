# Phase 5 Exact Carousel Pilot - 2026-08-23

## Outcome

The second controlled-compute case completed successfully through the split
Ubuntu runtime. Cloudflare intake remained live and skipped processing for the
exact fenced job. No backlog item was selected or processed, and no general
authority cutover occurred.

## Exact Identity

- pilot key: `phase5-carousel-20260823-103655`
- job id: `f74f0619-c6a6-46c2-8b97-6d0fc0b62a13`
- shortcode: `DcOWkMakZ2k`
- author: `moviemantis`
- lease owner: `phase5-local-worker-1`
- media: four-slide Instagram carousel

## Changes Required

- `20cc589` added the exact carousel arm and D1 migration
  `0023_phase5_carousel_arm.sql`.
- `592fb49` set an explicit service User-Agent after Cloudflare Error 1010
  rejected Python urllib before the start control call. The initial attempt
  performed no compute, callback, or publication.
- Worker version: `f74ed346-05b8-44ce-85ed-bd2f655f520e`.
- final control image:
  `sha256:3e2c8591d3fec9e344f8d84e9f02745e44934dbf13432f2f3f19a06ac762c6b0`
- final compute image:
  `sha256:7bc4e94849a34834d7e443ba6c8565ad7692c231149051641b7225fbc9edc27d`

## Result

- cloud job: `complete/complete`
- cloud fence: `local_complete`
- local lease: `completed`
- processing time: 231.1 seconds
- carousel items: 4
- analysis frames: 4
- resources: 10
- artifacts: 15
- library path: `reels/moviemantis/dcowkmakz2k/index.html`
- Codex tokens: 54,937 input; 21,504 cached input; 6,749 output; 637
  reasoning output; 61,686 total

All four carousel slide objects, the manifest, and synthesis object were
downloaded from R2 and matched their D1-recorded byte sizes and SHA-256 hashes.

## Recovery Evidence

The same exact host command resumed from the signed checkpoint after the
pre-compute Error 1010. It did not create a second job, second fence, duplicate
publication, or duplicate local lease. The staged result reached:

1. `ready_for_compute`
2. `processor_complete`
3. `complete`

## Final Gate State

- Worker health: ok; intake live; backlog processing false
- active jobs: 0
- active Phase 5 fences: 0
- armed Phase 5 captures: 0
- active Phase 5 containers: 0
- local mirror: complete job, 15 artifacts, 875 object receipts
- local mirror divergences/errors: 0/0
- Reel, News, Caddy, and PostgreSQL: healthy

## Next Gate

Run one new exact Instagram retrieval command against the completed corpus.
Phase 6 remains blocked until that retrieval case passes and is recorded.
