# Cloudflare Migration Runbook

Cloudflare remains authoritative until every cutover gate below passes. The
self-hosted system must never create duplicate research calls while shadowing
production.

## Stages

1. **Foundation:** Install Docker, Caddy, PostgreSQL, documentation, health
   checks, and backup structure.
2. **Compatibility API:** Preserve the existing news dashboard routes while
   replacing D1, R2, Queues, Durable Objects, and Containers behind adapters.
3. **Static application:** Serve the existing site and Pages Functions locally,
   including authentication and KV-backed workflows.
4. **Data import:** Copy D1, R2, and KV exports into staging. Preserve article
   IDs, publication timestamps, prediction timestamps, outcomes, and queue
   deduplication keys.
5. **Shadow validation:** Compare production and self-hosted API payloads without
   dispatching duplicate Codex work.
6. **Worker cutover:** Pause Cloudflare consumers, reconcile in-flight jobs, then
   enable local workers at concurrency 2 before increasing gradually.
7. **Traffic cutover:** Route a canary hostname first, lower DNS TTL, validate,
   then move the main hostname.
8. **Observation:** Retain Cloudflare rollback capability for at least 7-14 days.
9. **Decommission:** Remove paid Cloudflare resources only after restore testing
   and explicit approval.

## Mandatory cutover gates

- API contract tests pass for every dashboard endpoint.
- Article, job, prediction, price, corpus, and source counts reconcile.
- Source checks execute on aligned boundaries and deduplicate correctly.
- Queue retries survive service and host restarts.
- Codex credentials persist without entering images, Git, or logs.
- Full and incremental backups complete successfully.
- A PostgreSQL and article-corpus restore has been tested.
- Monitoring detects failed ingestion, stalled workers, low disk space, and
  unhealthy services.
- DNS and application rollback steps have been exercised.

## D1 export and staging import

The Windows export script follows Cloudflare's supported `wrangler d1 export`
path and writes outside the Git repository:

```powershell
.\deployment\self-hosted\scripts\export-cloudflare-d1.ps1
```

Transfer the resulting SQL file to `/srv/cartdotcom/imports`. Validate it before
allowing any database write:

```bash
cd /srv/cartdotcom/news
docker compose --profile tools run --rm d1-import /imports/EXPORT.sql
```

The importer reports unknown tables and row counts. `merge` and especially
`replace` mode are migration operations and must only run after a fresh backup.

## Immediate rollback

1. Disable local ingestion and Codex consumers.
2. Restore DNS or proxy routing to Cloudflare.
3. Record local in-flight job IDs without deleting them.
4. Reconcile completed results before requeueing any job.
5. Diagnose from retained logs and database snapshots.

## News processing authority handoff

The two authority controls are deliberately independent. Never set both sides
active at once.

1. Confirm the latest PostgreSQL backup and Cloudflare dashboard snapshot.
2. Deploy Cloudflare with `PROCESSING_AUTHORITY=self_hosted` while leaving
   `SELF_HOSTED_PROXY_ENABLED=false`. This stops cron work, queue consumers, and
   Cloudflare mutation controls without changing dashboard reads.
3. Wait for Cloudflare in-flight work to settle, export D1, merge it into
   PostgreSQL, download the R2 corpus delta, and run
   `/srv/platform/scripts/reconcile-news-runtime.sh`.
4. Run `/srv/platform/scripts/set-runtime-mode.sh active
   --confirm-cloudflare-disabled`. This starts enabled containers first and
   changes the database authority record last.
5. Verify source checks, eight Codex slots, prediction prices, corpus files, and
   snapshots. Then deploy `SELF_HOSTED_PROXY_ENABLED=true` to move dashboard API
   reads through the private Workers VPC binding.

Rollback reverses the order: disable the Worker proxy, set local runtime to
staging, reconcile local completions back to Cloudflare if required, and only
then restore `PROCESSING_AUTHORITY=cloudflare`.
