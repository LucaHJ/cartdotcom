import pytest

from app import codex_runner


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

