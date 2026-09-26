from __future__ import annotations

import asyncio
import gzip
import hashlib
import json
import os
import re
import signal
import copy
import tempfile
import time
from contextlib import nullcontext
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app.research_protocol import VERSION, stages, stage_prompt, validate_stage, validate_research_output
from app.research_inputs import portfolio_context

PORT = int(os.getenv("RUNNER_PORT", "3010"))
MODEL = os.getenv("CODEX_MODEL", "gpt-5.6-sol")
EFFORT = os.getenv("CODEX_REASONING_EFFORT", "xhigh")
TIMEOUT = int(os.getenv("CODEX_TIMEOUT_SECONDS", "10800"))
STARTUP_TIMEOUT = int(os.getenv("CODEX_STARTUP_TIMEOUT_SECONDS", "300"))
IDLE_TIMEOUT = int(os.getenv("CODEX_IDLE_TIMEOUT_SECONDS", "600"))
HEARTBEAT_SECONDS = 30
WORK_ROOT = Path(os.getenv("RESEARCH_WORK_ROOT", "/work"))
RUNNER_REVISION = "allocation-recovery-v4"
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
    resume_from_run_id: str | None = None


class StageFailure(RuntimeError):
    def __init__(self, kind, message, retryable=True):
        super().__init__(message)
        self.kind, self.retryable = kind, retryable


