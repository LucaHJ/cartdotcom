import { createHash } from "node:crypto";

export function decodeHtmlEntities(value) {
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

function decodeXml(value) {
  return decodeHtmlEntities(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"))
    .replace(/<[^>]+>/g, "")
    .trim();
}

function tagValue(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : null;
}

function normalizeDate(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function parseFeed(xml, source) {
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
    .sort((left, right) => Date.parse(right.publishedAt || 0) - Date.parse(left.publishedAt || 0));
}

export function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
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

export async function fetchSource(source, { timeoutMs = 15000, attempts = 2 } = {}) {
  let lastError = "Feed fetch failed";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(source.url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "user-agent": "cartdotcom-news-signal-self-hosted/0.1",
          accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        },
      });
      if (response.ok) {
        const items = parseFeed(await response.text(), source);
        if (items.length) return { source: source.id, count: items.length, items };
        lastError = "No parseable RSS or Atom entries";
      } else {
        lastError = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { source: source.id, count: 0, error: lastError, items: [] };
}
