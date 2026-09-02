#!/bin/sh
set -eu

cd /srv/codex-lab/ibkr-codex/source

docker compose config | grep -q 'IBKR_PORT: "4002"'
docker compose exec -T api python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3000/healthz', timeout=5)"
docker compose exec -T codex-runner python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3010/healthz', timeout=5)"
docker compose exec -T codex-runner codex login status 2>&1 | grep -q 'Logged in using ChatGPT'
curl -fsS 'https://cartdotcom-news-signal-container.lucajeannin.workers.dev/backend/ibkr_codex' 2>/dev/null | grep -q 'PAPER ONLY'

docker compose exec -T postgres psql -U ibkr_codex -d ibkr_codex -Atc \
  "SELECT 'broker='||state||', portfolio='||portfolio_readable||', live_quotes='||coalesce(live_us_stock_quotes::text,'unknown')||', delayed_quotes='||coalesce(delayed_us_stock_quotes::text,'unknown')||', order_api='||coalesce(api_us_stock_order_access::text,'unknown') FROM broker_status; SELECT key||'='||value::text FROM app_settings WHERE key IN ('kill_switch','trading_enabled') ORDER BY key"

echo 'IBKR Codex production verification: ok'
