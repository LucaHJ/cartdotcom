import json
import subprocess
import sys
from pathlib import Path

import pytest
from app.evidence_server import call_tool
from research_samples import stage_result


def test_reader_is_paginated_and_cannot_read_arbitrary_paths():
    sections = {"synthesis": {"summary": "z"*100}}
    first = call_tool(sections, "read_research_evidence", {"section": "synthesis", "max_chars": 10})
    assert first["next_offset"] == 10 and len(first["text"]) == 10
    second = call_tool(sections, "read_research_evidence", {"section": "synthesis", "offset": 10, "max_chars": 10})
    assert first["text"]+second["text"] == json.dumps(sections["synthesis"])[:20]
    for args in ({"section": "../../auth.json"}, {"section": "synthesis", "path": "/etc/passwd"}, {"section": "synthesis", "offset": -1}):
        with pytest.raises(ValueError):
            call_tool(sections, "read_research_evidence", args)
    with pytest.raises(ValueError):
        call_tool(sections, "exec", {"command": "anything"})


def test_arithmetic_tool_does_not_change_plan():
    r = stage_result("allocation")
    args = {"plan": r["allocation_plan"], "decisions": r["decisions"]}
    original = json.dumps(args)
    assert call_tool({}, "check_allocation_arithmetic", args)["valid"]
    assert json.dumps(args) == original
    args["plan"]["industries"].append({"industry": "CASH_RESERVE", "target_weight_pct": 95, "max_weight_pct": None})
    with pytest.raises(ValueError, match="CASH_RESERVE"):
        call_tool({}, "check_allocation_arithmetic", args)


def test_stdio_handshake_tools_and_evidence(tmp_path):
    from app import evidence_server
    (tmp_path/"prior-research.json").write_text(json.dumps({"stages": [{"name": "synthesis", "result": {"summary": "saved"}}], "portfolio_context": {}}))
    requests = [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05"}},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "read_research_evidence", "arguments": {"section": "synthesis"}}},
    ]
    p = subprocess.run([sys.executable, evidence_server.__file__, str(tmp_path)], input="\n".join(map(json.dumps, requests))+"\n", text=True, capture_output=True, timeout=10, check=True)
    responses = [json.loads(x) for x in p.stdout.splitlines()]
    assert len(responses) == 3 and responses[0]["result"]["serverInfo"]["name"] == "research-evidence"
    assert len(responses[1]["result"]["tools"]) == 2
    assert responses[2]["result"]["isError"] is False
    assert "saved" in responses[2]["result"]["content"][0]["text"]
