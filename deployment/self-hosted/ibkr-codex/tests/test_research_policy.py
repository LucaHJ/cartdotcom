import json
from pathlib import Path

from app.prompt import research_prompt


ROOT = Path(__file__).resolve().parents[1]


def test_output_schema_no_longer_enforces_fifteen_percent_position_cap():
    schema = json.loads((ROOT / "schemas" / "decision.schema.json").read_text())
    weight = schema["properties"]["decisions"]["items"]["properties"]["target_weight_pct"]
    assert weight == {"type": "number", "minimum": 0, "maximum": 100}


def test_research_owns_allocation_but_not_the_safety_boundary():
    prompt = research_prompt({}, {})
    assert "remove all allocation caps" in prompt
    assert "AUD 20,000" in prompt
    assert "past events, present bottlenecks and future catalysts" in prompt
    assert "retired, not defaults or constraints" in prompt
    assert "Separate beta, dividends, AUD/USD, cash drag and unfilled orders" in prompt
    assert "single-position or new-position limits" not in prompt
