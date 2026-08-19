import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ACCOUNT_ID = "59effd14cb12e91e3486304a934e395d";
const BUCKET = "cartdotcom-news-article-corpus";
const outputRoot = path.resolve(process.argv[2] || "./cartdotcom-article-corpus");
const concurrency = Math.max(1, Math.min(32, Number(process.env.CORPUS_EXPORT_CONCURRENCY || 16)));
const limit = Math.max(0, Number(process.env.CORPUS_EXPORT_LIMIT || 0));
const proxyBaseUrl = process.env.CORPUS_EXPORT_PROXY_URL || null;
const proxyToken = process.env.CORPUS_EXPORT_PROXY_TOKEN || null;
const verifyExisting = process.env.CORPUS_EXPORT_VERIFY_EXISTING === "1";
const authPath = process.env.WRANGLER_AUTH_FILE
  || path.join(process.env.APPDATA || "", "xdg.config", ".wrangler", "config", "default.toml");

function tomlString(source, key) {
  return source.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"))?.[1] || null;
}

async function loadOAuthState() {
  const source = await readFile(authPath, "utf8");
  const token = tomlString(source, "oauth_token");
  const expiration = tomlString(source, "expiration_time");
  if (!token) throw new Error("Wrangler OAuth token was not found. Run wrangler login first.");
  return { token, expiresAt: expiration ? Date.parse(expiration) : Number.POSITIVE_INFINITY };
}

const apiToken = process.env.CLOUDFLARE_API_TOKEN || null;
let oauthState = null;
if (!proxyBaseUrl) {
  try {
    oauthState = await loadOAuthState();
  } catch (error) {
    if (!apiToken) throw error;
  }
} else if (!proxyToken) {
  throw new Error("CORPUS_EXPORT_PROXY_TOKEN is required when using CORPUS_EXPORT_PROXY_URL.");
}
let refreshPromise = null;
async function currentToken(forceRefresh = false) {
  if (!oauthState) return apiToken;
  if (!forceRefresh && Date.now() < oauthState.expiresAt) return oauthState.token;
  if (!refreshPromise) {
    refreshPromise = Promise.resolve().then(async () => {
      const command = process.env.WRANGLER_BIN || (process.platform === "win32" ? "npx.cmd" : "npx");
      const environment = { ...process.env };
      delete environment.CLOUDFLARE_API_TOKEN;
      const result = spawnSync(command, ["wrangler", "whoami"], {
        cwd: process.env.WRANGLER_CWD || process.cwd(),
        env: environment,
        encoding: "utf8",
        timeout: 120000,
      });
      if (result.status !== 0) throw new Error("Wrangler could not refresh its OAuth session.");
      oauthState = await loadOAuthState();
      return oauthState.token;
    }).finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

function loadManifest() {
  const sql = `SELECT json_build_object(
    'article_id', article_id,
    'object_key', object_key,
    'object_bytes', object_bytes,
    'content_sha256', content_sha256
  ) FROM article_corpus_objects
  WHERE storage_status = 'stored' AND object_key IS NOT NULL
  ORDER BY object_key`;
  const command = `cd /srv/platform && docker compose exec -T postgres psql -U cartdotcom -d cartdotcom -Atc "${sql.replaceAll('"', '\\"')}"`;
  const result = spawnSync("ssh", ["cartdotcom-server", command], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Could not read corpus manifest: ${result.stderr || result.stdout}`);
  const rows = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  return limit ? rows.slice(0, limit) : rows;
}

function objectUrl(key) {
  if (proxyBaseUrl) {
    const url = new URL("/object", proxyBaseUrl);
    url.searchParams.set("key", key);
    return url.toString();
  }
  const encoded = key.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${encoded}`;
}

async function requestObject(key, forceRefresh = false) {
  if (proxyBaseUrl) {
    return fetch(objectUrl(key), {
      headers: { "x-migration-token": proxyToken, "user-agent": "cartdotcom-r2-migration/0.1" },
      signal: AbortSignal.timeout(30000),
    });
  }
  const token = await currentToken(forceRefresh);
  return fetch(objectUrl(key), {
    headers: { authorization: `Bearer ${token}`, "user-agent": "cartdotcom-r2-migration/0.1" },
    signal: AbortSignal.timeout(30000),
  });
}

function localPath(key) {
  const destination = path.resolve(outputRoot, ...key.split("/"));
  const relative = path.relative(outputRoot, destination);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Unsafe object key: ${key}`);
  return destination;
}

function corpusContentSha256(body) {
  const document = JSON.parse(body.toString("utf8"));
  const plaintext = document?.content?.plaintext || "";
  return createHash("sha256").update(plaintext).digest("hex");
}

async function alreadyComplete(destination, expectedBytes, expectedSha256) {
  try {
    const info = await stat(destination);
    if (!info.isFile() || (expectedBytes && info.size !== expectedBytes)) return false;
    if (verifyExisting && expectedSha256) {
      const body = await readFile(destination);
      return corpusContentSha256(body) === expectedSha256.toLowerCase();
    }
    return true;
  } catch {
    return false;
  }
}

async function download(row) {
  const destination = localPath(row.object_key);
  const expectedBytes = Number(row.object_bytes || 0);
  const expectedSha256 = row.content_sha256 || null;
  if (await alreadyComplete(destination, expectedBytes, expectedSha256)) return "skipped";
  await mkdir(path.dirname(destination), { recursive: true });
  const partial = `${destination}.part`;
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      let response = await requestObject(row.object_key);
      if (!proxyBaseUrl && response.status === 401) {
        response = await requestObject(row.object_key, true);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (expectedBytes && body.length !== expectedBytes) {
        throw new Error(`size mismatch: expected ${expectedBytes}, received ${body.length}`);
      }
      if (expectedSha256) {
        const actualSha256 = corpusContentSha256(body);
        if (actualSha256 !== expectedSha256.toLowerCase()) {
          throw new Error(`content SHA-256 mismatch: expected ${expectedSha256}, received ${actualSha256}`);
        }
      }
      await writeFile(partial, body, { mode: 0o600 });
      await rename(partial, destination);
      return "downloaded";
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
    }
  }
  throw lastError;
}

await mkdir(outputRoot, { recursive: true });
const manifest = loadManifest();
const startedAt = Date.now();
let nextIndex = 0;
let downloaded = 0;
let skipped = 0;
const failures = [];

const workers = Array.from({ length: Math.min(concurrency, manifest.length) }, async () => {
  while (nextIndex < manifest.length) {
    const index = nextIndex;
    nextIndex += 1;
    const row = manifest[index];
    try {
      const disposition = await download(row);
      if (disposition === "downloaded") downloaded += 1;
      else skipped += 1;
    } catch (error) {
      failures.push({ object_key: row.object_key, error: error instanceof Error ? error.message : String(error) });
    }
    const completed = downloaded + skipped + failures.length;
    if (completed % 250 === 0 || completed === manifest.length) {
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      console.log(JSON.stringify({ completed, total: manifest.length, downloaded, skipped, failed: failures.length, objects_per_second: Number((completed / elapsedSeconds).toFixed(2)) }));
    }
  }
});
await Promise.all(workers);

await writeFile(path.join(outputRoot, "export-state.json"), JSON.stringify({
  bucket: BUCKET,
  completed_at: new Date().toISOString(),
  expected_objects: manifest.length,
  downloaded,
  skipped,
  failures,
}, null, 2), { mode: 0o600 });

if (failures.length) throw new Error(`${failures.length} R2 object(s) failed. Re-run the exporter to resume.`);
console.log(`R2 corpus export complete: ${manifest.length} objects in ${outputRoot}`);
