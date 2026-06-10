import { Container, getContainer } from "@cloudflare/containers";

type Source = {
  id: string;
  name: string;
  url: string;
  category: string;
  weight: number;
};

type FeedItem = {
  source: Source;
  title: string;
  url: string;
  summary: string | null;
  publishedAt: string | null;
};

type Article = {
  id: string;
  source_id: string;
  title: string;
  url: string;
  summary: string | null;
  published_at: string | null;
  discovered_at: string;
};

type ResearchJobMessage = {
  jobId: string;
};

type ResearchResultFields = {
  event_type?: string;
  companies?: string[];
  industries?: string[];
  symbols?: string[];
  sentiment_score?: number;
  impact_horizon?: string;
  confidence?: number;
  summary?: string;
};

export interface Env {
  CODEX_CONTAINER: DurableObjectNamespace<CodexResearchContainer>;
  NEWS_DB: D1Database;
  RESEARCH_QUEUE: Queue<ResearchJobMessage>;
  CONTAINER_API_TOKEN?: string;
  OPENAI_API_KEY?: string;
  CODEX_ACCESS_TOKEN?: string;
  CODEX_AUTH_JSON?: string;
  CODEX_RESEARCH_MODEL?: string;
}

const SOURCES: Source[] = [
  {
    id: "cnbc-top",
    name: "CNBC Top News",
    url: "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    category: "markets",
    weight: 1.0,
  },
  {
    id: "cnbc-tech",
    name: "CNBC Technology",
    url: "https://www.cnbc.com/id/19854910/device/rss/rss.html",
    category: "technology",
    weight: 1.0,
  },
  {
    id: "marketwatch-top",
    name: "MarketWatch Top Stories",
    url: "https://feeds.content.dowjones.io/public/rss/mw_topstories",
    category: "markets",
    weight: 0.9,
  },
  {
    id: "the-verge",
    name: "The Verge",
    url: "https://www.theverge.com/rss/index.xml",
    category: "technology",
    weight: 0.75,
  },
  {
    id: "techcrunch-ai",
    name: "TechCrunch AI",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
    category: "ai",
    weight: 0.8,
  },
];

