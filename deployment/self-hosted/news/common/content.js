const MAX_RESPONSE_CHARS = 3_000_000;
const ARTICLE_CONTENT_MAX_CHARS = 120_000;

export function normalizePlaintext(value, maxChars = ARTICLE_CONTENT_MAX_CHARS) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}

export function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;|&mdash;/g, "-")
    .replace(/&hellip;/g, "...")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function stripHtml(value) {
  return normalizePlaintext(
    decodeHtmlEntities(String(value || "")
      .replace(/<(script|style|svg|nav|footer|header|aside|form|noscript|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(p|div|section|article|main|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, " ")),
    MAX_RESPONSE_CHARS,
  );
}

function structuredArticleBody(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const body = structuredArticleBody(item);
      if (body) return body;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  if (typeof value.articleBody === "string" && value.articleBody.trim().length >= 120) {
    return normalizePlaintext(value.articleBody, MAX_RESPONSE_CHARS);
  }
  for (const child of Object.values(value)) {
    const body = structuredArticleBody(child);
    if (body) return body;
  }
  return null;
}

export function extractArticlePlaintext(html) {
  for (const match of String(html || "").matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const body = structuredArticleBody(JSON.parse(match[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim()));
      if (body) return body;
    } catch {
      // Invalid publisher JSON-LD is common; continue with semantic markup.
    }
  }
  const cleaned = String(html || "").replace(/<!--[\s\S]*?-->/g, " ");
  const semantic = [...cleaned.matchAll(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((match) => stripHtml(match[2]))
    .filter((text) => text.length >= 200)
    .sort((left, right) => right.length - left.length);
  if (semantic.length) return semantic[0];
  const paragraphs = [...cleaned.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripHtml(match[1]))
    .filter((text) => text.length >= 30);
  const body = normalizePlaintext(paragraphs.join("\n\n"), MAX_RESPONSE_CHARS);
  return body.length >= 200 ? body : null;
}

export async function fetchArticlePlaintext(url, { timeoutMs = 15_000 } = {}) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("Article URL must use HTTP or HTTPS.");
  const response = await fetch(parsed, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "user-agent": "cartdotcom-news-signal-self-hosted/1.0 (+https://cartdotcom.com)",
      accept: "text/html, text/plain;q=0.9, application/xhtml+xml;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`Article fetch returned HTTP ${response.status}`);
  if (Number(response.headers.get("content-length") || 0) > MAX_RESPONSE_CHARS) {
    throw new Error("Article response exceeded the 3 MB extraction limit");
  }
  const body = await response.text();
  if (body.length > MAX_RESPONSE_CHARS) throw new Error("Article response exceeded the 3 MB extraction limit");
  if (/just a moment|verify you are human|enable javascript and cookies|access denied/i.test(body.slice(0, 8_000))) {
    throw new Error("Article page returned an access or browser-verification screen");
  }
  const plaintext = (response.headers.get("content-type") || "").includes("text/plain")
    ? normalizePlaintext(body, MAX_RESPONSE_CHARS)
    : extractArticlePlaintext(body);
  if (!plaintext || plaintext.length < 120) throw new Error("No article body could be extracted from the page");
  if (plaintext.length < 500 && /subscribe|sign in to continue|already a subscriber|register to continue/i.test(plaintext)) {
    throw new Error("Article page exposed only a subscription prompt");
  }
  return plaintext;
}

export async function captureArticleContent(pool, article) {
  if (article.content_status === "fetched" && article.content_plaintext) return article;
  const fallback = normalizePlaintext(article.content_plaintext || article.summary || "");
  try {
    const fetched = await fetchArticlePlaintext(article.url);
    const useFetched = fetched.length >= fallback.length;
    const content = normalizePlaintext(useFetched ? fetched : fallback);
    const source = useFetched ? "webpage" : (article.content_source || "feed");
    await pool.query(
      `UPDATE articles SET content_plaintext = $2, content_source = $3,
         content_status = 'fetched', content_fetched_at = CURRENT_TIMESTAMP,
         content_fetch_attempts = content_fetch_attempts + 1, content_error = NULL
       WHERE id = $1`,
      [article.id, content, source],
    );
    return { ...article, content_plaintext: content, content_source: source, content_status: "fetched", content_error: null };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    const status = fallback ? "feed_only" : "failed";
    await pool.query(
      `UPDATE articles SET content_plaintext = COALESCE(content_plaintext, summary),
         content_source = CASE WHEN content_plaintext IS NULL AND summary IS NOT NULL THEN 'feed' ELSE content_source END,
         content_status = $2, content_fetched_at = CURRENT_TIMESTAMP,
         content_fetch_attempts = content_fetch_attempts + 1, content_error = $3
       WHERE id = $1`,
      [article.id, status, message],
    );
    return { ...article, content_plaintext: fallback || null, content_source: article.content_source || (fallback ? "feed" : null), content_status: status, content_error: message };
  }
}
