import copy
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from app import codex_runner as runner
from app.allocation import validate_plan
from app.research_protocol import VERSION, stages, validate_stage, stage_prompt
from app.prompt import research_prompt
from research_samples import stage_result


def source_archive(tmp_path, hours=0):
    source_id = str(uuid4())
    source = {"status": "failed", "protocol": VERSION,
              "completed_at": (datetime.now(UTC)-timedelta(hours=hours)).isoformat(),
              "stages": [{"name": n, "result": stage_result(n)} for n, _, _ in stages()],
              "attempts": []}
    runner.save_checkpoint(tmp_path/f"{source_id}.json.gz", source)
    return source_id


@pytest.mark.asyncio
async def test_reuses_all_eight_evidence_stages_never_old_allocation(monkeypatch, tmp_path):
    monkeypatch.setattr(runner, "RESULT_ROOT", tmp_path)
    source_id = source_archive(tmp_path)
    original = (tmp_path/f"{source_id}.json.gz").read_bytes()
    calls = []
    async def fake(run_id, prompt, schema, timeout, record, on_progress=None):
        calls.append(record["name"])
        assert "sell_review" in prompt and "ONLY" in prompt
        return stage_result(record["name"])
    monkeypatch.setattr(runner, "run_stage", fake)
    result = await runner.research(runner.ResearchRequest(run_id=str(uuid4()), prompt="base", resume_from_run_id=source_id))
    assert result["ok"] and calls == ["allocation"]
    assert len([a for a in result["attempts"] if a["status"] == "reused"]) == 8
    assert result["usage"]["input_tokens"] == 0
    assert (tmp_path/f"{source_id}.json.gz").read_bytes() == original


def test_analysis_recovery_expiry_and_dependency_age(monkeypatch, tmp_path):
    monkeypatch.setattr(runner, "RESULT_ROOT", tmp_path)
    source_id = source_archive(tmp_path, hours=25)
    imported, _ = runner.recovery_screens(source_id, datetime.now(UTC))
    assert len(imported) == 6
    import gzip, json
    path = tmp_path/f"{source_id}.json.gz"
    source = json.loads(gzip.decompress(path.read_bytes()))
    source["completed_at"] = datetime.now(UTC).isoformat()
    source["stages"][0]["source_completed_at"] = (datetime.now(UTC)-timedelta(hours=25)).isoformat()
    runner.save_checkpoint(path, source)
    imported, _ = runner.recovery_screens(source_id, datetime.now(UTC))
    assert len(imported) == 6  # New child cannot refresh old dependencies.


def test_allocation_digest_preserves_all_candidates_and_full_review():
    from app.research_inputs import compact_prior
    synthesis = stage_result("synthesis")
    synthesis["ranked_candidates"][0]["thesis"] = "x"*5000
    review = stage_result("challenge")
    digest = compact_prior([{"name": "synthesis", "result": synthesis}, {"name": "challenge", "result": review}], "allocation")
    candidates = digest[0]["result"]["ranked_candidates"]
    assert len(candidates) == len(synthesis["ranked_candidates"])
    assert len(candidates[0]["thesis"]) < 500
    assert "read_research_evidence" in digest[0]["result"]["selection_note"]
    assert digest[1]["result"] == review


@pytest.mark.asyncio
async def test_timeout_does_not_spend_validation_correction(monkeypatch, tmp_path):
    monkeypatch.setattr(runner, "RESULT_ROOT", tmp_path)
    source_id = source_archive(tmp_path)
    calls = []
    async def fake(run_id, prompt, schema, timeout, record, on_progress=None):
        calls.append(prompt)
        if len(calls) == 1:
            raise runner.StageFailure("startup_timeout", "No progress")
        output = stage_result("allocation")
        if len(calls) == 2:
            output["allocation_plan"]["industries"].append({"industry": "CASH_RESERVE", "target_weight_pct": 95, "max_weight_pct": None})
        return output
    monkeypatch.setattr(runner, "run_stage", fake)
    result = await runner.research(runner.ResearchRequest(run_id=str(uuid4()), prompt="base", resume_from_run_id=source_id))
    assert result["ok"] and len(calls) == 3
    assert "CASH_RESERVE target 95%" in calls[-1]
    assert "previous-invalid-output.json" in calls[-1]


@pytest.mark.asyncio
async def test_repeated_invalid_allocations_stop_without_success(monkeypatch, tmp_path):
    monkeypatch.setattr(runner, "RESULT_ROOT", tmp_path)
    source_id = source_archive(tmp_path)
    calls = []
    async def fake(run_id, prompt, schema, timeout, record, on_progress=None):
        calls.append(prompt)
        return {}
    monkeypatch.setattr(runner, "run_stage", fake)
    result = await runner.research(runner.ResearchRequest(run_id=str(uuid4()), prompt="base", resume_from_run_id=source_id))
    assert not result["ok"] and result["result"] is None and len(calls) == 2


