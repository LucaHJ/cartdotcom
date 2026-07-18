import { Container, getContainer } from "@cloudflare/containers";

type Source = {
  id: string;
  name: string;
  url: string;
  category: string;
  weight: number;
  sourceType: "editorial" | "regulator" | "first_party" | "press_release";
};

type FeedItem = {
  source: Source;
  title: string;
  url: string;
  summary: string | null;
  publishedAt: string | null;
  contentPlaintext: string | null;
};

type Article = {
  id: string;
  source_id: string;
  title: string;
  url: string;
  summary: string | null;
  published_at: string | null;
  discovered_at: string;
  content_plaintext: string | null;
  content_source: string | null;
  content_status: string;
  content_fetched_at: string | null;
  content_fetch_attempts: number;
  content_error: string | null;
  source_name?: string;
  source_type?: string;
  source_weight?: number;
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

type PredictionPoint = PricePoint & {
  accurate: boolean | null;
  counts_toward_accuracy?: boolean;
};

type PredictionDailyPoint = {
  day_index: number;
  at: string;
  price: number;
  change_pct: number;
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

type PredictionOutcome = {
  id: string;
  result_id: string;
  article_id: string;
  title: string | null;
  url: string | null;
  symbol: string;
  company: string | null;
  direction: "bullish" | "bearish";
  score: number | null;
  confidence: number | null;
  rationale: string | null;
  prediction_at: string;
  baseline_price: number | null;
  baseline_at: string | null;
  intervals: Record<string, PredictionPoint>;
  daily_points?: PredictionDailyPoint[];
  updated_at: string;
};

type StoredPredictionOutcomeRow = Omit<PredictionOutcome, "title" | "url" | "intervals"> & {
  article_title: string | null;
  article_url: string | null;
  intervals_json: string;
  accuracy_cutoff_epoch: number | null;
};

type PredictionOutcomeFilters = {
  direction: "bullish" | "bearish" | null;
  confidenceMin: number | null;
  confidenceMax: number | null;
  cursor: string | null;
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
    super("This research job is already running");
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
  CODEX_AUTH_STATE_KEY?: string;
  CODEX_RESEARCH_MODEL?: string;
}

function source(
  id: string,
  name: string,
  url: string,
  category: string,
  weight: number,
  sourceType: Source["sourceType"] = "editorial",
): Source {
  return { id, name, url, category, weight, sourceType };
}

const SOURCES: Source[] = [
  source("cnbc-top", "CNBC Top News", "https://www.cnbc.com/id/100003114/device/rss/rss.html", "markets", 1),
  source("cnbc-tech", "CNBC Technology", "https://www.cnbc.com/id/19854910/device/rss/rss.html", "technology", 1),
  source("marketwatch-top", "MarketWatch Top Stories", "https://feeds.content.dowjones.io/public/rss/mw_topstories", "markets", 0.9),
  source("the-verge", "The Verge", "https://www.theverge.com/rss/index.xml", "technology", 0.75),
  source("techcrunch-ai", "TechCrunch AI", "https://techcrunch.com/category/artificial-intelligence/feed/", "ai", 0.8),

  source("bbc-business", "BBC Business", "https://feeds.bbci.co.uk/news/business/rss.xml", "markets", 0.95),
  source("bbc-technology", "BBC Technology", "https://feeds.bbci.co.uk/news/technology/rss.xml", "technology", 0.9),
  source("nyt-business", "The New York Times Business", "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", "markets", 0.95),
  source("nyt-technology", "The New York Times Technology", "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml", "technology", 0.9),
  source("nyt-politics", "The New York Times Politics", "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml", "politics", 0.9),
  source("guardian-business", "The Guardian Business", "https://www.theguardian.com/business/rss", "markets", 0.85),
  source("guardian-technology", "The Guardian Technology", "https://www.theguardian.com/technology/rss", "technology", 0.8),
  source("guardian-world", "The Guardian World", "https://www.theguardian.com/world/rss", "world", 0.8),
  source("financial-times", "Financial Times", "https://www.ft.com/rss/home", "markets", 1),
  source("wsj-markets", "The Wall Street Journal Markets", "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", "markets", 1),
  source("wsj-business", "The Wall Street Journal Business", "https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml", "markets", 1),
  source("wsj-technology", "The Wall Street Journal Technology", "https://feeds.a.dj.com/rss/RSSWSJD.xml", "technology", 0.95),
  source("bloomberg-markets", "Bloomberg Markets", "https://feeds.bloomberg.com/markets/news.rss", "markets", 1),
  source("bloomberg-technology", "Bloomberg Technology", "https://feeds.bloomberg.com/technology/news.rss", "technology", 0.95),
  source("economist-business", "The Economist Business", "https://www.economist.com/business/rss.xml", "markets", 0.9),
  source("economist-finance", "The Economist Finance and Economics", "https://www.economist.com/finance-and-economics/rss.xml", "markets", 0.95),
  source("economist-science", "The Economist Science and Technology", "https://www.economist.com/science-and-technology/rss.xml", "technology", 0.85),
  source("al-jazeera", "Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml", "world", 0.75),
  source("politico-politics", "Politico Politics", "https://rss.politico.com/politics-news.xml", "politics", 0.9),
  source("abc-au-business", "ABC News Australia Business", "https://www.abc.net.au/news/feed/51892/rss.xml", "markets", 0.9),
  source("abc-au-top", "ABC News Australia", "https://www.abc.net.au/news/feed/51120/rss.xml", "australia", 0.85),
  source("fortune", "Fortune", "https://fortune.com/feed/", "markets", 0.8),
  source("forbes-innovation", "Forbes Innovation", "https://www.forbes.com/innovation/feed2", "technology", 0.75),
  source("business-insider", "Business Insider", "https://feeds.businessinsider.com/custom/all", "markets", 0.75),
  source("axios", "Axios", "https://api.axios.com/feed/", "world", 0.8),
  source("nasdaq-markets", "Nasdaq Markets", "https://www.nasdaq.com/feed/rssoutbound?category=Markets", "markets", 0.85),
  source("benzinga", "Benzinga", "https://www.benzinga.com/feed", "markets", 0.7),
  source("yahoo-finance", "Yahoo Finance", "https://finance.yahoo.com/news/rssindex", "markets", 0.8),
  source("le-monde-en", "Le Monde English", "https://www.lemonde.fr/en/rss/une.xml", "world", 0.75),

  source("ars-technica", "Ars Technica", "https://feeds.arstechnica.com/arstechnica/index", "technology", 0.85),
  source("wired-top", "Wired", "https://www.wired.com/feed/rss", "technology", 0.85),
  source("wired-business", "Wired Business", "https://www.wired.com/feed/category/business/latest/rss", "technology", 0.85),
  source("wired-ai", "Wired AI", "https://www.wired.com/feed/tag/ai/latest/rss", "ai", 0.85),
  source("mit-tech-review", "MIT Technology Review", "https://www.technologyreview.com/feed/", "technology", 0.9),
  source("venturebeat", "VentureBeat", "https://venturebeat.com/feed", "technology", 0.75),
  source("engadget", "Engadget", "https://www.engadget.com/rss.xml", "technology", 0.7),
  source("zdnet", "ZDNET", "https://www.zdnet.com/news/rss.xml", "technology", 0.75),
  source("ieee-spectrum", "IEEE Spectrum", "https://spectrum.ieee.org/feeds/feed.rss", "technology", 0.85),
  source("toms-hardware", "Tom's Hardware", "https://www.tomshardware.com/feeds/all", "semiconductors", 0.75),
  source("semiconductor-engineering", "Semiconductor Engineering", "https://semiengineering.com/feed/", "semiconductors", 0.9),
  source("ee-times", "EE Times", "https://www.eetimes.com/feed/", "semiconductors", 0.85),
  source("macrumors", "MacRumors", "https://feeds.macrumors.com/MacRumors-All", "technology", 0.7),
  source("9to5mac", "9to5Mac", "https://9to5mac.com/feed/", "technology", 0.7),

  source("sec-press", "SEC Press Releases", "https://www.sec.gov/news/pressreleases.rss", "regulation", 1, "regulator"),
  source("federal-reserve", "Federal Reserve Press Releases", "https://www.federalreserve.gov/feeds/press_all.xml", "monetary_policy", 1, "regulator"),
  source("eia-energy", "US Energy Information Administration", "https://www.eia.gov/rss/todayinenergy.xml", "energy", 0.95, "regulator"),
  source("white-house", "White House Announcements", "https://www.whitehouse.gov/news/feed/", "politics", 0.95, "regulator"),
  source("ftc-press", "FTC Press Releases", "https://www.ftc.gov/feeds/press-release.xml", "regulation", 0.95, "regulator"),
  source("ecb-press", "European Central Bank Press Releases", "https://www.ecb.europa.eu/rss/press.html", "monetary_policy", 0.95, "regulator"),
  source("bank-of-england", "Bank of England News", "https://www.bankofengland.co.uk/rss/news", "monetary_policy", 0.9, "regulator"),
  source("european-commission", "European Commission Announcements", "https://ec.europa.eu/commission/presscorner/api/rss?language=en", "regulation", 0.9, "regulator"),
  source("uk-gov-business", "UK Government Business Announcements", "https://www.gov.uk/search/news-and-communications.atom?topics%5B%5D=business-and-industry", "regulation", 0.85, "regulator"),
  source("pr-newswire", "PR Newswire", "https://www.prnewswire.com/rss/news-releases-list.rss", "company_news", 0.75, "press_release"),
  source("business-wire", "Business Wire", "https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeEFpQWA==", "company_news", 0.8, "press_release"),

  source("openai-news", "OpenAI News", "https://openai.com/news/rss.xml", "ai", 0.95, "first_party"),
  source("google-blog", "Google Blog", "https://blog.google/rss/", "technology", 0.9, "first_party"),
  source("google-deepmind", "Google DeepMind", "https://deepmind.google/blog/rss.xml", "ai", 0.95, "first_party"),
  source("microsoft-source", "Microsoft Source", "https://news.microsoft.com/source/feed/", "technology", 0.9, "first_party"),
  source("nvidia-blog", "NVIDIA Blog", "https://blogs.nvidia.com/feed/", "semiconductors", 0.95, "first_party"),
  source("intel-newsroom", "Intel Newsroom", "https://newsroom.intel.com/feed", "semiconductors", 0.9, "first_party"),
  source("apple-newsroom", "Apple Newsroom", "https://www.apple.com/newsroom/rss-feed.rss", "technology", 0.9, "first_party"),
  source("meta-newsroom", "Meta Newsroom", "https://about.fb.com/news/feed/", "technology", 0.9, "first_party"),
  source("samsung-newsroom", "Samsung Global Newsroom", "https://news.samsung.com/global/feed", "technology", 0.85, "first_party"),

  source("coindesk", "CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss", "crypto", 0.85),
  source("decrypt", "Decrypt", "https://decrypt.co/feed", "crypto", 0.75),
  source("spacenews", "SpaceNews", "https://spacenews.com/feed/", "space", 0.85),
  source("defense-news", "Defense News", "https://www.defensenews.com/arc/outboundfeeds/rss/", "defense", 0.85),
  source("electrek", "Electrek", "https://electrek.co/feed/", "automotive", 0.75),
  source("stat-news", "STAT", "https://www.statnews.com/feed/", "healthcare", 0.9),
  source("fierce-biotech", "Fierce Biotech", "https://www.fiercebiotech.com/rss/xml", "healthcare", 0.85),
  source("retail-dive", "Retail Dive", "https://www.retaildive.com/feeds/news/", "retail", 0.8),
  source("supply-chain-dive", "Supply Chain Dive", "https://www.supplychaindive.com/feeds/news/", "supply_chain", 0.85),
  source("healthcare-dive", "Healthcare Dive", "https://www.healthcaredive.com/feeds/news/", "healthcare", 0.8),
  source("variety", "Variety", "https://variety.com/feed/", "media", 0.8),
  source("hollywood-reporter", "The Hollywood Reporter", "https://www.hollywoodreporter.com/feed/", "media", 0.8),
  source("gamesindustry", "GamesIndustry.biz", "https://www.gamesindustry.biz/feed", "gaming", 0.8),
];

const ARTICLE_CONTENT_MAX_CHARS = 120_000;
const ARTICLE_FETCH_TIMEOUT_MS = 15_000;
const ARTICLE_INGESTION_WINDOW_MINUTES = 5;
const ARTICLE_INGESTION_WINDOW_MS = ARTICLE_INGESTION_WINDOW_MINUTES * 60 * 1000;
const SOURCE_EXPANSION_CUTOFF = "2026-07-18T08:28:55Z";
const RESEARCH_CONTAINER_COUNT = 4;
const QUEUE_DRAIN_MAX_JOBS = 8;
const QUEUE_DRAIN_MAX_MS = 4 * 60 * 1000;
let articleStorageSchemaReady: Promise<void> | null = null;

async function addColumnIfMissing(db: D1Database, table: string, column: string, definition: string): Promise<void> {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  if ((info.results || []).some((item) => item.name === column)) return;
  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/duplicate column name/i.test(message)) throw error;
  }
}

async function pruneLegacyFirstPassBacklog(db: D1Database): Promise<{ cancelled: number; archived: number }> {
  const cancelled = await db.prepare(
    "UPDATE research_jobs SET status = 'cancelled', last_error = 'Cancelled pre-cohort first-pass backlog', finished_at = CURRENT_TIMESTAMP, research_slot = NULL WHERE status = 'pending' AND prediction_delay_eligible = 0 AND NOT EXISTS (SELECT 1 FROM research_results WHERE research_results.job_id = research_jobs.id)",
  ).run();
  const archived = await db.prepare(
    "UPDATE articles SET status = 'archived' WHERE status != 'archived' AND EXISTS (SELECT 1 FROM research_jobs WHERE research_jobs.article_id = articles.id AND research_jobs.status = 'cancelled' AND research_jobs.last_error = 'Cancelled pre-cohort first-pass backlog')",
  ).run();
  return { cancelled: Number(cancelled.meta?.changes || 0), archived: Number(archived.meta?.changes || 0) };
}

async function resetPendingFirstPassQueue(db: D1Database): Promise<{
  cancelled_first_pass: number;
  retained_resynthesis: number;
  prediction_delay_samples_reset: number;
}> {
  const [firstPass, resynthesis, delaySamples] = await Promise.all([
    db.prepare(
      "SELECT COUNT(*) AS count FROM research_jobs WHERE status = 'pending' AND NOT EXISTS (SELECT 1 FROM research_results WHERE research_results.job_id = research_jobs.id)",
    ).first<{ count: number }>(),
    db.prepare(
      "SELECT COUNT(*) AS count FROM research_jobs WHERE status = 'pending' AND EXISTS (SELECT 1 FROM research_results WHERE research_results.job_id = research_jobs.id)",
    ).first<{ count: number }>(),
    db.prepare(
      "SELECT COUNT(*) AS count FROM research_jobs WHERE status = 'succeeded' AND prediction_delay_eligible = 1 AND prediction_delay_seconds IS NOT NULL",
    ).first<{ count: number }>(),
  ]);

  await db.batch([
    db.prepare("UPDATE research_jobs SET prediction_delay_eligible = 0 WHERE prediction_delay_eligible != 0"),
    db.prepare(
      "UPDATE research_jobs SET status = 'cancelled', last_error = 'Cleared first-pass queue during delay reset', finished_at = CURRENT_TIMESTAMP, synthesis_duration_seconds = NULL, prediction_delay_seconds = NULL, research_slot = NULL WHERE status = 'pending' AND NOT EXISTS (SELECT 1 FROM research_results WHERE research_results.job_id = research_jobs.id)",
    ),
    db.prepare(
      "UPDATE articles SET status = 'archived' WHERE status != 'archived' AND EXISTS (SELECT 1 FROM research_jobs WHERE research_jobs.article_id = articles.id AND research_jobs.status = 'cancelled' AND research_jobs.last_error = 'Cleared first-pass queue during delay reset')",
    ),
  ]);

  return {
    cancelled_first_pass: Number(firstPass?.count || 0),
    retained_resynthesis: Number(resynthesis?.count || 0),
    prediction_delay_samples_reset: Number(delaySamples?.count || 0),
  };
}

const STALE_BACKFILL_ARTICLE_SQL = `
  SELECT articles.id
  FROM articles
  WHERE articles.published_at IS NOT NULL
    AND datetime(articles.published_at) < datetime(articles.discovered_at, '-${ARTICLE_INGESTION_WINDOW_MINUTES} minutes')
    AND NOT EXISTS (
      SELECT 1
      FROM research_results AS preserved_results
      WHERE preserved_results.article_id = articles.id
        AND datetime(preserved_results.created_at) < datetime(?)
    )
`;

async function purgeStaleHistoricalBackfill(env: Env): Promise<Record<string, number | string>> {
  await ensurePredictionOutcomeTables(env);
  const db = env.NEWS_DB;
  const articleFilter = `article_id IN (${STALE_BACKFILL_ARTICLE_SQL})`;
  const resultFilter = `result_id IN (SELECT id FROM research_results WHERE ${articleFilter})`;
  const outcomeFilter = `outcome_id IN (SELECT id FROM prediction_outcomes WHERE ${articleFilter})`;
  const bindCutoff = (sql: string) => db.prepare(sql).bind(SOURCE_EXPANSION_CUTOFF);

  const [articles, results, outcomes, dailyPoints] = await Promise.all([
    bindCutoff(`SELECT COUNT(*) AS count FROM articles WHERE status != 'archived' AND id IN (${STALE_BACKFILL_ARTICLE_SQL})`).first<{ count: number }>(),
    bindCutoff(`SELECT COUNT(*) AS count FROM research_results WHERE ${articleFilter}`).first<{ count: number }>(),
    bindCutoff(`SELECT COUNT(*) AS count FROM prediction_outcomes WHERE ${articleFilter}`).first<{ count: number }>(),
    bindCutoff(`SELECT COUNT(*) AS count FROM prediction_daily_points_v2 WHERE ${outcomeFilter}`).first<{ count: number }>(),
  ]);

  await db.batch([
    bindCutoff(`DELETE FROM prediction_daily_points_v2 WHERE ${outcomeFilter}`),
    bindCutoff(`DELETE FROM prediction_outcome_scans WHERE ${resultFilter}`),
    bindCutoff(`DELETE FROM simulation_trades WHERE ${resultFilter}`),
    bindCutoff(`DELETE FROM simulation_processed_results WHERE ${resultFilter}`),
    bindCutoff(`DELETE FROM prediction_outcomes WHERE ${articleFilter}`),
    bindCutoff(`DELETE FROM price_impacts WHERE ${articleFilter}`),
    bindCutoff(
      `UPDATE research_jobs SET status = 'cancelled', last_error = 'Purged stale historical backfill', finished_at = CURRENT_TIMESTAMP, synthesis_duration_seconds = NULL, prediction_delay_seconds = NULL, prediction_delay_eligible = 0, research_slot = NULL WHERE ${articleFilter}`,
    ),
    bindCutoff(`DELETE FROM research_results WHERE ${articleFilter}`),
    bindCutoff(`UPDATE articles SET status = 'archived' WHERE id IN (${STALE_BACKFILL_ARTICLE_SQL})`),
  ]);

  return {
    archived_articles: Number(articles?.count || 0),
    deleted_results: Number(results?.count || 0),
    deleted_outcomes: Number(outcomes?.count || 0),
    deleted_daily_points: Number(dailyPoints?.count || 0),
    preserved_before: SOURCE_EXPANSION_CUTOFF,
    acquisition_window_minutes: ARTICLE_INGESTION_WINDOW_MINUTES,
  };
}

