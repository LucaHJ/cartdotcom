export function researchPrompt(article) {
  const articleText = (article.content_plaintext || article.summary || "none").slice(0, 60000);
  return `You are building a rapid ticker-direction prediction database, not trading advice.

Identify publicly traded tickers concretely affected by this article and predict the direction of each ticker's price response. Focus on actionable tickers, not industry classification. Use the stored article text, source provenance, and prior knowledge. Do not browse unless the item is impossible to understand without it.

For every ticker:
1. Identify the concrete event, not merely the topic.
2. Resolve named public companies to the correct exchange ticker.
3. Add a customer, supplier, competitor, substitute, or platform owner only when the event creates a specific material causal path.
4. Predict bullish or bearish direction independently for each ticker.
5. Exclude broad peers, indices, and famous related companies without a concrete causal path.
6. State the event -> business or perception effect -> expected price direction chain in reason.
7. If a symbol or causal direction is uncertain, omit it rather than guessing.

Article:
Title: ${article.title}
URL: ${article.url}
Published: ${article.published_at || "unknown"}
Source: ${article.source_name || article.source_id}
Source type: ${article.source_type || "editorial"}
Stored content status: ${article.content_status || "unknown"}
Stored plaintext article content:
${articleText}

Return only the JSON object required by the supplied schema.
- impact_details should overwhelmingly contain public companies with actionable tickers.
- industries must be empty unless one or two industries materially clarify the calls.
- symbols must contain only tickers supported by impact_details with a concrete reason.
- sentiment_score is the net article direction from -1 to 1; per-ticker direction is authoritative.
- confidence is from 0 to 1 and must reflect evidence quality and causal specificity.
- Distinguish announcement claims from independently reported facts for first-party sources.
- Put concise supporting analysis in memo, under 350 words.
- Private companies may be context in memo but must not receive a ticker.`;
}

export function normalizeTicker(value) {
  const ticker = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(ticker) ? ticker : null;
}

export function normalizeResult(fields) {
  if (!fields || typeof fields !== "object") throw new Error("Codex returned no structured analysis.");
  if (!fields.event_title || !fields.event_type || !Array.isArray(fields.impact_details)) {
    throw new Error("Codex response is missing required event fields.");
  }
  const details = fields.impact_details
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      kind: typeof item.kind === "string" ? item.kind : "company",
      name: typeof item.name === "string" ? item.name.trim() : "",
      symbol: normalizeTicker(item.symbol),
      direction: ["bullish", "bearish", "mixed", "neutral"].includes(item.direction) ? item.direction : "neutral",
      confidence: Number.isFinite(item.confidence) ? Math.max(0, Math.min(1, item.confidence)) : fields.confidence,
      reason: typeof item.reason === "string" ? item.reason.trim() : "",
    }))
    .filter((item) => item.name || item.symbol || item.reason);

  const calls = new Map();
  for (const detail of details) {
    if (!detail.symbol || !detail.reason || !["bullish", "bearish"].includes(detail.direction)) continue;
    const existing = calls.get(detail.symbol);
    if (!existing || Number(detail.confidence || 0) > Number(existing.confidence || 0)) calls.set(detail.symbol, detail);
  }
  const symbols = [...calls.keys()].sort();
  return {
    ...fields,
    impact_details: details,
    calls: [...calls.values()],
    symbols,
    companies: [...new Set(details.filter((item) => item.kind === "company" && item.name).map((item) => item.name))],
    industries: [...new Set(details.filter((item) => item.kind !== "company" && item.name).map((item) => item.name))],
  };
}
