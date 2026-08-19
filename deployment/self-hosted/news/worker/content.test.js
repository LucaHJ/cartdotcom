import test from "node:test";
import assert from "node:assert/strict";
import { extractArticlePlaintext, normalizePlaintext } from "../common/content.js";

test("extracts articleBody from publisher JSON-LD", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "NewsArticle",
    articleBody: "A".repeat(140),
  })}</script>`;
  assert.equal(extractArticlePlaintext(html), "A".repeat(140));
});

test("semantic extraction removes scripts and navigation", () => {
  const paragraph = "Market-relevant article text ".repeat(12);
  const extracted = extractArticlePlaintext(`<nav>menu</nav><article><script>bad()</script><p>${paragraph}</p></article>`);
  assert.match(extracted, /Market-relevant article text/);
  assert.doesNotMatch(extracted, /bad\(\)|menu/);
  assert.equal(normalizePlaintext("a   b\n\n\n c"), "a b\n\nc");
});
