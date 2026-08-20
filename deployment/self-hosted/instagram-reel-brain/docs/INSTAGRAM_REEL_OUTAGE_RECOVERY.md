# Instagram Reel Outage Recovery

Phase 1 recovery is intentionally narrow because no production traffic or data
is owned by the local Reel scaffold.

## Reboot

The containers use `restart: unless-stopped`, but the project is not yet wired
into platform boot recovery. Start it manually after platform and News are
healthy:

```bash
cd /srv/cartdotcom/instagram-reel-brain
docker compose up -d --wait
./scripts/verify-scaffold.sh
```

## Rollback

```bash
cd /srv/cartdotcom/instagram-reel-brain
docker compose down
```

Optional cleanup after verification:

```bash
docker network rm cartdotcom-reel-runtime cartdotcom-reel-egress
```

Do not remove `/srv/cartdotcom/reel-brain-data`,
`/srv/cartdotcom/reel-brain-runs`, or `/srv/backups/instagram-reel-brain`
unless the operator has confirmed no later phase used them.