@pytest.mark.asyncio
async def test_missing_held_position_repaired_inside_runner(monkeypatch, tmp_path):
    monkeypatch.setattr(runner, "RESULT_ROOT", tmp_path)
    source_id = source_archive(tmp_path)
    calls = []
    async def fake(run_id, prompt, schema, timeout, record, on_progress=None):
        calls.append(prompt)
        output = stage_result("allocation")
        if len(calls) > 1:
            d = {**output["decisions"][0], "symbol": "VEA", "action": "HOLD", "target_weight_pct": 10}
            output["decisions"].append(d)
            p = output["allocation_plan"]
            p["cash_target_pct"] = 85
            p["industries"][0]["target_weight_pct"] = 15
            p["positions"].append({"symbol": "VEA", "industry": d["allocation_bucket"], "target_weight_pct": 10, "max_weight_pct": None})
        return output
    monkeypatch.setattr(runner, "run_stage", fake)
    prompt = research_prompt({"positions": [{"symbol": "VEA", "quantity": 3}]}, {})
    result = await runner.research(runner.ResearchRequest(run_id=str(uuid4()), prompt=prompt, resume_from_run_id=source_id))
    assert result["ok"] and len(calls) == 2
    assert "omitted an existing holding" in calls[-1]


def test_cash_not_an_industry_and_empty_all_cash_plan_allowed():
    output = stage_result("allocation")
    p = output["allocation_plan"]
    p["industries"].append({"industry": "CASH_RESERVE", "target_weight_pct": 95, "max_weight_pct": None})
    with pytest.raises(ValueError, match="CASH_RESERVE target 95%"):
        validate_stage("allocation", output)
    p.update(industries=[], positions=[], cash_target_pct=100)
    output["decisions"] = []
    validate_stage("allocation", output)
    with pytest.raises(ValueError, match="omitted"):
        validate_plan(p, [], [{"symbol": "SPY", "quantity": 1}])


def test_sale_needs_independent_case_or_actual_buy_replacement():
    output = stage_result("allocation")
    output["decisions"][0]["action"] = "SELL"
    with pytest.raises(ValueError, match="sell_review"):
        validate_stage("allocation", output)
    review = {"symbol": "SPY", "purpose": "fund_replacement", "replacement_symbols": ["NVDA"],
              "independent_sell_thesis": "Example", "hold_vs_cash_comparison": "Example",
              "replacement_rejection_response": "Example"}
    output["research_conclusion"]["sell_review"] = [review]
    with pytest.raises(ValueError, match="actual final BUYs"):
        validate_stage("allocation", output)
    review.update(purpose="standalone_exit", replacement_symbols=[])
    validate_stage("allocation", output)
    output["research_conclusion"]["sell_review"].append(copy.deepcopy(review))
    with pytest.raises(ValueError, match="exactly one"):
        validate_stage("allocation", output)


@pytest.mark.asyncio
async def test_interrupted_allocation_keeps_deadline_and_correction_budget(monkeypatch, tmp_path):
    import hashlib
    monkeypatch.setattr(runner, "RESULT_ROOT", tmp_path)
    rid = str(uuid4())
    deadline = datetime.now(UTC).timestamp()+1800
    payload = {"status": "running", "protocol": VERSION, "prompt_sha256": hashlib.sha256(b"base").hexdigest(),
        "deadline": deadline, "runner_revision": "allocation-recovery-v4",
        "stages": [{"name": n, "result": stage_result(n)} for n, _, _ in stages()[:-1]],
        "attempts": [{"name": "allocation", "status": "failed", "failure_kind": "startup_timeout", "usage": {}},
                     {"name": "allocation", "status": "running", "usage": {}}]}
    runner.save_checkpoint(tmp_path/f"{rid}.json.gz", payload)
    calls = []
    async def fake(run_id, prompt, schema, timeout, record, on_progress=None):
        calls.append(record["name"])
        return {} if len(calls) == 1 else stage_result("allocation")
    monkeypatch.setattr(runner, "run_stage", fake)
    result = await runner.research(runner.ResearchRequest(run_id=rid, prompt="base"))
    assert result["ok"] and calls == ["allocation", "allocation"]
    assert result["deadline"] == deadline and result["attempts"][1]["status"] == "interrupted"
    assert result["runner_revisions"] == ["allocation-recovery-v4", runner.RUNNER_REVISION]
