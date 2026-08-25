# Retrieval Reply Delivery Report — 2026-08-25

## Outcome

Confident Instagram retrievals now reply `.` to the matched completed job's
original shared Reel/post message. This avoids depending on inconsistent
Instagram URL unfurling. Explicit archive requests are unchanged. A canonical
URL is used only when the native reply cannot be sent; an archived MP4 remains
the final fallback when no usable original URL exists.

## Diagnosis

The Daigo/Street Fighter result was not delivered through a special native
share API. D1 recorded it as the same successful `reel_link` text delivery used
for the other reported queries. Instagram happened to unfurl that bare Reel URL
as an in-app Reel card, while other URLs opened in the in-app browser. The
unfurl result is not controlled by the Worker.

## Code

- Commit: `10f8727`
- Worker: `090a0e9f-ea88-4831-914a-1468c5606ea7`
- `src/instagram-messaging.ts`: constructs and sends the authenticated Meta
  `reply_to.mid` payload without placing credentials in URLs.
- `src/index.ts`: resolves the selected job's durable `source_message_id`,
  replies with `.`, records `retrieval_reply`, and retains bounded fallbacks.
- `tests/instagram-retrieval-reply.test.mjs`: executable payload, transport,
  failure, target lookup, and fallback coverage.

## Verification

- TypeScript typecheck: pass.
- Focused tests: 30/30 pass.
- Full Worker Node suite: 114/114 pass.
- Container Python suite: 9/9 pass.
- Worker dry-run with no container rollout: pass.
- Post-deploy `/health`: `ok`, `processing_authority=self_hosted`, generation
  `2`, `backlog_processing=false`.
- D1 after deployment: zero queued/running jobs, zero active Phase 5 fences,
  backlog disabled.
- All Reel, News, Caddy, and PostgreSQL containers healthy.

No historical command was replayed and no synthetic Instagram message was
sent. The first visible acceptance evidence is the next normal user retrieval
query, which should add one `retrieval_reply` audit event.

## Rollback

Rollback the Worker to version `282c170a-cafb-48c8-9317-e0cd878e774a` or revert
commit `10f8727`. No database rollback is required because this change adds no
schema or durable authority mutation.
