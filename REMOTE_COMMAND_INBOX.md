# Remote Command Inbox Setup

This site includes a single prompt composer on `prompting.html`, a mobile approval UI on `mobile-approval.html`, and Cloudflare Pages Functions for authenticated queue delivery and passkey approval.

The intended flow is:

1. User opens the protected prompting page.
2. User enters a prompt and optional uploads.
3. `/api/commands` validates the request.
4. The function creates a mobile approval queue item in `MOBILE_AUTH_KV`.
5. If `COMMAND_QUEUE_REPO` and `GITHUB_TOKEN` are configured, the function also creates a GitHub Issue.
6. The phone approves or rejects the job with a passkey.
7. Local Codex later processes approved jobs under WAR ROOM rules.

## Required Cloudflare Setup

Protect the dashboard, prompting page, mobile approval page, `/api/commands`, and `/api/mobile/*` paths with Cloudflare Access before enabling submissions.

Recommended Access policy:

- Allow only the owner's account.
- Require MFA/passkey through the identity provider.
- Use a short session duration for `/api/commands`.

Recommended protected paths in one Access self-hosted application:

```text
cartdotcom.com/dashboard*
cartdotcom.com/prompting*
cartdotcom.com/mobile-approval*
cartdotcom.com/api/commands
cartdotcom.com/api/mobile/*
```

Use one Access application for these paths when possible so the browser page and API requests share the same Access session. Cloudflare Access path wildcards can protect specific paths without making the whole public site private.

## Troubleshooting Access Identity

If passkey registration shows:

```text
Cloudflare Access identity is missing.
```

then the request reached the Pages Function without usable Cloudflare Access identity. The Functions validate `Cf-Access-Jwt-Assertion` with Cloudflare's Access Pages plugin and use the JWT payload email, falling back to `cf-access-authenticated-user-email` when present. Check:

1. `https://cartdotcom.com/mobile-approval` should trigger Cloudflare Access login when opened in a private browser.
2. `/api/mobile/*` must be protected by the same Access application as `mobile-approval*`, or by an application that issues a valid Access session for API fetches.
3. The policy must allow the email listed in `ALLOWED_ACCESS_EMAILS`.
4. `CF_ACCESS_DOMAIN` and `CF_ACCESS_AUD` may be set in Pages environment variables if the Access application is recreated. Current non-secret defaults are embedded in the API middleware for the existing app.
5. After changing Access paths, reload the phone page from a fresh authenticated session and try Register passkey again.

## Required Pages Environment Variables

Set these in the Cloudflare Pages project:

```text
ALLOWED_ACCESS_EMAILS=<comma-separated allowed Cloudflare Access emails>
WEBAUTHN_RP_ID=cartdotcom.com
WEBAUTHN_ORIGIN=https://cartdotcom.com
```

Do not put these values in the repository.

Optional GitHub Issue mirror:

```text
COMMAND_QUEUE_REPO=LucaHJ/cartdotcom
GITHUB_TOKEN=<fine-grained token with Issues: Read and write on COMMAND_QUEUE_REPO>
```

The queue works without GitHub when `MOBILE_AUTH_KV` is bound. GitHub Issues are an audit/mirror channel, not the only queue backend.

## Required KV Binding

Create a Workers KV namespace and bind it to the Pages project as:

```text
MOBILE_AUTH_KV
```

This repository manages that binding through `wrangler.toml`.

This stores passkey metadata, short-lived WebAuthn challenges, and pending approval records. Cloudflare KV is eventually consistent, which is acceptable for this first single-user approval layer because approval is not a high-frequency write path.

## Security Defaults

- Requests without Cloudflare Access identity are rejected.
- Cross-site submissions are blocked with Fetch Metadata checks.
- Prompts with likely secrets are rejected.
- The server recomputes the prompt hash and rejects mismatches.
- The browser cannot set action class, approval gate, target, result channel, or permission level.
- Jobs are queued in Cloudflare KV for mobile approval; Codex app-server is not exposed.
- GitHub Issues are created only when the optional GitHub queue variables are configured.
- Passkey approval requires WebAuthn user verification.
- Approval challenges are bound to job id, prompt hash, action class, target, approval gate, and decision.

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
