import test from "node:test";
import assert from "node:assert/strict";
import { normalizeResult, normalizeTicker, researchPrompt } from "./prompt.js";

test("normalizes unique actionable calls and rejects invalid ticker text", () => {
  const result = normalizeResult({
    event_title: "Test", event_type: "announcement", confidence: 0.7,
    impact_details: [
      { kind: "company", name: "Example", symbol: "abc", direction: "bullish", confidence: 0.6, reason: "Demand rises." },
      { kind: "company", name: "Example", symbol: "ABC", direction: "bullish", confidence: 0.8, reason: "Direct demand rises." },
      { kind: "company", name: "No ticker", symbol: "bad ticker!", direction: "bearish", confidence: 1, reason: "Invalid." }
    ]
  });
  assert.deepEqual(result.symbols, ["ABC"]);
  assert.equal(result.calls[0].confidence, 0.8);
  assert.equal(normalizeTicker("bad ticker!"), null);
});

test("prompt anchors predictions to publication time and stored text", () => {
  const prompt = researchPrompt({ title: "Title", url: "https://example.com", published_at: "2026-08-19T00:00:00Z", content_plaintext: "Body" });
  assert.match(prompt, /2026-08-19T00:00:00Z/);
  assert.match(prompt, /Body/);
});
