import json
from pathlib import Path

from app.prompt import research_prompt


ROOT = Path(__file__).resolve().parents[1]


def test_output_schema_no_longer_enforces_fifteen_percent_position_cap():
    schema = json.loads((ROOT / "schemas" / "decision.schema.json").read_text())
    weight = schema["properties"]["decisions"]["items"]["properties"]["target_weight_pct"]
    assert weight == {"type": "number", "minimum": 0, "maximum": 100}


def test_research_reviews_sectors_without_forcing_trades_or_changing_targets():
    prompt = research_prompt({}, {})
    assert "There is no per-security holding cap" in prompt
    assert "no per-security incremental BUY cap" in prompt
    assert "AI/semiconductors" in prompt
    assert "A dip alone is not a BUY signal" in prompt
    assert "Suggestions do not alter the configured targets" in prompt
    assert "separating AUD currency effects, cash drag and unfilled orders" in prompt
    assert "single-position or new-position limits" not in prompt
