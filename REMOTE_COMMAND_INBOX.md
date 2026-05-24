# Remote Command Inbox Setup

This site includes a remote command inbox UI and a Cloudflare Pages Function at `/api/commands`.

The intended flow is:

1. User opens the protected dashboard.
2. User submits a structured Codex job.
3. `/api/commands` validates the request.
4. The function creates a GitHub Issue as the queue item.
5. Local Codex later processes approved jobs under WAR ROOM rules.

## Required Cloudflare Setup

Protect the dashboard and `/api/commands` path with Cloudflare Access before enabling submissions.

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
```

Do not put these values in the repository.

## Optional Development Variable

```text
ALLOW_UNAUTHENTICATED_COMMANDS=true
```

Use this only for local testing. Do not set it in production.

## Security Defaults

- Requests without Cloudflare Access identity are rejected unless explicitly allowed for local testing.
- Cross-site submissions are blocked with Fetch Metadata checks.
- Prompts with likely secrets are rejected.
- The server recomputes the prompt hash and rejects mismatches.
- Jobs are queued as GitHub Issues; Codex app-server is not exposed.

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

## Current Limitation

The mobile Face ID approval app is not implemented yet. Until then, high-risk jobs should remain queued and be manually approved or converted into PR-only work.
