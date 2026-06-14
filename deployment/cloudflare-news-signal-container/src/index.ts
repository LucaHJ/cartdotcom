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
  event_title?: string;
  event_type?: string;
  companies?: string[];
  industries?: string[];
  symbols?: string[];
  impact_details?: ImpactDetail[];
  sentiment_score?: number;
  impact_horizon?: string;
  confidence?: number;
  summary?: string;
  event_blurb?: string;
};

type ImpactDetail = {
  kind?: "company" | "industry" | "supply_chain" | "market";
  name?: string;
  symbol?: string | null;
  direction?: "bullish" | "bearish" | "mixed" | "neutral";
  confidence?: number;
  reason?: string;
};

type ResearchResultRow = {
  id: string;
  article_id: string;
  title: string;
  url: string;
  published_at: string | null;
  created_at: string;
  symbols: string | null;
  sentiment_score: number | null;
  confidence: number | null;
  event_type: string | null;
  summary: string | null;
  memo: string | null;
};

type PricePoint = {
  at: string;
  price: number | null;
  change_pct: number | null;
};

type PriceImpact = {
  article_id: string;
  title: string;
  url: string;
  published_at: string | null;
  sentiment_score: number | null;
  confidence: number | null;
  symbol: string;
  company: string | null;
  direction: string | null;
  rationale: string | null;
  baseline_price: number | null;
  baseline_at: string | null;
  intervals: Record<string, PricePoint>;
};

type TickerSignal = {
  symbol: string;
  score: number;
  confidence: number;
  article_count: number;
  latest_published_at: string | null;
  impacts: PriceImpact[];
};

type SimulationTrade = {
  action: "BUY" | "SELL";
  symbol: string;
  article_title: string;
  article_url: string;
  event_type: string | null;
  sentiment_score: number;
  confidence: number;
  price: number;
  shares: number;
  notional: number;
  cash_after: number;
  portfolio_value: number;
  action_at: string;
};

type SimulationPoint = {
  at: string;
  value: number;
  cash: number;
  investments: number;
};

type SimulationStateRow = {
  id: string;
  starting_cash: number;
  cash: number;
  created_at: string;
  updated_at: string;
};

type SimulationPositionRow = {
  symbol: string;
  shares: number;
  average_price: number;
  last_action_at: string | null;
  last_buy_at: string | null;
  updated_at: string;
};

