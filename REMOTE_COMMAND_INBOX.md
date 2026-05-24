# Remote Command Inbox Setup

This site includes a remote command inbox UI on `prompting.html`, a mobile approval UI on `mobile-approval.html`, and Cloudflare Pages Functions for queue and passkey approval.

The intended flow is:

1. User opens the protected prompting page.
2. User submits a structured Codex job.
3. `/api/commands` validates the request.
4. The function creates a GitHub Issue as the queue item.
5. High-risk jobs are written to the mobile approval queue.
6. The phone approves or rejects the job with a passkey.
7. Local Codex later processes approved jobs under WAR ROOM rules.

## Required Cloudflare Setup

Protect the dashboard, prompting page, mobile approval page, `/api/commands`, and `/api/mobile/*` paths with Cloudflare Access before enabling submissions.

Recommended Access policy:

- Allow only the owner's account.
- Require MFA/passkey through the identity provider.
- Use a short session duration for `/api/commands`.

## Required Pages Environment Variables

Set these in the Cloudflare Pages project:

```text
COMMAND_QUEUE_REPO=LucaHJ/cartdotcom
GITHUB_TOKEN=<fine-grained token with Issues: Read and write on COMMAND_QUEUE_REPO>
ALLOWED_ACCESS_EMAILS=<comma-separated allowed Cloudflare Access emails>
WEBAUTHN_RP_ID=cartdotcom.com
WEBAUTHN_ORIGIN=https://cartdotcom.com
```

Do not put these values in the repository.

## Required KV Binding

Create a Workers KV namespace and bind it to the Pages project as:

```text
MOBILE_AUTH_KV
```

This stores passkey metadata, short-lived WebAuthn challenges, and pending approval records. Cloudflare KV is eventually consistent, which is acceptable for this first single-user approval layer because approval is not a high-frequency write path.

## Optional Development Variable

```text
ALLOW_UNAUTHENTICATED_COMMANDS=true
ALLOW_UNAUTHENTICATED_MOBILE_AUTH=true
MOBILE_AUTH_DEV_EMAIL=dev@local.test
```

Use this only for local testing. Do not set it in production.

## Security Defaults

- Requests without Cloudflare Access identity are rejected unless explicitly allowed for local testing.
- Cross-site submissions are blocked with Fetch Metadata checks.
- Prompts with likely secrets are rejected.
- The server recomputes the prompt hash and rejects mismatches.
- Jobs are queued as GitHub Issues; Codex app-server is not exposed.
- Passkey approval requires WebAuthn user verification.
- Approval challenges are bound to job id, prompt hash, action class, target, approval level, and decision.

Labels are disabled by default so the first submission does not fail when repository labels have not been created. Set `ENABLE_COMMAND_LABELS=true` after creating these labels:

```text
remote-command
remote-small_note
remote-wiki_research
remote-repo_edit
remote-agent_rule_change
remote-deploy
remote-general
approval-required
approval-not-required
risk-low
risk-medium
risk-high
risk-critical
```

## Current Mobile Approval Model

The first implementation uses WebAuthn/passkeys in the mobile browser rather than a native iOS app. On iPhone, this uses the system passkey flow with Face ID or device passcode. A native app can still be added later if APNs notifications or app-only device attestation become necessary.
