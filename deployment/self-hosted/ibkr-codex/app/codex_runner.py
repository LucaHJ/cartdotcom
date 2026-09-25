from __future__ import annotations

import asyncio
import gzip
import hashlib
import json
import os
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app.research_protocol import VERSION, stages, stage_prompt, validate_stage

PORT = int(os.getenv("RUNNER_PORT", "3010"))
MODEL = os.getenv("CODEX_MODEL", "gpt-5.6-sol")
EFFORT = os.getenv("CODEX_REASONING_EFFORT", "xhigh")
TIMEOUT = int(os.getenv("CODEX_TIMEOUT_SECONDS", "10800"))
EVENT_URL = os.getenv("INTERNAL_EVENT_URL", "")
RESULT_ROOT = Path(os.getenv("ARTIFACT_ROOT", "/data/artifacts")) / "runner-results"
active_run: str | None = None
app = FastAPI(title="IBKR Codex isolated staged runner")


def _secret(name):
    path = os.getenv(f"{name}_FILE", "")
    return Path(path).read_text().strip() if path and Path(path).exists() else os.getenv(name, "")


class ResearchRequest(BaseModel):
    run_id: str
    prompt: str


def _usage(event):
    candidates = [event.get("usage")] + [v.get("usage") for v in event.values() if isinstance(v, dict)]
    for value in candidates:
        if isinstance(value, dict) and ("input_tokens" in value or "output_tokens" in value):
            details = value.get("input_tokens_details") or {}
            return {"input_tokens": int(value.get("input_tokens", 0)),
                    "output_tokens": int(value.get("output_tokens", 0)),
                    "cached_input_tokens": int(value.get("cached_input_tokens", details.get("cached_tokens", 0)))}
    return None


async def publish(run_id, event):
    if not EVENT_URL:
        return
    item = event.get("item") if isinstance(event.get("item"), dict) else {}
    event_type = str(event.get("type", "codex.progress"))[:100]
    message = next((str(item.get(k) or event.get(k)) for k in ("text", "message", "command", "status")
                    if item.get(k) or event.get(k)), event_type.replace(".", " "))
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(EVENT_URL, headers={"authorization": f"Bearer {_secret('INTERNAL_API_TOKEN')}"},
                              json={"run_id": run_id, "event_type": event_type, "message": message[:4000],
                                    "details": {"item_type": item.get("type"), "usage": _usage(event)}})
    except Exception:
        pass


async def run_stage(run_id, prompt, schema, timeout, record):
    """One isolated Codex process; the orchestrator owns durable stage state."""
    process = None
    stderr_task = None
    started = time.monotonic()
    try:
        with tempfile.TemporaryDirectory(dir="/work") as temp:
            output, schema_path = Path(temp) / "output.json", Path(temp) / "schema.json"
            schema_path.write_text(json.dumps(schema), encoding="utf-8")
            process = await asyncio.create_subprocess_exec(
                "codex", "--search", "exec", "--model", MODEL, "-c", f'model_reasoning_effort="{EFFORT}"',
                "--sandbox", "read-only", "--ephemeral", "--ignore-user-config", "--skip-git-repo-check",
                "--output-schema", str(schema_path), "--output-last-message", str(output), "--json", "--color", "never",
                limit=4 * 1024 * 1024, cwd="/work", stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                env={"PATH": os.getenv("PATH", ""), "HOME": "/home/app",
                     "CODEX_HOME": os.getenv("CODEX_HOME", "/codex-auth"), "LANG": "C.UTF-8"})

            async def consume():
                async for raw in process.stdout:
                    try:
                        event = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    record["events"].append(event)
                    found = _usage(event)
                    if found:
                        # Codex reports cumulative usage for this isolated process.
                        record["usage"].update(found)
                    await publish(run_id, event)

            async def drain_stderr():
                tail = b""
                while chunk := await process.stderr.read(8192):
                    tail = (tail + chunk)[-12000:]
                return tail.decode(errors="replace")

            async def interact():
                process.stdin.write(prompt.encode())
                await process.stdin.drain()
                process.stdin.close()
                await asyncio.gather(consume(), process.wait())

            stderr_task = asyncio.create_task(drain_stderr())
            await asyncio.wait_for(interact(), timeout=max(1, timeout))
            stderr = await stderr_task
            if process.returncode:
                raise RuntimeError(f"Codex exited with {process.returncode}: {stderr}")
            return json.loads(output.read_text(encoding="utf-8"))
    finally:
        if process is not None and process.returncode is None:
            process.kill()
            await process.wait()
        if stderr_task is not None:
            await stderr_task
        record["runtime_seconds"] = round(time.monotonic() - started, 3)


def save_checkpoint(path, payload):
    temporary = path.with_suffix(".tmp")
    temporary.write_bytes(gzip.compress(json.dumps(payload).encode(), mtime=0))
    temporary.replace(path)


@app.get("/healthz")
async def health():
    return {"ok": True, "active_run": active_run, "model": MODEL, "reasoning_effort": EFFORT,
            "protocol": VERSION, "stage_count": len(stages()), "timeout_seconds": TIMEOUT}


