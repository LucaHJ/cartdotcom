import test from "node:test";
import assert from "node:assert/strict";
import { parseFeed, hashText } from "./feed.js";
import { NEW_ARTICLE_PRIORITY, RESYNTHESIS_PRIORITY, retryDelaySeconds } from "../common/queue.js";
import { floorToInterval, millisecondsUntilNextBoundary } from "./time.js";

test("parses RSS and Atom links without a fixed source list", () => {
  const source = { id: "example", name: "Example" };
  const rss = `<rss><channel><item><title>A &amp; B</title><link>https://example.com/a</link><pubDate>Wed, 19 Aug 2026 00:01:00 GMT</pubDate></item></channel></rss>`;
  const atom = `<feed><entry><title>Second</title><link href="https://example.com/b"/><updated>2026-08-19T00:02:00Z</updated></entry></feed>`;
  assert.equal(parseFeed(rss, source)[0].title, "A & B");
  assert.equal(parseFeed(atom, source)[0].url, "https://example.com/b");
  assert.equal(hashText("same"), hashText("same"));
});

test("aligns source scans to exact five-minute boundaries", () => {
  const now = Date.parse("2026-08-19T00:07:49.250Z");
  assert.equal(new Date(floorToInterval(now, 300000)).toISOString(), "2026-08-19T00:05:00.000Z");
  assert.equal(millisecondsUntilNextBoundary(now, 300000), 130750);
});

test("new work outranks resynthesis and retry delays are bounded", () => {
  assert.ok(NEW_ARTICLE_PRIORITY > RESYNTHESIS_PRIORITY);
  assert.equal(retryDelaySeconds(1), 30);
  assert.equal(retryDelaySeconds(4), 240);
  assert.equal(retryDelaySeconds(99), 3600);
});
