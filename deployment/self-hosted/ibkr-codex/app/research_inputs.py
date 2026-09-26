"""Deterministic, disclosed input selection; full originals stay in run archives."""
import json

PORTFOLIO_MARKER = "Saved portfolio, strategy performance and history:\n"
NEWS_MARKER = "Exploratory News Signal context:\n"


def portfolio_context(base):
    if PORTFOLIO_MARKER not in base:
        return None
    return json.JSONDecoder().raw_decode(base.split(PORTFOLIO_MARKER, 1)[1].lstrip())[0]


def clipped(value, limit):
    value = str(value or "")
    return value if len(value) <= limit else value[:limit] + " [excerpt; verify source]"


def sample_rows(rows, limit):
    if len(rows) <= limit:
        return rows
    return [rows[round(i * (len(rows) - 1) / (limit - 1))] for i in range(limit)]


def news_digest(news, limit=10):
    """Extract headlines/URLs only, never raw article bodies or nested analyses."""
    items = []
    seen = set()
    def walk(value, depth=0):
        if depth > 6 or len(items) >= limit:
            return
        if isinstance(value, dict):
            title = value.get("title") or value.get("headline")
            if title and str(title) not in seen:
                seen.add(str(title))
                items.append({"title": clipped(title, 220),
                              "url": clipped(value.get("url") or value.get("source_url"), 500),
                              "published_at": clipped(value.get("published_at") or value.get("date"), 100),
                              "ticker": clipped(value.get("ticker") or value.get("symbol"), 40)})
            for child in value.values():
                if isinstance(child, (list, dict)):
                    walk(child, depth + 1)
        elif isinstance(value, list):
            for child in value[:100]:
                walk(child, depth + 1)
    walk(news)
    return {"selection_note": "Optional exploratory headlines only; raw bodies omitted. Not authoritative or comprehensive. Discover current evidence independently.",
            "items": items}


def compact_base(base, stage, lean=False):
    if PORTFOLIO_MARKER not in base:
        return base  # Older/minimal test mandate; no unsafe heuristic truncation.
    mandate, rest = base.split(PORTFOLIO_MARKER, 1)
    decoder = json.JSONDecoder()
    portfolio, end = decoder.raw_decode(rest.lstrip())
    after = rest.lstrip()[end:]
    news = decoder.raw_decode(after.split(NEWS_MARKER, 1)[1].lstrip())[0] if NEWS_MARKER in after else {}
    screen = stage.startswith("screen_")
    result = {k: v for k, v in portfolio.items() if k not in {"performance_history", "confirmed_trades", "open_orders"}}
    if screen:
        # Screens investigate industries, not attribution. Current holdings and
        # capital boundaries remain present; historical data goes to synthesis.
        result["input_selection"] = "Current portfolio only; historical attribution is performed in synthesis, not this independent industry screen."
    else:
        history = portfolio.get("performance_history", [])
        rows = sample_rows(history, 8 if lean else 16)
        result["performance_history"] = [
            {**{k: v for k, v in row.items() if k != "positions"},
             "positions": [{k: p.get(k) for k in ("symbol", "quantity", "last_usd", "price_observed_at", "price_stale")}
                           for p in row.get("positions", [])]} for row in rows]
        result["confirmed_trades"] = portfolio.get("confirmed_trades", [])[:100]
        result["input_selection"] = {"history_records_supplied": len(rows), "history_records_available": len(history),
            "trade_records_supplied": len(result["confirmed_trades"]),
            "trade_records_available": len(portfolio.get("confirmed_trades", [])),
            "note": "Evenly sampled history including first/latest marks; up to 100 newest trades. Do not infer missing observations. Full saved inputs remain archived."}
    digest = news_digest(news, 0 if lean else 10)
    return mandate + PORTFOLIO_MARKER + json.dumps(result, separators=(",", ":")) + "\n\n" + NEWS_MARKER + json.dumps(digest, separators=(",", ":"))


def compact_prior(previous, stage, lean=False):
    if stage.startswith("screen_"):
        return []  # Independent discovery must not inherit unrelated screens.
    size = 450 if lean else 750
    evidence = []
    for prior in previous:
        name, result = prior["name"], prior["result"]
        if name.startswith("screen_"):
            if stage in {"challenge", "allocation"}:
                evidence.append({"stage": name, "result": {"industries": [
                    {"industry": r["industry"], "verdict": r["verdict"], "investable_symbols": r["investable_symbols"],
                     "thesis": clipped(r["thesis"], 220), "bear_case": clipped(r["bear_case"], 180),
                     "citations": r["citations"][:2]} for r in result["industries"]]},
                     "reused": prior.get("reused", False), "source_completed_at": prior.get("source_completed_at")})
                continue
            # Retain every sector, verdict, mechanism, bear case and source.
            sectors = [{"industry": r["industry"], "verdict": r["verdict"], "investable_symbols": r["investable_symbols"],
                        **{k: clipped(r.get(k), size) for k in ("thesis", "valuation_and_priced_in", "bear_case", "invalidation", "bottlenecks_and_beneficiaries")},
                        "citations": r["citations"],
                        "events": [{"timing": e["timing"], "date_or_window": e["date_or_window"], "status": e["status"],
                                    "event": clipped(e["event"], 250), "price_evidence": clipped(e["price_evidence"], 250),
                                    "citations": e["citations"]} for e in
                                   [next(x for x in r["events"] if x["timing"] == timing) for timing in ("past", "present", "future")]]}
                       for r in result["industries"]]
            selected = {"summary": clipped(result["summary"], size), "industries": sectors}
        else:
            # Synthesis and audit contain the candidate comparisons and objections
            # needed by the final allocator, so preserve them in full.
            selected = result
        evidence.append({"stage": name, "result": selected, "reused": prior.get("reused", False),
                         "source_completed_at": prior.get("source_completed_at")})
    return evidence