@app.post("/research")
async def research(request: ResearchRequest):
    global active_run
    try:
        run_id = str(UUID(request.run_id))
    except ValueError as exc:
        raise HTTPException(422, "A UUID run id is required.") from exc
    RESULT_ROOT.mkdir(parents=True, exist_ok=True)
    saved = RESULT_ROOT / f"{run_id}.json.gz"
    prompt_hash = hashlib.sha256(request.prompt.encode()).hexdigest()
    payload = None
    if saved.exists():
        payload = json.loads(gzip.decompress(saved.read_bytes()))
        if payload.get("prompt_sha256") != prompt_hash:
            raise HTTPException(409, "Run id already belongs to a different prompt.")
        if payload.get("status") != "running":
            return payload
    if active_run:
        raise HTTPException(429, "The research runner is already active.")
    active_run = run_id
    now = datetime.now(UTC)
    payload = payload or {"status": "running", "ok": False, "result": None, "error": None,
        "started_at": now.isoformat(), "deadline": now.timestamp() + TIMEOUT, "protocol": VERSION,
        "prompt_sha256": prompt_hash, "model": MODEL, "reasoning_effort": EFFORT,
        "stages": [], "attempts": [], "events": [], "usage": {}, "runtime_seconds": 0}

    def checkpoint():
        payload["usage"] = {key: sum(a["usage"].get(key, 0) for a in payload["attempts"])
                            for key in ("input_tokens", "output_tokens", "cached_input_tokens")}
        payload["runtime_seconds"] = round(sum(a.get("runtime_seconds", 0) for a in payload["attempts"]), 3)
        save_checkpoint(saved, payload)

    try:
        if payload["protocol"] != VERSION:
            raise RuntimeError("Cannot resume an incompatible research protocol.")
        # A killed process cannot have an unverified partial result reused.
        for attempt in payload["attempts"]:
            if attempt["status"] == "running":
                attempt.update(status="interrupted", error="Runner restarted before stage checkpoint.")
                payload["usage_incomplete"] = True
        for index, (name, industries, schema) in enumerate(stages()):
            existing = next((s for s in payload["stages"] if s["name"] == name), None)
            if existing:
                validate_stage(name, existing["result"], industries)
                continue
            prompt = stage_prompt(request.prompt, name, industries, payload["stages"])
            previous_attempts = [a for a in payload["attempts"] if a["name"] == name]
            if previous_attempts:
                prompt += "\nPrevious attempt failed: " + previous_attempts[-1].get("error", "interrupted") + ". Correct the work product."
            while len([a for a in payload["attempts"] if a["name"] == name]) < 2:
                remaining = payload["deadline"] - datetime.now(UTC).timestamp()
                if remaining < 30:
                    raise TimeoutError("The three-hour research deadline was reached; no new orders are approved.")
                attempt = {"name": name, "status": "running", "prompt": prompt, "events": [], "usage": {},
                           "started_at": datetime.now(UTC).isoformat(), "runtime_seconds": 0}
                payload["attempts"].append(attempt)
                payload["current_stage"] = name
                checkpoint()
                await publish(run_id, {"type": "research.stage.started", "message": f"Stage {index+1}/9: {name}"})
                try:
                    # Screens get up to 20 min each, synthesis 35, audit 25,
                    # allocation 20, all inside one restart-safe total deadline.
                    ceiling = 1200 if industries else {"synthesis": 2100, "challenge": 1500, "allocation": 1200}[name]
                    result = await run_stage(run_id, prompt, schema, min(remaining, ceiling), attempt)
                    attempt["result"] = result
                    validate_stage(name, result, industries)
                    attempt["status"] = "completed"
                    payload["stages"].append({"name": name, "result": result, "usage": attempt["usage"],
                                              "runtime_seconds": attempt["runtime_seconds"]})
                    checkpoint()
                    await publish(run_id, {"type": "research.stage.completed", "message": f"Validated stage {index+1}/9: {name}"})
                    break
                except Exception as exc:
                    attempt.update(status="failed", error=str(exc) or type(exc).__name__)
                    checkpoint()
                    prompt += "\nRequired repair: " + attempt["error"] + ". Rebuild the complete valid stage result."
            else:
                raise RuntimeError(f"Stage {name} did not pass validation after two attempts; no new orders approved.")
        result = dict(payload["stages"][-1]["result"])
        result["research_dossier"] = {"protocol": VERSION, "stages": payload["stages"][:-1]}
        payload.update(status="completed", ok=True, result=result, current_stage=None)
    except Exception as exc:
        payload.update(status="failed", ok=False, error=str(exc) or type(exc).__name__, result=None)
    finally:
        payload["completed_at"] = datetime.now(UTC).isoformat()
        # Events are archived once per attempt, not copied into a second giant list.
        payload["events"] = [{"type": "research.stage.summary", "stage": a["name"], "status": a["status"],
                              "usage": a["usage"], "error": a.get("error")} for a in payload["attempts"]]
        try:
            checkpoint()
        finally:
            active_run = None
    return payload


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