async function ensureArticleStorageSchema(db: D1Database): Promise<void> {
  if (!articleStorageSchemaReady) {
    articleStorageSchemaReady = (async () => {
      await addColumnIfMissing(db, "sources", "source_type", "TEXT NOT NULL DEFAULT 'editorial'");
      await addColumnIfMissing(db, "articles", "content_plaintext", "TEXT");
      await addColumnIfMissing(db, "articles", "content_source", "TEXT");
      await addColumnIfMissing(db, "articles", "content_status", "TEXT NOT NULL DEFAULT 'pending'");
      await addColumnIfMissing(db, "articles", "content_fetched_at", "TEXT");
      await addColumnIfMissing(db, "articles", "content_fetch_attempts", "INTEGER NOT NULL DEFAULT 0");
      await addColumnIfMissing(db, "articles", "content_error", "TEXT");
      await addColumnIfMissing(db, "research_jobs", "synthesis_duration_seconds", "INTEGER");
      await addColumnIfMissing(db, "research_jobs", "prediction_delay_seconds", "INTEGER");
      await addColumnIfMissing(db, "research_jobs", "research_slot", "INTEGER");
      await addColumnIfMissing(db, "research_jobs", "prediction_delay_eligible", "INTEGER NOT NULL DEFAULT 0");
      await db.prepare(
        "CREATE INDEX IF NOT EXISTS idx_articles_content_backfill ON articles(content_status, content_fetch_attempts, discovered_at)",
      ).run();
      await db.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_research_jobs_running_slot ON research_jobs(research_slot) WHERE status = 'running' AND research_slot IS NOT NULL",
      ).run();
      await db.prepare(
        "CREATE INDEX IF NOT EXISTS idx_research_jobs_prediction_delay_cohort ON research_jobs(prediction_delay_eligible, status, finished_at)",
      ).run();
      await db.prepare(
        "UPDATE research_jobs SET synthesis_duration_seconds = MAX(0, unixepoch(finished_at) - unixepoch(started_at)) WHERE synthesis_duration_seconds IS NULL AND started_at IS NOT NULL AND finished_at IS NOT NULL AND status IN ('succeeded', 'failed')",
      ).run();
      await db.prepare(
        "UPDATE research_jobs SET prediction_delay_seconds = (SELECT MAX(0, unixepoch(research_results.created_at) - unixepoch(articles.published_at)) FROM research_results INNER JOIN articles ON articles.id = research_results.article_id WHERE research_results.job_id = research_jobs.id AND articles.published_at IS NOT NULL AND research_results.symbols IS NOT NULL AND trim(research_results.symbols) NOT IN ('', '[]')) WHERE prediction_delay_seconds IS NULL AND prediction_delay_eligible = 1 AND status = 'succeeded'",
      ).run();
      await pruneLegacyFirstPassBacklog(db);
    })().catch((error) => {
      articleStorageSchemaReady = null;
      throw error;
    });
  }
  await articleStorageSchemaReady;
}

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
      grid-template-columns: repeat(4, minmax(0, 1fr));
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

    #simulation-panel > .panel {
      overflow: visible;
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
      font-weight: 400;
      line-height: 1.2;
      max-width: 100%;
    }

    .pill.green { background: #e6f4ee; color: var(--green); }
    .pill.red { background: #fdecec; color: var(--red); }
    .pill.amber { background: #fff2d6; color: var(--amber); }
    .pill.blue { background: #e8f1ff; color: var(--blue); }
    .pill.accuracy-counted { font-weight: 750; }

    .summary {
      margin-top: 10px;
      color: #344054;
      font-size: 13px;
      line-height: 1.45;
    }

    .note {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
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

    @keyframes skeletonPulse {
      0%, 100% { opacity: 0.48; }
      50% { opacity: 0.9; }
    }

    .skeleton-block {
      display: block;
      background: #dfe4ea;
      border-radius: 4px;
      animation: skeletonPulse 1.15s ease-in-out infinite;
    }

    .skeleton-metric {
      min-height: 86px;
      padding: 14px;
    }

    .skeleton-line {
      height: 11px;
      margin-top: 9px;
    }

    .skeleton-line.short { width: 34%; }
    .skeleton-line.medium { width: 58%; }
    .skeleton-line.long { width: 86%; }

    .skeleton-result {
      padding: 16px 14px;
      border-bottom: 1px solid var(--line);
    }

    .prediction-skeleton-grid {
      display: grid;
      grid-template-columns: 76px repeat(10, minmax(72px, 1fr));
      gap: 5px;
      min-width: 1120px;
      padding: 12px;
    }

    .prediction-skeleton-cell {
      height: 38px;
    }

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

    .prediction-outcomes-table .prediction-article-row th {
      padding: 12px;
      background: #f8fafc;
      color: var(--text);
      font-size: 13px;
      text-transform: none;
      white-space: normal;
    }

    .prediction-outcomes-table {
      min-width: 1920px;
    }

    .prediction-article-row a {
      display: block;
      width: min(1000px, calc(100vw - 72px));
      max-width: 100%;
      color: var(--text);
      font-weight: 750;
      line-height: 1.4;
      text-decoration: none;
      overflow-wrap: anywhere;
    }

    .prediction-article-row a:hover { text-decoration: underline; }

    .prediction-outcomes-table .prediction-data-row td {
      white-space: nowrap;
    }

    .prediction-outcomes-table .prediction-data-row .pill {
      width: max-content;
      max-width: none;
      white-space: nowrap;
    }

    .prediction-sticky-header {
      position: sticky;
      top: 0;
      z-index: 7;
      overflow: hidden;
      padding: 0 12px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }

    .prediction-sticky-header .prediction-outcomes-table {
      margin: 0;
      will-change: transform;
    }

    .prediction-sticky-header thead th {
      background: #e9edf3;
      box-shadow: 0 1px 0 var(--line), 0 4px 8px rgba(16, 24, 40, 0.08);
    }

    .heatmap-stack {
      display: grid;
      gap: 18px;
      padding: 14px;
      min-width: 0;
    }

    .heatmap-section {
      width: 100%;
      min-width: 0;
    }

    .heatmap-heading {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }

    .heatmap-title {
      font-size: 13px;
      font-weight: 750;
    }

    .heatmap-axis-label {
      color: var(--muted);
      font-size: 11px;
    }

    .heatmap-scroll {
      width: 100%;
      max-width: 100%;
      min-width: 0;
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 6px;
    }

    .confidence-heatmap {
      width: 100%;
      min-width: var(--heatmap-min-width, 100%);
      table-layout: fixed;
    }

    .confidence-heatmap th,
    .confidence-heatmap td {
      padding: 7px 5px;
      text-align: center;
      vertical-align: middle;
    }

    .confidence-heatmap th:first-child,
    .confidence-heatmap td:first-child {
      width: 132px;
      text-align: center;
      font-weight: 700;
    }

    .confidence-heatmap th:nth-child(2),
    .confidence-heatmap td:nth-child(2) {
      width: 76px;
      text-align: left;
      padding-left: 10px;
      font-weight: 700;
    }

    .heatmap-cell {
      height: 42px;
      font-size: 11px;
      font-weight: 750;
      white-space: nowrap;
      transition: box-shadow 120ms ease;
    }

    .heatmap-filter-button {
      width: 100%;
      height: 100%;
      border: 0;
      padding: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      white-space: nowrap;
      cursor: pointer;
    }

    .heatmap-accuracy {
      font-weight: 650;
      opacity: 0.86;
    }

    .heatmap-samples {
      margin-left: 2px;
      font-size: 9px;
      line-height: 0;
      vertical-align: super;
      cursor: help;
    }

    .heatmap-cell.clickable:hover,
    .heatmap-cell.active-filter {
      box-shadow: inset 0 0 0 2px #123c69;
    }

    .heatmap-cell.active-filter {
      box-shadow: inset 0 0 0 3px #123c69;
    }

    .heatmap-empty { background: #f3f4f6; color: #98a2b3; }
    .heatmap-scale-wrong { background: #dc2626; }
    .heatmap-scale-neutral { background: #facc15; }
    .heatmap-scale-correct { background: #16a34a; }
    .heatmap-scale-outlier-wrong { background: #7f1d1d; }
    .heatmap-scale-outlier-correct { background: #14532d; }

    .heatmap-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      color: var(--muted);
      font-size: 11px;
    }

    .heatmap-legend-item {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .heatmap-legend-item[title] { cursor: help; }

    .heatmap-swatch {
      width: 13px;
      height: 13px;
      border: 1px solid rgba(16, 24, 40, 0.08);
      border-radius: 3px;
    }

    .heatmap-outlier-swatches {
      display: inline-flex;
      gap: 2px;
    }

    .prediction-trend-section {
      border-top: 1px solid var(--line);
      padding: 14px;
    }

    .prediction-trend-heading {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }

    .prediction-trend-title {
      color: var(--text);
      font-size: 13px;
      font-weight: 750;
    }

    .prediction-trend-meta {
      color: var(--muted);
      font-size: 11px;
      text-align: right;
    }

    .prediction-trend-chart {
      width: 100%;
      height: 320px;
      min-height: 320px;
      overflow-x: auto;
      overflow-y: hidden;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fbfcfe;
    }

    .prediction-trend-chart svg {
      display: block;
      width: 100%;
      min-width: 760px;
      height: 100%;
    }

    .prediction-trend-chart .empty {
      min-height: 318px;
      display: grid;
      place-items: center;
      padding: 24px;
      text-align: center;
    }

    .prediction-filterbar {
      display: flex;
      align-items: end;
      flex-wrap: wrap;
      gap: 10px 14px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      background: #fbfcfe;
    }

    .prediction-filter-group {
      display: grid;
      gap: 5px;
    }

    .prediction-filter-label {
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .prediction-direction-control {
      display: inline-flex;
      border: 1px solid var(--line);
      border-radius: 6px;
      overflow: hidden;
    }

    .prediction-direction-button {
      min-height: 34px;
      border: 0;
      border-right: 1px solid var(--line);
      padding: 0 11px;
      background: #fff;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }

    .prediction-direction-button:last-child { border-right: 0; }
    .prediction-direction-button.active { background: #e8f1ff; color: #123c69; }

    .prediction-confidence-select {
      min-width: 150px;
      height: 36px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0 9px;
      background: #fff;
      color: var(--text);
    }

    .prediction-filter-status {
      margin-left: auto;
      min-height: 34px;
      display: flex;
      align-items: center;
      color: var(--muted);
      font-size: 12px;
    }

    .job-timing {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }

    .prediction-page-loader {
      display: grid;
      gap: 8px;
      padding: 12px 14px 16px;
    }

    .prediction-page-loader .skeleton-line { margin-top: 0; height: 16px; }
    .prediction-scroll-sentinel { height: 1px; }

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
      .confidence-heatmap th:nth-child(3),
      .confidence-heatmap td:nth-child(3) { display: table-cell; }
      .prediction-outcomes-table th:nth-child(3),
      .prediction-outcomes-table td:nth-child(3) { display: table-cell; }
      .prediction-filter-status { width: 100%; margin-left: 0; }
      .prediction-trend-heading { align-items: flex-start; flex-direction: column; }
      .prediction-trend-meta { text-align: left; }
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
          <span id="live-status-updated">Live status waiting</span>
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
      <button class="tab active" id="simulation-tab" type="button">Prediction Accuracy</button>
      <button class="tab" id="overview-tab" type="button">Overview</button>
    </nav>

    <section id="overview-panel" class="hidden">
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

    <section id="simulation-panel">
      <section class="panel">
        <div class="model-blurb">Prediction Accuracy tracks every bullish or bearish ticker prediction against real market movement. Price collection continues for every call at 12h, 24h, 48h, 1w, 2w, 1m, 3m, 6m, 1y, 2y, 3y, and 4y. A call contributes to the accuracy charts only until a later opposite call is made for the same ticker; same-direction calls continue in parallel.</div>
        <div class="panel-header">
          <div class="panel-title">Accuracy by Interval and Confidence</div>
          <div class="panel-meta" id="prediction-summary-meta">0 intervals</div>
        </div>
        <div id="prediction-summary"></div>
        <div class="prediction-trend-section">
          <div class="prediction-trend-heading">
            <div class="prediction-trend-title">Average Call Movement Over Time</div>
            <div class="prediction-trend-meta" id="prediction-trend-meta">Daily history is loading</div>
          </div>
          <div class="prediction-trend-chart" id="prediction-trend-chart" aria-live="polite"></div>
        </div>
      </section>

      <section class="panel" style="margin-top:14px">
        <div class="panel-header">
          <div class="panel-title">Prediction Outcomes</div>
          <div class="panel-meta" id="predictions-meta">0 rows</div>
        </div>
        <div id="predictions"></div>
      </section>
    </section>
  </main>

  <script>
    const tokenInput = document.getElementById("token-input");
    const authState = document.getElementById("auth-state");
    const lastUpdated = document.getElementById("last-updated");
    const liveStatusUpdated = document.getElementById("live-status-updated");
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
    const overviewPanel = document.getElementById("overview-panel");
    const simulationPanel = document.getElementById("simulation-panel");
    const settingsPanel = document.getElementById("settings-panel");
    const predictionSummaryEl = document.getElementById("prediction-summary");
    const predictionSummaryMeta = document.getElementById("prediction-summary-meta");
    const predictionTrendChartEl = document.getElementById("prediction-trend-chart");
    const predictionTrendMeta = document.getElementById("prediction-trend-meta");
    const predictionsEl = document.getElementById("predictions");
    const predictionsMeta = document.getElementById("predictions-meta");
    const liveModelTab = null;
    const eodModelTab = null;
    const liveModelPanel = null;
    const eodModelPanel = null;
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
    let predictionsLoaded = false;
    let predictionSummaryData = [];
    let predictionCoverage = {};
    let predictionDailySeries = [];
    let predictionDailyCoverage = {};
    let predictionNextCursor = null;
    let predictionHasMore = false;
    let predictionLoading = false;
    let predictionRequestVersion = 0;
    let predictionLoadedCount = 0;
    let predictionTotal = 0;
    let predictionLastArticleKey = null;
    let predictionObserver = null;
    let latestStatus = null;
    let liveStatusTimer = null;
    let liveStatusLoading = false;
    const predictionLoadedArticles = new Set();
    const predictionFilters = { direction: "all", confidenceBin: null };
    const PREDICTION_PAGE_SIZE = 50;
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
      predictionsLoaded = false;
      eodSimulationLoaded = false;
      syncAuthState();
      startLiveStatusPolling();
      loadAll();
    });

    document.getElementById("clear-token-btn").addEventListener("click", () => {
      clearStoredToken();
      tokenInput.value = "";
      predictionsLoaded = false;
      eodSimulationLoaded = false;
      syncAuthState();
      stopLiveStatusPolling();
      liveStatusUpdated.textContent = "Live status waiting";
    });

    document.getElementById("refresh-btn").addEventListener("click", loadAll);
    document.getElementById("ingest-btn").addEventListener("click", () => runAction("/api/ingest"));
    document.getElementById("requeue-btn").addEventListener("click", () => runAction("/api/requeue-pending?limit=10"));
    overviewTab.addEventListener("click", () => setTab("overview"));
    simulationTab.addEventListener("click", () => setTab("simulation"));
    settingsBtn.addEventListener("click", () => setTab("settings"));
    predictionSummaryEl.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-heatmap-direction]") : null;
      if (!target) return;
      const confidenceBin = target.getAttribute("data-confidence-bin");
      setPredictionFilters(target.getAttribute("data-heatmap-direction") || "all", confidenceBin === "all" ? null : Number(confidenceBin));
    });
    predictionsEl.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const directionButton = target?.closest("[data-outcome-direction]");
      if (directionButton) {
        setPredictionFilters(directionButton.getAttribute("data-outcome-direction") || "all", predictionFilters.confidenceBin);
        return;
      }
      if (target?.closest("[data-reset-prediction-filters]")) setPredictionFilters("all", null);
    });
    predictionsEl.addEventListener("change", (event) => {
      const select = event.target instanceof HTMLSelectElement && event.target.id === "prediction-confidence-filter" ? event.target : null;
      if (!select) return;
      setPredictionFilters(predictionFilters.direction, select.value === "all" ? null : Number(select.value));
    });

    function setTab(tab) {
      const simulation = tab === "simulation";
      const settings = tab === "settings";
      overviewTab.classList.toggle("active", !simulation && !settings);
      simulationTab.classList.toggle("active", simulation);
      overviewPanel.classList.toggle("hidden", simulation || settings);
      simulationPanel.classList.toggle("hidden", !simulation);
      settingsPanel.classList.toggle("hidden", !settings);
      settingsBtn.classList.toggle("active", settings);
      if (simulation && !predictionsLoaded) loadPredictions();
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
        predictionsLoaded = false;
        await loadAll();
      } catch (error) {
        showError(metricsEl, error);
      } finally {
        setBusy(false);
      }
    }

    async function loadAll() {
      if (!metricsEl.children.length) showInitialSkeletons();
      setBusy(true);
      try {
        const [status, results, jobs] = await Promise.all([
          api("/api/status"),
          api("/api/results?limit=20"),
          api("/api/jobs?limit=12"),
        ]);
        latestStatus = status;
        renderMetrics(latestStatus);
        renderResults(results.results || []);
        renderJobs(jobs.jobs || []);
        renderArticles(results.results || []);
        lastUpdated.textContent = "Data refreshed " + new Date().toLocaleTimeString();
        liveStatusUpdated.textContent = "Live status " + new Date().toLocaleTimeString();
        if (!simulationPanel.classList.contains("hidden")) {
          predictionsLoaded = false;
          await loadPredictions();
        }
      } catch (error) {
        showError(metricsEl, error);
        resultsEl.innerHTML = "";
        jobsEl.innerHTML = "";
        articlesEl.innerHTML = "";
      } finally {
        setBusy(false);
      }
    }

    async function loadPredictions() {
      if (predictionLoading) return;
      const requestVersion = ++predictionRequestVersion;
      predictionLoading = true;
      showPredictionSkeletons();
      setBusy(true);
      try {
        const payload = await api(predictionRequestPath("/api/predictions"));
        if (requestVersion !== predictionRequestVersion) return;
        predictionSummaryData = payload.summary || [];
        predictionCoverage = payload.coverage || {};
        renderPredictions(payload);
        predictionsLoaded = true;
      } catch (error) {
        if (requestVersion !== predictionRequestVersion) return;
        showError(predictionsEl, error);
      } finally {
        if (requestVersion === predictionRequestVersion) {
          predictionLoading = false;
          observePredictionSentinel();
        }
        setBusy(false);
      }
    }

    function mergeLiveStatus(current, live) {
      if (!current) return current;
      const jobCounts = new Map((current.jobs || []).map((item) => [item.status, item]));
      for (const item of live.jobs || []) jobCounts.set(item.status, item);
      return { ...current, jobs: [...jobCounts.values()], timing: live.timing || current.timing, active_jobs: live.active_jobs || [] };
    }

    async function refreshLiveStatus() {
      if (liveStatusLoading || document.hidden || !tokenInput.value.trim()) return;
      liveStatusLoading = true;
      try {
        const live = await api("/api/status/live");
        latestStatus = mergeLiveStatus(latestStatus, live);
        if (latestStatus) renderMetrics(latestStatus);
        syncRunningJobTimers(live.active_jobs || []);
        liveStatusUpdated.textContent = "Live status " + new Date().toLocaleTimeString();
      } catch (error) {
        liveStatusUpdated.textContent = "Live status unavailable";
      } finally {
        liveStatusLoading = false;
      }
    }

    function startLiveStatusPolling() {
      if (liveStatusTimer) return;
      liveStatusTimer = setInterval(refreshLiveStatus, 5000);
    }

    function stopLiveStatusPolling() {
      if (!liveStatusTimer) return;
      clearInterval(liveStatusTimer);
      liveStatusTimer = null;
    }

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshLiveStatus();
    });

    async function reloadPredictionOutcomes() {
      const requestVersion = ++predictionRequestVersion;
      predictionLoading = true;
      renderPredictionOutcomeShell(true);
      try {
        const payload = await api(predictionRequestPath("/api/predictions/outcomes"));
        if (requestVersion !== predictionRequestVersion) return;
        applyPredictionPage(payload, true);
      } catch (error) {
        if (requestVersion === predictionRequestVersion) showError(predictionsEl, error);
      } finally {
        if (requestVersion === predictionRequestVersion) {
          predictionLoading = false;
          observePredictionSentinel();
        }
      }
    }

    async function loadMorePredictions() {
      if (predictionLoading || !predictionHasMore || !predictionNextCursor) return;
      const requestVersion = predictionRequestVersion;
      let loadFailed = false;
      predictionLoading = true;
      setPredictionPageLoading(true);
      try {
        const payload = await api(predictionRequestPath("/api/predictions/outcomes", predictionNextCursor));
        if (requestVersion !== predictionRequestVersion) return;
        applyPredictionPage(payload, false);
      } catch (error) {
        loadFailed = true;
        if (requestVersion === predictionRequestVersion) showPredictionPageError(error);
      } finally {
        if (requestVersion === predictionRequestVersion) {
          predictionLoading = false;
          if (!loadFailed) {
            setPredictionPageLoading(false);
            observePredictionSentinel();
          }
        }
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

    function predictionLoadingRows() {
      return Array.from({ length: 4 }, (_, index) => '<span class="skeleton-block skeleton-line ' + (index % 2 ? 'long' : 'medium') + '"></span>').join("");
    }

    function showInitialSkeletons() {
      metricsEl.innerHTML = Array.from({ length: 7 }, () => '<div class="metric skeleton-metric"><span class="skeleton-block skeleton-line short"></span><span class="skeleton-block skeleton-line medium"></span><span class="skeleton-block skeleton-line long"></span></div>').join("");
      resultsEl.innerHTML = Array.from({ length: 5 }, () => '<div class="skeleton-result"><span class="skeleton-block skeleton-line long"></span><span class="skeleton-block skeleton-line medium"></span><span class="skeleton-block skeleton-line long"></span></div>').join("");
      jobsEl.innerHTML = '<div class="prediction-page-loader">' + predictionLoadingRows() + '</div>';
      articlesEl.innerHTML = '<div class="prediction-page-loader">' + predictionLoadingRows() + '</div>';
    }

    function showPredictionSkeletons() {
      predictionSummaryMeta.textContent = "Loading interval summary";
      const skeletonCells = Array.from({ length: 66 }, () => '<span class="skeleton-block prediction-skeleton-cell"></span>').join("");
      predictionSummaryEl.innerHTML = '<div class="heatmap-stack"><div class="heatmap-scroll"><div class="prediction-skeleton-grid">' + skeletonCells + '</div></div></div>';
      predictionTrendMeta.textContent = "Loading daily movement history";
      predictionTrendChartEl.innerHTML = '<div class="prediction-page-loader">' + predictionLoadingRows() + predictionLoadingRows() + '</div>';
      predictionsMeta.textContent = "Loading outcomes";
      predictionsEl.innerHTML = '<div class="prediction-page-loader">' + predictionLoadingRows() + predictionLoadingRows() + '</div>';
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
      const timing = status.timing || {};
      const capacity = Number(timing.parallel_capacity || 4);
      const synthesisSamples = Number(timing.synthesis_samples || 0);
      const delaySamples = Number(timing.prediction_delay_samples || 0);
      metricsEl.innerHTML = [
        metric("Articles", analyzed + queued, analyzed + " actionable analyzed, " + queued + " queued"),
        metric("Results", results, succeeded + " succeeded"),
        metric("Running", running, running + " of " + capacity + " parallel Codex workers active"),
        metric("Pending", pending, timing.estimated_queue_seconds === null || timing.estimated_queue_seconds === undefined ? "Queue estimate unavailable" : "Estimated clear in " + formatDuration(timing.estimated_queue_seconds) + " at " + capacity + " workers"),
        metric("Failed", failed, "Needs review"),
        metric("Avg synthesis", formatDuration(timing.average_synthesis_seconds), synthesisSamples + " completed article" + (synthesisSamples === 1 ? "" : "s")),
        metric("Avg prediction delay", formatDuration(timing.average_prediction_delay_seconds), delaySamples + " new first-pass prediction sample" + (delaySamples === 1 ? "" : "s")),
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
        const hasStructuredImpacts = Array.isArray(parsed.impact_details);
        const impactRows = impactDetails.length ? impactDetails.map((impact) => [
          pill(impact.kind || "impact", "blue", "Impact category identified by Codex after reasoning through the event's causal path."),
          escapeHtml(impact.name || impact.symbol || "Unknown"),
          escapeHtml(impact.symbol || "private/n/a"),
          pill(impact.direction || "unknown", directionClass(impact.direction), "Speculated stock value direction from this event: bullish, bearish, mixed, neutral, or unknown."),
          pill(formatNumber(impact.confidence), "green", "Confidence for this specific impacted entity, based on how direct and explicit the causal path is."),
          escapeHtml(impact.reason || ""),
        ]) : hasStructuredImpacts ? [[
          pill("no material impact", "", "Codex completed a structured analysis but found no defensible public-ticker impact."),
          escapeHtml(parseArray(item.companies).join(", ") || "No directly affected public company"),
          "n/a",
          pill("neutral", "", "No bullish or bearish public-ticker prediction was recorded."),
          pill(formatNumber(item.confidence), "green", "Confidence in the completed event analysis."),
          escapeHtml(item.summary || parsed.summary || "No concrete public-ticker causal path was identified."),
        ]] : [[
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
      const renderedAt = Date.now();
      jobsEl.innerHTML = table(["Status", "Worker", "Duration", "Post to prediction", "Attempts", "Article"], jobs.map((job) => {
        const duration = job.elapsed_synthesis_seconds === null || job.elapsed_synthesis_seconds === undefined
          ? Number.NaN
          : Number(job.elapsed_synthesis_seconds);
        const durationText = formatDuration(duration);
        const durationHtml = job.status === "running" && Number.isFinite(duration)
          ? '<span class="job-timing" data-job-timer data-job-id="' + escapeAttr(job.id) + '" data-running-job-timer data-base-seconds="' + escapeAttr(duration) + '" data-rendered-at="' + renderedAt + '">' + escapeHtml(durationText) + '</span>'
          : '<span class="job-timing">' + escapeHtml(durationText) + '</span>';
        return [
        pill(job.status || "unknown", statusClass(job.status), "Current durable research job state in D1 and Cloudflare Queues."),
        escapeHtml(job.status === "running" && Number.isInteger(Number(job.research_slot)) ? "#" + (Number(job.research_slot) + 1) : "n/a"),
        durationHtml,
        '<span class="job-timing" title="Elapsed time from the article publication timestamp to entry of its actionable ticker prediction.">' + escapeHtml(formatDuration(job.prediction_delay_seconds)) + '</span>',
        escapeHtml(String(job.attempts || 0)),
        '<a class="truncate" href="' + escapeAttr(job.url || "#") + '" target="_blank" rel="noreferrer">' + escapeHtml(job.title || job.article_id || "Article") + '</a>',
        ];
      }));
    }

    function updateRunningJobTimers() {
      const now = Date.now();
      for (const timer of document.querySelectorAll("[data-running-job-timer]")) {
        const base = Number(timer.getAttribute("data-base-seconds"));
        const renderedAt = Number(timer.getAttribute("data-rendered-at"));
        if (!Number.isFinite(base) || !Number.isFinite(renderedAt)) continue;
        timer.textContent = formatDuration(base + Math.max(0, Math.floor((now - renderedAt) / 1000)));
      }
    }

    function syncRunningJobTimers(activeJobs) {
      const activeById = new Map((activeJobs || []).map((job) => [String(job.id), job]));
      const now = Date.now();
      for (const timer of document.querySelectorAll("[data-job-timer]")) {
        const active = activeById.get(timer.getAttribute("data-job-id") || "");
        if (!active) {
          timer.removeAttribute("data-running-job-timer");
          timer.textContent = "complete; refresh";
          continue;
        }
        const elapsed = Number(active.elapsed_synthesis_seconds);
        if (!Number.isFinite(elapsed)) continue;
        timer.setAttribute("data-running-job-timer", "");
        timer.setAttribute("data-base-seconds", String(elapsed));
        timer.setAttribute("data-rendered-at", String(now));
        timer.textContent = formatDuration(elapsed);
      }
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
        pill(formatNumber(item.sentiment_score), Number(item.sentiment_score || 0) > 0.1 ? "green" : Number(item.sentiment_score || 0) < -0.1 ? "red" : "amber", "Article-level perception score used to record directional prediction outcomes."),
        pill(formatNumber(item.confidence), "green", "Article-level confidence."),
      ]));
    }

    function renderPredictions(payload) {
      predictionSummaryData = payload.summary || [];
      predictionCoverage = payload.coverage || {};
      predictionDailySeries = payload.daily_series || [];
      predictionDailyCoverage = payload.daily_coverage || {};
      renderPredictionSummary(predictionSummaryData, predictionCoverage);
      renderPredictionDailyChart();
      renderPredictionOutcomeShell(false);
      applyPredictionPage(payload, true);
    }

    function renderPredictionSummary(summary, coverage) {
      const trackedPredictions = Number(coverage.predictions || 0);
      const trackedArticles = Number(coverage.articles || 0);
      const repairPending = Number(coverage.date_repair_pending || 0);
      const dimensions = predictionSummaryDimensions(summary);
      predictionSummaryMeta.textContent = dimensions.intervals.length + " intervals · " + trackedPredictions + " corrected ticker predictions across " + trackedArticles + " articles" + (repairPending ? " · " + repairPending + " analyses rebuilding dates" : "");
      predictionSummaryEl.innerHTML = dimensions.intervals.length && dimensions.confidenceBins.length
        ? '<div class="heatmap-stack">' +
            renderConfidenceHeatmap(dimensions.intervals, "bullish", dimensions.confidenceBins) +
            renderConfidenceHeatmap(dimensions.intervals, "bearish", dimensions.confidenceBins) +
            '<div class="heatmap-legend" aria-label="Average movement colour legend">' +
              heatmapLegendItem("heatmap-scale-wrong", "Strongest wrong-direction average") +
              heatmapLegendItem("heatmap-scale-neutral", "0% average movement") +
              heatmapLegendItem("heatmap-scale-correct", "Strongest correct-direction average") +
              heatmapOutlierLegendItem() +
              heatmapLegendItem("heatmap-empty", "No samples") +
            '</div>' +
          '</div>'
        : '<div class="empty">No prediction intervals have elapsed yet.</div>';
    }

    function predictionSummaryDimensions(summary) {
      const intervals = summary.filter((item) => ["bullish", "bearish"].some((direction) =>
        Array.isArray(item[direction]) && item[direction].some((cell) => Number(cell && cell.samples || 0) > 0),
      ));
      const confidenceBins = Array.from({ length: 10 }, (_, index) => index).filter((index) =>
        intervals.some((item) => ["bullish", "bearish"].some((direction) => Number(item[direction] && item[direction][index] && item[direction][index].samples || 0) > 0)),
      );
      return { intervals, confidenceBins };
    }

    function renderPredictionOutcomeShell(loading) {
      if (predictionObserver) predictionObserver.disconnect();
      predictionObserver = null;
      predictionNextCursor = null;
      predictionHasMore = false;
      predictionLoadedCount = 0;
      predictionTotal = 0;
      predictionLastArticleKey = null;
      predictionLoadedArticles.clear();
      const intervals = ["12h", "24h", "48h", "1w", "2w", "1m", "3m", "6m", "1y", "2y", "3y", "4y"];
      const headers = ["Date", "Ticker", "Dir", "Score", "Conf", "Baseline", ...intervals];
      const columns = [200, 90, 100, 80, 80, 110];
      const intervalColumns = intervals.map((interval) => '<col data-prediction-interval="' + interval + '" style="width:150px">').join("");
      const colgroup = '<colgroup>' + columns.map((width) => '<col style="width:' + width + 'px">').join("") + intervalColumns + '</colgroup>';
      const header = '<thead><tr>' + headers.map((item) => '<th>' + escapeHtml(item) + '</th>').join("") + '</tr></thead>';
      const initialTableWidth = columns.reduce((sum, width) => sum + width, 0) + intervals.length * 150;
      predictionsEl.innerHTML = predictionFilterBarHtml() +
        '<div class="empty hidden" id="prediction-list-empty">No predictions match these filters.</div>' +
        '<div class="prediction-sticky-header hidden" id="prediction-sticky-header"><table class="prediction-outcomes-table" id="prediction-sticky-table" style="width:' + initialTableWidth + 'px;min-width:' + initialTableWidth + 'px">' + colgroup + header + '</table></div>' +
        '<div class="impact-wrap hidden" id="prediction-table-shell"><table class="prediction-outcomes-table" id="prediction-outcomes-table" style="width:' + initialTableWidth + 'px;min-width:' + initialTableWidth + 'px">' + colgroup + '<tbody id="prediction-outcomes-body"></tbody></table></div>' +
        '<div class="prediction-page-loader' + (loading ? '' : ' hidden') + '" id="prediction-page-loader" aria-label="Loading prediction outcomes">' + predictionLoadingRows() + '</div>' +
        '<div class="prediction-scroll-sentinel" id="prediction-scroll-sentinel" aria-hidden="true"></div>';
      bindPredictionHeaderScroll();
      updatePredictionFilterUi();
    }

    function bindPredictionHeaderScroll() {
      const shell = document.getElementById("prediction-table-shell");
      const stickyTable = document.getElementById("prediction-sticky-table");
      if (!shell || !stickyTable) return;
      const sync = () => {
        stickyTable.style.transform = "translateX(-" + shell.scrollLeft + "px)";
      };
      shell.addEventListener("scroll", sync, { passive: true });
      sync();
    }

    function predictionFilterBarHtml() {
      const confidenceOptions = ['<option value="all">All confidence</option>'].concat(Array.from({ length: 10 }, (_, index) => '<option value="' + index + '">' + (index * 10) + '-' + ((index + 1) * 10) + '%</option>')).join("");
      return '<div class="prediction-filterbar">' +
        '<div class="prediction-filter-group"><span class="prediction-filter-label">Direction</span><div class="prediction-direction-control" role="group" aria-label="Prediction direction">' +
          '<button class="prediction-direction-button" type="button" data-outcome-direction="all">All</button>' +
          '<button class="prediction-direction-button" type="button" data-outcome-direction="bullish">Bullish</button>' +
          '<button class="prediction-direction-button" type="button" data-outcome-direction="bearish">Bearish</button>' +
        '</div></div>' +
        '<label class="prediction-filter-group"><span class="prediction-filter-label">Confidence</span><select class="prediction-confidence-select" id="prediction-confidence-filter">' + confidenceOptions + '</select></label>' +
        '<button class="btn" type="button" data-reset-prediction-filters>Reset filters</button>' +
        '<div class="prediction-filter-status" id="prediction-filter-status">Loading outcomes</div>' +
      '</div>';
    }

    function applyPredictionPage(payload, reset) {
      if (reset) {
        predictionLoadedCount = 0;
        predictionLastArticleKey = null;
        predictionLoadedArticles.clear();
        const body = document.getElementById("prediction-outcomes-body");
        if (body) body.innerHTML = "";
      }
      const outcomes = payload.outcomes || [];
      appendPredictionOutcomes(outcomes);
      predictionNextCursor = payload.next_cursor || null;
      predictionHasMore = Boolean(payload.has_more && predictionNextCursor);
      predictionTotal = Number(payload.total || 0);
      predictionLoadedCount += outcomes.length;

      const tableShell = document.getElementById("prediction-table-shell");
      const stickyHeader = document.getElementById("prediction-sticky-header");
      const empty = document.getElementById("prediction-list-empty");
      if (tableShell) tableShell.classList.toggle("hidden", predictionLoadedCount === 0);
      if (stickyHeader) stickyHeader.classList.toggle("hidden", predictionLoadedCount === 0);
      if (empty) empty.classList.toggle("hidden", predictionLoadedCount !== 0 || predictionLoading);
      updatePredictionMeta();
      setPredictionPageLoading(false);
    }

    function appendPredictionOutcomes(outcomes) {
      const body = document.getElementById("prediction-outcomes-body");
      if (!body || !outcomes.length) return;
      const intervals = ["12h", "24h", "48h", "1w", "2w", "1m", "3m", "6m", "1y", "2y", "3y", "4y"];
      const columnCount = 6 + intervals.length;
      let html = "";
      for (const item of outcomes) {
        const articleKey = item.article_id || item.result_id || [item.title, item.url, item.prediction_at].join("|");
        predictionLoadedArticles.add(articleKey);
        if (articleKey !== predictionLastArticleKey) {
          const title = decodeHtmlEntities(item.title || item.article_id || "Prediction");
          html += '<tr class="prediction-article-row"><th colspan="' + columnCount + '" scope="rowgroup"><a href="' + escapeAttr(item.url || "#") + '" target="_blank" rel="noreferrer">' + escapeHtml(title) + '</a></th></tr>';
        }
        const cells = [
          escapeHtml(formatDate(item.prediction_at)),
          escapeHtml(item.symbol || ""),
          pill(item.direction || "unknown", directionClass(item.direction), item.rationale || "Predicted direction for this ticker."),
          pill(formatNumber(item.score), Number(item.score || 0) > 0 ? "green" : "red", "Article prediction score used when the ticker outcome was recorded."),
          pill(formatNumber(item.confidence), "green", "Prediction confidence from the analyzed impact detail or article-level result."),
          priceCell(item.baseline_price, item.baseline_at, "Closest available ticker price at the article publication time."),
          ...intervals.map((interval) => predictionPointPill(item.intervals && item.intervals[interval], item.direction, interval)),
        ];
        html += '<tr class="prediction-data-row">' + cells.map((cell) => '<td>' + cell + '</td>').join("") + '</tr>';
        predictionLastArticleKey = articleKey;
      }
      body.insertAdjacentHTML("beforeend", html);
      resizePredictionOutcomeColumns(intervals);
    }

    function resizePredictionOutcomeColumns(intervals) {
      const bodyTable = document.getElementById("prediction-outcomes-table");
      const stickyTable = document.getElementById("prediction-sticky-table");
      if (!bodyTable || !stickyTable) return;
      const fixedWidth = 200 + 90 + 100 + 80 + 80 + 110;
      let intervalWidthTotal = 0;
      intervals.forEach((interval, intervalIndex) => {
        const cellIndex = 6 + intervalIndex;
        let width = 150;
        for (const row of bodyTable.querySelectorAll("tr.prediction-data-row")) {
          const cell = row.children[cellIndex];
          const content = cell && cell.firstElementChild;
          if (content) width = Math.max(width, Math.ceil(content.scrollWidth) + 26);
        }
        intervalWidthTotal += width;
        for (const column of predictionsEl.querySelectorAll('col[data-prediction-interval="' + interval + '"]')) {
          column.style.width = width + "px";
        }
      });
      const tableWidth = fixedWidth + intervalWidthTotal;
      for (const table of [bodyTable, stickyTable]) {
        table.style.width = tableWidth + "px";
        table.style.minWidth = tableWidth + "px";
      }
    }

    function updatePredictionMeta() {
      const filterStatus = document.getElementById("prediction-filter-status");
      const loadedText = predictionLoadedCount + " of " + predictionTotal + " predictions";
      if (filterStatus) filterStatus.textContent = loadedText;
      predictionsMeta.textContent = loadedText + " across " + predictionLoadedArticles.size + " loaded articles";
    }

    function setPredictionFilters(direction, confidenceBin) {
      const normalizedDirection = direction === "bullish" || direction === "bearish" ? direction : "all";
      const normalizedBin = Number.isInteger(confidenceBin) && confidenceBin >= 0 && confidenceBin <= 9 ? confidenceBin : null;
      if (predictionFilters.direction === normalizedDirection && predictionFilters.confidenceBin === normalizedBin) return;
      predictionFilters.direction = normalizedDirection;
      predictionFilters.confidenceBin = normalizedBin;
      renderPredictionSummary(predictionSummaryData, predictionCoverage);
      renderPredictionDailyChart();
      reloadPredictionOutcomes();
    }

    function updatePredictionFilterUi() {
      for (const button of predictionsEl.querySelectorAll("[data-outcome-direction]")) {
        button.classList.toggle("active", button.getAttribute("data-outcome-direction") === predictionFilters.direction);
      }
      const select = document.getElementById("prediction-confidence-filter");
      if (select) select.value = predictionFilters.confidenceBin === null ? "all" : String(predictionFilters.confidenceBin);
      for (const button of predictionSummaryEl.querySelectorAll("[data-heatmap-direction]")) {
        const confidenceBin = button.getAttribute("data-confidence-bin");
        const normalizedBin = confidenceBin === "all" ? null : Number(confidenceBin);
        const active = button.getAttribute("data-heatmap-direction") === predictionFilters.direction && normalizedBin === predictionFilters.confidenceBin;
        button.closest("td")?.classList.toggle("active-filter", active);
      }
    }

    function predictionRequestPath(endpoint, cursor) {
      const params = new URLSearchParams({ limit: String(PREDICTION_PAGE_SIZE) });
      if (predictionFilters.direction !== "all") params.set("direction", predictionFilters.direction);
      if (predictionFilters.confidenceBin !== null) {
        params.set("confidence_min", String(predictionFilters.confidenceBin * 10));
        params.set("confidence_max", String((predictionFilters.confidenceBin + 1) * 10));
      }
      if (cursor) params.set("cursor", cursor);
      return endpoint + "?" + params.toString();
    }

    function observePredictionSentinel() {
      if (predictionObserver) predictionObserver.disconnect();
      predictionObserver = null;
      if (!predictionHasMore || !("IntersectionObserver" in window)) return;
      const sentinel = document.getElementById("prediction-scroll-sentinel");
      if (!sentinel) return;
      predictionObserver = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMorePredictions();
      }, { rootMargin: "600px 0px" });
      predictionObserver.observe(sentinel);
    }

    function setPredictionPageLoading(loading) {
      document.getElementById("prediction-page-loader")?.classList.toggle("hidden", !loading);
      if (!loading) document.getElementById("prediction-list-empty")?.classList.toggle("hidden", predictionLoadedCount !== 0);
    }

    function showPredictionPageError(error) {
      predictionHasMore = false;
      const loader = document.getElementById("prediction-page-loader");
      if (loader) {
        loader.classList.remove("hidden");
        loader.innerHTML = '<div class="error">Additional outcomes could not be loaded: ' + escapeHtml(error.message || String(error)) + '</div>';
      }
    }

    function renderConfidenceHeatmap(summary, direction, confidenceBins) {
      const bands = confidenceBins.map((index) => ({ index, min: index * 10, max: (index + 1) * 10 }));
      const heading = direction === "bullish" ? "Bullish predictions" : "Bearish predictions";
      const headers = '<th scope="col">Overall movement</th><th scope="col">Interval</th>' + bands.map((band) => '<th scope="col">' + band.min + '-' + band.max + '</th>').join("");
      const scale = heatmapMovementScale(summary, direction, confidenceBins);
      const rows = summary.map((item) => {
        const cells = Array.isArray(item[direction]) ? item[direction] : [];
        const overall = aggregateHeatmapCells(cells);
        return '<tr>' + renderHeatmapCell(overall, direction, item.interval, null, scale) + '<th scope="row">' + escapeHtml(item.interval || "") + '</th>' + bands.map((band) => renderHeatmapCell(cells[band.index], direction, item.interval, band, scale)).join("") + '</tr>';
      }).join("");
      const minimumWidth = 132 + 76 + bands.length * 132;
      return '<section class="heatmap-section" aria-label="' + escapeAttr(heading + " accuracy by confidence and interval") + '">' +
        '<div class="heatmap-heading"><div class="heatmap-title">' + heading + '</div><div class="heatmap-axis-label">Prediction confidence (%)</div></div>' +
        '<div class="heatmap-scroll"><table class="confidence-heatmap" style="--heatmap-min-width:' + minimumWidth + 'px"><thead><tr>' + headers + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '</section>';
    }

    function aggregateHeatmapCells(cells) {
      const populated = cells.filter((cell) => Number(cell && cell.samples || 0) > 0);
      const samples = populated.reduce((sum, cell) => sum + Number(cell.samples || 0), 0);
      if (!samples) return null;
      const accurate = populated.reduce((sum, cell) => sum + Number(cell.accuracy_pct || 0) * Number(cell.samples || 0) / 100, 0);
      const movement = populated.reduce((sum, cell) => sum + Number(cell.average_movement_pct || 0) * Number(cell.samples || 0), 0);
      return {
        samples,
        accuracy_pct: accurate / samples * 100,
        average_movement_pct: movement / samples,
      };
    }

    function predictionDailyGroup(direction, confidenceBin) {
      const grouped = new Map();
      for (const row of predictionDailySeries) {
        if (row.direction !== direction) continue;
        if (confidenceBin !== null && Number(row.confidence_bin) !== confidenceBin) continue;
        const day = Number(row.day_index);
        const samples = Number(row.samples || 0);
        const movement = Number(row.average_movement_pct);
        if (!Number.isFinite(day) || !samples || !Number.isFinite(movement)) continue;
        const current = grouped.get(day) || { day, samples: 0, weightedMovement: 0 };
        current.samples += samples;
        current.weightedMovement += movement * samples;
        grouped.set(day, current);
      }
      return Array.from(grouped.values())
        .map((item) => ({ day: item.day, samples: item.samples, movement: item.weightedMovement / item.samples }))
        .sort((a, b) => a.day - b.day);
    }

    function renderPredictionDailyChart() {
      const dailyPredictions = Number(predictionDailyCoverage.daily_predictions || 0);
      const eligiblePredictions = Number(predictionDailyCoverage.eligible_predictions || 0);
      const coverageText = dailyPredictions + " of " + eligiblePredictions + " predictions with daily prices" + (dailyPredictions < eligiblePredictions ? " (backfilling)" : "");
      const confidenceBin = predictionFilters.confidenceBin;
      const selectedDirection = predictionFilters.direction === "bullish" || predictionFilters.direction === "bearish" ? predictionFilters.direction : null;
      const confidenceLabel = confidenceBin === null ? "all confidence" : (confidenceBin * 10) + "-" + ((confidenceBin + 1) * 10) + "% confidence";
      const series = [];
      let sampleSeries = null;

      if (selectedDirection) {
        const points = predictionDailyGroup(selectedDirection, confidenceBin);
        series.push({
          label: (selectedDirection === "bullish" ? "Bullish" : "Bearish") + " " + confidenceLabel,
          direction: selectedDirection,
          points,
        });
        sampleSeries = points;
        predictionTrendMeta.textContent = series[0].label + " - " + coverageText;
      } else {
        series.push({ label: "Bullish " + confidenceLabel, direction: "bullish", points: predictionDailyGroup("bullish", confidenceBin) });
        series.push({ label: "Bearish " + confidenceLabel, direction: "bearish", points: predictionDailyGroup("bearish", confidenceBin) });
        predictionTrendMeta.textContent = "Bullish and bearish " + confidenceLabel + " - " + coverageText;
      }

      const populated = series.filter((item) => item.points.length);
      if (!populated.length) {
        predictionTrendChartEl.innerHTML = '<div class="empty">Daily price history is being collected. New and existing calls are backfilled automatically in the background.</div>';
        return;
      }

      const width = 1000;
      const height = 300;
      const pad = { left: 64, right: sampleSeries ? 72 : 28, top: 42, bottom: 46 };
      const plotWidth = width - pad.left - pad.right;
      const plotHeight = height - pad.top - pad.bottom;
      const observedMaxDay = Math.max(0, ...populated.flatMap((item) => item.points.map((point) => point.day)));
      const xMax = observedMaxDay;
      const movements = populated.flatMap((item) => item.points.map((point) => Number(point.movement)));
      let movementMin = Math.min(0, ...movements);
      let movementMax = Math.max(0, ...movements);
      if (movementMin === movementMax) {
        movementMin -= 1;
        movementMax += 1;
      } else {
        const movementPad = (movementMax - movementMin) * 0.1;
        movementMin -= movementPad;
        movementMax += movementPad;
      }
      const movementSpan = movementMax - movementMin || 1;
      const sampleMax = Math.max(1, ...(sampleSeries || []).map((point) => Number(point.samples || 0)));
      const xFor = (day) => pad.left + (xMax > 0 ? (Number(day) / xMax) * plotWidth : 0);
      const movementY = (movement) => pad.top + ((movementMax - Number(movement)) / movementSpan) * plotHeight;
      const sampleY = (samples) => pad.top + ((sampleMax - Number(samples)) / sampleMax) * plotHeight;
      const colors = { bullish: "#087a55", bearish: "#b42318" };

      const movementGrid = Array.from({ length: 5 }, (_, index) => {
        const ratio = index / 4;
        const value = movementMax - ratio * movementSpan;
        const y = pad.top + ratio * plotHeight;
        return '<line x1="' + pad.left + '" y1="' + y.toFixed(2) + '" x2="' + (width - pad.right) + '" y2="' + y.toFixed(2) + '" stroke="#e4e9f0"></line>' +
          '<text x="' + (pad.left - 9) + '" y="' + (y + 4).toFixed(2) + '" fill="#667085" font-size="10" text-anchor="end">' + escapeHtml(signedPct(value)) + '</text>';
      }).join("");
      const zeroY = movementY(0);
      const zeroLine = '<line class="prediction-zero-line" x1="' + pad.left + '" y1="' + zeroY.toFixed(2) + '" x2="' + (width - pad.right) + '" y2="' + zeroY.toFixed(2) + '" stroke="#475467" stroke-width="1.5"></line>' +
        '<text x="' + (pad.left + 7) + '" y="' + (zeroY - 6).toFixed(2) + '" fill="#344054" font-size="10" font-weight="700">0% movement</text>';

      const tickDays = xMax > 0
        ? Array.from(new Set(Array.from({ length: 6 }, (_, index) => Math.round((index / 5) * xMax))))
        : [0];
      const xTicks = tickDays.map((day) => {
        const x = xFor(day);
        return '<line x1="' + x.toFixed(2) + '" y1="' + pad.top + '" x2="' + x.toFixed(2) + '" y2="' + (height - pad.bottom) + '" stroke="#eef1f5"></line>' +
          '<text x="' + x.toFixed(2) + '" y="' + (height - 22) + '" fill="#667085" font-size="10" text-anchor="middle">Day ' + day + '</text>';
      }).join("");

      const movementLines = populated.map((item) => {
        const path = item.points.map((point, index) => (index ? "L" : "M") + xFor(point.day).toFixed(2) + " " + movementY(point.movement).toFixed(2)).join(" ");
        const points = item.points.map((point) => '<circle cx="' + xFor(point.day).toFixed(2) + '" cy="' + movementY(point.movement).toFixed(2) + '" r="3" fill="' + colors[item.direction] + '"><title>' + escapeHtml(item.label + ", day " + point.day + ": " + signedPct(point.movement) + " average movement from " + point.samples + " samples") + '</title></circle>').join("");
        return '<path d="' + path + '" fill="none" stroke="' + colors[item.direction] + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>' + points;
      }).join("");

      const sampleMarkup = sampleSeries ? (() => {
        const samplePath = sampleSeries.map((point, index) => (index ? "L" : "M") + xFor(point.day).toFixed(2) + " " + sampleY(point.samples).toFixed(2)).join(" ");
        const sampleTicks = [sampleMax, sampleMax / 2, 0].map((value) => {
          const y = sampleY(value);
          return '<text x="' + (width - pad.right + 9) + '" y="' + (y + 4).toFixed(2) + '" fill="#7893a8" font-size="10">' + Math.round(value) + '</text>';
        }).join("");
        const samplePoints = sampleSeries.map((point) => '<circle cx="' + xFor(point.day).toFixed(2) + '" cy="' + sampleY(point.samples).toFixed(2) + '" r="3" fill="#8aaec7"><title>' + escapeHtml("Day " + point.day + ": " + point.samples + " samples") + '</title></circle>').join("");
        return '<path d="' + samplePath + '" fill="none" stroke="#8aaec7" stroke-width="2" stroke-dasharray="6 5" stroke-linecap="round" stroke-linejoin="round"></path>' + samplePoints + sampleTicks +
          '<text x="' + (width - pad.right + 9) + '" y="20" fill="#7893a8" font-size="10">Samples</text>';
      })() : "";

      const legend = populated.map((item, index) => {
        const x = pad.left + index * 170;
        return '<line x1="' + x + '" y1="20" x2="' + (x + 22) + '" y2="20" stroke="' + colors[item.direction] + '" stroke-width="3"></line><text x="' + (x + 29) + '" y="24" fill="#344054" font-size="11">' + escapeHtml(item.label) + '</text>';
      }).join("") + (sampleSeries ? '<line x1="' + (pad.left + 340) + '" y1="20" x2="' + (pad.left + 362) + '" y2="20" stroke="#8aaec7" stroke-width="2" stroke-dasharray="6 5"></line><text x="' + (pad.left + 369) + '" y="24" fill="#667085" font-size="11">Daily samples</text>' : "");

      predictionTrendChartEl.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Average prediction movement by days since baseline">' +
        '<text x="8" y="20" fill="#667085" font-size="10">Average movement</text>' + legend + movementGrid + xTicks + zeroLine + movementLines + sampleMarkup +
        '<text x="' + (pad.left + plotWidth / 2) + '" y="294" fill="#667085" font-size="10" text-anchor="middle">Days since prediction baseline</text>' +
      '</svg>';
    }

    function renderHeatmapCell(cell, direction, interval, band, scale) {
      const samples = Number(cell && cell.samples || 0);
      if (!samples) {
        return '<td class="heatmap-cell heatmap-empty">n/a</td>';
      }
      const accuracy = Number(cell.accuracy_pct || 0);
      const label = direction === "bullish" ? "Bullish" : "Bearish";
      const averageMovement = Number(cell.average_movement_pct || 0);
      const movement = signedPct(averageMovement);
      const sampleConfidence = sampleSizeConfidence(samples);
      const outlier = heatmapMovementIsOutlier(averageMovement, direction, scale);
      const confidenceLabel = band ? band.min + "-" + band.max + "% confidence" : "all confidence levels";
      const confidenceBin = band ? String(band.min / 10) : "all";
      const accessibilityLabel = label + ", " + confidenceLabel + ", " + interval + ": " + (outlier ? "outlier, " : "") + "average movement " + movement + ", " + accuracy.toFixed(1) + "% accurate, " + samples + " samples, " + sampleConfidence.toFixed(0) + "% sample-size confidence.";
      const active = predictionFilters.direction === direction && predictionFilters.confidenceBin === (band ? band.min / 10 : null);
      return '<td class="heatmap-cell clickable' + (active ? ' active-filter' : '') + '" style="' + heatmapMovementStyle(averageMovement, direction, scale, outlier) + '">' +
        '<button class="heatmap-filter-button" type="button" data-heatmap-direction="' + direction + '" data-confidence-bin="' + confidenceBin + '" aria-label="' + escapeAttr(accessibilityLabel + (band ? " Filter outcomes by this direction and confidence band." : " Filter outcomes by this direction across all confidence levels.")) + '">' +
          (outlier ? '*' : '') + movement + ' <span class="heatmap-accuracy">(' + accuracy.toFixed(0) + '%)</span><sup class="heatmap-samples" title="' + escapeAttr(sampleSizeConfidenceTooltip(samples, sampleConfidence)) + '">' + samples + ' (' + sampleConfidence.toFixed(0) + '%)</sup>' +
        '</button></td>';
    }

    function heatmapMovementScale(summary, direction, confidenceBins) {
      const directionalValues = [];
      for (const item of summary) {
        const cells = Array.isArray(item[direction]) ? item[direction] : [];
        for (const index of confidenceBins) {
          const cell = cells[index];
          if (!cell || Number(cell.samples || 0) <= 0) continue;
          const movement = Number(cell.average_movement_pct || 0);
          if (Number.isFinite(movement)) directionalValues.push(direction === "bullish" ? movement : -movement);
        }
      }
      const sorted = directionalValues.slice().sort((a, b) => a - b);
      const q1 = heatmapQuantile(sorted, 0.25);
      const q3 = heatmapQuantile(sorted, 0.75);
      const iqr = q3 - q1;
      const lowerFence = iqr > 0 ? q1 - 1.5 * iqr : Number.NEGATIVE_INFINITY;
      const upperFence = iqr > 0 ? q3 + 1.5 * iqr : Number.POSITIVE_INFINITY;
      const inliers = directionalValues.filter((value) => value >= lowerFence && value <= upperFence);
      const scaledValues = inliers.length ? inliers : directionalValues;
      return {
        correct: Math.max(0, ...scaledValues),
        wrong: Math.max(0, ...scaledValues.map((value) => -value)),
        lowerFence,
        upperFence,
      };
    }

    function heatmapQuantile(sortedValues, percentile) {
      if (!sortedValues.length) return 0;
      const position = (sortedValues.length - 1) * percentile;
      const lower = Math.floor(position);
      const fraction = position - lower;
      return sortedValues[lower + 1] === undefined
        ? sortedValues[lower]
        : sortedValues[lower] + fraction * (sortedValues[lower + 1] - sortedValues[lower]);
    }

    function heatmapMovementIsOutlier(movement, direction, scale) {
      const directionalMovement = direction === "bullish" ? movement : -movement;
      return directionalMovement < scale.lowerFence || directionalMovement > scale.upperFence;
    }

    function heatmapMovementStyle(movement, direction, scale, outlier) {
      const directionalMovement = direction === "bullish" ? movement : -movement;
      if (outlier) {
        return directionalMovement >= 0
          ? "background:#14532d;color:#ffffff"
          : "background:#7f1d1d;color:#ffffff";
      }
      const neutral = [250, 204, 21];
      const target = directionalMovement >= 0 ? [22, 163, 74] : [220, 38, 38];
      const extent = directionalMovement >= 0 ? scale.correct : scale.wrong;
      const ratio = extent > 0 ? Math.min(1, Math.abs(directionalMovement) / extent) : 0;
      const channels = neutral.map((channel, index) => Math.round(channel + (target[index] - channel) * ratio));
      const foreground = ratio >= 0.62 ? "#ffffff" : "#3b2a08";
      return "background:rgb(" + channels.join(",") + ");color:" + foreground;
    }

    function sampleSizeConfidence(samples) {
      return Math.max(0, Math.min(100, (samples / (samples + 100)) * 100));
    }

    function sampleSizeConfidenceTooltip(samples, confidence) {
      return "Sample-size confidence = n / (n + 100) × 100 = " + samples + " / (" + samples + " + 100) × 100 = " + confidence.toFixed(1) + "%. The 100-sample constant makes 100 samples equal 50% confidence. This measures sample volume only and does not correct for correlated calls.";
    }

    function heatmapLegendItem(cls, label) {
      return '<span class="heatmap-legend-item"><span class="heatmap-swatch ' + cls + '"></span>' + escapeHtml(label) + '</span>';
    }

    function heatmapOutlierLegendItem() {
      const hint = "Outliers use Tukey fences: values below Q1 − 1.5 × IQR or above Q3 + 1.5 × IQR. They are excluded from the normal colour scale and shown in darker red or green.";
      return '<span class="heatmap-legend-item" title="' + escapeAttr(hint) + '"><span class="heatmap-outlier-swatches"><span class="heatmap-swatch heatmap-scale-outlier-wrong"></span><span class="heatmap-swatch heatmap-scale-outlier-correct"></span></span>* Outliers</span>';
    }

    function predictionPointPill(point, direction, label) {
      if (!point || point.change_pct === null || point.change_pct === undefined) {
        return pill("n/a", "", "No market price at or after the " + label + " post-prediction target is available yet.");
      }
      const change = Number(point.change_pct);
      const accurate = direction === "bullish" ? change > 0 : direction === "bearish" ? change < 0 : false;
      const counted = point.counts_toward_accuracy === true;
      return pill(
        formatMoney(point.price) + " " + signedPct(change),
        (accurate ? "green" : "red") + (counted ? " accuracy-counted" : ""),
        "Price sampled at " + formatDate(point.at) + ". " + (accurate ? "Accurate" : "Inaccurate") + " " + direction + " prediction at " + label + " after prediction time. " + (counted ? "Included in the accuracy chart." : "Excluded from the accuracy chart because an opposite call was made before this sample."),
      );
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

    function formatDuration(value) {
      if (value === null || value === undefined || value === "") return "n/a";
      const totalSeconds = Math.max(0, Math.round(Number(value)));
      if (!Number.isFinite(totalSeconds)) return "n/a";
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      if (days) return days + "d " + hours + "h";
      if (hours) return hours + "h " + minutes + "m";
      if (minutes) return minutes + "m " + seconds + "s";
      return seconds + "s";
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

    function decodeHtmlEntities(value) {
      const textarea = document.createElement("textarea");
      textarea.innerHTML = String(value ?? "");
      return textarea.value;
    }

    function escapeAttr(value) {
      return escapeHtml(value).replace(/\\n/g, " ");
    }

    setInterval(updateRunningJobTimers, 1000);
    if (tokenInput.value.trim()) {
      startLiveStatusPolling();
      loadAll();
    }
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

function containerEnvWithAuth(env: Env, authJson: string): Record<string, string> {
  return {
    CODEX_HOME: "/home/codex/.codex",
    CODEX_RESEARCH_MODEL: env.CODEX_RESEARCH_MODEL || "gpt-5.6-sol",
    CODEX_AUTH_JSON: authJson,
    OPENAI_API_KEY: env.OPENAI_API_KEY || "",
    CODEX_ACCESS_TOKEN: env.CODEX_ACCESS_TOKEN || "",
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function isCodexAuthJson(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as { auth_mode?: unknown; tokens?: unknown; OPENAI_API_KEY?: unknown };
    return Boolean(parsed && typeof parsed === "object" && (parsed.tokens || parsed.OPENAI_API_KEY || parsed.auth_mode));
  } catch {
    return false;
  }
}

async function runtimeAuthKey(env: Env): Promise<CryptoKey | null> {
  if (!env.CODEX_AUTH_STATE_KEY) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.CODEX_AUTH_STATE_KEY));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function ensureRuntimeSecretTable(env: Env): Promise<void> {
  await env.NEWS_DB.prepare(
    "CREATE TABLE IF NOT EXISTS runtime_secrets (name TEXT PRIMARY KEY, ciphertext TEXT NOT NULL, iv TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  ).run();
}

async function loadPersistedCodexAuth(env: Env): Promise<string | null> {
  const key = await runtimeAuthKey(env);
  if (!key) return null;
  await ensureRuntimeSecretTable(env);
  const row = await env.NEWS_DB.prepare("SELECT ciphertext, iv FROM runtime_secrets WHERE name = 'codex_auth'").first<{
    ciphertext: string;
    iv: string;
  }>();
  if (!row) return null;
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(row.iv) },
      key,
      base64ToBytes(row.ciphertext),
    );
    const authJson = new TextDecoder().decode(decrypted);
    return isCodexAuthJson(authJson) ? authJson : null;
  } catch {
    console.error("Persisted Codex auth could not be decrypted; falling back to the Worker secret");
    return null;
  }
}

async function persistCodexAuth(env: Env, authJson: string | null | undefined): Promise<void> {
  if (!authJson || !isCodexAuthJson(authJson)) return;
  const key = await runtimeAuthKey(env);
  if (!key) return;
  await ensureRuntimeSecretTable(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(authJson));
  await env.NEWS_DB.prepare(
    "INSERT INTO runtime_secrets (name, ciphertext, iv, updated_at) VALUES ('codex_auth', ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(name) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, updated_at = CURRENT_TIMESTAMP",
  )
    .bind(bytesToBase64(new Uint8Array(encrypted)), bytesToBase64(iv))
    .run();
}

async function startWithSecrets(container: any, env: Env): Promise<void> {
  const persistedAuth = await loadPersistedCodexAuth(env).catch((error) => {
    console.error("Failed to load persisted Codex auth", error);
    return null;
  });
  await container.startAndWaitForPorts(undefined, undefined, {
    envVars: containerEnvWithAuth(env, persistedAuth || env.CODEX_AUTH_JSON || ""),
  });
}

function decodeXml(value: string): string {
  return decodeHtmlEntities(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"))
    .replace(/<[^>]+>/g, "")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "-")
    .replace(/&hellip;/g, "...")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
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
      const encodedContent = tagValue(block, "content:encoded") || tagValue(block, "content");
      const summary = tagValue(block, "description") || tagValue(block, "summary") || encodedContent;
      const publishedAt = normalizeDate(
        tagValue(block, "pubDate") || tagValue(block, "published") || tagValue(block, "dc:date") || tagValue(block, "updated"),
      );
      return { source, title, url, summary, publishedAt, contentPlaintext: encodedContent || summary };
    })
    .filter((item) => item.title && item.url)
    .sort((left, right) => {
      if (!left.publishedAt && !right.publishedAt) return 0;
      if (!left.publishedAt) return 1;
      if (!right.publishedAt) return -1;
      return Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
    })
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
        "INSERT INTO sources (id, name, url, category, weight, source_type, enabled) VALUES (?, ?, ?, ?, ?, ?, 1) " +
          "ON CONFLICT(id) DO UPDATE SET name = excluded.name, url = excluded.url, category = excluded.category, weight = excluded.weight, source_type = excluded.source_type, enabled = 1",
      )
      .bind(source.id, source.name, source.url, source.category, source.weight, source.sourceType),
  );
  if (statements.length) await db.batch(statements);
}

