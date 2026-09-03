from __future__ import annotations

import asyncio
import json
import gzip
import hashlib
from datetime import UTC, datetime
from uuid import UUID
import os
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


PORT = int(os.getenv("RUNNER_PORT", "3010"))
MODEL = os.getenv("CODEX_MODEL", "gpt-5.6-sol")
EFFORT = os.getenv("CODEX_REASONING_EFFORT", "xhigh")
TIMEOUT = int(os.getenv("CODEX_TIMEOUT_SECONDS", "7200"))
EVENT_URL = os.getenv("INTERNAL_EVENT_URL", "")
RESULT_ROOT = Path(os.getenv("ARTIFACT_ROOT", "/data/artifacts")) / "runner-results"
SCHEMA = Path(__file__).resolve().parent.parent / "schemas" / "decision.schema.json"
active_run: str | None = None
app = FastAPI(title="IBKR Codex isolated runner")


def _secret(name: str) -> str:
    path = os.getenv(f"{name}_FILE", "")
    return Path(path).read_text().strip() if path and Path(path).exists() else os.getenv(name, "")


class ResearchRequest(BaseModel):
    run_id: str
    prompt: str


async def publish(run_id: str, event: dict[str, Any]) -> None:
    if not EVENT_URL:
        return
    token = _secret("INTERNAL_API_TOKEN")
    event_type = str(event.get("type", "codex.progress"))[:100]
    item = event.get("item") if isinstance(event.get("item"), dict) else {}
    message = ""
    for key in ("text", "message", "command", "status"):
        if item.get(key):
            message = str(item[key])
            break
        if event.get(key):
            message = str(event[key])
            break
    if not message:
        message = event_type.replace(".", " ")
    details = {
        "item_type": item.get("type"),
        "usage": _usage(event),
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                EVENT_URL,
                headers={"authorization": f"Bearer {token}"},
                json={
                    "run_id": run_id,
                    "event_type": event_type,
                    "message": message[:4000],
                    "details": details,
                },
            )
    except Exception:
        pass


def _usage(event: dict[str, Any]) -> dict[str, int] | None:
    candidates: list[dict[str, Any]] = []
    if isinstance(event.get("usage"), dict):
        candidates.append(event["usage"])
    for value in event.values():
        if isinstance(value, dict) and isinstance(value.get("usage"), dict):
            candidates.append(value["usage"])
    for value in candidates:
        if "input_tokens" in value or "output_tokens" in value:
            details = value.get("input_tokens_details") or {}
            return {
                "input_tokens": int(value.get("input_tokens", 0)),
                "output_tokens": int(value.get("output_tokens", 0)),
                "cached_input_tokens": int(value.get("cached_input_tokens", details.get("cached_tokens", 0))),
            }
    return None


@app.get("/healthz")
async def health() -> dict[str, Any]:
    return {"ok": True, "active_run": active_run, "model": MODEL, "reasoning_effort": EFFORT}


@app.post("/research")
async def research(request: ResearchRequest) -> dict[str, Any]:
    global active_run
    try:
        run_id = str(UUID(request.run_id))
    except ValueError as exc:
        raise HTTPException(422, "A UUID run id is required.") from exc
    RESULT_ROOT.mkdir(parents=True, exist_ok=True)
    saved = RESULT_ROOT / f"{run_id}.json.gz"
    prompt_hash = hashlib.sha256(request.prompt.encode()).hexdigest()
    if saved.exists():
        cached = json.loads(gzip.decompress(saved.read_bytes()))
        if cached.get("prompt_sha256") != prompt_hash:
            raise HTTPException(409, "This run id already has a result for a different prompt.")
        return cached
    if active_run:
        raise HTTPException(429, "The research runner is already active.")
    active_run = request.run_id
    started = time.monotonic()
    usage = {"input_tokens": 0, "output_tokens": 0, "cached_input_tokens": 0}
    events: list[dict[str, Any]] = []
    process = None

    def persist(result=None, error=None):
        payload = {
            "ok": error is None, "result": result, "error": error,
            "events": events, "usage": usage,
            "runtime_seconds": round(time.monotonic() - started, 3),
            "completed_at": datetime.now(UTC).isoformat(),
            "model": MODEL, "reasoning_effort": EFFORT,
            "prompt_sha256": prompt_hash,
        }
        temporary = saved.with_suffix(".tmp")
        temporary.write_bytes(gzip.compress(json.dumps(payload).encode(), mtime=0))
        temporary.replace(saved)
        return payload

    try:
        with tempfile.TemporaryDirectory(dir="/work") as temp:
            output = Path(temp) / "output.json"
            args = [
                "codex", "--search", "exec", "--model", MODEL,
                "-c", f'model_reasoning_effort="{EFFORT}"',
                "--sandbox", "read-only", "--ephemeral", "--ignore-user-config",
                "--skip-git-repo-check", "--output-schema", str(SCHEMA),
                "--output-last-message", str(output), "--json", "--color", "never",
            ]
            process = await asyncio.create_subprocess_exec(
                *args,
                limit=4 * 1024 * 1024,
                cwd="/work",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={
                    "PATH": os.getenv("PATH", ""),
                    "HOME": "/home/app",
                    "CODEX_HOME": os.getenv("CODEX_HOME", "/codex-auth"),
                    "LANG": "C.UTF-8",
                },
            )
            assert process.stdin and process.stdout and process.stderr
            process.stdin.write(request.prompt.encode())
            await process.stdin.drain()
            process.stdin.close()

            async def consume() -> None:
                async for raw in process.stdout:
                    try:
                        event = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    events.append(event)
                    found = _usage(event)
                    if found:
                        usage.update(found)
                    await publish(request.run_id, event)

            async def drain_stderr() -> str:
                tail = b""
                while chunk := await process.stderr.read(8192):
                    tail = (tail + chunk)[-12000:]
                return tail.decode(errors="replace")

            stderr_task = asyncio.create_task(drain_stderr())
            try:
                await asyncio.wait_for(asyncio.gather(consume(), process.wait()), timeout=TIMEOUT)
            except TimeoutError:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=10)
                except TimeoutError:
                    process.kill()
                    await process.wait()
                raise HTTPException(504, "Codex research exceeded the two-hour limit.")
            if process.returncode != 0:
                stderr = await stderr_task
                raise HTTPException(500, f"Codex exited with {process.returncode}: {stderr}")
            result = json.loads(output.read_text(encoding="utf-8"))
            await stderr_task
            return persist(result=result)
    except Exception as exc:
        return persist(error=str(exc.detail) if isinstance(exc, HTTPException) else str(exc))
    finally:
        if process is not None and process.returncode is None:
            process.kill()
            await process.wait()
        active_run = None


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
