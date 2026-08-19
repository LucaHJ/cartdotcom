import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import pg from "pg";
import { hasLocalProcessingAuthority, processingAuthority } from "../common/authority.js";
import { normalizePlaintext } from "../common/content.js";

const { Pool } = pg;
const ENABLED = /^(1|true|yes)$/i.test(process.env.CORPUS_ARCHIVER_ENABLED || "false");
const ROOT = resolve(process.env.ARTICLE_CORPUS_ROOT || "/data/article-corpus");
const HEALTH_PORT = Number(process.env.HEALTH_PORT || 3005);
const MAX_ATTEMPTS = 3;
const BATCH_SIZE = Math.max(1, Math.min(25, Number(process.env.CORPUS_ARCHIVER_BATCH_SIZE || 10)));
const SCHEMA_VERSION = 1;
const EXTRACTION_VERSION = "2026-08-19.self-hosted.1";
const mirrorUrl = String(process.env.CORPUS_MIRROR_URL || "").trim();
const offsiteToken = process.env.OFFSITE_BACKUP_TOKEN_FILE
  ? (await readFile(process.env.OFFSITE_BACKUP_TOKEN_FILE, "utf8")).trim()
  : "";
const runtime = { enabled: ENABLED, status: "starting", authority: "unknown", stored: 0, mirrored: 0, failed: 0, remaining: null, mirrorRemaining: null, lastError: null };

async function databaseConfig() {
  const password = process.env.PGPASSWORD_FILE
    ? (await readFile(process.env.PGPASSWORD_FILE, "utf8")).trim()
    : process.env.PGPASSWORD;
  return {
    host: process.env.PGHOST || "postgres",
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "cartdotcom",
    user: process.env.PGUSER || "cartdotcom",
    password,
    max: 4,
  };
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function datePath(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "undated";
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0")].join("/");
}

function safeId(value) {
  return String(value || "article").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "article";
}

async function pendingArticles(pool) {
  const result = await pool.query(
    `SELECT articles.id, articles.source_id, articles.title, articles.url, articles.summary,
       articles.published_at, articles.discovered_at, articles.content_plaintext,
       articles.content_source, articles.content_status, articles.content_fetched_at,
       articles.content_fetch_attempts, articles.content_error,
       sources.name AS source_name, sources.source_type, sources.category AS source_category,
       sources.weight AS source_weight, jobs.id AS research_job_id,
       jobs.finished_at AS research_job_finished_at, results.id AS research_result_id,
       results.created_at AS research_result_created_at, results.event_type,
       results.companies, results.industries, results.symbols, results.sentiment_score,
       results.impact_horizon, results.confidence, results.summary AS analysis_summary,
       results.memo
     FROM article_corpus_objects AS corpus
     INNER JOIN articles ON articles.id = corpus.article_id
     INNER JOIN research_jobs AS jobs ON jobs.article_id = articles.id AND jobs.status = 'succeeded'
     LEFT JOIN research_results AS results ON results.job_id = jobs.id
     WHERE corpus.storage_status = 'pending'
        OR (corpus.storage_status = 'failed' AND corpus.storage_attempts < $1)
     ORDER BY CASE WHEN corpus.storage_status = 'pending' THEN 0 ELSE 1 END,
       jobs.finished_at DESC NULLS LAST
     LIMIT $2`,
    [MAX_ATTEMPTS, BATCH_SIZE],
  );
  return result.rows;
}

async function archive(pool, article) {
  const plaintext = normalizePlaintext(article.content_plaintext || article.summary || "", 3_000_000);
  const contentSha256 = createHash("sha256").update(plaintext).digest("hex");
  const storedAt = new Date().toISOString();
  const document = {
    schema_version: SCHEMA_VERSION,
    extraction_version: EXTRACTION_VERSION,
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
      source: article.content_source || (plaintext ? "feed" : "missing"),
      status: article.content_status,
      fetched_at: article.content_fetched_at,
      fetch_attempts: Number(article.content_fetch_attempts || 0),
      error: article.content_error,
      truncated: plaintext.length >= 3_000_000,
    },
    analysis: article.research_result_id ? {
      research_job_id: article.research_job_id,
      research_result_id: article.research_result_id,
      synthesized_at: article.research_result_created_at || article.research_job_finished_at,
      event_type: article.event_type,
      companies: parseArray(article.companies),
      industries: parseArray(article.industries),
      symbols: parseArray(article.symbols),
      sentiment_score: article.sentiment_score,
      impact_horizon: article.impact_horizon,
      confidence: article.confidence,
      summary: article.analysis_summary,
      memo: article.memo,
    } : null,
  };
  const encoded = JSON.stringify(document);
  const objectKey = `articles/${datePath(article.published_at || article.discovered_at)}/${safeId(article.id)}/${contentSha256}.json`;
  const finalPath = resolve(ROOT, objectKey);
  if (!finalPath.startsWith(`${ROOT}/`)) throw new Error("Generated corpus path escaped the storage root.");
  const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;
  await mkdir(dirname(finalPath), { recursive: true });
  await writeFile(temporaryPath, encoded, { encoding: "utf8", mode: 0o640, flag: "wx" });
  await rename(temporaryPath, finalPath);
  await pool.query(
    `UPDATE article_corpus_objects SET object_key = $2, content_sha256 = $3,
       content_chars = $4, object_bytes = $5, storage_status = 'stored',
       storage_attempts = storage_attempts + 1, schema_version = $6,
       extraction_version = $7, stored_at = $8, last_attempt_at = CURRENT_TIMESTAMP,
       offsite_status = 'pending', offsite_error = NULL,
       last_error = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE article_id = $1`,
    [article.id, objectKey, contentSha256, plaintext.length, Buffer.byteLength(encoded), SCHEMA_VERSION, EXTRACTION_VERSION, storedAt],
  );
}