type EodReportRow = {
  id: string;
  report_date: string;
  summary: string;
  candidates_json: string;
  chosen_json: string;
  created_at: string;
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

    .tabs {
      display: flex;
      gap: 8px;
      margin: 12px 0 14px;
      border-bottom: 1px solid var(--line);
    }

    .tab {
      border: 0;
      border-bottom: 3px solid transparent;
      background: transparent;
      color: var(--muted);
      padding: 11px 8px 9px;
      cursor: pointer;
      font-weight: 700;
    }

    .tab.active {
      color: var(--text);
      border-bottom-color: #123c69;
    }

    .subtabs {
      display: flex;
      gap: 8px;
      margin: 0 0 14px;
    }

    .subtab {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--muted);
      padding: 7px 10px;
      cursor: pointer;
      font-weight: 700;
    }

    .subtab.active {
      color: var(--text);
      border-color: #123c69;
      background: #e8f1ff;
    }

    .model-blurb {
      padding: 12px 18px 0;
      color: #344054;
      font-size: 13px;
      line-height: 1.45;
    }

    .report-select {
      margin: 0 18px 14px;
      max-width: 520px;
      width: calc(100% - 36px);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px 10px;
      background: #fff;
    }

    .report-box {
      margin: 0 18px 16px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: #fbfcfe;
    }

    .hidden { display: none; }

    .portfolio-head {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 12px;
      padding: 18px;
    }

    .portfolio-value {
      font-size: 38px;
      line-height: 1;
      font-weight: 800;
    }

    .portfolio-move {
      font-size: 16px;
      font-weight: 750;
    }

    .portfolio-breakdown {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 0 18px 14px;
    }

    .rangebar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 0 18px 12px;
    }

    .range-btn {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--muted);
      padding: 5px 8px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 700;
    }

    .range-btn.active {
      color: var(--text);
      border-color: #123c69;
      background: #e8f1ff;
    }

    .chart {
      width: 100%;
      height: 260px;
      padding: 0 18px 18px;
    }

    .chart svg {
      width: 100%;
      height: 100%;
      display: block;
      background: #fbfcfe;
      border: 1px solid var(--line);
      border-radius: 8px;
    }

    .impact-wrap {
      padding: 12px;
      overflow-x: auto;
    }

    .impact-table th,
    .impact-table td {
      white-space: nowrap;
    }

    .pill[title] { cursor: help; }

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
        <button class="btn primary" id="settings-btn" type="button">Settings</button>
      </div>
    </header>

    <section class="tokenbar">
      <input id="token-input" type="password" autocomplete="off" placeholder="Bearer token">
      <button class="btn" id="save-token-btn" type="button">Save Token</button>
      <button class="btn" id="clear-token-btn" type="button">Clear</button>
    </section>

    <section class="grid metrics" id="metrics"></section>

    <nav class="tabs" aria-label="Dashboard sections">
      <button class="tab active" id="overview-tab" type="button">Overview</button>
      <button class="tab" id="simulation-tab" type="button">Simulation</button>
    </nav>

    <section id="overview-panel">
      <section class="panel">
        <div class="panel-header">
          <div class="panel-title">Event Summaries</div>
          <div class="panel-meta" id="results-meta">0 rows</div>
        </div>
        <div class="results" id="results"></div>
      </section>
    </section>

    <section id="settings-panel" class="hidden">
      <section class="panel" style="margin-top:14px">
        <div class="panel-header">
          <div class="panel-title">Recent Jobs</div>
          <div class="panel-meta" id="jobs-meta">0 rows</div>
        </div>
        <div id="jobs"></div>
        <div class="row">
          <button class="btn" id="requeue-btn" type="button">Requeue Pending</button>
        </div>
      </section>

      <section class="panel" style="margin-top:14px">
        <div class="panel-header">
          <div class="panel-title">Article Impacts</div>
          <div class="panel-meta" id="articles-meta">0 rows</div>
        </div>
        <div id="articles"></div>
      </section>
    </section>

    <section id="simulation-panel" class="hidden">
      <div class="subtabs" aria-label="Simulation models">
        <button class="subtab active" id="live-model-tab" type="button">Live Trade</button>
        <button class="subtab" id="eod-model-tab" type="button">EOD</button>
      </div>

      <section id="live-model-panel">
        <section class="panel">
          <div class="model-blurb">Live Trade acts article-by-article as analysis completes. It sizes buys and sells from article score and confidence, enforces a 12 hour gap between actions for the same ticker, avoids repeated adds unless signals are strong, and uses a 3 day minimum hold unless a highly confident bearish signal appears.</div>
          <div class="portfolio-head">
            <div class="portfolio-value" id="portfolio-value">$0</div>
            <div class="portfolio-move" id="portfolio-move">0.00%</div>
          </div>
          <div class="portfolio-breakdown">
            <span class="pill blue" id="portfolio-cash">Cash $0</span>
            <span class="pill green" id="portfolio-investments">Investments $0</span>
          </div>
          <div class="rangebar" id="portfolio-rangebar"></div>
          <div class="chart" id="portfolio-chart"></div>
        </section>

        <section class="panel" style="margin-top:14px">
          <div class="panel-header">
            <div class="panel-title">Live Trade Actions</div>
            <div class="panel-meta" id="trades-meta">0 rows</div>
          </div>
          <div id="trades"></div>
        </section>
      </section>

      <section id="eod-model-panel" class="hidden">
        <section class="panel">
          <div class="model-blurb">EOD waits for the end of the US market day, compiles that day&apos;s analyzed events into a report, ranks ticker movements by confidence-weighted score, and acts only on the 10 strongest candidates in a separate paper account. It is slower and more selective than Live Trade, but can miss intraday moves and currently uses same-day article analysis rather than external overnight research.</div>
          <div class="portfolio-head">
            <div class="portfolio-value" id="eod-portfolio-value">$0</div>
            <div class="portfolio-move" id="eod-portfolio-move">0.00%</div>
          </div>
          <div class="portfolio-breakdown">
            <span class="pill blue" id="eod-portfolio-cash">Cash $0</span>
            <span class="pill green" id="eod-portfolio-investments">Investments $0</span>
          </div>
          <div class="chart" id="eod-portfolio-chart"></div>
          <select class="report-select" id="eod-report-select"></select>
          <div class="report-box" id="eod-report"></div>
        </section>

        <section class="panel" style="margin-top:14px">
          <div class="panel-header">
            <div class="panel-title">EOD Actions</div>
            <div class="panel-meta" id="eod-trades-meta">0 rows</div>
          </div>
          <div id="eod-trades"></div>
        </section>
      </section>
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
    const overviewTab = document.getElementById("overview-tab");
    const simulationTab = document.getElementById("simulation-tab");
    const settingsBtn = document.getElementById("settings-btn");
    const liveModelTab = document.getElementById("live-model-tab");
    const eodModelTab = document.getElementById("eod-model-tab");
    const overviewPanel = document.getElementById("overview-panel");
    const simulationPanel = document.getElementById("simulation-panel");
    const settingsPanel = document.getElementById("settings-panel");
    const liveModelPanel = document.getElementById("live-model-panel");
    const eodModelPanel = document.getElementById("eod-model-panel");
    const portfolioValueEl = document.getElementById("portfolio-value");
    const portfolioMoveEl = document.getElementById("portfolio-move");
    const portfolioCashEl = document.getElementById("portfolio-cash");
    const portfolioInvestmentsEl = document.getElementById("portfolio-investments");
    const portfolioRangebarEl = document.getElementById("portfolio-rangebar");
    const portfolioChartEl = document.getElementById("portfolio-chart");
    const tradesEl = document.getElementById("trades");
    const tradesMeta = document.getElementById("trades-meta");
    const eodPortfolioValueEl = document.getElementById("eod-portfolio-value");
    const eodPortfolioMoveEl = document.getElementById("eod-portfolio-move");
    const eodPortfolioCashEl = document.getElementById("eod-portfolio-cash");
    const eodPortfolioInvestmentsEl = document.getElementById("eod-portfolio-investments");
    const eodPortfolioChartEl = document.getElementById("eod-portfolio-chart");
    const eodReportSelectEl = document.getElementById("eod-report-select");
    const eodReportEl = document.getElementById("eod-report");
    const eodTradesEl = document.getElementById("eod-trades");
    const eodTradesMeta = document.getElementById("eod-trades-meta");
    let simulationLoaded = false;
    let eodSimulationLoaded = false;
    let activeSimulation = null;
    let activeChartRange = "all";
    const chartRanges = [
      { key: "all", label: "All", hours: null },
      { key: "12h", label: "12h", hours: 12 },
      { key: "24h", label: "24h", hours: 24 },
      { key: "1w", label: "1w", hours: 24 * 7 },
      { key: "2w", label: "2w", hours: 24 * 14 },
      { key: "1m", label: "1m", hours: 24 * 30 },
      { key: "6m", label: "6m", hours: 24 * 183 },
      { key: "1y", label: "1y", hours: 24 * 365 },
    ];

    const TOKEN_KEY = "newsSignalToken";
    const TOKEN_COOKIE = "news_signal_token";
    tokenInput.value = storedToken();
    persistToken(tokenInput.value);
    syncAuthState();

    document.getElementById("save-token-btn").addEventListener("click", () => {
      const token = tokenInput.value.trim();
      persistToken(token);
      simulationLoaded = false;
      eodSimulationLoaded = false;
      syncAuthState();
      loadAll();
      if (!simulationPanel.classList.contains("hidden")) loadSimulation();
      if (!eodModelPanel.classList.contains("hidden")) loadEodSimulation();
    });

    document.getElementById("clear-token-btn").addEventListener("click", () => {
      clearStoredToken();
      tokenInput.value = "";
      simulationLoaded = false;
      eodSimulationLoaded = false;
      syncAuthState();
    });

    document.getElementById("refresh-btn").addEventListener("click", loadAll);
    document.getElementById("ingest-btn").addEventListener("click", () => runAction("/api/ingest"));
    document.getElementById("requeue-btn").addEventListener("click", () => runAction("/api/requeue-pending?limit=10"));
    overviewTab.addEventListener("click", () => setTab("overview"));
    simulationTab.addEventListener("click", () => setTab("simulation"));
    settingsBtn.addEventListener("click", () => setTab("settings"));
    liveModelTab.addEventListener("click", () => setSimulationModel("live"));
    eodModelTab.addEventListener("click", () => setSimulationModel("eod"));
    renderRangeButtons();

    function setTab(tab) {
      const simulation = tab === "simulation";
      const settings = tab === "settings";
      overviewTab.classList.toggle("active", !simulation && !settings);
      simulationTab.classList.toggle("active", simulation);
      overviewPanel.classList.toggle("hidden", simulation || settings);
      simulationPanel.classList.toggle("hidden", !simulation);
      settingsPanel.classList.toggle("hidden", !settings);
      settingsBtn.classList.toggle("active", settings);
      if (simulation && !simulationLoaded) loadSimulation();
    }

    function setSimulationModel(model) {
      const eod = model === "eod";
      liveModelTab.classList.toggle("active", !eod);
      eodModelTab.classList.toggle("active", eod);
      liveModelPanel.classList.toggle("hidden", eod);
      eodModelPanel.classList.toggle("hidden", !eod);
      if (eod && !eodSimulationLoaded) loadEodSimulation();
      if (!eod && !simulationLoaded) loadSimulation();
    }

    function syncAuthState() {
      authState.textContent = tokenInput.value.trim() ? "Token set" : "Token not set";
    }

    function storedToken() {
      return localStorage.getItem(TOKEN_KEY) || cookieValue(TOKEN_COOKIE) || sessionStorage.getItem(TOKEN_KEY) || "";
    }

    function persistToken(token) {
      if (!token) return;
      localStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(TOKEN_KEY, token);
      document.cookie = TOKEN_COOKIE + "=" + encodeURIComponent(token) + "; Max-Age=31536000; Path=/; SameSite=Lax; Secure";
    }

    function clearStoredToken() {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      document.cookie = TOKEN_COOKIE + "=; Max-Age=0; Path=/; SameSite=Lax; Secure";
    }

    function cookieValue(name) {
      const prefix = name + "=";
      return document.cookie.split(";").map((value) => value.trim()).filter(Boolean).reduce((found, value) => {
        if (found) return found;
        return value.startsWith(prefix) ? decodeURIComponent(value.slice(prefix.length)) : "";
      }, "");
    }

    function headers() {
      const token = tokenInput.value.trim() || storedToken();
      return token ? { Authorization: "Bearer " + token } : {};
    }

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: { ...(options.headers || {}), ...headers() },
      });
      const payload = await response.json();
      if (!response.ok) {
        const message = response.status === 401
          ? "Unauthorized: paste the dashboard token and click Save token."
          : payload.error || "HTTP " + response.status;
        throw new Error(message);
      }
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
        const [status, results, jobs] = await Promise.all([
          api("/api/status"),
          api("/api/results?limit=20"),
          api("/api/jobs?limit=12"),
        ]);
        renderMetrics(status);
        renderResults(results.results || []);
        renderJobs(jobs.jobs || []);
        renderArticles(results.results || []);
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

    async function loadSimulation() {
      setBusy(true);
      try {
        const payload = await api("/api/simulation?limit=500");
        renderSimulation(payload.simulation);
        simulationLoaded = true;
      } catch (error) {
        showError(tradesEl, error);
      } finally {
        setBusy(false);
      }
    }

    async function loadEodSimulation() {
      setBusy(true);
      try {
        const payload = await api("/api/simulation/eod?limit=500");
        renderEodSimulation(payload.simulation);
        eodSimulationLoaded = true;
      } catch (error) {
        showError(eodTradesEl, error);
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
        resultsEl.innerHTML = '<div class="empty">No event summaries yet.</div>';
        return;
      }
      resultsEl.innerHTML = results.map((item) => {
        const parsed = parseMemoJson(item.memo || "");
        const eventTitle = parsed.event_title || item.event_type || item.title || "Untitled event";
        const blurb = parsed.event_blurb || item.summary || "";
        const impactDetails = normalizeImpactDetailsClient(parsed.impact_details);
        const score = Number(item.sentiment_score || 0);
        const scoreClass = score > 0.1 ? "green" : score < -0.1 ? "red" : "amber";
        const impactRows = impactDetails.length ? impactDetails.map((impact) => [
          pill(impact.kind || "impact", "blue", "Impact category identified by Codex after reasoning through the event's causal path."),
          escapeHtml(impact.name || impact.symbol || "Unknown"),
          escapeHtml(impact.symbol || "private/n/a"),
          pill(impact.direction || "unknown", directionClass(impact.direction), "Speculated stock value direction from this event: bullish, bearish, mixed, neutral, or unknown."),
          pill(formatNumber(impact.confidence), "green", "Confidence for this specific impacted entity, based on how direct and explicit the causal path is."),
          escapeHtml(impact.reason || ""),
        ]) : [[
          pill("legacy", "amber", "This older result predates structured impact rationales."),
          escapeHtml(parseArray(item.companies).join(", ") || "See memo"),
          escapeHtml(parseArray(item.symbols).join(", ") || "n/a"),
          pill(score > 0.1 ? "bullish" : score < -0.1 ? "bearish" : "mixed", scoreClass, "Legacy direction inferred from article-level score."),
          pill(formatNumber(item.confidence), "green", "Article-level confidence from the legacy analysis."),
          escapeHtml(item.summary || "Open memo for details."),
        ]];
        return '<article class="result">' +
          '<a class="result-title" href="' + escapeAttr(item.url || "#") + '" target="_blank" rel="noreferrer">' + escapeHtml(eventTitle) + '</a>' +
          '<div class="row">' +
            pill(item.source_name || "Source", "blue", "News source that originally published or syndicated this article.") +
            pill("published " + formatDate(item.published_at || item.created_at), "blue", "Article publication time used as the baseline for ticker price comparisons.") +
            pill(item.event_type || "event_unknown", "", "Codex-classified event category used to group comparable market perception events.") +
            pill("score " + formatNumber(score), scoreClass, "Sentiment score from -1 to 1 estimated by Codex from the article's expected public/investor perception impact; negative means bearish, positive means bullish.") +
            pill(item.impact_horizon || "unknown", "amber", "Expected duration of market perception impact: immediate, short, medium, long, or unknown.") +
            pill("conf " + formatNumber(item.confidence), "green", "Codex confidence from 0 to 1 based on source specificity, clarity of affected companies/sectors, and how directly the article maps to known market patterns.") +
          '</div>' +
          '<p class="summary">' + escapeHtml(blurb) + '</p>' +
          table(["Type", "Impacted", "Ticker", "Direction", "Conf", "Why"], impactRows) +
          renderPriceImpacts(item.price_impacts || []) +
          '<details><summary>Source article</summary><p class="summary"><a href="' + escapeAttr(item.url || "#") + '" target="_blank" rel="noreferrer">' + escapeHtml(item.title || "Article") + '</a></p></details>' +
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
        pill(job.status || "unknown", statusClass(job.status), "Current durable research job state in D1 and Cloudflare Queues."),
        escapeHtml(String(job.attempts || 0)),
        '<a class="truncate" href="' + escapeAttr(job.url || "#") + '" target="_blank" rel="noreferrer">' + escapeHtml(job.title || job.article_id || "Article") + '</a>',
      ]));
    }

    function renderArticles(results) {
      articlesMeta.textContent = results.length + " rows";
      if (!results.length) {
        articlesEl.innerHTML = '<div class="empty">No analyzed article impacts yet.</div>';
        return;
      }
      articlesEl.innerHTML = table(["Published", "Article", "Tickers", "Score", "Conf"], results.map((item) => [
        escapeHtml(formatDate(item.published_at || item.created_at)),
        '<a class="truncate" href="' + escapeAttr(item.url || "#") + '" target="_blank" rel="noreferrer">' + escapeHtml(item.title || "Article") + '</a>',
        renderImpactTickerPills(item),
        pill(formatNumber(item.sentiment_score), Number(item.sentiment_score || 0) > 0.1 ? "green" : Number(item.sentiment_score || 0) < -0.1 ? "red" : "amber", "Article-level perception score used by the simulation."),
        pill(formatNumber(item.confidence), "green", "Article-level confidence."),
      ]));
    }

    function renderSimulation(simulation) {
      activeSimulation = simulation;
      portfolioValueEl.textContent = formatMoney(simulation.current_value);
      portfolioCashEl.textContent = "Cash " + formatMoney(simulation.cash);
      portfolioCashEl.title = "Uninvested cash remaining in the simulated account.";
      portfolioInvestmentsEl.textContent = "Investments " + formatMoney(simulation.investment_value);
      portfolioInvestmentsEl.title = "Current market value of simulated stock positions.";
      renderFilteredChart();
      const trades = simulation.trades || [];
      tradesMeta.textContent = trades.length + " rows";
      if (!trades.length) {
        tradesEl.innerHTML = '<div class="empty">No simulated trades yet. Trades require analyzed articles with tickers, score magnitude above 0.15, and confidence above 0.35.</div>';
        return;
      }
      tradesEl.innerHTML = table(["Action", "Ticker", "Price", "Shares", "Notional", "Time", "Article"], trades.map((trade) => [
        pill(trade.action, trade.action === "BUY" ? "green" : "red", "The simulated action generated from sentiment score and confidence. Positive signals buy; negative signals sell existing holdings."),
        escapeHtml(trade.symbol),
        escapeHtml(formatMoney(trade.price)),
        escapeHtml(formatNumber(trade.shares)),
        escapeHtml(formatMoney(trade.notional)),
        escapeHtml(formatDate(trade.action_at)),
        '<a class="truncate" href="' + escapeAttr(trade.article_url || "#") + '" target="_blank" rel="noreferrer">' + escapeHtml(trade.article_title || "Article") + '</a>',
      ]));
    }

    function renderEodSimulation(simulation) {
      eodPortfolioValueEl.textContent = formatMoney(simulation.current_value);
      const move = Number(simulation.movement_pct || 0);
      eodPortfolioMoveEl.textContent = signedPct(move) + " all time";
      eodPortfolioMoveEl.style.color = move >= 0 ? "var(--green)" : "var(--red)";
      eodPortfolioCashEl.textContent = "Cash " + formatMoney(simulation.cash);
      eodPortfolioInvestmentsEl.textContent = "Investments " + formatMoney(simulation.investment_value);
      renderChart(simulation.points || [], eodPortfolioChartEl);

      const reports = simulation.reports || [];
      eodReportSelectEl.innerHTML = reports.length
        ? reports.map((report, index) => '<option value="' + index + '">' + escapeHtml(report.report_date + " - " + (report.chosen || []).length + " chosen") + '</option>').join("")
        : '<option value="">No EOD reports yet</option>';
      function showReport() {
        const report = reports[Number(eodReportSelectEl.value || 0)];
        if (!report) {
          eodReportEl.innerHTML = '<div class="empty">No EOD report has been generated yet. Reports are created once per day after the EOD window.</div>';
          return;
        }
        const chosen = report.chosen || [];
        eodReportEl.innerHTML = '<div class="summary"><strong>' + escapeHtml(report.report_date) + '</strong>: ' + escapeHtml(report.summary || "") + '</div>' +
          table(["Ticker", "Score", "Conf", "Events", "Thesis"], chosen.map((item) => [
            escapeHtml(item.symbol || ""),
            pill(formatNumber(item.score), Number(item.score || 0) > 0 ? "green" : "red", "EOD confidence-weighted score."),
            pill(formatNumber(item.confidence), "green", "EOD aggregate confidence."),
            escapeHtml(String(item.event_count || 0)),
            escapeHtml(item.thesis || ""),
          ]));
      }
      eodReportSelectEl.onchange = showReport;
      showReport();

      const trades = simulation.trades || [];
      eodTradesMeta.textContent = trades.length + " rows";
      if (!trades.length) {
        eodTradesEl.innerHTML = '<div class="empty">No EOD actions yet. The model waits for an end-of-day report and only acts on the 10 strongest confident movements.</div>';
        return;
      }
      eodTradesEl.innerHTML = table(["Action", "Ticker", "Price", "Shares", "Notional", "Time", "Thesis"], trades.map((trade) => [
        pill(trade.action, trade.action === "BUY" ? "green" : "red", "EOD model action from daily report."),
        escapeHtml(trade.symbol),
        escapeHtml(formatMoney(trade.price)),
        escapeHtml(formatNumber(trade.shares)),
        escapeHtml(formatMoney(trade.notional)),
        escapeHtml(formatDate(trade.action_at)),
        escapeHtml(trade.article_title || ""),
      ]));
    }

    function renderRangeButtons() {
      portfolioRangebarEl.innerHTML = chartRanges.map((range) =>
        '<button class="range-btn' + (range.key === activeChartRange ? " active" : "") + '" type="button" data-range="' + escapeAttr(range.key) + '">' + escapeHtml(range.label) + '</button>'
      ).join("");
      for (const button of portfolioRangebarEl.querySelectorAll("button")) {
        button.addEventListener("click", () => {
          activeChartRange = button.getAttribute("data-range") || "all";
          renderRangeButtons();
          renderFilteredChart();
        });
      }
    }

    function rangeFilteredPoints(points) {
      const clean = (points || []).filter((point) => Number.isFinite(Number(point.value)) && Number.isFinite(new Date(point.at).getTime()));
      const range = chartRanges.find((item) => item.key === activeChartRange);
      if (!range || !range.hours) return clean;
      const cutoff = Date.now() - range.hours * 60 * 60 * 1000;
      const filtered = clean.filter((point) => new Date(point.at).getTime() >= cutoff);
      return filtered.length >= 2 ? filtered : clean.slice(-Math.min(clean.length, 2));
    }

    function renderFilteredChart() {
      if (!activeSimulation) return;
      const points = rangeFilteredPoints(activeSimulation.points || []);
      const first = points[0];
      const last = points[points.length - 1];
      const move = first && last && Number(first.value) ? ((Number(last.value) - Number(first.value)) / Number(first.value)) * 100 : 0;
      const range = chartRanges.find((item) => item.key === activeChartRange);
      portfolioMoveEl.textContent = signedPct(move) + " " + ((range && range.key !== "all") ? "over " + range.label : "all time");
      portfolioMoveEl.style.color = move >= 0 ? "var(--green)" : "var(--red)";
      renderChart(points, portfolioChartEl);
    }

    function renderChart(points, targetEl = portfolioChartEl) {
      const clean = points.filter((point) => Number.isFinite(Number(point.value)));
      if (clean.length < 2) {
        targetEl.innerHTML = '<div class="empty">Not enough simulation points for a chart.</div>';
        return;
      }
      const width = 900;
      const height = 240;
      const pad = 34;
      const values = clean.flatMap((point) => [Number(point.value), Number(point.cash || 0), Number(point.investments || 0)]);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = max - min || 1;

      function makePath(key) {
        return clean.map((point, index) => {
          const x = pad + (index / (clean.length - 1)) * (width - pad * 2);
          const y = height - pad - ((Number(point[key] || 0) - min) / span) * (height - pad * 2);
          return (index === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2);
        }).join(" ");
      }

      const slices = clean.filter((_, index) => index === 0 || index === clean.length - 1 || index % Math.max(1, Math.floor(clean.length / 5)) === 0).map((point, index) => {
        const originalIndex = clean.indexOf(point);
        const x = pad + (originalIndex / (clean.length - 1)) * (width - pad * 2);
        const labelY = index % 2 === 0 ? height - 8 : height - 20;
        const label = formatShortDate(point.at);
        return '<line x1="' + x.toFixed(2) + '" y1="' + pad + '" x2="' + x.toFixed(2) + '" y2="' + (height - pad) + '" stroke="#d9e0ea"></line>' +
          '<text x="' + x.toFixed(2) + '" y="' + labelY + '" fill="#667085" font-size="10" text-anchor="' + (originalIndex === 0 ? "start" : originalIndex === clean.length - 1 ? "end" : "middle") + '">' + escapeHtml(label) + '</text>';
      }).join(" ");

      targetEl.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Portfolio value movement">' +
        slices +
        '<path d="' + makePath("value") + '" fill="none" stroke="#123c69" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>' +
        '<path d="' + makePath("cash") + '" fill="none" stroke="#1457a8" stroke-width="2" stroke-dasharray="6 5" stroke-linecap="round" stroke-linejoin="round"></path>' +
        '<path d="' + makePath("investments") + '" fill="none" stroke="#097a55" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>' +
        '<text x="' + (width - 190) + '" y="22" fill="#123c69" font-size="12">Total</text>' +
        '<text x="' + (width - 135) + '" y="22" fill="#1457a8" font-size="12">Cash</text>' +
        '<text x="' + (width - 88) + '" y="22" fill="#097a55" font-size="12">Invested</text>' +
      '</svg>';
    }

    function table(headers, rows) {
      return '<table><thead><tr>' + headers.map((header) => '<th>' + escapeHtml(header) + '</th>').join("") + '</tr></thead><tbody>' +
        rows.map((row) => '<tr>' + row.map((cell) => '<td>' + cell + '</td>').join("") + '</tr>').join("") +
        '</tbody></table>';
    }

    function renderPriceImpacts(impacts) {
      if (!impacts || !impacts.length) return '<div class="summary">No ticker price history is available for this event yet.</div>';
      const rows = impacts.map((impact) => [
        escapeHtml(impact.symbol || ""),
        escapeHtml(impact.company || ""),
        priceCell(impact.baseline_price, impact.baseline_at, "Closest available release-time baseline price."),
        impactPill(impact.intervals && impact.intervals["1h"], "1h"),
        impactPill(impact.intervals && impact.intervals["6h"], "6h"),
        impactPill(impact.intervals && impact.intervals["12h"], "12h"),
        impactPill(impact.intervals && impact.intervals["1d"], "1d"),
      ]);
      return '<details open><summary>Ticker price movement from publication</summary>' +
        table(["Ticker", "Company", "Release", "1h", "6h", "12h", "1d"], rows) +
      '</details>';
    }

    function renderImpactTickerPills(item) {
      const impacts = item.price_impacts || [];
      if (impacts.length) {
        return impacts.slice(0, 8).map((impact) => {
          const detail = [impact.company, impact.direction, impact.rationale].filter(Boolean).join(" - ");
          return pill(impact.symbol || "n/a", directionClass(impact.direction), detail || "Ticker with a stored article price impact.");
        }).join("");
      }
      const parsed = parseMemoJson(item.memo || "");
      return normalizeImpactDetailsClient(parsed.impact_details)
        .filter((impact) => impact.symbol)
        .slice(0, 8)
        .map((impact) => pill(impact.symbol, directionClass(impact.direction), impact.reason || "Impacted ticker."))
        .join("") || renderArrayPills(item.symbols, "blue", "Legacy ticker identified by the older article analysis.");
    }

    function renderArrayPills(value, cls, hint) {
      let parsed = [];
      try { parsed = Array.isArray(value) ? value : JSON.parse(value || "[]"); } catch { parsed = []; }
      return parsed.slice(0, 12).map((item) => pill(String(item), cls, hint)).join("");
    }

    function parseArray(value) {
      try {
        const parsed = Array.isArray(value) ? value : JSON.parse(value || "[]");
        return Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        return [];
      }
    }

    function parseMemoJson(value) {
      const text = String(value || "");
      const start = text.indexOf("{");
      if (start < 0) return {};
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (char === "\\\\") escaped = true;
          else if (char === '"') inString = false;
          continue;
        }
        if (char === '"') inString = true;
        else if (char === "{") depth += 1;
        else if (char === "}") {
          depth -= 1;
          if (depth === 0) {
            try { return JSON.parse(text.slice(start, index + 1)); } catch { return {}; }
          }
        }
      }
      return {};
    }

    function normalizeImpactDetailsClient(value) {
      if (!Array.isArray(value)) return [];
      return value.filter((item) => item && typeof item === "object").map((item) => ({
        kind: String(item.kind || ""),
        name: String(item.name || ""),
        symbol: item.symbol ? String(item.symbol).toUpperCase() : "",
        direction: String(item.direction || ""),
        confidence: item.confidence,
        reason: String(item.reason || ""),
      })).filter((item) => item.name || item.symbol || item.reason);
    }

    function pill(text, cls, hint = "") {
      return '<span class="pill ' + escapeAttr(cls || "") + '" title="' + escapeAttr(hint) + '">' + escapeHtml(text) + '</span>';
    }

    function priceCell(price, at, hint) {
      const title = [hint, at ? "Sampled: " + formatDate(at) : ""].filter(Boolean).join(" ");
      return '<span title="' + escapeAttr(title) + '">' + escapeHtml(formatMoney(price)) + '</span>';
    }

    function impactPill(point, label) {
      if (!point || point.change_pct === null || point.change_pct === undefined) {
        return pill("n/a", "", "No market price at or after the " + label + " post-publication target is available yet.");
      }
      const value = Number(point.change_pct);
      const cls = value > 0 ? "green" : value < 0 ? "red" : "amber";
      return pill(
        formatMoney(point.price) + " " + signedPct(value),
        cls,
        "Price sampled at " + formatDate(point.at) + ". Change at " + label + " after publication versus the closest available market price at article publication time.",
      );
    }

    function statusClass(status) {
      if (status === "succeeded" || status === "analyzed") return "green";
      if (status === "failed") return "red";
      if (status === "running") return "blue";
      return "amber";
    }

    function directionClass(direction) {
      if (direction === "bullish") return "green";
      if (direction === "bearish") return "red";
      if (direction === "mixed") return "amber";
      return "";
    }

    function formatNumber(value) {
      const number = Number(value);
      return Number.isFinite(number) ? number.toFixed(2) : "n/a";
    }

    function formatDate(value) {
      if (!value) return "unknown";
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value);
    }

    function formatShortDate(value) {
      if (!value) return "";
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return String(value);
      return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    }

    function formatMoney(value) {
      const number = Number(value);
      return Number.isFinite(number) ? number.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }) : "n/a";
    }

    function signedPct(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return "n/a";
      return (number >= 0 ? "+" : "") + number.toFixed(2) + "%";
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
event_title, event_type, event_blurb, impact_details, companies, industries, symbols, sentiment_score, impact_horizon, confidence, summary.

impact_details must be an array of objects with:
kind, name, symbol, direction, confidence, reason.

Use these logical steps before choosing symbols:
1. Identify the concrete event, not just the article topic.
2. Identify direct actors named in the event.
3. Identify customers, suppliers, competitors, substitutes, and platform owners only when the article creates a specific economic or perception link.
4. Exclude broad peers or famous related companies unless the article gives a clear causal path.
5. For each included public ticker, write the causal path in reason.
6. If the article is about Apple, xAI, OpenAI, or another company, do not include GOOGL/GOOG unless Google/Alphabet is directly named or clearly affected as a competitor, supplier, customer, platform owner, or regulatory target.

Article:
Title: ${article.title}
URL: ${article.url}
Published: ${article.published_at || "unknown"}
Summary: ${article.summary || "none"}

Rules:
- sentiment_score is from -1 to 1 for perceived market impact.
- impact_horizon is one of immediate, short, medium, long, unknown.
- confidence is from 0 to 1.
- direction is one of bullish, bearish, mixed, neutral.
- symbols must include only public tickers from impact_details where symbol is not null and reason gives a concrete causal path.
- If a company is private, put symbol null.
- If symbols are uncertain, omit them or use null and explain uncertainty in the memo.
- Mention comparable historical events or patterns when useful.`;
}

function parseResearchFields(memo: string): ResearchResultFields {
  const jsonText = extractFirstJsonObject(memo);
  if (!jsonText) return {};
  try {
    const parsed = JSON.parse(jsonText) as ResearchResultFields;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function extractFirstJsonObject(value: string): string | null {
  const start = value.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  return null;
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
    const impactDetails = normalizeImpactDetails(fields.impact_details);
    const companies = impactDetails.length
      ? [...new Set(impactDetails.filter((item) => item.kind === "company" && item.name).map((item) => String(item.name)))]
      : fields.companies || [];
    const industries = impactDetails.length
      ? [...new Set(impactDetails.filter((item) => item.kind !== "company" && item.name).map((item) => String(item.name)))]
      : fields.industries || [];
    const symbols = impactDetails.length ? symbolsFromImpactDetails(impactDetails) : fields.symbols || [];
    await env.NEWS_DB.batch([
      env.NEWS_DB.prepare(
        "INSERT INTO research_results (id, job_id, article_id, event_type, companies, industries, symbols, sentiment_score, impact_horizon, confidence, summary, memo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(job_id) DO UPDATE SET event_type = excluded.event_type, companies = excluded.companies, industries = excluded.industries, symbols = excluded.symbols, sentiment_score = excluded.sentiment_score, impact_horizon = excluded.impact_horizon, confidence = excluded.confidence, summary = excluded.summary, memo = excluded.memo, created_at = CURRENT_TIMESTAMP",
      ).bind(
        crypto.randomUUID(),
        jobId,
        article.id,
        fields.event_type || null,
        JSON.stringify(companies),
        JSON.stringify(industries),
        JSON.stringify(symbols),
        typeof fields.sentiment_score === "number" ? fields.sentiment_score : null,
        fields.impact_horizon || null,
        typeof fields.confidence === "number" ? fields.confidence : null,
        fields.event_blurb || fields.summary || null,
        memo,
      ),
      env.NEWS_DB.prepare("UPDATE research_jobs SET status = 'succeeded', last_error = NULL, finished_at = CURRENT_TIMESTAMP WHERE id = ?").bind(jobId),
      env.NEWS_DB.prepare("UPDATE articles SET status = 'analyzed' WHERE id = ?").bind(article.id),
    ]);
    await processSimulationPending(env, 10).catch((error) => console.error("Simulation processing failed after research", error));
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

async function reanalyzeRecentJobs(env: Env, limit = 20): Promise<{ requeued: number }> {
  const clamped = Math.min(Math.max(limit, 1), 50);
  const jobs = await env.NEWS_DB.prepare(
    "SELECT research_jobs.id, research_jobs.article_id FROM research_jobs INNER JOIN articles ON articles.id = research_jobs.article_id WHERE research_jobs.status = 'succeeded' ORDER BY COALESCE(articles.published_at, articles.discovered_at) DESC LIMIT ?",
  )
    .bind(clamped)
    .all<{ id: string; article_id: string }>();

  for (const job of jobs.results || []) {
    await env.NEWS_DB.batch([
      env.NEWS_DB.prepare(
        "UPDATE research_jobs SET status = 'pending', attempts = 0, last_error = NULL, queued_at = CURRENT_TIMESTAMP, started_at = NULL, finished_at = NULL WHERE id = ?",
      ).bind(job.id),
      env.NEWS_DB.prepare("UPDATE articles SET status = 'queued' WHERE id = ?").bind(job.article_id),
      env.NEWS_DB.prepare("DELETE FROM price_impacts WHERE article_id = ?").bind(job.article_id),
    ]);
    await env.RESEARCH_QUEUE.send({ jobId: job.id });
  }

  return { requeued: jobs.results?.length || 0 };
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function normalizeImpactDetails(value: unknown): ImpactDetail[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      kind: typeof item.kind === "string" ? (item.kind as ImpactDetail["kind"]) : undefined,
      name: typeof item.name === "string" ? item.name.trim() : undefined,
      symbol: typeof item.symbol === "string" && item.symbol.trim() ? item.symbol.trim().toUpperCase() : null,
      direction: typeof item.direction === "string" ? (item.direction as ImpactDetail["direction"]) : undefined,
      confidence: typeof item.confidence === "number" ? item.confidence : undefined,
      reason: typeof item.reason === "string" ? item.reason.trim() : undefined,
    }))
    .filter((item) => Boolean(item.name || item.symbol || item.reason));
}

function symbolsFromImpactDetails(details: ImpactDetail[]): string[] {
  return [
    ...new Set(
      details
        .filter((item) => item.symbol && item.reason && item.direction !== "neutral")
        .map((item) => normalizeTicker(item.symbol || ""))
        .filter((symbol): symbol is string => Boolean(symbol)),
    ),
  ];
}

function impactDetailsFromMemo(memo: string | null | undefined): ImpactDetail[] {
  if (!memo) return [];
  return normalizeImpactDetails(parseResearchFields(memo).impact_details);
}

function impactDetailForSymbol(row: ResearchResultRow, symbol: string): ImpactDetail | null {
  const normalized = normalizeTicker(symbol);
  if (!normalized) return null;
  return impactDetailsFromMemo(row.memo).find((item) => normalizeTicker(item.symbol || "") === normalized && item.direction !== "neutral") || null;
}

function symbolsForResearchRow(row: ResearchResultRow): string[] {
  const structured = symbolsFromImpactDetails(impactDetailsFromMemo(row.memo));
  if (structured.length) return structured;
  return [...new Set(parseJsonArray(row.symbols).map(normalizeTicker).filter((symbol): symbol is string => Boolean(symbol)))];
}

function normalizeTicker(symbol: string): string | null {
  const normalized = symbol.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(normalized)) return null;
  if (["SPY", "QQQ", "IWM", "TLT", "XLE", "XLY", "XRT", "XHB", "KRE", "USO"].includes(normalized)) return normalized;
  return normalized;
}

function yahooSymbol(symbol: string): string {
  return symbol.replace(/\./g, "-");
}

function unixSeconds(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

function isoFromUnix(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function intervalTargets(publishedAt: string): Record<string, number> {
  const base = unixSeconds(publishedAt);
  return {
    "1h": base + 60 * 60,
    "6h": base + 6 * 60 * 60,
    "12h": base + 12 * 60 * 60,
    "1d": base + 24 * 60 * 60,
    "1w": base + 7 * 24 * 60 * 60,
    "1m": base + 30 * 24 * 60 * 60,
  };
}

function nearestPoint(
  timestamps: number[],
  closes: Array<number | null>,
  target: number,
  direction: "after" | "before" = "after",
  allowFallback = true,
): { at: number; price: number } | null {
  const candidates = timestamps
    .map((at, index) => ({ at, price: closes[index] }))
    .filter((point): point is { at: number; price: number } => typeof point.price === "number" && Number.isFinite(point.price));
  if (!candidates.length) return null;

  const filtered = direction === "after" ? candidates.filter((point) => point.at >= target) : candidates.filter((point) => point.at <= target);
  if (!filtered.length && !allowFallback) return null;
  const pool = filtered.length ? filtered : candidates;
  return pool.reduce((best, point) => (Math.abs(point.at - target) < Math.abs(best.at - target) ? point : best), pool[0]);
}

function nearestElapsedPoint(timestamps: number[], closes: Array<number | null>, target: number): { at: number; price: number } | null {
  const now = Math.floor(Date.now() / 1000);
  if (target > now) return null;

  const elapsedTarget = Math.min(target, now);
  const candidates = timestamps
    .map((at, index) => ({ at, price: closes[index] }))
    .filter((point): point is { at: number; price: number } => typeof point.price === "number" && Number.isFinite(point.price) && point.at <= now);
  if (!candidates.length) return null;

  const afterTarget = candidates.filter((point) => point.at >= elapsedTarget);
  if (!afterTarget.length) return null;
  return afterTarget.reduce((best, point) => (Math.abs(point.at - elapsedTarget) < Math.abs(best.at - elapsedTarget) ? point : best), afterTarget[0]);
}

async function fetchYahooChart(symbol: string, publishedAt: string): Promise<{ timestamps: number[]; closes: Array<number | null> }> {
  const published = unixSeconds(publishedAt);
  const now = Math.floor(Date.now() / 1000);
  const period1 = Math.max(0, published - 3 * 24 * 60 * 60);
  const period2 = Math.max(now, published + 32 * 24 * 60 * 60);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?period1=${period1}&period2=${period2}&interval=1h&includePrePost=true`;
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "cartdotcom-news-signal-mvp/0.1",
    },
  });
  if (!response.ok) throw new Error(`Yahoo chart HTTP ${response.status} for ${symbol}`);

  const payload = (await response.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
      error?: unknown;
    };
  };
  const result = payload.chart?.result?.[0];
  return {
    timestamps: result?.timestamp || [],
    closes: result?.indicators?.quote?.[0]?.close || [],
  };
}

