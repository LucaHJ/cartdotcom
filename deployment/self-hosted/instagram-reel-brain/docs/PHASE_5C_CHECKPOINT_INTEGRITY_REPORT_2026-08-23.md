# Phase 5C Checkpoint Integrity Gate - 2026-08-23

## Outcome

The no-live Phase 5C control/compute handoff correction passed focused local
tests and the Ubuntu synthetic fault matrix. Cloudflare remains the sole
production authority. No live job, Instagram request, production callback,
credential installation, backlog processing, or Phase 6 action occurred.

Implementation commit: `fa37942` (`Authenticate Phase 5C staged handoffs`).

## Architecture

The staged runtime now uses two different host roots:

- `/srv/cartdotcom/reel-brain-runs/phase5-control`: authoritative control
  state, writable only by `phase5-control` and read-only in `phase5-compute`.
- `/srv/cartdotcom/reel-brain-runs/phase5-compute`: untrusted compute results,
  writable by `phase5-compute` and read-only in `phase5-control`.

Control checkpoints are version 2 and carry an HMAC-SHA256 signature. The key
is derived inside the control container from its exact Worker control token;
the token and derived key are not stored in the checkpoint. Compute results are
separate versioned documents bound to pilot key, job id, source message id,
lease owner, and the SHA-256 digest of the signed control state they consumed.

The host orchestrator no longer reads a checkpoint stage to skip work. Every
invocation calls control reconciliation, compute execution/resume, and control
finalization. Each container makes its own idempotent decision from its bounded
state. Control validates the signed state and treats compute output as
untrusted before finalization.

## Verification

Focused workstation checks:

- Phase 5 Node tests: 15/15 passed.
- Python compile: staged runner and host orchestrator passed.
- Compose validation: passed.

Ubuntu synthetic matrix (`--synthetic-case all`): `ok=true` for 11 cases:

1. complete
2. restart after control start
3. restart after compute result
4. restart after processor callback but before result checkpoint
5. restart after cloud finalize but before local completion
6. duplicate invocation
7. short authority with zero compute calls
8. compute failure with exact pre-publication abort
9. forged control stage plus matching stage index
10. tampered compute-result digest
11. compute write attempt against the read-only control mount

Final images:

- control: `sha256:d5f7ca1814d572eaaf49b85918292f04c4a2caf1988346e3dce0cbaf7d071b3f`
- compute: `sha256:ababd6f3a1ef297952193f01411ecc5ffc5135c8f3e958f08acc7410c35e3cdc`
- each image: 443,634,326 bytes

Post-test state:

- no Phase 5 containers running;
- zero `reel_phase5c_staged_%` schemas;
- Worker health `ok=true`, intake live, backlog processing false;
- Reel, News, Caddy, and PostgreSQL healthy.

## Rollback

The pre-change inert runtime backup is:

`/srv/cartdotcom/instagram-reel-brain/backups/phase5c-pre-integrity-20260822T152634Z.tgz`

Source rollback is `git revert fa37942`, followed by copying the reverted
Compose and runner files to `/srv/cartdotcom/instagram-reel-brain` and
rebuilding only the two profile-gated Phase 5 images.

## Next Gate

Live execution remains disabled until a narrowly scoped Worker control token is
installed as a mode-0600 control-only file and its scope/mount are verified
without displaying plaintext. No carousel, retrieval, backlog, or Phase 6 work
is authorized by this report alone.
