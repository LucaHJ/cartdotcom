#!/usr/bin/env python3
"""Host-side Phase 5 exact one-shot control/compute orchestrator.

This wrapper contains no production credential values. It uses host Docker
Compose to invoke the stopped/profile-gated `phase5-control` and
`phase5-compute` services sequentially for one exact job. Control secrets are
mounted only into the control container. Compute receives a read-only signed
control state and writes a separate untrusted result handoff.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import secrets
import shutil
import stat
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

DEFAULT_PROJECT_DIR = Path(__file__).resolve().parents[1]
CONTAINER_RUNNER = "/opt/reel/phase5_staged_runner.py"
CONTAINER_TOKEN_PATH = "/run/control-secrets/phase5_admin_token"
DEFAULT_WORKER = "phase5-local-worker-1"
CONFIRM_PREFIX = "RUN EXACT PHASE 5 LOCAL PILOT"


def json_print(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, indent=2, sort_keys=True, default=str))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def require_exact(value: str | None, name: str, max_length: int = 500) -> str:
    text = (value or "").strip()
    if not text or len(text) > max_length:
        raise SystemExit(f"{name} is required")
    return text


def safe_name(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in value)[:220]


def chmod_private(path: Path, *, directory: bool = False) -> None:
    try:
        os.chmod(path, 0o700 if directory else 0o600)
    except OSError:
        pass


def handoff_paths(args: argparse.Namespace) -> tuple[Path, str, Path, str]:
    run_root = Path(args.runs_root)
    attempt_suffix = f"_{safe_name(args.attempt_key)}" if args.attempt_key else ""
    job_name = safe_name(f"{args.pilot_key}_{args.job_id}{attempt_suffix}")
    if args.checkpoint_host_path:
        host_path = Path(args.checkpoint_host_path)
    else:
        host_path = run_root / "phase5-control" / job_name / "checkpoint.json"
    if args.result_host_path:
        result_host_path = Path(args.result_host_path)
    else:
        result_host_path = run_root / "phase5-compute" / job_name / "result.json"
    host_path.parent.mkdir(parents=True, exist_ok=True)
    result_host_path.parent.mkdir(parents=True, exist_ok=True)
    chmod_private(host_path.parent, directory=True)
    chmod_private(result_host_path.parent, directory=True)
    if args.checkpoint_container_path:
        container_path = args.checkpoint_container_path
    else:
        container_path = f"/runs/control/{job_name}/checkpoint.json"
    if args.result_container_path:
        result_container_path = args.result_container_path
    else:
        result_container_path = f"/runs/compute/{job_name}/result.json"
    return host_path, container_path, result_host_path, result_container_path


def compose_base(args: argparse.Namespace) -> list[str]:
    compose = shutil.which("docker")
    if compose is None:
        raise SystemExit("docker CLI is required on the host orchestrator")
    command = ["docker", "compose"]
    if args.compose_file:
        command.extend(["-f", args.compose_file])
    command.extend(["--profile", "phase5-runner"])
    return command


def docker_network_gateway(args: argparse.Namespace, network: str = "cartdotcom-reel-egress") -> str:
    command = ["docker", "network", "inspect", network, "--format", "{{range .IPAM.Config}}{{.Gateway}}{{end}}"]
    result = subprocess.run(
        command,
        cwd=str(args.project_dir),
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=10,
        check=False,
    )
    gateway = (result.stdout or "").strip().splitlines()[0] if result.stdout else ""
    if result.returncode != 0 or not gateway:
        raise RuntimeError(f"could not determine Docker gateway for {network}: {redact_output(result.stderr or result.stdout or '', [])}")
    return gateway


def redact_output(text: str, secrets_to_redact: list[str]) -> str:
    redacted = text
    for secret in secrets_to_redact:
        if secret:
            redacted = redacted.replace(secret, "[redacted]")
    return redacted[-4000:]


def compute_failure_summary(error: Exception) -> dict[str, str]:
    raw = " ".join(str(error).replace("\r", "\n").split())
    lowered = raw.lower()
    if any(marker in lowered for marker in (
        "isn't available to everyone", "isn’t available to everyone",
        "can't be seen by certain audiences", "cannot be seen by certain audiences",
        "restricted audience", "age-restricted",
    )):
        code = "error_restricted"
    elif "error_auth" in lowered or "authentication" in lowered or "login required" in lowered:
        code = "error_auth"
    elif "error_download" in lowered or "yt-dlp" in lowered or "gallery-dl" in lowered:
        code = "error_download"
    elif "error_media" in lowered or "ffmpeg" in lowered or "ffprobe" in lowered:
        code = "error_media"
    elif "error_transcript" in lowered or "transcri" in lowered or "whisper" in lowered:
        code = "error_transcript"
    elif "error_research" in lowered or "codex" in lowered:
        code = "error_research"
    elif "error_archive" in lowered or "artifact" in lowered or "publication" in lowered:
        code = "error_archive"
    else:
        code = "error_unknown"
    return {"error_code": code, "error_message": raw[-1000:] or type(error).__name__}


def run_compose(args: argparse.Namespace, service: str, staged_args: list[str], *, token_host_file: Path | None = None, env: dict[str, str] | None = None) -> dict[str, Any]:
    command = [*compose_base(args), "run", "--rm", "--no-deps"]
    command.extend(["--entrypoint", "python3"])
    if token_host_file is not None:
        command.extend(["--volume", f"{token_host_file}:{CONTAINER_TOKEN_PATH}:ro"])
    for key, value in (env or {}).items():
        command.extend(["--env", f"{key}={value}"])
    command.extend([service, CONTAINER_RUNNER, *staged_args])
    result = subprocess.run(
        command,
        cwd=str(args.project_dir),
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=args.container_timeout,
        check=False,
    )
    combined = "\n".join(part for part in [result.stdout, result.stderr] if part)
    payload = parse_json_output(result.stdout or "")
    if result.returncode != 0:
        raise RuntimeError(f"{service} staged command failed rc={result.returncode}: {redact_output(combined, [])}")
    return payload or {"ok": True, "stdout_sha256": __import__("hashlib").sha256((result.stdout or "").encode()).hexdigest()}


def parse_json_output(text: str) -> dict[str, Any] | None:
    stripped = text.strip()
    if not stripped:
        return None
    try:
        parsed = json.loads(stripped)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end > start:
        try:
            parsed = json.loads(stripped[start : end + 1])
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None
    return None


def common_stage_args(args: argparse.Namespace, checkpoint_container_path: str, result_container_path: str, worker_url: str) -> list[str]:
    return [
        "--pilot-key", args.pilot_key,
        "--job-id", args.job_id,
        "--source-message-id", args.source_message_id,
        "--lease-owner", args.lease_owner,
        "--schema", args.schema,
        "--checkpoint-path", checkpoint_container_path,
        "--result-path", result_container_path,
        "--worker-url", worker_url,
        "--confirm-live-run", f"{CONFIRM_PREFIX} {args.job_id}",
        "--token-minutes", str(args.token_minutes),
        "--min-callback-seconds", str(args.min_callback_seconds),
    ]


def control_args(args: argparse.Namespace, checkpoint_container_path: str, result_container_path: str, worker_url: str) -> list[str]:
    return [
        *common_stage_args(args, checkpoint_container_path, result_container_path, worker_url),
        "--pg-mode", "native",
        "--admin-token-file", CONTAINER_TOKEN_PATH,
    ]


def compute_args(args: argparse.Namespace, checkpoint_container_path: str, result_container_path: str, worker_url: str, resume_artifacts_json: str = "") -> list[str]:
    command = [
        *common_stage_args(args, checkpoint_container_path, result_container_path, worker_url),
        "--codex-auth-path", args.codex_auth_path,
        "--timeout-seconds", str(args.timeout_seconds),
    ]
    if args.synthetic_processor:
        command.append("--synthetic-processor")
    if resume_artifacts_json:
        command.extend(["--resume-artifacts-json", resume_artifacts_json])
    if args.prefetch_container_path:
        command.extend(["--prefetch-dir", args.prefetch_container_path])
    return command


class FakeWorker:
    def __init__(self, token: str, *, short_authority: bool = False) -> None:
        self.token = token
        self.short_authority = short_authority
        self.requests: list[str] = []
        self.job_complete = False
        self.finalized = False
        self.aborted = False
        self.uploads: list[str] = []
        self.server: ThreadingHTTPServer | None = None
        self.thread: threading.Thread | None = None
        self.artifacts = self.fixture_artifacts()

    @staticmethod
    def fixture_artifacts() -> dict[str, bytes]:
        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
        )
        metadata = {
            "id": "synthetic-stage",
            "canonical_url": "https://example.invalid/reel/synthetic-stage",
            "title": "Synthetic staged Reel",
            "description": "Fixture only.",
            "author_username": "fixture",
            "comments": [],
            "audio": {"identification_method": "unidentified"},
        }
        transcript = {"ok": True, "text": "Synthetic staged transcript.", "segments": []}
        return {
            "metadata.json": json.dumps(metadata).encode("utf-8"),
            "transcript.json": json.dumps(transcript).encode("utf-8"),
            "frame-00.png": png,
        }

    def start(self, *, container_host: str) -> str:
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def _auth_ok(self) -> bool:
                return self.headers.get("Authorization") == f"Bearer {owner.token}"

            def _callback_auth_ok(self) -> bool:
                header = self.headers.get("Authorization") or ""
                return header.startswith("Bearer ") and len(header) > len("Bearer ")

            def _json(self, status: int, payload: dict[str, Any]) -> None:
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(payload).encode("utf-8"))

            def do_POST(self) -> None:  # noqa: N802
                body = self.rfile.read(int(self.headers.get("Content-Length", "0") or "0"))
                is_admin_path = self.path.startswith("/api/admin/")
                if is_admin_path and not self._auth_ok():
                    self._json(401, {"ok": False, "error": "unauthorized"})
                    return
                if not is_admin_path and not self._callback_auth_ok():
                    self._json(401, {"ok": False, "error": "unauthorized"})
                    return
                owner.requests.append(self.path)
                if self.path.endswith("/api/admin/phase5/local-pilot/start"):
                    expires = datetime.now(timezone.utc) + timedelta(seconds=1 if owner.short_authority else 900)
                    if owner.job_complete:
                        self._json(200, {
                            "ok": True,
                            "idempotent": True,
                            "processor_already_complete": True,
                            "recovery_status": "processor_already_complete",
                            "token_expires_at": expires.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                        })
                    else:
                        self._json(200, {
                            "ok": True,
                            "started": True,
                            "token_expires_at": expires.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                        })
                    return
                if self.path.endswith("/api/admin/phase5/local-pilot/finalize"):
                    owner.finalized = True
                    self._json(200, {"ok": True, "finalized": True})
                    return
                if self.path.endswith("/api/admin/phase5/local-pilot/abort"):
                    owner.aborted = True
                    self._json(200, {"ok": True, "aborted": True})
                    return
                if self.path.endswith("/complete"):
                    owner.job_complete = True
                    self._json(200, {"ok": True, "resource_count": 1})
                    return
                if self.path.endswith("/dedupe-check"):
                    self._json(200, {"ok": True, "duplicate": False})
                    return
                if self.path.endswith("/stage"):
                    self._json(200, {"ok": True})
                    return
                if self.path.endswith("/transcribe"):
                    self._json(200, {"ok": True, "text": "Synthetic transcript.", "segments": []})
                    return
                self._json(404, {"ok": False, "error": "not_found", "body_sha256": __import__("hashlib").sha256(body).hexdigest()})

            def do_PUT(self) -> None:  # noqa: N802
                _body = self.rfile.read(int(self.headers.get("Content-Length", "0") or "0"))
                if not self._callback_auth_ok():
                    self._json(401, {"ok": False, "error": "unauthorized"})
                    return
                owner.requests.append(self.path)
                owner.uploads.append(self.path)
                self._json(200, {"ok": True, "key": self.path.rsplit("/", 1)[-1]})

            def do_GET(self) -> None:  # noqa: N802
                if not self._callback_auth_ok():
                    self._json(401, {"ok": False, "error": "unauthorized"})
                    return
                owner.requests.append(self.path)
                name = self.path.rsplit("/", 1)[-1]
                data = owner.artifacts.get(name)
                if data is None:
                    self._json(404, {"ok": False, "error": "artifact_not_found"})
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, _format: str, *_args: Any) -> None:
                return

        self.server = ThreadingHTTPServer(("0.0.0.0", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return f"http://{container_host}:{self.server.server_port}"

    def stop(self) -> None:
        if self.server:
            self.server.shutdown()
        if self.thread:
            self.thread.join(timeout=5)


def resume_artifacts(worker_url: str, job_id: str) -> str:
    base = f"{worker_url.rstrip('/')}/internal/jobs/{job_id}/artifacts"
    return json.dumps([
        {"kind": "metadata", "filename": "metadata.json", "url": f"{base}/metadata.json"},
        {"kind": "transcript", "filename": "transcript.json", "url": f"{base}/transcript.json"},
        {"kind": "frame", "filename": "frame-00.png", "url": f"{base}/frame-00.png"},
    ])


def run_exact_flow(args: argparse.Namespace, *, worker_url: str, token_host_file: Path, resume_json: str = "") -> dict[str, Any]:
    checkpoint_host_path, checkpoint_container_path, result_host_path, result_container_path = handoff_paths(args)
    events: list[dict[str, Any]] = []
    control_common = control_args(args, checkpoint_container_path, result_container_path, worker_url)
    compute_common = compute_args(args, checkpoint_container_path, result_container_path, worker_url, resume_json)

    # Every invocation reconciles through the control container. The host never
    # trusts mutable JSON to decide which authoritative transition to skip.
    events.append({"step": "control-start", "result": run_compose(args, "phase5-control", ["control-start", *control_common], token_host_file=token_host_file)})
    if args.fault_at == "after-start":
        return {"ok": True, "stopped_at": "after-start", "events": events, "checkpoint_host_path": str(checkpoint_host_path)}
    try:
        compute_stage = ["compute-run", *compute_common]
        compute_env = {}
        if args.use_fake_codex:
            compute_env["CODEX_FAKE_RESPONSE"] = "1"
        if args.fault_at == "before-processor":
            compute_stage.extend(["--inject-fault", "before-processor"])
        if args.fault_at == "after-processor-before-checkpoint":
            compute_stage.extend(["--inject-fault", "after-processor-before-checkpoint"])
        if args.fault_at == "attempt-control-state-write":
            compute_stage.extend(["--inject-fault", "attempt-control-state-write"])
        events.append({"step": "compute-run", "result": run_compose(args, "phase5-compute", compute_stage, env=compute_env)})
    except Exception as error:  # noqa: BLE001
        if args.fault_at in ("after-processor-before-checkpoint", "attempt-control-state-write"):
            return {"ok": True, "stopped_at": args.fault_at, "compute_error": type(error).__name__, "events": events, "checkpoint_host_path": str(checkpoint_host_path)}
        if args.abort_on_compute_failure:
            failure = compute_failure_summary(error)
            events.append({"step": "control-abort", "result": run_compose(args, "phase5-control", ["control-abort", *control_common], token_host_file=token_host_file)})
            return {"ok": True, "aborted_after_compute_failure": True, "compute_error": type(error).__name__, "compute_failure": failure, "events": events, "checkpoint_host_path": str(checkpoint_host_path)}
        raise
    if args.fault_at == "after-compute":
        return {"ok": True, "stopped_at": "after-compute", "events": events, "checkpoint_host_path": str(checkpoint_host_path)}
    finalize_stage = ["control-finalize", *control_common]
    if args.fault_at == "after-cloud-finalize-before-local-complete":
        finalize_stage.extend(["--inject-fault", "after-cloud-finalize-before-local-complete"])
    try:
        events.append({"step": "control-finalize", "result": run_compose(args, "phase5-control", finalize_stage, token_host_file=token_host_file)})
    except Exception as error:  # noqa: BLE001
        if args.fault_at == "after-cloud-finalize-before-local-complete":
            return {"ok": True, "stopped_at": args.fault_at, "finalize_error": type(error).__name__, "events": events, "checkpoint_host_path": str(checkpoint_host_path)}
        raise
    events.append({"step": "status", "result": run_compose(args, "phase5-control", ["status", *control_common], token_host_file=token_host_file)})
    return {"ok": True, "events": events, "checkpoint_host_path": str(checkpoint_host_path), "result_host_path": str(result_host_path)}


def run_or_resume(args: argparse.Namespace) -> dict[str, Any]:
    token_file = Path(args.admin_token_host_file)
    if not token_file.exists():
        raise SystemExit("--admin-token-host-file does not exist")
    mode = stat.S_IMODE(token_file.stat().st_mode)
    if mode & 0o077:
        raise SystemExit("--admin-token-host-file must not allow group/other access")
    return run_exact_flow(args, worker_url=args.worker_url, token_host_file=token_file, resume_json=args.resume_artifacts_json)


def synthetic_case(args: argparse.Namespace) -> dict[str, Any]:
    if args.synthetic_case == "all":
        results = []
        for case in ("complete", "after-start", "after-compute", "after-processor-before-checkpoint", "after-cloud-finalize-before-local-complete", "duplicate", "short-authority", "compute-failure-abort", "tampered-checkpoint", "tampered-result", "compute-control-readonly"):
            suffix = f"{case.replace('-', '_')}_{secrets.token_hex(3)}"
            child = argparse.Namespace(**{
                **vars(args),
                "synthetic_case": case,
                "schema": f"reel_phase5c_staged_{int(time.time())}_{suffix}",
                "pilot_key": f"{args.pilot_key}-{suffix}",
                "job_id": f"{args.job_id}-{suffix}",
                "source_message_id": f"{args.source_message_id}-{suffix}",
                "checkpoint_host_path": "",
                "result_host_path": "",
            })
            results.append({"case": case, "result": synthetic_case(child)})
        return {"ok": all(row["result"].get("ok") for row in results), "cases": results}

    token = secrets.token_urlsafe(32)
    temp_root = Path(tempfile.mkdtemp(prefix="phase5-staged-e2e-"))
    chmod_private(temp_root, directory=True)
    token_file = temp_root / "phase5-admin-token"
    token_file.write_text(token, encoding="utf-8")
    chmod_private(token_file)
    checkpoint_host_path, checkpoint_container_path, result_host_path, result_container_path = handoff_paths(args)
    worker = FakeWorker(token, short_authority=args.synthetic_case == "short-authority")
    worker_host = args.synthetic_worker_host or docker_network_gateway(args)
    worker_url = worker.start(container_host=worker_host)
    try:
        init_args = control_args(args, checkpoint_container_path, result_container_path, worker_url)
        init = run_compose(args, "phase5-control", ["synthetic-init", *init_args], token_host_file=token_file)
        resume_json = resume_artifacts(worker_url, args.job_id)
        if args.synthetic_case == "short-authority":
            try:
                run_exact_flow(args, worker_url=worker_url, token_host_file=token_file, resume_json=resume_json)
            except Exception:
                return {"ok": True, "case": args.synthetic_case, "compute_calls": 0, "worker_requests": worker.requests, "checkpoint_host_path": str(checkpoint_host_path)}
            raise RuntimeError("short authority case unexpectedly reached compute")
        if args.synthetic_case == "compute-failure-abort":
            args.abort_on_compute_failure = True
            args.fault_at = "before-processor"
            result = run_exact_flow(args, worker_url=worker_url, token_host_file=token_file, resume_json=resume_json)
            return {"ok": result.get("aborted_after_compute_failure") and worker.aborted and not worker.finalized, "case": args.synthetic_case, "init": init, **result}
        if args.synthetic_case == "tampered-checkpoint":
            _ = run_compose(args, "phase5-control", ["control-start", *init_args], token_host_file=token_file)
            parsed = json.loads(checkpoint_host_path.read_text(encoding="utf-8"))
            parsed["stage"] = "complete"
            parsed["stage_index"] = 90
            checkpoint_host_path.write_text(json.dumps(parsed), encoding="utf-8")
            chmod_private(checkpoint_host_path)
            failed = False
            try:
                run_compose(args, "phase5-control", ["control-start", *init_args], token_host_file=token_file)
            except Exception:
                failed = True
            return {"ok": failed, "case": args.synthetic_case, "tamper_failed_closed": failed}
        if args.synthetic_case == "tampered-result":
            _ = run_compose(args, "phase5-control", ["control-start", *init_args], token_host_file=token_file)
            compute = ["compute-run", *compute_args(args, checkpoint_container_path, result_container_path, worker_url, resume_json), "--synthetic-processor"]
            _ = run_compose(args, "phase5-compute", compute, env={"CODEX_FAKE_RESPONSE": "1"})
            parsed = json.loads(result_host_path.read_text(encoding="utf-8"))
            parsed["control_state_sha256"] = "0" * 64
            result_host_path.write_text(json.dumps(parsed), encoding="utf-8")
            chmod_private(result_host_path)
            failed = False
            try:
                run_compose(args, "phase5-control", ["control-finalize", *init_args], token_host_file=token_file)
            except Exception:
                failed = True
            return {"ok": failed and not worker.finalized, "case": args.synthetic_case, "tamper_failed_closed": failed}
        if args.synthetic_case == "compute-control-readonly":
            _ = run_compose(args, "phase5-control", ["control-start", *init_args], token_host_file=token_file)
            failed = False
            try:
                run_compose(args, "phase5-compute", ["compute-run", *compute_args(args, checkpoint_container_path, result_container_path, worker_url, resume_json), "--inject-fault", "attempt-control-state-write"], env={"CODEX_FAKE_RESPONSE": "1"})
            except Exception:
                failed = True
            _ = run_compose(args, "phase5-control", ["status", *init_args], token_host_file=token_file)
            return {"ok": failed, "case": args.synthetic_case, "control_state_readonly": failed}
        args.synthetic_processor = args.synthetic_case in ("complete", "after-start", "after-compute", "duplicate")
        args.use_fake_codex = args.synthetic_case not in ("complete", "after-start", "after-compute", "duplicate")
        args.fault_at = {
            "after-start": "after-start",
            "after-compute": "after-compute",
            "after-processor-before-checkpoint": "after-processor-before-checkpoint",
            "after-cloud-finalize-before-local-complete": "after-cloud-finalize-before-local-complete",
        }.get(args.synthetic_case, "")
        result = run_exact_flow(args, worker_url=worker_url, token_host_file=token_file, resume_json=resume_json)
        if args.synthetic_case in ("after-start", "after-compute", "after-processor-before-checkpoint", "after-cloud-finalize-before-local-complete"):
            args.fault_at = ""
            resume = run_exact_flow(args, worker_url=worker_url, token_host_file=token_file, resume_json=resume_json)
            result = {"ok": resume.get("ok"), "interrupted": result, "resumed": resume}
        if args.synthetic_case == "duplicate":
            second = run_exact_flow(args, worker_url=worker_url, token_host_file=token_file, resume_json=resume_json)
            result = {"ok": result.get("ok") and second.get("ok"), "first": result, "second": second}
        return {"ok": bool(result.get("ok")), "case": args.synthetic_case, "init": init, "worker_requests": worker.requests, "worker_finalized": worker.finalized, **result}
    finally:
        worker.stop()
        try:
            run_compose(args, "phase5-control", ["synthetic-drop", *control_args(args, checkpoint_container_path, result_container_path, worker_url)], token_host_file=token_file)
        except Exception:
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Host-side Phase 5 split runtime orchestrator")
    parser.add_argument("--project-dir", type=Path, default=DEFAULT_PROJECT_DIR)
    parser.add_argument("--compose-file", default="compose.yaml")
    parser.add_argument("--runs-root", default=os.environ.get("REEL_RUNS_ROOT", "/srv/cartdotcom/reel-brain-runs"))
    parser.add_argument("--pilot-key", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--source-message-id", required=True)
    parser.add_argument("--attempt-key", default="")
    parser.add_argument("--lease-owner", default=DEFAULT_WORKER)
    parser.add_argument("--schema", default="reel_phase4_shadow_20260821_014246")
    parser.add_argument("--checkpoint-host-path", default="")
    parser.add_argument("--checkpoint-container-path", default="")
    parser.add_argument("--result-host-path", default="")
    parser.add_argument("--result-container-path", default="")
    parser.add_argument("--worker-url", default="https://cartdotcom-instagram-reel-brain.lucajeannin.workers.dev")
    parser.add_argument("--admin-token-host-file", default="")
    parser.add_argument("--codex-auth-path", default="/codex-auth/auth.json")
    parser.add_argument("--token-minutes", type=int, default=240)
    parser.add_argument("--min-callback-seconds", type=int, default=300)
    parser.add_argument("--timeout-seconds", type=int, default=900)
    parser.add_argument("--container-timeout", type=int, default=900)
    parser.add_argument("--synthetic-worker-host", default=os.environ.get("REEL_PHASE5_SYNTHETIC_WORKER_HOST", ""))
    parser.add_argument("--resume-artifacts-json", default="")
    parser.add_argument("--prefetch-container-path", default="")
    parser.add_argument("--synthetic-processor", action="store_true")
    parser.add_argument("--use-fake-codex", action="store_true")
    parser.add_argument("--fault-at", default="", choices=("", "after-start", "before-processor", "after-compute", "after-processor-before-checkpoint", "after-cloud-finalize-before-local-complete", "attempt-control-state-write"))
    parser.add_argument("--abort-on-compute-failure", action="store_true")
    parser.add_argument("--synthetic-case", default="", choices=("", "all", "complete", "after-start", "after-compute", "after-processor-before-checkpoint", "after-cloud-finalize-before-local-complete", "duplicate", "short-authority", "compute-failure-abort", "tampered-checkpoint", "tampered-result", "compute-control-readonly"))
    args = parser.parse_args()

    args.pilot_key = require_exact(args.pilot_key, "--pilot-key", 120)
    args.job_id = require_exact(args.job_id, "--job-id", 120)
    args.source_message_id = require_exact(args.source_message_id, "--source-message-id", 500)
    if args.attempt_key:
        args.attempt_key = require_exact(args.attempt_key, "--attempt-key", 80)
    args.lease_owner = require_exact(args.lease_owner, "--lease-owner", 120)
    if args.synthetic_case:
        if not args.schema.startswith("reel_phase5c_staged_"):
            args.schema = f"reel_phase5c_staged_{int(time.time())}_{secrets.token_hex(4)}"
        payload = synthetic_case(args)
    else:
        payload = run_or_resume(args)
    json_print(payload)
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