async function computePriceImpact(article: ResearchResultRow, symbol: string, detail: ImpactDetail | null = null): Promise<PriceImpact> {
  const publishedAt = article.published_at || article.created_at;
  const chart = await fetchYahooChart(symbol, publishedAt);
  const baseline = nearestPoint(chart.timestamps, chart.closes, unixSeconds(publishedAt), "after");
  const intervals: Record<string, PricePoint> = {};

  for (const [label, target] of Object.entries(intervalTargets(publishedAt))) {
    const point = nearestElapsedPoint(chart.timestamps, chart.closes, target);
    intervals[label] = {
      at: point ? isoFromUnix(point.at) : isoFromUnix(target),
      price: point?.price ?? null,
      change_pct: point && baseline ? ((point.price - baseline.price) / baseline.price) * 100 : null,
    };
  }

  return {
    article_id: article.article_id,
    title: article.title,
    url: article.url,
    published_at: article.published_at,
    sentiment_score: article.sentiment_score,
    confidence: article.confidence,
    symbol,
    company: detail?.name || null,
    direction: detail?.direction || null,
    rationale: detail?.reason || null,
    baseline_price: baseline?.price ?? null,
    baseline_at: baseline ? isoFromUnix(baseline.at) : null,
    intervals,
  };
}

async function getRecentResearchRows(env: Env, limit: number): Promise<ResearchResultRow[]> {
  return listRows<ResearchResultRow>(
    env.NEWS_DB,
    "SELECT research_results.id, research_results.article_id, research_results.created_at, research_results.symbols, research_results.sentiment_score, research_results.confidence, research_results.event_type, research_results.summary, research_results.memo, articles.title, articles.url, articles.published_at FROM research_results LEFT JOIN articles ON articles.id = research_results.article_id ORDER BY research_results.created_at DESC LIMIT ?",
    limit,
  );
}

