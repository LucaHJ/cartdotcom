# Cloudflare Codex Research Container

This Worker/Container package is a proof-of-life runtime for the news signal MVP. It runs a Linux container with Python, the Codex CLI, and a tiny HTTP API. The Worker controls the container through Cloudflare's `@cloudflare/containers` Durable Object binding.

Routes:

- `GET /dashboard` - Browser dashboard for status, articles, jobs, and research results.
- `GET /health` - Worker health.
- `GET /api/status` - Counts for articles, jobs, and results.
- `GET /api/sources` - Configured MVP news feeds.
- `GET /api/articles` - Recently discovered articles.
- `GET /api/jobs` - Recent research jobs and failures.
- `GET /api/results` - Stored Codex research memos and structured fields.
- `GET /api/market-impacts` - Ticker percentage moves from article publication time across 1h, 6h, 12h, 1d, 1w, and 1m.
- `GET /api/ticker-signals` - Ticker-level aggregate score/confidence with contributing article breakdowns.
- `GET /api/simulation` - Paper portfolio built from stored article sentiment and confidence.
- `POST /api/ingest` - Fetch RSS feeds, dedupe articles, and enqueue research jobs.
- `POST /api/process-next` - Manually process one pending job.
- `GET /container/health` - Container health.
- `GET /container/mcp-check` - Starts `codex mcp-server` and returns exposed tools.
- `POST /container/research` - Sends a prompt to Codex MCP and returns the memo.
- `POST /container/start` - Explicitly starts the container with secrets/env vars.

## Required Secrets

Set one Codex auth secret before trying `/container/mcp-check`.

These are Cloudflare Worker secrets, not GitHub repository secrets. Set them with Wrangler while authenticated to Cloudflare.

Preferred subscription/credits route:

```bash
npx wrangler secret put CODEX_AUTH_JSON < ~/.codex/auth.json
```

PowerShell:

```powershell
Get-Content $env:USERPROFILE\.codex\auth.json -Raw | npx wrangler secret put CODEX_AUTH_JSON
```

Fallback subscription/credits route:

```bash
npx wrangler secret put CODEX_ACCESS_TOKEN
```

API-billed route:

```bash
npx wrangler secret put OPENAI_API_KEY
```

Use `CODEX_AUTH_JSON` or `CODEX_ACCESS_TOKEN` if you want Codex subscription/credit usage. Use `OPENAI_API_KEY` only when you intentionally want OpenAI Platform API billing.

Optional request auth:

```bash
npx wrangler secret put CONTAINER_API_TOKEN
```

To persist refreshed ChatGPT-managed Codex credentials securely across container restarts, also set a random encryption key:

```bash
npx wrangler secret put CODEX_AUTH_STATE_KEY
```

The Worker encrypts the refreshed `auth.json` with AES-GCM before storing it in D1. The encryption key remains a Cloudflare Worker secret.

If `CONTAINER_API_TOKEN` is set, protected routes require:

```text
Authorization: Bearer <token>
```

## Local Checks

```bash
cd deployment/cloudflare-news-signal-container
npm install
npm run typecheck
docker build -t cartdotcom-news-signal-container -f container/Dockerfile .
docker run --rm -p 8080:8080 -e OPENAI_API_KEY="$OPENAI_API_KEY" cartdotcom-news-signal-container
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:8080/mcp-check
```

## Deploy

### GitHub Actions Deploy

The recommended path is GitHub Actions. This keeps the Docker build off the Windows desktop and runs it on GitHub's Linux runner.

Add these GitHub repository secrets under `Settings -> Secrets and variables -> Actions`:

- `CLOUDFLARE_ACCOUNT_ID` = `59effd14cb12e91e3486304a934e395d`
- `CLOUDFLARE_API_TOKEN`

The API token needs permission to deploy Workers and Containers on the target account. Start from Cloudflare's Workers edit/deploy token template, then make sure the token includes at least:

- Account: Account Settings Read
- Account: Workers Scripts Edit
- Account: Containers Write
- User: User Details Read

Then run the `Deploy News Signal Container` workflow manually from GitHub Actions, or push changes under `deployment/cloudflare-news-signal-container/**` to `main`.

### Local Deploy

Local deploy is still supported, but Docker must be running locally because Wrangler builds and pushes the image during deploy.

```bash
cd deployment/cloudflare-news-signal-container
npm install
npx wrangler deploy
npx wrangler containers list
```

Cloudflare's docs note that the first container deploy can take several minutes before requests are accepted.

## Notes

- Durable MVP state lives in Cloudflare D1 (`cartdotcom-news-signal`) and research jobs are sent through Cloudflare Queues (`cartdotcom-news-signal-research`).
- The Worker polls configured RSS feeds every 10 minutes and can also be triggered manually with `POST /api/ingest`.
- Ticker validation uses cached Yahoo Finance chart data and stores computed article/ticker impacts in D1.
- The simulation starts with `$100,000`, buys on sufficiently positive sentiment, sells existing holdings on sufficiently negative sentiment, and sizes trades from score magnitude and confidence.
- Do not store durable job data on the container filesystem.
- This package is separate from the existing Cloudflare Pages config so it can be deployed independently.
- The next step is improving source coverage, event taxonomy, and the dashboard view over `/api/results`.
