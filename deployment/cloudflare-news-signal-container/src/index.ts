import { Container, getContainer } from "@cloudflare/containers";
import { DurableObject } from "cloudflare:workers";

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

type FeedFetchResult = {
  source: string;
  count: number;
  error?: string;
  items: FeedItem[];
};

type FeedLedgerRow = {
  id: string;
  source_id: string;
  url: string;
  title: string;
  summary: string | null;
  content_plaintext: string | null;
  published_at: string | null;
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

type ArticleCorpusRow = Article & {
  source_category: string | null;
  research_job_id: string | null;
  research_job_finished_at: string | null;
  research_result_id: string | null;
  research_result_created_at: string | null;
  event_type: string | null;
  companies: string | null;
  industries: string | null;
  symbols: string | null;
  sentiment_score: number | null;
  impact_horizon: string | null;
  confidence: number | null;
  analysis_summary: string | null;
  memo: string | null;
};

type ArticleCorpusIndexRow = {
  article_id: string;
  object_key: string | null;
  content_sha256: string | null;
  content_chars: number;
  object_bytes: number;
  storage_status: string;
  storage_attempts: number;
  schema_version: number;
  extraction_version: string;
  stored_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  updated_at: string;
};

type ResearchJobMessage =
  | { kind?: "production"; jobId: string }
  | { kind: "model_experiment"; jobId: string };

type ModelExperimentCall = {
  symbol: string;
  direction: "bullish" | "bearish";
  confidence: number | null;
  reason: string | null;
};

type ModelExperimentRow = {
  id: string;
  status: string;
  sample_size: number;
  phase: number;
  phase_1_model: string;
  phase_1_effort: string;
  phase_2_model: string;
  phase_2_effort: string;
  email_to: string | null;
  report_json: string | null;
  report_text: string | null;
  email_status: string | null;
  email_error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

type ModelExperimentJobRow = {
  id: string;
  experiment_id: string;
  article_id: string;
  sample_ordinal: number;
  phase: number;
  model: string;
  reasoning_effort: string;
  status: string;
  attempts: number;
  research_slot: number | null;
};

type DashboardEvent = {
  type: "connected" | "source_check_completed" | "research_started" | "research_completed" | "research_deferred" | "research_failed";
  at: string;
  job_id?: string;
  article_id?: string;
  acquired_count?: number;
  source_count?: number;
  failed_source_count?: number;
};

type SourceCheckRow = {
  id: string;
  checked_at: string;
  completed_at?: string | null;
  duration_seconds?: number | null;
  acquired_count: number;
  source_count: number;
  failed_source_count: number;
};

type SourceHourlyMetricRow = {
  hour_start: string;
  article_count: number;
  ticker_count: number;
};

type SourceActivityMode = "day" | "month" | "year";

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

type PredictionOutcomeSort = "newest" | "oldest" | "current_desc" | "current_asc" | "peak_desc" | "peak_asc";

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
  days_since_call?: number;
  current_price?: number | null;
  current_price_at?: string | null;
  current_movement_pct?: number | null;
  peak_movement_pct?: number | null;
  updated_at: string;
};

type StoredPredictionOutcomeRow = Omit<PredictionOutcome, "title" | "url" | "intervals"> & {
  article_title: string | null;
  article_url: string | null;
  intervals_json: string;
};

type PredictionOutcomeFilters = {
  direction: "bullish" | "bearish" | null;
  confidenceMin: number | null;
  confidenceMax: number | null;
  sort: PredictionOutcomeSort;
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
  constructor(message = "This research job is already running") {
    super(message);
  }
}

class CodexAuthRefreshError extends Error {}

function isCodexAuthRefreshFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /access token could not be refreshed|refresh token was already used|please log out and sign in again/i.test(message);
}

function isTransientContainerCapacityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /maximum number of running container instances exceeded|there is no container instance that can be provided|no container instance.*provided/i.test(
    message,
  );
}

export interface Env {
  CODEX_CONTAINER: DurableObjectNamespace<CodexResearchContainer>;
  DASHBOARD_EVENTS: DurableObjectNamespace<DashboardEventHub>;
  NEWS_DB: D1Database;
  ARTICLE_CORPUS: R2Bucket;
  RESEARCH_QUEUE: Queue<ResearchJobMessage>;
  CONTAINER_API_TOKEN?: string;
  OPENAI_API_KEY?: string;
  CODEX_ACCESS_TOKEN?: string;
  CODEX_AUTH_JSON?: string;
  CODEX_AUTH_STATE_KEY?: string;
  CODEX_RESEARCH_MODEL?: string;
  CODEX_RESEARCH_REASONING_EFFORT?: string;
  EXPERIMENT_EMAIL?: SendEmail;
  EXPERIMENT_REPORT_EMAIL_FROM?: string;
  EXPERIMENT_REPORT_EMAIL_TO?: string;
  RESEND_API_KEY?: string;
  SNAPSHOT_UPLOAD_TOKEN?: string;
  OFFSITE_BACKUP_TOKEN?: string;
  SELF_HOSTED_API_ORIGIN?: string;
  SELF_HOSTED_API?: Fetcher;
  SELF_HOSTED_PROXY_ENABLED?: string;
  SELF_HOSTED_API_TOKEN?: string;
  TUNNEL_ACCESS_CLIENT_ID?: string;
  TUNNEL_ACCESS_CLIENT_SECRET?: string;
  PROCESSING_AUTHORITY?: string;
}

function cloudflareHasProcessingAuthority(env: Env): boolean {
  return String(env.PROCESSING_AUTHORITY || "cloudflare").trim().toLowerCase() === "cloudflare";
}

type DashboardSnapshotEntry = {
  request_path: string;
  status: number;
  body: unknown;
};

type DashboardSnapshot = {
  version: number;
  generated_at: string;
  response_count: number;
  content_sha256: string;
  responses: Record<string, DashboardSnapshotEntry>;
};

const DASHBOARD_SNAPSHOT_OBJECT_KEY = "_system/dashboard/latest-v1.json";
const DASHBOARD_SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024;
const DASHBOARD_SNAPSHOT_KEYS = [
  "status",
  "status_live",
  "results",
  "jobs",
  "failed_jobs",
  "model_experiments",
  "prediction_outcomes",
  "prediction_summary",
  "prediction_daily",
  "ticker_pipeline",
  "source_activity",
  "source_stats",
] as const;
const DASHBOARD_SNAPSHOT_ROUTE_KEYS: Record<string, typeof DASHBOARD_SNAPSHOT_KEYS[number]> = {
  "/api/status": "status",
  "/api/status/live": "status_live",
  "/api/results": "results",
  "/api/jobs": "jobs",
  "/api/jobs/failures": "failed_jobs",
  "/api/model-experiments": "model_experiments",
  "/api/predictions/outcomes": "prediction_outcomes",
  "/api/predictions": "prediction_outcomes",
  "/api/predictions/summary": "prediction_summary",
  "/api/predictions/daily": "prediction_daily",
  "/api/diagnostics/ticker-pipeline": "ticker_pipeline",
  "/api/source-activity": "source_activity",
  "/api/source-stats": "source_stats",
};

let dashboardSnapshotCache: { loadedAt: number; snapshot: DashboardSnapshot } | null = null;

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
const ARTICLE_CORPUS_MAX_CHARS = 3_000_000;
const ARTICLE_CORPUS_SCHEMA_VERSION = 1;
const ARTICLE_EXTRACTION_VERSION = "2026-08-01.1";
const ARTICLE_CORPUS_BACKFILL_BATCH = 50;
const ARTICLE_CORPUS_MAX_ATTEMPTS = 5;
const ARTICLE_FETCH_TIMEOUT_MS = 15_000;
const SOURCE_CHECK_INTERVAL_MINUTES = 5;
const SOURCE_CHECK_INTERVAL_MS = SOURCE_CHECK_INTERVAL_MINUTES * 60 * 1000;
const LEGACY_STALE_BACKFILL_THRESHOLD_MINUTES = 5;
const SOURCE_EXPANSION_CUTOFF = "2026-07-18T08:28:55Z";
const BRISBANE_OFFSET_MS = 10 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const RESEARCH_CONTAINER_COUNT = 8;
const QUEUE_DRAIN_MAX_JOBS = 8;
const QUEUE_DRAIN_MAX_MS = 4 * 60 * 1000;
const MODEL_EXPERIMENT_SAMPLE_SIZE = 1000;
const MODEL_EXPERIMENT_MAX_ATTEMPTS = 3;
const MODEL_EXPERIMENT_MAX_CONCURRENCY = 4;
const MODEL_EXPERIMENT_INTERVALS = ["12h", "24h", "48h", "1w"] as const;
const MODEL_EXPERIMENT_PHASES = [
  { phase: 1, model: "gpt-5.6-luna", reasoningEffort: "medium" },
  { phase: 2, model: "gpt-5.6-terra", reasoningEffort: "low" },
] as const;
let articleStorageSchemaReady: Promise<void> | null = null;
let modelExperimentSchemaReady: Promise<void> | null = null;

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

async function archiveFailedResearchJobs(db: D1Database): Promise<number> {
  const result = await db.prepare(
    "UPDATE articles SET status = 'archived' WHERE status != 'archived' AND EXISTS (SELECT 1 FROM research_jobs WHERE research_jobs.article_id = articles.id AND research_jobs.status = 'failed')",
  ).run();
  return Number(result.meta?.changes || 0);
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
    AND datetime(articles.published_at) < datetime(articles.discovered_at, '-${LEGACY_STALE_BACKFILL_THRESHOLD_MINUTES} minutes')
    AND NOT EXISTS (
      SELECT 1
      FROM feed_item_ledger
      INNER JOIN feed_source_state ON feed_source_state.source_id = feed_item_ledger.source_id
      WHERE feed_item_ledger.article_id = articles.id
        AND feed_item_ledger.disposition IN ('acquired', 'duplicate')
        AND (feed_item_ledger.published_at IS NULL
          OR datetime(feed_item_ledger.published_at) >= datetime(feed_source_state.initialized_at))
    )
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
  const reclassified = await db.prepare(
    "UPDATE feed_item_ledger SET disposition = 'stale', acquired_at = NULL, last_error = 'Published before source-ledger activation' WHERE disposition = 'acquired' AND published_at IS NOT NULL AND EXISTS (SELECT 1 FROM feed_source_state WHERE feed_source_state.source_id = feed_item_ledger.source_id AND datetime(feed_item_ledger.published_at) < datetime(feed_source_state.initialized_at))",
  ).run();
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
    reclassified_ledger_items: Number(reclassified.meta?.changes || 0),
    preserved_before: SOURCE_EXPANSION_CUTOFF,
    legacy_stale_threshold_minutes: LEGACY_STALE_BACKFILL_THRESHOLD_MINUTES,
  };
}

async function archiveArticleAndRemoveDerivedData(
  env: Env,
  articleId: string,
  reason: string,
): Promise<Record<string, number | string> | null> {
  await ensurePredictionOutcomeTables(env);
  const db = env.NEWS_DB;
  const article = await db.prepare("SELECT id, title FROM articles WHERE id = ?").bind(articleId).first<{ id: string; title: string }>();
  if (!article) return null;

  const [results, outcomes, dailyPoints] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM research_results WHERE article_id = ?").bind(articleId).first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM prediction_outcomes WHERE article_id = ?").bind(articleId).first<{ count: number }>(),
    db.prepare(
      "SELECT COUNT(*) AS count FROM prediction_daily_points_v2 WHERE outcome_id IN (SELECT id FROM prediction_outcomes WHERE article_id = ?)",
    ).bind(articleId).first<{ count: number }>(),
  ]);

  await db.batch([
    db.prepare(
      "DELETE FROM prediction_daily_points_v2 WHERE outcome_id IN (SELECT id FROM prediction_outcomes WHERE article_id = ?)",
    ).bind(articleId),
    db.prepare(
      "DELETE FROM prediction_outcome_scans WHERE result_id IN (SELECT id FROM research_results WHERE article_id = ?)",
    ).bind(articleId),
    db.prepare("DELETE FROM simulation_trades WHERE article_id = ?").bind(articleId),
    db.prepare("DELETE FROM simulation_processed_results WHERE article_id = ?").bind(articleId),
    db.prepare("DELETE FROM prediction_outcomes WHERE article_id = ?").bind(articleId),
    db.prepare("DELETE FROM price_impacts WHERE article_id = ?").bind(articleId),
    db.prepare(
      "UPDATE research_jobs SET status = 'cancelled', last_error = ?, finished_at = CURRENT_TIMESTAMP, synthesis_duration_seconds = NULL, prediction_delay_seconds = NULL, prediction_delay_eligible = 0, research_slot = NULL WHERE article_id = ?",
    ).bind(reason.slice(0, 500), articleId),
    db.prepare("DELETE FROM research_results WHERE article_id = ?").bind(articleId),
    db.prepare("UPDATE articles SET status = 'archived' WHERE id = ?").bind(articleId),
  ]);

  return {
    article_id: article.id,
    title: article.title,
    deleted_results: Number(results?.count || 0),
    deleted_outcomes: Number(outcomes?.count || 0),
    deleted_daily_points: Number(dailyPoints?.count || 0),
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
        "CREATE TABLE IF NOT EXISTS article_corpus_objects (article_id TEXT PRIMARY KEY, object_key TEXT, content_sha256 TEXT, content_chars INTEGER NOT NULL DEFAULT 0, object_bytes INTEGER NOT NULL DEFAULT 0, storage_status TEXT NOT NULL DEFAULT 'pending', storage_attempts INTEGER NOT NULL DEFAULT 0, schema_version INTEGER NOT NULL DEFAULT 1, extraction_version TEXT NOT NULL DEFAULT 'unknown', stored_at TEXT, last_attempt_at TEXT, last_error TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(article_id) REFERENCES articles(id))",
      ).run();
      await db.prepare(
        "CREATE INDEX IF NOT EXISTS idx_article_corpus_objects_status ON article_corpus_objects(storage_status, storage_attempts, updated_at)",
      ).run();
      await db.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_research_jobs_running_slot ON research_jobs(research_slot) WHERE status = 'running' AND research_slot IS NOT NULL",
      ).run();
      await db.prepare(
        "CREATE INDEX IF NOT EXISTS idx_research_jobs_prediction_delay_cohort ON research_jobs(prediction_delay_eligible, status, finished_at)",
      ).run();
      await db.prepare(
        "CREATE TABLE IF NOT EXISTS source_checks (id TEXT PRIMARY KEY, checked_at TEXT NOT NULL, acquired_count INTEGER NOT NULL DEFAULT 0, source_count INTEGER NOT NULL DEFAULT 0, failed_source_count INTEGER NOT NULL DEFAULT 0)",
      ).run();
      await addColumnIfMissing(db, "source_checks", "completed_at", "TEXT");
      await addColumnIfMissing(db, "source_checks", "duration_seconds", "INTEGER");
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_source_checks_checked_at ON source_checks(checked_at DESC)").run();
      await db.prepare(
        "CREATE TABLE IF NOT EXISTS source_hourly_metrics (hour_start TEXT PRIMARY KEY, article_count INTEGER NOT NULL DEFAULT 0, ticker_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
      ).run();
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_source_hourly_metrics_hour ON source_hourly_metrics(hour_start)").run();
      await db.prepare(
        "CREATE TABLE IF NOT EXISTS source_metric_state (key TEXT PRIMARY KEY, completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
      ).run();
      await db.prepare(
        "CREATE TABLE IF NOT EXISTS feed_ingestion_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
      ).run();
      await db.prepare(
        "INSERT OR IGNORE INTO feed_ingestion_meta (key, value) VALUES ('ledger_cutover_at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
      ).run();
      await db.prepare(
        "CREATE TABLE IF NOT EXISTS feed_source_state (source_id TEXT PRIMARY KEY, initialized_at TEXT NOT NULL, last_checked_at TEXT NOT NULL, last_success_at TEXT, last_item_count INTEGER NOT NULL DEFAULT 0, last_feed_hash TEXT, last_error TEXT)",
      ).run();
      await addColumnIfMissing(db, "feed_source_state", "last_feed_hash", "TEXT");
      await db.prepare(
        "CREATE TABLE IF NOT EXISTS feed_item_ledger (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, url TEXT NOT NULL, article_id TEXT, title TEXT NOT NULL, summary TEXT, content_plaintext TEXT, published_at TEXT, first_seen_at TEXT NOT NULL, first_check_id TEXT NOT NULL, disposition TEXT NOT NULL, acquired_at TEXT, last_error TEXT, UNIQUE(source_id, url))",
      ).run();
      await db.prepare(
        "CREATE INDEX IF NOT EXISTS idx_feed_item_ledger_disposition ON feed_item_ledger(disposition, first_seen_at)",
      ).run();
      await db.prepare(
        "CREATE INDEX IF NOT EXISTS idx_feed_item_ledger_source ON feed_item_ledger(source_id, first_seen_at)",
      ).run();
      await db.prepare(
        "CREATE TABLE IF NOT EXISTS source_check_details (check_id TEXT NOT NULL, source_id TEXT NOT NULL, fetched_item_count INTEGER NOT NULL DEFAULT 0, new_item_count INTEGER NOT NULL DEFAULT 0, acquired_count INTEGER NOT NULL DEFAULT 0, duplicate_count INTEGER NOT NULL DEFAULT 0, baseline_count INTEGER NOT NULL DEFAULT 0, stale_count INTEGER NOT NULL DEFAULT 0, pending_count INTEGER NOT NULL DEFAULT 0, error TEXT, PRIMARY KEY(check_id, source_id))",
      ).run();
      await addColumnIfMissing(db, "source_check_details", "stale_count", "INTEGER NOT NULL DEFAULT 0");
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_source_check_details_source ON source_check_details(source_id, check_id)").run();
    })().catch((error) => {
      articleStorageSchemaReady = null;
      throw error;
    });
  }
  await articleStorageSchemaReady;
}

async function ensureModelExperimentSchema(db: D1Database): Promise<void> {
  if (!modelExperimentSchemaReady) {
    modelExperimentSchemaReady = db.batch([
      db.prepare(
        "CREATE TABLE IF NOT EXISTS model_experiments (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'preparing', sample_size INTEGER NOT NULL, phase INTEGER NOT NULL DEFAULT 1, phase_1_model TEXT NOT NULL, phase_1_effort TEXT NOT NULL, phase_2_model TEXT NOT NULL, phase_2_effort TEXT NOT NULL, email_to TEXT, report_json TEXT, report_text TEXT, email_status TEXT, email_error TEXT, started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
      ),
      db.prepare(
        "CREATE TABLE IF NOT EXISTS model_experiment_samples (experiment_id TEXT NOT NULL, article_id TEXT NOT NULL, sample_ordinal INTEGER NOT NULL, input_hash TEXT NOT NULL, reference_result_id TEXT, reference_calls_json TEXT NOT NULL DEFAULT '[]', PRIMARY KEY (experiment_id, article_id), UNIQUE (experiment_id, sample_ordinal))",
      ),
      db.prepare(
        "CREATE TABLE IF NOT EXISTS model_experiment_jobs (id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL, article_id TEXT NOT NULL, sample_ordinal INTEGER NOT NULL, phase INTEGER NOT NULL, model TEXT NOT NULL, reasoning_effort TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, research_slot INTEGER, queued_at TEXT, started_at TEXT, finished_at TEXT, duration_seconds INTEGER, last_error TEXT, memo TEXT, fields_json TEXT, calls_json TEXT NOT NULL DEFAULT '[]', input_hash TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (experiment_id, article_id, phase))",
      ),
      db.prepare(
        "CREATE INDEX IF NOT EXISTS idx_model_experiment_jobs_dispatch ON model_experiment_jobs(experiment_id, phase, status, sample_ordinal)",
      ),
      db.prepare(
        "CREATE INDEX IF NOT EXISTS idx_model_experiment_jobs_slot ON model_experiment_jobs(research_slot, status)",
      ),
      db.prepare(
        "CREATE TABLE IF NOT EXISTS model_experiment_prices (experiment_id TEXT NOT NULL, article_id TEXT NOT NULL, symbol TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', baseline_price REAL, baseline_at TEXT, intervals_json TEXT NOT NULL DEFAULT '{}', last_error TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (experiment_id, article_id, symbol))",
      ),
      db.prepare(
        "CREATE INDEX IF NOT EXISTS idx_model_experiment_prices_status ON model_experiment_prices(experiment_id, status)",
      ),
    ]).then(() => undefined).catch((error) => {
      modelExperimentSchemaReady = null;
      throw error;
    });
  }
  await modelExperimentSchemaReady;
}

function floorUtcHourIso(value: number | string | Date): string {
  const timestamp = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  return new Date(Math.floor(timestamp / HOUR_MS) * HOUR_MS).toISOString();
}

async function refreshSourceHourlyMetric(db: D1Database, hourStart: string): Promise<void> {
  const normalizedHour = floorUtcHourIso(hourStart);
  await db.prepare(
    `INSERT OR REPLACE INTO source_hourly_metrics (hour_start, article_count, ticker_count, updated_at)
     SELECT ?, COUNT(*), COALESCE(SUM(COALESCE((
       SELECT CASE WHEN json_valid(research_results.symbols) THEN json_array_length(research_results.symbols) ELSE 0 END
       FROM research_results
       WHERE research_results.article_id = articles.id
       ORDER BY datetime(research_results.created_at) DESC
       LIMIT 1
     ), 0)), 0), CURRENT_TIMESTAMP
     FROM articles
     WHERE datetime(articles.discovered_at) >= datetime(?)
       AND datetime(articles.discovered_at) < datetime(?, '+1 hour')
       AND datetime(articles.discovered_at) >= datetime(?)`,
  )
    .bind(normalizedHour, normalizedHour, normalizedHour, SOURCE_EXPANSION_CUTOFF)
    .run();
}

async function refreshAllSourceHourlyMetrics(db: D1Database): Promise<void> {
  await db.prepare(
    `INSERT OR REPLACE INTO source_hourly_metrics (hour_start, article_count, ticker_count, updated_at)
     SELECT strftime('%Y-%m-%dT%H:00:00.000Z', articles.discovered_at), COUNT(*), COALESCE(SUM(COALESCE((
       SELECT CASE WHEN json_valid(research_results.symbols) THEN json_array_length(research_results.symbols) ELSE 0 END
       FROM research_results
       WHERE research_results.article_id = articles.id
       ORDER BY datetime(research_results.created_at) DESC
       LIMIT 1
     ), 0)), 0), CURRENT_TIMESTAMP
     FROM articles
     WHERE articles.discovered_at IS NOT NULL
       AND datetime(articles.discovered_at) >= datetime(?)
     GROUP BY strftime('%Y-%m-%dT%H:00:00.000Z', articles.discovered_at)`,
  )
    .bind(SOURCE_EXPANSION_CUTOFF)
    .run();
}

async function ensureSourceHourlyMetricsBackfilled(db: D1Database): Promise<void> {
  const state = await db.prepare("SELECT key FROM source_metric_state WHERE key = 'hourly_backfill_v1'").first<{ key: string }>();
  if (state) return;
  await refreshAllSourceHourlyMetrics(db);
  await db.prepare("INSERT OR REPLACE INTO source_metric_state (key, completed_at) VALUES ('hourly_backfill_v1', CURRENT_TIMESTAMP)").run();
}

