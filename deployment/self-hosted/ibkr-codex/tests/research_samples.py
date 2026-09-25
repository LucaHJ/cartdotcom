"""Synthetic schema-complete research; never used in production."""
from app.research_protocol import stages, UNIVERSE, VERSION


def sample(schema):
    if "enum" in schema:
        return schema["enum"][0]
    kind = schema["type"]
    if isinstance(kind, list):
        return None if "null" in kind else 0
    if kind == "object":
        return {k: sample(v) for k, v in schema["properties"].items()}
    if kind == "array":
        return [sample(schema["items"]) for _ in range(schema.get("minItems", 0))]
    if kind == "number":
        return schema.get("minimum", 0)
    if "https" in schema.get("pattern", ""):
        return "https://www.sec.gov/example"
    return "XX" if schema.get("pattern") else "Synthetic research evidence for deterministic testing only."


def plan(decisions):
    groups = sorted({d["allocation_bucket"] for d in decisions}) or ["CASH_ONLY"]
    return {"cash_target_pct": 100-sum(d["target_weight_pct"] for d in decisions),
            "new_position_cap_pct": None, "position_cap_pct": None, "turnover_cap_pct": None,
            "industries": [{"industry": g, "target_weight_pct": sum(d["target_weight_pct"] for d in decisions if d["allocation_bucket"] == g), "max_weight_pct": None} for g in groups],
            "positions": [{"symbol": d["symbol"], "industry": d["allocation_bucket"], "target_weight_pct": d["target_weight_pct"], "max_weight_pct": None} for d in decisions],
            "rationale": "Synthetic allocation rationale for deterministic tests; no investment recommendation."}


def stage_result(name):
    _, industries, schema = next(s for s in stages() if s[0] == name)
    result = sample(schema)
    if industries:
        for row, industry in zip(result["industries"], industries):
            row["industry"] = industry
            row["citations"] = ["https://www.sec.gov/example", "https://www.energy.gov/example"]
            for event, timing in zip(row["events"], ("past", "present", "future")):
                event["timing"] = timing
    elif name == "synthesis":
        names = sum(UNIVERSE.values(), [])
        for i, candidate in enumerate(result["ranked_candidates"]):
            candidate.update(symbol=f"TEST{i}", industry=names[i])
    elif name == "allocation":
        result["decisions"] = [{"symbol": "SPY", "asset_type": "US_EQUITY", "allocation_bucket": "BROAD_US",
            "action": "BUY", "target_weight_pct": 5, "confidence": .7, "thesis": "Synthetic test",
            "risks": ["Synthetic"], "citations": ["https://www.sec.gov/example"]}]
        result["allocation_plan"] = plan(result["decisions"])
    return result


def full_output():
    output = stage_result("allocation")
    output["research_dossier"] = {"protocol": VERSION,
        "stages": [{"name": n, "result": stage_result(n)} for n, _, _ in stages()[:-1]]}
    return output