def safe_diagnostic(value):
    value = re.sub(r"(?i)(bearer\s+)[A-Za-z0-9._~+/-]+", r"\1[REDACTED]", str(value))
    value = re.sub(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[REDACTED JWT]", value)
    value = re.sub(r"(?i)((?:access_token|refresh_token|api_key|authorization)[\s\"':=]+)[^\s\",}]+", r"\1[REDACTED]", value)
    return value[-12000:]


def process_failure(message):
    message = safe_diagnostic(message)
    lower = message.lower()
    if any(s in lower for s in ("usage limit", "quota", "rate limit", "429")):
        return StageFailure("usage_limit", message, False)
    if any(s in lower for s in ("unauthorized", "authentication", "refresh token", "401", "login required")):
        return StageFailure("authentication", message, False)
    return StageFailure("process_error", message)


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


async def run_stage(run_id, prompt, schema, timeout, record, on_progress=None):
    """One isolated Codex process; the orchestrator owns durable stage state."""
    process = None
    stderr_task = None
    tasks = []
    started = time.monotonic()
    last_progress = started
    substantive = False
    record.update(stderr_tail="", last_event_at=None, event_count=0, usage_complete=False)
    temporary = tempfile.TemporaryDirectory(dir=WORK_ROOT)
    try:
        with nullcontext(temporary.name) as temp:
            output, schema_path = Path(temp) / "output.json", Path(temp) / "schema.json"
            schema_path.write_text(json.dumps(schema), encoding="utf-8")
            # Read-only evidence, not a repeated giant prompt. Never expose auth
            # or broker credentials; these are the already-sanitized run inputs.
            try:
                saved = RESULT_ROOT / f"{UUID(run_id)}.json.gz"
            except ValueError:
                saved = None  # Standalone diagnostic invocation, no archive.
            archive = json.loads(gzip.decompress(saved.read_bytes())) if saved and saved.exists() else {}
            evidence = {"stages": archive.get("stages", []),
                        "portfolio_context": portfolio_context(prompt)}
            (Path(temp) / "prior-research.json").write_text(json.dumps(evidence), encoding="utf-8")
            drafts = [a for a in archive.get("attempts", []) if a.get("name") == record["name"] and a.get("result")]
            if drafts:
                (Path(temp) / "previous-invalid-output.json").write_text(
                    json.dumps({"error": drafts[-1].get("error"), "result": drafts[-1]["result"]}), encoding="utf-8")
            process = await asyncio.create_subprocess_exec(
                "codex", "--search", "--ask-for-approval", "never", "exec", "--model", MODEL, "-c", f'model_reasoning_effort="{EFFORT}"',
                "--sandbox", "read-only", "--ephemeral", "--ignore-user-config", "--skip-git-repo-check",
                "--output-schema", str(schema_path), "--output-last-message", str(output), "--json", "--color", "never",
                limit=4 * 1024 * 1024, cwd=temp, stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                start_new_session=os.name == "posix",
                env={"PATH": os.getenv("PATH", ""), "HOME": "/home/app",
                     "CODEX_HOME": os.getenv("CODEX_HOME", "/codex-auth"), "LANG": "C.UTF-8"})

            async def consume():
                nonlocal last_progress, substantive
                async for raw in process.stdout:
                    try:
                        event = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    record["events"].append(event)
                    record["event_count"] += 1
                    record["last_event_at"] = datetime.now(UTC).isoformat()
                    if event.get("type") not in {"thread.started", "turn.started"}:
                        last_progress, substantive = time.monotonic(), True
                    found = _usage(event)
                    if found:
                        # Codex reports cumulative usage for this isolated process.
                        record["usage"].update(found)
                        record["usage_complete"] = event.get("type") == "turn.completed"
                    if event.get("type") in {"error", "turn.failed"}:
                        raise process_failure(json.dumps(event))
                    await publish(run_id, event)

            async def drain_stderr():
                tail = b""
                while chunk := await process.stderr.read(8192):
                    tail = (tail + chunk)[-12000:]
                    record["stderr_tail"] = safe_diagnostic(tail.decode(errors="replace"))
                return tail.decode(errors="replace")

            async def send_input():
                process.stdin.write(prompt.encode())
                await process.stdin.drain()
                process.stdin.close()

            async def watchdog():
                while True:
                    await asyncio.sleep(HEARTBEAT_SECONDS)
                    elapsed = time.monotonic() - started
                    quiet = time.monotonic() - last_progress
                    record.update(runtime_seconds=round(elapsed, 3), idle_seconds=round(quiet, 1),
                                  phase="researching" if substantive else "waiting_for_first_output")
                    if on_progress:
                        on_progress()
                    if not substantive and elapsed >= STARTUP_TIMEOUT:
                        raise StageFailure("startup_timeout", f"No research output or tool activity for {round(elapsed)} seconds after process start.")
                    if substantive and quiet >= IDLE_TIMEOUT:
                        raise StageFailure("idle_timeout", f"No progress events for {round(quiet)} seconds during research.")
                    await publish(run_id, {"type": "research.stage.heartbeat", "message":
                        f"{record['name']}: {round(elapsed)}s elapsed; {record['event_count']} events; {round(quiet)}s since substantive progress."})

            stderr_task = asyncio.create_task(drain_stderr())
            async def interact():
                await asyncio.gather(send_input(), consume(), process.wait())
            io_task = asyncio.create_task(interact())
            watchdog_task = asyncio.create_task(watchdog())
            tasks = [io_task, watchdog_task]
            done, _ = await asyncio.wait(tasks, timeout=max(.01, timeout), return_when=asyncio.FIRST_COMPLETED)
            if not done:
                raise StageFailure("stage_timeout", f"Stage exceeded its {round(timeout)}-second work deadline.")
            for task in done:
                task.result()
            if not io_task.done():
                raise StageFailure("process_error", "Research watchdog ended unexpectedly.")
            stderr = await stderr_task
            if process.returncode:
                raise process_failure(f"Codex exited with {process.returncode}: {stderr}")
            try:
                return json.loads(output.read_text(encoding="utf-8"))
            except (FileNotFoundError, json.JSONDecodeError) as exc:
                raise StageFailure("validation_error", "Codex completed without a valid final JSON work product.") from exc
    except StageFailure:
        diagnostic = process_failure(record.get("stderr_tail", ""))
        if not diagnostic.retryable:
            raise diagnostic
        raise
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        if process is not None and process.returncode is None:
            if os.name == "posix":
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            else:
                process.kill()
            await asyncio.wait_for(process.wait(), timeout=10)
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        if stderr_task is not None:
            try:
                stderr = await asyncio.wait_for(stderr_task, timeout=3)
                record["stderr_tail"] = safe_diagnostic(stderr)
            except TimeoutError:
                record["stderr_truncated"] = True
        record["process_exit_code"] = process.returncode if process else None
        record["runtime_seconds"] = round(time.monotonic() - started, 3)
        temporary.cleanup()  # Child must exit before removing its working directory.


def save_checkpoint(path, payload):
    temporary = path.with_suffix(".tmp")
    temporary.write_bytes(gzip.compress(json.dumps(payload).encode(), mtime=0))
    temporary.replace(path)


def recovery_screens(source_id, now):
    """Import compatible evidence, never old allocations or trade intents.

    Synthesis/review require a complete reusable dependency chain and <=24h
    evidence. Discovery may be <=72h. Original ages survive recovery chains.
    """
    source_id = str(UUID(source_id))
    path = RESULT_ROOT / f"{source_id}.json.gz"
    if not path.exists():
        raise ValueError("Recovery source archive is unavailable; start fresh research instead.")
    source = json.loads(gzip.decompress(path.read_bytes()))
    if source.get("protocol") != VERSION or source.get("status") != "failed":
        raise ValueError("Only a failed compatible research run can seed recovery.")
    completed = datetime.fromisoformat(source["completed_at"])
    if not 0 <= (now - completed).total_seconds() <= 72 * 3600:
        raise ValueError("Recovery discovery is older than 72 hours; fresh research is required.")
    imported, records = [], []
    for name, industries, _ in stages():
        if name == "allocation":
            break
        dependent = name in {"synthesis", "challenge"}
        expected = 6 if name == "synthesis" else 7
        if dependent and len(imported) != expected:
            continue
        stage = next((s for s in source.get("stages", []) if s["name"] == name), None)
        if stage is None:
            continue
        validate_stage(name, stage["result"], industries)
        original_time = stage.get("source_completed_at") or source["completed_at"]
        age = (now - datetime.fromisoformat(original_time)).total_seconds()
        if not 0 <= age <= (24 if dependent else 72) * 3600:
            continue  # Repeated recovery cannot refresh the evidence-age clock.
        if dependent and any((now - datetime.fromisoformat(s["source_completed_at"])).total_seconds() > 24 * 3600 for s in imported):
            continue
        imported.append({**copy.deepcopy(stage), "reused": True, "source_run_id": source_id,
                         "source_completed_at": original_time})
        original = next((a for a in reversed(source.get("attempts", [])) if a["name"] == name and a["status"] in {"completed", "reused"}), {})
        records.append({"name": name, "status": "reused", "prompt": original.get("prompt", "See source archive."),
                        "result": copy.deepcopy(stage["result"]), "events": [], "usage": {}, "runtime_seconds": 0,
                        "source_usage": original.get("source_usage") or original.get("usage", {}),
                        "source_run_id": source_id, "source_completed_at": original_time})
    return imported, records


@app.get("/healthz")
async def health():
    return {"ok": True, "active_run": active_run, "model": MODEL, "reasoning_effort": EFFORT,
            "protocol": VERSION, "stage_count": len(stages()), "timeout_seconds": TIMEOUT,
            "runner_revision": RUNNER_REVISION, "startup_timeout_seconds": STARTUP_TIMEOUT,
            "idle_timeout_seconds": IDLE_TIMEOUT}


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
        if payload.get("recovered_from_run_id") != request.resume_from_run_id:
            raise HTTPException(409, "Recovery source cannot change for an existing run.")
        if payload.get("status") != "running":
            return payload
    if active_run:
        raise HTTPException(429, "The research runner is already active.")
    active_run = run_id
    now = datetime.now(UTC)
    payload = payload or {"status": "running", "ok": False, "result": None, "error": None,
        "started_at": now.isoformat(), "deadline": now.timestamp() + TIMEOUT, "protocol": VERSION,
        "prompt_sha256": prompt_hash, "model": MODEL, "reasoning_effort": EFFORT,
        "stages": [], "attempts": [], "events": [], "usage": {}, "runtime_seconds": 0,
        "recovered_from_run_id": request.resume_from_run_id, "runner_revision": RUNNER_REVISION}

    def checkpoint():
        payload["usage"] = {key: sum(a["usage"].get(key, 0) for a in payload["attempts"])
                            for key in ("input_tokens", "output_tokens", "cached_input_tokens")}
        payload["runtime_seconds"] = round(sum(a.get("runtime_seconds", 0) for a in payload["attempts"]), 3)
        payload["usage_incomplete"] = any(a["status"] != "reused" and not a.get("usage_complete", bool(a.get("usage"))) for a in payload["attempts"])
        save_checkpoint(saved, payload)

    try:
        if payload["protocol"] != VERSION:
            raise RuntimeError("Cannot resume an incompatible research protocol.")
        if request.resume_from_run_id and not payload["attempts"]:
            if str(UUID(request.resume_from_run_id)) == run_id:
                raise ValueError("A run cannot recover from itself.")
            payload["stages"], payload["attempts"] = recovery_screens(request.resume_from_run_id, now)
            checkpoint()
            await publish(run_id, {"type": "research.recovered", "message":
                f"Reused {len(payload['stages'])} validated evidence stages from {request.resume_from_run_id}. Portfolio context is fresh; allocation and execution authority are never reused."})
        # A killed process cannot have an unverified partial result reused.
        for attempt in payload["attempts"]:
            if attempt["status"] == "running":
                attempt.update(status="interrupted", error="Runner restarted before stage checkpoint.")
                payload["usage_incomplete"] = True
        async def perform(index, name, industries, schema, max_attempts=2):
            existing = next((s for s in payload["stages"] if s["name"] == name), None)
            if existing:
                validate_stage(name, existing["result"], industries)
                return
            previous_attempts = [a for a in payload["attempts"] if a["name"] == name and a["status"] != "reused"]
            # Allocation has separate bounded budgets: up to two transport
            # failures and two invalid drafts, maximum four process launches.
            # One startup timeout must not consume the JSON-correction chance.
            def can_attempt():
                if name != "allocation":
                    return len(previous_attempts) < max_attempts
                invalid = sum(a.get("failure_kind") == "validation_error" for a in previous_attempts)
                transient = len(previous_attempts) - invalid
                return len(previous_attempts) < 4 and invalid < 2 and transient < 2
            while can_attempt():
                remaining = payload["deadline"] - datetime.now(UTC).timestamp()
                if remaining < 30:
                    raise StageFailure("total_deadline", "The three-hour research deadline was reached; no new orders are approved.", False)
                prompt = stage_prompt(request.prompt, name, industries, payload["stages"], lean=bool(previous_attempts))
                if previous_attempts:
                    prompt += "\nPrevious attempt outcome: " + safe_diagnostic(previous_attempts[-1].get("error", "interrupted"))[-1500:] + ". Use the reduced context to complete the full required work product."
                    if any(a.get("result") for a in previous_attempts):
                        prompt += " Read previous-invalid-output.json for the full rejected draft and error. Correct the stated problem and check ALL invariants, preserving justified research rather than redoing discovery. The draft is not approved and does not authorize trades."
                attempt = {"name": name, "status": "running", "prompt": prompt, "events": [], "usage": {},
                           "started_at": datetime.now(UTC).isoformat(), "runtime_seconds": 0,
                           "input_chars": len(prompt), "input_mode": "lean_recovery" if previous_attempts else "stage_specific"}
                payload["attempts"].append(attempt)
                previous_attempts.append(attempt)
                payload["current_stage"] = name
                checkpoint()
                await publish(run_id, {"type": "research.stage.started", "message": f"Stage {index+1}/9: {name}"})
                try:
                    # Screens get up to 20 min each, synthesis 35, audit 25,
                    # allocation 20, all inside one restart-safe total deadline.
                    ceiling = 1200 if industries else {"synthesis": 2100, "challenge": 1500, "allocation": 1200}[name]
                    result = await run_stage(run_id, prompt, schema, min(remaining, ceiling), attempt, on_progress=checkpoint)
                    attempt["result"] = result
                    try:
                        validate_stage(name, result, industries)
                        context = portfolio_context(request.prompt)
                        if name == "allocation" and context is not None:
                            checked = {**result, "research_dossier": {"protocol": VERSION, "stages": payload["stages"]}}
                            validate_research_output(checked, context.get("positions", []), context.get("strategy_performance"))
                    except ValueError as exc:
                        raise StageFailure("validation_error", str(exc)) from exc
                    attempt["status"] = "completed"
                    payload["stages"].append({"name": name, "result": result, "usage": attempt["usage"],
                                              "runtime_seconds": attempt["runtime_seconds"]})
                    checkpoint()
                    await publish(run_id, {"type": "research.stage.completed", "message": f"Validated stage {index+1}/9: {name}"})
                    return
                except Exception as exc:
                    kind = exc.kind if isinstance(exc, StageFailure) else "stage_timeout" if isinstance(exc, TimeoutError) else "process_error"
                    retryable = exc.retryable if isinstance(exc, StageFailure) else True
                    attempt.update(status="failed", error=safe_diagnostic(str(exc) or type(exc).__name__),
                                   failure_kind=kind, retryable=retryable)
                    checkpoint()
                    await publish(run_id, {"type": "research.stage.failed", "message": f"{name}: {kind}: {attempt['error']}"})
                    if not retryable:
                        raise StageFailure(kind, f"Stage {name}: {attempt['error']}", False) from exc
            last = previous_attempts[-1]
            raise StageFailure(last.get("failure_kind", "process_error"),
                               f"Stage {name} stopped after {len(previous_attempts)} attempts: {last.get('error', 'interrupted')}. No new orders approved.")

        specs = stages()
        deferred = []
        for index, (name, industries, schema) in enumerate(specs[:6]):
            try:
                await perform(index, name, industries, schema)
            except StageFailure as exc:
                if exc.retryable and exc.kind in {"startup_timeout", "idle_timeout", "stage_timeout", "process_error"}:
                    deferred.append((index, name, industries, schema))
                    await publish(run_id, {"type": "research.stage.deferred", "message": f"{name} deferred; continuing independent screens before one final bounded recovery attempt."})
                else:
                    raise
        for index, name, industries, schema in deferred:
            await perform(index, name, industries, schema, max_attempts=3)
        for index, (name, industries, schema) in enumerate(specs[6:], 6):
            await perform(index, name, industries, schema)
        ordered = [next(s for s in payload["stages"] if s["name"] == name) for name, _, _ in specs]
        result = dict(ordered[-1]["result"])
        result["research_dossier"] = {"protocol": VERSION, "stages": ordered[:-1]}
        payload.update(status="completed", ok=True, result=result, current_stage=None)
    except Exception as exc:
        payload.update(status="failed", ok=False, error=safe_diagnostic(str(exc) or type(exc).__name__), result=None,
                       failure_kind=exc.kind if isinstance(exc, StageFailure) else "runner_error")
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
