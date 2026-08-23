#!/usr/bin/env python3
"""Credential-free host dispatcher for serial Phase 6 exact jobs."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import stat
import subprocess
import time
from pathlib import Path
from typing import Any

CONTROL_SCRIPT = "/opt/reel/phase6_dispatch_control.py"
TOKEN_CONTAINER_PATH = "/run/control-secrets/phase5_admin_token"


def parse_json(text: str) -> dict[str, Any]:
    stripped = text.strip()
    start, end = stripped.find("{"), stripped.rfind("}")
    if start < 0 or end <= start:
        raise RuntimeError("Phase 6 control returned no JSON")
    parsed = json.loads(stripped[start:end + 1])
    if not isinstance(parsed, dict):
        raise RuntimeError("Phase 6 control returned non-object JSON")
    return parsed


def control(args: argparse.Namespace, command: str) -> dict[str, Any]:
    cmd = [
        "docker", "compose", "-f", args.compose_file, "--profile", "phase5-runner", "run", "--rm", "--no-deps",
        "--entrypoint", "python3", "--volume", f"{args.admin_token_host_file}:{TOKEN_CONTAINER_PATH}:ro",
        "phase5-control", CONTROL_SCRIPT, command, "--schema", args.schema,
        "--generation", str(args.generation), "--lease-owner", args.lease_owner,
    ]
    result = subprocess.run(cmd, cwd=args.project_dir, text=True, encoding="utf-8", errors="replace", stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=args.control_timeout, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"Phase 6 control command failed rc={result.returncode}: {(result.stderr or result.stdout)[-2000:]}")
    return parse_json(result.stdout)


def orchestrate(args: argparse.Namespace, candidate: dict[str, Any]) -> None:
    cmd = [
        "python3", "scripts/phase5_one_job_orchestrator.py", "--project-dir", args.project_dir,
        "--pilot-key", str(candidate["pilot_key"]), "--job-id", str(candidate["job_id"]),
        "--source-message-id", str(candidate["source_message_id"]), "--lease-owner", args.lease_owner,
        "--schema", args.schema, "--admin-token-host-file", args.admin_token_host_file,
        "--timeout-seconds", str(args.job_timeout), "--container-timeout", str(args.job_timeout),
    ]
    result = subprocess.run(cmd, cwd=args.project_dir, text=True, encoding="utf-8", errors="replace", stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=args.job_timeout + 120, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"Phase 6 exact orchestrator failed rc={result.returncode}: {(result.stderr or result.stdout)[-3000:]}")


def run_once(args: argparse.Namespace) -> dict[str, Any]:
    claimed = control(args, "claim-next")
    if claimed.get("idle") is True:
        return claimed
    candidate = claimed.get("candidate")
    if not isinstance(candidate, dict):
        raise RuntimeError("Phase 6 claim response omitted exact candidate")
    orchestrate(args, candidate)
    return {"ok": True, "idle": False, "completed_job_id": candidate.get("job_id"), "pilot_key": candidate.get("pilot_key")}


def main() -> int:
    parser = argparse.ArgumentParser(description="Serial Phase 6 host dispatcher")
    parser.add_argument("--project-dir", default="/srv/cartdotcom/instagram-reel-brain")
    parser.add_argument("--compose-file", default="compose.yaml")
    parser.add_argument("--schema", default="reel_phase4_shadow_20260821_014246")
    parser.add_argument("--generation", type=int, required=True)
    parser.add_argument("--lease-owner", default="phase6-local-worker-1")
    parser.add_argument("--admin-token-host-file", default="/srv/cartdotcom/instagram-reel-brain/secrets/phase5_admin_token")
    parser.add_argument("--poll-seconds", type=int, default=20)
    parser.add_argument("--job-timeout", type=int, default=900)
    parser.add_argument("--control-timeout", type=int, default=120)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    args.project_dir = str(Path(args.project_dir).resolve())
    args.compose_file = str(Path(args.project_dir, args.compose_file).resolve())
    token_path = Path(args.admin_token_host_file)
    if not token_path.exists() or stat.S_IMODE(token_path.stat().st_mode) & 0o077:
        raise SystemExit("Phase 6 token file is missing or not mode 0600")
    lock_path = Path(args.project_dir) / "runs" / "phase6-dispatcher.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("w", encoding="utf-8") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        while True:
            try:
                result = run_once(args)
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