function json(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

function isAuthorized(request: Request, env: Env): boolean {
  if (!env.CONTAINER_API_TOKEN) return true;
  const header = request.headers.get("authorization") || "";
  return header === `Bearer ${env.CONTAINER_API_TOKEN}`;
}

function requireAuthorized(request: Request, env: Env): Response | null {
  return isAuthorized(request, env) ? null : json({ error: "Unauthorized" }, { status: 401 });
}

function cloneForContainer(request: Request, path: string): Request {
  const sourceUrl = new URL(request.url);
  const target = new URL(sourceUrl);
  target.pathname = path;
  return new Request(target.toString(), request);
}

function containerEnv(env: Env): Record<string, string> {
  return {
    CODEX_HOME: "/home/codex/.codex",
    CODEX_RESEARCH_MODEL: env.CODEX_RESEARCH_MODEL || "gpt-5.5",
    CODEX_AUTH_JSON: env.CODEX_AUTH_JSON || "",
    OPENAI_API_KEY: env.OPENAI_API_KEY || "",
    CODEX_ACCESS_TOKEN: env.CODEX_ACCESS_TOKEN || "",
  };
}

async function startWithSecrets(container: any, env: Env): Promise<void> {
  await container.startAndWaitForPorts(undefined, undefined, {
    envVars: containerEnv(env),
  });
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function tagValue(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : null;
}

function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function parseFeed(xml: string, source: Source): FeedItem[] {
  const blocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) || [];
  return blocks
    .map((block) => {
      const title = tagValue(block, "title") || "";
      const linkTag = tagValue(block, "link");
      const hrefMatch = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
      const url = linkTag || (hrefMatch ? decodeXml(hrefMatch[1]) : "");
      const summary = tagValue(block, "description") || tagValue(block, "summary") || tagValue(block, "content:encoded");
      const publishedAt = normalizeDate(tagValue(block, "pubDate") || tagValue(block, "published") || tagValue(block, "updated"));
      return { source, title, url, summary, publishedAt };
    })
    .filter((item) => item.title && item.url)
    .slice(0, 15);
}

async function hashText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function seedSources(db: D1Database): Promise<void> {
  const statements = SOURCES.map((source) =>
    db
      .prepare(
        "INSERT INTO sources (id, name, url, category, weight, enabled) VALUES (?, ?, ?, ?, ?, 1) " +
          "ON CONFLICT(id) DO UPDATE SET name = excluded.name, url = excluded.url, category = excluded.category, weight = excluded.weight, enabled = 1",
      )
      .bind(source.id, source.name, source.url, source.category, source.weight),
  );
  if (statements.length) await db.batch(statements);
}

async function fetchSource(source: Source): Promise<{ source: string; count: number; error?: string; items: FeedItem[] }> {
  try {
    const response = await fetch(source.url, {
      headers: {
        "user-agent": "cartdotcom-news-signal-mvp/0.1",
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      },
    });
    if (!response.ok) {
      return { source: source.id, count: 0, error: `HTTP ${response.status}`, items: [] };
    }
    const xml = await response.text();
    const items = parseFeed(xml, source);
    return { source: source.id, count: items.length, items };
  } catch (error) {
    return { source: source.id, count: 0, error: error instanceof Error ? error.message : String(error), items: [] };
  }
}

async function enqueueArticle(db: D1Database, queue: Queue<ResearchJobMessage>, item: FeedItem): Promise<boolean> {
  const articleId = await hashText(item.url);
  const contentHash = await hashText(`${item.title}\n${item.summary || ""}`);
  const inserted = await db
    .prepare(
      "INSERT OR IGNORE INTO articles (id, source_id, title, url, summary, published_at, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(articleId, item.source.id, item.title, item.url, item.summary, item.publishedAt, contentHash)
    .run();

  if (!inserted.meta?.changes) return false;

  const jobId = crypto.randomUUID();
  await db.prepare("INSERT OR IGNORE INTO research_jobs (id, article_id, status) VALUES (?, ?, 'pending')").bind(jobId, articleId).run();
  await queue.send({ jobId });
  return true;
}

async function ingestFeeds(env: Env): Promise<{ fetched: unknown[]; inserted: number }> {
  await seedSources(env.NEWS_DB);
  const fetched = await Promise.all(SOURCES.map(fetchSource));
  let inserted = 0;
  for (const result of fetched) {
    for (const item of result.items) {
      if (await enqueueArticle(env.NEWS_DB, env.RESEARCH_QUEUE, item)) inserted += 1;
    }
  }
  return {
    fetched: fetched.map(({ items: _items, ...rest }) => rest),
    inserted,
  };
}

function researchPrompt(article: Article): string {
  return `You are building a rapid news analysis database for market perception, not trading advice.

Analyze this news item and compare it to similar historical events from your knowledge. Focus on how the item could shape investor/public perception of companies, sectors, and supply chains.

Return a JSON object followed by a concise memo. The JSON object must have these fields:
event_type, companies, industries, symbols, sentiment_score, impact_horizon, confidence, summary.

Article:
Title: ${article.title}
URL: ${article.url}
Published: ${article.published_at || "unknown"}
Summary: ${article.summary || "none"}

Rules:
- sentiment_score is from -1 to 1 for perceived market impact.
- impact_horizon is one of immediate, short, medium, long, unknown.
- confidence is from 0 to 1.
- If symbols are uncertain, include likely public tickers only and explain uncertainty in the memo.
- Mention comparable historical events or patterns when useful.`;
}

function parseResearchFields(memo: string): ResearchResultFields {
  const match = memo.match(/\{[\s\S]*?\}/);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[0]) as ResearchResultFields;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function runContainerResearch(env: Env, prompt: string): Promise<string> {
  const container = getContainer(env.CODEX_CONTAINER, "research-worker");
  await startWithSecrets(container, env);
  const response = await container.fetch(
    new Request("https://container.local/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, timeout_seconds: 900 }),
    }),
  );
  const payload = (await response.json()) as { ok?: boolean; memo?: string; error?: string };
  if (!response.ok || !payload.ok || !payload.memo) {
    throw new Error(payload.error || `Container research failed with HTTP ${response.status}`);
  }
  return payload.memo;
}

async function processJob(env: Env, jobId: string): Promise<{ ok: boolean; jobId: string; skipped?: string }> {
  const existing = await env.NEWS_DB.prepare("SELECT status FROM research_jobs WHERE id = ?").bind(jobId).first<{ status: string }>();
  if (!existing) return { ok: false, jobId, skipped: "missing" };
  if (existing.status === "succeeded" || existing.status === "running") return { ok: true, jobId, skipped: existing.status };

  await env.NEWS_DB.prepare("UPDATE research_jobs SET status = 'running', attempts = attempts + 1, started_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(jobId)
    .run();

  const article = await env.NEWS_DB.prepare(
    "SELECT id, source_id, title, url, summary, published_at, discovered_at FROM articles WHERE id = (SELECT article_id FROM research_jobs WHERE id = ?)",
  )
    .bind(jobId)
    .first<Article>();

  if (!article) {
    await env.NEWS_DB.prepare(
      "UPDATE research_jobs SET status = 'failed', last_error = 'Article not found', finished_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
      .bind(jobId)
      .run();
    return { ok: false, jobId, skipped: "article_missing" };
  }

  try {
    const memo = await runContainerResearch(env, researchPrompt(article));
    const fields = parseResearchFields(memo);
    await env.NEWS_DB.batch([
      env.NEWS_DB.prepare(
        "INSERT INTO research_results (id, job_id, article_id, event_type, companies, industries, symbols, sentiment_score, impact_horizon, confidence, summary, memo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        crypto.randomUUID(),
        jobId,
        article.id,
        fields.event_type || null,
        JSON.stringify(fields.companies || []),
        JSON.stringify(fields.industries || []),
        JSON.stringify(fields.symbols || []),
        typeof fields.sentiment_score === "number" ? fields.sentiment_score : null,
        fields.impact_horizon || null,
        typeof fields.confidence === "number" ? fields.confidence : null,
        fields.summary || null,
        memo,
      ),
      env.NEWS_DB.prepare("UPDATE research_jobs SET status = 'succeeded', finished_at = CURRENT_TIMESTAMP WHERE id = ?").bind(jobId),
      env.NEWS_DB.prepare("UPDATE articles SET status = 'analyzed' WHERE id = ?").bind(article.id),
    ]);
    return { ok: true, jobId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.NEWS_DB.prepare(
      "UPDATE research_jobs SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END, last_error = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
      .bind(message.slice(0, 1000), jobId)
      .run();
    throw error;
  }
}

async function processNextJob(env: Env): Promise<{ ok: boolean; jobId?: string; skipped?: string }> {
  const job = await env.NEWS_DB.prepare("SELECT id FROM research_jobs WHERE status = 'pending' ORDER BY queued_at ASC LIMIT 1").first<{
    id: string;
  }>();
  if (!job) return { ok: true, skipped: "no_pending_jobs" };
  return processJob(env, job.id);
}

async function listRows<T>(db: D1Database, query: string, limit: number): Promise<T[]> {
  const clamped = Math.min(Math.max(limit, 1), 100);
  const result = await db.prepare(query).bind(clamped).all<T>();
  return result.results || [];
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const unauthorized = requireAuthorized(request, env);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 25);

  if (url.pathname === "/api/status") {
    const [articles, jobs, results] = await Promise.all([
      env.NEWS_DB.prepare("SELECT status, COUNT(*) AS count FROM articles GROUP BY status").all(),
      env.NEWS_DB.prepare("SELECT status, COUNT(*) AS count FROM research_jobs GROUP BY status").all(),
      env.NEWS_DB.prepare("SELECT COUNT(*) AS count FROM research_results").first(),
    ]);
    return json({ ok: true, articles: articles.results, jobs: jobs.results, results });
  }

  if (url.pathname === "/api/sources") {
    await seedSources(env.NEWS_DB);
    return json({ ok: true, sources: await listRows(env.NEWS_DB, "SELECT * FROM sources ORDER BY weight DESC, name ASC LIMIT ?", limit) });
  }

  if (url.pathname === "/api/articles") {
    return json({
      ok: true,
      articles: await listRows(
        env.NEWS_DB,
        "SELECT articles.*, sources.name AS source_name FROM articles LEFT JOIN sources ON sources.id = articles.source_id ORDER BY discovered_at DESC LIMIT ?",
        limit,
      ),
    });
  }

  if (url.pathname === "/api/jobs") {
    return json({
      ok: true,
      jobs: await listRows(
        env.NEWS_DB,
        "SELECT research_jobs.*, articles.title, articles.url FROM research_jobs LEFT JOIN articles ON articles.id = research_jobs.article_id ORDER BY queued_at DESC LIMIT ?",
        limit,
      ),
    });
  }

  if (url.pathname === "/api/results") {
    return json({
      ok: true,
      results: await listRows(
        env.NEWS_DB,
        "SELECT research_results.*, articles.title, articles.url, sources.name AS source_name FROM research_results LEFT JOIN articles ON articles.id = research_results.article_id LEFT JOIN sources ON sources.id = articles.source_id ORDER BY research_results.created_at DESC LIMIT ?",
        limit,
      ),
    });
  }

  if (url.pathname === "/api/ingest" && request.method === "POST") {
    return json({ ok: true, ...(await ingestFeeds(env)) });
  }

  if (url.pathname === "/api/process-next" && request.method === "POST") {
    return json(await processNextJob(env));
  }

  return json({ error: "Not found" }, { status: 404 });
}

async function handleContainer(request: Request, env: Env): Promise<Response> {
  const unauthorized = requireAuthorized(request, env);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/container/, "") || "/health";
  const container = getContainer(env.CODEX_CONTAINER, "research-worker");

  if (path === "/restart" && request.method === "POST") {
    if (!env.CONTAINER_API_TOKEN) {
      return json({ error: "Restart requires CONTAINER_API_TOKEN" }, { status: 403 });
    }

    await container.destroy();
    await startWithSecrets(container, env);
    return json({ ok: true, state: await container.getState() });
  }

  await startWithSecrets(container, env);

  if (path === "/start" && request.method === "POST") {
    return json({ ok: true, state: await container.getState() });
  }

  return container.fetch(cloneForContainer(request, path));
}

export class CodexResearchContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = "15m";
  enableInternet = true;
  pingEndpoint = "health";

  envVars = {
    CODEX_HOME: "/home/codex/.codex",
  };

  override onStart() {
    console.log("Codex research container started");
  }

  override onStop(params: { exitCode?: number; reason?: string }) {
    console.log("Codex research container stopped", params);
  }

  override onError(error: unknown) {
    console.error("Codex research container failed", error);
    throw error;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        ok: true,
        service: "cartdotcom-news-signal-container",
        routes: [
          "/health",
          "/api/status",
          "/api/ingest",
          "/api/articles",
          "/api/jobs",
          "/api/results",
          "/container/health",
          "/container/mcp-check",
          "/container/research",
        ],
      });
    }

    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    if (url.pathname.startsWith("/container/")) return handleContainer(request, env);

    return json({ error: "Not found" }, { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(ingestFeeds(env));
  },

  async queue(batch: MessageBatch<ResearchJobMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      await processJob(env, message.body.jobId);
      message.ack();
    }
  },
};