async function pendingMirrors(pool) {
  const result = await pool.query(
    `SELECT article_id, object_key, content_sha256
     FROM article_corpus_objects
     WHERE storage_status = 'stored' AND object_key IS NOT NULL
       AND offsite_status IN ('pending', 'failed') AND offsite_attempts < $1
     ORDER BY updated_at, article_id
     LIMIT $2`,
    [MAX_ATTEMPTS, BATCH_SIZE],
  );
  return result.rows;
}

async function mirror(pool, object) {
  if (!mirrorUrl || !offsiteToken) throw new Error("Off-site corpus mirror is not configured.");
  const sourcePath = resolve(ROOT, object.object_key);
  if (!sourcePath.startsWith(`${ROOT}/`)) throw new Error("Corpus object path escaped the storage root.");
  const body = await readFile(sourcePath);
  const objectHash = createHash("sha256").update(body).digest("hex");
  const response = await fetch(mirrorUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${offsiteToken}`,
      "content-type": "application/json",
      "x-object-key": object.object_key,
      "x-content-sha256": objectHash,
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Off-site mirror returned HTTP ${response.status}`);
  await pool.query(
    `UPDATE article_corpus_objects SET offsite_status = 'stored',
       offsite_attempts = offsite_attempts + 1, offsite_at = CURRENT_TIMESTAMP,
       offsite_error = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE article_id = $1`,
    [object.article_id],
  );
}

async function markMirrorFailure(pool, articleId, error) {
  await pool.query(
    `UPDATE article_corpus_objects SET offsite_status = 'failed',
       offsite_attempts = offsite_attempts + 1, offsite_error = $2,
       updated_at = CURRENT_TIMESTAMP WHERE article_id = $1`,
    [articleId, String(error).slice(0, 1000)],
  );
}

async function markFailure(pool, articleId, error) {
  await pool.query(
    `UPDATE article_corpus_objects SET storage_status = 'failed',
       storage_attempts = storage_attempts + 1, last_attempt_at = CURRENT_TIMESTAMP,
       last_error = $2, updated_at = CURRENT_TIMESTAMP
     WHERE article_id = $1`,
    [articleId, String(error).slice(0, 1000)],
  );
}

async function processBatch(pool) {
  if (!ENABLED || !await hasLocalProcessingAuthority(pool)) {
    const authority = await processingAuthority(pool);
    runtime.authority = authority.owner;
    runtime.status = ENABLED ? "standby-authority" : "disabled";
    return;
  }
  runtime.authority = "self_hosted";
  runtime.status = "working";
  const articles = await pendingArticles(pool);
  for (const article of articles) {
    try {
      await archive(pool, article);
      runtime.stored += 1;
      runtime.lastError = null;
    } catch (error) {
      runtime.failed += 1;
      runtime.lastError = error instanceof Error ? error.message : String(error);
      await markFailure(pool, article.id, runtime.lastError).catch(() => {});
    }
  }
  const mirrors = await pendingMirrors(pool);
  for (const object of mirrors) {
    try {
      await mirror(pool, object);
      runtime.mirrored += 1;
      runtime.lastError = null;
    } catch (error) {
      runtime.failed += 1;
      runtime.lastError = error instanceof Error ? error.message : String(error);
      await markMirrorFailure(pool, object.article_id, runtime.lastError).catch(() => {});
    }
  }
  const counts = await pool.query(`
    SELECT
      count(*) FILTER (WHERE storage_status != 'stored')::integer AS local_remaining,
      count(*) FILTER (WHERE storage_status = 'stored' AND offsite_status != 'stored')::integer AS mirror_remaining
    FROM article_corpus_objects
  `);
  runtime.remaining = counts.rows[0].local_remaining;
  runtime.mirrorRemaining = counts.rows[0].mirror_remaining;
  runtime.status = "idle";
}

function startHealthServer() {
  createServer((request, response) => {
    if (request.url !== "/healthz") return response.writeHead(404).end("not found");
    response.writeHead(runtime.status === "starting" ? 503 : 200, { "content-type": "application/json" });
    response.end(JSON.stringify(runtime));
  }).listen(HEALTH_PORT, "0.0.0.0");
}

async function main() {
  const pool = new Pool(await databaseConfig());
  startHealthServer();
  await processBatch(pool);
  const timer = setInterval(() => processBatch(pool).catch((error) => {
    runtime.status = "degraded";
    runtime.lastError = error instanceof Error ? error.message : String(error);
  }), 5000);
  const shutdown = async () => {
    clearInterval(timer);
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  console.error("Corpus archiver failed to start", error);
  process.exit(1);
});
