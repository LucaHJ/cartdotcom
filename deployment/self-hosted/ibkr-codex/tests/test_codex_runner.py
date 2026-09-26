import pytest

from app import codex_runner
import gzip
import json
import hashlib
from uuid import uuid4
from research_samples import stage_result
from app.research_protocol import VERSION


@pytest.mark.asyncio
async def test_progress_event_uses_internal_api_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict = {}

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, url, **kwargs):
            captured.update({"url": url, **kwargs})

    monkeypatch.setattr(codex_runner, "EVENT_URL", "http://api/internal/run-event")
    monkeypatch.setattr(codex_runner, "_secret", lambda _: "token")
    monkeypatch.setattr(codex_runner.httpx, "AsyncClient", lambda **_: Client())

    await codex_runner.publish(
        "run-id",
        {"type": "item.completed", "item": {"type": "agent_message", "text": "HOLD is justified."}},
    )

    assert captured["json"] == {
        "run_id": "run-id",
        "event_type": "item.completed",
        "message": "HOLD is justified.",
        "details": {"item_type": "agent_message", "usage": None},
    }


@pytest.mark.asyncio
async def test_durable_result_is_returned_without_launching_codex(monkeypatch, tmp_path):
    monkeypatch.setattr(codex_runner, "RESULT_ROOT", tmp_path)
    run_id, prompt = str(uuid4()), "saved original prompt"
    payload = {"ok": True, "result": {"decisions": []}, "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest()}
    (tmp_path / f"{run_id}.json.gz").write_bytes(gzip.compress(json.dumps(payload).encode()))
    assert await codex_runner.research(codex_runner.ResearchRequest(run_id=run_id, prompt=prompt)) == payload
    with pytest.raises(codex_runner.HTTPException) as error:
        await codex_runner.research(codex_runner.ResearchRequest(run_id=run_id, prompt="changed"))
    assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_pipeline_validates_nine_stages_and_sums_usage(monkeypatch, tmp_path):
    monkeypatch.setattr(codex_runner, "RESULT_ROOT", tmp_path)
    calls = []
    async def fake(run_id, prompt, schema, timeout, record, on_progress=None):
        calls.append(record["name"])
        assert timeout <= 2100
        record["usage"] = {"input_tokens": 100, "output_tokens": 20, "cached_input_tokens": 30}
        record["runtime_seconds"] = 12
        return stage_result(record["name"])
    monkeypatch.setattr(codex_runner, "run_stage", fake)
    request = codex_runner.ResearchRequest(run_id=str(uuid4()), prompt="Synthetic base")
    result = await codex_runner.research(request)
    assert result["ok"] and len(calls) == 9
    assert result["usage"] == {"input_tokens": 900, "output_tokens": 180, "cached_input_tokens": 270}
    assert result["runtime_seconds"] == 108
    assert result["result"]["research_dossier"]["protocol"] == VERSION
    assert all(a["prompt"] and a["result"] for a in result["attempts"])
    assert (await codex_runner.research(request))["ok"] and len(calls) == 9


@pytest.mark.asyncio
async def test_failed_stage_stops_without_allocation_or_trading(monkeypatch, tmp_path):
    monkeypatch.setattr(codex_runner, "RESULT_ROOT", tmp_path)
    calls = []
    async def fake(run_id, prompt, schema, timeout, record, on_progress=None):
        calls.append(record["name"])
        return {}  # incomplete output, not a successful screen
    monkeypatch.setattr(codex_runner, "run_stage", fake)
    result = await codex_runner.research(codex_runner.ResearchRequest(run_id=str(uuid4()), prompt="test"))
    assert not result["ok"] and result["result"] is None
    assert calls == ["screen_compute", "screen_compute"]
    assert codex_runner.active_run is None


@pytest.mark.asyncio
async def test_restart_resumes_validated_stages_and_keeps_deadline(monkeypatch, tmp_path):
    monkeypatch.setattr(codex_runner, "RESULT_ROOT", tmp_path)
    request = codex_runner.ResearchRequest(run_id=str(uuid4()), prompt="saved")
    record = {"name": "screen_compute", "status": "completed", "prompt": "exact", "usage": {"input_tokens": 55}, "runtime_seconds": 1}
    payload = {"status": "running", "protocol": VERSION, "prompt_sha256": hashlib.sha256(b"saved").hexdigest(),
               "deadline": codex_runner.time.time()+10000, "stages": [{"name": "screen_compute", "result": stage_result("screen_compute")}],
               "attempts": [record]}
    codex_runner.save_checkpoint(tmp_path / f"{request.run_id}.json.gz", payload)
    calls = []
    async def fake(run_id, prompt, schema, timeout, record, on_progress=None):
        calls.append(record["name"])
        return stage_result(record["name"])
    monkeypatch.setattr(codex_runner, "run_stage", fake)
    result = await codex_runner.research(request)
    assert result["ok"] and len(calls) == 8 and "screen_compute" not in calls
    assert result["deadline"] == payload["deadline"]
    assert result["usage"]["input_tokens"] == 55


@pytest.mark.asyncio
async def test_expired_checkpoint_cannot_restart_timeout_budget(monkeypatch, tmp_path):
    monkeypatch.setattr(codex_runner, "RESULT_ROOT", tmp_path)
    request = codex_runner.ResearchRequest(run_id=str(uuid4()), prompt="saved")
    payload = {"status": "running", "protocol": VERSION, "prompt_sha256": hashlib.sha256(b"saved").hexdigest(),
               "deadline": 1, "stages": [], "attempts": []}
    codex_runner.save_checkpoint(tmp_path / f"{request.run_id}.json.gz", payload)
    result = await codex_runner.research(request)
    assert not result["ok"] and "deadline" in result["error"] and not result["attempts"]