async function getCachedPriceImpact(env: Env, article: ResearchResultRow, symbol: string, detail: ImpactDetail | null = null): Promise<PriceImpact | null> {
  const cached = await env.NEWS_DB.prepare(
    "SELECT baseline_price, baseline_at, intervals_json FROM price_impacts WHERE article_id = ? AND symbol = ? AND datetime(updated_at) > datetime('now', '-6 hours')",
  )
    .bind(article.article_id, symbol)
    .first<{ baseline_price: number | null; baseline_at: string | null; intervals_json: string }>();
  if (!cached) return null;
  const intervals = JSON.parse(cached.intervals_json) as Record<string, PricePoint>;
  const now = Math.floor(Date.now() / 1000);
  for (const [label, target] of Object.entries(intervalTargets(article.published_at || article.created_at))) {
    const point = intervals[label];
    if (point?.price !== null && point?.price !== undefined && unixSeconds(point.at) < target && target <= now) {
      return null;
    }
  }

  return {
    article_id: article.article_id,
    title: article.title,
    url: article.url,
    published_at: article.published_at,
    sentiment_score: article.sentiment_score,
    confidence: article.confidence,
    symbol,
    company: detail?.name || null,
    direction: detail?.direction || null,
    rationale: detail?.reason || null,
    baseline_price: cached.baseline_price,
    baseline_at: cached.baseline_at,
    intervals,
  };
}

