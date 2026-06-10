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

class ResearchBusyError extends Error {
  constructor() {
    super("Another research job is already running");
  }
}

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

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>News Signal Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --panel-soft: #f1f4f8;
      --text: #18202b;
      --muted: #667085;
      --line: #d9e0ea;
      --green: #097a55;
      --red: #b42318;
      --amber: #a15c07;
      --blue: #1457a8;
      --shadow: 0 1px 2px rgba(16, 24, 40, 0.06);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }

    button, input, select { font: inherit; }

    .shell {
      max-width: 1480px;
      margin: 0 auto;
      padding: 18px;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 0 18px;
      border-bottom: 1px solid var(--line);
    }

    h1 {
      margin: 0;
      font-size: 22px;
      line-height: 1.2;
      font-weight: 700;
    }

    .subhead {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 7px;
      color: var(--muted);
      font-size: 13px;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }

    .btn {
      min-height: 36px;
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--text);
      border-radius: 6px;
      padding: 0 12px;
      cursor: pointer;
      box-shadow: var(--shadow);
    }

    .btn.primary {
      border-color: #123c69;
      background: #123c69;
      color: white;
    }

    .btn:disabled { opacity: 0.55; cursor: not-allowed; }

    .tokenbar {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 8px;
      margin: 16px 0;
      align-items: center;
    }

    .tokenbar input {
      min-width: 0;
      height: 38px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0 11px;
      background: var(--panel);
      color: var(--text);
    }

    .grid {
      display: grid;
      gap: 14px;
    }

    .metrics {
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }

    .metric, .panel, .result {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }

    .metric {
      padding: 14px;
      min-height: 86px;
    }

    .metric .label {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .metric .value {
      margin-top: 8px;
      font-size: 28px;
      line-height: 1;
      font-weight: 750;
    }

    .metric .note {
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1.6fr) minmax(340px, 0.9fr);
      gap: 14px;
      margin-top: 14px;
      align-items: start;
    }

    .panel {
      overflow: hidden;
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      background: var(--panel-soft);
    }

    .panel-title {
      font-size: 14px;
      font-weight: 700;
    }

    .panel-meta {
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }

    .results {
      display: grid;
      gap: 10px;
      padding: 12px;
    }

    .result {
      padding: 13px;
    }

    .result-title {
      display: block;
      color: var(--text);
      font-weight: 700;
      line-height: 1.3;
      text-decoration: none;
    }

    .result-title:hover { text-decoration: underline; }

    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-top: 10px;
      align-items: center;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 3px 8px;
      border-radius: 999px;
      background: #eef2f6;
      color: #344054;
      font-size: 12px;
      line-height: 1.2;
      max-width: 100%;
    }

    .pill.green { background: #e6f4ee; color: var(--green); }
    .pill.red { background: #fdecec; color: var(--red); }
    .pill.amber { background: #fff2d6; color: var(--amber); }
    .pill.blue { background: #e8f1ff; color: var(--blue); }

    .summary {
      margin-top: 10px;
      color: #344054;
      font-size: 13px;
      line-height: 1.45;
    }

    details {
      margin-top: 10px;
      border-top: 1px solid var(--line);
      padding-top: 9px;
    }

    summary {
      cursor: pointer;
      color: var(--blue);
      font-size: 13px;
      font-weight: 650;
    }

    pre {
      margin: 10px 0 0;
      max-height: 340px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      color: #344054;
      font-size: 12px;
      line-height: 1.45;
      background: #f8fafc;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    th, td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
      font-size: 13px;
    }

    th {
      color: var(--muted);
      background: var(--panel-soft);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    td a {
      color: var(--text);
      font-weight: 650;
      text-decoration: none;
    }

    td a:hover { text-decoration: underline; }

    .truncate {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .empty, .error {
      padding: 18px;
      color: var(--muted);
      font-size: 13px;
    }

    .error { color: var(--red); }

    .split {
      display: grid;
      gap: 14px;
    }

    @media (max-width: 1050px) {
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .layout { grid-template-columns: 1fr; }
    }

    @media (max-width: 720px) {
      .shell { padding: 12px; }
      .topbar { align-items: stretch; flex-direction: column; }
      .actions { justify-content: flex-start; }
      .tokenbar { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: 1fr; }
      th:nth-child(3), td:nth-child(3) { display: none; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <h1>News Signal Dashboard</h1>
        <div class="subhead">
          <span id="last-updated">Not loaded</span>
          <span id="auth-state">Token not set</span>
        </div>
      </div>
      <div class="actions">
        <button class="btn" id="refresh-btn" type="button">Refresh</button>
        <button class="btn" id="ingest-btn" type="button">Ingest</button>
        <button class="btn primary" id="requeue-btn" type="button">Requeue</button>
      </div>
    </header>

    <section class="tokenbar">
      <input id="token-input" type="password" autocomplete="off" placeholder="Bearer token">
      <button class="btn" id="save-token-btn" type="button">Save Token</button>
      <button class="btn" id="clear-token-btn" type="button">Clear</button>
    </section>

    <section class="grid metrics" id="metrics"></section>

    <section class="layout">
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">Research Results</div>
          <div class="panel-meta" id="results-meta">0 rows</div>
        </div>
        <div class="results" id="results"></div>
      </div>

      <div class="split">
        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">Recent Jobs</div>
            <div class="panel-meta" id="jobs-meta">0 rows</div>
          </div>
          <div id="jobs"></div>
        </div>

        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">Recent Articles</div>
            <div class="panel-meta" id="articles-meta">0 rows</div>
          </div>
          <div id="articles"></div>
        </div>
      </div>
    </section>
  </main>

  <script>
    const tokenInput = document.getElementById("token-input");
    const authState = document.getElementById("auth-state");
    const lastUpdated = document.getElementById("last-updated");
    const metricsEl = document.getElementById("metrics");
    const resultsEl = document.getElementById("results");
    const jobsEl = document.getElementById("jobs");
    const articlesEl = document.getElementById("articles");
    const resultsMeta = document.getElementById("results-meta");
    const jobsMeta = document.getElementById("jobs-meta");
    const articlesMeta = document.getElementById("articles-meta");

    tokenInput.value = sessionStorage.getItem("newsSignalToken") || "";
    syncAuthState();

    document.getElementById("save-token-btn").addEventListener("click", () => {
      sessionStorage.setItem("newsSignalToken", tokenInput.value.trim());
      syncAuthState();
      loadAll();
    });

    document.getElementById("clear-token-btn").addEventListener("click", () => {
      sessionStorage.removeItem("newsSignalToken");
      tokenInput.value = "";
      syncAuthState();
    });

    document.getElementById("refresh-btn").addEventListener("click", loadAll);
    document.getElementById("ingest-btn").addEventListener("click", () => runAction("/api/ingest"));
    document.getElementById("requeue-btn").addEventListener("click", () => runAction("/api/requeue-pending?limit=10"));

    function syncAuthState() {
      authState.textContent = tokenInput.value.trim() ? "Token set" : "Token not set";
    }

    function headers() {
      const token = sessionStorage.getItem("newsSignalToken") || tokenInput.value.trim();
      return token ? { Authorization: "Bearer " + token } : {};
    }

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: { ...(options.headers || {}), ...headers() },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "HTTP " + response.status);
      return payload;
    }

    async function runAction(path) {
      setBusy(true);
      try {
        await api(path, { method: "POST" });
        await loadAll();
      } catch (error) {
        showError(metricsEl, error);
      } finally {
        setBusy(false);
      }
    }

    async function loadAll() {
      setBusy(true);
      try {
        const [status, results, jobs, articles] = await Promise.all([
          api("/api/status"),
          api("/api/results?limit=20"),
          api("/api/jobs?limit=12"),
          api("/api/articles?limit=12"),
        ]);
        renderMetrics(status);
        renderResults(results.results || []);
        renderJobs(jobs.jobs || []);
        renderArticles(articles.articles || []);
        lastUpdated.textContent = "Updated " + new Date().toLocaleTimeString();
      } catch (error) {
        showError(metricsEl, error);
        resultsEl.innerHTML = "";
        jobsEl.innerHTML = "";
        articlesEl.innerHTML = "";
      } finally {
        setBusy(false);
      }
    }

    function setBusy(isBusy) {
      for (const button of document.querySelectorAll("button")) button.disabled = isBusy;
    }

    function count(rows, status) {
      const row = (rows || []).find((item) => item.status === status);
      return row ? Number(row.count || 0) : 0;
    }

    function renderMetrics(status) {
      const analyzed = count(status.articles, "analyzed");
      const queued = count(status.articles, "queued");
      const pending = count(status.jobs, "pending");
      const running = count(status.jobs, "running");
      const succeeded = count(status.jobs, "succeeded");
      const failed = count(status.jobs, "failed");
      const results = Number((status.results && status.results.count) || 0);
      metricsEl.innerHTML = [
        metric("Articles", analyzed + queued, analyzed + " analyzed, " + queued + " queued"),
        metric("Results", results, succeeded + " succeeded"),
        metric("Running", running, "Serialized Codex jobs"),
        metric("Pending", pending, "Queued for research"),
        metric("Failed", failed, "Needs review"),
      ].join("");
    }

    function metric(label, value, note) {
      return '<div class="metric"><div class="label">' + escapeHtml(label) + '</div><div class="value">' + escapeHtml(String(value)) + '</div><div class="note">' + escapeHtml(note) + '</div></div>';
    }

    function renderResults(results) {
      resultsMeta.textContent = results.length + " rows";
      if (!results.length) {
        resultsEl.innerHTML = '<div class="empty">No research results yet.</div>';
        return;
      }
      resultsEl.innerHTML = results.map((item) => {
        const score = Number(item.sentiment_score || 0);
        const scoreClass = score > 0.1 ? "green" : score < -0.1 ? "red" : "amber";
        return '<article class="result">' +
          '<a class="result-title" href="' + escapeAttr(item.url || "#") + '" target="_blank" rel="noreferrer">' + escapeHtml(item.title || "Untitled") + '</a>' +
          '<div class="row">' +
            pill(item.source_name || "Source", "blue") +
            pill(item.event_type || "event_unknown", "") +
            pill("score " + formatNumber(score), scoreClass) +
            pill(item.impact_horizon || "unknown", "amber") +
            pill("conf " + formatNumber(item.confidence), "green") +
          '</div>' +
          '<p class="summary">' + escapeHtml(item.summary || "") + '</p>' +
          '<div class="row">' + renderArrayPills(item.symbols, "blue") + '</div>' +
          '<details><summary>Memo</summary><pre>' + escapeHtml(item.memo || "") + '</pre></details>' +
        '</article>';
      }).join("");
    }

    function renderJobs(jobs) {
      jobsMeta.textContent = jobs.length + " rows";
      if (!jobs.length) {
        jobsEl.innerHTML = '<div class="empty">No jobs.</div>';
        return;
      }
      jobsEl.innerHTML = table(["Status", "Attempts", "Article"], jobs.map((job) => [
        pill(job.status || "unknown", statusClass(job.status)),
        escapeHtml(String(job.attempts || 0)),
        '<a class="truncate" href="' + escapeAttr(job.url || "#") + '" target="_blank" rel="noreferrer">' + escapeHtml(job.title || job.article_id || "Article") + '</a>',
      ]));
    }

    function renderArticles(articles) {
      articlesMeta.textContent = articles.length + " rows";
      if (!articles.length) {
        articlesEl.innerHTML = '<div class="empty">No articles.</div>';
        return;
      }
      articlesEl.innerHTML = table(["Status", "Source", "Article"], articles.map((article) => [
        pill(article.status || "unknown", statusClass(article.status)),
        escapeHtml(article.source_name || article.source_id || ""),
        '<a class="truncate" href="' + escapeAttr(article.url || "#") + '" target="_blank" rel="noreferrer">' + escapeHtml(article.title || "Article") + '</a>',
      ]));
    }

    function table(headers, rows) {
      return '<table><thead><tr>' + headers.map((header) => '<th>' + escapeHtml(header) + '</th>').join("") + '</tr></thead><tbody>' +
        rows.map((row) => '<tr>' + row.map((cell) => '<td>' + cell + '</td>').join("") + '</tr>').join("") +
        '</tbody></table>';
    }

    function renderArrayPills(value, cls) {
      let parsed = [];
      try { parsed = Array.isArray(value) ? value : JSON.parse(value || "[]"); } catch { parsed = []; }
      return parsed.slice(0, 12).map((item) => pill(String(item), cls)).join("");
    }

    function pill(text, cls) {
      return '<span class="pill ' + escapeAttr(cls || "") + '">' + escapeHtml(text) + '</span>';
    }

    function statusClass(status) {
      if (status === "succeeded" || status === "analyzed") return "green";
      if (status === "failed") return "red";
      if (status === "running") return "blue";
      return "amber";
    }

    function formatNumber(value) {
      const number = Number(value);
      return Number.isFinite(number) ? number.toFixed(2) : "n/a";
    }

    function showError(target, error) {
      target.innerHTML = '<div class="error">' + escapeHtml(error.message || String(error)) + '</div>';
      lastUpdated.textContent = "Load failed";
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]);
    }

    function escapeAttr(value) {
      return escapeHtml(value).replace(/\\n/g, " ");
    }

    if (tokenInput.value.trim()) loadAll();
  </script>
</body>
</html>`;

function json(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

function html(payload: string, init: ResponseInit = {}): Response {
  return new Response(payload, {
    ...init,
    headers: {
      "content-type": "text/html; charset=utf-8",
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
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
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

Analyze this news item quickly. Focus on how it could shape investor/public perception of companies, sectors, and supply chains. Use the supplied article fields and your prior knowledge; do not do extended browsing unless the item is impossible to understand without it.

Return a JSON object followed by a concise memo under 350 words. The JSON object must have these fields:
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
      body: JSON.stringify({ prompt, timeout_seconds: 300 }),
    }),
  );
  const payload = (await response.json()) as { ok?: boolean; memo?: string; error?: string };
  if (!response.ok || !payload.ok || !payload.memo) {
    throw new Error(payload.error || `Container research failed with HTTP ${response.status}`);
  }
  return payload.memo;
}

async function processJob(env: Env, jobId: string): Promise<{ ok: boolean; jobId: string; skipped?: string }> {
  await env.NEWS_DB.prepare(
    "UPDATE research_jobs SET status = 'pending', last_error = 'Reset stale running job', finished_at = CURRENT_TIMESTAMP WHERE status = 'running' AND datetime(started_at) < datetime('now', '-20 minutes')",
  ).run();

  const existing = await env.NEWS_DB.prepare("SELECT status FROM research_jobs WHERE id = ?").bind(jobId).first<{ status: string }>();
  if (!existing) return { ok: false, jobId, skipped: "missing" };
  if (existing.status === "succeeded") return { ok: true, jobId, skipped: existing.status };
  if (existing.status === "running") throw new ResearchBusyError();

  const acquired = await env.NEWS_DB.prepare(
    "UPDATE research_jobs SET status = 'running', attempts = attempts + 1, last_error = NULL, started_at = CURRENT_TIMESTAMP, finished_at = NULL WHERE id = ? AND status = 'pending' AND NOT EXISTS (SELECT 1 FROM research_jobs WHERE status = 'running')",
  )
    .bind(jobId)
    .run();
  if (!acquired.meta?.changes) throw new ResearchBusyError();

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
      env.NEWS_DB.prepare("UPDATE research_jobs SET status = 'succeeded', last_error = NULL, finished_at = CURRENT_TIMESTAMP WHERE id = ?").bind(jobId),
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

async function requeuePendingJobs(env: Env, limit = 25): Promise<{ requeued: number }> {
  const clamped = Math.min(Math.max(limit, 1), 100);
  const pending = await env.NEWS_DB.prepare("SELECT id FROM research_jobs WHERE status = 'pending' ORDER BY queued_at ASC LIMIT ?")
    .bind(clamped)
    .all<{ id: string }>();

  for (const job of pending.results || []) {
    await env.RESEARCH_QUEUE.send({ jobId: job.id });
  }

  return { requeued: pending.results?.length || 0 };
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

  if (url.pathname === "/api/requeue-pending" && request.method === "POST") {
    return json({ ok: true, ...(await requeuePendingJobs(env, limit)) });
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

    if (url.pathname === "/" || url.pathname === "/dashboard") {
      return html(DASHBOARD_HTML);
    }

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "cartdotcom-news-signal-container",
        routes: [
          "/dashboard",
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
    ctx.waitUntil(
      ingestFeeds(env).then(async () => {
        await requeuePendingJobs(env, 25);
      }),
    );
  },

  async queue(batch: MessageBatch<ResearchJobMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processJob(env, message.body.jobId);
        message.ack();
      } catch (error) {
        if (error instanceof ResearchBusyError) {
          message.retry({ delaySeconds: 120 });
          continue;
        }
        throw error;
      }
    }
  },
};
