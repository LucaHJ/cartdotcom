# Instagram Reel Operations

This directory is the Phase 1 self-hosted scaffold for the Instagram Reel
Research System.

## Start

```bash
cd /srv/cartdotcom/instagram-reel-brain
docker compose up -d --build --wait
./scripts/verify-scaffold.sh
```

## Stop

```bash
cd /srv/cartdotcom/instagram-reel-brain
docker compose down
```

## Inspect

```bash
cd /srv/cartdotcom/instagram-reel-brain
docker compose ps
docker stats --no-stream
```

## Contract

Phase 1 is health-checkable only. Any route other than `/healthz` or `/readyz`
returns `503 phase1_inert_scaffold_no_mutations`.

Do not add this Compose project to `/srv/platform/scripts/boot-recovery.sh`
until a later gate approves independent recovery behaviour.