async function refreshSourceHourlyMetricForArticle(db: D1Database, articleId: string): Promise<void> {
  const article = await db.prepare("SELECT discovered_at FROM articles WHERE id = ?").bind(articleId).first<{ discovered_at: string }>();
  if (article?.discovered_at) await refreshSourceHourlyMetric(db, article.discovered_at);
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>News Signal Dashboard</title>
  <script>
    (() => {
      try {
        const savedTheme = localStorage.getItem("newsSignalTheme");
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        document.documentElement.dataset.theme = savedTheme || (prefersDark ? "dark" : "light");
      } catch (_) {
        document.documentElement.dataset.theme = "light";
      }
    })();
  </script>
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
      --primary: #123c69;
      --primary-text: #ffffff;
      --text-secondary: #344054;
      --surface-hover: #f8fbff;
      --surface-raised: #ffffff;
      --surface-alt: #fbfcfe;
      --surface-input: #ffffff;
      --pill-neutral-bg: #eef2f6;
      --green-bg: #e6f4ee;
      --red-bg: #fdecec;
      --amber-bg: #fff2d6;
      --blue-bg: #e8f1ff;
      --skeleton: #dfe4ea;
      --sticky-header: #e9edf3;
      --chart-bg: #fbfcfe;
      --chart-grid: #e4e9f0;
      --chart-grid-subtle: #eef1f5;
      --chart-zero: #475467;
      --chart-sample: #8aaec7;
      --chart-sample-text: #7893a8;
      --chart-band: #f7f9fc;
      --chart-separator: #c7d0dc;
      --heatmap-empty-bg: #f3f4f6;
      --heatmap-empty-text: #98a2b3;
      --shadow: 0 1px 2px rgba(16, 24, 40, 0.06);
    }

    :root[data-theme="dark"] {
      color-scheme: dark;
      --bg: #0f1216;
      --panel: #171b21;
      --panel-soft: #20262e;
      --text: #edf2f7;
      --muted: #a4afbd;
      --line: #343d49;
      --green: #4fd1a1;
      --red: #ff7a70;
      --amber: #f7bd67;
      --blue: #78b7ff;
      --primary: #2f6da8;
      --primary-text: #ffffff;
      --text-secondary: #c9d2dc;
      --surface-hover: #222b35;
      --surface-raised: #1c222a;
      --surface-alt: #1b2027;
      --surface-input: #14181e;
      --pill-neutral-bg: #29313b;
      --green-bg: #153a31;
      --red-bg: #452526;
      --amber-bg: #46351d;
      --blue-bg: #1c3551;
      --skeleton: #333c47;
      --sticky-header: #252c35;
      --chart-bg: #171b21;
      --chart-grid: #3d4652;
      --chart-grid-subtle: #2b333d;
      --chart-zero: #b0bac7;
      --chart-sample: #80a9c8;
      --chart-sample-text: #94b5cc;
      --chart-band: #1a2027;
      --chart-separator: #4a5664;
      --heatmap-empty-bg: #252b33;
      --heatmap-empty-text: #8e99a7;
      --shadow: 0 1px 2px rgba(0, 0, 0, 0.32);
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

    .theme-control {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
      cursor: pointer;
    }

    .theme-control input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    }

    .theme-switch {
      position: relative;
      width: 38px;
      height: 22px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--pill-neutral-bg);
      transition: background 140ms ease, border-color 140ms ease;
    }

    .theme-switch::after {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--muted);
      content: "";
      transition: transform 140ms ease, background 140ms ease;
    }

    .theme-control input:checked + .theme-switch {
      border-color: var(--primary);
      background: var(--primary);
    }

    .theme-control input:checked + .theme-switch::after {
      background: var(--primary-text);
      transform: translateX(16px);
    }

    .theme-control input:focus-visible + .theme-switch {
      outline: 2px solid var(--blue);
      outline-offset: 2px;
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
      border-color: var(--primary);
      background: var(--primary);
      color: var(--primary-text);
    }

    .btn:disabled { opacity: 0.55; cursor: not-allowed; }

    .snapshot-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 14px 0 0;
      padding: 10px 12px;
      border: 1px solid var(--amber);
      border-radius: 6px;
      background: var(--amber-bg);
      color: var(--text);
      font-size: 13px;
      line-height: 1.4;
    }

    .snapshot-banner[hidden] { display: none; }
    .snapshot-banner strong { color: var(--amber); white-space: nowrap; }

    body.snapshot-mode [data-heatmap-direction],
    body.snapshot-mode [data-outcome-direction],
    body.snapshot-mode [data-reset-prediction-filters],
    body.snapshot-mode .source-view-button,
    body.snapshot-mode #source-period-previous,
    body.snapshot-mode #source-period-next,
    body.snapshot-mode #prediction-confidence-filter,
    body.snapshot-mode #prediction-sort {
      pointer-events: none;
      opacity: 0.58;
    }

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

    .metric-button {
      width: 100%;
      color: var(--text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .metric-button:hover {
      border-color: var(--blue);
      background: var(--surface-hover);
    }

    .metric-button:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: 2px;
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

    .metric .value sup {
      margin-left: 5px;
      color: var(--text);
      font-size: 12px;
      font-weight: 750;
      vertical-align: super;
    }

    .metric .value sup.active {
      color: var(--green);
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

    .auth-repair {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      padding: 14px;
      align-items: center;
    }

    .auth-repair input[type="file"] {
      min-width: 0;
      color: var(--text-secondary);
      font: inherit;
    }

    .auth-repair-status {
      grid-column: 1 / -1;
      min-height: 18px;
      color: var(--muted);
      font-size: 12px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 3px 8px;
      border-radius: 999px;
      background: var(--pill-neutral-bg);
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 400;
      line-height: 1.2;
      max-width: 100%;
    }

    .pill.green { background: var(--green-bg); color: var(--green); }
    .pill.red { background: var(--red-bg); color: var(--red); }
    .pill.amber { background: var(--amber-bg); color: var(--amber); }
    .pill.blue { background: var(--blue-bg); color: var(--blue); }
    .pill.accuracy-counted { font-weight: 750; }

    .summary {
      margin-top: 10px;
      color: var(--text-secondary);
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
      color: var(--text-secondary);
      font-size: 12px;
      line-height: 1.45;
      background: var(--surface-alt);
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
      background: var(--skeleton);
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
      border-bottom-color: var(--primary);
    }

    .subtabs {
      display: flex;
      gap: 8px;
      margin: 0 0 14px;
    }

    .subtab {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface-input);
      color: var(--muted);
      padding: 7px 10px;
      cursor: pointer;
      font-weight: 700;
    }

    .subtab.active {
      color: var(--text);
      border-color: var(--primary);
      background: var(--blue-bg);
    }

    .model-blurb {
      padding: 12px 18px 0;
      color: var(--text-secondary);
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
      background: var(--surface-input);
      color: var(--text);
    }

    .report-box {
      margin: 0 18px 16px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: var(--surface-alt);
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
      background: var(--surface-input);
      color: var(--muted);
      padding: 5px 8px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 700;
    }

    .range-btn.active {
      color: var(--text);
      border-color: var(--primary);
      background: var(--blue-bg);
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
      background: var(--chart-bg);
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
      background: var(--surface-alt);
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
      padding-top: 6px;
      padding-bottom: 6px;
      vertical-align: middle;
      white-space: nowrap;
    }

    .prediction-outcomes-table .prediction-data-row .pill {
      width: max-content;
      max-width: none;
      white-space: nowrap;
    }

    .prediction-call-meta {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 24px;
      font-variant-numeric: tabular-nums;
    }

    .prediction-call-age { font-weight: 750; }

    .prediction-call-status {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .prediction-call-status::before {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--muted);
      content: "";
    }

    .prediction-call-status.active { color: var(--green); }
    .prediction-call-status.active::before { background: var(--green); }

    .prediction-current-price {
      display: inline-flex;
      align-items: baseline;
      gap: 7px;
      min-height: 24px;
      font-variant-numeric: tabular-nums;
    }

    .prediction-current-move { color: var(--muted); font-size: 11px; font-weight: 750; }
    .prediction-current-move.positive { color: var(--green); }
    .prediction-current-move.negative { color: var(--red); }

    .prediction-daily-viewport {
      width: 100%;
      max-width: 300px;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
      touch-action: pan-x;
    }

    .prediction-daily-viewport::-webkit-scrollbar { display: none; }

    .prediction-daily-grid {
      display: grid;
      grid-template-rows: repeat(7, 4px);
      grid-auto-flow: column;
      grid-auto-columns: 4px;
      align-content: center;
      gap: 1px;
      width: max-content;
      min-height: 34px;
    }

    .prediction-daily-cell {
      width: 4px;
      height: 4px;
      border-radius: 1px;
      background: #e5e7eb;
    }

    .prediction-daily-flat { background: #d0d5dd; }
    .prediction-daily-up-1 { background: #dcfce7; }
    .prediction-daily-up-2 { background: #bbf7d0; }
    .prediction-daily-up-3 { background: #86efac; }
    .prediction-daily-up-4 { background: #22c55e; }
    .prediction-daily-up-5 { background: #15803d; }
    .prediction-daily-down-1 { background: #fee2e2; }
    .prediction-daily-down-2 { background: #fecaca; }
    .prediction-daily-down-3 { background: #fca5a5; }
    .prediction-daily-down-4 { background: #ef4444; }
    .prediction-daily-down-5 { background: #b91c1c; }

    :root[data-theme="dark"] .prediction-daily-cell { background: #303741; }
    :root[data-theme="dark"] .prediction-daily-flat { background: #4a5563; }
    :root[data-theme="dark"] .prediction-daily-up-1 { background: #17372e; }
    :root[data-theme="dark"] .prediction-daily-up-2 { background: #1b5140; }
    :root[data-theme="dark"] .prediction-daily-up-3 { background: #207052; }
    :root[data-theme="dark"] .prediction-daily-up-4 { background: #269464; }
    :root[data-theme="dark"] .prediction-daily-up-5 { background: #35bb7b; }
    :root[data-theme="dark"] .prediction-daily-down-1 { background: #46262a; }
    :root[data-theme="dark"] .prediction-daily-down-2 { background: #653035; }
    :root[data-theme="dark"] .prediction-daily-down-3 { background: #8b3c41; }
    :root[data-theme="dark"] .prediction-daily-down-4 { background: #bd4a4d; }
    :root[data-theme="dark"] .prediction-daily-down-5 { background: #e45d5d; }

    .prediction-daily-empty {
      color: var(--muted);
      font-size: 11px;
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
      background: var(--sticky-header);
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
      width: 160px;
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
      box-shadow: inset 0 0 0 2px var(--primary);
    }

    .heatmap-cell.active-filter {
      box-shadow: inset 0 0 0 3px var(--primary);
    }

    .heatmap-empty { background: var(--heatmap-empty-bg); color: var(--heatmap-empty-text); }
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
      background: var(--chart-bg);
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
      background: var(--surface-alt);
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
      background: var(--surface-input);
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }

    .prediction-direction-button:last-child { border-right: 0; }
    .prediction-direction-button.active { background: var(--blue-bg); color: var(--blue); }

    .prediction-confidence-select,
    .prediction-sort-select {
      min-width: 150px;
      height: 36px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0 9px;
      background: var(--surface-input);
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

    .source-activity-section {
      padding: 16px 18px 18px;
      border-bottom: 1px solid var(--line);
    }

    .source-activity-heading {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 12px;
    }

    .source-activity-title { font-size: 14px; font-weight: 750; }
    .source-activity-meta { color: var(--muted); font-size: 12px; }

    .source-activity-controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 12px;
    }

    .source-view-control {
      display: inline-flex;
      border: 1px solid var(--line);
      border-radius: 6px;
      overflow: hidden;
    }

    .source-view-button {
      min-height: 34px;
      border: 0;
      border-right: 1px solid var(--line);
      padding: 0 12px;
      background: var(--surface-input);
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }

    .source-view-button:last-child { border-right: 0; }
    .source-view-button.active { background: var(--blue-bg); color: var(--blue); }

    .source-period-control { display: flex; align-items: center; gap: 8px; }
    .source-period-label { min-width: 150px; text-align: center; font-size: 12px; font-weight: 700; }

    .source-hourly-widget {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 16px;
      max-width: 520px;
      margin-bottom: 14px;
      padding: 11px 13px;
      border-left: 3px solid var(--blue);
      background: var(--panel-soft);
    }

    .source-hourly-value { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .source-hourly-label { color: var(--muted); font-size: 11px; }
    .source-hourly-note { grid-column: 1 / -1; color: var(--muted); font-size: 11px; }

    .source-activity-chart {
      width: 100%;
      height: 330px;
      border: 1px solid var(--line);
      overflow-x: auto;
      background: var(--chart-bg);
    }

    .source-activity-chart svg { display: block; width: 100%; min-width: 780px; height: 100%; }
    .source-stats-table { padding: 14px 18px 18px; }

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
      .panel-header { align-items: flex-start; flex-direction: column; }
      .panel-meta { white-space: normal; }
      th:nth-child(3), td:nth-child(3) { display: none; }
      .confidence-heatmap th:nth-child(3),
      .confidence-heatmap td:nth-child(3) { display: table-cell; }
      .prediction-outcomes-table th:nth-child(3),
      .prediction-outcomes-table td:nth-child(3) { display: table-cell; }
      #source-stats th:nth-child(3),
      #source-stats td:nth-child(3) { display: table-cell; }
      .prediction-filter-status { width: 100%; margin-left: 0; }
      .prediction-trend-heading { align-items: flex-start; flex-direction: column; }
      .prediction-trend-meta { text-align: left; }
      .source-activity-heading { align-items: flex-start; flex-direction: column; }
      .source-hourly-widget { grid-template-columns: 1fr; }
      .source-hourly-note { grid-column: auto; }
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
          <span id="live-status-updated">Live updates waiting</span>
          <span id="auth-state">Token not set</span>
        </div>
      </div>
      <div class="actions">
        <label class="theme-control" title="Use the dark dashboard colour scheme">
          <span>Dark mode</span>
          <input id="theme-toggle" type="checkbox" role="switch" aria-label="Dark mode">
          <span class="theme-switch" aria-hidden="true"></span>
        </label>
        <button class="btn" id="refresh-btn" type="button">Refresh</button>
        <button class="btn" id="ingest-btn" type="button">Ingest</button>
        <button class="btn primary" id="settings-btn" type="button">Settings</button>
      </div>
    </header>

    <section class="snapshot-banner" id="snapshot-banner" role="status" hidden>
      <strong>Offline snapshot</strong>
      <span id="snapshot-banner-detail">The local server is unavailable.</span>
    </section>

    <section class="tokenbar">
      <input id="token-input" type="password" autocomplete="off" placeholder="Bearer token">
      <button class="btn" id="save-token-btn" type="button">Save Token</button>
      <button class="btn" id="clear-token-btn" type="button">Clear</button>
    </section>

    <section class="grid metrics" id="metrics"></section>

    <nav class="tabs" aria-label="Dashboard sections">
      <button class="tab active" id="simulation-tab" type="button">Prediction Accuracy</button>
      <button class="tab" id="overview-tab" type="button">Overview</button>
      <button class="tab" id="sources-tab" type="button">Sources</button>
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
          <div class="panel-title">Luna vs Terra Model Experiment</div>
          <div class="panel-meta" id="model-experiment-meta">Not started</div>
        </div>
        <div class="model-blurb">Runs the same frozen cohort of 1,000 matured articles through Luna medium first and Terra low second. Experiment results are isolated from production predictions and validated against 12h, 24h, 48h, and 1w market movement.</div>
        <div class="auth-repair">
          <input id="model-experiment-email" type="email" autocomplete="email" placeholder="Report email address" aria-label="Experiment report email address">
          <button class="btn primary" id="start-model-experiment-btn" type="button">Start Experiment</button>
          <button class="btn" id="save-model-experiment-email-btn" type="button">Save Email</button>
          <button class="btn" id="test-model-experiment-email-btn" type="button">Send Test</button>
          <button class="btn" id="dispatch-model-experiment-btn" type="button">Resume</button>
          <div class="auth-repair-status" id="model-experiment-status">No experiment has been created.</div>
        </div>
        <div id="model-experiment-progress"></div>
        <pre id="model-experiment-report" class="hidden"></pre>
      </section>

      <section class="panel" style="margin-top:14px">
        <div class="panel-header">
          <div class="panel-title">Codex Authentication</div>
          <div class="panel-meta">Local auth.json</div>
        </div>
        <div class="auth-repair">
          <input id="codex-auth-file" type="file" accept=".json,application/json" aria-label="Codex auth.json file">
          <button class="btn primary" id="rotate-codex-auth-btn" type="button">Repair Login</button>
          <div class="auth-repair-status" id="codex-auth-status">Select the current <code>auth.json</code> file to restore research workers.</div>
        </div>
      </section>

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
          <div class="panel-title">Archived Failures</div>
        </div>
        <div id="failed-jobs"></div>
      </section>

      <section class="panel" style="margin-top:14px">
        <div class="panel-header">
          <div class="panel-title">Article Impacts</div>
          <div class="panel-meta" id="articles-meta">0 rows</div>
        </div>
        <div id="articles"></div>
      </section>
    </section>

    <section id="sources-panel" class="hidden">
      <section class="panel" style="margin-top:14px">
        <div class="panel-header">
          <div class="panel-title">Source Coverage and Prediction Movement</div>
          <div class="panel-meta" id="source-stats-meta">0 sources</div>
        </div>
        <section class="source-activity-section" aria-labelledby="ticker-pipeline-title">
          <div class="source-activity-heading">
            <div>
              <div class="source-activity-title" id="ticker-pipeline-title">Ticker Pipeline Health</div>
              <div class="source-activity-meta" id="ticker-pipeline-meta">Loading recent pipeline activity</div>
            </div>
          </div>
          <div id="ticker-pipeline-health"></div>
        </section>
        <section class="source-activity-section" aria-labelledby="source-activity-title">
          <div class="source-activity-heading">
            <div>
              <div class="source-activity-title" id="source-activity-title">Article and Ticker Acquisition</div>
              <div class="source-activity-meta" id="source-activity-meta">Completed Brisbane calendar hours</div>
            </div>
          </div>
          <div class="source-activity-controls">
            <div class="source-view-control" aria-label="Acquisition chart period">
              <button class="source-view-button active" type="button" data-source-view="day">Day</button>
              <button class="source-view-button" type="button" data-source-view="month">Month</button>
              <button class="source-view-button" type="button" data-source-view="year">Year</button>
            </div>
            <div class="source-period-control">
              <button class="btn" id="source-period-previous" type="button">Previous</button>
              <div class="source-period-label" id="source-period-label">Current day</div>
              <button class="btn" id="source-period-next" type="button">Next</button>
            </div>
          </div>
          <div class="source-hourly-widget" id="source-hourly-widget"></div>
          <div class="source-activity-chart" id="source-activity-chart" aria-live="polite"></div>
        </section>
        <div id="source-stats"></div>
      </section>
    </section>

    <section id="simulation-panel">
      <section class="panel">
        <div class="model-blurb">Prediction Accuracy tracks every bullish or bearish ticker prediction against real market movement. Price collection continues for every call at 12h, 24h, 48h, 1w, 2w, 1m, 3m, 6m, 1y, 2y, 3y, and 4y. Every call remains an independent observation for its full lifetime; later calls do not alter or exclude earlier results.</div>
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
    const themeToggle = document.getElementById("theme-toggle");
    const authState = document.getElementById("auth-state");
    const lastUpdated = document.getElementById("last-updated");
    const liveStatusUpdated = document.getElementById("live-status-updated");
    const snapshotBannerEl = document.getElementById("snapshot-banner");
    const snapshotBannerDetailEl = document.getElementById("snapshot-banner-detail");
    const metricsEl = document.getElementById("metrics");
    const resultsEl = document.getElementById("results");
    const jobsEl = document.getElementById("jobs");
    const failedJobsEl = document.getElementById("failed-jobs");
    const articlesEl = document.getElementById("articles");
    const modelExperimentMetaEl = document.getElementById("model-experiment-meta");
    const modelExperimentStatusEl = document.getElementById("model-experiment-status");
    const modelExperimentProgressEl = document.getElementById("model-experiment-progress");
    const modelExperimentReportEl = document.getElementById("model-experiment-report");
    const modelExperimentEmailEl = document.getElementById("model-experiment-email");
    const startModelExperimentBtn = document.getElementById("start-model-experiment-btn");
    const saveModelExperimentEmailBtn = document.getElementById("save-model-experiment-email-btn");
    const testModelExperimentEmailBtn = document.getElementById("test-model-experiment-email-btn");
    const dispatchModelExperimentBtn = document.getElementById("dispatch-model-experiment-btn");
    const sourceStatsEl = document.getElementById("source-stats");
    const sourceActivityChartEl = document.getElementById("source-activity-chart");
    const sourceActivityMeta = document.getElementById("source-activity-meta");
    const sourceHourlyWidgetEl = document.getElementById("source-hourly-widget");
    const sourcePeriodLabelEl = document.getElementById("source-period-label");
    const tickerPipelineHealthEl = document.getElementById("ticker-pipeline-health");
    const tickerPipelineMetaEl = document.getElementById("ticker-pipeline-meta");
    const resultsMeta = document.getElementById("results-meta");
    const jobsMeta = document.getElementById("jobs-meta");
    const articlesMeta = document.getElementById("articles-meta");
    const sourceStatsMeta = document.getElementById("source-stats-meta");
    const overviewTab = document.getElementById("overview-tab");
    const simulationTab = document.getElementById("simulation-tab");
    const sourcesTab = document.getElementById("sources-tab");
    const settingsBtn = document.getElementById("settings-btn");
    const overviewPanel = document.getElementById("overview-panel");
    const simulationPanel = document.getElementById("simulation-panel");
    const settingsPanel = document.getElementById("settings-panel");
    const sourcesPanel = document.getElementById("sources-panel");
    const predictionSummaryEl = document.getElementById("prediction-summary");
    const predictionSummaryMeta = document.getElementById("prediction-summary-meta");
    const predictionTrendChartEl = document.getElementById("prediction-trend-chart");
    const predictionTrendMeta = document.getElementById("prediction-trend-meta");
    const predictionsEl = document.getElementById("predictions");
    const predictionsMeta = document.getElementById("predictions-meta");
    const codexAuthFileEl = document.getElementById("codex-auth-file");
    const rotateCodexAuthBtn = document.getElementById("rotate-codex-auth-btn");
    const codexAuthStatusEl = document.getElementById("codex-auth-status");
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
    let snapshotMode = false;
    let snapshotAt = null;
    let snapshotRecoveryTimer = null;
    let snapshotRecoveryLoading = false;
    let predictionObserver = null;
    let latestStatus = null;
    let modelExperimentId = null;
    let liveStatusSocket = null;
    let liveStatusReconnectTimer = null;
    let liveStatusReconnectAttempts = 0;
    let liveStatusFallbackTimer = null;
    let liveStatusRefreshTimer = null;
    let liveStatusRefreshPending = false;
    let liveStatusLoading = false;
    let sourceStatsLoading = false;
    let sourceActivityMode = "day";
    let sourceActivityAnchor = brisbaneDateKey();
    const predictionLoadedArticles = new Set();
    const predictionFilters = { direction: "all", confidenceBin: null, sort: "newest" };
    const PREDICTION_PAGE_SIZE = 50;
    const PREDICTION_OUTCOME_INTERVALS = ["12h", "24h", "48h", "1w", "2w", "1m", "3m", "6m", "1y", "2y", "3y", "4y"];
    const PREDICTION_OUTCOME_COLUMNS = [
      { label: "Date", width: 190 },
      { label: "Ticker", width: 82 },
      { label: "Call", width: 138 },
      { label: "Dir", width: 100 },
      { label: "Score", width: 80 },
      { label: "Conf", width: 80 },
      { label: "Baseline", width: 116 },
      { label: "Current Day", width: 170 },
      { label: "Daily Movement", width: 324 },
    ];
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

    const THEME_KEY = "newsSignalTheme";
    const TOKEN_KEY = "newsSignalToken";
    const TOKEN_COOKIE = "news_signal_token";
    themeToggle.checked = document.documentElement.dataset.theme === "dark";
    themeToggle.addEventListener("change", () => {
      const theme = themeToggle.checked ? "dark" : "light";
      document.documentElement.dataset.theme = theme;
      localStorage.setItem(THEME_KEY, theme);
    });
    tokenInput.value = storedToken();
    persistToken(tokenInput.value);
    syncAuthState();

    document.getElementById("save-token-btn").addEventListener("click", () => {
      const token = tokenInput.value.trim();
      persistToken(token);
      predictionsLoaded = false;
      eodSimulationLoaded = false;
      syncAuthState();
      stopLiveStatusStream();
      startLiveStatusStream();
      loadAll();
    });

    document.getElementById("clear-token-btn").addEventListener("click", () => {
      clearStoredToken();
      tokenInput.value = "";
      predictionsLoaded = false;
      eodSimulationLoaded = false;
      syncAuthState();
      stopLiveStatusStream();
      liveStatusUpdated.textContent = "Live updates waiting";
    });

    document.getElementById("refresh-btn").addEventListener("click", loadAll);
    document.getElementById("ingest-btn").addEventListener("click", () => runAction("/api/ingest"));
    document.getElementById("requeue-btn").addEventListener("click", () => runAction("/api/requeue-pending?limit=10"));
    startModelExperimentBtn.addEventListener("click", startModelExperiment);
    saveModelExperimentEmailBtn.addEventListener("click", saveModelExperimentEmail);
    testModelExperimentEmailBtn.addEventListener("click", testModelExperimentEmail);
    dispatchModelExperimentBtn.addEventListener("click", () => runAction("/api/model-experiments/dispatch"));
    rotateCodexAuthBtn.addEventListener("click", rotateCodexAuth);
    overviewTab.addEventListener("click", () => setTab("overview"));
    simulationTab.addEventListener("click", () => setTab("simulation"));
    sourcesTab.addEventListener("click", () => setTab("sources"));
    settingsBtn.addEventListener("click", () => setTab("settings"));
    sourcesPanel.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const viewButton = target?.closest("[data-source-view]");
      if (snapshotMode && (viewButton || target?.closest("#source-period-previous") || target?.closest("#source-period-next"))) return;
      if (viewButton) {
        sourceActivityMode = viewButton.getAttribute("data-source-view") || "day";
        sourceActivityAnchor = brisbaneDateKey();
        loadSourceStats();
        return;
      }
      if (target?.closest("#source-period-previous")) shiftSourceActivityPeriod(-1);
      if (target?.closest("#source-period-next")) shiftSourceActivityPeriod(1);
    });
    metricsEl.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-open-tab]") : null;
      if (target) setTab(target.getAttribute("data-open-tab") || "simulation");
    });
    predictionSummaryEl.addEventListener("click", (event) => {
      if (snapshotMode) return;
      const target = event.target instanceof Element ? event.target.closest("[data-heatmap-direction]") : null;
      if (!target) return;
      const confidenceBin = target.getAttribute("data-confidence-bin");
      setPredictionFilters(target.getAttribute("data-heatmap-direction") || "all", confidenceBin === "all" ? null : Number(confidenceBin));
    });
    predictionsEl.addEventListener("click", (event) => {
      if (snapshotMode) return;
      const target = event.target instanceof Element ? event.target : null;
      const directionButton = target?.closest("[data-outcome-direction]");
      if (directionButton) {
        setPredictionFilters(directionButton.getAttribute("data-outcome-direction") || "all", predictionFilters.confidenceBin);
        return;
      }
      if (target?.closest("[data-reset-prediction-filters]")) setPredictionFilters("all", null);
    });
    predictionsEl.addEventListener("change", (event) => {
      if (snapshotMode) return;
      const select = event.target instanceof HTMLSelectElement ? event.target : null;
      if (!select) return;
      if (select.id === "prediction-confidence-filter") {
        setPredictionFilters(predictionFilters.direction, select.value === "all" ? null : Number(select.value));
      }
      if (select.id === "prediction-sort") setPredictionSort(select.value);
    });

    function setTab(tab) {
      const simulation = tab === "simulation";
      const settings = tab === "settings";
      const sources = tab === "sources";
      const overview = !simulation && !settings && !sources;
      overviewTab.classList.toggle("active", overview);
      simulationTab.classList.toggle("active", simulation);
      sourcesTab.classList.toggle("active", sources);
      overviewPanel.classList.toggle("hidden", !overview);
      simulationPanel.classList.toggle("hidden", !simulation);
      settingsPanel.classList.toggle("hidden", !settings);
      sourcesPanel.classList.toggle("hidden", !sources);
      settingsBtn.classList.toggle("active", settings);
      if (simulation && !predictionsLoaded) loadPredictions();
      if (sources) loadSourceStats();
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

    async function rotateCodexAuth() {
      const file = codexAuthFileEl.files && codexAuthFileEl.files[0];
      if (!file) {
        codexAuthStatusEl.textContent = "Select auth.json first.";
        return;
      }
      if (!window.confirm("Replace the research-worker Codex login, restart all workers, and recover authentication-failed jobs?")) return;

      rotateCodexAuthBtn.disabled = true;
      codexAuthStatusEl.textContent = "Replacing authentication and restarting workers...";
      try {
        const authJson = await file.text();
        const parsed = JSON.parse(authJson);
        if (!parsed || typeof parsed !== "object" || !(parsed.tokens || parsed.OPENAI_API_KEY || parsed.auth_mode)) {
          throw new Error("The selected file is not a valid Codex auth.json file.");
        }
        const result = await api("/api/research/auth/rotate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ auth_json: authJson }),
        });
        codexAuthFileEl.value = "";
        codexAuthStatusEl.textContent =
          "Login repaired. " + Number(result.recycled || 0) + " workers restarted; " +
          Number(result.recovered || 0) + " failed jobs recovered; " +
          Number(result.requeued || 0) + " jobs dispatched.";
        await loadAll();
      } catch (error) {
        codexAuthStatusEl.textContent = error.message || String(error);
      } finally {
        rotateCodexAuthBtn.disabled = false;
      }
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

    const SNAPSHOT_CONTROL_SELECTOR = [
      "#ingest-btn",
      "#requeue-btn",
      "#start-model-experiment-btn",
      "#save-model-experiment-email-btn",
      "#test-model-experiment-email-btn",
      "#dispatch-model-experiment-btn",
      "#rotate-codex-auth-btn",
      "[data-heatmap-direction]",
      "[data-outcome-direction]",
      "[data-reset-prediction-filters]",
      ".source-view-button",
      "#source-period-previous",
      "#source-period-next",
      "#prediction-confidence-filter",
      "#prediction-sort",
    ].join(",");

    function applySnapshotControlState() {
      for (const control of document.querySelectorAll(SNAPSHOT_CONTROL_SELECTOR)) {
        control.disabled = snapshotMode;
        control.setAttribute("aria-disabled", snapshotMode ? "true" : "false");
      }
    }

    function scheduleSnapshotRecovery() {
      if (!snapshotMode || snapshotRecoveryTimer) return;
      snapshotRecoveryTimer = setTimeout(checkSnapshotRecovery, 30000);
    }

    async function checkSnapshotRecovery() {
      snapshotRecoveryTimer = null;
      if (!snapshotMode || snapshotRecoveryLoading) return;
      snapshotRecoveryLoading = true;
      try {
        const response = await fetch("/api/status/live", {
          headers: headers(),
          signal: AbortSignal.timeout(12000),
          cache: "no-store",
        });
        if (response.ok && response.headers.get("x-news-signal-mode") === "live") {
          deactivateSnapshotMode();
          predictionsLoaded = false;
          await loadAll();
          if (!sourcesPanel.classList.contains("hidden")) await loadSourceStats();
          return;
        }
      } catch (_) {
        // The next scheduled probe will retry without disturbing the stored view.
      } finally {
        snapshotRecoveryLoading = false;
      }
      scheduleSnapshotRecovery();
    }

    function activateSnapshotMode(generatedAt) {
      const firstActivation = !snapshotMode;
      snapshotMode = true;
      if (generatedAt && (!snapshotAt || Date.parse(generatedAt) > Date.parse(snapshotAt))) snapshotAt = generatedAt;
      document.body.classList.add("snapshot-mode");
      snapshotBannerEl.hidden = false;
      snapshotBannerDetailEl.textContent = "Showing the last server snapshot from " + formatDate(snapshotAt) + ". Live controls will return automatically when the server reconnects.";
      liveStatusUpdated.textContent = "Server offline";
      if (firstActivation) {
        predictionFilters.direction = "all";
        predictionFilters.confidenceBin = null;
        predictionFilters.sort = "newest";
        sourceActivityMode = "day";
        stopLiveStatusStream();
      }
      applySnapshotControlState();
      scheduleSnapshotRecovery();
    }

    function deactivateSnapshotMode() {
      if (!snapshotMode) return;
      snapshotMode = false;
      snapshotAt = null;
      document.body.classList.remove("snapshot-mode");
      snapshotBannerEl.hidden = true;
      if (snapshotRecoveryTimer) clearTimeout(snapshotRecoveryTimer);
      snapshotRecoveryTimer = null;
      applySnapshotControlState();
      liveStatusUpdated.textContent = "Live server restored";
      startLiveStatusStream();
    }

    function headers() {
      const token = tokenInput.value.trim() || storedToken();
      return token ? { Authorization: "Bearer " + token } : {};
    }

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        signal: options.signal || AbortSignal.timeout(20000),
        headers: { ...(options.headers || {}), ...headers() },
      });
      const responseMode = response.headers.get("x-news-signal-mode");
      if (responseMode === "snapshot") activateSnapshotMode(response.headers.get("x-news-signal-snapshot-at"));
      if (responseMode === "live" && snapshotMode) deactivateSnapshotMode();
      const contentType = response.headers.get("content-type") || "";
      const body = await response.text();
      let payload = null;
      if (contentType.includes("application/json") && body) {
        try {
          payload = JSON.parse(body);
        } catch {
          throw new Error("Dashboard returned invalid JSON (HTTP " + response.status + ").");
        }
      }
      if (!response.ok) {
        const htmlError = contentType.includes("text/html") || body.trimStart().startsWith("<!DOCTYPE");
        const message = response.status === 401
          ? "Unauthorized: paste the dashboard token and click Save token."
          : htmlError
            ? "Cloudflare returned an error page (HTTP " + response.status + ")."
            : (payload && payload.error) || body.trim().slice(0, 180) || "HTTP " + response.status;
        throw new Error(message);
      }
      if (!contentType.includes("application/json")) {
        throw new Error("Dashboard expected JSON but received " + (contentType || "an unknown response type") + " (HTTP " + response.status + ").");
      }
      return payload;
    }

    async function runAction(path) {
      if (snapshotMode) return;
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
        const responses = await Promise.allSettled([
          api("/api/status"),
          api("/api/results?limit=20"),
          api("/api/jobs?limit=12"),
          api("/api/jobs/failures?limit=500"),
          api("/api/model-experiments"),
        ]);
        const [status, results, jobs, failedJobs, modelExperiment] = responses;
        if (status.status === "fulfilled") {
          latestStatus = status.value;
          renderMetrics(latestStatus);
          liveStatusUpdated.textContent = "Live update " + new Date().toLocaleTimeString();
        } else {
          showError(metricsEl, status.reason, false);
        }
        if (results.status === "fulfilled") {
          renderResults(results.value.results || []);
          renderArticles(results.value.results || []);
        } else {
          showError(resultsEl, results.reason, false);
          showError(articlesEl, results.reason, false);
        }
        if (jobs.status === "fulfilled") renderJobs(jobs.value.jobs || []);
        else showError(jobsEl, jobs.reason, false);
        if (failedJobs.status === "fulfilled") renderFailedJobs(failedJobs.value.jobs || []);
        else showError(failedJobsEl, failedJobs.reason, false);
        if (modelExperiment.status === "fulfilled") renderModelExperiment(modelExperiment.value);
        else showError(modelExperimentProgressEl, modelExperiment.reason, false);
        const failures = responses.filter((response) => response.status === "rejected").length;
        lastUpdated.textContent = (failures ? "Data partially refreshed " : "Data refreshed ") + new Date().toLocaleTimeString();
        if (!simulationPanel.classList.contains("hidden")) {
          predictionsLoaded = false;
          await loadPredictions();
        }
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
        const settle = (promise) => promise.then(
          (value) => ({ status: "fulfilled", value }),
          (reason) => ({ status: "rejected", reason }),
        );
        const outcomes = await settle(api(predictionRequestPath("/api/predictions/outcomes")));
        if (requestVersion !== predictionRequestVersion) return;
        if (outcomes.status === "fulfilled") {
          renderPredictionOutcomeShell(false);
          applyPredictionPage(outcomes.value, true);
        } else {
          predictionsMeta.textContent = "Prediction outcomes unavailable";
          showError(predictionsEl, outcomes.reason, false);
        }

        const summary = await settle(api("/api/predictions/summary"));
        if (requestVersion !== predictionRequestVersion) return;
        if (summary.status === "fulfilled") {
          predictionSummaryData = summary.value.summary || [];
          predictionCoverage = summary.value.coverage || {};
          renderPredictionSummary(predictionSummaryData, predictionCoverage);
        } else {
          predictionSummaryMeta.textContent = "Interval summary unavailable";
          showError(predictionSummaryEl, summary.reason, false);
        }

        const daily = await settle(api("/api/predictions/daily"));
        if (requestVersion !== predictionRequestVersion) return;
        if (daily.status === "fulfilled") {
          predictionDailySeries = daily.value.daily_series || [];
          predictionDailyCoverage = daily.value.daily_coverage || {};
          renderPredictionDailyChart();
        } else {
          predictionTrendMeta.textContent = "Daily movement history unavailable";
          showError(predictionTrendChartEl, daily.reason, false);
        }
        predictionsLoaded = true;
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
      return { ...current, jobs: [...jobCounts.values()], timing: live.timing || current.timing, active_jobs: live.active_jobs || [], latest_source_check: live.latest_source_check || current.latest_source_check };
    }

    async function refreshLiveStatus() {
      if (snapshotMode) {
        scheduleSnapshotRecovery();
        return;
      }
      if (liveStatusLoading) {
        liveStatusRefreshPending = true;
        return;
      }
      if (document.hidden || !tokenInput.value.trim()) return;
      liveStatusLoading = true;
      try {
        const live = await api("/api/status/live");
        latestStatus = mergeLiveStatus(latestStatus, live);
        if (latestStatus) renderMetrics(latestStatus);
        syncRunningJobTimers(live.active_jobs || []);
        liveStatusUpdated.textContent = "Live update " + new Date().toLocaleTimeString();
      } catch (error) {
        liveStatusUpdated.textContent = "Live updates unavailable";
      } finally {
        liveStatusLoading = false;
        if (liveStatusRefreshPending) {
          liveStatusRefreshPending = false;
          scheduleLiveStatusRefresh(0);
        }
      }
    }

    function scheduleLiveStatusRefresh(delay = 150) {
      if (liveStatusRefreshTimer) clearTimeout(liveStatusRefreshTimer);
      liveStatusRefreshTimer = setTimeout(() => {
        liveStatusRefreshTimer = null;
        refreshLiveStatus();
      }, delay);
    }

    function websocketAuthProtocol(token) {
      const bytes = new TextEncoder().encode(token);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return "auth." + btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "");
    }

    async function loadSourceStats() {
      if (sourceStatsLoading) return;
      sourceStatsLoading = true;
      sourceStatsMeta.textContent = "Loading sources";
      sourceStatsEl.innerHTML = '<div class="prediction-page-loader">' + predictionLoadingRows() + predictionLoadingRows() + '</div>';
      sourceHourlyWidgetEl.innerHTML = predictionLoadingRows();
      sourceActivityChartEl.innerHTML = '<div class="prediction-page-loader">' + predictionLoadingRows() + predictionLoadingRows() + '</div>';
      tickerPipelineMetaEl.textContent = "Loading recent pipeline activity";
      tickerPipelineHealthEl.innerHTML = '<div class="prediction-page-loader">' + predictionLoadingRows() + '</div>';
      try {
        try {
          renderTickerPipelineHealth(await api("/api/diagnostics/ticker-pipeline"));
        } catch (error) {
          tickerPipelineMetaEl.textContent = "Pipeline diagnostic unavailable";
          showError(tickerPipelineHealthEl, error, false);
        }

        try {
          const activityPayload = await api("/api/source-activity?mode=" + encodeURIComponent(sourceActivityMode) + "&anchor=" + encodeURIComponent(sourceActivityAnchor));
          renderSourceActivity(activityPayload);
        } catch (error) {
          sourceHourlyWidgetEl.innerHTML = "";
          showError(sourceActivityChartEl, error, false);
        }

        try {
          const statsPayload = await api("/api/source-stats");
          renderSourceStats(statsPayload.sources || []);
        } catch (error) {
          sourceStatsMeta.textContent = "Source table unavailable";
          showError(sourceStatsEl, error, false);
        }
      } finally {
        sourceStatsLoading = false;
      }
    }

    function renderTickerPipelineHealth(payload) {
      const articleRows = Array.isArray(payload.article_cohorts) ? payload.article_cohorts : [];
      const resultRows = Array.isArray(payload.results_by_article_cohort) ? payload.results_by_article_cohort : [];
      const scanRows = Array.isArray(payload.outcome_scans_by_day) ? payload.outcome_scans_by_day : [];
      const outcomeRows = Array.isArray(payload.outcomes_by_update_day) ? payload.outcomes_by_update_day : [];
      const metricRows = Array.isArray(payload.source_metrics_by_day) ? payload.source_metrics_by_day : [];
      const jobRows = Array.isArray(payload.jobs_by_completion_day) ? payload.jobs_by_completion_day : [];
      const failureReasons = Array.isArray(payload.recent_failure_reasons) ? payload.recent_failure_reasons : [];
      const predictionDelay = payload.prediction_delay || {};
      const predictionDelaySources = Array.isArray(payload.prediction_delay_by_source) ? payload.prediction_delay_by_source : [];
      const cumulativeDelay = predictionDelaySources.reduce((sum, row) => sum + Number(row.cumulative_delay_seconds || 0), 0);
      const byDay = (rows) => new Map(rows.map((row) => [row.day, row]));
      const articlesByDay = byDay(articleRows);
      const resultsByDay = byDay(resultRows);
      const scansByDay = byDay(scanRows);
      const outcomesByDay = byDay(outcomeRows);
      const metricsByDay = byDay(metricRows);
      const jobsByDay = new Map();
      for (const row of jobRows) {
        const statuses = jobsByDay.get(row.day) || {};
        statuses[row.status] = Number(row.jobs || 0);
        jobsByDay.set(row.day, statuses);
      }
      const days = [...new Set([
        ...articleRows.map((row) => row.day),
        ...resultRows.map((row) => row.day),
        ...scanRows.map((row) => row.day),
        ...outcomeRows.map((row) => row.day),
        ...metricRows.map((row) => row.day),
        ...jobRows.map((row) => row.day),
      ].filter(Boolean))].sort().reverse();
      const latest = payload.latest || {};
      tickerPipelineMetaEl.textContent =
        "Latest result " + formatDate(latest.latest_result_at) +
        " | latest symbol result " + formatDate(latest.latest_symbol_result_at) +
        " | latest tracked call " + formatDate(latest.latest_outcome_prediction_at) +
        " | " + Number(latest.total_outcomes || 0) + " total outcomes";
      tickerPipelineHealthEl.innerHTML = days.length
        ? '<div class="impact-wrap">' + table(
            ["Brisbane day", "Acquired", "Analyzed", "Results", "With tickers", "Ticker calls", "Succeeded", "Failed", "Cancelled", "Scanned", "Outcomes", "Skipped", "Metric calls"],
            days.map((day) => {
              const articles = articlesByDay.get(day) || {};
              const results = resultsByDay.get(day) || {};
              const scans = scansByDay.get(day) || {};
              const outcomes = outcomesByDay.get(day) || {};
              const metrics = metricsByDay.get(day) || {};
              const jobs = jobsByDay.get(day) || {};
              return [
                escapeHtml(day),
                Number(articles.articles || 0),
                Number(articles.analyzed || 0),
                Number(results.results || 0),
                Number(results.results_with_symbols || 0),
                Number(results.ticker_calls || 0),
                Number(jobs.succeeded || 0),
                Number(jobs.failed || 0),
                Number(jobs.cancelled || 0),
                Number(scans.scanned_results || 0),
                Number(outcomes.outcomes || 0),
                Number(scans.symbols_skipped || 0),
                Number(metrics.ticker_calls || 0),
              ];
            }),
          ) + '</div>' +
          (Number(predictionDelay.samples || 0)
            ? '<div class="summary"><strong>Pipeline delay:</strong> ' +
                escapeHtml(formatDuration(predictionDelay.average_total_seconds)) + ' average publication-to-synthesis time across ' +
                escapeHtml(String(predictionDelay.samples)) + ' completed first-pass articles with publication timestamps. ' +
                escapeHtml(String(predictionDelay.excluded_recovery_jobs || 0)) + ' recovery jobs are excluded.</div>' +
              '<div class="impact-wrap">' + table(
                ["Source", "Samples", "Avg publication to synthesis", "Share of total delay"],
                predictionDelaySources.map((row) => [
                  escapeHtml(row.source || "unknown"),
                  Number(row.samples || 0),
                  escapeHtml(formatDuration(row.average_total_seconds)),
                  cumulativeDelay ? (Number(row.cumulative_delay_seconds || 0) / cumulativeDelay * 100).toFixed(1) + "%" : "0.0%",
                ]),
              ) + '</div>'
            : '') +
          (failureReasons.length
            ? '<div class="summary"><strong>Recent failure reasons:</strong> ' + failureReasons.map((item) =>
                escapeHtml(String(item.failures || 0)) + ' x ' + escapeHtml(item.reason || "unknown")
              ).join(" | ") + '</div>'
            : '')
        : '<div class="empty">No recent ticker pipeline activity is recorded.</div>';
    }

    function brisbaneDateKey(date = new Date()) {
      const parts = new Intl.DateTimeFormat("en-AU", {
        timeZone: "Australia/Brisbane",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
      return parts.year + "-" + parts.month + "-" + parts.day;
    }

    function shiftSourceActivityPeriod(direction) {
      const date = new Date(sourceActivityAnchor + "T00:00:00Z");
      if (sourceActivityMode === "day") date.setUTCDate(date.getUTCDate() + direction);
      if (sourceActivityMode === "month") {
        date.setUTCDate(1);
        date.setUTCMonth(date.getUTCMonth() + direction);
      }
      if (sourceActivityMode === "year") {
        date.setUTCMonth(0, 1);
        date.setUTCFullYear(date.getUTCFullYear() + direction);
      }
      sourceActivityAnchor = date.toISOString().slice(0, 10);
      loadSourceStats();
    }

    function startLiveStatusStream() {
      if (snapshotMode || !tokenInput.value.trim() || liveStatusSocket) return;
      if (liveStatusReconnectTimer) {
        clearTimeout(liveStatusReconnectTimer);
        liveStatusReconnectTimer = null;
      }
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const authProtocol = websocketAuthProtocol(tokenInput.value.trim() || storedToken());
      const socket = new WebSocket(protocol + "//" + window.location.host + "/api/events", ["news-signal", authProtocol]);
      liveStatusSocket = socket;
      liveStatusUpdated.textContent = "Live updates connecting";

      socket.addEventListener("open", () => {
        liveStatusReconnectAttempts = 0;
        if (liveStatusFallbackTimer) clearTimeout(liveStatusFallbackTimer);
        liveStatusFallbackTimer = null;
        liveStatusUpdated.textContent = "Live updates connected";
        scheduleLiveStatusRefresh(0);
      });
      socket.addEventListener("message", (message) => {
        let event = null;
        try { event = JSON.parse(String(message.data || "")); } catch { event = null; }
        if (event && event.type === "source_check_completed") {
          if (latestStatus) {
            latestStatus = {
              ...latestStatus,
              latest_source_check: {
                id: "live",
                checked_at: event.at,
                acquired_count: Number(event.acquired_count || 0),
                source_count: Number(event.source_count || 0),
                failed_source_count: Number(event.failed_source_count || 0),
              },
            };
            renderMetrics(latestStatus);
          }
          if (!sourcesPanel.classList.contains("hidden")) loadSourceStats();
        }
        liveStatusUpdated.textContent = "Live signal " + new Date().toLocaleTimeString();
        scheduleLiveStatusRefresh();
      });
      socket.addEventListener("close", () => {
        if (liveStatusSocket !== socket) return;
        liveStatusSocket = null;
        if (!tokenInput.value.trim()) return;
        liveStatusReconnectAttempts += 1;
        const usingFallback = liveStatusReconnectAttempts >= 5;
        liveStatusUpdated.textContent = usingFallback ? "Live updates using fallback" : "Live updates reconnecting";
        if (usingFallback) scheduleLiveStatusFallback();
        const retryDelay = usingFallback
          ? 5 * 60 * 1000
          : Math.min(30000, 1000 * Math.pow(2, liveStatusReconnectAttempts - 1));
        liveStatusReconnectTimer = setTimeout(() => {
          liveStatusReconnectTimer = null;
          startLiveStatusStream();
        }, retryDelay);
      });
      socket.addEventListener("error", () => {
        liveStatusUpdated.textContent = "Live updates unavailable";
      });
    }

    function scheduleLiveStatusFallback() {
      if (liveStatusFallbackTimer) clearTimeout(liveStatusFallbackTimer);
      scheduleLiveStatusRefresh(0);
      liveStatusFallbackTimer = setTimeout(scheduleLiveStatusFallback, 30000);
    }

    function stopLiveStatusStream() {
      if (liveStatusRefreshTimer) clearTimeout(liveStatusRefreshTimer);
      if (liveStatusReconnectTimer) clearTimeout(liveStatusReconnectTimer);
      if (liveStatusFallbackTimer) clearTimeout(liveStatusFallbackTimer);
      liveStatusRefreshTimer = null;
      liveStatusReconnectTimer = null;
      liveStatusFallbackTimer = null;
      liveStatusReconnectAttempts = 0;
      liveStatusRefreshPending = false;
      const socket = liveStatusSocket;
      liveStatusSocket = null;
      if (socket) socket.close(1000, "Live updates stopped");
    }

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        if (snapshotMode) {
          scheduleSnapshotRecovery();
          return;
        }
        startLiveStatusStream();
        scheduleLiveStatusRefresh(0);
      }
    });

    async function reloadPredictionOutcomes() {
      if (snapshotMode) return;
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
      if (snapshotMode || predictionLoading || !predictionHasMore || !predictionNextCursor) return;
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
      for (const button of document.querySelectorAll("button")) {
        button.disabled = isBusy || (snapshotMode && button.matches(SNAPSHOT_CONTROL_SELECTOR));
      }
      if (!isBusy) applySnapshotControlState();
    }

    function predictionLoadingRows() {
      return Array.from({ length: 4 }, (_, index) => '<span class="skeleton-block skeleton-line ' + (index % 2 ? 'long' : 'medium') + '"></span>').join("");
    }

    function showInitialSkeletons() {
      metricsEl.innerHTML = Array.from({ length: 8 }, () => '<div class="metric skeleton-metric"><span class="skeleton-block skeleton-line short"></span><span class="skeleton-block skeleton-line medium"></span><span class="skeleton-block skeleton-line long"></span></div>').join("");
      resultsEl.innerHTML = Array.from({ length: 5 }, () => '<div class="skeleton-result"><span class="skeleton-block skeleton-line long"></span><span class="skeleton-block skeleton-line medium"></span><span class="skeleton-block skeleton-line long"></span></div>').join("");
      jobsEl.innerHTML = '<div class="prediction-page-loader">' + predictionLoadingRows() + '</div>';
      failedJobsEl.innerHTML = '<div class="prediction-page-loader">' + predictionLoadingRows() + '</div>';
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
      const results = Number((status.results && status.results.count) || 0);
      const predictions = Number((status.predictions && status.predictions.count) || 0);
      const timing = status.timing || {};
      const capacity = Number(timing.parallel_capacity || 8);
      const synthesisSamples = Number(timing.synthesis_samples || 0);
      const delaySamples = Number(timing.prediction_delay_samples || 0);
      const missingDelaySamples = Number(timing.prediction_delay_missing_publication_samples || 0);
      const yahooDelaySamples = Number(timing.yahoo_prediction_delay_samples || 0);
      const yahooMissingDelaySamples = Number(timing.yahoo_prediction_delay_missing_publication_samples || 0);
      const sourceCheck = status.latest_source_check || null;
      const sourceCheckDate = sourceCheck ? new Date(sourceCheck.checked_at) : null;
      const configuredSources = Number(status.configured_source_count || (sourceCheck && sourceCheck.source_count) || 0);
      const attemptedSources = Number((sourceCheck && sourceCheck.source_count) || 0);
      const failedSources = Number((sourceCheck && sourceCheck.failed_source_count) || 0);
      metricsEl.innerHTML = [
        metric("Articles", analyzed + queued, analyzed + " actionable analyzed, " + queued + " queued"),
        metric("Results", results, succeeded + " succeeded", [
          { text: predictions.toLocaleString() + " predictions" },
        ]),
        metric("Running", running, running + " of " + capacity + " parallel Codex workers active"),
        metric("Pending", pending, timing.estimated_queue_seconds === null || timing.estimated_queue_seconds === undefined ? "Queue estimate unavailable" : "Estimated clear in " + formatDuration(timing.estimated_queue_seconds) + " at " + capacity + " workers"),
        metric("Avg synthesis", formatDuration(timing.average_synthesis_seconds), synthesisSamples + " completed article" + (synthesisSamples === 1 ? "" : "s")),
        metric(
          "Avg pipeline delay (non-Yahoo)",
          formatDuration(timing.average_prediction_delay_seconds),
          delaySamples + " completed first-pass article" + (delaySamples === 1 ? "" : "s") + " | publication to synthesis" +
            (missingDelaySamples ? " | " + missingDelaySamples + " missing publication time" : ""),
        ),
        metric(
          "Yahoo Finance pipeline delay",
          formatDuration(timing.average_yahoo_prediction_delay_seconds),
          yahooDelaySamples + " completed first-pass article" + (yahooDelaySamples === 1 ? "" : "s") + " | publication to synthesis" +
            (yahooMissingDelaySamples ? " | " + yahooMissingDelaySamples + " missing publication time" : ""),
        ),
        metric(
          "Last source check",
          sourceCheck ? attemptedSources + " / " + configuredSources : "n/a",
          sourceCheck
            ? Number(sourceCheck.acquired_count || 0) + " acquired at " + (sourceCheckDate && Number.isFinite(sourceCheckDate.getTime()) ? sourceCheckDate.toLocaleString() : "unknown time") + " | " + failedSources + " source failures"
            : "No source checks recorded yet",
          "",
          "sources",
        ),
      ].join("");
    }

    function metric(label, value, note, supertext = "", openTab = "") {
      const tag = openTab ? "button" : "div";
      const attributes = openTab ? ' type="button" data-open-tab="' + escapeAttr(openTab) + '"' : "";
      const supertexts = Array.isArray(supertext) ? supertext : (supertext ? [{ text: supertext }] : []);
      const supertextHtml = supertexts.map((item) => '<sup' + (item && item.active ? ' class="active"' : '') + '>' + escapeHtml(item && item.text !== undefined ? item.text : item) + '</sup>').join("");
      return '<' + tag + ' class="metric' + (openTab ? ' metric-button' : '') + '"' + attributes + '><div class="label">' + escapeHtml(label) + '</div><div class="value">' + escapeHtml(String(value)) + supertextHtml + '</div><div class="note">' + escapeHtml(note) + '</div></' + tag + '>';
    }

    function renderSourceStats(sources) {
      const ledgerPending = sources.reduce((sum, source) => sum + Number(source.ledger_pending_count || 0), 0);
      const ledgerSeen = sources.reduce((sum, source) => sum + Number(source.ledger_seen_count || 0), 0);
      sourceStatsMeta.textContent = sources.length + " configured source" + (sources.length === 1 ? "" : "s") + " | " + ledgerSeen + " URLs tracked" + (ledgerPending ? " | " + ledgerPending + " pending" : "");
      if (!sources.length) {
        sourceStatsEl.innerHTML = '<div class="empty">No configured sources are available.</div>';
        return;
      }
      sourceStatsEl.innerHTML = '<div class="impact-wrap source-stats-table">' + table(["Source", "Type", "Seen", "Acquired", "Baseline", "Stale", "Pending", "Stored", "Bull avg movement", "Bear avg movement"], sources.map((source) => [
        '<a href="' + escapeAttr(source.url || "#") + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(source.name || source.id || "Unknown") + '</a>',
        escapeHtml([source.source_type, source.category].filter(Boolean).join(" / ")),
        sourceLedgerCell(source.ledger_seen_count, "Unique feed URLs observed since the persistent ledger was enabled."),
        sourceLedgerCell(source.ledger_acquired_count, "Observed feed URLs that are present in the article store. This includes duplicate feed appearances for articles already acquired from another source."),
        sourceLedgerCell(source.ledger_baseline_count, "Existing entries recorded during this source's initial baseline. They were deliberately not queued, preventing stale-feed backfill."),
        sourceLedgerCell(source.ledger_stale_count, "Previously unseen archive entries published before this source's fixed activation time. They are recorded but never queued."),
        sourceLedgerCell(source.ledger_pending_count, "Durable unseen feed entries still awaiting insertion or queue recovery."),
        sourceLedgerCell(source.acquired_article_count, "All article records historically stored against this source."),
        sourceMovementCell(source.bullish_average_movement_pct, source.bullish_samples, "bullish"),
        sourceMovementCell(source.bearish_average_movement_pct, source.bearish_samples, "bearish"),
      ]));
      sourceStatsEl.innerHTML += '</div>';
    }

    function sourceLedgerCell(value, hint) {
      return '<span title="' + escapeAttr(hint) + '">' + escapeHtml(String(Number(value || 0))) + '</span>';
    }

    function renderSourceActivity(payload) {
      sourceActivityMode = payload.mode || sourceActivityMode;
      sourceActivityAnchor = payload.anchor || sourceActivityAnchor;
      document.querySelectorAll("[data-source-view]").forEach((button) => {
        button.classList.toggle("active", button.getAttribute("data-source-view") === sourceActivityMode);
      });
      sourcePeriodLabelEl.textContent = payload.period_label || sourceActivityAnchor;
      document.getElementById("source-period-next").disabled = payload.can_go_next === false;

      const average = payload.average || {};
      const completedHours = Number(average.completed_hours || 0);
      sourceHourlyWidgetEl.innerHTML =
        '<div><div class="source-hourly-value">' + formatDecimal(average.articles_per_hour) + '</div><div class="source-hourly-label">Articles acquired per completed hour</div></div>' +
        '<div><div class="source-hourly-value">' + formatDecimal(average.tickers_per_hour) + '</div><div class="source-hourly-label">Ticker calls acquired per completed hour</div></div>' +
        '<div class="source-hourly-note">Average across ' + completedHours + ' fully observed Brisbane calendar hour' + (completedHours === 1 ? '' : 's') + '. The current partial hour is excluded.</div>';
      sourceActivityMeta.textContent = "Australia/Brisbane | exact top-of-hour buckets | " + (payload.bucket_note || "completed periods only");
      renderSourceActivityChart(payload);
    }

    function formatDecimal(value) {
      const number = Number(value || 0);
      return Number.isFinite(number) ? number.toFixed(2) : "0.00";
    }

    function renderSourceActivityChart(payload) {
      const buckets = Array.isArray(payload.buckets) ? payload.buckets : [];
      const populated = buckets.filter((item) => item.articles !== null && item.articles !== undefined);
      const width = 1040;
      const height = 320;
      const pad = { left: 58, right: 62, top: 46, bottom: 50 };
      const plotWidth = width - pad.left - pad.right;
      const plotHeight = height - pad.top - pad.bottom;
      const domainMax = Math.max(1, Number(payload.domain_max || buckets.length || 1));
      const articleMax = Math.max(1, ...populated.map((item) => Number(item.articles || 0)));
      const tickerMax = Math.max(1, ...populated.map((item) => Number(item.tickers || 0)));
      const xFor = (value) => pad.left + (Number(value) / domainMax) * plotWidth;
      const articleY = (value) => pad.top + ((articleMax - Number(value)) / articleMax) * plotHeight;
      const tickerY = (value) => pad.top + ((tickerMax - Number(value)) / tickerMax) * plotHeight;

      const grid = Array.from({ length: 5 }, (_, index) => {
        const ratio = index / 4;
        const y = pad.top + ratio * plotHeight;
        const articles = articleMax * (1 - ratio);
        const tickers = tickerMax * (1 - ratio);
        return '<line x1="' + pad.left + '" y1="' + y.toFixed(2) + '" x2="' + (width - pad.right) + '" y2="' + y.toFixed(2) + '" stroke="var(--chart-grid)"></line>' +
          '<text x="' + (pad.left - 8) + '" y="' + (y + 4).toFixed(2) + '" fill="var(--blue)" font-size="10" text-anchor="end">' + formatAxisCount(articles) + '</text>' +
          '<text x="' + (width - pad.right + 8) + '" y="' + (y + 4).toFixed(2) + '" fill="var(--green)" font-size="10">' + formatAxisCount(tickers) + '</text>';
      }).join("");

      const separators = Array.isArray(payload.separators) ? payload.separators : [];
      const separatorBands = separators.map((separator, index) => {
        const start = Math.max(0, Number(separator.position || 0));
        const end = index + 1 < separators.length ? Number(separators[index + 1].position || domainMax) : domainMax;
        const x = xFor(start);
        const nextX = xFor(Math.min(domainMax, end));
        return (index % 2 === 0 ? '<rect x="' + x.toFixed(2) + '" y="' + pad.top + '" width="' + Math.max(0, nextX - x).toFixed(2) + '" height="' + plotHeight + '" fill="var(--chart-band)"></rect>' : '') +
          '<line x1="' + x.toFixed(2) + '" y1="' + pad.top + '" x2="' + x.toFixed(2) + '" y2="' + (height - pad.bottom) + '" stroke="var(--chart-separator)" stroke-dasharray="4 4"></line>' +
          '<text x="' + (x + 5).toFixed(2) + '" y="' + (pad.top + 12) + '" fill="var(--muted)" font-size="9">' + escapeHtml(separator.label || "") + '</text>';
      }).join("");

      const ticks = (Array.isArray(payload.ticks) ? payload.ticks : []).map((tick) => {
        const x = xFor(tick.position);
        return '<line x1="' + x.toFixed(2) + '" y1="' + (height - pad.bottom) + '" x2="' + x.toFixed(2) + '" y2="' + (height - pad.bottom + 4) + '" stroke="var(--muted)"></line>' +
          '<text x="' + x.toFixed(2) + '" y="' + (height - 27) + '" fill="var(--muted)" font-size="10" text-anchor="middle">' + escapeHtml(tick.label || "") + '</text>';
      }).join("");

      const pathFor = (field, yFor) => {
        let drawing = false;
        return buckets.map((item) => {
          const value = item[field];
          if (value === null || value === undefined) {
            drawing = false;
            return "";
          }
          const command = drawing ? "L" : "M";
          drawing = true;
          return command + xFor(item.position).toFixed(2) + " " + yFor(value).toFixed(2);
        }).join(" ");
      };
      const articlePath = pathFor("articles", articleY);
      const tickerPath = pathFor("tickers", tickerY);
      const points = populated.map((item) => {
        const tooltip = (item.label || "Period") + ": " + Number(item.articles || 0) + " articles, " + Number(item.tickers || 0) + " ticker calls" + (item.partial ? " (completed hours only)" : "");
        return '<circle cx="' + xFor(item.position).toFixed(2) + '" cy="' + articleY(item.articles).toFixed(2) + '" r="3" fill="var(--blue)"><title>' + escapeHtml(tooltip) + '</title></circle>' +
          '<circle cx="' + xFor(item.position).toFixed(2) + '" cy="' + tickerY(item.tickers).toFixed(2) + '" r="3" fill="var(--green)"><title>' + escapeHtml(tooltip) + '</title></circle>';
      }).join("");

      sourceActivityChartEl.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Articles and ticker calls acquired over time">' +
        separatorBands + grid + ticks +
        '<text x="8" y="20" fill="var(--blue)" font-size="10">Articles</text>' +
        '<text x="' + (width - 8) + '" y="20" fill="var(--green)" font-size="10" text-anchor="end">Ticker calls</text>' +
        '<line x1="' + pad.left + '" y1="24" x2="' + (pad.left + 22) + '" y2="24" stroke="var(--blue)" stroke-width="3"></line><text x="' + (pad.left + 29) + '" y="28" fill="var(--text-secondary)" font-size="11">Articles retrieved</text>' +
        '<line x1="' + (pad.left + 150) + '" y1="24" x2="' + (pad.left + 172) + '" y2="24" stroke="var(--green)" stroke-width="3"></line><text x="' + (pad.left + 179) + '" y="28" fill="var(--text-secondary)" font-size="11">Ticker calls</text>' +
        (articlePath ? '<path d="' + articlePath + '" fill="none" stroke="var(--blue)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>' : '') +
        (tickerPath ? '<path d="' + tickerPath + '" fill="none" stroke="var(--green)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>' : '') + points +
        '<text x="' + (pad.left + plotWidth / 2) + '" y="310" fill="var(--muted)" font-size="10" text-anchor="middle">' + escapeHtml(payload.axis_label || "Brisbane time") + '</text>' +
      '</svg>';
    }

    function formatAxisCount(value) {
      if (value >= 1000) return (value / 1000).toFixed(value >= 10000 ? 0 : 1) + "k";
      if (value >= 10) return String(Math.round(value));
      return Number(value).toFixed(value < 2 ? 1 : 0);
    }

    function sourceMovementCell(value, samples, direction) {
      const count = Number(samples || 0);
      const movement = Number(value);
      if (!count || !Number.isFinite(movement)) {
        return pill("n/a", "", "No accuracy-eligible " + direction + " interval samples have been recorded for this source.");
      }
      const favorable = direction === "bullish" ? movement > 0 : movement < 0;
      const cls = movement === 0 ? "amber" : favorable ? "green" : "red";
      return pill(
        signedPct(movement) + " (" + count + ")",
        cls,
        "Average ticker movement across " + count + " recorded " + direction + " interval sample" + (count === 1 ? "" : "s") + " that count toward prediction accuracy. Opposite-call-truncated intervals are excluded.",
      );
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

    async function startModelExperiment() {
      setBusy(true);
      modelExperimentStatusEl.textContent = "Creating the frozen 1,000-article cohort...";
      try {
        await api("/api/model-experiments/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email_to: modelExperimentEmailEl.value.trim() || null }),
        });
        await loadAll();
      } catch (error) {
        modelExperimentStatusEl.textContent = error.message || String(error);
      } finally {
        setBusy(false);
      }
    }

    async function saveModelExperimentEmail() {
      if (!modelExperimentId) {
        modelExperimentStatusEl.textContent = "Start an experiment before saving its report email.";
        return;
      }
      setBusy(true);
      try {
        const payload = await api("/api/model-experiments/email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ experiment_id: modelExperimentId, email_to: modelExperimentEmailEl.value.trim() }),
        });
        renderModelExperiment(payload);
      } catch (error) {
        modelExperimentStatusEl.textContent = error.message || String(error);
      } finally {
        setBusy(false);
      }
    }

    async function testModelExperimentEmail() {
      if (!modelExperimentId) {
        modelExperimentStatusEl.textContent = "Start an experiment before testing report delivery.";
        return;
      }
      setBusy(true);
      modelExperimentStatusEl.textContent = "Sending a test email...";
      try {
        const payload = await api("/api/model-experiments/email/test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ experiment_id: modelExperimentId, email_to: modelExperimentEmailEl.value.trim() }),
        });
        modelExperimentStatusEl.textContent = "Test email accepted by " + payload.provider + (payload.message_id ? " (" + payload.message_id + ")" : "") + ".";
      } catch (error) {
        modelExperimentStatusEl.textContent = error.message || String(error);
      } finally {
        setBusy(false);
      }
    }

    function renderModelExperiment(payload) {
      const experiment = payload.experiment;
      if (!experiment) {
        modelExperimentId = null;
        modelExperimentMetaEl.textContent = "Not started";
        modelExperimentStatusEl.textContent = "No experiment has been created.";
        modelExperimentProgressEl.innerHTML = "";
        modelExperimentReportEl.classList.add("hidden");
        startModelExperimentBtn.disabled = false;
        return;
      }
      modelExperimentId = experiment.id;
      if (experiment.email_to && !modelExperimentEmailEl.value) modelExperimentEmailEl.value = experiment.email_to;
      modelExperimentMetaEl.textContent = String(experiment.status || "unknown") + " - phase " + String(experiment.phase || 1);
      modelExperimentStatusEl.textContent = experiment.status === "completed"
        ? "Completed " + formatDate(experiment.completed_at) + ". Email: " + String(experiment.email_status || "not configured") + (experiment.email_error ? " (" + experiment.email_error + ")" : "")
        : "Experiment " + experiment.id + " is processing " + (Number(experiment.phase) === 1 ? "Luna medium" : "Terra low") + ". Production articles retain queue priority.";
      const grouped = new Map();
      for (const row of payload.progress || []) {
        const key = String(row.phase) + ":" + row.model + ":" + row.reasoning_effort;
        if (!grouped.has(key)) grouped.set(key, { phase: row.phase, model: row.model, effort: row.reasoning_effort, statuses: {}, duration: null });
        const group = grouped.get(key);
        group.statuses[row.status] = Number(row.count || 0);
        if (row.average_duration_seconds !== null) group.duration = Number(row.average_duration_seconds);
      }
      modelExperimentProgressEl.innerHTML = grouped.size ? table(
        ["Phase", "Model", "Pending", "Active", "Succeeded", "Failed", "Avg time"],
        [...grouped.values()].map((group) => [
          escapeHtml(String(group.phase)),
          escapeHtml(group.model + " / " + group.effort),
          escapeHtml(String(group.statuses.pending || 0)),
          escapeHtml(String((group.statuses.queued || 0) + (group.statuses.running || 0))),
          escapeHtml(String(group.statuses.succeeded || 0)),
          escapeHtml(String(group.statuses.failed || 0)),
          escapeHtml(formatDuration(group.duration)),
        ]),
      ) : '<div class="empty">Preparing experiment jobs.</div>';
      if (experiment.report_text) {
        modelExperimentReportEl.textContent = experiment.report_text;
        modelExperimentReportEl.classList.remove("hidden");
      } else {
        modelExperimentReportEl.classList.add("hidden");
      }
      startModelExperimentBtn.disabled = ["preparing", "running", "reporting"].includes(experiment.status);
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
        '<span class="job-timing" title="Elapsed time from the article publication timestamp to completion of its first-pass synthesis.">' + escapeHtml(formatDuration(job.prediction_delay_seconds)) + '</span>',
        escapeHtml(String(job.attempts || 0)),
        '<a class="truncate" href="' + escapeAttr(job.url || "#") + '" target="_blank" rel="noreferrer">' + escapeHtml(job.title || job.article_id || "Article") + '</a>',
        ];
      }));
    }

    function renderFailedJobs(jobs) {
      if (!jobs.length) {
        failedJobsEl.innerHTML = '<div class="empty">No archived failures.</div>';
        return;
      }
      failedJobsEl.innerHTML = table(["Status", "Failed", "Attempts", "Reason", "Article"], jobs.map((job) => [
        pill("failed", "red", "Research exhausted its automatic processing attempts and the article was archived."),
        escapeHtml(formatDate(job.finished_at || job.queued_at)),
        escapeHtml(String(job.attempts || 0)),
        '<span style="white-space:normal;overflow-wrap:anywhere">' + escapeHtml(job.last_error || "No failure reason was recorded.") + '</span>',
        '<a class="truncate" href="' + escapeAttr(job.url || "#") + '" target="_blank" rel="noreferrer">' + escapeHtml(job.title || job.article_id || "Article") + '</a>',
      ]));
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
      const headers = PREDICTION_OUTCOME_COLUMNS.map((column) => column.label).concat(PREDICTION_OUTCOME_INTERVALS);
      const intervalColumns = PREDICTION_OUTCOME_INTERVALS.map((interval) => '<col data-prediction-interval="' + interval + '" style="width:150px">').join("");
      const colgroup = '<colgroup>' + PREDICTION_OUTCOME_COLUMNS.map((column) => '<col style="width:' + column.width + 'px">').join("") + intervalColumns + '</colgroup>';
      const header = '<thead><tr>' + headers.map((item) => '<th>' + escapeHtml(item) + '</th>').join("") + '</tr></thead>';
      const initialTableWidth = PREDICTION_OUTCOME_COLUMNS.reduce((sum, column) => sum + column.width, 0) + PREDICTION_OUTCOME_INTERVALS.length * 150;
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
      const sortOptions = [
        ["newest", "Newest calls"],
        ["oldest", "Oldest calls"],
        ["current_desc", "Current movement: high to low"],
        ["current_asc", "Current movement: low to high"],
        ["peak_desc", "Peak movement: high to low"],
        ["peak_asc", "Peak movement: low to high"],
      ].map((option) => '<option value="' + option[0] + '">' + option[1] + '</option>').join("");
      return '<div class="prediction-filterbar">' +
        '<div class="prediction-filter-group"><span class="prediction-filter-label">Direction</span><div class="prediction-direction-control" role="group" aria-label="Prediction direction">' +
          '<button class="prediction-direction-button" type="button" data-outcome-direction="all">All</button>' +
          '<button class="prediction-direction-button" type="button" data-outcome-direction="bullish">Bullish</button>' +
          '<button class="prediction-direction-button" type="button" data-outcome-direction="bearish">Bearish</button>' +
        '</div></div>' +
        '<label class="prediction-filter-group"><span class="prediction-filter-label">Confidence</span><select class="prediction-confidence-select" id="prediction-confidence-filter">' + confidenceOptions + '</select></label>' +
        '<label class="prediction-filter-group"><span class="prediction-filter-label">Sort</span><select class="prediction-sort-select" id="prediction-sort" title="Peak movement is the signed daily-sample movement furthest from the baseline price.">' + sortOptions + '</select></label>' +
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
      const columnCount = PREDICTION_OUTCOME_COLUMNS.length + PREDICTION_OUTCOME_INTERVALS.length;
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
          predictionCallCell(item),
          pill(item.direction || "unknown", directionClass(item.direction), item.rationale || "Predicted direction for this ticker."),
          pill(formatNumber(item.score), Number(item.score || 0) > 0 ? "green" : "red", "Article prediction score used when the ticker outcome was recorded."),
          pill(formatNumber(item.confidence), "green", "Prediction confidence from the analyzed impact detail or article-level result."),
          priceCell(item.baseline_price, item.baseline_at, "Closest available ticker price at the article publication time."),
          predictionCurrentPriceCell(item),
          predictionDailyGrid(item),
          ...PREDICTION_OUTCOME_INTERVALS.map((interval) => predictionPointPill(item.intervals && item.intervals[interval], item.direction, interval)),
        ];
        html += '<tr class="prediction-data-row">' + cells.map((cell) => '<td>' + cell + '</td>').join("") + '</tr>';
        predictionLastArticleKey = articleKey;
      }
      body.insertAdjacentHTML("beforeend", html);
      resizePredictionOutcomeColumns(PREDICTION_OUTCOME_INTERVALS);
      scrollPredictionDailyGridsToLatest();
    }

    function resizePredictionOutcomeColumns(intervals) {
      const bodyTable = document.getElementById("prediction-outcomes-table");
      const stickyTable = document.getElementById("prediction-sticky-table");
      if (!bodyTable || !stickyTable) return;
      const fixedWidth = PREDICTION_OUTCOME_COLUMNS.reduce((sum, column) => sum + column.width, 0);
      let intervalWidthTotal = 0;
      intervals.forEach((interval, intervalIndex) => {
        const cellIndex = PREDICTION_OUTCOME_COLUMNS.length + intervalIndex;
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

    function setPredictionSort(sort) {
      const allowed = ["newest", "oldest", "current_desc", "current_asc", "peak_desc", "peak_asc"];
      const normalized = allowed.includes(sort) ? sort : "newest";
      if (predictionFilters.sort === normalized) return;
      predictionFilters.sort = normalized;
      reloadPredictionOutcomes();
    }

    function updatePredictionFilterUi() {
      for (const button of predictionsEl.querySelectorAll("[data-outcome-direction]")) {
        button.classList.toggle("active", button.getAttribute("data-outcome-direction") === predictionFilters.direction);
      }
      const select = document.getElementById("prediction-confidence-filter");
      if (select) select.value = predictionFilters.confidenceBin === null ? "all" : String(predictionFilters.confidenceBin);
      const sortSelect = document.getElementById("prediction-sort");
      if (sortSelect) sortSelect.value = predictionFilters.sort;
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
      params.set("sort", predictionFilters.sort);
      if (cursor) params.set("cursor", cursor);
      return endpoint + "?" + params.toString();
    }

    function observePredictionSentinel() {
      if (predictionObserver) predictionObserver.disconnect();
      predictionObserver = null;
      if (snapshotMode || !predictionHasMore || !("IntersectionObserver" in window)) return;
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
      const heatmapCellWidth = 160;
      const minimumWidth = heatmapCellWidth + 76 + bands.length * heatmapCellWidth;
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
      const colors = { bullish: "var(--green)", bearish: "var(--red)" };

      const movementGrid = Array.from({ length: 5 }, (_, index) => {
        const ratio = index / 4;
        const value = movementMax - ratio * movementSpan;
        const y = pad.top + ratio * plotHeight;
        return '<line x1="' + pad.left + '" y1="' + y.toFixed(2) + '" x2="' + (width - pad.right) + '" y2="' + y.toFixed(2) + '" stroke="var(--chart-grid)"></line>' +
          '<text x="' + (pad.left - 9) + '" y="' + (y + 4).toFixed(2) + '" fill="var(--muted)" font-size="10" text-anchor="end">' + escapeHtml(signedPct(value)) + '</text>';
      }).join("");
      const zeroY = movementY(0);
      const zeroLine = '<line class="prediction-zero-line" x1="' + pad.left + '" y1="' + zeroY.toFixed(2) + '" x2="' + (width - pad.right) + '" y2="' + zeroY.toFixed(2) + '" stroke="var(--chart-zero)" stroke-width="1.5"></line>' +
        '<text x="' + (pad.left + 7) + '" y="' + (zeroY - 6).toFixed(2) + '" fill="var(--text-secondary)" font-size="10" font-weight="700">0% movement</text>';

      const tickDays = xMax > 0
        ? Array.from(new Set(Array.from({ length: 6 }, (_, index) => Math.round((index / 5) * xMax))))
        : [0];
      const xTicks = tickDays.map((day) => {
        const x = xFor(day);
        return '<line x1="' + x.toFixed(2) + '" y1="' + pad.top + '" x2="' + x.toFixed(2) + '" y2="' + (height - pad.bottom) + '" stroke="var(--chart-grid-subtle)"></line>' +
          '<text x="' + x.toFixed(2) + '" y="' + (height - 22) + '" fill="var(--muted)" font-size="10" text-anchor="middle">Day ' + day + '</text>';
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
          return '<text x="' + (width - pad.right + 9) + '" y="' + (y + 4).toFixed(2) + '" fill="var(--chart-sample-text)" font-size="10">' + Math.round(value) + '</text>';
        }).join("");
        const samplePoints = sampleSeries.map((point) => '<circle cx="' + xFor(point.day).toFixed(2) + '" cy="' + sampleY(point.samples).toFixed(2) + '" r="3" fill="var(--chart-sample)"><title>' + escapeHtml("Day " + point.day + ": " + point.samples + " samples") + '</title></circle>').join("");
        return '<path d="' + samplePath + '" fill="none" stroke="var(--chart-sample)" stroke-width="2" stroke-dasharray="6 5" stroke-linecap="round" stroke-linejoin="round"></path>' + samplePoints + sampleTicks +
          '<text x="' + (width - pad.right + 9) + '" y="20" fill="var(--chart-sample-text)" font-size="10">Samples</text>';
      })() : "";

      const legend = populated.map((item, index) => {
        const x = pad.left + index * 170;
        return '<line x1="' + x + '" y1="20" x2="' + (x + 22) + '" y2="20" stroke="' + colors[item.direction] + '" stroke-width="3"></line><text x="' + (x + 29) + '" y="24" fill="var(--text-secondary)" font-size="11">' + escapeHtml(item.label) + '</text>';
      }).join("") + (sampleSeries ? '<line x1="' + (pad.left + 340) + '" y1="20" x2="' + (pad.left + 362) + '" y2="20" stroke="var(--chart-sample)" stroke-width="2" stroke-dasharray="6 5"></line><text x="' + (pad.left + 369) + '" y="24" fill="var(--muted)" font-size="11">Daily samples</text>' : "");

      predictionTrendChartEl.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Average prediction movement by days since baseline">' +
        '<text x="8" y="20" fill="var(--muted)" font-size="10">Average movement</text>' + legend + movementGrid + xTicks + zeroLine + movementLines + sampleMarkup +
        '<text x="' + (pad.left + plotWidth / 2) + '" y="294" fill="var(--muted)" font-size="10" text-anchor="middle">Days since prediction baseline</text>' +
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
        "Price sampled at " + formatDate(point.at) + ". " + (accurate ? "Accurate" : "Inaccurate") + " " + direction + " prediction at " + label + " after prediction time. " + (counted ? "Included in the accuracy chart as an independent observation." : "Excluded because the prediction confidence is missing or outside the supported range."),
      );
    }

    function predictionCallCell(item) {
      const suppliedDays = Number(item.days_since_call);
      const predictionTime = new Date(item.prediction_at).getTime();
      const calculatedDays = Number.isFinite(predictionTime) ? Math.max(0, Math.floor((Date.now() - predictionTime) / 86400000)) : 0;
      const days = Number.isFinite(suppliedDays) ? Math.max(0, Math.floor(suppliedDays)) : calculatedDays;
      const status = "Tracked";
      const statusHint = "This call remains an independent observation and continues contributing whenever a tracked price interval is available.";
      return '<span class="prediction-call-meta" title="' + escapeAttr(days + " days since the call. " + statusHint) + '">' +
        '<span class="prediction-call-age">' + days + 'd</span>' +
        '<span class="prediction-call-status active">' + status + '</span>' +
      '</span>';
    }

    function predictionCurrentPriceCell(item) {
      if (item.current_price === null || item.current_price === undefined || item.current_price === "") {
        return '<span class="prediction-daily-empty">n/a</span>';
      }
      const price = Number(item.current_price);
      if (!Number.isFinite(price)) return '<span class="prediction-daily-empty">n/a</span>';
      const hasMovement = item.current_movement_pct !== null && item.current_movement_pct !== undefined && item.current_movement_pct !== "";
      const movement = hasMovement ? Number(item.current_movement_pct) : NaN;
      const movementClass = movement > 0 ? "positive" : movement < 0 ? "negative" : "";
      const hasPeak = item.peak_movement_pct !== null && item.peak_movement_pct !== undefined && item.peak_movement_pct !== "";
      const peak = hasPeak ? Number(item.peak_movement_pct) : NaN;
      const hint = "Latest stored daily price sampled at " + formatDate(item.current_price_at) +
        ". Current movement is measured from the baseline price." +
        (Number.isFinite(peak) ? " Signed peak movement is " + signedPct(peak) + "." : "");
      return '<span class="prediction-current-price" title="' + escapeAttr(hint) + '">' +
        '<span>' + escapeHtml(formatMoney(price)) + '</span>' +
        '<span class="prediction-current-move ' + movementClass + '">' + escapeHtml(hasMovement ? signedPct(movement) : "n/a") + '</span>' +
      '</span>';
    }

    function predictionDailyMovementClass(value, direction) {
      const movement = Number(value);
      if (!Number.isFinite(movement) || movement === 0) return "prediction-daily-flat";
      const magnitude = Math.abs(movement);
      const level = magnitude < 1 ? 1 : magnitude < 2.5 ? 2 : magnitude < 5 ? 3 : magnitude < 10 ? 4 : 5;
      const movementInPredictedDirection = direction === "bearish" ? -movement : movement;
      return "prediction-daily-" + (movementInPredictedDirection > 0 ? "up-" : "down-") + level;
    }

    function predictionDailyGrid(item) {
      const points = Array.isArray(item.daily_points)
        ? item.daily_points.slice().sort((left, right) => Number(left.day_index || 0) - Number(right.day_index || 0))
        : [];
      if (points.length < 2) return '<span class="prediction-daily-empty" title="Daily price tracking begins after the first full day.">Awaiting day 1</span>';
      let previous = points[0];
      const cells = [];
      for (const point of points.slice(1)) {
        const price = Number(point.price);
        const previousPrice = Number(previous.price);
        const dailyMovement = Number.isFinite(price) && Number.isFinite(previousPrice) && previousPrice !== 0
          ? ((price - previousPrice) / previousPrice) * 100
          : 0;
        const baselineMovement = Number(point.change_pct);
        const hint = "Day " + Number(point.day_index || 0) + " at " + formatDate(point.at) +
          ": " + formatMoney(price) + ", from baseline " + signedPct(baselineMovement) +
          ", day-over-day " + signedPct(dailyMovement) + ".";
        cells.push('<span class="prediction-daily-cell ' + predictionDailyMovementClass(baselineMovement, item.direction) + '" title="' + escapeAttr(hint) + '" aria-label="' + escapeAttr(hint) + '"></span>');
        previous = point;
      }
      const colourMeaning = item.direction === "bearish"
        ? "green is below baseline and red is above baseline"
        : "green is above baseline and red is below baseline";
      const label = cells.length + " tracked daily prices for a " + item.direction + " call. Each square is coloured by movement from the call baseline: " + colourMeaning + ", and darker colour means larger magnitude.";
      return '<div class="prediction-daily-viewport" data-daily-grid-scroll title="Scroll horizontally for older daily prices.">' +
        '<div class="prediction-daily-grid" role="img" aria-label="' + escapeAttr(label) + '">' + cells.join("") + '</div>' +
      '</div>';
    }

    function scrollPredictionDailyGridsToLatest() {
      for (const viewport of predictionsEl.querySelectorAll("[data-daily-grid-scroll]:not([data-scroll-initialized])")) {
        viewport.setAttribute("data-scroll-initialized", "");
        viewport.scrollLeft = viewport.scrollWidth;
      }
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
        return '<line x1="' + x.toFixed(2) + '" y1="' + pad + '" x2="' + x.toFixed(2) + '" y2="' + (height - pad) + '" stroke="var(--line)"></line>' +
          '<text x="' + x.toFixed(2) + '" y="' + labelY + '" fill="var(--muted)" font-size="10" text-anchor="' + (originalIndex === 0 ? "start" : originalIndex === clean.length - 1 ? "end" : "middle") + '">' + escapeHtml(label) + '</text>';
      }).join(" ");

      targetEl.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Portfolio value movement">' +
        slices +
        '<path d="' + makePath("value") + '" fill="none" stroke="var(--primary)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>' +
        '<path d="' + makePath("cash") + '" fill="none" stroke="var(--blue)" stroke-width="2" stroke-dasharray="6 5" stroke-linecap="round" stroke-linejoin="round"></path>' +
        '<path d="' + makePath("investments") + '" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>' +
        '<text x="' + (width - 190) + '" y="22" fill="var(--primary)" font-size="12">Total</text>' +
        '<text x="' + (width - 135) + '" y="22" fill="var(--blue)" font-size="12">Cash</text>' +
        '<text x="' + (width - 88) + '" y="22" fill="var(--green)" font-size="12">Invested</text>' +
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

    function dashboardDate(value) {
      const text = String(value || "");
      const normalized = /^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$/.test(text)
        ? text.replace(" ", "T") + "Z"
        : text;
      return new Date(normalized);
    }

    function formatDate(value) {
      if (!value) return "unknown";
      const date = dashboardDate(value);
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
      const date = dashboardDate(value);
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

    function showError(target, error, updateGlobalStatus = true) {
      target.innerHTML = '<div class="error">' + escapeHtml(error.message || String(error)) + '</div>';
      if (updateGlobalStatus) lastUpdated.textContent = "Load failed";
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
      const requestedTab = new URLSearchParams(window.location.search).get("tab");
      if (requestedTab === "sources" || requestedTab === "overview" || requestedTab === "settings") {
        setTab(requestedTab);
      }
      startLiveStatusStream();
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
  if (header === `Bearer ${env.CONTAINER_API_TOKEN}`) return true;
  const websocketProtocols = (request.headers.get("sec-websocket-protocol") || "")
    .split(",")
    .map((value) => value.trim());
  const authProtocol = websocketProtocols.find((value) => value.startsWith("auth."));
  if (authProtocol) {
    try {
      const encoded = authProtocol.slice("auth.".length).replace(/-/g, "+").replace(/_/g, "/");
      const binary = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="));
      const decoded = new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
      if (decoded === env.CONTAINER_API_TOKEN) return true;
    } catch {
      // Continue to cookie authentication.
    }
  }
  const cookie = request.headers.get("cookie") || "";
  const token = cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith("news_signal_token="));
  if (!token) return false;
  try {
    return decodeURIComponent(token.slice("news_signal_token=".length)) === env.CONTAINER_API_TOKEN;
  } catch {
    return false;
  }
}

function requireAuthorized(request: Request, env: Env): Response | null {
  return isAuthorized(request, env) ? null : json({ error: "Unauthorized" }, { status: 401 });
}

function snapshotUploadAuthorized(request: Request, env: Env): boolean {
  const authorization = request.headers.get("authorization") || "";
  return Boolean(env.SNAPSHOT_UPLOAD_TOKEN) && authorization === `Bearer ${env.SNAPSHOT_UPLOAD_TOKEN}`;
}

function offsiteUploadAuthorized(request: Request, env: Env): boolean {
  const authorization = request.headers.get("authorization") || "";
  return Boolean(env.OFFSITE_BACKUP_TOKEN) && authorization === `Bearer ${env.OFFSITE_BACKUP_TOKEN}`;
}

function permittedOffsiteObjectKey(objectKey: string): { corpus: boolean; postgres: boolean } {
  return {
    corpus: /^articles\/\d{4}\/\d{2}\/\d{2}\/[a-zA-Z0-9_-]+\/[a-f0-9]{64}\.json$/.test(objectKey),
    postgres: /^_backups\/postgres\/\d{8}T\d{6}Z\/(part-\d{4}|manifest\.json)$/.test(objectKey),
  };
}

async function sha256Bytes(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function prunePostgresBackups(env: Env, retentionDays = 30): Promise<number> {
  const cutoff = Date.now() - retentionDays * 86400_000;
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const page = await env.ARTICLE_CORPUS.list({ prefix: "_backups/postgres/", limit: 1000, cursor });
    const expired = page.objects.filter((object) => object.uploaded.getTime() < cutoff).map((object) => object.key);
    if (expired.length) {
      await env.ARTICLE_CORPUS.delete(expired);
      deleted += expired.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}

async function storeOffsiteObject(request: Request, env: Env): Promise<Response> {
  if (!env.OFFSITE_BACKUP_TOKEN) return json({ error: "Off-site backup upload is not configured" }, { status: 503 });
  if (!offsiteUploadAuthorized(request, env)) return json({ error: "Unauthorized" }, { status: 401 });
  const objectKey = (request.headers.get("x-object-key") || "").trim();
  const { corpus: corpusObject, postgres: postgresObject } = permittedOffsiteObjectKey(objectKey);
  if (!corpusObject && !postgresObject) return json({ error: "Object key is not permitted" }, { status: 400 });
  const maxBytes = corpusObject ? 4 * 1024 * 1024 : 36 * 1024 * 1024;
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBytes) return json({ error: "Backup object is too large" }, { status: 413 });
  const body = await request.arrayBuffer();
  if (body.byteLength > maxBytes) return json({ error: "Backup object is too large" }, { status: 413 });
  const expectedHash = (request.headers.get("x-content-sha256") || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) return json({ error: "A SHA-256 digest is required" }, { status: 400 });
  const actualHash = await sha256Bytes(body);
  if (actualHash !== expectedHash) return json({ error: "Backup object hash does not match" }, { status: 400 });
  await env.ARTICLE_CORPUS.put(objectKey, body, {
    httpMetadata: { contentType: request.headers.get("content-type") || "application/octet-stream" },
    customMetadata: {
      contentSha256: actualHash,
      backupKind: corpusObject ? "article-corpus" : "postgres",
    },
  });
  const pruned = postgresObject && objectKey.endsWith("/manifest.json")
    ? await prunePostgresBackups(env)
    : 0;
  return json({ ok: true, object_key: objectKey, bytes: body.byteLength, content_sha256: actualHash, pruned });
}

async function retrieveOffsiteBackupObject(request: Request, env: Env): Promise<Response> {
  if (!env.OFFSITE_BACKUP_TOKEN) return json({ error: "Off-site backup retrieval is not configured" }, { status: 503 });
  if (!offsiteUploadAuthorized(request, env)) return json({ error: "Unauthorized" }, { status: 401 });
  const objectKey = (new URL(request.url).searchParams.get("key") || "").trim();
  const { postgres } = permittedOffsiteObjectKey(objectKey);
  if (!postgres) return json({ error: "Only PostgreSQL backup objects may be retrieved" }, { status: 400 });
  const object = await env.ARTICLE_CORPUS.get(objectKey);
  if (!object) return json({ error: "Backup object not found" }, { status: 404 });
  const headers = new Headers({
    "cache-control": "private, no-store",
    "content-length": String(object.size),
    "content-type": object.httpMetadata?.contentType || "application/octet-stream",
    "x-content-sha256": object.customMetadata?.contentSha256 || "",
    "x-object-key": objectKey,
  });
  return new Response(object.body, { status: 200, headers });
}

function validateDashboardSnapshot(value: unknown): DashboardSnapshot {
  if (!value || typeof value !== "object") throw new Error("Snapshot body must be an object");
  const snapshot = value as Partial<DashboardSnapshot>;
  if (snapshot.version !== 1) throw new Error("Unsupported snapshot version");
  const generatedAt = Date.parse(String(snapshot.generated_at || ""));
  if (!Number.isFinite(generatedAt)) throw new Error("Snapshot generated_at is invalid");
  if (generatedAt > Date.now() + 5 * 60 * 1000) throw new Error("Snapshot generated_at is in the future");
  if (!snapshot.responses || typeof snapshot.responses !== "object") throw new Error("Snapshot responses are missing");
  if (snapshot.response_count !== DASHBOARD_SNAPSHOT_KEYS.length) throw new Error("Snapshot response count is incomplete");
  for (const key of DASHBOARD_SNAPSHOT_KEYS) {
    const entry = snapshot.responses[key];
    if (!entry || typeof entry !== "object" || entry.status !== 200 || !("body" in entry)) {
      throw new Error(`Snapshot response ${key} is invalid`);
    }
  }
  if (!/^[a-f0-9]{64}$/.test(String(snapshot.content_sha256 || ""))) {
    throw new Error("Snapshot content hash is invalid");
  }
  return snapshot as DashboardSnapshot;
}

async function storeDashboardSnapshot(request: Request, env: Env): Promise<Response> {
  if (!env.SNAPSHOT_UPLOAD_TOKEN) return json({ error: "Snapshot upload is not configured" }, { status: 503 });
  if (!snapshotUploadAuthorized(request, env)) return json({ error: "Unauthorized" }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > DASHBOARD_SNAPSHOT_MAX_BYTES) return json({ error: "Snapshot is too large" }, { status: 413 });
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > DASHBOARD_SNAPSHOT_MAX_BYTES) {
    return json({ error: "Snapshot is too large" }, { status: 413 });
  }
  try {
    const snapshot = validateDashboardSnapshot(JSON.parse(body));
    const contentHash = await sha256Hex(JSON.stringify(snapshot.responses));
    if (contentHash !== snapshot.content_sha256) return json({ error: "Snapshot content hash does not match" }, { status: 400 });
    await env.ARTICLE_CORPUS.put(DASHBOARD_SNAPSHOT_OBJECT_KEY, JSON.stringify(snapshot), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: {
        generatedAt: snapshot.generated_at,
        contentSha256: snapshot.content_sha256,
        responseCount: String(snapshot.response_count),
      },
    });
    dashboardSnapshotCache = { loadedAt: Date.now(), snapshot };
    return json({
      ok: true,
      generated_at: snapshot.generated_at,
      response_count: snapshot.response_count,
      bytes: new TextEncoder().encode(body).byteLength,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

async function loadDashboardSnapshot(env: Env): Promise<DashboardSnapshot | null> {
  if (dashboardSnapshotCache && Date.now() - dashboardSnapshotCache.loadedAt < 30_000) {
    return dashboardSnapshotCache.snapshot;
  }
  const object = await env.ARTICLE_CORPUS.get(DASHBOARD_SNAPSHOT_OBJECT_KEY);
  if (!object) return null;
  try {
    const snapshot = validateDashboardSnapshot(JSON.parse(await object.text()));
    dashboardSnapshotCache = { loadedAt: Date.now(), snapshot };
    return snapshot;
  } catch (error) {
    console.error("Stored dashboard snapshot is invalid", error);
    return null;
  }
}

async function dashboardSnapshotStatus(env: Env): Promise<Response> {
  const snapshot = await loadDashboardSnapshot(env);
  if (!snapshot) return json({ ok: true, available: false });
  return json({
    ok: true,
    available: true,
    version: snapshot.version,
    generated_at: snapshot.generated_at,
    age_seconds: Math.max(0, Math.floor((Date.now() - Date.parse(snapshot.generated_at)) / 1000)),
    response_count: snapshot.response_count,
    content_sha256: snapshot.content_sha256,
  });
}

async function serveDashboardSnapshot(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  const key = DASHBOARD_SNAPSHOT_ROUTE_KEYS[url.pathname];
  if (!key) return null;
  const snapshot = await loadDashboardSnapshot(env);
  const entry = snapshot?.responses[key];
  if (!snapshot || !entry) return null;
  return new Response(JSON.stringify(entry.body), {
    status: entry.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "x-news-signal-mode": "snapshot",
      "x-news-signal-snapshot-at": snapshot.generated_at,
      warning: '110 - "Response is a stored offline snapshot"',
    },
  });
}

function selfHostedApiOrigin(env: Env): URL | null {
  const configured = String(env.SELF_HOSTED_API_ORIGIN || "").trim();
  if (!configured) return null;
  const origin = new URL(configured);
  const localDevelopmentOrigin = origin.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(origin.hostname);
  if (origin.protocol !== "https:" && !localDevelopmentOrigin) {
    throw new Error("SELF_HOSTED_API_ORIGIN must use HTTPS outside local development");
  }
  return origin;
}

function selfHostedApiConfigured(env: Env): boolean {
  const explicit = String(env.SELF_HOSTED_PROXY_ENABLED || "").trim();
  if (explicit) return /^(1|true|yes)$/i.test(explicit)
    && Boolean(env.SELF_HOSTED_API || String(env.SELF_HOSTED_API_ORIGIN || "").trim());
  return Boolean(String(env.SELF_HOSTED_API_ORIGIN || "").trim());
}

async function proxySelfHostedApi(request: Request, env: Env): Promise<Response> {
  const origin = selfHostedApiOrigin(env);
  if (!origin && !env.SELF_HOSTED_API) throw new Error("Self-hosted API origin is not configured");
  const requestedUrl = new URL(request.url);
  const target = origin
    ? new URL(requestedUrl.pathname + requestedUrl.search, origin)
    : new URL(requestedUrl.pathname + requestedUrl.search, "http://news-api:3000");
  const upstreamRequest = new Request(target.toString(), request);
  upstreamRequest.headers.set("x-forwarded-host", requestedUrl.host);
  if (env.SELF_HOSTED_API_TOKEN) {
    upstreamRequest.headers.set("authorization", `Bearer ${env.SELF_HOSTED_API_TOKEN}`);
  }
  if (env.TUNNEL_ACCESS_CLIENT_ID && env.TUNNEL_ACCESS_CLIENT_SECRET) {
    upstreamRequest.headers.set("cf-access-client-id", env.TUNNEL_ACCESS_CLIENT_ID);
    upstreamRequest.headers.set("cf-access-client-secret", env.TUNNEL_ACCESS_CLIENT_SECRET);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const upstream = env.SELF_HOSTED_API
      ? await env.SELF_HOSTED_API.fetch(upstreamRequest, { signal: controller.signal })
      : await fetch(upstreamRequest, { signal: controller.signal });
    if (upstream.status >= 500 && request.method === "GET") {
      const fallback = await serveDashboardSnapshot(request, env);
      if (fallback) return fallback;
    }
    if (upstream.status === 101) return upstream;
    const headers = new Headers(upstream.headers);
    headers.set("x-news-signal-mode", "live");
    headers.set("cache-control", "private, no-store");
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  } catch (error) {
    if (request.method === "GET") {
      const fallback = await serveDashboardSnapshot(request, env);
      if (fallback) return fallback;
    }
    console.error("Self-hosted API proxy failed", requestedUrl.pathname, error);
    return json({ error: "Live server unavailable and no stored response is available for this request" }, {
      status: 503,
      headers: { "retry-after": "30" },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function publishDashboardEvent(env: Env, event: DashboardEvent): Promise<void> {
  try {
    const id = env.DASHBOARD_EVENTS.idFromName("news-signal-dashboard");
    await env.DASHBOARD_EVENTS.get(id).fetch("https://dashboard-events.internal/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch (error) {
    console.error("Dashboard event publish failed", event.type, error);
  }
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
    CODEX_RESEARCH_MODEL: env.CODEX_RESEARCH_MODEL || "gpt-5.6-luna",
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

async function replacePersistedCodexAuth(env: Env, authJson: string): Promise<void> {
  if (!isCodexAuthJson(authJson)) throw new Error("The selected file is not a valid Codex auth.json file.");
  if (!env.CODEX_AUTH_STATE_KEY) throw new Error("CODEX_AUTH_STATE_KEY is not configured.");
  await persistCodexAuth(env, authJson);
  const persisted = await loadPersistedCodexAuth(env);
  if (!persisted) throw new Error("The replacement Codex authentication could not be verified.");
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
    });
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

async function fetchSource(source: Source): Promise<FeedFetchResult> {
  let lastError = "Feed fetch failed";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(source.url, {
        signal: AbortSignal.timeout(ARTICLE_FETCH_TIMEOUT_MS),
        headers: {
          "user-agent": "cartdotcom-news-signal-mvp/0.1",
          accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        },
      });
      if (response.ok) {
        const xml = await response.text();
        const items = parseFeed(xml, source);
        if (items.length) return { source: source.id, count: items.length, items };
        lastError = "No parseable RSS or Atom entries";
      } else {
        lastError = `HTTP ${response.status}`;
      }
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

async function enqueueArticles(
  db: D1Database,
  queue: Queue<ResearchJobMessage>,
  items: FeedItem[],
  checkedAt = Date.now(),
): Promise<{ inserted: number; acquiredUrls: Set<string>; duplicateUrls: Set<string> }> {
  const uniqueItems = [...new Map(items.map((item) => [item.url, item])).values()];
  const prepared = await Promise.all(
    uniqueItems.map(async (item) => ({
      ...item,
      articleId: await hashText(item.url),
      contentHash: await hashText(`${item.title}\n${item.summary || ""}`),
    })),
  );
  let inserted = 0;
  const acquiredUrls = new Set<string>();
  const duplicateUrls = new Set<string>();

  for (const group of chunks(prepared, 50)) {
    const insertResults = await db.batch(
      group.map((item) =>
        db
          .prepare(
            "INSERT OR IGNORE INTO articles (id, source_id, title, url, summary, published_at, discovered_at, content_hash, content_plaintext, content_source, content_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
          )
          .bind(
            item.articleId,
            item.source.id,
            item.title,
            item.url,
            item.summary,
            item.publishedAt,
            new Date(checkedAt).toISOString(),
            item.contentHash,
            item.contentPlaintext,
            item.contentPlaintext ? "feed" : null,
          ),
      ),
    );
    const newItems = group.filter((_item, index) => Boolean(insertResults[index]?.meta?.changes));
    const existingItems = group.filter((_item, index) => !insertResults[index]?.meta?.changes);
    for (const item of newItems) acquiredUrls.add(item.url);
    for (const item of existingItems) duplicateUrls.add(item.url);

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
  return { inserted, acquiredUrls, duplicateUrls };
}

async function recordFeedObservations(
  db: D1Database,
  fetched: FeedFetchResult[],
  checkId: string,
  checkedAtIso: string,
): Promise<void> {
  const stateRows = await db.prepare("SELECT source_id, initialized_at, last_feed_hash FROM feed_source_state").all<{ source_id: string; initialized_at: string; last_feed_hash: string | null }>();
  const initializedSources = new Map((stateRows.results || []).map((row) => [row.source_id, row]));
  const observationStatements: D1PreparedStatement[] = [];
  const stateStatements: D1PreparedStatement[] = [];

  for (const result of fetched) {
    if (result.error) {
      if (initializedSources.has(result.source)) {
        stateStatements.push(
          db.prepare("UPDATE feed_source_state SET last_checked_at = ?, last_error = ? WHERE source_id = ?")
            .bind(checkedAtIso, result.error.slice(0, 1000), result.source),
        );
      }
      continue;
    }

    const sourceState = initializedSources.get(result.source);
    const initializedAt = sourceState?.initialized_at || checkedAtIso;
    const initialized = initializedSources.has(result.source);
    const initializedEpoch = Date.parse(initializedAt);
    const uniqueItems = [...new Map(result.items.map((item) => [item.url, item])).values()];
    const feedHash = await hashText(uniqueItems.map((item) => item.url).sort().join("\n"));
    const changedItems = initialized && sourceState?.last_feed_hash === feedHash ? [] : uniqueItems;
    const prepared = await Promise.all(changedItems.map(async (item) => {
      const publishedAt = item.publishedAt ? Date.parse(item.publishedAt) : Number.NaN;
      const proposedDisposition = Number.isFinite(publishedAt)
        ? publishedAt >= initializedEpoch ? "pending" : initialized ? "stale" : "baseline"
        : initialized ? "pending" : "baseline";
      return {
        ...item,
        ledgerId: await hashText(`${item.source.id}\n${item.url}`),
        articleId: await hashText(item.url),
        proposedDisposition,
      };
    }));

    observationStatements.push(...prepared.map((item) => db.prepare(
        "INSERT OR IGNORE INTO feed_item_ledger (id, source_id, url, article_id, title, summary, content_plaintext, published_at, first_seen_at, first_check_id, disposition, acquired_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN EXISTS (SELECT 1 FROM articles WHERE id = ?) THEN 'duplicate' ELSE ? END, CASE WHEN EXISTS (SELECT 1 FROM articles WHERE id = ?) THEN CURRENT_TIMESTAMP ELSE NULL END)",
      ).bind(
        item.ledgerId,
        item.source.id,
        item.url,
        item.articleId,
        item.title,
        item.proposedDisposition === "baseline" ? null : item.summary,
        item.proposedDisposition === "baseline" ? null : item.contentPlaintext,
        item.publishedAt,
        checkedAtIso,
        checkId,
        item.articleId,
        item.proposedDisposition,
        item.articleId,
      )));

    stateStatements.push(
      db.prepare(
        "INSERT INTO feed_source_state (source_id, initialized_at, last_checked_at, last_success_at, last_item_count, last_feed_hash, last_error) VALUES (?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(source_id) DO UPDATE SET last_checked_at = excluded.last_checked_at, last_success_at = excluded.last_success_at, last_item_count = excluded.last_item_count, last_feed_hash = excluded.last_feed_hash, last_error = NULL",
      ).bind(result.source, checkedAtIso, checkedAtIso, checkedAtIso, uniqueItems.length, feedHash),
    );
  }

  for (const group of chunks(stateStatements, 50)) await db.batch(group);
  for (const group of chunks(observationStatements, 50)) await db.batch(group);
}

async function pendingFeedItems(db: D1Database): Promise<FeedItem[]> {
  const rows = await db.prepare(
    "SELECT id, source_id, url, title, summary, content_plaintext, published_at FROM feed_item_ledger WHERE disposition = 'pending' ORDER BY datetime(first_seen_at), id",
  ).all<FeedLedgerRow>();
  const sourceById = new Map(SOURCES.map((item) => [item.id, item]));
  return (rows.results || []).flatMap((row) => {
    const itemSource = sourceById.get(row.source_id);
    return itemSource ? [{
      source: itemSource,
      title: row.title,
      url: row.url,
      summary: row.summary,
      publishedAt: row.published_at,
      contentPlaintext: row.content_plaintext,
    }] : [];
  });
}

async function settleFeedLedger(
  db: D1Database,
  result: { acquiredUrls: Set<string>; duplicateUrls: Set<string> },
): Promise<void> {
  const urls = [...new Set([...result.acquiredUrls, ...result.duplicateUrls])];
  for (const group of chunks(urls, 50)) {
    await db.batch(group.map((url) => db.prepare(
      "UPDATE feed_item_ledger SET disposition = ?, acquired_at = COALESCE(acquired_at, CURRENT_TIMESTAMP), last_error = NULL WHERE url = ? AND disposition = 'pending'",
    ).bind(result.acquiredUrls.has(url) ? "acquired" : "duplicate", url)));
  }
}

async function recordSourceCheckDetails(
  db: D1Database,
  checkId: string,
  fetched: FeedFetchResult[],
): Promise<void> {
  const ledger = await db.prepare(
    "SELECT source_id, COUNT(*) AS new_item_count, SUM(CASE WHEN disposition = 'acquired' THEN 1 ELSE 0 END) AS acquired_count, SUM(CASE WHEN disposition = 'duplicate' THEN 1 ELSE 0 END) AS duplicate_count, SUM(CASE WHEN disposition = 'baseline' THEN 1 ELSE 0 END) AS baseline_count, SUM(CASE WHEN disposition = 'stale' THEN 1 ELSE 0 END) AS stale_count, SUM(CASE WHEN disposition = 'pending' THEN 1 ELSE 0 END) AS pending_count FROM feed_item_ledger WHERE first_check_id = ? GROUP BY source_id",
  )
    .bind(checkId)
    .all<Record<string, number | string>>();
  const bySource = new Map((ledger.results || []).map((row) => [String(row.source_id), row]));
  await db.batch(fetched.map((result) => {
    const row = bySource.get(result.source);
    return db.prepare(
      "INSERT OR REPLACE INTO source_check_details (check_id, source_id, fetched_item_count, new_item_count, acquired_count, duplicate_count, baseline_count, stale_count, pending_count, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      checkId,
      result.source,
      result.count,
      Number(row?.new_item_count || 0),
      Number(row?.acquired_count || 0),
      Number(row?.duplicate_count || 0),
      Number(row?.baseline_count || 0),
      Number(row?.stale_count || 0),
      Number(row?.pending_count || 0),
      result.error || null,
    );
  }));
}

async function ingestFeeds(env: Env, scheduledAt?: number): Promise<{
  fetched: unknown[];
  inserted: number;
  checked_at: string;
  completed_at: string;
  duration_seconds: number;
  source_count: number;
  failed_source_count: number;
}> {
  await ensureArticleStorageSchema(env.NEWS_DB);
  await seedSources(env.NEWS_DB);
  const startedAt = Date.now();
  const checkedAt = scheduledAt ?? startedAt;
  const checkId = crypto.randomUUID();
  const checkedAtIso = new Date(checkedAt).toISOString();
  const fetched = await mapWithConcurrency(SOURCES, 12, fetchSource);
  await recordFeedObservations(env.NEWS_DB, fetched, checkId, checkedAtIso);
  const pendingItems = await pendingFeedItems(env.NEWS_DB);
  const enqueueResult = await enqueueArticles(env.NEWS_DB, env.RESEARCH_QUEUE, pendingItems, checkedAt);
  await settleFeedLedger(env.NEWS_DB, enqueueResult);
  await recordSourceCheckDetails(env.NEWS_DB, checkId, fetched);
  const inserted = enqueueResult.inserted;
  const completedAt = Date.now();
  const completedAtIso = new Date(completedAt).toISOString();
  const durationSeconds = Math.max(0, Math.round((completedAt - startedAt) / 1000));
  const failedSourceCount = fetched.filter((result) => Boolean(result.error)).length;
  await env.NEWS_DB.prepare(
    "INSERT INTO source_checks (id, checked_at, completed_at, duration_seconds, acquired_count, source_count, failed_source_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(checkId, checkedAtIso, completedAtIso, durationSeconds, inserted, fetched.length, failedSourceCount)
    .run();
  await refreshSourceHourlyMetric(env.NEWS_DB, checkedAtIso);
  await publishDashboardEvent(env, {
    type: "source_check_completed",
    at: checkedAtIso,
    acquired_count: inserted,
    source_count: fetched.length,
    failed_source_count: failedSourceCount,
  });
  return {
    fetched: fetched.map(({ items: _items, ...rest }) => rest),
    inserted,
    checked_at: checkedAtIso,
    completed_at: completedAtIso,
    duration_seconds: durationSeconds,
    source_count: fetched.length,
    failed_source_count: failedSourceCount,
  };
}

function normalizePlaintextWithLimit(value: string, maxChars: number): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}

function normalizePlaintext(value: string): string {
  return normalizePlaintextWithLimit(value, ARTICLE_CONTENT_MAX_CHARS);
}

function normalizeCorpusPlaintext(value: string): string {
  return normalizePlaintextWithLimit(value, ARTICLE_CORPUS_MAX_CHARS);
}

function stripHtmlToPlaintext(value: string): string {
  const withoutNonContent = value
    .replace(/<(script|style|svg|nav|footer|header|aside|form|noscript|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|section|article|main|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ");
  return normalizeCorpusPlaintext(decodeHtmlEntities(withoutNonContent));
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
  if (typeof record.articleBody === "string" && record.articleBody.trim().length >= 120) return normalizeCorpusPlaintext(record.articleBody);
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
  const paragraphText = normalizeCorpusPlaintext(paragraphs.join("\n\n"));
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
  if (body.length > 3_000_000) throw new Error("Article response exceeded the 3 MB extraction limit");
  if (/just a moment|verify you are human|enable javascript and cookies|access denied/i.test(body.slice(0, 8_000))) {
    throw new Error("Article page returned an access or browser-verification screen");
  }
  const contentType = response.headers.get("content-type") || "";
  const plaintext = contentType.includes("text/plain") ? normalizeCorpusPlaintext(body) : extractArticlePlaintext(body);
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
    const content = normalizePlaintext(useFetchedText ? fetchedText : existingText);
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

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function corpusDatePath(value: string | null | undefined): string {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "undated";
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0")].join("/");
}

function corpusArticleId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "article";
}

async function markArticleCorpusPending(db: D1Database, articleId: string): Promise<void> {
  await db.prepare(
    `INSERT INTO article_corpus_objects (article_id, storage_status, schema_version, extraction_version)
    VALUES (?, 'pending', ?, ?)
    ON CONFLICT(article_id) DO UPDATE SET
      storage_status = 'pending', schema_version = excluded.schema_version,
      extraction_version = excluded.extraction_version, last_error = NULL, updated_at = CURRENT_TIMESTAMP`,
  ).bind(articleId, ARTICLE_CORPUS_SCHEMA_VERSION, ARTICLE_EXTRACTION_VERSION).run();
}

async function corpusArticleRow(db: D1Database, articleId: string): Promise<ArticleCorpusRow | null> {
  return db.prepare(
    `SELECT articles.id, articles.source_id, articles.title, articles.url, articles.summary,
      articles.published_at, articles.discovered_at, articles.content_plaintext, articles.content_source,
      articles.content_status, articles.content_fetched_at, articles.content_fetch_attempts, articles.content_error,
      sources.name AS source_name, sources.source_type, sources.category AS source_category,
      sources.weight AS source_weight, research_jobs.id AS research_job_id,
      research_jobs.finished_at AS research_job_finished_at, research_results.id AS research_result_id,
      research_results.created_at AS research_result_created_at, research_results.event_type,
      research_results.companies, research_results.industries, research_results.symbols,
      research_results.sentiment_score, research_results.impact_horizon, research_results.confidence,
      research_results.summary AS analysis_summary, research_results.memo
    FROM articles
    LEFT JOIN sources ON sources.id = articles.source_id
    INNER JOIN research_jobs ON research_jobs.article_id = articles.id AND research_jobs.status = 'succeeded'
    LEFT JOIN research_results ON research_results.job_id = research_jobs.id
    WHERE articles.id = ?
    ORDER BY datetime(research_results.created_at) DESC
    LIMIT 1`,
  ).bind(articleId).first<ArticleCorpusRow>();
}

async function recordArticleCorpusFailure(db: D1Database, articleId: string, error: unknown): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  await db.prepare(
    `INSERT INTO article_corpus_objects (article_id, storage_status, storage_attempts, schema_version, extraction_version, last_attempt_at, last_error)
    VALUES (?, 'failed', 1, ?, ?, CURRENT_TIMESTAMP, ?)
    ON CONFLICT(article_id) DO UPDATE SET storage_status = 'failed',
      storage_attempts = article_corpus_objects.storage_attempts + 1,
      schema_version = excluded.schema_version, extraction_version = excluded.extraction_version,
      last_attempt_at = CURRENT_TIMESTAMP, last_error = excluded.last_error, updated_at = CURRENT_TIMESTAMP`,
  ).bind(articleId, ARTICLE_CORPUS_SCHEMA_VERSION, ARTICLE_EXTRACTION_VERSION, message).run();
}

async function archiveArticleCorpus(env: Env, articleId: string): Promise<{ article_id: string; status: "stored" | "failed"; object_key?: string; error?: string }> {
  try {
    const article = await corpusArticleRow(env.NEWS_DB, articleId);
    if (!article) throw new Error("Completed article or research result was not found");

    let plaintext = normalizeCorpusPlaintext(article.content_plaintext || article.summary || "");
    let corpusContentSource = article.content_source || (plaintext ? "feed" : "missing");
    let corpusContentError = article.content_error;
    let refetchedFullText = false;
    if (plaintext.length >= ARTICLE_CONTENT_MAX_CHARS && article.content_source === "webpage") {
      try {
        const fetched = await fetchArticlePlaintext(article.url);
        if (fetched.length >= plaintext.length) {
          plaintext = fetched;
          corpusContentSource = "webpage_refetch";
          corpusContentError = null;
          refetchedFullText = true;
        }
      } catch (error) {
        corpusContentError = `Full-text corpus refetch failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000);
      }
    }

    const contentSha256 = await sha256Hex(plaintext);
    const storedAt = new Date().toISOString();
    const contentTruncated = plaintext.length >= ARTICLE_CORPUS_MAX_CHARS || (plaintext.length >= ARTICLE_CONTENT_MAX_CHARS && !refetchedFullText);
    const document = {
      schema_version: ARTICLE_CORPUS_SCHEMA_VERSION,
      extraction_version: ARTICLE_EXTRACTION_VERSION,
      stored_at: storedAt,
      article: {
        id: article.id,
        title: article.title,
        url: article.url,
        summary: article.summary,
        published_at: article.published_at,
        discovered_at: article.discovered_at,
      },
      source: {
        id: article.source_id,
        name: article.source_name || article.source_id,
        type: article.source_type || "editorial",
        category: article.source_category,
        weight: article.source_weight ?? null,
      },
      content: {
        plaintext: plaintext || null,
        sha256: contentSha256,
        characters: plaintext.length,
        source: corpusContentSource,
        status: article.content_status,
        fetched_at: article.content_fetched_at,
        fetch_attempts: Number(article.content_fetch_attempts || 0),
        error: corpusContentError,
        truncated: contentTruncated,
      },
      analysis: article.research_result_id ? {
        research_job_id: article.research_job_id,
        research_result_id: article.research_result_id,
        synthesized_at: article.research_result_created_at || article.research_job_finished_at,
        event_type: article.event_type,
        companies: parseJsonArray(article.companies),
        industries: parseJsonArray(article.industries),
        symbols: parseJsonArray(article.symbols),
        sentiment_score: article.sentiment_score,
        impact_horizon: article.impact_horizon,
        confidence: article.confidence,
        summary: article.analysis_summary,
        memo: article.memo,
      } : null,
    };
    const encoded = new TextEncoder().encode(JSON.stringify(document));
    const objectKey = `articles/${corpusDatePath(article.published_at || article.discovered_at)}/${corpusArticleId(article.id)}/${contentSha256}.json`;
    await env.ARTICLE_CORPUS.put(objectKey, encoded, {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: {
        article_id: article.id,
        source_id: article.source_id,
        content_sha256: contentSha256,
        schema_version: String(ARTICLE_CORPUS_SCHEMA_VERSION),
        extraction_version: ARTICLE_EXTRACTION_VERSION,
      },
    });
    await env.NEWS_DB.prepare(
      `INSERT INTO article_corpus_objects (article_id, object_key, content_sha256, content_chars, object_bytes,
        storage_status, storage_attempts, schema_version, extraction_version, stored_at, last_attempt_at, last_error, updated_at)
      VALUES (?, ?, ?, ?, ?, 'stored', 1, ?, ?, ?, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP)
      ON CONFLICT(article_id) DO UPDATE SET object_key = excluded.object_key,
        content_sha256 = excluded.content_sha256, content_chars = excluded.content_chars,
        object_bytes = excluded.object_bytes, storage_status = 'stored',
        storage_attempts = article_corpus_objects.storage_attempts + 1,
        schema_version = excluded.schema_version, extraction_version = excluded.extraction_version,
        stored_at = excluded.stored_at, last_attempt_at = CURRENT_TIMESTAMP,
        last_error = NULL, updated_at = CURRENT_TIMESTAMP`,
    ).bind(
      article.id,
      objectKey,
      contentSha256,
      plaintext.length,
      encoded.byteLength,
      ARTICLE_CORPUS_SCHEMA_VERSION,
      ARTICLE_EXTRACTION_VERSION,
      storedAt,
    ).run();
    return { article_id: article.id, status: "stored", object_key: objectKey };
  } catch (error) {
    await recordArticleCorpusFailure(env.NEWS_DB, articleId, error).catch(() => undefined);
    return { article_id: articleId, status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

async function archiveArticleCorpusBatch(env: Env, limit = ARTICLE_CORPUS_BACKFILL_BATCH): Promise<{
  attempted: number;
  stored: number;
  failed: number;
  remaining: number;
  exhausted: number;
}> {
  const clamped = Math.min(Math.max(limit, 1), 100);
  const rows = await env.NEWS_DB.prepare(
    `SELECT articles.id
    FROM articles
    LEFT JOIN article_corpus_objects ON article_corpus_objects.article_id = articles.id
    WHERE EXISTS (SELECT 1 FROM research_jobs WHERE research_jobs.article_id = articles.id AND research_jobs.status = 'succeeded')
      AND (article_corpus_objects.article_id IS NULL
        OR article_corpus_objects.storage_status = 'pending'
        OR (article_corpus_objects.storage_status = 'failed' AND article_corpus_objects.storage_attempts < ?)
        OR (article_corpus_objects.storage_status = 'stored' AND (
          article_corpus_objects.schema_version < ? OR article_corpus_objects.extraction_version != ?
        )))
    ORDER BY CASE WHEN article_corpus_objects.storage_status = 'pending' THEN 0
      WHEN article_corpus_objects.article_id IS NULL THEN 1 ELSE 2 END,
      datetime((SELECT MAX(research_jobs.finished_at) FROM research_jobs WHERE research_jobs.article_id = articles.id AND research_jobs.status = 'succeeded')) DESC
    LIMIT ?`,
  ).bind(ARTICLE_CORPUS_MAX_ATTEMPTS, ARTICLE_CORPUS_SCHEMA_VERSION, ARTICLE_EXTRACTION_VERSION, clamped).all<{ id: string }>();
  const archived = await mapWithConcurrency(rows.results || [], 6, (row) => archiveArticleCorpus(env, row.id));
  const [remaining, exhausted] = await Promise.all([
    env.NEWS_DB.prepare(
      `SELECT COUNT(*) AS count
      FROM articles
      LEFT JOIN article_corpus_objects ON article_corpus_objects.article_id = articles.id
      WHERE EXISTS (SELECT 1 FROM research_jobs WHERE research_jobs.article_id = articles.id AND research_jobs.status = 'succeeded')
        AND (article_corpus_objects.article_id IS NULL
          OR article_corpus_objects.storage_status != 'stored'
          OR article_corpus_objects.schema_version < ?
          OR article_corpus_objects.extraction_version != ?)`,
    ).bind(ARTICLE_CORPUS_SCHEMA_VERSION, ARTICLE_EXTRACTION_VERSION).first<{ count: number }>(),
    env.NEWS_DB.prepare(
      `SELECT COUNT(*) AS count
    FROM articles
      INNER JOIN article_corpus_objects ON article_corpus_objects.article_id = articles.id
      WHERE EXISTS (SELECT 1 FROM research_jobs WHERE research_jobs.article_id = articles.id AND research_jobs.status = 'succeeded')
        AND article_corpus_objects.storage_status = 'failed'
        AND article_corpus_objects.storage_attempts >= ?`,
    ).bind(ARTICLE_CORPUS_MAX_ATTEMPTS).first<{ count: number }>(),
  ]);
  return {
    attempted: archived.length,
    stored: archived.filter((item) => item.status === "stored").length,
    failed: archived.filter((item) => item.status === "failed").length,
    remaining: Number(remaining?.count || 0),
    exhausted: Number(exhausted?.count || 0),
  };
}

async function articleCorpusStatus(db: D1Database): Promise<Record<string, unknown>> {
  const [processed, statuses, totals, latest] = await Promise.all([
    db.prepare("SELECT COUNT(DISTINCT article_id) AS count FROM research_jobs WHERE status = 'succeeded'").first<{ count: number }>(),
    db.prepare("SELECT storage_status AS status, COUNT(*) AS count FROM article_corpus_objects GROUP BY storage_status").all(),
    db.prepare("SELECT COUNT(*) AS objects, COALESCE(SUM(content_chars), 0) AS content_chars, COALESCE(SUM(object_bytes), 0) AS object_bytes FROM article_corpus_objects WHERE storage_status = 'stored'").first(),
    db.prepare("SELECT article_corpus_objects.*, articles.title, articles.url FROM article_corpus_objects INNER JOIN articles ON articles.id = article_corpus_objects.article_id WHERE article_corpus_objects.storage_status = 'stored' ORDER BY datetime(article_corpus_objects.stored_at) DESC LIMIT 1").first(),
  ]);
  return {
    processed_articles: Number(processed?.count || 0),
    statuses: statuses.results || [],
    totals: totals || { objects: 0, content_chars: 0, object_bytes: 0 },
    latest: latest || null,
    schema_version: ARTICLE_CORPUS_SCHEMA_VERSION,
    extraction_version: ARTICLE_EXTRACTION_VERSION,
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

async function runContainerResearch(
  env: Env,
  prompt: string,
  researchSlot: number,
  options: { model?: string; reasoningEffort?: string } = {},
): Promise<string> {
  const container = getContainer(env.CODEX_CONTAINER, `instance-${researchSlot}`);
  await startWithSecrets(container, env);
  const response = await container.fetch(
    new Request("https://container.local/research-internal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        timeout_seconds: 300,
        model: options.model || undefined,
        reasoning_effort: options.reasoningEffort || env.CODEX_RESEARCH_REASONING_EFFORT || "medium",
      }),
    }),
  );
  const payload = (await response.json()) as { ok?: boolean; memo?: string; error?: string; auth_json?: string };
  if (!response.ok || !payload.ok || !payload.memo) {
    const message = payload.error || `Container research failed with HTTP ${response.status}`;
    if (isCodexAuthRefreshFailure(message)) {
      await container.destroy().catch((error: unknown) => console.error(`Failed to recycle research container ${researchSlot}`, error));
      throw new CodexAuthRefreshError(message);
    }
    throw new Error(message);
  }
  await persistCodexAuth(env, payload.auth_json).catch((error) => console.error("Failed to persist refreshed Codex auth", error));
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
  await ensureModelExperimentSchema(env.NEWS_DB);
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

  const activeExperiment = await env.NEWS_DB.prepare(
    "SELECT COUNT(*) AS count FROM model_experiments WHERE status = 'running'",
  ).first<{ count: number }>();
  const isNewFirstPass = existing.prediction_delay_eligible === 1 && !existing.has_result;
  const productionConcurrency = Number(activeExperiment?.count || 0) > 0 && !isNewFirstPass
    ? RESEARCH_CONTAINER_COUNT - MODEL_EXPERIMENT_MAX_CONCURRENCY
    : RESEARCH_CONTAINER_COUNT;

  const acquired = await env.NEWS_DB.prepare(
    "UPDATE research_jobs SET status = 'running', attempts = attempts + 1, last_error = NULL, started_at = CURRENT_TIMESTAMP, finished_at = NULL, synthesis_duration_seconds = NULL, prediction_delay_seconds = NULL, research_slot = (SELECT CAST(value AS INTEGER) FROM json_each('[0,1,2,3,4,5,6,7]') AS slots WHERE NOT EXISTS (SELECT 1 FROM research_jobs AS active_slots WHERE active_slots.status = 'running' AND active_slots.research_slot = CAST(slots.value AS INTEGER)) AND NOT EXISTS (SELECT 1 FROM model_experiment_jobs AS experiment_slots WHERE experiment_slots.status = 'running' AND experiment_slots.research_slot = CAST(slots.value AS INTEGER)) ORDER BY CAST(value AS INTEGER) LIMIT 1) WHERE id = ? AND status = 'pending' AND (SELECT COUNT(*) FROM research_jobs AS active_jobs WHERE active_jobs.status = 'running') < ? AND ((SELECT COUNT(*) FROM research_jobs AS active_jobs WHERE active_jobs.status = 'running') + (SELECT COUNT(*) FROM model_experiment_jobs AS active_experiments WHERE active_experiments.status = 'running')) < ? AND (? = 0 OR NOT EXISTS (SELECT 1 FROM research_jobs AS first_pass_jobs WHERE first_pass_jobs.status = 'pending' AND NOT EXISTS (SELECT 1 FROM research_results WHERE research_results.job_id = first_pass_jobs.id)))",
  )
    .bind(jobId, productionConcurrency, RESEARCH_CONTAINER_COUNT, existing.has_result ? 1 : 0)
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
    await publishDashboardEvent(env, { type: "research_failed", at: new Date().toISOString(), job_id: jobId });
    return { ok: false, jobId, skipped: "article_missing" };
  }

  await publishDashboardEvent(env, {
    type: "research_started",
    at: new Date().toISOString(),
    job_id: jobId,
    article_id: article.id,
  });

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
      ).bind(existing.prediction_delay_eligible === 1 ? 1 : 0, jobId),
      env.NEWS_DB.prepare("UPDATE articles SET status = ? WHERE id = ?").bind(symbols.length ? "analyzed" : "archived", article.id),
    ]);
    await markArticleCorpusPending(env.NEWS_DB, article.id).catch((error) =>
      console.error("Failed to mark completed article for corpus storage", error),
    );
    await ensurePredictionOutcomeTables(env);
    await env.NEWS_DB.batch([
      env.NEWS_DB.prepare("DELETE FROM prediction_outcome_scans WHERE result_id = (SELECT id FROM research_results WHERE job_id = ?)").bind(jobId),
      env.NEWS_DB.prepare("DELETE FROM prediction_outcomes WHERE result_id = (SELECT id FROM research_results WHERE job_id = ?)").bind(jobId),
    ]);
    await refreshSourceHourlyMetricForArticle(env.NEWS_DB, article.id);
    await publishDashboardEvent(env, {
      type: "research_completed",
      at: new Date().toISOString(),
      job_id: jobId,
      article_id: article.id,
    });
    return { ok: true, jobId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof CodexAuthRefreshError || isCodexAuthRefreshFailure(error)) {
      await env.NEWS_DB.prepare(
        "UPDATE research_jobs SET status = 'pending', attempts = MAX(0, attempts - 1), last_error = ?, started_at = NULL, finished_at = CURRENT_TIMESTAMP, synthesis_duration_seconds = NULL, prediction_delay_seconds = NULL, research_slot = NULL WHERE id = ?",
      )
        .bind(`Deferred until Codex authentication is refreshed: ${message}`.slice(0, 1000), jobId)
        .run();
      await publishDashboardEvent(env, {
        type: "research_deferred",
        at: new Date().toISOString(),
        job_id: jobId,
        article_id: article.id,
      });
      throw new ResearchBusyError("Codex authentication refresh is pending");
    }
    if (isTransientContainerCapacityError(error)) {
      await env.NEWS_DB.prepare(
        "UPDATE research_jobs SET status = 'pending', attempts = MAX(0, attempts - 1), last_error = ?, started_at = NULL, finished_at = CURRENT_TIMESTAMP, synthesis_duration_seconds = NULL, prediction_delay_seconds = NULL, research_slot = NULL WHERE id = ?",
      )
        .bind(`Deferred after transient container-capacity error: ${message}`.slice(0, 1000), jobId)
        .run();
      await publishDashboardEvent(env, {
        type: "research_deferred",
        at: new Date().toISOString(),
        job_id: jobId,
        article_id: article.id,
      });
      throw new ResearchBusyError(message);
    }
    await env.NEWS_DB.batch([
      env.NEWS_DB.prepare(
        "UPDATE research_jobs SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END, last_error = ?, finished_at = CURRENT_TIMESTAMP, synthesis_duration_seconds = CASE WHEN attempts >= 3 THEN MAX(0, unixepoch(CURRENT_TIMESTAMP) - unixepoch(started_at)) ELSE NULL END, prediction_delay_seconds = NULL, research_slot = NULL WHERE id = ?",
      ).bind(message.slice(0, 1000), jobId),
      env.NEWS_DB.prepare(
        "UPDATE articles SET status = 'archived' WHERE id = ? AND EXISTS (SELECT 1 FROM research_jobs WHERE research_jobs.id = ? AND research_jobs.status = 'failed')",
      ).bind(article.id, jobId),
    ]);
    await publishDashboardEvent(env, {
      type: "research_failed",
      at: new Date().toISOString(),
      job_id: jobId,
      article_id: article.id,
    });
    throw error;
  }
}

function modelExperimentCalls(
  fields: ResearchResultFields,
  fallbackSymbols: string[] = [],
): ModelExperimentCall[] {
  const bySymbol = new Map<string, ModelExperimentCall>();
  for (const detail of normalizeImpactDetails(fields.impact_details)) {
    const symbol = normalizeTicker(detail.symbol || "");
    if (!symbol || (detail.direction !== "bullish" && detail.direction !== "bearish")) continue;
    const confidence = typeof detail.confidence === "number"
      ? Math.max(0, Math.min(1, detail.confidence))
      : typeof fields.confidence === "number"
        ? Math.max(0, Math.min(1, fields.confidence))
        : null;
    const call = { symbol, direction: detail.direction, confidence, reason: detail.reason || null } satisfies ModelExperimentCall;
    const existing = bySymbol.get(symbol);
    if (!existing || (call.confidence ?? -1) > (existing.confidence ?? -1)) bySymbol.set(symbol, call);
  }
  if (!bySymbol.size && typeof fields.sentiment_score === "number" && Math.abs(fields.sentiment_score) >= 0.05) {
    const direction = fields.sentiment_score > 0 ? "bullish" : "bearish";
    for (const value of fallbackSymbols) {
      const symbol = normalizeTicker(value);
      if (symbol) bySymbol.set(symbol, {
        symbol,
        direction,
        confidence: typeof fields.confidence === "number" ? Math.max(0, Math.min(1, fields.confidence)) : null,
        reason: null,
      });
    }
  }
  return [...bySymbol.values()].sort((left, right) => left.symbol.localeCompare(right.symbol));
}

function modelExperimentReferenceCalls(row: ResearchResultRow): ModelExperimentCall[] {
  const fields = parseResearchFields(row.memo || "");
  if (typeof fields.sentiment_score !== "number" && typeof row.sentiment_score === "number") fields.sentiment_score = row.sentiment_score;
  if (typeof fields.confidence !== "number" && typeof row.confidence === "number") fields.confidence = row.confidence;
  return modelExperimentCalls(fields, parseJsonArray(row.symbols));
}

async function startModelExperiment(env: Env, emailTo: string | null): Promise<Record<string, unknown>> {
  await ensureModelExperimentSchema(env.NEWS_DB);
  const active = await env.NEWS_DB.prepare(
    "SELECT id, status FROM model_experiments WHERE status IN ('preparing', 'running', 'reporting') ORDER BY datetime(created_at) DESC LIMIT 1",
  ).first<{ id: string; status: string }>();
  if (active) throw new Error(`Experiment ${active.id} is already ${active.status}.`);

  const candidates = await env.NEWS_DB.prepare(
    `SELECT articles.id, articles.source_id, articles.title, articles.url, articles.summary, articles.published_at,
      articles.discovered_at, articles.content_plaintext, articles.content_source, articles.content_status,
      articles.content_fetched_at, articles.content_fetch_attempts, articles.content_error,
      sources.name AS source_name, sources.source_type, sources.weight AS source_weight,
      research_results.id AS reference_result_id, research_results.symbols AS reference_symbols,
      research_results.sentiment_score AS reference_sentiment_score,
      research_results.confidence AS reference_confidence, research_results.memo AS reference_memo,
      research_results.created_at AS reference_created_at
    FROM articles
    LEFT JOIN sources ON sources.id = articles.source_id
    INNER JOIN research_results ON research_results.id = (
      SELECT latest.id FROM research_results AS latest
      WHERE latest.article_id = articles.id ORDER BY datetime(latest.created_at) DESC LIMIT 1
    )
    WHERE articles.published_at IS NOT NULL
      AND datetime(articles.published_at) <= datetime('now', '-10 days')
      AND length(COALESCE(articles.content_plaintext, articles.summary, '')) >= 500
      AND EXISTS (SELECT 1 FROM research_jobs WHERE research_jobs.article_id = articles.id AND research_jobs.status = 'succeeded')
    ORDER BY articles.id
    LIMIT ?`,
  ).bind(MODEL_EXPERIMENT_SAMPLE_SIZE).all<Article & {
    reference_result_id: string;
    reference_symbols: string | null;
    reference_sentiment_score: number | null;
    reference_confidence: number | null;
    reference_memo: string;
    reference_created_at: string;
  }>();
  const rows = candidates.results || [];
  if (rows.length !== MODEL_EXPERIMENT_SAMPLE_SIZE) {
    throw new Error(`Only ${rows.length} eligible matured articles are available; ${MODEL_EXPERIMENT_SAMPLE_SIZE} are required.`);
  }

  const experimentId = crypto.randomUUID();
  const recipient = emailTo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo) ? emailTo : null;
  await env.NEWS_DB.prepare(
    "INSERT INTO model_experiments (id, status, sample_size, phase, phase_1_model, phase_1_effort, phase_2_model, phase_2_effort, email_to, started_at) VALUES (?, 'preparing', ?, 1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
  ).bind(
    experimentId,
    MODEL_EXPERIMENT_SAMPLE_SIZE,
    MODEL_EXPERIMENT_PHASES[0].model,
    MODEL_EXPERIMENT_PHASES[0].reasoningEffort,
    MODEL_EXPERIMENT_PHASES[1].model,
    MODEL_EXPERIMENT_PHASES[1].reasoningEffort,
    recipient || env.EXPERIMENT_REPORT_EMAIL_TO || null,
  ).run();

  for (let offset = 0; offset < rows.length; offset += 25) {
    const group = rows.slice(offset, offset + 25);
    const promptHashes = await Promise.all(group.map((row) => hashText(researchPrompt(row))));
    const statements: D1PreparedStatement[] = [];
    for (let index = 0; index < group.length; index += 1) {
      const row = group[index];
      const ordinal = offset + index + 1;
      const promptHash = promptHashes[index];
      const referenceRow: ResearchResultRow = {
        id: row.reference_result_id,
        article_id: row.id,
        title: row.title,
        url: row.url,
        published_at: row.published_at,
        created_at: row.reference_created_at,
        symbols: row.reference_symbols,
        sentiment_score: row.reference_sentiment_score,
        confidence: row.reference_confidence,
        event_type: null,
        summary: null,
        memo: row.reference_memo,
      };
      statements.push(env.NEWS_DB.prepare(
        "INSERT INTO model_experiment_samples (experiment_id, article_id, sample_ordinal, input_hash, reference_result_id, reference_calls_json) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(experimentId, row.id, ordinal, promptHash, row.reference_result_id, JSON.stringify(modelExperimentReferenceCalls(referenceRow))));
      for (const phase of MODEL_EXPERIMENT_PHASES) {
        statements.push(env.NEWS_DB.prepare(
          "INSERT INTO model_experiment_jobs (id, experiment_id, article_id, sample_ordinal, phase, model, reasoning_effort, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')",
        ).bind(crypto.randomUUID(), experimentId, row.id, ordinal, phase.phase, phase.model, phase.reasoningEffort));
      }
    }
    await env.NEWS_DB.batch(statements);
  }
  await env.NEWS_DB.prepare(
    "UPDATE model_experiments SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).bind(experimentId).run();
  const dispatch = await advanceModelExperiment(env, experimentId);
  return { experiment_id: experimentId, sample_size: rows.length, phase: 1, ...dispatch };
}

async function ensureModelExperimentPrice(
  env: Env,
  experimentId: string,
  article: Article,
  symbol: string,
): Promise<void> {
  const existing = await env.NEWS_DB.prepare(
    "SELECT status FROM model_experiment_prices WHERE experiment_id = ? AND article_id = ? AND symbol = ?",
  ).bind(experimentId, article.id, symbol).first<{ status: string }>();
  if (existing?.status === "stored" || existing?.status === "failed") return;
  await env.NEWS_DB.prepare(
    "INSERT OR IGNORE INTO model_experiment_prices (experiment_id, article_id, symbol, status) VALUES (?, ?, ?, 'pending')",
  ).bind(experimentId, article.id, symbol).run();
  const predictionAt = normalizeDate(article.published_at) || normalizeDate(article.discovered_at);
  if (!predictionAt) return;
  try {
    const chart = await fetchYahooChart(symbol, predictionAt, "1h", 12);
    const baseline = nearestPoint(chart.timestamps, chart.closes, unixSeconds(predictionAt), "after", false);
    if (!baseline || !baseline.price) throw new Error("No baseline market price was available");
    const targets = predictionIntervalTargets(predictionAt);
    const intervals = Object.fromEntries(MODEL_EXPERIMENT_INTERVALS.map((label) => {
      const point = nearestElapsedPoint(chart.timestamps, chart.closes, targets[label]);
      return [label, {
        at: point ? isoFromUnix(point.at) : isoFromUnix(targets[label]),
        price: point?.price ?? null,
        change_pct: point ? ((point.price - baseline.price) / baseline.price) * 100 : null,
      }];
    }));
    await env.NEWS_DB.prepare(
      "UPDATE model_experiment_prices SET status = 'stored', baseline_price = ?, baseline_at = ?, intervals_json = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE experiment_id = ? AND article_id = ? AND symbol = ?",
    ).bind(baseline.price, isoFromUnix(baseline.at), JSON.stringify(intervals), experimentId, article.id, symbol).run();
  } catch (error) {
    await env.NEWS_DB.prepare(
      "UPDATE model_experiment_prices SET status = 'failed', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE experiment_id = ? AND article_id = ? AND symbol = ?",
    ).bind((error instanceof Error ? error.message : String(error)).slice(0, 500), experimentId, article.id, symbol).run();
  }
}

async function processModelExperimentJob(
  env: Env,
  jobId: string,
): Promise<{ ok: boolean; jobId: string; skipped?: string }> {
  await ensureModelExperimentSchema(env.NEWS_DB);
  const job = await env.NEWS_DB.prepare(
    `SELECT model_experiment_jobs.*, model_experiments.status AS experiment_status,
      model_experiments.phase AS experiment_phase, model_experiment_samples.input_hash AS expected_input_hash
    FROM model_experiment_jobs
    INNER JOIN model_experiments ON model_experiments.id = model_experiment_jobs.experiment_id
    INNER JOIN model_experiment_samples ON model_experiment_samples.experiment_id = model_experiment_jobs.experiment_id
      AND model_experiment_samples.article_id = model_experiment_jobs.article_id
    WHERE model_experiment_jobs.id = ?`,
  ).bind(jobId).first<ModelExperimentJobRow & {
    experiment_status: string;
    experiment_phase: number;
    expected_input_hash: string;
  }>();
  if (!job) return { ok: false, jobId, skipped: "missing" };
  if (job.status === "succeeded" || job.status === "failed") return { ok: true, jobId, skipped: job.status };
  if (job.experiment_status !== "running" || job.phase !== job.experiment_phase) return { ok: true, jobId, skipped: "inactive_phase" };
  if (job.status === "running") throw new ResearchBusyError("Experiment job is already running");
  if (job.status !== "queued") return { ok: true, jobId, skipped: job.status };

  const productionWaiting = await env.NEWS_DB.prepare(
    "SELECT COUNT(*) AS count FROM research_jobs WHERE status = 'pending' AND prediction_delay_eligible = 1 AND NOT EXISTS (SELECT 1 FROM research_results WHERE research_results.job_id = research_jobs.id)",
  ).first<{ count: number }>();
  if (Number(productionWaiting?.count || 0) > 0) throw new ResearchBusyError("Production research has priority");

  const acquired = await env.NEWS_DB.prepare(
    `UPDATE model_experiment_jobs SET status = 'running', attempts = attempts + 1, started_at = CURRENT_TIMESTAMP,
      finished_at = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP,
      research_slot = (SELECT CAST(value AS INTEGER) FROM json_each('[0,1,2,3,4,5,6,7]') AS slots
        WHERE NOT EXISTS (SELECT 1 FROM research_jobs WHERE status = 'running' AND research_slot = CAST(slots.value AS INTEGER))
          AND NOT EXISTS (SELECT 1 FROM model_experiment_jobs AS active WHERE active.status = 'running' AND active.research_slot = CAST(slots.value AS INTEGER))
        ORDER BY CAST(value AS INTEGER) LIMIT 1)
    WHERE id = ? AND status = 'queued'
      AND ((SELECT COUNT(*) FROM research_jobs WHERE status = 'running') +
        (SELECT COUNT(*) FROM model_experiment_jobs WHERE status = 'running')) < ?`,
  ).bind(jobId, RESEARCH_CONTAINER_COUNT).run();
  if (!acquired.meta?.changes) throw new ResearchBusyError();
  const leased = await env.NEWS_DB.prepare(
    "SELECT research_slot, attempts FROM model_experiment_jobs WHERE id = ?",
  ).bind(jobId).first<{ research_slot: number | null; attempts: number }>();
  if (!leased || !Number.isInteger(leased.research_slot)) {
    await env.NEWS_DB.prepare(
      "UPDATE model_experiment_jobs SET status = 'queued', research_slot = NULL, last_error = 'No research slot was available', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(jobId).run();
    throw new ResearchBusyError();
  }

  const article = await env.NEWS_DB.prepare(
    "SELECT articles.*, sources.name AS source_name, sources.source_type, sources.weight AS source_weight FROM articles LEFT JOIN sources ON sources.id = articles.source_id WHERE articles.id = ?",
  ).bind(job.article_id).first<Article>();
  if (!article) {
    await env.NEWS_DB.prepare(
      "UPDATE model_experiment_jobs SET status = 'failed', finished_at = CURRENT_TIMESTAMP, last_error = 'Article not found', research_slot = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(jobId).run();
    await advanceModelExperiment(env, job.experiment_id);
    return { ok: false, jobId, skipped: "article_missing" };
  }

  try {
    const prompt = researchPrompt(article);
    const inputHash = await hashText(prompt);
    const inferenceStarted = Date.now();
    const memo = await runContainerResearch(env, prompt, Number(leased.research_slot), {
      model: job.model,
      reasoningEffort: job.reasoning_effort,
    });
    const durationSeconds = Math.max(0, Math.round((Date.now() - inferenceStarted) / 1000));
    const fields = parseResearchFields(memo);
    const validationError = validateResearchFields(fields);
    if (validationError) throw new Error(`Codex returned an invalid structured analysis: ${validationError}`);
    const calls = modelExperimentCalls(fields);
    for (const call of calls.slice(0, 8)) {
      await ensureModelExperimentPrice(env, job.experiment_id, article, call.symbol);
    }
    await env.NEWS_DB.prepare(
      "UPDATE model_experiment_jobs SET status = 'succeeded', finished_at = CURRENT_TIMESTAMP, duration_seconds = ?, last_error = NULL, memo = ?, fields_json = ?, calls_json = ?, input_hash = ?, research_slot = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(durationSeconds, memo, JSON.stringify(fields), JSON.stringify(calls), inputHash, jobId).run();
    await advanceModelExperiment(env, job.experiment_id);
    return { ok: true, jobId, skipped: inputHash === job.expected_input_hash ? undefined : "input_hash_changed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const authFailure = error instanceof CodexAuthRefreshError || isCodexAuthRefreshFailure(error);
    const capacityFailure = isTransientContainerCapacityError(error);
    const attempts = Number(leased.attempts || 0);
    const retry = authFailure || capacityFailure || attempts < MODEL_EXPERIMENT_MAX_ATTEMPTS;
    await env.NEWS_DB.prepare(
      `UPDATE model_experiment_jobs SET status = ?, finished_at = CURRENT_TIMESTAMP, last_error = ?,
        duration_seconds = CASE WHEN ? = 'failed' THEN MAX(0, unixepoch(CURRENT_TIMESTAMP) - unixepoch(started_at)) ELSE NULL END,
        attempts = CASE WHEN ? THEN MAX(0, attempts - 1) ELSE attempts END,
        research_slot = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).bind(
      retry ? "queued" : "failed",
      message.slice(0, 1000),
      retry ? "queued" : "failed",
      authFailure || capacityFailure ? 1 : 0,
      jobId,
    ).run();
    if (retry) throw new ResearchBusyError(authFailure ? "Codex authentication refresh is pending" : message);
    await advanceModelExperiment(env, job.experiment_id);
    return { ok: false, jobId };
  }
}

function percentile(values: number[], ratio: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function wilsonInterval(successes: number, total: number): [number | null, number | null] {
  if (!total) return [null, null];
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)) / denominator;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

function calibrationError(points: Array<{ confidence: number; correct: boolean }>): number | null {
  if (!points.length) return null;
  let weighted = 0;
  for (let bin = 0; bin < 10; bin += 1) {
    const lower = bin / 10;
    const upper = (bin + 1) / 10;
    const members = points.filter((point) => point.confidence >= lower && (bin === 9 ? point.confidence <= upper : point.confidence < upper));
    if (!members.length) continue;
    const averageConfidence = members.reduce((sum, point) => sum + point.confidence, 0) / members.length;
    const accuracy = members.filter((point) => point.correct).length / members.length;
    weighted += Math.abs(averageConfidence - accuracy) * members.length;
  }
  return weighted / points.length;
}

async function buildModelExperimentReport(env: Env, experimentId: string): Promise<{ json: Record<string, unknown>; text: string }> {
  const [experiment, jobsResult, samplesResult, pricesResult] = await Promise.all([
    env.NEWS_DB.prepare("SELECT * FROM model_experiments WHERE id = ?").bind(experimentId).first<ModelExperimentRow>(),
    env.NEWS_DB.prepare("SELECT * FROM model_experiment_jobs WHERE experiment_id = ? ORDER BY phase, sample_ordinal").bind(experimentId).all<any>(),
    env.NEWS_DB.prepare("SELECT * FROM model_experiment_samples WHERE experiment_id = ? ORDER BY sample_ordinal").bind(experimentId).all<any>(),
    env.NEWS_DB.prepare("SELECT * FROM model_experiment_prices WHERE experiment_id = ?").bind(experimentId).all<any>(),
  ]);
  if (!experiment) throw new Error("Experiment not found");
  const jobs = jobsResult.results || [];
  const samples = samplesResult.results || [];
  const priceByKey = new Map((pricesResult.results || []).map((row: any) => [`${row.article_id}:${row.symbol}`, row]));
  const referenceByArticle = new Map(samples.map((row: any) => [row.article_id, JSON.parse(row.reference_calls_json || "[]") as ModelExperimentCall[]]));
  const sampleByArticle = new Map(samples.map((row: any) => [row.article_id, row]));

  const modelMetrics = MODEL_EXPERIMENT_PHASES.map((phase) => {
    const modelJobs = jobs.filter((job: any) => Number(job.phase) === phase.phase);
    const succeeded = modelJobs.filter((job: any) => job.status === "succeeded");
    const durations = succeeded.map((job: any) => Number(job.duration_seconds)).filter(Number.isFinite);
    let totalCalls = 0;
    let validCalls = 0;
    let actionableArticles = 0;
    let referenceIntersection = 0;
    let referencePredicted = 0;
    let referenceExpected = 0;
    let directionMatches = 0;
    let directionCompared = 0;
    let jaccardTotal = 0;
    let hashMatches = 0;
    const intervalData = Object.fromEntries(MODEL_EXPERIMENT_INTERVALS.map((label) => [label, [] as Array<{ change: number; desired: number; confidence: number | null; correct: boolean }>]));

    for (const job of succeeded) {
      const calls = JSON.parse(job.calls_json || "[]") as ModelExperimentCall[];
      if (calls.length) actionableArticles += 1;
      totalCalls += calls.length;
      const reference = referenceByArticle.get(job.article_id) || [];
      const predictedSymbols = new Set(calls.map((call) => call.symbol));
      const referenceSymbols = new Set(reference.map((call) => call.symbol));
      const union = new Set([...predictedSymbols, ...referenceSymbols]);
      const intersection = [...predictedSymbols].filter((symbol) => referenceSymbols.has(symbol));
      referenceIntersection += intersection.length;
      referencePredicted += predictedSymbols.size;
      referenceExpected += referenceSymbols.size;
      jaccardTotal += union.size ? intersection.length / union.size : 1;
      for (const symbol of intersection) {
        directionCompared += 1;
        if (calls.find((call) => call.symbol === symbol)?.direction === reference.find((call) => call.symbol === symbol)?.direction) directionMatches += 1;
      }
      const sample = sampleByArticle.get(job.article_id);
      if (sample?.input_hash === job.input_hash) hashMatches += 1;
      for (const call of calls) {
        const price = priceByKey.get(`${job.article_id}:${call.symbol}`);
        if (!price || price.status !== "stored") continue;
        validCalls += 1;
        const intervals = JSON.parse(price.intervals_json || "{}");
        for (const label of MODEL_EXPERIMENT_INTERVALS) {
          const change = Number(intervals[label]?.change_pct);
          if (!Number.isFinite(change)) continue;
          const correct = call.direction === "bullish" ? change > 0 : change < 0;
          intervalData[label].push({
            change,
            desired: call.direction === "bullish" ? change : -change,
            confidence: call.confidence,
            correct,
          });
        }
      }
    }
    const intervals = Object.fromEntries(MODEL_EXPERIMENT_INTERVALS.map((label) => {
      const points = intervalData[label];
      const hits = points.filter((point) => point.correct).length;
      const calibrated = points.filter((point): point is typeof point & { confidence: number } => point.confidence !== null);
      const [ciLow, ciHigh] = wilsonInterval(hits, points.length);
      return [label, {
        samples: points.length,
        directional_accuracy: points.length ? hits / points.length : null,
        accuracy_95_ci: [ciLow, ciHigh],
        average_raw_movement_pct: points.length ? points.reduce((sum, point) => sum + point.change, 0) / points.length : null,
        average_desired_movement_pct: points.length ? points.reduce((sum, point) => sum + point.desired, 0) / points.length : null,
        brier_score: calibrated.length
          ? calibrated.reduce((sum, point) => sum + Math.pow(point.confidence - (point.correct ? 1 : 0), 2), 0) / calibrated.length
          : null,
        expected_calibration_error: calibrationError(calibrated),
      }];
    }));
    const accuracyValues = Object.values(intervals).map((item: any) => item.directional_accuracy).filter((value): value is number => typeof value === "number");
    return {
      phase: phase.phase,
      model: phase.model,
      reasoning_effort: phase.reasoningEffort,
      jobs: modelJobs.length,
      succeeded: succeeded.length,
      failed: modelJobs.filter((job: any) => job.status === "failed").length,
      structured_completion_rate: modelJobs.length ? succeeded.length / modelJobs.length : null,
      actionable_article_rate: succeeded.length ? actionableArticles / succeeded.length : null,
      total_calls: totalCalls,
      market_valid_call_rate: totalCalls ? validCalls / totalCalls : null,
      reference_ticker_precision: referencePredicted ? referenceIntersection / referencePredicted : null,
      reference_ticker_recall: referenceExpected ? referenceIntersection / referenceExpected : null,
      mean_article_ticker_jaccard: succeeded.length ? jaccardTotal / succeeded.length : null,
      reference_direction_agreement: directionCompared ? directionMatches / directionCompared : null,
      input_hash_match_rate: succeeded.length ? hashMatches / succeeded.length : null,
      latency_seconds: {
        average: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
        p50: percentile(durations, 0.5),
        p95: percentile(durations, 0.95),
      },
      mean_directional_accuracy: accuracyValues.length ? accuracyValues.reduce((sum, value) => sum + value, 0) / accuracyValues.length : null,
      intervals,
    };
  });
  const ranked = [...modelMetrics].sort((left: any, right: any) =>
    Number(right.mean_directional_accuracy || 0) - Number(left.mean_directional_accuracy || 0));
  const delta = ranked.length === 2
    ? Number(ranked[0].mean_directional_accuracy || 0) - Number(ranked[1].mean_directional_accuracy || 0)
    : 0;
  const conclusion = delta >= 0.02
    ? `${ranked[0].model} (${ranked[0].reasoning_effort}) produced the higher mean directional accuracy by ${(delta * 100).toFixed(2)} percentage points.`
    : `The models were within ${(delta * 100).toFixed(2)} percentage points on mean directional accuracy; treat the market result as effectively tied and prefer the lower-allowance model unless calibration or ticker quality differs materially.`;
  const reportJson: Record<string, unknown> = {
    experiment_id: experimentId,
    completed_at: new Date().toISOString(),
    sample_size: experiment.sample_size,
    methodology: {
      cohort: "Same 1,000 matured articles for both models; publication age at least 10 days.",
      intervals: MODEL_EXPERIMENT_INTERVALS,
      market_measurement: "Direction is scored against the nearest available Yahoo Finance market price after each article publication timestamp.",
      caveat: "Subsequent price movement is an observational proxy and does not prove that the article caused the move.",
    },
    models: modelMetrics,
    conclusion,
  };
  const lines = [
    "Cartdotcom model experiment complete",
    `Experiment: ${experimentId}`,
    `Cohort: ${experiment.sample_size} articles, evaluated by both models`,
    "",
    ...modelMetrics.flatMap((metric: any) => [
      `${metric.model} (${metric.reasoning_effort})`,
      `  Completed: ${metric.succeeded}/${metric.jobs}`,
      `  Actionable articles: ${metric.actionable_article_rate === null ? "n/a" : (metric.actionable_article_rate * 100).toFixed(2) + "%"}`,
      `  Valid market calls: ${metric.total_calls} calls, ${metric.market_valid_call_rate === null ? "n/a" : (metric.market_valid_call_rate * 100).toFixed(2) + "% valid"}`,
      `  Reference ticker precision/recall: ${metric.reference_ticker_precision === null ? "n/a" : (metric.reference_ticker_precision * 100).toFixed(2) + "%"} / ${metric.reference_ticker_recall === null ? "n/a" : (metric.reference_ticker_recall * 100).toFixed(2) + "%"}`,
      `  Mean directional accuracy: ${metric.mean_directional_accuracy === null ? "n/a" : (metric.mean_directional_accuracy * 100).toFixed(2) + "%"}`,
      ...MODEL_EXPERIMENT_INTERVALS.map((label) => {
        const interval = metric.intervals[label];
        return `    ${label}: ${interval.directional_accuracy === null ? "n/a" : (interval.directional_accuracy * 100).toFixed(2) + "%"} (${interval.samples} samples), desired move ${interval.average_desired_movement_pct === null ? "n/a" : interval.average_desired_movement_pct.toFixed(3) + "%"}, Brier ${interval.brier_score === null ? "n/a" : interval.brier_score.toFixed(4)}`;
      }),
      `  Latency average/p50/p95: ${metric.latency_seconds.average === null ? "n/a" : metric.latency_seconds.average.toFixed(1) + "s"} / ${metric.latency_seconds.p50 ?? "n/a"}s / ${metric.latency_seconds.p95 ?? "n/a"}s`,
      "",
    ]),
    conclusion,
    "",
    "Caveat: price movement is an observational validation proxy, not proof of article causality.",
  ];
  return { json: reportJson, text: lines.join("\n") };
}

async function sendExperimentEmail(
  env: Env,
  recipient: string,
  subject: string,
  text: string,
): Promise<{ provider: "cloudflare" | "resend"; messageId: string | null }> {
  const sender = env.EXPERIMENT_REPORT_EMAIL_FROM;
  if (!sender) throw new Error("The experiment report sender is not configured");
  if (!env.EXPERIMENT_EMAIL && !env.RESEND_API_KEY) throw new Error("No Cloudflare Email binding or Resend API key is configured");
  if (env.EXPERIMENT_EMAIL) {
    const sent = await env.EXPERIMENT_EMAIL.send({ to: recipient, from: sender, subject, text });
    return { provider: "cloudflare", messageId: sent.messageId };
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: sender, to: [recipient], subject, text }),
  });
  const payload = await response.json() as { id?: string; message?: string };
  if (!response.ok) throw new Error(payload.message || `Email provider returned HTTP ${response.status}`);
  return { provider: "resend", messageId: payload.id || null };
}

async function sendModelExperimentReport(env: Env, experiment: ModelExperimentRow): Promise<void> {
  const recipient = experiment.email_to || env.EXPERIMENT_REPORT_EMAIL_TO;
  if (!recipient || !experiment.report_text) {
    await env.NEWS_DB.prepare(
      "UPDATE model_experiments SET email_status = 'not_configured', email_error = 'Recipient or completed report is not configured', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(experiment.id).run();
    return;
  }
  try {
    const sent = await sendExperimentEmail(env, recipient, "Cartdotcom Luna vs Terra experiment results", experiment.report_text);
    await env.NEWS_DB.prepare(
      "UPDATE model_experiments SET email_status = 'sent', email_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(sent.messageId, experiment.id).run();
  } catch (error) {
    await env.NEWS_DB.prepare(
      "UPDATE model_experiments SET email_status = 'failed', email_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind((error instanceof Error ? error.message : String(error)).slice(0, 1000), experiment.id).run();
  }
}

async function finishModelExperiment(env: Env, experimentId: string): Promise<void> {
  const claimed = await env.NEWS_DB.prepare(
    "UPDATE model_experiments SET status = 'reporting', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'running' AND phase = 2",
  ).bind(experimentId).run();
  if (!claimed.meta?.changes) return;
  try {
    const report = await buildModelExperimentReport(env, experimentId);
    await env.NEWS_DB.prepare(
      "UPDATE model_experiments SET status = 'completed', report_json = ?, report_text = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(JSON.stringify(report.json), report.text, experimentId).run();
    const completed = await env.NEWS_DB.prepare("SELECT * FROM model_experiments WHERE id = ?")
      .bind(experimentId).first<ModelExperimentRow>();
    if (completed) await sendModelExperimentReport(env, completed);
  } catch (error) {
    await env.NEWS_DB.prepare(
      "UPDATE model_experiments SET status = 'failed', email_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind((error instanceof Error ? error.message : String(error)).slice(0, 1000), experimentId).run();
  }
}

async function advanceModelExperiment(env: Env, experimentId?: string): Promise<Record<string, unknown>> {
  await ensureModelExperimentSchema(env.NEWS_DB);
  await env.NEWS_DB.batch([
    env.NEWS_DB.prepare(
      "UPDATE model_experiment_jobs SET status = 'pending', research_slot = NULL, last_error = 'Recovered stale running experiment job', updated_at = CURRENT_TIMESTAMP WHERE status = 'running' AND datetime(started_at) < datetime('now', '-8 minutes')",
    ),
    env.NEWS_DB.prepare(
      "UPDATE model_experiment_jobs SET status = 'pending', research_slot = NULL, last_error = 'Recovered orphaned queued experiment job', updated_at = CURRENT_TIMESTAMP WHERE status = 'queued' AND datetime(queued_at) < datetime('now', '-10 minutes')",
    ),
  ]);
  const experiment = experimentId
    ? await env.NEWS_DB.prepare("SELECT * FROM model_experiments WHERE id = ?").bind(experimentId).first<ModelExperimentRow>()
    : await env.NEWS_DB.prepare("SELECT * FROM model_experiments WHERE status = 'running' ORDER BY datetime(created_at) DESC LIMIT 1").first<ModelExperimentRow>();
  if (!experiment || experiment.status !== "running") return { dispatched: 0, status: experiment?.status || "none" };

  const counts = await env.NEWS_DB.prepare(
    "SELECT status, COUNT(*) AS count FROM model_experiment_jobs WHERE experiment_id = ? AND phase = ? GROUP BY status",
  ).bind(experiment.id, experiment.phase).all<{ status: string; count: number }>();
  const byStatus = Object.fromEntries((counts.results || []).map((row) => [row.status, Number(row.count)]));
  const terminal = Number(byStatus.succeeded || 0) + Number(byStatus.failed || 0);
  if (terminal >= experiment.sample_size) {
    if (experiment.phase === 1) {
      await env.NEWS_DB.prepare(
        "UPDATE model_experiments SET phase = 2, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND phase = 1 AND status = 'running'",
      ).bind(experiment.id).run();
      return advanceModelExperiment(env, experiment.id);
    }
    await finishModelExperiment(env, experiment.id);
    return { dispatched: 0, status: "reporting" };
  }

  const production = await env.NEWS_DB.prepare(
    "SELECT SUM(CASE WHEN status = 'pending' AND prediction_delay_eligible = 1 AND NOT EXISTS (SELECT 1 FROM research_results WHERE research_results.job_id = research_jobs.id) THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running FROM research_jobs WHERE status IN ('pending', 'running')",
  ).first<{ pending: number | null; running: number | null }>();
  if (Number(production?.pending || 0) > 0) return { dispatched: 0, status: "waiting_for_production" };
  const activeExperiment = await env.NEWS_DB.prepare(
    "SELECT COUNT(*) AS count FROM model_experiment_jobs WHERE status IN ('queued', 'running')",
  ).first<{ count: number }>();
  const available = Math.max(0, Math.min(
    MODEL_EXPERIMENT_MAX_CONCURRENCY - Number(activeExperiment?.count || 0),
    RESEARCH_CONTAINER_COUNT - Number(production?.running || 0) - Number(activeExperiment?.count || 0),
  ));
  if (!available) return { dispatched: 0, status: "at_capacity" };
  const pending = await env.NEWS_DB.prepare(
    "SELECT id FROM model_experiment_jobs WHERE experiment_id = ? AND phase = ? AND status = 'pending' ORDER BY sample_ordinal LIMIT ?",
  ).bind(experiment.id, experiment.phase, available).all<{ id: string }>();
  let dispatched = 0;
  for (const row of pending.results || []) {
    const claimed = await env.NEWS_DB.prepare(
      "UPDATE model_experiment_jobs SET status = 'queued', queued_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'",
    ).bind(row.id).run();
    if (!claimed.meta?.changes) continue;
    await env.RESEARCH_QUEUE.send({ kind: "model_experiment", jobId: row.id });
    dispatched += 1;
  }
  return { dispatched, status: "running", phase: experiment.phase };
}

async function modelExperimentStatus(env: Env, experimentId?: string): Promise<Record<string, unknown>> {
  await ensureModelExperimentSchema(env.NEWS_DB);
  const experiment = experimentId
    ? await env.NEWS_DB.prepare("SELECT * FROM model_experiments WHERE id = ?").bind(experimentId).first<ModelExperimentRow>()
    : await env.NEWS_DB.prepare("SELECT * FROM model_experiments ORDER BY datetime(created_at) DESC LIMIT 1").first<ModelExperimentRow>();
  if (!experiment) return { experiment: null, progress: [] };
  const progress = await env.NEWS_DB.prepare(
    "SELECT phase, model, reasoning_effort, status, COUNT(*) AS count, AVG(duration_seconds) AS average_duration_seconds FROM model_experiment_jobs WHERE experiment_id = ? GROUP BY phase, model, reasoning_effort, status ORDER BY phase, status",
  ).bind(experiment.id).all();
  return {
    experiment: {
      ...experiment,
      report: experiment.report_json ? JSON.parse(experiment.report_json) : null,
      report_json: undefined,
      report_text: experiment.report_text || null,
    },
    progress: progress.results || [],
  };
}

async function processNextJob(env: Env): Promise<{ ok: boolean; jobId?: string; skipped?: string }> {
  const job = await env.NEWS_DB.prepare(
    "SELECT id FROM research_jobs WHERE status = 'pending' ORDER BY CASE WHEN prediction_delay_eligible = 1 AND NOT EXISTS (SELECT 1 FROM research_results WHERE research_results.job_id = research_jobs.id) THEN 0 WHEN prediction_delay_eligible = 2 AND NOT EXISTS (SELECT 1 FROM research_results WHERE research_results.job_id = research_jobs.id) THEN 1 ELSE 2 END, queued_at ASC LIMIT 1",
  ).first<{ id: string }>();
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

async function drainResearchBacklogConcurrently(env: Env): Promise<{
  processed: number;
  selected: number;
  busy: number;
  errors: string[];
}> {
  const deadline = Date.now() + QUEUE_DRAIN_MAX_MS;
  let processed = 0;
  let selectedCount = 0;
  let busy = 0;
  const errors: string[] = [];
  while (Date.now() < deadline) {
    const running = await env.NEWS_DB.prepare(
      "SELECT COUNT(*) AS count FROM research_jobs WHERE status = 'running'",
    ).first<{ count: number }>();
    const available = Math.max(0, RESEARCH_CONTAINER_COUNT - Number(running?.count || 0));
    if (!available) break;

    const jobs = await env.NEWS_DB.prepare(
      "SELECT id FROM research_jobs WHERE status = 'pending' ORDER BY CASE WHEN prediction_delay_eligible = 1 AND NOT EXISTS (SELECT 1 FROM research_results WHERE research_results.job_id = research_jobs.id) THEN 0 WHEN prediction_delay_eligible = 2 AND NOT EXISTS (SELECT 1 FROM research_results WHERE research_results.job_id = research_jobs.id) THEN 1 ELSE 2 END, queued_at ASC LIMIT ?",
    )
      .bind(available)
      .all<{ id: string }>();
    const selected = jobs.results || [];
    if (!selected.length) break;
    selectedCount += selected.length;

    const settled = await Promise.allSettled(selected.map((job) => processJob(env, job.id)));
    let completed = 0;
    for (const result of settled) {
      if (result.status === "fulfilled") {
        completed += 1;
        if (!result.value.skipped) processed += 1;
      } else if (result.reason instanceof ResearchBusyError) {
        busy += 1;
      } else {
        errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
        console.error("Concurrent backlog research processing failed", result.reason);
      }
    }
    if (!completed) break;
  }
  return { processed, selected: selectedCount, busy, errors: errors.slice(0, 20) };
}

async function requeuePendingJobs(env: Env, limit = 25): Promise<{ requeued: number }> {
  const clamped = Math.min(Math.max(limit, 1), 100);
  const pending = await env.NEWS_DB.prepare(
    "SELECT id FROM research_jobs WHERE status = 'pending' ORDER BY CASE WHEN prediction_delay_eligible = 1 AND NOT EXISTS (SELECT 1 FROM research_results WHERE research_results.job_id = research_jobs.id) THEN 0 WHEN prediction_delay_eligible = 2 AND NOT EXISTS (SELECT 1 FROM research_results WHERE research_results.job_id = research_jobs.id) THEN 1 ELSE 2 END, queued_at ASC LIMIT ?",
  )
    .bind(clamped)
    .all<{ id: string }>();

  for (const job of pending.results || []) {
    await env.RESEARCH_QUEUE.send({ jobId: job.id });
  }

  return { requeued: pending.results?.length || 0 };
}

async function recycleResearchContainers(env: Env): Promise<{ recycled: number; recycle_failures: number }> {
  const results = await Promise.allSettled(
    Array.from({ length: RESEARCH_CONTAINER_COUNT }, (_, slot) =>
      getContainer(env.CODEX_CONTAINER, `instance-${slot}`).destroy(),
    ),
  );
  return {
    recycled: results.filter((result) => result.status === "fulfilled").length,
    recycle_failures: results.filter((result) => result.status === "rejected").length,
  };
}

async function recoverCodexAuthFailedResearchJobs(env: Env): Promise<{ recovered: number }> {
  const marker = "Recovered after Codex authentication repair";
  const failed = await env.NEWS_DB.prepare(
    "SELECT COUNT(*) AS count FROM research_jobs WHERE status = 'failed' AND (last_error LIKE '%access token could not be refreshed%' OR last_error LIKE '%refresh token was already used%' OR last_error LIKE '%Please log out and sign in again%')",
  ).first<{ count: number }>();
  const recovered = Number(failed?.count || 0);
  if (!recovered) return { recovered: 0 };

  await env.NEWS_DB.batch([
    env.NEWS_DB.prepare(
      "UPDATE research_jobs SET status = 'pending', attempts = 0, last_error = ?, queued_at = CURRENT_TIMESTAMP, started_at = NULL, finished_at = NULL, synthesis_duration_seconds = NULL, prediction_delay_seconds = NULL, prediction_delay_eligible = 2, research_slot = NULL WHERE status = 'failed' AND (last_error LIKE '%access token could not be refreshed%' OR last_error LIKE '%refresh token was already used%' OR last_error LIKE '%Please log out and sign in again%')",
    ).bind(marker),
    env.NEWS_DB.prepare(
      "UPDATE articles SET status = 'queued' WHERE EXISTS (SELECT 1 FROM research_jobs WHERE research_jobs.article_id = articles.id AND research_jobs.status = 'pending' AND research_jobs.last_error = ?)",
    ).bind(marker),
  ]);
  return { recovered };
}

async function remediateFailedResearchJobs(env: Env): Promise<{
  inspected: number;
  archived: number;
}> {
  const failed = await env.NEWS_DB.prepare(
    "SELECT COUNT(*) AS count FROM research_jobs INNER JOIN articles ON articles.id = research_jobs.article_id WHERE research_jobs.status = 'failed' AND articles.status != 'archived'",
  ).first<{ count: number }>();
  const archived = await archiveFailedResearchJobs(env.NEWS_DB);
  return {
    inspected: Number(failed?.count || 0),
    archived,
  };
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
      "CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_article_prediction_at ON prediction_outcomes(article_id, prediction_at)",
    ),
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
  interval: string;
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

type SourceStatsRow = {
  id: string;
  name: string;
  url: string;
  category: string;
  source_type: string;
  acquired_article_count: number;
  ledger_seen_count: number;
  ledger_acquired_count: number;
  ledger_baseline_count: number;
  ledger_stale_count: number;
  ledger_pending_count: number;
  ledger_duplicate_count: number;
  bullish_average_movement_pct: number | null;
  bullish_samples: number;
  bearish_average_movement_pct: number | null;
  bearish_samples: number;
};

const PREDICTION_DATE_MATCH_SQL =
  "datetime(prediction_outcomes.prediction_at) = datetime(COALESCE(articles.published_at, research_results.created_at))";
const PREDICTION_CONFIDENCE_PCT_SQL =
  "CASE WHEN prediction_outcomes.confidence <= 1 THEN prediction_outcomes.confidence * 100 ELSE prediction_outcomes.confidence END";
const PREDICTION_ACCURACY_CTE_SQL =
  `accuracy_predictions AS MATERIALIZED (
    SELECT prediction_outcomes.id, prediction_outcomes.symbol, prediction_outcomes.direction,
      prediction_outcomes.prediction_at, prediction_outcomes.intervals_json,
      ${PREDICTION_CONFIDENCE_PCT_SQL} AS confidence_pct
    FROM prediction_outcomes
    INNER JOIN research_results ON research_results.id = prediction_outcomes.result_id
    LEFT JOIN articles ON articles.id = research_results.article_id
    WHERE prediction_outcomes.direction IN ('bullish', 'bearish')
      AND prediction_outcomes.confidence IS NOT NULL
      AND ${PREDICTION_DATE_MATCH_SQL}
  )`;

async function buildSourceStats(env: Env): Promise<SourceStatsRow[]> {
  await ensurePredictionOutcomeTables(env);
  const result = await env.NEWS_DB.prepare(
    `WITH ledger_stats AS (
      SELECT source_id,
        COUNT(*) AS ledger_seen_count,
        SUM(CASE WHEN disposition IN ('acquired', 'duplicate') THEN 1 ELSE 0 END) AS ledger_acquired_count,
        SUM(CASE WHEN disposition = 'baseline' THEN 1 ELSE 0 END) AS ledger_baseline_count,
        SUM(CASE WHEN disposition = 'stale' THEN 1 ELSE 0 END) AS ledger_stale_count,
        SUM(CASE WHEN disposition = 'pending' THEN 1 ELSE 0 END) AS ledger_pending_count,
        SUM(CASE WHEN disposition = 'duplicate' THEN 1 ELSE 0 END) AS ledger_duplicate_count
      FROM feed_item_ledger
      GROUP BY source_id
    ), article_counts AS (
      SELECT source_id, COUNT(*) AS acquired_article_count
      FROM articles
      GROUP BY source_id
    ), valid_source_outcomes AS MATERIALIZED (
      SELECT articles.source_id, prediction_outcomes.direction, prediction_outcomes.intervals_json
      FROM prediction_outcomes
      INNER JOIN research_results ON research_results.id = prediction_outcomes.result_id
      INNER JOIN articles ON articles.id = research_results.article_id
      WHERE prediction_outcomes.direction IN ('bullish', 'bearish')
        AND ${PREDICTION_DATE_MATCH_SQL}
    ), eligible_movements AS (
      SELECT valid_source_outcomes.source_id, valid_source_outcomes.direction,
        CAST(json_extract(interval.value, '$.change_pct') AS REAL) AS movement_pct
      FROM valid_source_outcomes
      CROSS JOIN json_each(valid_source_outcomes.intervals_json) AS interval
      WHERE json_type(interval.value, '$.change_pct') IN ('integer', 'real')
    ), movement_stats AS (
      SELECT source_id,
        AVG(CASE WHEN direction = 'bullish' THEN movement_pct END) AS bullish_average_movement_pct,
        SUM(CASE WHEN direction = 'bullish' THEN 1 ELSE 0 END) AS bullish_samples,
        AVG(CASE WHEN direction = 'bearish' THEN movement_pct END) AS bearish_average_movement_pct,
        SUM(CASE WHEN direction = 'bearish' THEN 1 ELSE 0 END) AS bearish_samples
      FROM eligible_movements
      GROUP BY source_id
    )
    SELECT sources.id, sources.name, sources.url, sources.category, sources.source_type,
      COALESCE(article_counts.acquired_article_count, 0) AS acquired_article_count,
      COALESCE(ledger_stats.ledger_seen_count, 0) AS ledger_seen_count,
      COALESCE(ledger_stats.ledger_acquired_count, 0) AS ledger_acquired_count,
      COALESCE(ledger_stats.ledger_baseline_count, 0) AS ledger_baseline_count,
      COALESCE(ledger_stats.ledger_stale_count, 0) AS ledger_stale_count,
      COALESCE(ledger_stats.ledger_pending_count, 0) AS ledger_pending_count,
      COALESCE(ledger_stats.ledger_duplicate_count, 0) AS ledger_duplicate_count,
      movement_stats.bullish_average_movement_pct,
      COALESCE(movement_stats.bullish_samples, 0) AS bullish_samples,
      movement_stats.bearish_average_movement_pct,
      COALESCE(movement_stats.bearish_samples, 0) AS bearish_samples
    FROM sources
    LEFT JOIN ledger_stats ON ledger_stats.source_id = sources.id
    LEFT JOIN article_counts ON article_counts.source_id = sources.id
    LEFT JOIN movement_stats ON movement_stats.source_id = sources.id
    WHERE sources.enabled = 1
    ORDER BY acquired_article_count DESC, sources.weight DESC, sources.name ASC`,
  ).all<SourceStatsRow>();
  return result.results || [];
}

function brisbaneDateParts(timestamp = Date.now()): { year: number; month: number; day: number } {
  const shifted = new Date(timestamp + BRISBANE_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function brisbaneLocalToUtc(year: number, month: number, day: number, hour = 0): number {
  return Date.UTC(year, month - 1, day, hour) - BRISBANE_OFFSET_MS;
}

function sourceActivityAnchor(value: string | null): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return brisbaneDateParts();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const valid = new Date(Date.UTC(year, month - 1, day));
  if (valid.getUTCFullYear() !== year || valid.getUTCMonth() !== month - 1 || valid.getUTCDate() !== day) return brisbaneDateParts();
  return { year, month, day };
}

function localDateLabel(timestamp: number, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", ...options }).format(new Date(timestamp));
}

async function buildSourceActivity(
  env: Env,
  mode: SourceActivityMode,
  anchorValue: string | null,
): Promise<Record<string, unknown>> {
  await ensureSourceHourlyMetricsBackfilled(env.NEWS_DB);
  const anchor = sourceActivityAnchor(anchorValue);
  const normalizedAnchor = `${anchor.year}-${String(anchor.month).padStart(2, "0")}-${String(anchor.day).padStart(2, "0")}`;
  const currentHour = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
  let rangeStart = brisbaneLocalToUtc(anchor.year, anchor.month, anchor.day);
  let rangeEnd = rangeStart + 24 * HOUR_MS;
  let periodLabel = localDateLabel(rangeStart, { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  let axisLabel = "Hour of day (Brisbane time)";

  if (mode === "month") {
    rangeStart = brisbaneLocalToUtc(anchor.year, anchor.month, 1);
    rangeEnd = brisbaneLocalToUtc(anchor.year, anchor.month + 1, 1);
    periodLabel = localDateLabel(rangeStart, { month: "long", year: "numeric" });
    axisLabel = "Day of month (Brisbane time)";
  } else if (mode === "year") {
    rangeStart = brisbaneLocalToUtc(anchor.year, 1, 1);
    rangeEnd = brisbaneLocalToUtc(anchor.year + 1, 1, 1);
    periodLabel = String(anchor.year);
    axisLabel = "Week of year (Brisbane time)";
  }

  const metricRows = await env.NEWS_DB.prepare(
    "SELECT hour_start, article_count, ticker_count FROM source_hourly_metrics WHERE datetime(hour_start) >= datetime(?) AND datetime(hour_start) < datetime(?) AND datetime(hour_start) < datetime(?) ORDER BY datetime(hour_start)",
  )
    .bind(new Date(rangeStart).toISOString(), new Date(rangeEnd).toISOString(), new Date(currentHour + HOUR_MS).toISOString())
    .all<SourceHourlyMetricRow>();
  const hourly = new Map(
    (metricRows.results || []).map((row) => [Math.floor(Date.parse(row.hour_start) / HOUR_MS) * HOUR_MS, {
      articles: Number(row.article_count || 0),
      tickers: Number(row.ticker_count || 0),
    }]),
  );
  const sumRange = (start: number, end: number) => {
    let articles = 0;
    let tickers = 0;
    for (let hour = start; hour < Math.min(end, currentHour + HOUR_MS); hour += HOUR_MS) {
      const row = hourly.get(hour);
      articles += row?.articles || 0;
      tickers += row?.tickers || 0;
    }
    return { articles, tickers };
  };

  const buckets: Array<Record<string, unknown>> = [];
  const ticks: Array<Record<string, unknown>> = [];
  const separators: Array<Record<string, unknown>> = [];
  let domainMax = 24;

  if (mode === "day") {
    for (let hour = 0; hour < 24; hour += 1) {
      const start = rangeStart + hour * HOUR_MS;
      const started = start <= currentHour;
      const totals = sumRange(start, start + HOUR_MS);
      const hourLabel = hour === 0 ? "12am" : hour === 12 ? "12pm" : hour < 12 ? `${hour}am` : `${hour - 12}pm`;
      buckets.push({
        position: hour + 0.5,
        label: `${hourLabel}-${hour === 23 ? "12am" : hour + 1 === 12 ? "12pm" : hour + 1 < 12 ? `${hour + 1}am` : `${hour + 1 - 12}pm`}`,
        articles: started ? totals.articles : null,
        tickers: started ? totals.tickers : null,
        partial: start === currentHour,
      });
    }
    for (let hour = 0; hour <= 24; hour += 4) {
      ticks.push({ position: hour, label: hour === 0 || hour === 24 ? "12am" : hour === 12 ? "12pm" : hour < 12 ? `${hour}am` : `${hour - 12}pm` });
    }
  } else if (mode === "month") {
    const days = Math.round((rangeEnd - rangeStart) / (24 * HOUR_MS));
    domainMax = days;
    let weekNumber = 0;
    for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
      const start = rangeStart + dayIndex * 24 * HOUR_MS;
      const end = start + 24 * HOUR_MS;
      const started = start <= currentHour;
      const totals = sumRange(start, end);
      buckets.push({
        position: dayIndex + 0.5,
        label: localDateLabel(start, { weekday: "short", day: "numeric", month: "short" }),
        articles: started ? totals.articles : null,
        tickers: started ? totals.tickers : null,
        partial: started && end > currentHour,
      });
      const dayOfWeek = new Date(start + BRISBANE_OFFSET_MS).getUTCDay();
      if (dayIndex === 0 || dayOfWeek === 1) {
        weekNumber += 1;
        separators.push({ position: dayIndex, label: `Week ${weekNumber}` });
      }
    }
    const tickStep = days > 28 ? 5 : 4;
    for (let day = 1; day <= days; day += tickStep) ticks.push({ position: day - 0.5, label: String(day) });
    if (!ticks.some((tick) => Number(tick.position) === days - 0.5)) ticks.push({ position: days - 0.5, label: String(days) });
  } else {
    const yearStart = rangeStart;
    const yearEnd = rangeEnd;
    const yearDays = Math.round((yearEnd - yearStart) / (24 * HOUR_MS));
    domainMax = yearDays / 7;
    let weekNumber = 1;
    for (let weekStart = yearStart; weekStart < yearEnd; weekStart += 7 * 24 * HOUR_MS) {
      const weekEnd = Math.min(weekStart + 7 * 24 * HOUR_MS, yearEnd);
      const started = weekStart <= currentHour;
      const totals = sumRange(weekStart, weekEnd);
      buckets.push({
        position: ((weekStart + weekEnd) / 2 - yearStart) / (7 * 24 * HOUR_MS),
        label: `Week ${weekNumber}: ${localDateLabel(weekStart, { day: "numeric", month: "short" })}-${localDateLabel(weekEnd - 1, { day: "numeric", month: "short" })}`,
        articles: started ? totals.articles : null,
        tickers: started ? totals.tickers : null,
        partial: started && weekEnd > currentHour,
      });
      if (weekNumber === 1 || weekNumber % 4 === 1) ticks.push({ position: (weekStart - yearStart) / (7 * 24 * HOUR_MS), label: `W${weekNumber}` });
      weekNumber += 1;
    }
    for (let month = 1; month <= 12; month += 1) {
      const monthStart = brisbaneLocalToUtc(anchor.year, month, 1);
      separators.push({
        position: (monthStart - yearStart) / (7 * 24 * HOUR_MS),
        label: localDateLabel(monthStart, { month: "short" }),
      });
    }
  }

  const earliestCheck = await env.NEWS_DB.prepare(
    "SELECT MIN(checked_at) AS checked_at FROM source_checks WHERE datetime(checked_at) >= datetime(?)",
  )
    .bind(SOURCE_EXPANSION_CUTOFF)
    .first<{ checked_at: string | null }>();
  const firstCheckMs = earliestCheck?.checked_at ? Date.parse(earliestCheck.checked_at) : currentHour;
  const averageStart = Math.ceil(firstCheckMs / HOUR_MS) * HOUR_MS;
  const completedHours = Math.max(0, Math.floor((currentHour - averageStart) / HOUR_MS));
  const averageTotals = completedHours > 0
    ? await env.NEWS_DB.prepare(
      "SELECT COALESCE(SUM(article_count), 0) AS articles, COALESCE(SUM(ticker_count), 0) AS tickers FROM source_hourly_metrics WHERE datetime(hour_start) >= datetime(?) AND datetime(hour_start) < datetime(?)",
    )
      .bind(new Date(averageStart).toISOString(), new Date(currentHour).toISOString())
      .first<{ articles: number; tickers: number }>()
    : null;

  const current = brisbaneDateParts();
  const currentPeriodStart = mode === "day"
    ? brisbaneLocalToUtc(current.year, current.month, current.day)
    : mode === "month"
      ? brisbaneLocalToUtc(current.year, current.month, 1)
      : brisbaneLocalToUtc(current.year, 1, 1);
  return {
    ok: true,
    timezone: "Australia/Brisbane",
    mode,
    anchor: normalizedAnchor,
    period_label: periodLabel,
    axis_label: axisLabel,
    bucket_note: mode === "day" ? "hourly totals" : mode === "month" ? "daily totals with week boundaries" : "weekly totals with month boundaries",
    can_go_next: rangeStart < currentPeriodStart,
    domain_max: domainMax,
    buckets,
    ticks,
    separators,
    average: {
      completed_hours: completedHours,
      articles_per_hour: completedHours ? Number(averageTotals?.articles || 0) / completedHours : 0,
      tickers_per_hour: completedHours ? Number(averageTotals?.tickers || 0) / completedHours : 0,
      total_articles: Number(averageTotals?.articles || 0),
      total_tickers: Number(averageTotals?.tickers || 0),
      starts_at: completedHours ? new Date(averageStart).toISOString() : null,
      ends_at: new Date(currentHour).toISOString(),
    },
  };
}

async function buildPredictionSummary(env: Env): Promise<Record<string, unknown>[]> {
  const intervalGroups = Array.from(
    { length: Math.ceil(PREDICTION_INTERVALS.length / 4) },
    (_, index) => PREDICTION_INTERVALS.slice(index * 4, index * 4 + 4),
  );
  const results = await Promise.all(intervalGroups.map((intervals) => {
    const eligibleSql = intervals.map((interval) => {
      const root = `$."${interval.label}"`;
      return `SELECT direction, confidence_pct, '${interval.label}' AS interval,
        CAST(json_extract(intervals_json, '${root}.change_pct') AS REAL) AS movement_pct
      FROM accuracy_predictions
      WHERE json_type(intervals_json, '${root}.change_pct') IN ('integer', 'real')`;
    }).join("\nUNION ALL\n");
    return env.NEWS_DB.prepare(
      `WITH ${PREDICTION_ACCURACY_CTE_SQL},
      interval_values AS MATERIALIZED (
        ${eligibleSql}
      ),
      eligible AS (
        SELECT direction, confidence_pct, interval, movement_pct
        FROM interval_values
        WHERE confidence_pct >= 0
          AND confidence_pct <= 100
      )
      SELECT interval, direction,
        CASE WHEN confidence_pct >= 100 THEN 9 ELSE CAST(confidence_pct / 10 AS INTEGER) END AS confidence_bin,
        COUNT(*) AS samples,
        SUM(CASE WHEN (direction = 'bullish' AND movement_pct > 0) OR (direction = 'bearish' AND movement_pct < 0) THEN 1 ELSE 0 END) AS accurate,
        AVG(movement_pct) AS average_movement_pct
      FROM eligible
      GROUP BY interval, direction, confidence_bin
      ORDER BY interval, direction, confidence_bin`,
    ).all<PredictionSummaryRow>();
  }));
  const rows = results.flatMap((result) => result.results || []);
  return PREDICTION_INTERVALS.map((interval) => {
    const intervalRows = rows.filter((row) => row.interval === interval.label);
    const cellsFor = (direction: "bullish" | "bearish") =>
      Array.from({ length: 10 }, (_, confidenceBin) => {
        const row = intervalRows.find((item) => item.direction === direction && Number(item.confidence_bin) === confidenceBin);
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
  type DailyQueryRow = PredictionDailySummaryRow & {
    row_type: "series" | "coverage";
    oldest_age_days: number | null;
    eligible_predictions: number | null;
    daily_predictions: number | null;
  };
  const result = await env.NEWS_DB.prepare(
    `WITH ${PREDICTION_ACCURACY_CTE_SQL},
    chart_predictions AS MATERIALIZED (
      SELECT *
      FROM accuracy_predictions
      WHERE confidence_pct >= 0
        AND confidence_pct <= 100
        AND EXISTS (
          SELECT 1
          FROM json_each(accuracy_predictions.intervals_json) AS interval
          WHERE json_type(interval.value, '$.change_pct') IN ('integer', 'real')
        )
    ),
    series AS (
      SELECT chart_predictions.direction,
        CASE WHEN chart_predictions.confidence_pct >= 100 THEN 9 ELSE CAST(chart_predictions.confidence_pct / 10 AS INTEGER) END AS confidence_bin,
        prediction_daily_points_v2.day_index,
        COUNT(*) AS samples,
        AVG(prediction_daily_points_v2.change_pct) AS average_movement_pct
      FROM chart_predictions
      INNER JOIN prediction_daily_points_v2 ON prediction_daily_points_v2.outcome_id = chart_predictions.id
      GROUP BY chart_predictions.direction, confidence_bin, prediction_daily_points_v2.day_index
    ),
    coverage AS (
      SELECT MAX(MAX(0, CAST((unixepoch('now') - unixepoch(chart_predictions.prediction_at)) / 86400 AS INTEGER))) AS oldest_age_days,
        COUNT(DISTINCT chart_predictions.id) AS eligible_predictions,
        COUNT(DISTINCT prediction_daily_points_v2.outcome_id) AS daily_predictions
      FROM chart_predictions
      LEFT JOIN prediction_daily_points_v2 ON prediction_daily_points_v2.outcome_id = chart_predictions.id
    )
    SELECT 'series' AS row_type, direction, confidence_bin, day_index, samples, average_movement_pct,
      NULL AS oldest_age_days, NULL AS eligible_predictions, NULL AS daily_predictions
    FROM series
    UNION ALL
    SELECT 'coverage' AS row_type, NULL AS direction, NULL AS confidence_bin, NULL AS day_index, NULL AS samples,
      NULL AS average_movement_pct, oldest_age_days, eligible_predictions, daily_predictions
    FROM coverage
    ORDER BY row_type DESC, day_index, direction, confidence_bin`,
  ).all<DailyQueryRow>();
  const rows = result.results || [];
  const coverage = rows.find((row) => row.row_type === "coverage");
  return {
    series: rows.filter((row) => row.row_type === "series").map((row) => ({
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
  const nowEpoch = Math.floor(Date.now() / 1000);
  const predictionEpoch = unixSeconds(row.prediction_at);
  const nullableNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const confidence = Number(row.confidence);
  const confidencePct = confidence <= 1 ? confidence * 100 : confidence;
  const hasEligibleConfidence = row.confidence !== null && Number.isFinite(confidencePct) && confidencePct >= 0 && confidencePct <= 100;
  const intervals = parsePredictionIntervals(row.intervals_json);
  for (const point of Object.values(intervals)) {
    point.counts_toward_accuracy =
      hasEligibleConfidence &&
      point.change_pct !== null &&
      point.change_pct !== undefined;
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
    daily_points: [],
    days_since_call: Number.isFinite(predictionEpoch) ? Math.max(0, Math.floor((nowEpoch - predictionEpoch) / 86400)) : 0,
    current_price: nullableNumber(row.current_price),
    current_price_at: row.current_price_at || null,
    current_movement_pct: nullableNumber(row.current_movement_pct),
    peak_movement_pct: nullableNumber(row.peak_movement_pct),
    updated_at: row.updated_at,
  };
}

function encodePredictionCursor(offset: number, sort: PredictionOutcomeSort): string {
  return btoa(JSON.stringify({ offset, sort }));
}

function decodePredictionCursor(value: string | null, sort: PredictionOutcomeSort): number {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(atob(value)) as { offset?: unknown; sort?: unknown };
    const offset = Number(parsed.offset);
    return parsed.sort === sort && Number.isInteger(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}

function predictionOutcomeOrderSql(sort: PredictionOutcomeSort): string {
  const groupTail = "group_metrics.latest_prediction_epoch DESC, filtered_outcomes.article_id DESC";
  if (sort === "oldest") {
    return "group_metrics.latest_prediction_epoch ASC, filtered_outcomes.article_id ASC, filtered_outcomes.id ASC";
  }
  if (sort === "current_desc") {
    return `group_metrics.current_max IS NULL ASC, group_metrics.current_max DESC, ${groupTail}, filtered_outcomes.current_movement_pct IS NULL ASC, filtered_outcomes.current_movement_pct DESC, filtered_outcomes.id DESC`;
  }
  if (sort === "current_asc") {
    return `group_metrics.current_min IS NULL ASC, group_metrics.current_min ASC, ${groupTail}, filtered_outcomes.current_movement_pct IS NULL ASC, filtered_outcomes.current_movement_pct ASC, filtered_outcomes.id DESC`;
  }
  if (sort === "peak_desc") {
    return `group_metrics.peak_max IS NULL ASC, group_metrics.peak_max DESC, ${groupTail}, filtered_outcomes.peak_movement_pct IS NULL ASC, filtered_outcomes.peak_movement_pct DESC, filtered_outcomes.id DESC`;
  }
  if (sort === "peak_asc") {
    return `group_metrics.peak_min IS NULL ASC, group_metrics.peak_min ASC, ${groupTail}, filtered_outcomes.peak_movement_pct IS NULL ASC, filtered_outcomes.peak_movement_pct ASC, filtered_outcomes.id DESC`;
  }
  return `${groupTail}, filtered_outcomes.id DESC`;
}

async function attachPredictionDailyPoints(env: Env, outcomes: PredictionOutcome[]): Promise<void> {
  if (!outcomes.length) return;
  const placeholders = outcomes.map(() => "?").join(", ");
  const result = await env.NEWS_DB.prepare(
    `SELECT outcome_id, day_index, sampled_at, price, change_pct FROM prediction_daily_points_v2 WHERE outcome_id IN (${placeholders}) ORDER BY outcome_id, day_index`,
  )
    .bind(...outcomes.map((outcome) => outcome.id))
    .all<{ outcome_id: string; day_index: number; sampled_at: string; price: number; change_pct: number }>();
  const pointsByOutcome = new Map<string, PredictionDailyPoint[]>();
  for (const row of result.results || []) {
    const points = pointsByOutcome.get(row.outcome_id) || [];
    points.push({
      day_index: Number(row.day_index),
      at: row.sampled_at,
      price: Number(row.price),
      change_pct: Number(row.change_pct),
    });
    pointsByOutcome.set(row.outcome_id, points);
  }
  for (const outcome of outcomes) outcome.daily_points = pointsByOutcome.get(outcome.id) || [];
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

  const offset = decodePredictionCursor(filters.cursor, filters.sort);
  const pageBindings = [...bindings, pageLimit + 1, offset];
  let result: D1Result<StoredPredictionOutcomeRow>;
  if (filters.sort === "newest" || filters.sort === "oldest") {
    const direction = filters.sort === "oldest" ? "ASC" : "DESC";
    result = await env.NEWS_DB.prepare(
      `WITH filtered_ids AS MATERIALIZED (
        SELECT prediction_outcomes.id, prediction_outcomes.article_id,
          MAX(unixepoch(prediction_outcomes.prediction_at)) OVER (PARTITION BY prediction_outcomes.article_id) AS latest_prediction_epoch
        ${fromSql}
        WHERE ${clauses.join(" AND ")}
      ), page_ids AS MATERIALIZED (
        SELECT id, article_id, latest_prediction_epoch
        FROM filtered_ids
        ORDER BY latest_prediction_epoch ${direction}, article_id ${direction}, id ${direction}
        LIMIT ? OFFSET ?
      )
      SELECT prediction_outcomes.*,
        (SELECT daily.price FROM prediction_daily_points_v2 AS daily WHERE daily.outcome_id = prediction_outcomes.id ORDER BY daily.day_index DESC LIMIT 1) AS current_price,
        (SELECT daily.sampled_at FROM prediction_daily_points_v2 AS daily WHERE daily.outcome_id = prediction_outcomes.id ORDER BY daily.day_index DESC LIMIT 1) AS current_price_at,
        (SELECT daily.change_pct FROM prediction_daily_points_v2 AS daily WHERE daily.outcome_id = prediction_outcomes.id ORDER BY daily.day_index DESC LIMIT 1) AS current_movement_pct,
        (SELECT daily.change_pct FROM prediction_daily_points_v2 AS daily WHERE daily.outcome_id = prediction_outcomes.id ORDER BY ABS(daily.change_pct) DESC, daily.day_index DESC LIMIT 1) AS peak_movement_pct
      FROM page_ids
      INNER JOIN prediction_outcomes ON prediction_outcomes.id = page_ids.id
      INNER JOIN research_results ON research_results.id = prediction_outcomes.result_id
      LEFT JOIN articles ON articles.id = research_results.article_id
      ORDER BY page_ids.latest_prediction_epoch ${direction}, page_ids.article_id ${direction}, prediction_outcomes.id ${direction}`,
    )
      .bind(...pageBindings)
      .all<StoredPredictionOutcomeRow>();
  } else {
    const orderSql = predictionOutcomeOrderSql(filters.sort);
    result = await env.NEWS_DB.prepare(
      `WITH filtered_outcomes AS (
      SELECT prediction_outcomes.*,
        (SELECT daily.price FROM prediction_daily_points_v2 AS daily WHERE daily.outcome_id = prediction_outcomes.id ORDER BY daily.day_index DESC LIMIT 1) AS current_price,
        (SELECT daily.sampled_at FROM prediction_daily_points_v2 AS daily WHERE daily.outcome_id = prediction_outcomes.id ORDER BY daily.day_index DESC LIMIT 1) AS current_price_at,
        (SELECT daily.change_pct FROM prediction_daily_points_v2 AS daily WHERE daily.outcome_id = prediction_outcomes.id ORDER BY daily.day_index DESC LIMIT 1) AS current_movement_pct,
        (SELECT daily.change_pct FROM prediction_daily_points_v2 AS daily WHERE daily.outcome_id = prediction_outcomes.id ORDER BY ABS(daily.change_pct) DESC, daily.day_index DESC LIMIT 1) AS peak_movement_pct
      ${fromSql}
      WHERE ${clauses.join(" AND ")}
    ), group_metrics AS (
      SELECT article_id,
        MAX(unixepoch(prediction_at)) AS latest_prediction_epoch,
        MAX(current_movement_pct) AS current_max,
        MIN(current_movement_pct) AS current_min,
        MAX(peak_movement_pct) AS peak_max,
        MIN(peak_movement_pct) AS peak_min
      FROM filtered_outcomes
      GROUP BY article_id
    )
    SELECT filtered_outcomes.*
    FROM filtered_outcomes
    INNER JOIN group_metrics ON group_metrics.article_id = filtered_outcomes.article_id
    ORDER BY ${orderSql}
    LIMIT ? OFFSET ?`,
    )
      .bind(...pageBindings)
      .all<StoredPredictionOutcomeRow>();
  }
  const rows = result.results || [];
  const hasMore = rows.length > pageLimit;
  const outcomes = rows.slice(0, pageLimit).map(predictionOutcomeFromStoredRow);
  await attachPredictionDailyPoints(env, outcomes);
  return {
    outcomes,
    next_cursor: hasMore && outcomes.length ? encodePredictionCursor(offset + outcomes.length, filters.sort) : null,
    has_more: hasMore,
    total: Number(count?.count || 0),
  };
}

async function buildPredictionCoverage(env: Env): Promise<Record<string, number>> {
  const [coverage, dateRepair] = await Promise.all([
    env.NEWS_DB.prepare(
      `SELECT COUNT(*) AS predictions, COUNT(DISTINCT prediction_outcomes.article_id) AS articles FROM prediction_outcomes INNER JOIN research_results ON research_results.id = prediction_outcomes.result_id LEFT JOIN articles ON articles.id = research_results.article_id WHERE ${PREDICTION_DATE_MATCH_SQL}`,
    ).first<{ predictions: number; articles: number }>(),
    env.NEWS_DB.prepare(
      "SELECT COUNT(DISTINCT prediction_outcomes.result_id) AS count FROM prediction_outcomes INNER JOIN research_results ON research_results.id = prediction_outcomes.result_id LEFT JOIN articles ON articles.id = research_results.article_id WHERE datetime(prediction_outcomes.prediction_at) != datetime(COALESCE(articles.published_at, research_results.created_at))",
    ).first<{ count: number }>(),
  ]);
  return {
    predictions: Number(coverage?.predictions || 0),
    articles: Number(coverage?.articles || 0),
    date_repair_pending: Number(dateRepair?.count || 0),
  };
}

async function buildPredictionStatusCounts(db: D1Database): Promise<{ count: number }> {
  const row = await db.prepare(
    `WITH ${PREDICTION_ACCURACY_CTE_SQL}
    SELECT COUNT(*) AS count
    FROM accuracy_predictions`,
  ).first<{ count: number }>();
  return {
    count: Number(row?.count || 0),
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
  const [page, summary, dailySummary, coverage] = await Promise.all([
    buildPredictionPage(env, limit, filters),
    buildPredictionSummary(env),
    buildPredictionDailySummary(env),
    buildPredictionCoverage(env),
  ]);

  return {
    ...page,
    summary,
    daily_series: dailySummary.series,
    daily_coverage: dailySummary.coverage,
    coverage,
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
    average_acquisition_delay_seconds: number | null;
    average_post_acquisition_delay_seconds: number | null;
    prediction_delay_samples: number;
    prediction_delay_missing_publication_samples: number;
    average_yahoo_prediction_delay_seconds: number | null;
    average_yahoo_acquisition_delay_seconds: number | null;
    average_yahoo_post_acquisition_delay_seconds: number | null;
    yahoo_prediction_delay_samples: number;
    yahoo_prediction_delay_missing_publication_samples: number;
    estimated_queue_seconds: number | null;
    parallel_capacity: number;
  };
}> {
  const [row, activeJobs] = await Promise.all([db.prepare(
    `SELECT
      SUM(CASE WHEN research_jobs.status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN research_jobs.status = 'running' THEN 1 ELSE 0 END) AS running,
      SUM(CASE WHEN research_jobs.status = 'failed' THEN 1 ELSE 0 END) AS failed,
      AVG(CASE WHEN research_jobs.status = 'succeeded' THEN research_jobs.synthesis_duration_seconds END) AS average_synthesis_seconds,
      SUM(CASE WHEN research_jobs.status = 'succeeded' AND research_jobs.synthesis_duration_seconds IS NOT NULL THEN 1 ELSE 0 END) AS synthesis_samples,
      AVG(CASE WHEN research_jobs.status = 'succeeded' AND research_jobs.prediction_delay_eligible = 1 AND COALESCE(articles.source_id, '') != 'yahoo-finance' THEN research_jobs.prediction_delay_seconds END) AS average_prediction_delay_seconds,
      AVG(CASE WHEN research_jobs.status = 'succeeded' AND research_jobs.prediction_delay_eligible = 1 AND COALESCE(articles.source_id, '') != 'yahoo-finance' AND articles.published_at IS NOT NULL THEN MAX(0, unixepoch(articles.discovered_at) - unixepoch(articles.published_at)) END) AS average_acquisition_delay_seconds,
      AVG(CASE WHEN research_jobs.status = 'succeeded' AND research_jobs.prediction_delay_eligible = 1 AND COALESCE(articles.source_id, '') != 'yahoo-finance' AND research_jobs.finished_at IS NOT NULL THEN MAX(0, unixepoch(research_jobs.finished_at) - unixepoch(articles.discovered_at)) END) AS average_post_acquisition_delay_seconds,
      SUM(CASE WHEN research_jobs.status = 'succeeded' AND research_jobs.prediction_delay_eligible = 1 AND COALESCE(articles.source_id, '') != 'yahoo-finance' AND research_jobs.prediction_delay_seconds IS NOT NULL THEN 1 ELSE 0 END) AS prediction_delay_samples,
      SUM(CASE WHEN research_jobs.status = 'succeeded' AND research_jobs.prediction_delay_eligible = 1 AND COALESCE(articles.source_id, '') != 'yahoo-finance' AND unixepoch(articles.published_at) IS NULL THEN 1 ELSE 0 END) AS prediction_delay_missing_publication_samples,
      AVG(CASE WHEN research_jobs.status = 'succeeded' AND research_jobs.prediction_delay_eligible = 1 AND articles.source_id = 'yahoo-finance' THEN research_jobs.prediction_delay_seconds END) AS average_yahoo_prediction_delay_seconds,
      AVG(CASE WHEN research_jobs.status = 'succeeded' AND research_jobs.prediction_delay_eligible = 1 AND articles.source_id = 'yahoo-finance' AND articles.published_at IS NOT NULL THEN MAX(0, unixepoch(articles.discovered_at) - unixepoch(articles.published_at)) END) AS average_yahoo_acquisition_delay_seconds,
      AVG(CASE WHEN research_jobs.status = 'succeeded' AND research_jobs.prediction_delay_eligible = 1 AND articles.source_id = 'yahoo-finance' AND research_jobs.finished_at IS NOT NULL THEN MAX(0, unixepoch(research_jobs.finished_at) - unixepoch(articles.discovered_at)) END) AS average_yahoo_post_acquisition_delay_seconds,
      SUM(CASE WHEN research_jobs.status = 'succeeded' AND research_jobs.prediction_delay_eligible = 1 AND articles.source_id = 'yahoo-finance' AND research_jobs.prediction_delay_seconds IS NOT NULL THEN 1 ELSE 0 END) AS yahoo_prediction_delay_samples,
      SUM(CASE WHEN research_jobs.status = 'succeeded' AND research_jobs.prediction_delay_eligible = 1 AND articles.source_id = 'yahoo-finance' AND unixepoch(articles.published_at) IS NULL THEN 1 ELSE 0 END) AS yahoo_prediction_delay_missing_publication_samples
    FROM research_jobs
    INNER JOIN articles ON articles.id = research_jobs.article_id`,
  ).first<{
    pending: number | null;
    running: number | null;
    failed: number | null;
    average_synthesis_seconds: number | null;
    synthesis_samples: number | null;
    average_prediction_delay_seconds: number | null;
    average_acquisition_delay_seconds: number | null;
    average_post_acquisition_delay_seconds: number | null;
    prediction_delay_samples: number | null;
    prediction_delay_missing_publication_samples: number | null;
    average_yahoo_prediction_delay_seconds: number | null;
    average_yahoo_acquisition_delay_seconds: number | null;
    average_yahoo_post_acquisition_delay_seconds: number | null;
    yahoo_prediction_delay_samples: number | null;
    yahoo_prediction_delay_missing_publication_samples: number | null;
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
      average_acquisition_delay_seconds: row?.average_acquisition_delay_seconds === null || row?.average_acquisition_delay_seconds === undefined
        ? null
        : Number(row.average_acquisition_delay_seconds),
      average_post_acquisition_delay_seconds: row?.average_post_acquisition_delay_seconds === null || row?.average_post_acquisition_delay_seconds === undefined
        ? null
        : Number(row.average_post_acquisition_delay_seconds),
      prediction_delay_samples: Number(row?.prediction_delay_samples || 0),
      prediction_delay_missing_publication_samples: Number(row?.prediction_delay_missing_publication_samples || 0),
      average_yahoo_prediction_delay_seconds: row?.average_yahoo_prediction_delay_seconds === null || row?.average_yahoo_prediction_delay_seconds === undefined
        ? null
        : Number(row.average_yahoo_prediction_delay_seconds),
      average_yahoo_acquisition_delay_seconds: row?.average_yahoo_acquisition_delay_seconds === null || row?.average_yahoo_acquisition_delay_seconds === undefined
        ? null
        : Number(row.average_yahoo_acquisition_delay_seconds),
      average_yahoo_post_acquisition_delay_seconds: row?.average_yahoo_post_acquisition_delay_seconds === null || row?.average_yahoo_post_acquisition_delay_seconds === undefined
        ? null
        : Number(row.average_yahoo_post_acquisition_delay_seconds),
      yahoo_prediction_delay_samples: Number(row?.yahoo_prediction_delay_samples || 0),
      yahoo_prediction_delay_missing_publication_samples: Number(row?.yahoo_prediction_delay_missing_publication_samples || 0),
      estimated_queue_seconds: averageSynthesisSeconds === null
        ? null
        : Math.ceil(((pending + running) * averageSynthesisSeconds) / RESEARCH_CONTAINER_COUNT),
      parallel_capacity: RESEARCH_CONTAINER_COUNT,
    },
  };
}

async function buildTickerPipelineDiagnostics(env: Env, requestedSince: string | null): Promise<Record<string, unknown>> {
  const parsedSince = requestedSince ? Date.parse(requestedSince) : Number.NaN;
  const since = new Date(Number.isFinite(parsedSince) ? parsedSince : Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const statements = [
    env.NEWS_DB.prepare(
      `SELECT date(datetime(discovered_at, '+10 hours')) AS day,
        COUNT(*) AS articles,
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN status = 'analyzed' THEN 1 ELSE 0 END) AS analyzed,
        SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived
      FROM articles
      WHERE datetime(discovered_at) >= datetime(?)
      GROUP BY day
      ORDER BY day`,
    ).bind(since),
    env.NEWS_DB.prepare(
      `SELECT date(datetime(articles.discovered_at, '+10 hours')) AS day,
        COUNT(*) AS results,
        SUM(CASE WHEN research_results.symbols IS NOT NULL AND trim(research_results.symbols) NOT IN ('', '[]') THEN 1 ELSE 0 END) AS results_with_symbols,
        SUM(CASE WHEN json_valid(research_results.symbols) THEN json_array_length(research_results.symbols) ELSE 0 END) AS ticker_calls,
        SUM(CASE WHEN research_results.symbols IS NULL OR trim(research_results.symbols) IN ('', '[]') THEN 1 ELSE 0 END) AS tickerless_results
      FROM research_results
      INNER JOIN articles ON articles.id = research_results.article_id
      WHERE datetime(articles.discovered_at) >= datetime(?)
      GROUP BY day
      ORDER BY day`,
    ).bind(since),
    env.NEWS_DB.prepare(
      `SELECT date(datetime(research_results.created_at, '+10 hours')) AS day,
        COUNT(*) AS results,
        SUM(CASE WHEN research_results.symbols IS NOT NULL AND trim(research_results.symbols) NOT IN ('', '[]') THEN 1 ELSE 0 END) AS results_with_symbols,
        SUM(CASE WHEN json_valid(research_results.symbols) THEN json_array_length(research_results.symbols) ELSE 0 END) AS ticker_calls,
        SUM(CASE WHEN research_results.symbols IS NULL OR trim(research_results.symbols) IN ('', '[]') THEN 1 ELSE 0 END) AS tickerless_results
      FROM research_results
      WHERE datetime(research_results.created_at) >= datetime(?)
      GROUP BY day
      ORDER BY day`,
    ).bind(since),
    env.NEWS_DB.prepare(
      `SELECT date(datetime(COALESCE(finished_at, queued_at), '+10 hours')) AS day, status, COUNT(*) AS jobs
      FROM research_jobs
      WHERE datetime(COALESCE(finished_at, queued_at)) >= datetime(?)
      GROUP BY day, status
      ORDER BY day, status`,
    ).bind(since),
    env.NEWS_DB.prepare(
      `SELECT date(datetime(updated_at, '+10 hours')) AS day,
        COUNT(*) AS outcomes,
        COUNT(DISTINCT article_id) AS articles,
        MIN(prediction_at) AS earliest_prediction_at,
        MAX(prediction_at) AS latest_prediction_at
      FROM prediction_outcomes
      WHERE datetime(updated_at) >= datetime(?)
      GROUP BY day
      ORDER BY day`,
    ).bind(since),
    env.NEWS_DB.prepare(
      `SELECT date(datetime(scanned_at, '+10 hours')) AS day,
        COUNT(*) AS scanned_results,
        SUM(outcome_count) AS outcomes_recorded,
        SUM(skipped_count) AS symbols_skipped
      FROM prediction_outcome_scans
      WHERE datetime(scanned_at) >= datetime(?)
      GROUP BY day
      ORDER BY day`,
    ).bind(since),
    env.NEWS_DB.prepare(
      `SELECT date(datetime(hour_start, '+10 hours')) AS day,
        SUM(article_count) AS articles,
        SUM(ticker_count) AS ticker_calls
      FROM source_hourly_metrics
      WHERE datetime(hour_start) >= datetime(?)
      GROUP BY day
      ORDER BY day`,
    ).bind(since),
    env.NEWS_DB.prepare(
      `SELECT
        MAX(research_results.created_at) AS latest_result_at,
        MAX(CASE WHEN research_results.symbols IS NOT NULL AND trim(research_results.symbols) NOT IN ('', '[]') THEN research_results.created_at END) AS latest_symbol_result_at,
        MAX(CASE WHEN research_results.symbols IS NOT NULL AND trim(research_results.symbols) NOT IN ('', '[]') THEN articles.discovered_at END) AS latest_symbol_article_discovered_at,
        MAX(CASE WHEN research_results.symbols IS NOT NULL AND trim(research_results.symbols) NOT IN ('', '[]') THEN articles.published_at END) AS latest_symbol_article_published_at
      FROM research_results
      LEFT JOIN articles ON articles.id = research_results.article_id`,
    ),
    env.NEWS_DB.prepare(
      `SELECT
        MAX(updated_at) AS latest_outcome_update_at,
        MAX(prediction_at) AS latest_outcome_prediction_at,
        COUNT(*) AS total_outcomes
      FROM prediction_outcomes`,
    ),
    env.NEWS_DB.prepare(
      `SELECT substr(COALESCE(last_error, 'unknown'), 1, 180) AS reason, COUNT(*) AS failures
      FROM research_jobs
      WHERE status = 'failed' AND datetime(finished_at) >= datetime(?)
      GROUP BY reason
      ORDER BY failures DESC
      LIMIT 10`,
    ).bind(since),
    env.NEWS_DB.prepare(
      `SELECT COUNT(*) AS samples,
        AVG(research_jobs.prediction_delay_seconds) AS average_total_seconds,
        SUM(CASE WHEN research_jobs.prediction_delay_seconds >= 3600 THEN 1 ELSE 0 END) AS over_one_hour,
        SUM(CASE WHEN research_jobs.prediction_delay_seconds >= 21600 THEN 1 ELSE 0 END) AS over_six_hours,
        SUM(CASE WHEN research_jobs.prediction_delay_seconds >= 86400 THEN 1 ELSE 0 END) AS over_one_day,
        (SELECT COUNT(*) FROM research_jobs WHERE prediction_delay_eligible = 2) AS excluded_recovery_jobs
      FROM research_jobs
      INNER JOIN articles ON articles.id = research_jobs.article_id
      WHERE research_jobs.status = 'succeeded'
        AND research_jobs.prediction_delay_eligible = 1
        AND research_jobs.prediction_delay_seconds IS NOT NULL`,
    ),
    env.NEWS_DB.prepare(
      `SELECT COALESCE(sources.name, articles.source_id, 'unknown') AS source,
        COUNT(*) AS samples,
        AVG(research_jobs.prediction_delay_seconds) AS average_total_seconds,
        SUM(research_jobs.prediction_delay_seconds) AS cumulative_delay_seconds
      FROM research_jobs
      INNER JOIN articles ON articles.id = research_jobs.article_id
      LEFT JOIN sources ON sources.id = articles.source_id
      WHERE research_jobs.status = 'succeeded'
        AND research_jobs.prediction_delay_eligible = 1
        AND research_jobs.prediction_delay_seconds IS NOT NULL
      GROUP BY articles.source_id, sources.name
      ORDER BY cumulative_delay_seconds DESC
      LIMIT 12`,
    ),
  ];
  const results = await env.NEWS_DB.batch<Record<string, unknown>>(statements);
  const rows = (index: number) => results[index]?.results || [];
  return {
    ok: true,
    since,
    timezone: "Australia/Brisbane",
    article_cohorts: rows(0),
    results_by_article_cohort: rows(1),
    results_by_completion_day: rows(2),
    jobs_by_completion_day: rows(3),
    outcomes_by_update_day: rows(4),
    outcome_scans_by_day: rows(5),
    source_metrics_by_day: rows(6),
    latest: {
      ...(rows(7)[0] || {}),
      ...(rows(8)[0] || {}),
    },
    recent_failure_reasons: rows(9),
    prediction_delay: rows(10)[0] || {},
    prediction_delay_by_source: rows(11),
  };
}

function predictionFiltersFromUrl(url: URL): PredictionOutcomeFilters {
  const directionValue = url.searchParams.get("direction");
  const direction = directionValue === "bullish" || directionValue === "bearish" ? directionValue : null;
  const sortValue = url.searchParams.get("sort");
  const sort: PredictionOutcomeSort = sortValue === "oldest" || sortValue === "current_desc" || sortValue === "current_asc" || sortValue === "peak_desc" || sortValue === "peak_asc"
    ? sortValue
    : "newest";
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
    sort,
    cursor: url.searchParams.get("cursor"),
  };
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const unauthorized = requireAuthorized(request, env);
  if (unauthorized) return unauthorized;
  const url = new URL(request.url);
  if (request.method !== "GET" && !url.pathname.startsWith("/api/simulation") && !cloudflareHasProcessingAuthority(env)) {
    return json({ error: "processing_authority_moved", processing_authority: "self_hosted" }, { status: 503 });
  }
  await ensureArticleStorageSchema(env.NEWS_DB);

  const limit = Number(url.searchParams.get("limit") || 25);

  if (url.pathname === "/api/status") {
    await archiveTickerlessArticles(env);
    const [articles, jobs, results, predictions, content, operations, latestSourceCheck] = await Promise.all([
      env.NEWS_DB.prepare("SELECT status, COUNT(*) AS count FROM articles WHERE status != 'archived' GROUP BY status").all(),
      env.NEWS_DB.prepare("SELECT research_jobs.status, COUNT(*) AS count FROM research_jobs INNER JOIN articles ON articles.id = research_jobs.article_id WHERE articles.status != 'archived' AND (research_jobs.status != 'succeeded' OR EXISTS (SELECT 1 FROM research_results WHERE research_results.job_id = research_jobs.id AND research_results.symbols IS NOT NULL AND trim(research_results.symbols) NOT IN ('', '[]'))) GROUP BY research_jobs.status").all(),
      env.NEWS_DB.prepare("SELECT COUNT(*) AS count FROM research_results INNER JOIN articles ON articles.id = research_results.article_id WHERE articles.status != 'archived' AND research_results.symbols IS NOT NULL AND trim(research_results.symbols) NOT IN ('', '[]')").first(),
      buildPredictionStatusCounts(env.NEWS_DB),
      env.NEWS_DB.prepare("SELECT content_status AS status, COUNT(*) AS count FROM articles GROUP BY content_status").all(),
      researchOperationsTelemetry(env.NEWS_DB),
      env.NEWS_DB.prepare("SELECT * FROM source_checks ORDER BY datetime(checked_at) DESC LIMIT 1").first<SourceCheckRow>(),
    ]);
    return json({ ok: true, articles: articles.results, jobs: jobs.results, results, predictions, content: content.results, timing: operations.timing, latest_source_check: latestSourceCheck, configured_source_count: SOURCES.length });
  }

  if (url.pathname === "/api/status/live") {
    const [operations, latestSourceCheck] = await Promise.all([
      researchOperationsTelemetry(env.NEWS_DB),
      env.NEWS_DB.prepare("SELECT * FROM source_checks ORDER BY datetime(checked_at) DESC LIMIT 1").first<SourceCheckRow>(),
    ]);
    return json({ ok: true, ...operations, latest_source_check: latestSourceCheck, configured_source_count: SOURCES.length });
  }

  if (url.pathname === "/api/diagnostics/ticker-pipeline") {
    return json(await buildTickerPipelineDiagnostics(env, url.searchParams.get("since")));
  }

  if (url.pathname === "/api/source-checks") {
    return json({
      ok: true,
      checks: await listRows<SourceCheckRow>(
        env.NEWS_DB,
        "SELECT * FROM source_checks ORDER BY datetime(checked_at) DESC LIMIT ?",
        limit,
      ),
    });
  }

  if (url.pathname === "/api/source-check-details") {
    const requestedCheckId = url.searchParams.get("check_id");
    const latestCheck = requestedCheckId
      ? { id: requestedCheckId }
      : await env.NEWS_DB.prepare("SELECT id FROM source_checks ORDER BY datetime(checked_at) DESC LIMIT 1").first<{ id: string }>();
    if (!latestCheck?.id) return json({ ok: true, check_id: null, sources: [] });
    const details = await env.NEWS_DB.prepare(
      "SELECT source_check_details.*, sources.name, sources.url FROM source_check_details LEFT JOIN sources ON sources.id = source_check_details.source_id WHERE source_check_details.check_id = ? ORDER BY source_check_details.new_item_count DESC, sources.name",
    )
      .bind(latestCheck.id)
      .all();
    return json({ ok: true, check_id: latestCheck.id, sources: details.results || [] });
  }

  if (url.pathname === "/api/sources") {
    await seedSources(env.NEWS_DB);
    return json({ ok: true, sources: await listRows(env.NEWS_DB, "SELECT * FROM sources ORDER BY weight DESC, name ASC LIMIT ?", Math.max(limit, SOURCES.length)) });
  }

  if (url.pathname === "/api/source-stats") {
    await seedSources(env.NEWS_DB);
    return json({ ok: true, sources: await buildSourceStats(env) });
  }

  if (url.pathname === "/api/source-activity") {
    const requestedMode = url.searchParams.get("mode");
    const mode: SourceActivityMode = requestedMode === "month" || requestedMode === "year" ? requestedMode : "day";
    return json(await buildSourceActivity(env, mode, url.searchParams.get("anchor")));
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

  if (url.pathname === "/api/corpus/status") {
    return json({ ok: true, ...(await articleCorpusStatus(env.NEWS_DB)) });
  }

  if (url.pathname === "/api/corpus/objects") {
    const status = url.searchParams.get("status");
    const statusFilter = status ? " AND article_corpus_objects.storage_status = ?" : "";
    const query = `SELECT article_corpus_objects.*, articles.title, articles.url, articles.published_at,
      articles.source_id, sources.name AS source_name
      FROM article_corpus_objects
      INNER JOIN articles ON articles.id = article_corpus_objects.article_id
      LEFT JOIN sources ON sources.id = articles.source_id
      WHERE 1 = 1${statusFilter}
      ORDER BY datetime(article_corpus_objects.updated_at) DESC LIMIT ?`;
    const statement = status
      ? env.NEWS_DB.prepare(query).bind(status, Math.min(Math.max(limit, 1), 500))
      : env.NEWS_DB.prepare(query).bind(Math.min(Math.max(limit, 1), 500));
    const objects = await statement.all<ArticleCorpusIndexRow & { title: string; url: string; published_at: string | null; source_id: string; source_name: string | null }>();
    return json({ ok: true, objects: objects.results || [] });
  }

  if (url.pathname === "/api/corpus/article") {
    const articleId = url.searchParams.get("id");
    if (!articleId) return json({ error: "Missing article id" }, { status: 400 });
    const corpus = await env.NEWS_DB.prepare(
      "SELECT * FROM article_corpus_objects WHERE article_id = ?",
    ).bind(articleId).first<ArticleCorpusIndexRow>();
    if (!corpus || corpus.storage_status !== "stored" || !corpus.object_key) {
      return json({ error: "Article corpus object is not available", corpus: corpus || null }, { status: 404 });
    }
    const object = await env.ARTICLE_CORPUS.get(corpus.object_key);
    if (!object) return json({ error: "Article corpus object is missing from R2", corpus }, { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "private, no-store");
    return new Response(object.body, { headers });
  }

  if (url.pathname === "/api/corpus/backfill" && request.method === "POST") {
    if (url.searchParams.get("retry_failed") === "1") {
      await env.NEWS_DB.prepare(
        "UPDATE article_corpus_objects SET storage_status = 'pending', storage_attempts = 0, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE storage_status = 'failed'",
      ).run();
    }
    return json({ ok: true, ...(await archiveArticleCorpusBatch(env, limit)) });
  }

  if (url.pathname === "/api/articles/backfill" && request.method === "POST") {
    return json({ ok: true, ...(await backfillArticleContents(env, limit)) });
  }

  if (url.pathname === "/api/articles/purge-stale-backfill" && request.method === "POST") {
    return json({ ok: true, ...(await purgeStaleHistoricalBackfill(env)) });
  }

  if (url.pathname === "/api/articles/archive" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { article_id?: unknown; reason?: unknown };
    const articleId = typeof body.article_id === "string" ? body.article_id.trim() : "";
    if (!articleId) return json({ error: "Missing article_id" }, { status: 400 });
    const reason = typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : "Archived manually with derived prediction data removed";
    const archived = await archiveArticleAndRemoveDerivedData(env, articleId, reason);
    return archived ? json({ ok: true, ...archived }) : json({ error: "Article not found" }, { status: 404 });
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

  if (url.pathname === "/api/jobs/failures") {
    return json({
      ok: true,
      jobs: await listRows(
        env.NEWS_DB,
        "SELECT research_jobs.*, articles.title, articles.url, articles.published_at FROM research_jobs INNER JOIN articles ON articles.id = research_jobs.article_id WHERE research_jobs.status = 'failed' AND articles.status = 'archived' ORDER BY datetime(research_jobs.finished_at) DESC, datetime(research_jobs.queued_at) DESC LIMIT ?",
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

  if (url.pathname === "/api/predictions/summary") {
    const [summary, coverage] = await Promise.all([
      buildPredictionSummary(env),
      buildPredictionCoverage(env),
    ]);
    return json({ ok: true, summary, coverage });
  }

  if (url.pathname === "/api/predictions/daily") {
    const daily = await buildPredictionDailySummary(env);
    return json({ ok: true, daily_series: daily.series, daily_coverage: daily.coverage });
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

  if (url.pathname === "/api/model-experiments" && request.method === "GET") {
    return json({ ok: true, ...(await modelExperimentStatus(env, url.searchParams.get("id") || undefined)) });
  }

  if (url.pathname === "/api/model-experiments/start" && request.method === "POST") {
    const body = await request.json().catch(() => ({})) as { email_to?: unknown };
    const emailTo = typeof body.email_to === "string" ? body.email_to.trim() : null;
    try {
      return json({ ok: true, ...(await startModelExperiment(env, emailTo)) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
    }
  }

  if (url.pathname === "/api/model-experiments/dispatch" && request.method === "POST") {
    return json({ ok: true, ...(await advanceModelExperiment(env, url.searchParams.get("id") || undefined)) });
  }

  if (url.pathname === "/api/model-experiments/email" && request.method === "POST") {
    const body = await request.json().catch(() => ({})) as { experiment_id?: unknown; email_to?: unknown };
    const experimentId = typeof body.experiment_id === "string" ? body.experiment_id.trim() : "";
    const emailTo = typeof body.email_to === "string" ? body.email_to.trim() : "";
    if (!experimentId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo)) {
      return json({ error: "A valid experiment_id and email_to are required" }, { status: 400 });
    }
    await ensureModelExperimentSchema(env.NEWS_DB);
    await env.NEWS_DB.prepare(
      "UPDATE model_experiments SET email_to = ?, email_status = CASE WHEN status = 'completed' THEN 'pending' ELSE email_status END, email_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(emailTo, experimentId).run();
    const experiment = await env.NEWS_DB.prepare("SELECT * FROM model_experiments WHERE id = ?")
      .bind(experimentId).first<ModelExperimentRow>();
    if (!experiment) return json({ error: "Experiment not found" }, { status: 404 });
    if (experiment.status === "completed") await sendModelExperimentReport(env, experiment);
    return json({ ok: true, ...(await modelExperimentStatus(env, experimentId)) });
  }

  if (url.pathname === "/api/model-experiments/email/test" && request.method === "POST") {
    const body = await request.json().catch(() => ({})) as { experiment_id?: unknown; email_to?: unknown };
    const experimentId = typeof body.experiment_id === "string" ? body.experiment_id.trim() : "";
    const emailTo = typeof body.email_to === "string" ? body.email_to.trim() : "";
    if (!experimentId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo)) {
      return json({ error: "A valid experiment_id and email_to are required" }, { status: 400 });
    }
    await ensureModelExperimentSchema(env.NEWS_DB);
    const updated = await env.NEWS_DB.prepare(
      "UPDATE model_experiments SET email_to = ?, email_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(emailTo, experimentId).run();
    if (!updated.meta?.changes) return json({ error: "Experiment not found" }, { status: 404 });
    try {
      const sent = await sendExperimentEmail(
        env,
        emailTo,
        "Cartdotcom email delivery test",
        "This is a test from the Cartdotcom news-signal model experiment. Email delivery is configured correctly.",
      );
      return json({ ok: true, provider: sent.provider, message_id: sent.messageId });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
    }
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

  if (url.pathname === "/api/process-batch" && request.method === "POST") {
    return json({ ok: true, ...(await drainResearchBacklogConcurrently(env)) });
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

  if (url.pathname === "/api/research/remediate-failed" && request.method === "POST") {
    return json({ ok: true, ...(await remediateFailedResearchJobs(env)) });
  }

  if (url.pathname === "/api/research/auth/rotate" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { auth_json?: unknown };
    const authJson = typeof body.auth_json === "string" ? body.auth_json.trim() : "";
    if (!authJson) return json({ error: "Select a Codex auth.json file." }, { status: 400 });
    if (authJson.length > 100_000) return json({ error: "The selected auth file is unexpectedly large." }, { status: 413 });
    try {
      await replacePersistedCodexAuth(env, authJson);
      const containers = await recycleResearchContainers(env);
      const normalized = await normalizeResearchJobConcurrency(env, true);
      const recovery = await recoverCodexAuthFailedResearchJobs(env);
      const queue = await requeuePendingJobs(env, 100);
      await publishDashboardEvent(env, { type: "research_deferred", at: new Date().toISOString() });
      return json({ ok: true, ...containers, ...normalized, ...recovery, ...queue });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
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

export class DashboardEventHub extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/publish" && request.method === "POST") {
      const payload = await request.text();
      let delivered = 0;
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(payload);
          delivered += 1;
        } catch {
          socket.close(1011, "Event delivery failed");
        }
      }
      return json({ ok: true, delivered });
    }

    if (url.pathname !== "/subscribe" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "WebSocket upgrade required" }, { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ type: "connected", at: new Date().toISOString() } satisfies DashboardEvent));
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "sec-websocket-protocol": "news-signal" },
    });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (message === "ping") socket.send("pong");
  }

  webSocketClose(socket: WebSocket, code: number, reason: string, _wasClean: boolean): void {
    socket.close(code, reason);
  }

  webSocketError(socket: WebSocket, _error: unknown): void {
    socket.close(1011, "WebSocket error");
  }
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

    if (url.pathname === "/api/internal/dashboard-snapshot" && request.method === "POST") {
      return storeDashboardSnapshot(request, env);
    }

    if (url.pathname === "/api/internal/offsite-object" && request.method === "POST") {
      return storeOffsiteObject(request, env);
    }

    if (url.pathname === "/api/internal/offsite-object" && request.method === "GET") {
      return retrieveOffsiteBackupObject(request, env);
    }

    if (url.pathname === "/api/snapshot/status" && request.method === "GET") {
      const unauthorized = requireAuthorized(request, env);
      if (unauthorized) return unauthorized;
      return dashboardSnapshotStatus(env);
    }

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "cartdotcom-news-signal-container",
        processing_authority: cloudflareHasProcessingAuthority(env) ? "cloudflare" : "self_hosted",
        self_hosted_proxy_enabled: selfHostedApiConfigured(env),
        self_hosted_binding_configured: Boolean(env.SELF_HOSTED_API),
        routes: [
          "/dashboard",
          "/health",
          "/api/status",
          "/api/status/live",
          "/api/snapshot/status",
          "/api/diagnostics/ticker-pipeline?since=ISO_TIMESTAMP",
          "/api/events",
          "/api/source-checks",
          "/api/source-check-details?check_id=CHECK_ID",
          "/api/source-stats",
          "/api/source-activity?mode=day|month|year&anchor=YYYY-MM-DD",
          "/api/ingest",
          "/api/articles",
          "/api/articles/content?id=ARTICLE_ID",
          "/api/articles/backfill",
          "/api/corpus/status",
          "/api/corpus/objects?status=stored&limit=100",
          "/api/corpus/article?id=ARTICLE_ID",
          "/api/corpus/backfill?limit=50",
          "/api/articles/purge-stale-backfill",
          "/api/articles/archive",
          "/api/jobs",
          "/api/jobs/failures",
          "/api/results",
          "/api/ticker-signals",
          "/api/predictions",
          "/api/predictions/summary",
          "/api/predictions/daily",
          "/api/predictions/outcomes",
          "/api/predictions/process",
          "/api/model-experiments",
          "/api/model-experiments/start",
          "/api/model-experiments/dispatch",
          "/api/model-experiments/email",
          "/api/model-experiments/email/test",
          "/api/process-batch",
          "/api/research/recover",
          "/api/research/auth/rotate",
          "/api/research/remediate-failed",
          "/api/research/reset-first-pass-queue",
          "/api/reanalyze-recent",
          "/api/reanalyze-legacy",
          "/container/health",
          "/container/mcp-check",
          "/container/research",
        ],
      });
    }

    if (url.pathname === "/api/events") {
      const unauthorized = requireAuthorized(request, env);
      if (unauthorized) return unauthorized;
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return json({ error: "WebSocket upgrade required" }, { status: 426 });
      }
      if (selfHostedApiConfigured(env)) return proxySelfHostedApi(request, env);
      const id = env.DASHBOARD_EVENTS.idFromName("news-signal-dashboard");
      return env.DASHBOARD_EVENTS.get(id).fetch(new Request("https://dashboard-events.internal/subscribe", request));
    }

    if (url.pathname.startsWith("/api/")) {
      if (selfHostedApiConfigured(env)) {
        const unauthorized = requireAuthorized(request, env);
        if (unauthorized) return unauthorized;
        return proxySelfHostedApi(request, env);
      }
      return handleApi(request, env);
    }
    if (url.pathname.startsWith("/container/")) return handleContainer(request, env);

    return json({ error: "Not found" }, { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!cloudflareHasProcessingAuthority(env)) {
      console.log("Scheduled processing skipped because authority is self-hosted.");
      return;
    }
    const scheduledAt = Math.floor(event.scheduledTime / SOURCE_CHECK_INTERVAL_MS) * SOURCE_CHECK_INTERVAL_MS;
    ctx.waitUntil(
      ingestFeeds(env, scheduledAt).then(async () => {
        await normalizeResearchJobConcurrency(env);
        await pruneLegacyFirstPassBacklog(env.NEWS_DB);
        await archiveTickerlessArticles(env);
        await requeuePendingJobs(env, 25);
        await Promise.all([
          drainResearchBacklogConcurrently(env).catch((error) => console.error("Scheduled research backlog drain failed", error)),
          backfillArticleContents(env, 20).catch((error) => console.error("Scheduled article content backfill failed", error)),
          archiveArticleCorpusBatch(env, ARTICLE_CORPUS_BACKFILL_BATCH).catch((error) => console.error("Scheduled article corpus backfill failed", error)),
          processPredictionOutcomes(env, 100).catch((error) => console.error("Scheduled prediction outcome processing failed", error)),
          advanceModelExperiment(env).catch((error) => console.error("Scheduled model experiment advancement failed", error)),
        ]);
      }),
    );
  },

  async queue(batch: MessageBatch<ResearchJobMessage>, env: Env): Promise<void> {
    if (!cloudflareHasProcessingAuthority(env)) {
      for (const message of batch.messages) message.ack();
      console.log(`Discarded ${batch.messages.length} migrated queue message(s) after authority moved to self-hosted.`);
      return;
    }
    for (const message of batch.messages) {
      try {
        if (message.body.kind === "model_experiment") {
          await processModelExperimentJob(env, message.body.jobId);
        } else {
          await processJob(env, message.body.jobId);
        }
        message.ack();
        await drainResearchBacklog(env);
        await advanceModelExperiment(env);
      } catch (error) {
        if (error instanceof ResearchBusyError) {
          const authPending = /authentication/i.test(error.message);
          const productionPriority = /production research/i.test(error.message);
          message.retry({ delaySeconds: authPending ? 30 : productionPriority ? 15 : 5 });
          if (!authPending) await drainResearchBacklog(env);
          continue;
        }
        throw error;
      }
    }
  },
};
