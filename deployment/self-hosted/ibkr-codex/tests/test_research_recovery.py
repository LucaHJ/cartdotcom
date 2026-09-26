import asyncio
import copy
import gzip
import hashlib
import json
import sys
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from app import codex_runner as runner
from app.prompt import research_prompt
from app.research_inputs import compact_base, compact_prior
from app.research_protocol import stage_prompt, UNIVERSE, VERSION
from research_samples import stage_result


def test_screen_inputs_do_not_grow_with_prior_screens_or_raw_news():
    context = {"strategy_budget": {"initial_capital": "20000"}, "positions": [{"symbol": "SPY", "quantity": "5"}],
               "performance_history": [{"unneeded": "x"*10000}]*90}
    news = {"articles": [{"title": "Energy report", "url": "https://example.test/report", "body": "body"*100000}]}
    base = research_prompt(context, news)
    first = stage_prompt(base, "screen_health", UNIVERSE["health"], [])
    prior = [{"name": "screen_compute", "result": stage_result("screen_compute")}]
    later = stage_prompt(base, "screen_health", UNIVERSE["health"], prior)
    assert first == later and len(later) < 15000
    assert '"quantity":"5"' in later and "AUD 20,000" in later
    assert "https://example.test/report" in later
    assert "bodybodybody" not in later
    lean = stage_prompt(base, "screen_health", UNIVERSE["health"], prior, lean=True)
    assert "https://example.test/report" not in lean
    assert "six distinct industry records" in lean


def test_history_sampling_keeps_first_last_and_all_current_holdings():
    history = [{"observed_hour": i, "positions": []} for i in range(90)]
    base = research_prompt({"performance_history": history, "positions": [{"symbol": "SPY"}]}, {})
    compact = compact_base(base, "synthesis")
    assert '"observed_hour":0' in compact and '"observed_hour":89' in compact
    assert '"history_records_supplied":16' in compact
    assert '"symbol":"SPY"' in compact


@pytest.mark.asyncio
async def test_real_subprocess_timeout_preserves_redacted_stderr(monkeypatch, tmp_path):
    real_exec = asyncio.create_subprocess_exec
    code = 'import sys,time; print("Bearer secret-value",file=sys.stderr,flush=True); print(\'{"type":"thread.started"}\',flush=True); sys.stdin.read(); time.sleep(20)'
    async def fake_exec(*args, **kwargs):
        return await real_exec(sys.executable, "-c", code, **kwargs)
    monkeypatch.setattr(runner.asyncio, "create_subprocess_exec", fake_exec)
    monkeypatch.setattr(runner, "WORK_ROOT", tmp_path)
    monkeypatch.setattr(runner, "STARTUP_TIMEOUT", .15)
    monkeypatch.setattr(runner, "HEARTBEAT_SECONDS", .03)
    monkeypatch.setattr(runner, "EVENT_URL", "")
    record = {"name": "screen_health", "events": [], "usage": {}}
    checkpoints = []
    with pytest.raises(runner.StageFailure) as error:
        await runner.run_stage("test", "x"*300000, {}, 3, record, lambda: checkpoints.append(record["runtime_seconds"]))
    assert error.value.kind == "startup_timeout"
    assert "[REDACTED]" in record["stderr_tail"] and "secret-value" not in record["stderr_tail"]
    assert record["process_exit_code"] is not None
    assert record["usage_complete"] is False and checkpoints
    assert record["event_count"] == 1


@pytest.mark.asyncio
async def test_timeouts_defer_screen_continue_others_then_recover(monkeypatch, tmp_path):
    monkeypatch.setattr(runner, "RESULT_ROOT", tmp_path)
    calls, prompts = [], []
    async def fake(run_id, prompt, schema, timeout, record, on_progress=None):
        calls.append(record["name"]); prompts.append(prompt)
        if record["name"] == "screen_health" and calls.count("screen_health") <= 2:
            raise runner.StageFailure("startup_timeout", "No model output")
        record["usage"] = {"input_tokens": 10}
        return stage_result(record["name"])
    monkeypatch.setattr(runner, "run_stage", fake)
    result = await runner.research(runner.ResearchRequest(run_id=str(uuid4()), prompt="base"))
    assert result["ok"] and calls.count("screen_health") == 3
    assert calls.index("screen_economy") < len(calls)-1-calls[::-1].index("screen_health") < calls.index("synthesis")
    health_prompts = [p for n,p in zip(calls,prompts) if n == "screen_health"]
    assert "lean recovery attempt" in health_prompts[1]
    assert result["attempts"][2]["failure_kind"] == "startup_timeout"
    assert result["usage_incomplete"] is True


@pytest.mark.asyncio
async def test_explicit_recovery_reuses_only_screens_without_double_counting(monkeypatch, tmp_path):
    monkeypatch.setattr(runner, "RESULT_ROOT", tmp_path)
    source_id = str(uuid4())
    source = {"status": "failed", "protocol": VERSION, "completed_at": datetime.now(UTC).isoformat(),
        "stages": [{"name": n, "result": stage_result(n)} for n in ("screen_compute", "synthesis")],
        "attempts": [{"name": "screen_compute", "status": "completed", "prompt": "original prompt", "usage": {"input_tokens": 9999}}]}
    path = tmp_path / f"{source_id}.json.gz"
    runner.save_checkpoint(path, source)
    original = path.read_bytes()
    calls = []
    async def fake(run_id, prompt, schema, timeout, record, on_progress=None):
        calls.append(record["name"])
        return stage_result(record["name"])
    monkeypatch.setattr(runner, "run_stage", fake)
    result = await runner.research(runner.ResearchRequest(run_id=str(uuid4()), prompt="new context", resume_from_run_id=source_id))
    assert result["ok"] and "screen_compute" not in calls and "synthesis" in calls
    assert result["attempts"][0]["status"] == "reused"
    assert result["usage"]["input_tokens"] == 0
    assert result["attempts"][0]["source_usage"]["input_tokens"] == 9999
    assert path.read_bytes() == original


def test_expired_recovery_evidence_is_not_reused(monkeypatch, tmp_path):
    monkeypatch.setattr(runner, "RESULT_ROOT", tmp_path)
    source_id = str(uuid4())
    source = {"status": "failed", "protocol": VERSION,
              "completed_at": (datetime.now(UTC)-timedelta(hours=73)).isoformat()}
    runner.save_checkpoint(tmp_path/f"{source_id}.json.gz", source)
    with pytest.raises(ValueError, match="older than 72"):
        runner.recovery_screens(source_id, datetime.now(UTC))


def test_usage_and_auth_errors_are_not_blindly_retried():
    assert runner.process_failure("429 quota exceeded").retryable is False
    assert runner.process_failure("401 unauthorized").kind == "authentication"
    assert runner.process_failure("Network disconnected").retryable is True
    assert runner.process_failure("2026-09-26T06:32:12.429086Z auxiliary transport warning").kind == "process_error"
    assert runner.process_failure("2026-09-26T06:32:12.401086Z auxiliary transport warning").kind == "process_error"