async function getPriceImpact(env: Env, article: ResearchResultRow, symbol: string, detail: ImpactDetail | null = null): Promise<PriceImpact | null> {
  const cached = await getCachedPriceImpact(env, article, symbol, detail);
  if (cached) return cached;

  try {
    const impact = await computePriceImpact(article, symbol, detail);
    await env.NEWS_DB.prepare(
      "INSERT INTO price_impacts (article_id, symbol, baseline_price, baseline_at, intervals_json, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(article_id, symbol) DO UPDATE SET baseline_price = excluded.baseline_price, baseline_at = excluded.baseline_at, intervals_json = excluded.intervals_json, updated_at = CURRENT_TIMESTAMP",
    )
      .bind(impact.article_id, impact.symbol, impact.baseline_price, impact.baseline_at, JSON.stringify(impact.intervals))
      .run();
    return impact;
  } catch {
    return null;
  }
}

async function buildMarketImpacts(env: Env, limit: number): Promise<PriceImpact[]> {
  const rows = await getRecentResearchRows(env, limit);
  const impacts: PriceImpact[] = [];

  for (const row of rows) {
    const symbols = symbolsForResearchRow(row).slice(0, 5);
    for (const symbol of symbols) {
      const impact = await getPriceImpact(env, row, symbol, impactDetailForSymbol(row, symbol));
      if (impact) impacts.push(impact);
    }
  }

  return impacts;
}

async function buildTickerSignals(env: Env, limit: number): Promise<TickerSignal[]> {
  const impacts = await buildMarketImpacts(env, limit);
  const grouped = new Map<string, PriceImpact[]>();

  for (const impact of impacts) {
    const items = grouped.get(impact.symbol) || [];
    items.push(impact);
    grouped.set(impact.symbol, items);
  }

  return [...grouped.entries()]
    .map(([symbol, items]) => {
      const weights = items.map((item) => Math.max(0.05, Number(item.confidence || 0)));
      const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
      const weightedScore =
        items.reduce((sum, item, index) => sum + Number(item.sentiment_score || 0) * weights[index], 0) / weightTotal;
      const weightedConfidence =
        items.reduce((sum, item, index) => sum + Number(item.confidence || 0) * weights[index], 0) / weightTotal;
      const averageAbsScore = items.reduce((sum, item) => sum + Math.abs(Number(item.sentiment_score || 0)), 0) / Math.max(items.length, 1);
      const agreement = averageAbsScore > 0 ? Math.min(1, Math.abs(weightedScore) / averageAbsScore) : 0;
      const confidence = Math.max(0, Math.min(0.95, weightedConfidence * (0.35 + 0.65 * agreement)));
      const latest = items
        .map((item) => item.published_at)
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;

      return {
        symbol,
        score: weightedScore,
        confidence,
        article_count: items.length,
        latest_published_at: latest,
        impacts: items.sort((a, b) => new Date(b.published_at || b.baseline_at || 0).getTime() - new Date(a.published_at || a.baseline_at || 0).getTime()),
      };
    })
    .sort((a, b) => Math.abs(b.score) * b.confidence * Math.log1p(b.article_count) - Math.abs(a.score) * a.confidence * Math.log1p(a.article_count));
}

