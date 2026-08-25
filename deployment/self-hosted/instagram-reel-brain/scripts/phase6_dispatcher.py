#!/usr/bin/env python3
"""Credential-free host dispatcher for one bounded Phase 6 worker slot."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import stat
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

CONTROL_SCRIPT = "/opt/reel/phase6_dispatch_control.py"
TOKEN_CONTAINER_PATH = "/run/control-secrets/phase5_admin_token"
MAX_CONCURRENCY = 2


def parse_json(text: str) -> dict[str, Any]:
    stripped = text.strip()
    start, end = stripped.find("{"), stripped.rfind("}")
    if start < 0 or end <= start:
        raise RuntimeError("Phase 6 control returned no JSON")
    parsed = json.loads(stripped[start:end + 1])
    if not isinstance(parsed, dict):
        raise RuntimeError("Phase 6 control returned non-object JSON")
    return parsed


def control(args: argparse.Namespace, command: str, extra_args: list[str] | None = None) -> dict[str, Any]:
    cmd = [
        "docker", "compose", "-f", args.compose_file, "--profile", "phase5-runner", "run", "--rm", "--no-deps",
        "--entrypoint", "python3", "--volume", f"{args.admin_token_host_file}:{TOKEN_CONTAINER_PATH}:ro",
        "phase5-control", CONTROL_SCRIPT, command, "--schema", args.schema,
        "--generation", str(args.generation), "--lease-owner", args.lease_owner,
    ]
    cmd.extend(extra_args or [])
    result = subprocess.run(cmd, cwd=args.project_dir, text=True, encoding="utf-8", errors="replace", stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=args.control_timeout, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"Phase 6 control command failed rc={result.returncode}: {(result.stderr or result.stdout)[-2000:]}")
    return parse_json(result.stdout)


def safe_name(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in value)[:180]


def attempt_key(candidate: dict[str, Any]) -> str:
    return f"attempt-{max(0, int(candidate.get('attempts') or 0)) + 1}"


def prefetch_container_path(candidate: dict[str, Any]) -> str:
    return f"/runs/compute/phase6-prefetch/{safe_name(str(candidate['job_id']))}/{attempt_key(candidate)}"


def orchestrator_command(args: argparse.Namespace, candidate: dict[str, Any]) -> list[str]:
    return [
        "python3", "scripts/phase5_one_job_orchestrator.py", "--project-dir", args.project_dir,
        "--pilot-key", str(candidate["pilot_key"]), "--job-id", str(candidate["job_id"]),
        "--source-message-id", str(candidate["source_message_id"]), "--lease-owner", args.lease_owner,
        "--attempt-key", attempt_key(candidate),
        "--schema", args.schema, "--admin-token-host-file", args.admin_token_host_file,
        "--timeout-seconds", str(args.job_timeout), "--container-timeout", str(args.job_timeout),
        "--prefetch-container-path", prefetch_container_path(candidate),
        "--abort-on-compute-failure",
    ]


def eligible_prefetch(response: dict[str, Any], current_job_id: str) -> dict[str, Any] | None:
    active = response.get("active") if isinstance(response.get("active"), dict) else {}
    candidate = response.get("candidate") if isinstance(response.get("candidate"), dict) else None
    if (
        response.get("ok") is not True
        or active.get("job_id") != current_job_id
        or active.get("job_status") != "running"
        or active.get("job_stage") != "synthesizing"
        or not candidate
        or candidate.get("job_id") == current_job_id
        or candidate.get("job_status") != "queued"
        or candidate.get("job_stage") != "queued"
        or not str(candidate.get("source_url") or "").startswith("https://www.instagram.com/reel/")
    ):
        return None
    return candidate


def prefetch(args: argparse.Namespace, candidate: dict[str, Any]) -> dict[str, Any]:
    prefetch_lock_path = Path(args.project_dir) / "runs" / "phase6-prefetch.lock"
    prefetch_lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock = prefetch_lock_path.open("w", encoding="utf-8")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        return {"ok": True, "job_id": candidate["job_id"], "skipped": "prefetch_slot_busy"}
    command = [
        "docker", "compose", "-f", args.compose_file, "--profile", "phase5-runner", "run", "--rm", "--no-deps",
        "--entrypoint", "python3", "phase6-prefetch", "/opt/reel/processor/app.py", "--prefetch",
        str(candidate["source_url"]), str(candidate["job_id"]), str(candidate["source_message_id"]),
        prefetch_container_path(candidate),
    ]
    started = time.monotonic()
    try:
        result = subprocess.run(
            command, cwd=args.project_dir, text=True, encoding="utf-8", errors="replace",
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=args.prefetch_timeout, check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(f"Phase 6 prefetch failed rc={result.returncode}: {(result.stderr or result.stdout)[-1200:]}")
        payload = parse_json(result.stdout)
        return {"job_id": candidate["job_id"], "seconds": round(time.monotonic() - started, 3), **payload}
    finally:
        lock.close()


def orchestrate(args: argparse.Namespace, candidate: dict[str, Any], lock_fd: int) -> dict[str, Any]:
    cmd = orchestrator_command(args, candidate)
    # Keep the dispatcher flock inherited by the exact orchestrator. If the
    # dispatcher is killed, the in-flight child still owns serial authority and
    # a watchdog replacement cannot launch a duplicate compute container.
    process = subprocess.Popen(
        cmd,
        cwd=args.project_dir,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        pass_fds=(lock_fd,),
    )
    deadline = time.monotonic() + args.job_timeout + 120
    prefetch_outcome: dict[str, Any] | None = None
    prefetch_attempted = False
    while process.poll() is None:
        if time.monotonic() >= deadline:
            process.kill()
            stdout, stderr = process.communicate()
            raise RuntimeError(f"Phase 6 exact orchestrator timed out: {(stderr or stdout)[-3000:]}")
        if not prefetch_attempted:
            try:
                next_response = control(args, "prefetch-next")
                next_candidate = eligible_prefetch(next_response, str(candidate["job_id"]))
                if next_candidate:
                    prefetch_attempted = True
                    prefetch_outcome = prefetch(args, next_candidate)
            except Exception as error:  # Prefetch is an optimisation; exact processing remains authoritative.
                prefetch_attempted = True
                prefetch_outcome = {"ok": False, "error": str(error)[-1000:]}
        if process.poll() is None:
            time.sleep(max(1, args.prefetch_poll_seconds))
    stdout, stderr = process.communicate()
    if process.returncode != 0:
        raise RuntimeError(f"Phase 6 exact orchestrator failed rc={process.returncode}: {(stderr or stdout)[-3000:]}")
    outcome = parse_json(stdout)
    if prefetch_outcome is not None:
        outcome["prefetch"] = prefetch_outcome
    return outcome


def parse_created_at(value: Any) -> datetime | None:
    try:
        text = str(value or "").strip().replace(" ", "T")
        if text and not text.endswith(("Z", "+00:00")):
            text += "Z"
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def append_performance(args: argparse.Namespace, candidate: dict[str, Any], outcome: dict[str, Any], elapsed: float, dispatch_started: datetime) -> None:
    result_summary: dict[str, Any] = {}
    result_path = outcome.get("result_host_path")
    if isinstance(result_path, str) and result_path:
        try:
            parsed = json.loads(Path(result_path).read_text(encoding="utf-8"))
            if isinstance(parsed.get("processor_result"), dict):
                result_summary = parsed["processor_result"]
        except Exception:
            result_summary = {}
    recorded_at = datetime.now(timezone.utc)
    timings = result_summary.get("timings") if isinstance(result_summary.get("timings"), dict) else None
    processor_total = float(timings.get("total_seconds") or 0) if timings else 0.0
    created_at = parse_created_at(candidate.get("created_at"))
    record = {
        "recorded_at": recorded_at.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "dispatch_started_at": dispatch_started.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "generation": args.generation,
        "dispatcher_slot": args.slot,
        "concurrency_limit": MAX_CONCURRENCY,
        "job_id": candidate.get("job_id"),
        "created_at": candidate.get("created_at"),
        "queue_wait_seconds": round(max(0.0, (dispatch_started - created_at).total_seconds()), 3) if created_at else None,
        "orchestration_seconds": round(elapsed, 3),
        "control_handover_seconds": round(max(0.0, elapsed - processor_total), 3) if timings else None,
        "processor_timings": timings,
        "prefetch": outcome.get("prefetch"),
    }
    path = Path(args.performance_log)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(descriptor, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, separators=(",", ":"), sort_keys=True) + "\n")


def run_once(args: argparse.Namespace, lock_fd: int) -> dict[str, Any]:
    claimed = control(args, "claim-next")
    if claimed.get("idle") is True:
        return claimed
    candidate = claimed.get("candidate")
    if not isinstance(candidate, dict):
        raise RuntimeError("Phase 6 claim response omitted exact candidate")
    dispatch_started = datetime.now(timezone.utc)
    started = time.monotonic()
    outcome = orchestrate(args, candidate, lock_fd)
    append_performance(args, candidate, outcome, time.monotonic() - started, dispatch_started)
    if outcome.get("aborted_after_compute_failure") is True:
        failure = outcome.get("compute_failure") if isinstance(outcome.get("compute_failure"), dict) else {}
        error_code = str(failure.get("error_code") or "error_unknown")
        error_message = str(failure.get("error_message") or "Local compute failed before publication")[-1000:]
        terminal = control(args, "fail-job", [
            "--pilot-key", str(candidate["pilot_key"]),
            "--job-id", str(candidate["job_id"]),
            "--source-message-id", str(candidate["source_message_id"]),
            "--error-code", error_code,
            "--error-message", error_message,
            "--reason", "phase6_compute_failed_after_safe_abort",
        ])
        if terminal.get("ok") is not True or terminal.get("failed") is not True:
            raise RuntimeError(f"Phase 6 terminal failure reconciliation failed: {json.dumps(terminal, sort_keys=True)}")
        return {"ok": False, "idle": False, "failed_job_id": candidate.get("job_id"), "pilot_key": candidate.get("pilot_key"), "stage": error_code, "recovery": "terminal_failure_after_prepublication_abort"}
    return {"ok": True, "idle": False, "completed_job_id": candidate.get("job_id"), "pilot_key": candidate.get("pilot_key")}


def main() -> int:
    parser = argparse.ArgumentParser(description="Bounded Phase 6 host dispatcher slot")
    parser.add_argument("--project-dir", default="/srv/cartdotcom/instagram-reel-brain")
    parser.add_argument("--compose-file", default="compose.yaml")
    parser.add_argument("--schema", default="reel_phase4_shadow_20260821_014246")
    parser.add_argument("--generation", type=int, required=True)
    parser.add_argument("--slot", type=int, choices=range(1, MAX_CONCURRENCY + 1), default=1)
    parser.add_argument("--lease-owner", default="")
    parser.add_argument("--admin-token-host-file", default="/srv/cartdotcom/instagram-reel-brain/secrets/phase5_admin_token")
    parser.add_argument("--poll-seconds", type=int, default=20)
    parser.add_argument("--job-timeout", type=int, default=900)
    parser.add_argument("--control-timeout", type=int, default=120)
    parser.add_argument("--prefetch-timeout", type=int, default=300)
    parser.add_argument("--prefetch-poll-seconds", type=int, default=5)
    parser.add_argument("--performance-log", default="/srv/cartdotcom/instagram-reel-brain/runs/phase6-performance.jsonl")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    args.project_dir = str(Path(args.project_dir).resolve())
    args.compose_file = str(Path(args.project_dir, args.compose_file).resolve())
    expected_owner = f"phase6-local-worker-{args.slot}"
    args.lease_owner = args.lease_owner or expected_owner
    if args.lease_owner != expected_owner:
        raise SystemExit("Phase 6 lease owner does not match dispatcher slot")
    token_path = Path(args.admin_token_host_file)
    if not token_path.exists() or stat.S_IMODE(token_path.stat().st_mode) & 0o077:
        raise SystemExit("Phase 6 token file is missing or not mode 0600")
    lock_path = Path(args.project_dir) / "runs" / f"phase6-dispatcher-slot-{args.slot}.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("w", encoding="utf-8") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        while True:
            try:
                result = run_once(args, lock.fileno())
                print(json.dumps(result, sort_keys=True), flush=True)
            except Exception as error:  # noqa: BLE001
                print(json.dumps({"ok": False, "error": str(error)[-2000:]}, sort_keys=True), flush=True)
                if args.once:
                    return 1
            if args.once:
                return 0
            time.sleep(max(5, args.poll_seconds))


if __name__ == "__main__":
    raise SystemExit(main())
