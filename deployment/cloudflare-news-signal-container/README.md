# Cloudflare Codex Research Container

This Worker/Container package is a proof-of-life runtime for the news signal MVP. It runs a Linux container with Python, the Codex CLI, and a tiny HTTP API. The Worker controls the container through Cloudflare's `@cloudflare/containers` Durable Object binding.

Routes:

- `GET /dashboard` - Browser dashboard for status, articles, jobs, and research results.
- `GET /health` - Worker health.
- `GET /api/status` - Counts for articles, jobs, and results.
- `GET /api/status/live` - Lightweight live job counts, timing averages, and queue ETA.
- `GET /api/sources` - Configured editorial, regulator, first-party, and press-release feeds.
- `GET /api/source-stats` - Per-source feed-ledger, stored-article, and prediction-movement totals.
- `GET /api/source-check-details?check_id=CHECK_ID` - Per-source fetched, newly seen, acquired, duplicate, baseline, pending, and error counts for a source check.
- `GET /api/articles` - Recently discovered article metadata and plaintext capture status.
- `GET /api/articles/content?id=ARTICLE_ID` - Stored source link, publication date, and plaintext content for one article.
- `POST /api/articles/backfill?limit=25` - Capture plaintext content for existing articles that have not completed backfill.
- `GET /api/corpus/status` - Full-text corpus coverage, storage totals, and latest stored object.
- `GET /api/corpus/objects?status=stored&limit=100` - Corpus object index with article and source metadata.
- `GET /api/corpus/article?id=ARTICLE_ID` - Retrieve one authenticated full article/analysis JSON document from R2.
- `POST /api/corpus/backfill?limit=50` - Store a bounded batch of completed articles in the R2 corpus. Add `retry_failed=1` to reset exhausted storage failures before retrying.
- `GET /api/jobs` - Recent research jobs and failures.
- `GET /api/results` - Stored Codex research memos and structured fields.
- `GET /api/market-impacts` - Ticker percentage moves from article publication time across 1h, 6h, 12h, 1d, 1w, and 1m.
- `GET /api/ticker-signals` - Ticker-level aggregate score/confidence with contributing article breakdowns.
- `GET /api/model-experiments` - Latest Luna/Terra experiment progress and completed report.
- `POST /api/model-experiments/start` - Freeze 1,000 matured articles and start the sequential Luna-medium then Terra-low comparison.
- `POST /api/model-experiments/dispatch` - Resume or nudge an interrupted experiment.
- `POST /api/model-experiments/email` - Set the report recipient and retry delivery after completion.
- `POST /api/model-experiments/email/test` - Save the recipient and send an immediate delivery test.
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

## Model Experiment Email

Experiment reports are always retained in D1 and shown under **Settings -> Luna vs Terra Model Experiment**. Email delivery is optional and supports either a Cloudflare Email Service binding named `EXPERIMENT_EMAIL` or Resend.

Configure a sender and default recipient as Worker secrets or variables:

```bash
npx wrangler secret put EXPERIMENT_REPORT_EMAIL_FROM
npx wrangler secret put EXPERIMENT_REPORT_EMAIL_TO
```

For Resend, also configure:

```bash
npx wrangler secret put RESEND_API_KEY
```

The production configuration uses a Cloudflare Email Service binding named `EXPERIMENT_EMAIL` and the isolated sender domain `alerts.cartdotcom.com`. A recipient entered in the dashboard overrides the default recipient. Failure to configure email does not block the experiment or its stored report.

## Local Checks

```bash
cd deployment/cloudflare-news-signal-container
npm install
npm run typecheck
npm run verify-feeds
docker build -t cartdotcom-news-signal-container -f container/Dockerfile .
docker run --rm -p 8080:8080 -e OPENAI_API_KEY="$OPENAI_API_KEY" cartdotcom-news-signal-container
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:8080/mcp-check
```

## Deploy

Create the private R2 bucket once before the first corpus-enabled deploy:

```bash
npx wrangler r2 bucket create cartdotcom-news-article-corpus
```

The Worker binds it as `ARTICLE_CORPUS`. The deployment API token needs permission to read the bucket configuration in addition to its Worker and Container permissions.

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
npx wrangler d1 migrations apply cartdotcom-news-signal --remote
npx wrangler deploy
npx wrangler containers list
```

Cloudflare's docs note that the first container deploy can take several minutes before requests are accepted.

## Notes

- Operational state and corpus indexes live in Cloudflare D1 (`cartdotcom-news-signal`). Full article and analysis documents live in the private R2 bucket `cartdotcom-news-article-corpus`; research jobs are sent through Cloudflare Queues (`cartdotcom-news-signal-research`).
- The Worker polls 81 configured RSS/Atom feeds every 5 minutes and can also be triggered manually with `POST /api/ingest`.
- Feed URLs are recorded in a durable first-seen ledger. Each source receives a fixed activation timestamp: its initial archive becomes a non-queued baseline, unseen entries published after activation are queued regardless of discovery delay, pre-activation archive entries are recorded as stale, and pending ledger entries are retried after interruptions.
- Public article bodies are extracted to plaintext. D1 retains a bounded operational preview; R2 retains a versioned JSON corpus object containing the full available plaintext, provenance, source metadata, and linked research analysis. Feed text remains an explicit fallback when a paywall or browser check prevents full-page extraction.
- Existing article content is backfilled automatically in bounded batches on every scheduled run; research jobs also attempt capture before analysis.
- Completed articles are archived to R2 in bounded, resumable batches on every scheduled run. Missing and inaccessible article text is catalogued explicitly rather than silently omitted.
- Cloudflare Queues runs up to eight research consumers concurrently across eight independently scalable Codex containers.
- Model comparisons reserve at most four workers, yield to newly acquired first-pass articles, run both models against the same frozen 1,000-article cohort, and never write experiment calls into production prediction tables.
- Ticker validation uses cached Yahoo Finance chart data and stores computed article/ticker impacts in D1.
- The simulation starts with `$100,000`, buys on sufficiently positive sentiment, sells existing holdings on sufficiently negative sentiment, and sizes trades from score magnitude and confidence.
- Do not store durable job data on the container filesystem.
- This package is separate from the existing Cloudflare Pages config so it can be deployed independently.
- The next step is improving source coverage, event taxonomy, and the dashboard view over `/api/results`.
