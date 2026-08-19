const prompt = `Analyze this synthetic test item for pipeline validation only: NVIDIA announces a new data-center GPU. Return a compact response matching the supplied schema. Include NVDA as bullish with a direct rationale, and do not browse or use shell tools.`;
const response = await fetch(process.env.RUNNER_URL || "http://127.0.0.1:3010/research", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ prompt }),
  signal: AbortSignal.timeout(330000),
});
const payload = await response.json();
if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
if (!Array.isArray(payload.result?.impact_details)) throw new Error("Runner returned no impact_details array.");
console.log(JSON.stringify({
  ok: true,
  event_type: payload.result.event_type,
  symbols: payload.result.symbols,
  impact_count: payload.result.impact_details.length,
}));
