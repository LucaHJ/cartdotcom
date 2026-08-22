# Phase 5C Narrow Control Auth Gate - 2026-08-23

## Outcome

The dedicated Ubuntu Phase 5 control credential is installed and its narrow
scope is verified. No live arm, job, callback, publication, reaction, backlog
operation, or general authority change occurred. Cloudflare remains the sole
general production authority and both Phase 5 containers remain stopped.

Implementation commit: `956d2a3` (`Add narrow Phase 5 Worker control token`).

Worker-only deployment before secret installation:

- Worker version: `fbbeeffb-c364-4c1b-8597-7d95931b91a0`
- Secret-change version: `a1ed3971-9604-4961-a62a-d166b73fba08`
- container rollout: none
- health: `ok=true`, intake live, backlog processing false

## Credential Boundary

The Worker accepts `PHASE5_CONTROL_TOKEN` only under
`/api/admin/phase5/local-pilot/*`. The existing broad `ADMIN_TOKEN` remains a
fallback for current operators. The narrow token cannot authorize any other
admin route.

The same randomly generated value was streamed once to Cloudflare and once to
Ubuntu without displaying it. Ubuntu stores it at:

`/srv/cartdotcom/instagram-reel-brain/secrets/phase5_admin_token`

Verified metadata: owner `lucaj`, group `lucaj`, mode `0600`. The one-shot host
orchestrator mounts this file only into `phase5-control`; `phase5-compute` has
no control-token mount or PostgreSQL credential.

## Verification

- focused Worker typecheck: passed
- focused Phase 5 tests: 23/23 passed
- unauthenticated Phase 5 start: rejected
- narrow token with intentionally invalid Phase 5 body: reached the Phase 5
  validator and returned the expected validation error
- narrow token against an ordinary admin path: rejected
- pre-deploy and post-install Worker health: healthy, backlog off
- D1 active jobs: 0
- D1 active Phase 5 fences: 0
- D1 armed Phase 5 captures: 0
- no Phase 5 container active

## Recovery

Do not rotate or recreate the token during normal recovery. If the narrow
credential is suspected compromised, stop all exact Phase 5 work, confirm no
active fence/job/arm, delete the `PHASE5_CONTROL_TOKEN` Worker secret, remove
the server file, and record a separate credential-rotation gate before
replacement. Existing Cloudflare general authority is unaffected.

## Next Gate

The next permitted live action is one brand-new user-submitted carousel,
captured by the exact pre-intake arm and processed at concurrency one. No
existing job or historical backlog item may be selected as that pilot.
