#!/usr/bin/env python3
"""Credential-free host wrapper for Phase 6 authority changes."""

from __future__ import annotations

import argparse
import json
import stat
import subprocess
from pathlib import Path
from typing import Any

CONTROL_SCRIPT = "/opt/reel/phase6_dispatch_control.py"
TOKEN_CONTAINER_PATH = "/run/control-secrets/phase5_admin_token"


def parse_json(text: str) -> dict[str, Any]:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise RuntimeError("Phase 6 authority control returned no JSON")
    payload = json.loads(text[start:end + 1])
    if not isinstance(payload, dict):
        raise RuntimeError("Phase 6 authority control returned non-object JSON")
    return payload


def invoke(args: argparse.Namespace, command: str, generation: int) -> dict[str, Any]:
    cmd = [
        "docker", "compose", "-f", args.compose_file, "--profile", "phase5-runner", "run", "--rm", "--no-deps",
        "--entrypoint", "python3", "--volume", f"{args.admin_token_host_file}:{TOKEN_CONTAINER_PATH}:ro",
        "phase5-control", CONTROL_SCRIPT, command, "--schema", args.schema,
        "--generation", str(generation), "--lease-owner", args.lease_owner, "--reason", args.reason,
    ]
    result = subprocess.run(cmd, cwd=args.project_dir, text=True, encoding="utf-8", errors="replace", stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"Phase 6 authority command failed rc={result.returncode}: {(result.stderr or result.stdout)[-2500:]}")
    return parse_json(result.stdout)


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 6 authority wrapper")
    parser.add_argument("action", choices=("state", "transition", "local", "cloud", "rollback-cloud"))
    parser.add_argument("--generation", type=int, required=True)
    parser.add_argument("--project-dir", default="/srv/cartdotcom/instagram-reel-brain")
    parser.add_argument("--compose-file", default="compose.yaml")
    parser.add_argument("--schema", default="reel_phase4_shadow_20260821_014246")
    parser.add_argument("--lease-owner", default="phase6-local-worker-1")
    parser.add_argument("--admin-token-host-file", default="/srv/cartdotcom/instagram-reel-brain/secrets/phase5_admin_token")
    parser.add_argument("--reason", default="phase6_operator_authority_change")
    args = parser.parse_args()
    args.project_dir = str(Path(args.project_dir).resolve())
    args.compose_file = str(Path(args.project_dir, args.compose_file).resolve())
    token = Path(args.admin_token_host_file)
    if not token.exists() or stat.S_IMODE(token.stat().st_mode) & 0o077:
        raise SystemExit("Phase 6 token file is missing or not mode 0600")
    if args.action == "rollback-cloud":
        transition = invoke(args, "authority-transition", args.generation)
        next_generation = int((transition.get("authority") or {}).get("generation", args.generation))
        result = invoke(args, "authority-cloud", next_generation)
        payload = {"ok": True, "transition": transition, "cloud": result}
    elif args.action == "state":
        payload = invoke(args, "state", args.generation)
    else:
        payload = invoke(args, f"authority-{args.action}", args.generation)
    print(json.dumps(payload, indent=2, sort_keys=True, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