async function fetchSource(source: Source): Promise<{ source: string; count: number; error?: string; items: FeedItem[] }> {
  let lastError = "Feed fetch failed";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(source.url, {
        headers: {
          "user-agent": "cartdotcom-news-signal-mvp/0.1",
          accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        },
      });
      if (response.ok) {
        const xml = await response.text();
        const items = parseFeed(xml, source);
        return { source: source.id, count: items.length, items };
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { source: source.id, count: 0, error: lastError, items: [] };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function isWithinArticleIngestionWindow(item: FeedItem, now = Date.now()): boolean {
  if (!item.publishedAt) return false;
  const publishedAt = Date.parse(item.publishedAt);
  if (!Number.isFinite(publishedAt)) return false;
  return publishedAt >= now - ARTICLE_INGESTION_WINDOW_MS;
}

async function enqueueArticles(db: D1Database, queue: Queue<ResearchJobMessage>, items: FeedItem[]): Promise<number> {
  const uniqueItems = [...new Map(items.filter((item) => isWithinArticleIngestionWindow(item)).map((item) => [item.url, item])).values()];
  const prepared = await Promise.all(
    uniqueItems.map(async (item) => ({
      ...item,
      articleId: await hashText(item.url),
      contentHash: await hashText(`${item.title}\n${item.summary || ""}`),
    })),
  );
  let inserted = 0;

  for (const group of chunks(prepared, 50)) {
    const insertResults = await db.batch(
      group.map((item) =>
        db
          .prepare(
            "INSERT OR IGNORE INTO articles (id, source_id, title, url, summary, published_at, content_hash, content_plaintext, content_source, content_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
          )
          .bind(
            item.articleId,
            item.source.id,
            item.title,
            item.url,
            item.summary,
            item.publishedAt,
            item.contentHash,
            item.contentPlaintext,
            item.contentPlaintext ? "feed" : null,
          ),
      ),
    );
    const newItems = group.filter((_item, index) => Boolean(insertResults[index]?.meta?.changes));
    const existingItems = group.filter((_item, index) => !insertResults[index]?.meta?.changes);

    if (existingItems.length) {
      await db.batch(
        existingItems.map((item) =>
          db
            .prepare(
              "UPDATE articles SET published_at = COALESCE(published_at, ?), summary = COALESCE(summary, ?), content_plaintext = COALESCE(content_plaintext, ?), content_source = CASE WHEN content_plaintext IS NULL AND ? IS NOT NULL THEN 'feed' ELSE content_source END WHERE id = ?",
            )
            .bind(item.publishedAt, item.summary, item.contentPlaintext, item.contentPlaintext, item.articleId),
        ),
      );
    }

    if (newItems.length) {
      const jobs = newItems.map((item) => ({ jobId: crypto.randomUUID(), articleId: item.articleId }));
      await db.batch(
        jobs.map((job) =>
          db.prepare("INSERT OR IGNORE INTO research_jobs (id, article_id, status, prediction_delay_eligible) VALUES (?, ?, 'pending', 1)").bind(job.jobId, job.articleId),
        ),
      );
      for (const jobGroup of chunks(jobs, 100)) {
        await queue.sendBatch(jobGroup.map((job) => ({ body: { jobId: job.jobId } })));
      }
      inserted += newItems.length;
    }
  }
  return inserted;
}

async function ingestFeeds(env: Env): Promise<{ fetched: unknown[]; inserted: number }> {
  await ensureArticleStorageSchema(env.NEWS_DB);
  await seedSources(env.NEWS_DB);
  const fetched = await mapWithConcurrency(SOURCES, 12, fetchSource);
  const inserted = await enqueueArticles(env.NEWS_DB, env.RESEARCH_QUEUE, fetched.flatMap((result) => result.items));
  return {
    fetched: fetched.map(({ items: _items, ...rest }) => rest),
    inserted,
  };
}

function normalizePlaintext(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, ARTICLE_CONTENT_MAX_CHARS);
}

function stripHtmlToPlaintext(value: string): string {
  const withoutNonContent = value
    .replace(/<(script|style|svg|nav|footer|header|aside|form|noscript|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|section|article|main|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ");
  return normalizePlaintext(decodeHtmlEntities(withoutNonContent));
}

function articleBodyFromStructuredData(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = articleBodyFromStructuredData(item);
      if (result) return result;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.articleBody === "string" && record.articleBody.trim().length >= 120) return normalizePlaintext(record.articleBody);
  for (const child of Object.values(record)) {
    const result = articleBodyFromStructuredData(child);
    if (result) return result;
  }
  return null;
}

function extractArticlePlaintext(htmlText: string): string | null {
  for (const match of htmlText.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const articleBody = articleBodyFromStructuredData(JSON.parse(match[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim()));
      if (articleBody) return articleBody;
    } catch {
      // Invalid JSON-LD is common; continue to semantic HTML extraction.
    }
  }

  const cleaned = htmlText.replace(/<!--([\s\S]*?)-->/g, " ");
  const semanticCandidates = [...cleaned.matchAll(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((match) => stripHtmlToPlaintext(match[2]))
    .filter((text) => text.length >= 200)
    .sort((left, right) => right.length - left.length);
  if (semanticCandidates.length) return semanticCandidates[0];

  const paragraphs = [...cleaned.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripHtmlToPlaintext(match[1]))
    .filter((text) => text.length >= 30);
  const paragraphText = normalizePlaintext(paragraphs.join("\n\n"));
  return paragraphText.length >= 200 ? paragraphText : null;
}

async function fetchArticlePlaintext(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(ARTICLE_FETCH_TIMEOUT_MS),
    headers: {
      "user-agent": "cartdotcom-news-signal/1.0 (+https://cartdotcom.com)",
      accept: "text/html, text/plain;q=0.9, application/xhtml+xml;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`Article fetch returned HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 3_000_000) throw new Error("Article response exceeded the 3 MB extraction limit");
  const body = await response.text();
  if (/just a moment|verify you are human|enable javascript and cookies|access denied/i.test(body.slice(0, 8_000))) {
    throw new Error("Article page returned an access or browser-verification screen");
  }
  const contentType = response.headers.get("content-type") || "";
  const plaintext = contentType.includes("text/plain") ? normalizePlaintext(body) : extractArticlePlaintext(body);
  if (!plaintext || plaintext.length < 120) throw new Error("No article body could be extracted from the page");
  if (plaintext.length < 500 && /subscribe|sign in to continue|already a subscriber|register to continue/i.test(plaintext)) {
    throw new Error("Article page exposed only a subscription prompt");
  }
  return plaintext;
}

async function captureArticleContent(env: Env, article: Article): Promise<Article> {
  if (article.content_status === "fetched" && article.content_plaintext) return article;
  try {
    const fetchedText = await fetchArticlePlaintext(article.url);
    const existingText = normalizePlaintext(article.content_plaintext || article.summary || "");
    const useFetchedText = fetchedText.length >= existingText.length;
    const content = useFetchedText ? fetchedText : existingText;
    const contentSource = useFetchedText ? "webpage" : article.content_source || "feed";
    await env.NEWS_DB.prepare(
      "UPDATE articles SET content_plaintext = ?, content_source = ?, content_status = 'fetched', content_fetched_at = CURRENT_TIMESTAMP, content_fetch_attempts = content_fetch_attempts + 1, content_error = NULL WHERE id = ?",
    )
      .bind(content, contentSource, article.id)
      .run();
    return {
      ...article,
      content_plaintext: content,
      content_source: contentSource,
      content_status: "fetched",
      content_fetched_at: new Date().toISOString(),
      content_fetch_attempts: Number(article.content_fetch_attempts || 0) + 1,
      content_error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallback = normalizePlaintext(article.content_plaintext || article.summary || "");
    const status = fallback ? "feed_only" : "failed";
    await env.NEWS_DB.prepare(
      "UPDATE articles SET content_plaintext = CASE WHEN content_plaintext IS NULL THEN summary ELSE content_plaintext END, content_source = CASE WHEN content_plaintext IS NULL AND summary IS NOT NULL THEN 'feed' ELSE content_source END, content_status = ?, content_fetched_at = CURRENT_TIMESTAMP, content_fetch_attempts = content_fetch_attempts + 1, content_error = ? WHERE id = ?",
    )
      .bind(status, message.slice(0, 500), article.id)
      .run();
    return {
      ...article,
      content_plaintext: fallback || null,
      content_source: article.content_source || (fallback ? "feed" : null),
      content_status: status,
      content_fetched_at: new Date().toISOString(),
      content_fetch_attempts: Number(article.content_fetch_attempts || 0) + 1,
      content_error: message.slice(0, 500),
    };
  }
}

async function backfillArticleContents(env: Env, limit = 20): Promise<{ attempted: number; fetched: number; feedOnly: number; failed: number }> {
  const clamped = Math.min(Math.max(limit, 1), 100);
  const rows = await env.NEWS_DB.prepare(
    "SELECT articles.id, articles.source_id, articles.title, articles.url, articles.summary, articles.published_at, articles.discovered_at, articles.content_plaintext, articles.content_source, articles.content_status, articles.content_fetched_at, articles.content_fetch_attempts, articles.content_error, sources.name AS source_name, sources.source_type, sources.weight AS source_weight FROM articles LEFT JOIN sources ON sources.id = articles.source_id WHERE articles.content_status != 'fetched' AND articles.content_fetch_attempts < 3 ORDER BY articles.content_fetch_attempts ASC, COALESCE(articles.published_at, articles.discovered_at) DESC LIMIT ?",
  )
    .bind(clamped)
    .all<Article>();
  const captured = await mapWithConcurrency(rows.results || [], 4, (article) => captureArticleContent(env, article));
  return {
    attempted: captured.length,
    fetched: captured.filter((article) => article.content_status === "fetched").length,
    feedOnly: captured.filter((article) => article.content_status === "feed_only").length,
    failed: captured.filter((article) => article.content_status === "failed").length,
  };
}

function researchPrompt(article: Article): string {
  const articleText = (article.content_plaintext || article.summary || "none").slice(0, 60_000);
  return `You are building a rapid ticker-direction prediction database, not trading advice.

Your primary task is to identify publicly traded tickers concretely affected by this article and predict the direction of each ticker's price response. Spend minimal effort classifying industries. Use the stored article text, source provenance, and your prior knowledge; do not do extended browsing unless the item is impossible to understand without it.

Return a JSON object followed by a concise memo under 350 words. The JSON object must have these fields:
event_title, event_type, event_blurb, impact_details, companies, industries, symbols, sentiment_score, impact_horizon, confidence, summary.

impact_details must be an array of objects with:
kind, name, symbol, direction, confidence, reason.

Use these logical steps for every ticker:
1. Identify the concrete event, not just the article topic.
2. Resolve named public companies to their correct exchange ticker.
3. Add a customer, supplier, competitor, substitute, or platform owner only when the event creates a specific material causal path to that company.
4. Predict bullish or bearish direction separately for every included ticker; do not force all tickers to share the article-level direction.
5. Exclude broad peers, indices, and famous related companies unless the article gives a concrete causal path.
6. For each included ticker, make reason state the event -> business/perception effect -> expected price direction chain.
7. If the article is about Apple, xAI, OpenAI, or another company, do not include GOOGL/GOOG unless Google/Alphabet is directly named or clearly affected as a competitor, supplier, customer, platform owner, or regulatory target.

Article:
Title: ${article.title}
URL: ${article.url}
Published: ${article.published_at || "unknown"}
Source: ${article.source_name || article.source_id}
Source type: ${article.source_type || "editorial"}
Stored content status: ${article.content_status || "unknown"}
Stored plaintext article content:
${articleText}

Rules:
- impact_details should overwhelmingly contain public companies with actionable tickers. Do not add industry-only impact rows unless they are essential to understanding the event.
- industries must be an empty array unless one or two directly affected industries materially clarify the ticker calls.
- sentiment_score is from -1 to 1 and summarizes the net direction across the direct ticker calls; per-ticker direction and confidence in impact_details are authoritative.
- impact_horizon is one of immediate, short, medium, long, unknown.
- confidence is from 0 to 1.
- direction is one of bullish, bearish, mixed, neutral.
- symbols must include only public tickers from impact_details where symbol is not null and reason gives a concrete causal path.
- Do not include private companies in impact_details merely because they are named; mention them as context in the memo instead.
- If a symbol or causal direction is uncertain, omit that ticker rather than guessing.
- Distinguish announcement claims from independently reported facts when source type is first_party or press_release.
- Mention a comparable historical event only when it materially supports a ticker direction.`;
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

function validateResearchFields(fields: ResearchResultFields): string | null {
  if (!fields.event_title || typeof fields.event_title !== "string") return "missing event_title";
  if (!fields.event_type || typeof fields.event_type !== "string") return "missing event_type";
  if (!Array.isArray(fields.impact_details)) return "missing impact_details array";
  if (typeof fields.sentiment_score !== "number" || !Number.isFinite(fields.sentiment_score)) return "missing sentiment_score";
  if (typeof fields.confidence !== "number" || !Number.isFinite(fields.confidence)) return "missing confidence";
  if (!(fields.event_blurb || fields.summary)) return "missing event_blurb or summary";
  return null;
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

async function runContainerResearch(env: Env, prompt: string, researchSlot: number): Promise<string> {
  const container = getContainer(env.CODEX_CONTAINER, `instance-${researchSlot}`);
  await startWithSecrets(container, env);
  const response = await container.fetch(
    new Request("https://container.local/research-internal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, timeout_seconds: 300 }),
    }),
  );
  const payload = (await response.json()) as { ok?: boolean; memo?: string; error?: string; auth_json?: string };
  await persistCodexAuth(env, payload.auth_json).catch((error) => console.error("Failed to persist refreshed Codex auth", error));
  if (!response.ok || !payload.ok || !payload.memo) {
    throw new Error(payload.error || `Container research failed with HTTP ${response.status}`);
  }
  return payload.memo;
}

async function normalizeResearchJobConcurrency(env: Env, force = false): Promise<{ stale: number; excess: number }> {
  const stale = await env.NEWS_DB.prepare(
    force
      ? "UPDATE research_jobs SET status = 'pending', last_error = 'Force-released interrupted research job', started_at = NULL, finished_at = CURRENT_TIMESTAMP, synthesis_duration_seconds = NULL, prediction_delay_seconds = NULL, research_slot = NULL WHERE status = 'running'"
      : "UPDATE research_jobs SET status = 'pending', last_error = 'Reset stale running job', started_at = NULL, finished_at = CURRENT_TIMESTAMP, synthesis_duration_seconds = NULL, prediction_delay_seconds = NULL, research_slot = NULL WHERE status = 'running' AND datetime(started_at) < datetime('now', '-8 minutes')",
  ).run();
  const excess = await env.NEWS_DB.prepare(
    "UPDATE research_jobs SET status = 'pending', last_error = 'Released excess concurrent research job', started_at = NULL, finished_at = CURRENT_TIMESTAMP, synthesis_duration_seconds = NULL, prediction_delay_seconds = NULL, research_slot = NULL WHERE id IN (SELECT id FROM research_jobs WHERE status = 'running' ORDER BY datetime(started_at) ASC LIMIT -1 OFFSET ?)",
  )
    .bind(RESEARCH_CONTAINER_COUNT)
    .run();
  return { stale: Number(stale.meta?.changes || 0), excess: Number(excess.meta?.changes || 0) };
}

async function processJob(env: Env, jobId: string): Promise<{ ok: boolean; jobId: string; skipped?: string }> {
  await ensureArticleStorageSchema(env.NEWS_DB);
  await normalizeResearchJobConcurrency(env);

  const existing = await env.NEWS_DB.prepare(
    "SELECT status, prediction_delay_eligible, EXISTS (SELECT 1 FROM research_results WHERE research_results.job_id = research_jobs.id) AS has_result FROM research_jobs WHERE id = ?",
  ).bind(jobId).first<{ status: string; prediction_delay_eligible: number; has_result: number }>();
  if (!existing) return { ok: false, jobId, skipped: "missing" };
  if (existing.status === "succeeded") return { ok: true, jobId, skipped: existing.status };
  if (existing.status === "running") throw new ResearchBusyError();
  if (existing.status !== "pending") return { ok: false, jobId, skipped: existing.status };
  if (!existing.prediction_delay_eligible && !existing.has_result) {
    await env.NEWS_DB.batch([
      env.NEWS_DB.prepare(
        "UPDATE research_jobs SET status = 'cancelled', last_error = 'Cancelled pre-cohort first-pass backlog', finished_at = CURRENT_TIMESTAMP, research_slot = NULL WHERE id = ? AND status = 'pending'",
      ).bind(jobId),
      env.NEWS_DB.prepare(
        "UPDATE articles SET status = 'archived' WHERE id = (SELECT article_id FROM research_jobs WHERE id = ?)",
      ).bind(jobId),
    ]);
    return { ok: true, jobId, skipped: "legacy_first_pass" };
  }

  const acquired = await env.NEWS_DB.prepare(
    "UPDATE research_jobs SET status = 'running', attempts = attempts + 1, last_error = NULL, started_at = CURRENT_TIMESTAMP, finished_at = NULL, synthesis_duration_seconds = NULL, prediction_delay_seconds = NULL, research_slot = (SELECT slot FROM (SELECT 0 AS slot UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3) AS slots WHERE NOT EXISTS (SELECT 1 FROM research_jobs AS active_slots WHERE active_slots.status = 'running' AND active_slots.research_slot = slots.slot) ORDER BY slot LIMIT 1) WHERE id = ? AND status = 'pending' AND (SELECT COUNT(*) FROM research_jobs AS active_jobs WHERE active_jobs.status = 'running') < ?",
  )
    .bind(jobId, RESEARCH_CONTAINER_COUNT)
    .run();
  if (!acquired.meta?.changes) throw new ResearchBusyError();

  const lease = await env.NEWS_DB.prepare("SELECT research_slot FROM research_jobs WHERE id = ?")
    .bind(jobId)
    .first<{ research_slot: number | null }>();
  if (!lease || !Number.isInteger(lease.research_slot)) {
    await env.NEWS_DB.prepare(
      "UPDATE research_jobs SET status = 'pending', last_error = 'No research container slot was available', started_at = NULL, finished_at = CURRENT_TIMESTAMP, research_slot = NULL WHERE id = ?",
    )
      .bind(jobId)
      .run();
    throw new ResearchBusyError();
  }
  const researchSlot = Number(lease.research_slot);

  let article = await env.NEWS_DB.prepare(
    "SELECT articles.id, articles.source_id, articles.title, articles.url, articles.summary, articles.published_at, articles.discovered_at, articles.content_plaintext, articles.content_source, articles.content_status, articles.content_fetched_at, articles.content_fetch_attempts, articles.content_error, sources.name AS source_name, sources.source_type, sources.weight AS source_weight FROM articles LEFT JOIN sources ON sources.id = articles.source_id WHERE articles.id = (SELECT article_id FROM research_jobs WHERE id = ?)",
  )
    .bind(jobId)
    .first<Article>();

  if (!article) {
    await env.NEWS_DB.prepare(
      "UPDATE research_jobs SET status = 'failed', last_error = 'Article not found', finished_at = CURRENT_TIMESTAMP, synthesis_duration_seconds = MAX(0, unixepoch(CURRENT_TIMESTAMP) - unixepoch(started_at)), prediction_delay_seconds = NULL, research_slot = NULL WHERE id = ?",
    )
      .bind(jobId)
      .run();
    return { ok: false, jobId, skipped: "article_missing" };
  }

  try {
    article = await captureArticleContent(env, article);
    const memo = await runContainerResearch(env, researchPrompt(article), researchSlot);
    const activeLease = await env.NEWS_DB.prepare(
      "SELECT research_jobs.status AS job_status, articles.status AS article_status FROM research_jobs INNER JOIN articles ON articles.id = research_jobs.article_id WHERE research_jobs.id = ?",
    )
      .bind(jobId)
      .first<{ job_status: string; article_status: string }>();
    if (activeLease?.job_status !== "running" || activeLease.article_status === "archived") {
      return { ok: true, jobId, skipped: "archived_during_research" };
    }
    const fields = parseResearchFields(memo);
    const validationError = validateResearchFields(fields);
    if (validationError) throw new Error(`Codex returned an invalid structured analysis: ${validationError}`);
    const impactDetails = normalizeImpactDetails(fields.impact_details);
    const companies = impactDetails.length
      ? [...new Set(impactDetails.filter((item) => item.kind === "company" && item.name).map((item) => String(item.name)))]
      : fields.companies || [];
    const industries = impactDetails.length
      ? [...new Set(impactDetails.filter((item) => item.kind !== "company" && item.name).map((item) => String(item.name)))]
      : fields.industries || [];
    const symbols = impactDetails.length
      ? symbolsFromImpactDetails(impactDetails)
      : [...new Set((Array.isArray(fields.symbols) ? fields.symbols : []).map(normalizeTicker).filter((symbol): symbol is string => Boolean(symbol)))];
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
      env.NEWS_DB.prepare(
        "UPDATE research_jobs SET status = 'succeeded', last_error = NULL, finished_at = CURRENT_TIMESTAMP, synthesis_duration_seconds = MAX(0, unixepoch(CURRENT_TIMESTAMP) - unixepoch(started_at)), prediction_delay_seconds = CASE WHEN ? > 0 THEN (SELECT CASE WHEN published_at IS NULL THEN NULL ELSE MAX(0, unixepoch(CURRENT_TIMESTAMP) - unixepoch(published_at)) END FROM articles WHERE id = research_jobs.article_id) ELSE NULL END, research_slot = NULL WHERE id = ?",
      ).bind(symbols.length, jobId),
      env.NEWS_DB.prepare("UPDATE articles SET status = ? WHERE id = ?").bind(symbols.length ? "analyzed" : "archived", article.id),
    ]);
    await ensurePredictionOutcomeTables(env);
    await env.NEWS_DB.batch([
      env.NEWS_DB.prepare("DELETE FROM prediction_outcome_scans WHERE result_id = (SELECT id FROM research_results WHERE job_id = ?)").bind(jobId),
      env.NEWS_DB.prepare("DELETE FROM prediction_outcomes WHERE result_id = (SELECT id FROM research_results WHERE job_id = ?)").bind(jobId),
    ]);
    return { ok: true, jobId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.NEWS_DB.prepare(
      "UPDATE research_jobs SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END, last_error = ?, finished_at = CURRENT_TIMESTAMP, synthesis_duration_seconds = CASE WHEN attempts >= 3 THEN MAX(0, unixepoch(CURRENT_TIMESTAMP) - unixepoch(started_at)) ELSE NULL END, prediction_delay_seconds = NULL, research_slot = NULL WHERE id = ?",
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

async function drainResearchBacklog(env: Env): Promise<number> {
  const deadline = Date.now() + QUEUE_DRAIN_MAX_MS;
  let processed = 0;
  let consecutiveBusy = 0;
  while (processed < QUEUE_DRAIN_MAX_JOBS && Date.now() < deadline) {
    try {
      const result = await processNextJob(env);
      if (result.skipped === "no_pending_jobs") break;
      if (!result.skipped) {
        processed += 1;
        consecutiveBusy = 0;
      }
    } catch (error) {
      if (!(error instanceof ResearchBusyError)) {
        console.error("Backlog research processing failed", error);
        break;
      }
      consecutiveBusy += 1;
      if (consecutiveBusy >= RESEARCH_CONTAINER_COUNT) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return processed;
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
    "SELECT research_jobs.id, research_jobs.article_id FROM research_jobs INNER JOIN articles ON articles.id = research_jobs.article_id WHERE research_jobs.status = 'succeeded' AND articles.status != 'archived' ORDER BY COALESCE(articles.published_at, articles.discovered_at) DESC LIMIT ?",
  )
    .bind(clamped)
    .all<{ id: string; article_id: string }>();

  for (const job of jobs.results || []) {
    await env.NEWS_DB.batch([
      env.NEWS_DB.prepare(
        "UPDATE research_jobs SET status = 'pending', attempts = 0, last_error = NULL, queued_at = CURRENT_TIMESTAMP, started_at = NULL, finished_at = NULL, synthesis_duration_seconds = NULL, prediction_delay_seconds = NULL, prediction_delay_eligible = 0, research_slot = NULL WHERE id = ?",
      ).bind(job.id),
      env.NEWS_DB.prepare("UPDATE articles SET status = 'queued' WHERE id = ?").bind(job.article_id),
      env.NEWS_DB.prepare("DELETE FROM price_impacts WHERE article_id = ?").bind(job.article_id),
    ]);
    await env.RESEARCH_QUEUE.send({ jobId: job.id });
  }

  return { requeued: jobs.results?.length || 0 };
}

async function reanalyzeLegacyJobs(env: Env, limit = 100): Promise<{ requeued: number; remaining: number }> {
  await ensurePredictionOutcomeTables(env);
  const clamped = Math.min(Math.max(limit, 1), 500);
  const jobs = await env.NEWS_DB.prepare(
    "SELECT research_jobs.id, research_jobs.article_id FROM research_results INNER JOIN research_jobs ON research_jobs.id = research_results.job_id WHERE research_jobs.status IN ('succeeded', 'failed') AND (research_results.symbols IS NULL OR research_results.symbols = '[]') AND (research_results.memo IS NULL OR research_results.memo NOT LIKE '%\"impact_details\"%') ORDER BY datetime(research_results.created_at) DESC LIMIT ?",
  )
    .bind(clamped)
    .all<{ id: string; article_id: string }>();

  for (const job of jobs.results || []) {
    await env.NEWS_DB.batch([
      env.NEWS_DB.prepare(
        "UPDATE research_jobs SET status = 'pending', attempts = 0, last_error = NULL, queued_at = CURRENT_TIMESTAMP, started_at = NULL, finished_at = NULL, synthesis_duration_seconds = NULL, prediction_delay_seconds = NULL, prediction_delay_eligible = 0, research_slot = NULL WHERE id = ?",
      ).bind(job.id),
      env.NEWS_DB.prepare("UPDATE articles SET status = 'queued' WHERE id = ?").bind(job.article_id),
      env.NEWS_DB.prepare("DELETE FROM price_impacts WHERE article_id = ?").bind(job.article_id),
      env.NEWS_DB.prepare("DELETE FROM prediction_outcomes WHERE article_id = ?").bind(job.article_id),
    ]);
    await env.RESEARCH_QUEUE.send({ jobId: job.id });
  }

  const remaining = await env.NEWS_DB.prepare(
    "SELECT COUNT(*) AS count FROM research_results INNER JOIN research_jobs ON research_jobs.id = research_results.job_id WHERE research_jobs.status IN ('succeeded', 'failed') AND (research_results.symbols IS NULL OR research_results.symbols = '[]') AND (research_results.memo IS NULL OR research_results.memo NOT LIKE '%\"impact_details\"%')",
  ).first<{ count: number }>();

  return { requeued: jobs.results?.length || 0, remaining: Number(remaining?.count || 0) };
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

async function fetchYahooChart(
  symbol: string,
  publishedAt: string,
  interval = "1h",
  lookaheadDays = 32,
): Promise<{ timestamps: number[]; closes: Array<number | null> }> {
  const published = unixSeconds(publishedAt);
  const period1 = Math.max(0, published - 3 * 24 * 60 * 60);
  const period2 = published + lookaheadDays * 24 * 60 * 60;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?period1=${period1}&period2=${period2}&interval=${encodeURIComponent(interval)}&includePrePost=true`;
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
    "SELECT research_results.id, research_results.article_id, research_results.created_at, research_results.symbols, research_results.sentiment_score, research_results.confidence, research_results.event_type, research_results.summary, research_results.memo, articles.title, articles.url, articles.published_at FROM research_results INNER JOIN articles ON articles.id = research_results.article_id WHERE articles.status != 'archived' AND research_results.symbols IS NOT NULL AND trim(research_results.symbols) NOT IN ('', '[]') ORDER BY research_results.created_at DESC LIMIT ?",
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
    "SELECT research_results.*, articles.title, articles.url, articles.published_at, sources.name AS source_name FROM research_results INNER JOIN articles ON articles.id = research_results.article_id LEFT JOIN sources ON sources.id = articles.source_id WHERE articles.status != 'archived' AND research_results.symbols IS NOT NULL AND trim(research_results.symbols) NOT IN ('', '[]') ORDER BY research_results.created_at DESC LIMIT ?",
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

const PREDICTION_INTERVALS: Array<{ label: string; seconds: number; chart: "short" | "long" }> = [
  { label: "12h", seconds: 12 * 60 * 60, chart: "short" },
  { label: "24h", seconds: 24 * 60 * 60, chart: "short" },
  { label: "48h", seconds: 48 * 60 * 60, chart: "short" },
  { label: "1w", seconds: 7 * 24 * 60 * 60, chart: "short" },
  { label: "2w", seconds: 14 * 24 * 60 * 60, chart: "short" },
  { label: "1m", seconds: 30 * 24 * 60 * 60, chart: "short" },
  { label: "3m", seconds: 91 * 24 * 60 * 60, chart: "long" },
  { label: "6m", seconds: 183 * 24 * 60 * 60, chart: "long" },
  { label: "1y", seconds: 365 * 24 * 60 * 60, chart: "long" },
  { label: "2y", seconds: 2 * 365 * 24 * 60 * 60, chart: "long" },
  { label: "3y", seconds: 3 * 365 * 24 * 60 * 60, chart: "long" },
  { label: "4y", seconds: 4 * 365 * 24 * 60 * 60, chart: "long" },
];

async function ensurePredictionOutcomeTables(env: Env): Promise<void> {
  await env.NEWS_DB.batch([
    env.NEWS_DB.prepare(
      "CREATE TABLE IF NOT EXISTS prediction_outcomes (id TEXT PRIMARY KEY, result_id TEXT NOT NULL, article_id TEXT NOT NULL, article_title TEXT, article_url TEXT, symbol TEXT NOT NULL, company TEXT, direction TEXT NOT NULL, score REAL, confidence REAL, rationale TEXT, prediction_at TEXT NOT NULL, baseline_price REAL, baseline_at TEXT, intervals_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(result_id, symbol))",
    ),
    env.NEWS_DB.prepare("CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_prediction_at ON prediction_outcomes(prediction_at DESC)"),
    env.NEWS_DB.prepare("CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_symbol ON prediction_outcomes(symbol)"),
    env.NEWS_DB.prepare(
      "CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_symbol_prediction_at_direction ON prediction_outcomes(symbol, prediction_at, direction)",
    ),
    env.NEWS_DB.prepare(
      "CREATE TABLE IF NOT EXISTS prediction_outcome_scans (result_id TEXT PRIMARY KEY, scanned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, outcome_count INTEGER NOT NULL DEFAULT 0, skipped_count INTEGER NOT NULL DEFAULT 0)",
    ),
    env.NEWS_DB.prepare("CREATE INDEX IF NOT EXISTS idx_prediction_outcome_scans_scanned_at ON prediction_outcome_scans(scanned_at ASC)"),
    env.NEWS_DB.prepare(
      "CREATE TABLE IF NOT EXISTS prediction_daily_points_v2 (outcome_id TEXT NOT NULL, prediction_at TEXT NOT NULL, day_index INTEGER NOT NULL, sampled_at TEXT NOT NULL, price REAL NOT NULL, change_pct REAL NOT NULL, PRIMARY KEY(outcome_id, day_index))",
    ),
    env.NEWS_DB.prepare("CREATE INDEX IF NOT EXISTS idx_prediction_daily_points_v2_day ON prediction_daily_points_v2(day_index)"),
  ]);
}

function predictionDirection(row: ResearchResultRow, detail: ImpactDetail | null): "bullish" | "bearish" | null {
  if (detail?.direction === "bullish" || detail?.direction === "bearish") return detail.direction;
  const score = Number(row.sentiment_score);
  if (!Number.isFinite(score) || Math.abs(score) < 0.05) return null;
  return score > 0 ? "bullish" : "bearish";
}

function predictionIntervalTargets(predictionAt: string): Record<string, number> {
  const base = unixSeconds(predictionAt);
  return Object.fromEntries(PREDICTION_INTERVALS.map((item) => [item.label, base + item.seconds]));
}

function predictionDailyPoints(
  predictionAt: string,
  baseline: { at: number; price: number } | null,
  chart: { timestamps: number[]; closes: Array<number | null> },
): PredictionDailyPoint[] {
  if (!baseline || !Number.isFinite(baseline.price) || baseline.price === 0) return [];
  const predictionEpoch = unixSeconds(predictionAt);
  const now = Math.floor(Date.now() / 1000);
  const maxTrackedDay = Math.max(0, Math.floor((now - predictionEpoch) / (24 * 60 * 60)));
  const marketPoints = chart.timestamps
    .map((at, index) => ({ at, price: chart.closes[index] }))
    .filter((point): point is { at: number; price: number } =>
      point.at > predictionEpoch &&
      point.at <= now &&
      typeof point.price === "number" &&
      Number.isFinite(point.price),
    )
    .sort((a, b) => a.at - b.at);
  const points: PredictionDailyPoint[] = [{
    day_index: 0,
    at: isoFromUnix(predictionEpoch),
    price: baseline.price,
    change_pct: 0,
  }];
  let marketIndex = 0;
  let latestPrice = baseline.price;
  for (let dayIndex = 1; dayIndex <= maxTrackedDay; dayIndex += 1) {
    const target = predictionEpoch + dayIndex * 24 * 60 * 60;
    while (marketIndex < marketPoints.length && marketPoints[marketIndex].at <= target) {
      latestPrice = marketPoints[marketIndex].price;
      marketIndex += 1;
    }
    points.push({
      day_index: dayIndex,
      at: isoFromUnix(target),
      price: latestPrice,
      change_pct: ((latestPrice - baseline.price) / baseline.price) * 100,
    });
  }
  return points;
}

async function persistPredictionDailyPoints(env: Env, outcome: PredictionOutcome): Promise<void> {
  const points = outcome.daily_points || [];
  if (!points.length) return;
  const existing = await env.NEWS_DB.prepare(
    "SELECT prediction_at, MAX(day_index) AS max_day FROM prediction_daily_points_v2 WHERE outcome_id = ?",
  )
    .bind(outcome.id)
    .first<{ prediction_at: string | null; max_day: number | null }>();
  const samePredictionTime = existing?.prediction_at && unixSeconds(existing.prediction_at) === unixSeconds(outcome.prediction_at);
  if (existing?.prediction_at && !samePredictionTime) {
    await env.NEWS_DB.prepare("DELETE FROM prediction_daily_points_v2 WHERE outcome_id = ?").bind(outcome.id).run();
  }
  const maxStoredDay = samePredictionTime ? Number(existing?.max_day ?? -1) : -1;
  const pending = points.filter((point) => point.day_index >= Math.max(0, maxStoredDay - 1));
  for (let offset = 0; offset < pending.length; offset += 15) {
    const chunk = pending.slice(offset, offset + 15);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
    const bindings = chunk.flatMap((point) => [
      outcome.id,
      outcome.prediction_at,
      point.day_index,
      point.at,
      point.price,
      point.change_pct,
    ]);
    await env.NEWS_DB.prepare(
      `INSERT INTO prediction_daily_points_v2 (outcome_id, prediction_at, day_index, sampled_at, price, change_pct) VALUES ${placeholders} ON CONFLICT(outcome_id, day_index) DO UPDATE SET prediction_at = excluded.prediction_at, sampled_at = excluded.sampled_at, price = excluded.price, change_pct = excluded.change_pct`,
    )
      .bind(...bindings)
      .run();
  }
}

async function computePredictionOutcome(row: ResearchResultRow, symbol: string, detail: ImpactDetail | null): Promise<PredictionOutcome | null> {
  const direction = predictionDirection(row, detail);
  if (!direction) return null;

  const predictionAt = normalizeDate(row.published_at) || normalizeDate(row.created_at) || row.created_at;
  const [shortChart, longChart] = await Promise.all([
    fetchYahooChart(symbol, predictionAt, "1h", 45),
    fetchYahooChart(symbol, predictionAt, "1d", 4 * 365 + 14),
  ]);
  const baseline =
    nearestPoint(shortChart.timestamps, shortChart.closes, unixSeconds(predictionAt), "after") ||
    nearestPoint(longChart.timestamps, longChart.closes, unixSeconds(predictionAt), "after");
  const intervals: Record<string, PredictionPoint> = {};
  const targets = predictionIntervalTargets(predictionAt);

  for (const interval of PREDICTION_INTERVALS) {
    const chart = interval.chart === "short" ? shortChart : longChart;
    const point = nearestElapsedPoint(chart.timestamps, chart.closes, targets[interval.label]);
    const change = point && baseline ? ((point.price - baseline.price) / baseline.price) * 100 : null;
    intervals[interval.label] = {
      at: point ? isoFromUnix(point.at) : isoFromUnix(targets[interval.label]),
      price: point?.price ?? null,
      change_pct: change,
      accurate: change === null ? null : direction === "bullish" ? change > 0 : change < 0,
    };
  }

  return {
    id: `${row.id}:${symbol}`,
    result_id: row.id,
    article_id: row.article_id,
    title: row.title || null,
    url: row.url || null,
    symbol,
    company: detail?.name || null,
    direction,
    score: row.sentiment_score,
    confidence: typeof detail?.confidence === "number" ? detail.confidence : row.confidence,
    rationale: detail?.reason || row.summary || null,
    prediction_at: predictionAt,
    baseline_price: baseline?.price ?? null,
    baseline_at: baseline ? isoFromUnix(baseline.at) : null,
    intervals,
    daily_points: predictionDailyPoints(predictionAt, baseline, longChart),
    updated_at: new Date().toISOString(),
  };
}

async function processPredictionOutcomes(
  env: Env,
  limit = 100,
): Promise<{ processed: number; skipped: number; outcomes: number; unscanned_results: number }> {
  await ensurePredictionOutcomeTables(env);
  const clamped = Math.min(Math.max(limit, 1), 500);
  const result = await env.NEWS_DB.prepare(
    "SELECT research_results.id, research_results.article_id, research_results.created_at, research_results.symbols, research_results.sentiment_score, research_results.confidence, research_results.event_type, research_results.summary, research_results.memo, articles.title, articles.url, articles.published_at FROM research_results LEFT JOIN articles ON articles.id = research_results.article_id LEFT JOIN prediction_outcome_scans ON prediction_outcome_scans.result_id = research_results.id WHERE research_results.symbols IS NOT NULL AND research_results.symbols != '[]' ORDER BY CASE WHEN prediction_outcome_scans.result_id IS NULL THEN 0 WHEN EXISTS (SELECT 1 FROM prediction_outcomes WHERE prediction_outcomes.result_id = research_results.id AND NOT EXISTS (SELECT 1 FROM prediction_daily_points_v2 WHERE prediction_daily_points_v2.outcome_id = prediction_outcomes.id)) THEN 1 WHEN EXISTS (SELECT 1 FROM prediction_outcomes WHERE prediction_outcomes.result_id = research_results.id AND datetime(prediction_outcomes.prediction_at) != datetime(COALESCE(articles.published_at, research_results.created_at))) THEN 2 ELSE 3 END, datetime(prediction_outcome_scans.scanned_at) ASC, datetime(research_results.created_at) ASC LIMIT ?",
  )
    .bind(clamped)
    .all<ResearchResultRow>();
  const rows = result.results || [];
  let skipped = 0;
  let outcomes = 0;

  for (const row of rows) {
    let rowOutcomes = 0;
    let rowSkipped = 0;
    for (const symbol of symbolsForResearchRow(row)) {
      const detail = impactDetailForSymbol(row, symbol);
      try {
        const outcome = await computePredictionOutcome(row, symbol, detail);
        if (!outcome) {
          skipped += 1;
          rowSkipped += 1;
          continue;
        }
        await env.NEWS_DB.prepare(
          "INSERT INTO prediction_outcomes (id, result_id, article_id, article_title, article_url, symbol, company, direction, score, confidence, rationale, prediction_at, baseline_price, baseline_at, intervals_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(result_id, symbol) DO UPDATE SET article_title = excluded.article_title, article_url = excluded.article_url, company = excluded.company, direction = excluded.direction, score = excluded.score, confidence = excluded.confidence, rationale = excluded.rationale, prediction_at = excluded.prediction_at, baseline_price = excluded.baseline_price, baseline_at = excluded.baseline_at, intervals_json = excluded.intervals_json, updated_at = CURRENT_TIMESTAMP",
        )
          .bind(
            outcome.id,
            outcome.result_id,
            outcome.article_id,
            outcome.title,
            outcome.url,
            outcome.symbol,
            outcome.company,
            outcome.direction,
            outcome.score,
            outcome.confidence,
            outcome.rationale,
            outcome.prediction_at,
            outcome.baseline_price,
            outcome.baseline_at,
            JSON.stringify(outcome.intervals),
          )
          .run();
        await persistPredictionDailyPoints(env, outcome).catch((error) =>
          console.error("Prediction daily point persistence failed", symbol, row.id, error),
        );
        outcomes += 1;
        rowOutcomes += 1;
      } catch (error) {
        console.error("Prediction outcome processing failed", symbol, row.id, error);
        skipped += 1;
        rowSkipped += 1;
      }
    }
    await env.NEWS_DB.prepare(
      "INSERT INTO prediction_outcome_scans (result_id, scanned_at, outcome_count, skipped_count) VALUES (?, CURRENT_TIMESTAMP, ?, ?) ON CONFLICT(result_id) DO UPDATE SET scanned_at = CURRENT_TIMESTAMP, outcome_count = excluded.outcome_count, skipped_count = excluded.skipped_count",
    )
      .bind(row.id, rowOutcomes, rowSkipped)
      .run();
  }

  const [remaining, dateRepair] = await Promise.all([
    env.NEWS_DB.prepare(
      "SELECT COUNT(*) AS count FROM research_results LEFT JOIN prediction_outcome_scans ON prediction_outcome_scans.result_id = research_results.id WHERE research_results.symbols IS NOT NULL AND research_results.symbols != '[]' AND prediction_outcome_scans.result_id IS NULL",
    ).first<{ count: number }>(),
    env.NEWS_DB.prepare(
      "SELECT COUNT(DISTINCT prediction_outcomes.result_id) AS count FROM prediction_outcomes INNER JOIN research_results ON research_results.id = prediction_outcomes.result_id LEFT JOIN articles ON articles.id = research_results.article_id WHERE datetime(prediction_outcomes.prediction_at) != datetime(COALESCE(articles.published_at, research_results.created_at))",
    ).first<{ count: number }>(),
  ]);
  return {
    processed: rows.length,
    skipped,
    outcomes,
    unscanned_results: Number(remaining?.count || 0) + Number(dateRepair?.count || 0),
  };
}

function parsePredictionIntervals(value: string): Record<string, PredictionPoint> {
  try {
    const parsed = JSON.parse(value) as Record<string, PredictionPoint>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

type PredictionSummaryRow = {
  direction: "bullish" | "bearish";
  confidence_bin: number;
  samples: number;
  accurate: number;
  average_movement_pct: number | null;
};

type PredictionDailySummaryRow = {
  direction: "bullish" | "bearish";
  confidence_bin: number;
  day_index: number;
  samples: number;
  average_movement_pct: number | null;
};

const PREDICTION_DATE_MATCH_SQL =
  "datetime(prediction_outcomes.prediction_at) = datetime(COALESCE(articles.published_at, research_results.created_at))";
const PREDICTION_CONFIDENCE_PCT_SQL =
  "CASE WHEN prediction_outcomes.confidence <= 1 THEN prediction_outcomes.confidence * 100 ELSE prediction_outcomes.confidence END";
const PREDICTION_ACCURACY_CUTOFF_EPOCH_SQL =
  "(SELECT MIN(unixepoch(opposite_outcomes.prediction_at)) FROM prediction_outcomes AS opposite_outcomes INNER JOIN research_results AS opposite_results ON opposite_results.id = opposite_outcomes.result_id LEFT JOIN articles AS opposite_articles ON opposite_articles.id = opposite_results.article_id WHERE opposite_outcomes.symbol = prediction_outcomes.symbol AND opposite_outcomes.direction IN ('bullish', 'bearish') AND opposite_outcomes.direction != prediction_outcomes.direction AND unixepoch(opposite_outcomes.prediction_at) > unixepoch(prediction_outcomes.prediction_at) AND datetime(opposite_outcomes.prediction_at) = datetime(COALESCE(opposite_articles.published_at, opposite_results.created_at)))";
const PREDICTION_HAS_COUNTED_INTERVAL_SQL =
  "EXISTS (SELECT 1 FROM json_each(prediction_outcomes.intervals_json) AS accuracy_interval WHERE json_type(accuracy_interval.value, '$.change_pct') IN ('integer', 'real') AND NOT EXISTS (SELECT 1 FROM prediction_outcomes AS interval_opposite_outcomes INNER JOIN research_results AS interval_opposite_results ON interval_opposite_results.id = interval_opposite_outcomes.result_id LEFT JOIN articles AS interval_opposite_articles ON interval_opposite_articles.id = interval_opposite_results.article_id WHERE interval_opposite_outcomes.symbol = prediction_outcomes.symbol AND interval_opposite_outcomes.direction IN ('bullish', 'bearish') AND interval_opposite_outcomes.direction != prediction_outcomes.direction AND unixepoch(interval_opposite_outcomes.prediction_at) > unixepoch(prediction_outcomes.prediction_at) AND unixepoch(interval_opposite_outcomes.prediction_at) <= unixepoch(json_extract(accuracy_interval.value, '$.at')) AND datetime(interval_opposite_outcomes.prediction_at) = datetime(COALESCE(interval_opposite_articles.published_at, interval_opposite_results.created_at))))";

async function buildPredictionSummary(env: Env): Promise<Record<string, unknown>[]> {
  const statements = PREDICTION_INTERVALS.map((interval) => {
    const path = `$."${interval.label}".change_pct`;
    const sampledAtPath = `$."${interval.label}".at`;
    return env.NEWS_DB.prepare(
      `WITH eligible AS (SELECT prediction_outcomes.direction, ${PREDICTION_CONFIDENCE_PCT_SQL} AS confidence_pct, CAST(json_extract(prediction_outcomes.intervals_json, ?) AS REAL) AS movement_pct FROM prediction_outcomes INNER JOIN research_results ON research_results.id = prediction_outcomes.result_id LEFT JOIN articles ON articles.id = research_results.article_id WHERE prediction_outcomes.direction IN ('bullish', 'bearish') AND prediction_outcomes.confidence IS NOT NULL AND ${PREDICTION_DATE_MATCH_SQL} AND json_type(prediction_outcomes.intervals_json, ?) IN ('integer', 'real') AND NOT EXISTS (SELECT 1 FROM prediction_outcomes AS opposite_outcomes INNER JOIN research_results AS opposite_results ON opposite_results.id = opposite_outcomes.result_id LEFT JOIN articles AS opposite_articles ON opposite_articles.id = opposite_results.article_id WHERE opposite_outcomes.symbol = prediction_outcomes.symbol AND opposite_outcomes.direction IN ('bullish', 'bearish') AND opposite_outcomes.direction != prediction_outcomes.direction AND unixepoch(opposite_outcomes.prediction_at) > unixepoch(prediction_outcomes.prediction_at) AND unixepoch(opposite_outcomes.prediction_at) <= unixepoch(json_extract(prediction_outcomes.intervals_json, ?)) AND datetime(opposite_outcomes.prediction_at) = datetime(COALESCE(opposite_articles.published_at, opposite_results.created_at)))) SELECT direction, CASE WHEN confidence_pct >= 100 THEN 9 ELSE CAST(confidence_pct / 10 AS INTEGER) END AS confidence_bin, COUNT(*) AS samples, SUM(CASE WHEN (direction = 'bullish' AND movement_pct > 0) OR (direction = 'bearish' AND movement_pct < 0) THEN 1 ELSE 0 END) AS accurate, AVG(movement_pct) AS average_movement_pct FROM eligible WHERE confidence_pct >= 0 AND confidence_pct <= 100 GROUP BY direction, confidence_bin ORDER BY direction, confidence_bin`,
    ).bind(path, path, sampledAtPath);
  });
  const results = await env.NEWS_DB.batch<PredictionSummaryRow>(statements);
  return PREDICTION_INTERVALS.map((interval, index) => {
    const rows = results[index]?.results || [];
    const cellsFor = (direction: "bullish" | "bearish") =>
      Array.from({ length: 10 }, (_, confidenceBin) => {
        const row = rows.find((item) => item.direction === direction && Number(item.confidence_bin) === confidenceBin);
        const samples = Number(row?.samples || 0);
        return {
          confidence_min: confidenceBin * 10,
          confidence_max: (confidenceBin + 1) * 10,
          samples,
          accuracy_pct: samples ? (Number(row?.accurate || 0) / samples) * 100 : null,
          average_movement_pct: row?.average_movement_pct ?? null,
        };
      });
    return {
      interval: interval.label,
      bullish: cellsFor("bullish"),
      bearish: cellsFor("bearish"),
    };
  });
}

async function buildPredictionDailySummary(env: Env): Promise<{
  series: PredictionDailySummaryRow[];
  coverage: Record<string, number>;
}> {
  const daily = await env.NEWS_DB.prepare(
    `WITH accuracy_predictions AS (SELECT prediction_outcomes.id, prediction_outcomes.symbol, prediction_outcomes.direction, prediction_outcomes.prediction_at, ${PREDICTION_CONFIDENCE_PCT_SQL} AS confidence_pct FROM prediction_outcomes INNER JOIN research_results ON research_results.id = prediction_outcomes.result_id LEFT JOIN articles ON articles.id = research_results.article_id WHERE prediction_outcomes.direction IN ('bullish', 'bearish') AND prediction_outcomes.confidence IS NOT NULL AND ${PREDICTION_CONFIDENCE_PCT_SQL} >= 0 AND ${PREDICTION_CONFIDENCE_PCT_SQL} <= 100 AND ${PREDICTION_DATE_MATCH_SQL} AND ${PREDICTION_HAS_COUNTED_INTERVAL_SQL}), eligible AS (SELECT accuracy_predictions.direction, accuracy_predictions.confidence_pct, prediction_daily_points_v2.day_index, prediction_daily_points_v2.change_pct FROM accuracy_predictions INNER JOIN prediction_daily_points_v2 ON prediction_daily_points_v2.outcome_id = accuracy_predictions.id WHERE NOT EXISTS (SELECT 1 FROM prediction_outcomes AS opposite_outcomes INNER JOIN research_results AS opposite_results ON opposite_results.id = opposite_outcomes.result_id LEFT JOIN articles AS opposite_articles ON opposite_articles.id = opposite_results.article_id WHERE opposite_outcomes.symbol = accuracy_predictions.symbol AND opposite_outcomes.direction IN ('bullish', 'bearish') AND opposite_outcomes.direction != accuracy_predictions.direction AND unixepoch(opposite_outcomes.prediction_at) > unixepoch(accuracy_predictions.prediction_at) AND unixepoch(opposite_outcomes.prediction_at) <= unixepoch(prediction_daily_points_v2.sampled_at) AND datetime(opposite_outcomes.prediction_at) = datetime(COALESCE(opposite_articles.published_at, opposite_results.created_at)))) SELECT direction, CASE WHEN confidence_pct >= 100 THEN 9 ELSE CAST(confidence_pct / 10 AS INTEGER) END AS confidence_bin, day_index, COUNT(*) AS samples, AVG(change_pct) AS average_movement_pct FROM eligible GROUP BY direction, confidence_bin, day_index ORDER BY day_index, direction, confidence_bin`,
  ).all<PredictionDailySummaryRow>();
  const coverage = await env.NEWS_DB.prepare(
    `SELECT MAX(MAX(0, CAST((unixepoch('now') - unixepoch(prediction_outcomes.prediction_at)) / 86400 AS INTEGER))) AS oldest_age_days, COUNT(DISTINCT prediction_outcomes.id) AS eligible_predictions, COUNT(DISTINCT prediction_daily_points_v2.outcome_id) AS daily_predictions FROM prediction_outcomes INNER JOIN research_results ON research_results.id = prediction_outcomes.result_id LEFT JOIN articles ON articles.id = research_results.article_id LEFT JOIN prediction_daily_points_v2 ON prediction_daily_points_v2.outcome_id = prediction_outcomes.id WHERE prediction_outcomes.direction IN ('bullish', 'bearish') AND prediction_outcomes.confidence IS NOT NULL AND ${PREDICTION_CONFIDENCE_PCT_SQL} >= 0 AND ${PREDICTION_CONFIDENCE_PCT_SQL} <= 100 AND ${PREDICTION_DATE_MATCH_SQL} AND ${PREDICTION_HAS_COUNTED_INTERVAL_SQL}`,
  ).first<{ oldest_age_days: number | null; eligible_predictions: number; daily_predictions: number }>();
  return {
    series: (daily.results || []).map((row) => ({
      direction: row.direction,
      confidence_bin: Number(row.confidence_bin),
      day_index: Number(row.day_index),
      samples: Number(row.samples || 0),
      average_movement_pct: row.average_movement_pct === null ? null : Number(row.average_movement_pct),
    })),
    coverage: {
      oldest_age_days: Number(coverage?.oldest_age_days || 0),
      eligible_predictions: Number(coverage?.eligible_predictions || 0),
      daily_predictions: Number(coverage?.daily_predictions || 0),
    },
  };
}

function predictionOutcomeFromStoredRow(row: StoredPredictionOutcomeRow): PredictionOutcome {
  const cutoffEpoch = Number(row.accuracy_cutoff_epoch);
  const hasCutoff = Number.isFinite(cutoffEpoch) && cutoffEpoch > 0;
  const confidence = Number(row.confidence);
  const confidencePct = confidence <= 1 ? confidence * 100 : confidence;
  const hasEligibleConfidence = row.confidence !== null && Number.isFinite(confidencePct) && confidencePct >= 0 && confidencePct <= 100;
  const intervals = parsePredictionIntervals(row.intervals_json);
  for (const point of Object.values(intervals)) {
    const sampledAt = unixSeconds(point.at);
    point.counts_toward_accuracy =
      hasEligibleConfidence &&
      point.change_pct !== null &&
      point.change_pct !== undefined &&
      Number.isFinite(sampledAt) &&
      (!hasCutoff || sampledAt < cutoffEpoch);
  }
  return {
    id: row.id,
    result_id: row.result_id,
    article_id: row.article_id,
    title: row.article_title,
    url: row.article_url,
    symbol: row.symbol,
    company: row.company,
    direction: row.direction,
    score: row.score,
    confidence: row.confidence,
    rationale: row.rationale,
    prediction_at: row.prediction_at,
    baseline_price: row.baseline_price,
    baseline_at: row.baseline_at,
    intervals,
    updated_at: row.updated_at,
  };
}

function encodePredictionCursor(outcome: PredictionOutcome): string {
  return btoa(JSON.stringify({ prediction_at: outcome.prediction_at, id: outcome.id }));
}

function decodePredictionCursor(value: string | null): { prediction_at: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(atob(value)) as { prediction_at?: unknown; id?: unknown };
    return typeof parsed.prediction_at === "string" && typeof parsed.id === "string"
      ? { prediction_at: parsed.prediction_at, id: parsed.id }
      : null;
  } catch {
    return null;
  }
}

async function buildPredictionPage(
  env: Env,
  limit: number,
  filters: PredictionOutcomeFilters,
): Promise<{ outcomes: PredictionOutcome[]; next_cursor: string | null; has_more: boolean; total: number }> {
  await ensurePredictionOutcomeTables(env);
  const pageLimit = Math.min(Math.max(limit, 10), 100);
  const clauses = [PREDICTION_DATE_MATCH_SQL];
  const bindings: Array<string | number> = [];

  if (filters.direction) {
    clauses.push("prediction_outcomes.direction = ?");
    bindings.push(filters.direction);
  }
  if (filters.confidenceMin !== null) {
    clauses.push(`${PREDICTION_CONFIDENCE_PCT_SQL} >= ?`);
    bindings.push(filters.confidenceMin);
  }
  if (filters.confidenceMax !== null) {
    clauses.push(`${PREDICTION_CONFIDENCE_PCT_SQL} ${filters.confidenceMax >= 100 ? "<=" : "<"} ?`);
    bindings.push(filters.confidenceMax);
  }

  const fromSql =
    "FROM prediction_outcomes INNER JOIN research_results ON research_results.id = prediction_outcomes.result_id LEFT JOIN articles ON articles.id = research_results.article_id";
  const count = await env.NEWS_DB.prepare(`SELECT COUNT(*) AS count ${fromSql} WHERE ${clauses.join(" AND ")}`)
    .bind(...bindings)
    .first<{ count: number }>();

  const pageClauses = [...clauses];
  const pageBindings = [...bindings];
  const cursor = decodePredictionCursor(filters.cursor);
  if (cursor) {
    pageClauses.push(
      "(datetime(prediction_outcomes.prediction_at) < datetime(?) OR (datetime(prediction_outcomes.prediction_at) = datetime(?) AND prediction_outcomes.id < ?))",
    );
    pageBindings.push(cursor.prediction_at, cursor.prediction_at, cursor.id);
  }
  pageBindings.push(pageLimit + 1);

  const result = await env.NEWS_DB.prepare(
    `SELECT prediction_outcomes.*, ${PREDICTION_ACCURACY_CUTOFF_EPOCH_SQL} AS accuracy_cutoff_epoch ${fromSql} WHERE ${pageClauses.join(" AND ")} ORDER BY datetime(prediction_outcomes.prediction_at) DESC, prediction_outcomes.id DESC LIMIT ?`,
  )
    .bind(...pageBindings)
    .all<StoredPredictionOutcomeRow>();
  const rows = result.results || [];
  const hasMore = rows.length > pageLimit;
  const outcomes = rows.slice(0, pageLimit).map(predictionOutcomeFromStoredRow);
  return {
    outcomes,
    next_cursor: hasMore && outcomes.length ? encodePredictionCursor(outcomes[outcomes.length - 1]) : null,
    has_more: hasMore,
    total: Number(count?.count || 0),
  };
}

async function buildPredictionOutcomes(
  env: Env,
  limit: number,
  filters: PredictionOutcomeFilters,
): Promise<{
  outcomes: PredictionOutcome[];
  next_cursor: string | null;
  has_more: boolean;
  total: number;
  summary: Record<string, unknown>[];
  coverage: Record<string, number>;
  daily_series: PredictionDailySummaryRow[];
  daily_coverage: Record<string, number>;
}> {
  await ensurePredictionOutcomeTables(env);
  await processPredictionOutcomes(env, Math.min(Math.max(limit, 5), 10)).catch((error) =>
    console.error("Inline prediction outcome refresh failed", error),
  );
  const [page, summary, dailySummary, coverage, dateRepair] = await Promise.all([
    buildPredictionPage(env, limit, filters),
    buildPredictionSummary(env),
    buildPredictionDailySummary(env),
    env.NEWS_DB.prepare(
      `SELECT COUNT(*) AS predictions, COUNT(DISTINCT prediction_outcomes.article_id) AS articles FROM prediction_outcomes INNER JOIN research_results ON research_results.id = prediction_outcomes.result_id LEFT JOIN articles ON articles.id = research_results.article_id WHERE ${PREDICTION_DATE_MATCH_SQL}`,
    ).first<{ predictions: number; articles: number }>(),
    env.NEWS_DB.prepare(
      "SELECT COUNT(DISTINCT prediction_outcomes.result_id) AS count FROM prediction_outcomes INNER JOIN research_results ON research_results.id = prediction_outcomes.result_id LEFT JOIN articles ON articles.id = research_results.article_id WHERE datetime(prediction_outcomes.prediction_at) != datetime(COALESCE(articles.published_at, research_results.created_at))",
    ).first<{ count: number }>(),
  ]);

  return {
    ...page,
    summary,
    daily_series: dailySummary.series,
    daily_coverage: dailySummary.coverage,
    coverage: {
      predictions: Number(coverage?.predictions || 0),
      articles: Number(coverage?.articles || 0),
      date_repair_pending: Number(dateRepair?.count || 0),
    },
  };
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
  if (now.getUTCHours() === 0 && now.getUTCMinutes() < 30) return null;
  const previous = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return previous.toISOString().slice(0, 10);
}

async function cleanupPrematureEodReports(env: Env): Promise<{ removed: number }> {
  await ensureEodSimulationTables(env);
  const today = new Date().toISOString().slice(0, 10);
  const reports = await env.NEWS_DB.prepare("SELECT id FROM eod_reports WHERE report_date >= ?").bind(today).all<{ id: string }>();
  for (const report of reports.results || []) {
    await env.NEWS_DB.batch([
      env.NEWS_DB.prepare("DELETE FROM eod_simulation_trades WHERE report_id = ?").bind(report.id),
      env.NEWS_DB.prepare("DELETE FROM eod_reports WHERE id = ?").bind(report.id),
    ]);
  }
  return { removed: reports.results?.length || 0 };
}

async function resetEodSimulation(env: Env): Promise<{ reset: true }> {
  await ensureEodSimulationTables(env);
  await env.NEWS_DB.batch([
    env.NEWS_DB.prepare("DELETE FROM eod_simulation_trades"),
    env.NEWS_DB.prepare("DELETE FROM eod_simulation_snapshots"),
    env.NEWS_DB.prepare("DELETE FROM eod_simulation_positions"),
    env.NEWS_DB.prepare("DELETE FROM eod_reports"),
    env.NEWS_DB.prepare("UPDATE eod_simulation_state SET starting_cash = 100000, cash = 100000, updated_at = CURRENT_TIMESTAMP WHERE id = 'default'"),
  ]);
  return { reset: true };
}

async function processEodSimulation(env: Env): Promise<{ processed: boolean; report_date?: string; trades?: number; skipped?: string }> {
  await ensureEodSimulationTables(env);
  await cleanupPrematureEodReports(env);
  const reportDate = eodReportDate();
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

  const currentPositions = await listEodPositions(env);
  const heldSymbols = new Map(currentPositions.map((position) => [position.symbol, Number(position.shares || 0)]));
  const qualified = candidates.filter((item) => {
    if (Math.abs(item.score) < 0.15 || item.confidence < 0.5) return false;
    if (item.score < 0 && !heldSymbols.get(item.symbol)) return false;
    return true;
  });
  const executable = [];
  const prices = new Map<string, number>();
  for (const item of qualified.slice(0, 25)) {
    const row = (rows.results || []).find((candidate) => candidate.id === item.result_id);
    if (!row) continue;
    const impact = await getPriceImpact(env, row, item.symbol, impactDetailForSymbol(row, item.symbol));
    if (!impact?.baseline_price) continue;
    prices.set(item.symbol, impact.baseline_price);
    executable.push(item);
  }
  const chosen = executable.length >= 10 ? executable.slice(0, 10) : [];
  const reportId = crypto.randomUUID();
  const summary = chosen.length
    ? `EOD model selected ${chosen.length} high-confidence ticker movement(s) from ${candidates.length} candidates for ${reportDate}.`
    : `EOD model found ${qualified.length} actionable qualifying movement(s) and ${executable.length} executable movement(s) for ${reportDate}; bearish signals for tickers not held were ignored, and no trades were placed because 10 executable candidates are required.`;
  await env.NEWS_DB.prepare("INSERT INTO eod_reports (id, report_date, summary, candidates_json, chosen_json) VALUES (?, ?, ?, ?, ?)")
    .bind(reportId, reportDate, summary, JSON.stringify(candidates), JSON.stringify(chosen))
    .run();

  let trades = 0;
  const state = await env.NEWS_DB.prepare("SELECT * FROM eod_simulation_state WHERE id = 'default'").first<SimulationStateRow>();
  let cash = Number(state?.cash || 100000);
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
  const clamped = Math.min(Math.max(limit, 1), 500);
  const result = await db.prepare(query).bind(clamped).all<T>();
  return result.results || [];
}

async function archiveTickerlessArticles(env: Env): Promise<number> {
  const result = await env.NEWS_DB.prepare(
    "UPDATE articles SET status = 'archived' WHERE status = 'analyzed' AND EXISTS (SELECT 1 FROM research_results WHERE research_results.article_id = articles.id) AND NOT EXISTS (SELECT 1 FROM research_results WHERE research_results.article_id = articles.id AND research_results.symbols IS NOT NULL AND trim(research_results.symbols) NOT IN ('', '[]'))",
  ).run();
  return Number(result.meta?.changes || 0);
}

async function researchOperationsTelemetry(db: D1Database): Promise<{
  jobs: Array<{ status: string; count: number }>;
  active_jobs: Array<{ id: string; research_slot: number | null; elapsed_synthesis_seconds: number }>;
  timing: {
    average_synthesis_seconds: number | null;
    synthesis_samples: number;
    average_prediction_delay_seconds: number | null;
    prediction_delay_samples: number;
    estimated_queue_seconds: number | null;
    parallel_capacity: number;
  };
}> {
  const [row, activeJobs] = await Promise.all([db.prepare(
    "SELECT SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed, AVG(CASE WHEN status = 'succeeded' THEN synthesis_duration_seconds END) AS average_synthesis_seconds, SUM(CASE WHEN status = 'succeeded' AND synthesis_duration_seconds IS NOT NULL THEN 1 ELSE 0 END) AS synthesis_samples, AVG(CASE WHEN status = 'succeeded' AND prediction_delay_eligible = 1 THEN prediction_delay_seconds END) AS average_prediction_delay_seconds, SUM(CASE WHEN status = 'succeeded' AND prediction_delay_eligible = 1 AND prediction_delay_seconds IS NOT NULL THEN 1 ELSE 0 END) AS prediction_delay_samples FROM research_jobs",
  ).first<{
    pending: number | null;
    running: number | null;
    failed: number | null;
    average_synthesis_seconds: number | null;
    synthesis_samples: number | null;
    average_prediction_delay_seconds: number | null;
    prediction_delay_samples: number | null;
  }>(), db.prepare(
    "SELECT id, research_slot, MAX(0, unixepoch(CURRENT_TIMESTAMP) - unixepoch(started_at)) AS elapsed_synthesis_seconds FROM research_jobs WHERE status = 'running' ORDER BY research_slot ASC",
  ).all<{ id: string; research_slot: number | null; elapsed_synthesis_seconds: number }>()]);
  const pending = Number(row?.pending || 0);
  const running = Number(row?.running || 0);
  const failed = Number(row?.failed || 0);
  const averageSynthesisSeconds = row?.average_synthesis_seconds === null || row?.average_synthesis_seconds === undefined
    ? null
    : Number(row.average_synthesis_seconds);
  return {
    jobs: [
      { status: "pending", count: pending },
      { status: "running", count: running },
      { status: "failed", count: failed },
    ],
    active_jobs: activeJobs.results || [],
    timing: {
      average_synthesis_seconds: averageSynthesisSeconds,
      synthesis_samples: Number(row?.synthesis_samples || 0),
      average_prediction_delay_seconds: row?.average_prediction_delay_seconds === null || row?.average_prediction_delay_seconds === undefined
        ? null
        : Number(row.average_prediction_delay_seconds),
      prediction_delay_samples: Number(row?.prediction_delay_samples || 0),
      estimated_queue_seconds: averageSynthesisSeconds === null
        ? null
        : Math.ceil(((pending + running) * averageSynthesisSeconds) / RESEARCH_CONTAINER_COUNT),
      parallel_capacity: RESEARCH_CONTAINER_COUNT,
    },
  };
}

function predictionFiltersFromUrl(url: URL): PredictionOutcomeFilters {
  const directionValue = url.searchParams.get("direction");
  const direction = directionValue === "bullish" || directionValue === "bearish" ? directionValue : null;
  const parseConfidence = (name: string) => {
    const value = url.searchParams.get(name);
    if (value === null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
  };
  const confidenceMin = parseConfidence("confidence_min");
  const confidenceMax = parseConfidence("confidence_max");
  return {
    direction,
    confidenceMin,
    confidenceMax: confidenceMin !== null && confidenceMax !== null && confidenceMax <= confidenceMin ? null : confidenceMax,
    cursor: url.searchParams.get("cursor"),
  };
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const unauthorized = requireAuthorized(request, env);
  if (unauthorized) return unauthorized;
  await ensureArticleStorageSchema(env.NEWS_DB);

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 25);

  if (url.pathname === "/api/status") {
    await archiveTickerlessArticles(env);
    const [articles, jobs, results, content, operations] = await Promise.all([
      env.NEWS_DB.prepare("SELECT status, COUNT(*) AS count FROM articles WHERE status != 'archived' GROUP BY status").all(),
      env.NEWS_DB.prepare("SELECT research_jobs.status, COUNT(*) AS count FROM research_jobs INNER JOIN articles ON articles.id = research_jobs.article_id WHERE articles.status != 'archived' AND (research_jobs.status != 'succeeded' OR EXISTS (SELECT 1 FROM research_results WHERE research_results.job_id = research_jobs.id AND research_results.symbols IS NOT NULL AND trim(research_results.symbols) NOT IN ('', '[]'))) GROUP BY research_jobs.status").all(),
      env.NEWS_DB.prepare("SELECT COUNT(*) AS count FROM research_results INNER JOIN articles ON articles.id = research_results.article_id WHERE articles.status != 'archived' AND research_results.symbols IS NOT NULL AND trim(research_results.symbols) NOT IN ('', '[]')").first(),
      env.NEWS_DB.prepare("SELECT content_status AS status, COUNT(*) AS count FROM articles GROUP BY content_status").all(),
      researchOperationsTelemetry(env.NEWS_DB),
    ]);
    return json({ ok: true, articles: articles.results, jobs: jobs.results, results, content: content.results, timing: operations.timing });
  }

  if (url.pathname === "/api/status/live") {
    const operations = await researchOperationsTelemetry(env.NEWS_DB);
    return json({ ok: true, ...operations });
  }

  if (url.pathname === "/api/sources") {
    await seedSources(env.NEWS_DB);
    return json({ ok: true, sources: await listRows(env.NEWS_DB, "SELECT * FROM sources ORDER BY weight DESC, name ASC LIMIT ?", Math.max(limit, SOURCES.length)) });
  }

  if (url.pathname === "/api/articles/content") {
    const articleId = url.searchParams.get("id");
    if (!articleId) return json({ error: "Missing article id" }, { status: 400 });
    const article = await env.NEWS_DB.prepare(
      "SELECT articles.id, articles.title, articles.url, articles.published_at, articles.discovered_at, articles.content_plaintext, articles.content_source, articles.content_status, articles.content_fetched_at, articles.content_fetch_attempts, articles.content_error, sources.name AS source_name, sources.source_type FROM articles LEFT JOIN sources ON sources.id = articles.source_id WHERE articles.id = ?",
    )
      .bind(articleId)
      .first();
    return article ? json({ ok: true, article }) : json({ error: "Article not found" }, { status: 404 });
  }

  if (url.pathname === "/api/articles/backfill" && request.method === "POST") {
    return json({ ok: true, ...(await backfillArticleContents(env, limit)) });
  }

  if (url.pathname === "/api/articles/purge-stale-backfill" && request.method === "POST") {
    return json({ ok: true, ...(await purgeStaleHistoricalBackfill(env)) });
  }

  if (url.pathname === "/api/articles") {
    return json({
      ok: true,
      articles: await listRows(
        env.NEWS_DB,
        "SELECT articles.id, articles.source_id, articles.title, articles.url, articles.summary, articles.published_at, articles.discovered_at, articles.status, articles.content_status, articles.content_source, articles.content_fetched_at, articles.content_fetch_attempts, articles.content_error, length(articles.content_plaintext) AS content_length, sources.name AS source_name, sources.source_type FROM articles LEFT JOIN sources ON sources.id = articles.source_id WHERE articles.status != 'archived' AND (articles.status != 'analyzed' OR EXISTS (SELECT 1 FROM research_results WHERE research_results.article_id = articles.id AND research_results.symbols IS NOT NULL AND trim(research_results.symbols) NOT IN ('', '[]'))) ORDER BY discovered_at DESC LIMIT ?",
        limit,
      ),
    });
  }

  if (url.pathname === "/api/jobs") {
    return json({
      ok: true,
      jobs: await listRows(
        env.NEWS_DB,
        "SELECT research_jobs.*, articles.title, articles.url, articles.published_at, CASE WHEN research_jobs.status = 'running' AND research_jobs.started_at IS NOT NULL THEN MAX(0, unixepoch(CURRENT_TIMESTAMP) - unixepoch(research_jobs.started_at)) ELSE research_jobs.synthesis_duration_seconds END AS elapsed_synthesis_seconds FROM research_jobs INNER JOIN articles ON articles.id = research_jobs.article_id WHERE articles.status != 'archived' AND (research_jobs.status != 'succeeded' OR EXISTS (SELECT 1 FROM research_results WHERE research_results.job_id = research_jobs.id AND research_results.symbols IS NOT NULL AND trim(research_results.symbols) NOT IN ('', '[]'))) ORDER BY CASE WHEN research_jobs.status = 'running' THEN 0 ELSE 1 END, queued_at DESC LIMIT ?",
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

  if (url.pathname === "/api/predictions") {
    return json({ ok: true, ...(await buildPredictionOutcomes(env, limit, predictionFiltersFromUrl(url))) });
  }

  if (url.pathname === "/api/predictions/outcomes") {
    return json({ ok: true, ...(await buildPredictionPage(env, limit, predictionFiltersFromUrl(url))) });
  }

  if (url.pathname === "/api/predictions/process" && request.method === "POST") {
    return json({ ok: true, ...(await processPredictionOutcomes(env, limit)) });
  }

  if (url.pathname.startsWith("/api/simulation")) {
    return json({ error: "Paper trading simulation has been decommissioned. Use /api/predictions for prediction outcome measurement." }, { status: 410 });
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

  if (url.pathname === "/api/research/recover" && request.method === "POST") {
    const normalized = await normalizeResearchJobConcurrency(env, url.searchParams.get("force") === "1");
    const pruned = await pruneLegacyFirstPassBacklog(env.NEWS_DB);
    const requeued = await requeuePendingJobs(env, limit);
    return json({ ok: true, ...normalized, ...pruned, ...requeued });
  }

  if (url.pathname === "/api/research/reset-first-pass-queue" && request.method === "POST") {
    return json({ ok: true, ...(await resetPendingFirstPassQueue(env.NEWS_DB)) });
  }

  if (url.pathname === "/api/reanalyze-recent" && request.method === "POST") {
    return json({ ok: true, ...(await reanalyzeRecentJobs(env, limit)) });
  }

  if (url.pathname === "/api/reanalyze-legacy" && request.method === "POST") {
    return json({ ok: true, ...(await reanalyzeLegacyJobs(env, limit)) });
  }

  return json({ error: "Not found" }, { status: 404 });
}

async function handleContainer(request: Request, env: Env): Promise<Response> {
  const unauthorized = requireAuthorized(request, env);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/container/, "") || "/health";
  if (path === "/research-internal") return json({ error: "Not found" }, { status: 404 });
  const container = getContainer(env.CODEX_CONTAINER, "instance-0");

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
          "/api/status/live",
          "/api/ingest",
          "/api/articles",
          "/api/articles/content?id=ARTICLE_ID",
          "/api/articles/backfill",
          "/api/articles/purge-stale-backfill",
          "/api/jobs",
          "/api/results",
          "/api/ticker-signals",
          "/api/predictions",
          "/api/predictions/outcomes",
          "/api/predictions/process",
          "/api/research/recover",
          "/api/research/reset-first-pass-queue",
          "/api/reanalyze-recent",
          "/api/reanalyze-legacy",
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
        await normalizeResearchJobConcurrency(env);
        await pruneLegacyFirstPassBacklog(env.NEWS_DB);
        await archiveTickerlessArticles(env);
        await requeuePendingJobs(env, 25);
        await Promise.all([
          ...Array.from({ length: RESEARCH_CONTAINER_COUNT }, () =>
            drainResearchBacklog(env).catch((error) => console.error("Scheduled research backlog drain failed", error)),
          ),
          backfillArticleContents(env, 20).catch((error) => console.error("Scheduled article content backfill failed", error)),
          processPredictionOutcomes(env, 50).catch((error) => console.error("Scheduled prediction outcome processing failed", error)),
        ]);
      }),
    );
  },

  async queue(batch: MessageBatch<ResearchJobMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processJob(env, message.body.jobId);
        message.ack();
        await drainResearchBacklog(env);
      } catch (error) {
        if (error instanceof ResearchBusyError) {
          message.retry({ delaySeconds: 5 });
          continue;
        }
        throw error;
      }
    }
  },
};
