# Instagram DM Intake Setup

This repository exposes a Meta webhook endpoint for WAR ROOM Instagram Reel capture:

```text
https://cartdotcom.com/api/instagram/webhook
```

The endpoint receives Instagram Messaging webhook events, extracts Instagram Reel/post URLs from message text or attachment URLs, and stores structured intake records in `MOBILE_AUTH_KV` under the `instagram:intake:` prefix. It does not execute DM text as a Codex prompt.

## Required Cloudflare Pages Variables

Set these in the `cartdotcom` Cloudflare Pages project:

```text
META_WEBHOOK_VERIFY_TOKEN=<from C:\Users\User\.war-room\secrets\instagram-dm-intake.json>
META_APP_SECRET=<Meta app secret>
INSTAGRAM_ALLOWED_SENDER_IDS=<comma-separated Instagram sender IDs, recommended>
INSTAGRAM_ALLOW_UNLISTED_SENDERS=false
```

Existing binding required:

```text
MOBILE_AUTH_KV
```

Development-only escape hatch:

```text
INSTAGRAM_WEBHOOK_ALLOW_UNSIGNED=true
```

Do not use unsigned webhooks in production.

## Meta Dashboard Setup

In Meta for Developers:

1. Open the app dashboard.
2. Add the Instagram/Messenger messaging product needed for Instagram Messaging webhooks.
3. Configure the callback URL as `https://cartdotcom.com/api/instagram/webhook`.
4. Use the verify token from `C:\Users\User\.war-room\secrets\instagram-dm-intake.json`.
5. Subscribe to message-related Instagram webhook fields.
6. Request or configure the required permissions for Instagram Messaging, likely including `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata`, `pages_messaging`, and possibly `pages_show_list`.
7. Keep the app in a test/admin-only state until sender allowlisting and webhook verification are confirmed.

## Local Processing

After webhook records arrive, process them locally from WAR ROOM:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\User\Desktop\WAR-ROOM\Tools\ProcessInstagramWebhookIntake.ps1 -Mode List -Status all
powershell -ExecutionPolicy Bypass -File C:\Users\User\Desktop\WAR-ROOM\Tools\ProcessInstagramWebhookIntake.ps1 -Mode Process -Status ready
```

The local processor calls `Tools\AddInstagramReelToBrain.ps1`, creating raw captures, wiki source pages, and description queue rows.

If a record has `needs_sender_allowlist`, copy the non-secret sender id into the `INSTAGRAM_ALLOWED_SENDER_IDS` Cloudflare Pages variable before allowing automated processing.
