# Cartdotcom Server Operations

Last updated: 2026-08-19

This is the primary server-local reference. It contains no passwords, private
keys, authentication tokens, or provider credentials.

Read `MIGRATION_STATE.md` first to determine which system is authoritative and
which services are intentionally disabled.

## Access

From the configured Windows workstation:

```powershell
ssh cartdotcom-server
```

The host is `cartdotcom-server`, the administrative account is `lucaj`, and the
operating system is Ubuntu Server 24.04 LTS. Keep the host clock in UTC; the
application converts display times to `Australia/Brisbane` where required.

## Installed components

| Component | Purpose | Owner/location |
|---|---|---|
| OpenSSH | Remote administration | systemd `ssh.socket` |
| Docker Engine | Isolated application runtime | systemd `docker.service` |
| Docker Compose | Defines each independent application stack | `/srv/*/compose.yaml` |
| Caddy | HTTP gateway and eventual TLS termination | `/srv/platform` |
| PostgreSQL | Durable Cartdotcom application state and job records | Docker volume `cartdotcom-postgres-data` |
| Node.js news API | Self-hosted compatibility endpoints | `/srv/cartdotcom/news` |
| News scheduler | Durable feed acquisition and local job creation | `/srv/cartdotcom/news` |
| News worker | Leased PostgreSQL job dispatcher; has no Codex credentials | `/srv/cartdotcom/news` |
| Codex runner | Isolated subscription-backed inference; has no database credentials | `/srv/cartdotcom/news` |
| Market tracker | Durable Yahoo Finance interval and daily price collection | `/srv/cartdotcom/news` |
| unattended-upgrades | Ubuntu security updates | system package configuration |

PostgreSQL and future queue services must remain on internal Docker networks.
Only the gateway may publish public HTTP ports.

## Workload directories

| Directory | Purpose |
|---|---|
| `/srv/platform` | Shared proxy and database |
| `/srv/cartdotcom` | Cartdotcom dashboard, ingestion, and Codex workers |
| `/srv/cartdotcom/article-corpus` | Full article and analysis JSON objects migrated from R2 |
| `/srv/media` | Personal media services; not part of Cartdotcom |
| `/srv/codex-lab` | Independent Codex projects |
| `/srv/backups` | Local encrypted backup staging |
| `/srv/docs` | This handbook and migration documentation |
| `/srv/platform/secrets` | Host-managed runtime secrets; never copy to Git |

## Common checks

```bash
docker version
docker compose version
cd /srv/platform && docker compose ps
cd /srv/platform && docker compose logs --tail=100
curl --fail http://127.0.0.1:8080/health
df -h /
free -h
systemctl --failed
```

## Staging dashboard

The dashboard is deliberately bound to server loopback until public cutover.
From the configured Windows workstation, create an SSH tunnel:

```powershell
ssh -N -L 18080:127.0.0.1:8080 cartdotcom-server
```

Open `http://127.0.0.1:18080/`. The dashboard token is stored only at
`/srv/platform/secrets/dashboard_token`. To display it locally when needed:

```powershell
ssh cartdotcom-server "cat /srv/platform/secrets/dashboard_token"
```

The token file is mode `0600`. Do not put its value in Git, documentation,
Compose YAML, shell scripts, or screenshots.

Synchronize the self-hosted dashboard after changing the Cloudflare UI:

```powershell
node deployment/self-hosted/scripts/sync-dashboard.mjs
```

## Backups

PostgreSQL is backed up every day at `02:15 UTC` by the `lucaj` crontab. Dumps
are written atomically to `/srv/backups/postgres`, verified with `pg_restore`,
and retained locally for 14 days.

Run an additional backup manually:

```bash
/srv/platform/scripts/backup-postgres.sh
```

The backup command uploads the verified dump to private R2 and confirms that
its manifest can be retrieved. Periodically test the complete off-site copy:

```bash
/srv/platform/scripts/verify-postgres-offsite.sh YYYYMMDDTHHMMSSZ
```

Local backups protect against application mistakes, but not disk failure. Before
production cutover, replicate them to an encrypted external disk or another
machine and test a restore into a temporary database.

Article corpus files are separate from PostgreSQL and must be included in the
off-host backup. Their relative paths must match `article_corpus_objects.object_key`.

## Starting and stopping

```bash
cd /srv/platform
docker compose up -d
docker compose stop
```

Use `stop` for maintenance. Do not use `docker compose down -v`; `-v` deletes
named data volumes. Do not run broad Docker prune commands on this server.

## Upgrades

1. Confirm a recent backup exists.
2. Read release notes for the component being upgraded.
3. Pull one stack at a time with `docker compose pull`.
4. Apply with `docker compose up -d`.
5. Run that stack's verification script and inspect logs.
6. Record the change in `/srv/docs/CHANGELOG.md`.

Do not automatically update database major versions or application images across
major versions.

## Secrets

- Store platform secrets in `/srv/platform/secrets` and application-specific
  secrets in a mode-`0700` ignored directory owned by that application.
- Files must be mode `0600` or stricter.
- Never place credentials in Compose YAML, Dockerfiles, Git, shell history, or
  operational documentation.
- Rotate any credential that appears in logs or chat.

## Recovery priorities

1. Preserve PostgreSQL data and article files.
2. Keep Cloudflare production active until self-hosted parity is verified.
3. Restore the platform database before workers to prevent duplicate jobs.
4. Start ingestion only after queue and deduplication state are consistent.

See `MIGRATION_RUNBOOK.md` for migration-specific rollback steps.
See `OUTAGE_RECOVERY.md` for boot recovery, job leases, power-loss behavior,
and the remaining single-machine risks.

## Runtime mode

The news scheduler, database worker, and Codex runner are independently guarded
and default to disabled. View the current setting with:

```bash
cat /srv/cartdotcom/news/.env
```

Return to staging at any time:

```bash
/srv/platform/scripts/set-runtime-mode.sh staging
```

Active mode is reserved for the final Cloudflare cutover and requires both a
Codex login and an explicit confirmation argument. Follow `MIGRATION_RUNBOOK.md`;
do not enable it merely to test the dashboard.
