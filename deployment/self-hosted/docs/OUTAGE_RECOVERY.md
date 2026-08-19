# Outage and Hardware Recovery

The self-hosted server is designed to pause safely during a power or network
outage. It cannot provide Cloudflare's geographic redundancy or recover news
items that disappear from a publisher's feed before the server comes back.

## Automatic behavior

- Docker starts at boot and every production container uses
  `restart: unless-stopped`.
- The boot recovery job starts PostgreSQL first, reapplies idempotent database
  migrations, starts the API and scheduler, and verifies both endpoints.
- The scheduler keeps source-run state and service heartbeats in PostgreSQL.
- A source scan commits feed observations, articles, jobs, and its completion
  record in one database transaction.
- Research work uses database leases. An interrupted local worker can be
  reclaimed after its lease expires without two workers owning it at once.
- Codex inference is isolated from PostgreSQL. The dispatcher has the database
  secret but no Codex authentication; the runner has Codex authentication and
  outbound internet but no database network or password.
- New article jobs have higher priority than resynthesis jobs.
- On restart, the scheduler performs one current catch-up scan. It does not
  replay one scan for every missed five-minute boundary; the feed ledger
  deduplicates URLs still present in each source feed.
- While the server is healthy, a constrained publisher updates a private
  Cloudflare R2 dashboard snapshot every five minutes. After public cutover,
  Cloudflare serves the latest snapshot for supported read endpoints whenever
  the local API cannot be reached. Snapshot tables and charts remain visible,
  but mutations, filtering, pagination, and live updates are disabled.
- The dashboard probes the local API every 30 seconds while showing a snapshot.
  It removes the offline banner, reloads current data, and restores controls
  automatically after the server becomes reachable.

## Important limitations

RSS and Atom feeds are rolling windows. During a long outage, an article may be
published and disappear from a feed before the next successful scan. Source
APIs, sitemap history, or an external availability monitor are needed to close
that gap. This is separate from queue durability: work already stored in
PostgreSQL is retained.

The current database backups are on the same physical SSD as PostgreSQL. They
protect against application errors but not SSD loss, theft, fire, or severe
filesystem corruption. Do not cut production over until PostgreSQL dumps and
the article corpus are copied off-host and a restore has been tested.

The Cloudflare snapshot is a continuity view, not a database backup. It holds
only the latest rendered API datasets and cannot resume ingestion, inference,
or market-price collection while the server is offline.

## Host settings

Configure the BIOS option commonly named `Restore on AC Power Loss`, `AC Back`,
or `After Power Failure` to `Power On`. The operating system cannot guarantee a
restart if firmware leaves the computer powered off.

A UPS is recommended. Connect it by USB and configure Network UPS Tools so the
server can shut down cleanly during an extended outage. A DHCP reservation for
the server also prevents its LAN address changing after a router restart.

## Verification

```bash
/srv/platform/scripts/health-audit.sh
tail -n 100 /srv/platform/logs/boot-recovery.log
tail -n 100 /srv/platform/logs/health-audit.log
cd /srv/cartdotcom/news && docker compose logs --tail=100 news-scheduler
cd /srv/cartdotcom/news && docker compose logs --tail=100 dashboard-snapshot
```

To test application recovery without powering off the machine:

```bash
sudo systemctl restart docker
sleep 30
/srv/platform/scripts/health-audit.sh
```

Do not use this test while a migration or backup is running.
