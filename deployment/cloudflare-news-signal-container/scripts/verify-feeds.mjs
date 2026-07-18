import { readFile } from "node:fs/promises";

const sourceText = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
const feeds = [...sourceText.matchAll(/source\("([^"]+)", "([^"]+)", "([^"]+)"/g)].map((match) => ({
  id: match[1],
  name: match[2],
  url: match[3],
}));

let nextIndex = 0;
let passed = 0;
const failures = [];

function tagValue(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim() || null;
}

function parseableItemCount(xml) {
  const blocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) || [];
  return blocks.filter((block) => {
    const title = tagValue(block, "title");
    const textLink = tagValue(block, "link");
    const hrefLink = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1];
    return Boolean(title && (textLink || hrefLink));
  }).length;
}

async function verifyFeed(feed) {
  let lastFailure = { ...feed, status: "error", itemCount: 0 };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(feed.url, {
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "user-agent": "cartdotcom-news-signal-mvp/0.1",
          accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        },
      });
      const body = await response.text();
      const itemCount = parseableItemCount(body);
      if (response.ok && itemCount > 0) {
        passed += 1;
        return;
      }
      lastFailure = { ...feed, status: response.status, itemCount };
    } catch (error) {
      lastFailure = { ...feed, status: "error", itemCount: 0, error: error instanceof Error ? error.message : String(error) };
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  failures.push(lastFailure);
}

async function worker() {
  while (nextIndex < feeds.length) {
    const feed = feeds[nextIndex];
    nextIndex += 1;
    await verifyFeed(feed);
  }
}

await Promise.all(Array.from({ length: 12 }, worker));

for (const failure of failures) {
  console.error(`${failure.id}: HTTP ${failure.status}, ${failure.itemCount} items${failure.error ? `, ${failure.error}` : ""}`);
}
console.log(`${passed}/${feeds.length} feeds returned parseable RSS or Atom entries.`);
if (failures.length) process.exitCode = 1;
