#!/usr/bin/env python3
"""Redacted readiness probes for the inert Phase 5 Reel runner image."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


PROCESSOR_PATH = Path(os.environ.get("REEL_PHASE5_PROCESSOR_PATH", "/opt/reel/processor/app.py"))
RUNNER_PATH = Path(os.environ.get("REEL_PHASE5_RUNNER_PATH", "/opt/reel/phase5_one_job_runner.py"))
CODEX_AUTH_DIR = Path(os.environ.get("CODEX_HOME", "/codex-auth"))
CODEX_AUTH_SOURCE = os.environ.get("CODEX_AUTH_SOURCE")
WORK_ROOT = Path(os.environ.get("REEL_PHASE5_PROBE_WORK_ROOT", "/work"))
MIN_SECRET_BYTES = 256


def json_print(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, sort_keys=True, indent=2))


def run(command: list[str], *, cwd: Path | None = None, timeout: int = 120, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        input=input_text,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
    )


def checked_output(command: list[str], *, timeout: int = 60) -> str:
    result = run(command, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(f"{command[0]} exited {result.returncode}")
    return (result.stdout or result.stderr).strip()


def redacted_failure(result: subprocess.CompletedProcess[str]) -> dict[str, Any]:
    diagnostics = "\n".join(part for part in [result.stderr, result.stdout] if part).lower()
    if "log in" in diagnostics or "authentication" in diagnostics or "token" in diagnostics:
        category = "auth_required_or_invalid"
    elif "capacity" in diagnostics:
        category = "model_capacity"
    elif "permission" in diagnostics or "read-only" in diagnostics or "eacces" in diagnostics:
        category = "read_only_auth_or_filesystem"
    else:
        category = "command_failed"
    return {
        "returncode": result.returncode,
        "category": category,
        "diagnostic_sha256": hashlib.sha256(diagnostics.encode("utf-8", errors="replace")).hexdigest() if diagnostics else None,
    }


def ensure_codex_auth_link() -> dict[str, Any]:
    if not CODEX_AUTH_SOURCE:
        return {"auth_source_configured": False}
    source = Path(CODEX_AUTH_SOURCE)
    status: dict[str, Any] = {
        "auth_source_configured": True,
        "auth_source_present": source.exists(),
    }
    if not source.exists():
        return status
    auth_file = CODEX_AUTH_DIR / "auth.json"
    CODEX_AUTH_DIR.mkdir(parents=True, exist_ok=True)
    if auth_file.exists() or auth_file.is_symlink():
        try:
            status["auth_link_matches_source"] = auth_file.samefile(source)
            status["auth_file_is_symlink"] = auth_file.is_symlink()
        except OSError:
            status["auth_link_matches_source"] = False
        return status
    auth_file.symlink_to(source)
    status["auth_link_matches_source"] = True
    status["auth_file_is_symlink"] = True
    return status


def auth_status() -> dict[str, Any]:
    link_status = ensure_codex_auth_link()
    auth_file = CODEX_AUTH_DIR / "auth.json"
    if not CODEX_AUTH_DIR.exists() or not auth_file.exists():
        return {"present": False, "auth_dir": str(CODEX_AUTH_DIR), **link_status}
    info = auth_file.stat()
    return {
        "present": True,
        "auth_dir": str(CODEX_AUTH_DIR),
        **link_status,
        "auth_file_mode": stat.filemode(info.st_mode),
        "auth_file_octal_mode": oct(stat.S_IMODE(info.st_mode)),
        "auth_file_uid": info.st_uid,
        "auth_file_gid": info.st_gid,
        "auth_file_bytes": info.st_size,
        "auth_file_readable": os.access(auth_file, os.R_OK),
        "auth_file_not_empty": info.st_size >= MIN_SECRET_BYTES,
    }


def tool_versions() -> dict[str, Any]:
    versions: dict[str, Any] = {
        "python": checked_output(["python3", "--version"]),
        "node": checked_output(["node", "--version"]),
        "npm": checked_output(["npm", "--version"]),
        "ffmpeg": checked_output(["ffmpeg", "-version"]).splitlines()[0],
        "ffprobe": checked_output(["ffprobe", "-version"]).splitlines()[0],
        "yt_dlp": checked_output(["yt-dlp", "--version"]),
        "gallery_dl": checked_output(["gallery-dl", "--version"]),
        "codex": checked_output(["codex", "--version"]),
    }
    return versions


def assert_inert_environment() -> dict[str, Any]:
    disabled_flags = {
        key: os.environ.get(key, "")
        for key in (
            "REEL_INTAKE_ENABLED",
            "REEL_DISPATCH_ENABLED",
            "REEL_WORKER_ENABLED",
            "REEL_CODEX_ENABLED",
            "REEL_OUTBOUND_ENABLED",
            "REEL_MUTATIONS_ENABLED",
            "REEL_BACKLOG_ENABLED",
            "REEL_PUBLISHER_ENABLED",
            "REEL_ARCHIVER_ENABLED",
            "REEL_AUTH_ROTATOR_ENABLED",
            "REEL_PHASE5_RUNNER_ENABLED",
        )
    }
    unsafe = {key: value for key, value in disabled_flags.items() if value.lower() not in ("", "false", "0")}
    instagram_secret_env = [key for key in os.environ if key.startswith("INSTAGRAM_") and os.environ.get(key)]
    return {
        "ok": not unsafe and not instagram_secret_env,
        "disabled_flags": disabled_flags,
        "unsafe_enabled_flags": sorted(unsafe),
        "instagram_secret_env_present": sorted(instagram_secret_env),
        "processor_present": PROCESSOR_PATH.exists(),
        "runner_present": RUNNER_PATH.exists(),
        "codex_auth": auth_status(),
    }


def load_processor():
    if not PROCESSOR_PATH.exists():
        raise RuntimeError(f"processor missing: {PROCESSOR_PATH}")
    spec = importlib.util.spec_from_file_location("phase5_reel_processor", PROCESSOR_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("processor import failed")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fixture_media() -> dict[str, Any]:
    module = load_processor()
    with tempfile.TemporaryDirectory(prefix="phase5-fixture-", dir=str(WORK_ROOT if WORK_ROOT.exists() else Path("/tmp"))) as temp:
        workdir = Path(temp)
        video = workdir / "fixture.mp4"
        generated = run([
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=15",
            "-f", "lavfi", "-i", "sine=frequency=880:duration=3",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-shortest", "-y", str(video),
        ], cwd=workdir, timeout=120)
        if generated.returncode != 0 or not video.exists():
            raise RuntimeError("synthetic video generation failed")
        probe, audio, frames = module.inspect_and_extract(video, workdir)
        metadata = {
            "id": "fixture",
            "canonical_url": "file:///fixture.mp4",
            "title": "Phase 5 fixture",
            "description": "Synthetic local fixture only.",
            "author_username": "fixture",
            "comments": [],
            "audio": {"identification_method": "unidentified"},
        }
        transcript = {"ok": True, "text": "Synthetic transcript fixture.", "segments": []}
        (workdir / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
        (workdir / "transcript.json").write_text(json.dumps(transcript), encoding="utf-8")
        previous_fake = os.environ.get("CODEX_FAKE_RESPONSE")
        os.environ["CODEX_FAKE_RESPONSE"] = "1"
        try:
            synthesis, _ = module.run_codex(
                workdir,
                module.build_prompt(metadata, transcript, "Fixture-only readiness probe."),
                frames[:1],
                60,
                json.dumps({"fixture_auth": True}),
            )
        finally:
            if previous_fake is None:
                os.environ.pop("CODEX_FAKE_RESPONSE", None)
            else:
                os.environ["CODEX_FAKE_RESPONSE"] = previous_fake
        return {
            "ok": True,
            "video_bytes": video.stat().st_size,
            "probe_streams": len(probe.get("streams") or []),
            "audio_bytes": audio.stat().st_size if audio and audio.exists() else 0,
            "frame_count": len(frames),
            "fake_codex_summary": synthesis.get("summary"),
            "network_free": True,
        }


def codex_smoke(model: str, timeout: int) -> dict[str, Any]:
    status = auth_status()
    version = None
    try:
        version = checked_output(["codex", "--version"])
    except Exception as error:  # noqa: BLE001
        return {"ok": False, "available": False, "codex_version": None, "auth": status, "failure": str(error)[:120]}
    if not status.get("present") or not status.get("auth_file_readable"):
        return {"ok": False, "available": False, "codex_version": version, "auth": status, "failure": "auth_file_unavailable"}
    with tempfile.TemporaryDirectory(prefix="phase5-codex-smoke-", dir=str(WORK_ROOT if WORK_ROOT.exists() else Path("/tmp"))) as temp:
        workdir = Path(temp)
        command = [
            "codex", "exec", "--ephemeral", "--ignore-user-config", "--skip-git-repo-check",
            "--json", "--sandbox", "read-only", "-C", str(workdir), "-m", model,
            "-c", 'model_reasoning_effort="low"', "-",
        ]
        result = run(command, cwd=workdir, timeout=timeout, input_text="Reply with exactly OK. Do not browse or inspect files.")
        usage: dict[str, int] = {}
        for line in (result.stdout or "").splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "turn.completed" and isinstance(event.get("usage"), dict):
                for key, value in event["usage"].items():
                    if isinstance(value, int) and key.endswith("tokens"):
                        usage[key] = value
        if result.returncode == 0:
            return {
                "ok": True,
                "available": True,
                "codex_version": version,
                "auth": status,
                "usage": usage,
                "stdout_lines": len((result.stdout or "").splitlines()),
            }
        return {
            "ok": False,
            "available": False,
            "codex_version": version,
            "auth": status,
            "failure": redacted_failure(result),
        }


def runner_fail_closed() -> dict[str, Any]:
    if not RUNNER_PATH.exists():
        return {"ok": False, "failure": "runner_missing"}
    result = run([
        "python3", str(RUNNER_PATH),
        "--pilot-key", "fixture-pilot",
        "--job-id", "fixture-job",
        "--source-message-id", "fixture-message",
        "--ssh-target", "local",
        "--schema", "fixture_schema",
        "--skip-cloud-control",
    ], timeout=30)
    combined = "\n".join(part for part in [result.stderr, result.stdout] if part)
    safe_failure = result.returncode != 0
    return {
        "ok": safe_failure,
        "returncode": result.returncode,
        "diagnostic_sha256": hashlib.sha256(combined.encode("utf-8", errors="replace")).hexdigest() if combined else None,
        "failed_before_cloud_or_processor": safe_failure,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe the inert Phase 5 Reel runner image")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("inert-health")
    sub.add_parser("tool-versions")
    sub.add_parser("fixture-media")
    sub.add_parser("runner-fail-closed")
    codex = sub.add_parser("codex-smoke")
    codex.add_argument("--model", default=os.environ.get("CODEX_RESEARCH_MODEL", "gpt-5.6-luna"))
    codex.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()

    try:
        if args.command == "inert-health":
            payload = assert_inert_environment()
        elif args.command == "tool-versions":
            payload = {"ok": True, "versions": tool_versions()}
        elif args.command == "fixture-media":
            payload = fixture_media()
        elif args.command == "runner-fail-closed":
            payload = runner_fail_closed()
        elif args.command == "codex-smoke":
            payload = codex_smoke(args.model, args.timeout)
        else:
            raise RuntimeError("unknown command")
    except Exception as error:  # noqa: BLE001
        payload = {"ok": False, "error": type(error).__name__, "detail": str(error)[:300]}
    json_print(payload)
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