async function buildEventSummaries(env: Env, limit: number): Promise<Array<ResearchResultRow & Record<string, unknown>>> {
  const rows = await listRows<ResearchResultRow & Record<string, unknown>>(
    env.NEWS_DB,
    "SELECT research_results.*, articles.title, articles.url, articles.published_at, sources.name AS source_name FROM research_results LEFT JOIN articles ON articles.id = research_results.article_id LEFT JOIN sources ON sources.id = articles.source_id ORDER BY research_results.created_at DESC LIMIT ?",
    limit,
  );

  const enriched = [];
  for (const row of rows) {
    const priceImpacts = [];
    for (const symbol of symbolsForResearchRow(row).slice(0, 5)) {
      const impact = await getPriceImpact(env, row, symbol, impactDetailForSymbol(row, symbol));
      if (impact) priceImpacts.push(impact);
    }
    enriched.push({ ...row, price_impacts: priceImpacts });
  }
  return enriched;
}

async function ensureSimulationTables(env: Env): Promise<void> {
  await env.NEWS_DB.batch([
    env.NEWS_DB.prepare(
      "CREATE TABLE IF NOT EXISTS simulation_state (id TEXT PRIMARY KEY, starting_cash REAL NOT NULL, cash REAL NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    ),
    env.NEWS_DB.prepare(
      "CREATE TABLE IF NOT EXISTS simulation_positions (symbol TEXT PRIMARY KEY, shares REAL NOT NULL, average_price REAL NOT NULL, last_action_at TEXT, last_buy_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    ),
    env.NEWS_DB.prepare(
      "CREATE TABLE IF NOT EXISTS simulation_processed_results (result_id TEXT PRIMARY KEY, article_id TEXT NOT NULL, processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, skipped_reason TEXT)",
    ),
    env.NEWS_DB.prepare(
      "CREATE TABLE IF NOT EXISTS simulation_trades (id TEXT PRIMARY KEY, result_id TEXT NOT NULL, article_id TEXT NOT NULL, action TEXT NOT NULL, symbol TEXT NOT NULL, article_title TEXT NOT NULL, article_url TEXT NOT NULL, event_type TEXT, sentiment_score REAL NOT NULL, confidence REAL NOT NULL, price REAL NOT NULL, shares REAL NOT NULL, notional REAL NOT NULL, cash_after REAL NOT NULL, portfolio_value REAL NOT NULL, action_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    ),
    env.NEWS_DB.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_simulation_trades_result_symbol_action ON simulation_trades(result_id, symbol, action)",
    ),
    env.NEWS_DB.prepare("CREATE INDEX IF NOT EXISTS idx_simulation_trades_action_at ON simulation_trades(action_at DESC)"),
    env.NEWS_DB.prepare(
      "CREATE TABLE IF NOT EXISTS simulation_snapshots (id TEXT PRIMARY KEY, at TEXT NOT NULL, cash REAL NOT NULL, investment_value REAL NOT NULL, total_value REAL NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    ),
    env.NEWS_DB.prepare("CREATE INDEX IF NOT EXISTS idx_simulation_snapshots_at ON simulation_snapshots(at DESC)"),
  ]);

  await env.NEWS_DB.prepare(
    "INSERT OR IGNORE INTO simulation_state (id, starting_cash, cash) VALUES ('default', ?, ?)",
  )
    .bind(100000, 100000)
    .run();
}

async function getSimulationState(env: Env): Promise<SimulationStateRow> {
  await ensureSimulationTables(env);
  const row = await env.NEWS_DB.prepare("SELECT * FROM simulation_state WHERE id = 'default'").first<SimulationStateRow>();
  if (!row) throw new Error("Simulation state could not be initialized");
  return row;
}

async function listSimulationPositions(env: Env): Promise<SimulationPositionRow[]> {
  await ensureSimulationTables(env);
  const result = await env.NEWS_DB.prepare("SELECT * FROM simulation_positions WHERE shares > 0 ORDER BY symbol").all<SimulationPositionRow>();
  return result.results || [];
}

async function latestKnownPrice(symbol: string): Promise<number | null> {
  try {
    const chart = await fetchYahooChart(symbol, new Date().toISOString());
    const points = chart.timestamps
      .map((at, index) => ({ at, price: chart.closes[index] }))
      .filter((point): point is { at: number; price: number } => typeof point.price === "number" && Number.isFinite(point.price))
      .sort((a, b) => b.at - a.at);
    return points[0]?.price ?? null;
  } catch {
    return null;
  }
}

async function currentPositionValue(env: Env, fallbackPrices = new Map<string, number>(), refreshLatest = false): Promise<number> {
  const positions = await listSimulationPositions(env);
  let value = 0;
  for (const position of positions) {
    const price = fallbackPrices.get(position.symbol) || (refreshLatest ? await latestKnownPrice(position.symbol) : null) || position.average_price;
    value += Number(position.shares || 0) * price;
  }
  return value;
}

async function recordSimulationSnapshot(env: Env, at: string, cash: number, fallbackPrices = new Map<string, number>()): Promise<number> {
  const investmentValue = await currentPositionValue(env, fallbackPrices);
  const totalValue = cash + investmentValue;
  await env.NEWS_DB.prepare(
    "INSERT INTO simulation_snapshots (id, at, cash, investment_value, total_value) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), at, cash, investmentValue, totalValue)
    .run();
  return totalValue;
}

async function processSimulationPending(env: Env, limit = 25): Promise<{ processed: number; skipped: number; trades: number }> {
  await ensureSimulationTables(env);
  const rows = await listRows<ResearchResultRow>(
    env.NEWS_DB,
    "SELECT research_results.id, research_results.article_id, research_results.created_at, research_results.symbols, research_results.sentiment_score, research_results.confidence, research_results.event_type, research_results.summary, research_results.memo, articles.title, articles.url, articles.published_at FROM research_results LEFT JOIN articles ON articles.id = research_results.article_id LEFT JOIN simulation_processed_results ON simulation_processed_results.result_id = research_results.id WHERE simulation_processed_results.result_id IS NULL ORDER BY COALESCE(articles.published_at, research_results.created_at) ASC LIMIT ?",
    limit,
  );

  let processed = 0;
  let skipped = 0;
  let trades = 0;
  const startingCash = 100000;
  const actionCooldownMs = 12 * 60 * 60 * 1000;
  const minimumHoldMs = 3 * 24 * 60 * 60 * 1000;

  for (const row of rows) {
    const score = Number(row.sentiment_score || 0);
    const confidence = Number(row.confidence || 0);
    const actionAt = row.published_at || row.created_at;
    const actionTime = new Date(actionAt).getTime();

    async function markProcessed(reason: string | null): Promise<void> {
      await env.NEWS_DB.prepare(
        "INSERT OR IGNORE INTO simulation_processed_results (result_id, article_id, skipped_reason) VALUES (?, ?, ?)",
      )
        .bind(row.id, row.article_id, reason)
        .run();
      if (reason) skipped += 1;
      else processed += 1;
    }

    if (Math.abs(score) < 0.15 || confidence < 0.35) {
      await markProcessed("low_signal");
      continue;
    }

    const symbols = symbolsForResearchRow(row).slice(0, 4);
    if (!symbols.length) {
      await markProcessed("no_symbols");
      continue;
    }

    const prices = new Map<string, number>();
    for (const symbol of symbols) {
      const impact = await getPriceImpact(env, row, symbol, impactDetailForSymbol(row, symbol));
      if (impact?.baseline_price) prices.set(symbol, impact.baseline_price);
    }
    if (!prices.size) {
      await markProcessed("no_prices");
      continue;
    }

    const state = await getSimulationState(env);
    let cash = Number(state.cash ?? startingCash);
    const currentValue = cash + (await currentPositionValue(env, prices));
    const totalNotional = Math.min(currentValue * 0.12, currentValue * Math.abs(score) * confidence * 0.18);
    const perSymbol = totalNotional / prices.size;
    let rowTrades = 0;

    for (const [symbol, price] of prices) {
      const position = await env.NEWS_DB.prepare("SELECT * FROM simulation_positions WHERE symbol = ?").bind(symbol).first<SimulationPositionRow>();
      const held = Number(position?.shares || 0);
      const lastAction = position?.last_action_at ? new Date(position.last_action_at).getTime() : 0;
      const lastBuy = position?.last_buy_at ? new Date(position.last_buy_at).getTime() : 0;

      if (score > 0) {
        const existingValue = held * price;
        const maxPositionValue = currentValue * 0.15;
        const canAddToExisting = actionTime - lastAction >= 24 * 60 * 60 * 1000 && score >= 0.45 && confidence >= 0.65;
        if (held > 0 && !canAddToExisting) continue;
        if (actionTime - lastAction < actionCooldownMs) continue;
        if (existingValue >= maxPositionValue) continue;

        const notional = Math.min(cash, perSymbol);
        const cappedNotional = Math.min(notional, Math.max(0, maxPositionValue - existingValue));
        const shares = Math.floor((cappedNotional / price) * 10000) / 10000;
        if (shares <= 0) continue;
        cash -= shares * price;
        const newShares = held + shares;
        const previousCost = held * Number(position?.average_price || price);
        const averagePrice = (previousCost + shares * price) / newShares;
        await env.NEWS_DB.batch([
          env.NEWS_DB.prepare(
            "INSERT INTO simulation_positions (symbol, shares, average_price, last_action_at, last_buy_at, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(symbol) DO UPDATE SET shares = excluded.shares, average_price = excluded.average_price, last_action_at = excluded.last_action_at, last_buy_at = excluded.last_buy_at, updated_at = CURRENT_TIMESTAMP",
          ).bind(symbol, newShares, averagePrice, actionAt, actionAt),
          env.NEWS_DB.prepare("UPDATE simulation_state SET cash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 'default'").bind(cash),
        ]);
        const value = await recordSimulationSnapshot(env, actionAt, cash, prices);
        await env.NEWS_DB.prepare(
          "INSERT OR IGNORE INTO simulation_trades (id, result_id, article_id, action, symbol, article_title, article_url, event_type, sentiment_score, confidence, price, shares, notional, cash_after, portfolio_value, action_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
          .bind(crypto.randomUUID(), row.id, row.article_id, "BUY", symbol, row.title, row.url, row.event_type, score, confidence, price, shares, shares * price, cash, value, actionAt)
          .run();
        rowTrades += 1;
      } else {
        if (held <= 0) continue;
        const criticalBearishExit = score <= -0.65 && confidence >= 0.75;
        if (actionTime - lastAction < actionCooldownMs && !criticalBearishExit) continue;
        if (actionTime - lastBuy < minimumHoldMs && !criticalBearishExit) continue;

        const shares = criticalBearishExit ? held : Math.min(held, Math.floor((perSymbol / price) * 10000) / 10000);
        if (shares <= 0) continue;
        cash += shares * price;
        const remaining = Math.max(0, held - shares);
        await env.NEWS_DB.batch([
          env.NEWS_DB.prepare(
            "INSERT INTO simulation_positions (symbol, shares, average_price, last_action_at, last_buy_at, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(symbol) DO UPDATE SET shares = excluded.shares, average_price = excluded.average_price, last_action_at = excluded.last_action_at, last_buy_at = excluded.last_buy_at, updated_at = CURRENT_TIMESTAMP",
          ).bind(symbol, remaining, Number(position?.average_price || price), actionAt, position?.last_buy_at || null),
          env.NEWS_DB.prepare("UPDATE simulation_state SET cash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 'default'").bind(cash),
        ]);
        const value = await recordSimulationSnapshot(env, actionAt, cash, prices);
        await env.NEWS_DB.prepare(
          "INSERT OR IGNORE INTO simulation_trades (id, result_id, article_id, action, symbol, article_title, article_url, event_type, sentiment_score, confidence, price, shares, notional, cash_after, portfolio_value, action_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
          .bind(crypto.randomUUID(), row.id, row.article_id, "SELL", symbol, row.title, row.url, row.event_type, score, confidence, price, shares, shares * price, cash, value, actionAt)
          .run();
        rowTrades += 1;
      }
    }

    trades += rowTrades;
    await markProcessed(rowTrades ? null : "no_trade");
  }

  return { processed, skipped, trades };
}

async function buildSimulation(env: Env, limit: number): Promise<{
  starting_cash: number;
  current_value: number;
  movement_pct: number;
  cash: number;
  investment_value: number;
  positions: Record<string, number>;
  points: SimulationPoint[];
  trades: SimulationTrade[];
}> {
  await processSimulationPending(env, 10);
  const state = await getSimulationState(env);
  const positions = await listSimulationPositions(env);
  const cash = Number(state.cash);
  const investmentValue = await currentPositionValue(env);
  const currentValue = cash + investmentValue;
  const snapshot = await env.NEWS_DB.prepare(
    "SELECT at FROM simulation_snapshots ORDER BY datetime(at) DESC LIMIT 1",
  ).first<{ at: string }>();
  if (!snapshot || Date.now() - new Date(snapshot.at).getTime() > 30 * 60 * 1000) {
    await recordSimulationSnapshot(env, new Date().toISOString(), cash);
  }

  const snapshotLimit = Math.min(Math.max(limit, 2), 1000);
  const pointResult = await env.NEWS_DB.prepare(
    "SELECT at, total_value, cash, investment_value FROM (SELECT at, total_value, cash, investment_value FROM simulation_snapshots ORDER BY datetime(at) DESC LIMIT ?) ORDER BY datetime(at) ASC",
  )
    .bind(snapshotLimit)
    .all<{ at: string; total_value: number; cash: number; investment_value: number }>();
  const pointRows = pointResult.results || [];
  const points = pointRows.map((point) => ({
    at: point.at,
    value: Number(point.total_value),
    cash: Number(point.cash),
    investments: Number(point.investment_value),
  }));
  if (!points.length) {
    points.push({ at: state.created_at, value: Number(state.starting_cash), cash: Number(state.starting_cash), investments: 0 });
  }

  const tradeRows = await listRows<SimulationTrade>(
    env.NEWS_DB,
    "SELECT action, symbol, article_title, article_url, event_type, sentiment_score, confidence, price, shares, notional, cash_after, portfolio_value, action_at FROM simulation_trades ORDER BY datetime(action_at) DESC LIMIT ?",
    limit,
  );

  return {
    starting_cash: Number(state.starting_cash),
    current_value: currentValue,
    movement_pct: ((currentValue - Number(state.starting_cash)) / Number(state.starting_cash)) * 100,
    cash,
    investment_value: investmentValue,
    positions: Object.fromEntries(positions.map((position) => [position.symbol, position.shares])),
    points,
    trades: tradeRows,
  };
}

async function ensureEodSimulationTables(env: Env): Promise<void> {
  await env.NEWS_DB.batch([
    env.NEWS_DB.prepare(
      "CREATE TABLE IF NOT EXISTS eod_simulation_state (id TEXT PRIMARY KEY, starting_cash REAL NOT NULL, cash REAL NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    ),
    env.NEWS_DB.prepare(
      "CREATE TABLE IF NOT EXISTS eod_simulation_positions (symbol TEXT PRIMARY KEY, shares REAL NOT NULL, average_price REAL NOT NULL, last_action_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    ),
    env.NEWS_DB.prepare(
      "CREATE TABLE IF NOT EXISTS eod_reports (id TEXT PRIMARY KEY, report_date TEXT NOT NULL UNIQUE, summary TEXT NOT NULL, candidates_json TEXT NOT NULL, chosen_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    ),
    env.NEWS_DB.prepare("CREATE INDEX IF NOT EXISTS idx_eod_reports_date ON eod_reports(report_date DESC)"),
    env.NEWS_DB.prepare(
      "CREATE TABLE IF NOT EXISTS eod_simulation_trades (id TEXT PRIMARY KEY, report_id TEXT NOT NULL, action TEXT NOT NULL, symbol TEXT NOT NULL, thesis TEXT NOT NULL, event_count INTEGER NOT NULL, score REAL NOT NULL, confidence REAL NOT NULL, price REAL NOT NULL, shares REAL NOT NULL, notional REAL NOT NULL, cash_after REAL NOT NULL, portfolio_value REAL NOT NULL, action_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    ),
    env.NEWS_DB.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_eod_trades_report_symbol_action ON eod_simulation_trades(report_id, symbol, action)",
    ),
    env.NEWS_DB.prepare("CREATE INDEX IF NOT EXISTS idx_eod_trades_action_at ON eod_simulation_trades(action_at DESC)"),
    env.NEWS_DB.prepare(
      "CREATE TABLE IF NOT EXISTS eod_simulation_snapshots (id TEXT PRIMARY KEY, at TEXT NOT NULL, cash REAL NOT NULL, investment_value REAL NOT NULL, total_value REAL NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    ),
    env.NEWS_DB.prepare("CREATE INDEX IF NOT EXISTS idx_eod_snapshots_at ON eod_simulation_snapshots(at DESC)"),
  ]);
  await env.NEWS_DB.prepare("INSERT OR IGNORE INTO eod_simulation_state (id, starting_cash, cash) VALUES ('default', ?, ?)")
    .bind(100000, 100000)
    .run();
}

async function listEodPositions(env: Env): Promise<SimulationPositionRow[]> {
  await ensureEodSimulationTables(env);
  const result = await env.NEWS_DB.prepare("SELECT symbol, shares, average_price, last_action_at, NULL AS last_buy_at, updated_at FROM eod_simulation_positions WHERE shares > 0 ORDER BY symbol").all<SimulationPositionRow>();
  return result.results || [];
}

async function eodPositionValue(env: Env, fallbackPrices = new Map<string, number>()): Promise<number> {
  const positions = await listEodPositions(env);
  let value = 0;
  for (const position of positions) {
    value += Number(position.shares || 0) * (fallbackPrices.get(position.symbol) || position.average_price);
  }
  return value;
}

async function recordEodSnapshot(env: Env, at: string, cash: number, fallbackPrices = new Map<string, number>()): Promise<number> {
  const investmentValue = await eodPositionValue(env, fallbackPrices);
  const totalValue = cash + investmentValue;
  await env.NEWS_DB.prepare("INSERT INTO eod_simulation_snapshots (id, at, cash, investment_value, total_value) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), at, cash, investmentValue, totalValue)
    .run();
  return totalValue;
}

function eodReportDate(now = new Date()): string | null {
  if (now.getUTCHours() < 21) return null;
  return now.toISOString().slice(0, 10);
}

async function processEodSimulation(env: Env, force = false): Promise<{ processed: boolean; report_date?: string; trades?: number; skipped?: string }> {
  await ensureEodSimulationTables(env);
  const reportDate = force ? new Date().toISOString().slice(0, 10) : eodReportDate();
  if (!reportDate) return { processed: false, skipped: "before_eod_window" };
  const existing = await env.NEWS_DB.prepare("SELECT id FROM eod_reports WHERE report_date = ?").bind(reportDate).first<{ id: string }>();
  if (existing) return { processed: false, report_date: reportDate, skipped: "already_processed" };

  const start = `${reportDate}T00:00:00.000Z`;
  const end = `${reportDate}T23:59:59.999Z`;
  const rows = await env.NEWS_DB.prepare(
    "SELECT research_results.id, research_results.article_id, research_results.created_at, research_results.symbols, research_results.sentiment_score, research_results.confidence, research_results.event_type, research_results.summary, research_results.memo, articles.title, articles.url, articles.published_at FROM research_results LEFT JOIN articles ON articles.id = research_results.article_id WHERE COALESCE(articles.published_at, research_results.created_at) BETWEEN ? AND ? ORDER BY COALESCE(articles.published_at, research_results.created_at) ASC",
  )
    .bind(start, end)
    .all<ResearchResultRow>();
  const grouped = new Map<string, { symbol: string; weightedScore: number; weight: number; confidenceSum: number; events: string[]; latestRow: ResearchResultRow }>();

  for (const row of rows.results || []) {
    const score = Number(row.sentiment_score || 0);
    const confidence = Number(row.confidence || 0);
    if (Math.abs(score) < 0.12 || confidence < 0.4) continue;
    for (const symbol of symbolsForResearchRow(row).slice(0, 5)) {
      const detail = impactDetailForSymbol(row, symbol);
      if (detail?.direction === "neutral") continue;
      const weight = Math.max(0.05, confidence);
      const item = grouped.get(symbol) || { symbol, weightedScore: 0, weight: 0, confidenceSum: 0, events: [], latestRow: row };
      item.weightedScore += score * weight;
      item.weight += weight;
      item.confidenceSum += confidence * weight;
      item.events.push(row.title);
      if (new Date(row.created_at).getTime() > new Date(item.latestRow.created_at).getTime()) item.latestRow = row;
      grouped.set(symbol, item);
    }
  }

  const candidates = [...grouped.values()].map((item) => {
    const score = item.weightedScore / (item.weight || 1);
    const confidence = item.confidenceSum / (item.weight || 1);
    return {
      symbol: item.symbol,
      score,
      confidence,
      event_count: item.events.length,
      thesis: `${item.symbol}: ${score >= 0 ? "bullish" : "bearish"} weighted EOD signal from ${item.events.length} analyzed event(s). Key event: ${item.events[0] || "unknown"}`,
      article_id: item.latestRow.article_id,
      result_id: item.latestRow.id,
    };
  }).sort((a, b) => Math.abs(b.score) * b.confidence * Math.log1p(b.event_count) - Math.abs(a.score) * a.confidence * Math.log1p(a.event_count));

  const chosen = candidates.filter((item) => Math.abs(item.score) >= 0.15 && item.confidence >= 0.5).slice(0, 10);
  const reportId = crypto.randomUUID();
  const summary = chosen.length
    ? `EOD model selected ${chosen.length} high-confidence ticker movement(s) from ${candidates.length} candidates for ${reportDate}.`
    : `EOD model found no movements clearing confidence and score thresholds for ${reportDate}.`;
  await env.NEWS_DB.prepare("INSERT INTO eod_reports (id, report_date, summary, candidates_json, chosen_json) VALUES (?, ?, ?, ?, ?)")
    .bind(reportId, reportDate, summary, JSON.stringify(candidates), JSON.stringify(chosen))
    .run();

  let trades = 0;
  const state = await env.NEWS_DB.prepare("SELECT * FROM eod_simulation_state WHERE id = 'default'").first<SimulationStateRow>();
  let cash = Number(state?.cash || 100000);
  const prices = new Map<string, number>();
  for (const item of chosen) {
    const row = (rows.results || []).find((candidate) => candidate.id === item.result_id);
    if (!row) continue;
    const impact = await getPriceImpact(env, row, item.symbol, impactDetailForSymbol(row, item.symbol));
    if (impact?.baseline_price) prices.set(item.symbol, impact.baseline_price);
  }
  const portfolioValue = cash + (await eodPositionValue(env, prices));
  const perTradeBudget = chosen.length ? Math.min(portfolioValue * 0.08, portfolioValue * 0.45 / chosen.length) : 0;
  const actionAt = new Date().toISOString();

  for (const item of chosen) {
    const price = prices.get(item.symbol);
    if (!price) continue;
    const position = await env.NEWS_DB.prepare("SELECT symbol, shares, average_price, last_action_at, NULL AS last_buy_at, updated_at FROM eod_simulation_positions WHERE symbol = ?")
      .bind(item.symbol)
      .first<SimulationPositionRow>();
    const held = Number(position?.shares || 0);
    if (item.score > 0) {
      if (held > 0) continue;
      const shares = Math.floor((Math.min(cash, perTradeBudget) / price) * 10000) / 10000;
      if (shares <= 0) continue;
      cash -= shares * price;
      await env.NEWS_DB.batch([
        env.NEWS_DB.prepare(
          "INSERT INTO eod_simulation_positions (symbol, shares, average_price, last_action_at, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(symbol) DO UPDATE SET shares = excluded.shares, average_price = excluded.average_price, last_action_at = excluded.last_action_at, updated_at = CURRENT_TIMESTAMP",
        ).bind(item.symbol, shares, price, actionAt),
        env.NEWS_DB.prepare("UPDATE eod_simulation_state SET cash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 'default'").bind(cash),
      ]);
      const value = await recordEodSnapshot(env, actionAt, cash, prices);
      await env.NEWS_DB.prepare(
        "INSERT OR IGNORE INTO eod_simulation_trades (id, report_id, action, symbol, thesis, event_count, score, confidence, price, shares, notional, cash_after, portfolio_value, action_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(crypto.randomUUID(), reportId, "BUY", item.symbol, item.thesis, item.event_count, item.score, item.confidence, price, shares, shares * price, cash, value, actionAt).run();
      trades += 1;
    } else if (held > 0) {
      cash += held * price;
      await env.NEWS_DB.batch([
        env.NEWS_DB.prepare("UPDATE eod_simulation_positions SET shares = 0, last_action_at = ?, updated_at = CURRENT_TIMESTAMP WHERE symbol = ?").bind(actionAt, item.symbol),
        env.NEWS_DB.prepare("UPDATE eod_simulation_state SET cash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 'default'").bind(cash),
      ]);
      const value = await recordEodSnapshot(env, actionAt, cash, prices);
      await env.NEWS_DB.prepare(
        "INSERT OR IGNORE INTO eod_simulation_trades (id, report_id, action, symbol, thesis, event_count, score, confidence, price, shares, notional, cash_after, portfolio_value, action_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(crypto.randomUUID(), reportId, "SELL", item.symbol, item.thesis, item.event_count, item.score, item.confidence, price, held, held * price, cash, value, actionAt).run();
      trades += 1;
    }
  }

  return { processed: true, report_date: reportDate, trades };
}

async function buildEodSimulation(env: Env, limit: number): Promise<Record<string, unknown>> {
  await ensureEodSimulationTables(env);
  const state = await env.NEWS_DB.prepare("SELECT * FROM eod_simulation_state WHERE id = 'default'").first<SimulationStateRow>();
  const positions = await listEodPositions(env);
  const cash = Number(state?.cash || 100000);
  const investmentValue = await eodPositionValue(env);
  const currentValue = cash + investmentValue;
  const points = await listRows<{ at: string; total_value: number; cash: number; investment_value: number }>(
    env.NEWS_DB,
    "SELECT at, total_value, cash, investment_value FROM (SELECT at, total_value, cash, investment_value FROM eod_simulation_snapshots ORDER BY datetime(at) DESC LIMIT ?) ORDER BY datetime(at) ASC",
    limit,
  );
  const trades = await listRows<Record<string, unknown>>(
    env.NEWS_DB,
    "SELECT action, symbol, thesis AS article_title, '' AS article_url, NULL AS event_type, score AS sentiment_score, confidence, price, shares, notional, cash_after, portfolio_value, action_at FROM eod_simulation_trades ORDER BY datetime(action_at) DESC LIMIT ?",
    limit,
  );
  const reports = await listRows<EodReportRow>(
    env.NEWS_DB,
    "SELECT * FROM eod_reports ORDER BY report_date DESC LIMIT ?",
    Math.min(limit, 100),
  );
  return {
    starting_cash: Number(state?.starting_cash || 100000),
    current_value: currentValue,
    movement_pct: ((currentValue - Number(state?.starting_cash || 100000)) / Number(state?.starting_cash || 100000)) * 100,
    cash,
    investment_value: investmentValue,
    positions: Object.fromEntries(positions.map((position) => [position.symbol, position.shares])),
    points: points.map((point) => ({ at: point.at, value: Number(point.total_value), cash: Number(point.cash), investments: Number(point.investment_value) })),
    trades,
    reports: reports.map((report) => ({
      id: report.id,
      report_date: report.report_date,
      summary: report.summary,
      candidates: JSON.parse(report.candidates_json),
      chosen: JSON.parse(report.chosen_json),
      created_at: report.created_at,
    })),
  };
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
      results: await buildEventSummaries(env, limit),
    });
  }

  if (url.pathname === "/api/market-impacts") {
    return json({ ok: true, impacts: await buildMarketImpacts(env, limit) });
  }

  if (url.pathname === "/api/ticker-signals") {
    return json({ ok: true, tickers: await buildTickerSignals(env, limit) });
  }

  if (url.pathname === "/api/simulation") {
    return json({ ok: true, simulation: await buildSimulation(env, limit) });
  }

  if (url.pathname === "/api/simulation/eod") {
    return json({ ok: true, simulation: await buildEodSimulation(env, limit) });
  }

  if (url.pathname === "/api/simulation/process" && request.method === "POST") {
    return json({ ok: true, ...(await processSimulationPending(env, limit)) });
  }

  if (url.pathname === "/api/simulation/eod/process" && request.method === "POST") {
    return json({ ok: true, ...(await processEodSimulation(env, url.searchParams.get("force") === "1")) });
  }

  if (url.pathname === "/api/ingest" && request.method === "POST") {
    const ingestion = await ingestFeeds(env);
    const requeued = await requeuePendingJobs(env, 10);
    return json({ ok: true, ...ingestion, ...requeued });
  }

  if (url.pathname === "/api/process-next" && request.method === "POST") {
    return json(await processNextJob(env));
  }

  if (url.pathname === "/api/requeue-pending" && request.method === "POST") {
    return json({ ok: true, ...(await requeuePendingJobs(env, limit)) });
  }

  if (url.pathname === "/api/reanalyze-recent" && request.method === "POST") {
    return json({ ok: true, ...(await reanalyzeRecentJobs(env, limit)) });
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
          "/api/ticker-signals",
          "/api/simulation/process",
          "/api/simulation/eod",
          "/api/simulation/eod/process",
          "/api/reanalyze-recent",
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
        await processSimulationPending(env, 50).catch((error) => console.error("Scheduled simulation processing failed", error));
        await processEodSimulation(env).catch((error) => console.error("Scheduled EOD simulation processing failed", error));
      }),
    );
  },

  async queue(batch: MessageBatch<ResearchJobMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processJob(env, message.body.jobId);
        await processSimulationPending(env, 10).catch((error) => console.error("Queue simulation processing failed", error));
        message.ack();
        await requeuePendingJobs(env, 1);
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
