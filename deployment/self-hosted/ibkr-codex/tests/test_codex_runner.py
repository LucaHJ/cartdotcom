import pytest

from app import codex_runner
import gzip
import json
import hashlib
from uuid import uuid4


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
