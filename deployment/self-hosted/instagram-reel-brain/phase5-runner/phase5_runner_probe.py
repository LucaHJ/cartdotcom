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
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from typing import Any


PROCESSOR_PATH = Path(os.environ.get("REEL_PHASE5_PROCESSOR_PATH", "/opt/reel/processor/app.py"))
RUNNER_PATH = Path(os.environ.get("REEL_PHASE5_RUNNER_PATH", "/opt/reel/phase5_one_job_runner.py"))
CODEX_AUTH_DIR = Path(os.environ.get("CODEX_HOME", "/codex-auth"))
CODEX_AUTH_SOURCE = os.environ.get("CODEX_AUTH_SOURCE")
WORK_ROOT = Path(os.environ.get("REEL_PHASE5_PROBE_WORK_ROOT", "/work"))
MIN_SECRET_BYTES = 256
DEFAULT_LEASE_OWNER = "phase5-local-worker-1"


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
    psycopg_version = checked_output(["python3", "-c", "import psycopg; print(psycopg.__version__)"])
    versions: dict[str, Any] = {
        "python": checked_output(["python3", "--version"]),
        "node": checked_output(["node", "--version"]),
        "npm": checked_output(["npm", "--version"]),
        "ffmpeg": checked_output(["ffmpeg", "-version"]).splitlines()[0],
        "ffprobe": checked_output(["ffprobe", "-version"]).splitlines()[0],
        "yt_dlp": checked_output(["yt-dlp", "--version"]),
        "gallery_dl": checked_output(["gallery-dl", "--version"]),
        "psycopg": psycopg_version,
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


def load_runner():
    if not RUNNER_PATH.exists():
        raise RuntimeError(f"runner missing: {RUNNER_PATH}")
    spec = importlib.util.spec_from_file_location("phase5_one_job_runner", RUNNER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("runner import failed")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def pg_secret_status() -> dict[str, Any]:
    path = Path(os.environ.get("REEL_PHASE5_PG_PASSWORD_FILE", ""))
    if not str(path):
        return {"present": False, "configured": False}
    if not path.exists():
        return {"present": False, "configured": True, "path": str(path)}
    info = path.stat()
    return {
        "present": True,
        "configured": True,
        "path": str(path),
        "mode": oct(stat.S_IMODE(info.st_mode)),
        "uid": info.st_uid,
        "gid": info.st_gid,
        "bytes": info.st_size,
        "readable": os.access(path, os.R_OK),
    }


def runner_namespace(schema: str, job_id: str, source_message_id: str = "fixture-message", pilot_key: str = "fixture-pilot") -> SimpleNamespace:
    return SimpleNamespace(
        pilot_key=pilot_key,
        job_id=job_id,
        source_message_id=source_message_id,
        lease_owner=DEFAULT_LEASE_OWNER,
        schema=schema,
        pg_mode=os.environ.get("REEL_PHASE5_PG_MODE", "native"),
        pg_host=os.environ.get("REEL_PHASE5_PGHOST", "cartdotcom-platform-postgres-1"),
        pg_port=int(os.environ.get("REEL_PHASE5_PGPORT", "5432")),
        pg_database=os.environ.get("REEL_PHASE5_PGDATABASE", "cartdotcom"),
        pg_user=os.environ.get("REEL_PHASE5_PGUSER", "cartdotcom"),
        pg_password_file=os.environ.get("REEL_PHASE5_PG_PASSWORD_FILE", ""),
        pg_connect_timeout=int(os.environ.get("REEL_PHASE5_PG_CONNECT_TIMEOUT", "10")),
        ssh_target="",
        admin_token_file="",
        admin_token_env="REEL_BRAIN_ADMIN_TOKEN",
        allow_admin_token_env=False,
        worker_url="http://127.0.0.1",
        token_minutes=15,
    )


def execute_native_sql(runner: Any, args: SimpleNamespace, sql: str, values: tuple[Any, ...] = ()) -> None:
    with runner.native_pg_connection(args) as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, values)


def create_synthetic_phase5_schema(runner: Any, schema: str) -> SimpleNamespace:
    args = runner_namespace(schema, "fixture-job")
    safe = runner.safe_schema(schema)
    ddl = f"""
      DROP SCHEMA IF EXISTS {safe} CASCADE;
      CREATE SCHEMA {safe};
      CREATE TABLE {safe}.jobs (
        id text PRIMARY KEY,
        status text NOT NULL,
        source_url text,
        instructions text,
        source_media_json jsonb,
        html_key text,
        library_path text,
        completed_at timestamptz
      );
      CREATE TABLE {safe}.artifacts (
        id bigserial PRIMARY KEY,
        job_id text NOT NULL,
        object_key text NOT NULL
      );
      CREATE TABLE {safe}.job_events (
        id bigserial PRIMARY KEY,
        job_id text NOT NULL,
        stage text NOT NULL
      );
      CREATE TABLE {safe}.phase5_pilot_leases (
        pilot_key text PRIMARY KEY,
        exact_job_id text NOT NULL,
        source_message_id text NOT NULL,
        lease_owner text NOT NULL,
        status text NOT NULL,
        lease_expires_at timestamptz,
        lease_heartbeat_at timestamptz,
        completed_at timestamptz,
        rollback_at timestamptz,
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE {safe}.phase5_pilot_events (
        id bigserial PRIMARY KEY,
        pilot_key text NOT NULL,
        job_id text NOT NULL,
        stage text NOT NULL,
        status text NOT NULL,
        detail jsonb,
        created_at timestamptz DEFAULT now()
      );
    """
    execute_native_sql(runner, args, ddl)
    insert_synthetic_lease(runner, args)
    rollback_args = runner_namespace(schema, "rollback-job", "rollback-message", "rollback-pilot")
    insert_synthetic_lease(runner, rollback_args)
    return args


def insert_synthetic_lease(runner: Any, args: SimpleNamespace) -> None:
    safe = runner.safe_schema(args.schema)
    execute_native_sql(
        runner,
        args,
        f"""
      INSERT INTO {safe}.jobs(id,status,source_url,instructions,source_media_json)
      VALUES (%s,'queued','file:///synthetic.mp4','synthetic exact runner test','{{"fixture": true}}'::jsonb);
        """,
        (args.job_id,),
    )
    execute_native_sql(
        runner,
        args,
        f"""
      INSERT INTO {safe}.phase5_pilot_leases(
        pilot_key, exact_job_id, source_message_id, lease_owner, status, lease_expires_at
      )
      VALUES (%s,%s,%s,%s,'leased',now() + interval '30 minutes');
        """,
        (args.pilot_key, args.job_id, args.source_message_id, args.lease_owner),
    )


def drop_synthetic_schema(runner: Any, args: SimpleNamespace) -> None:
    safe = runner.safe_schema(args.schema)
    execute_native_sql(runner, args, f"DROP SCHEMA IF EXISTS {safe} CASCADE;")


def runner_base_command(schema: str, job_id: str, source_message_id: str, pilot_key: str, checkpoint: Path) -> list[str]:
    return [
        "python3", str(RUNNER_PATH),
        "--pg-mode", "native",
        "--pg-host", os.environ.get("REEL_PHASE5_PGHOST", "cartdotcom-platform-postgres-1"),
        "--pg-port", os.environ.get("REEL_PHASE5_PGPORT", "5432"),
        "--pg-database", os.environ.get("REEL_PHASE5_PGDATABASE", "cartdotcom"),
        "--pg-user", os.environ.get("REEL_PHASE5_PGUSER", "cartdotcom"),
        "--pg-password-file", os.environ.get("REEL_PHASE5_PG_PASSWORD_FILE", ""),
        "--schema", schema,
        "--pilot-key", pilot_key,
        "--job-id", job_id,
        "--source-message-id", source_message_id,
        "--lease-owner", DEFAULT_LEASE_OWNER,
        "--checkpoint-path", str(checkpoint),
    ]


def native_control_probe() -> dict[str, Any]:
    runner = load_runner()
    schema = f"reel_phase5c_runtime_probe_{os.getpid()}_{int(time.time())}"
    checkpoint = WORK_ROOT / f"{schema}.json"
    args = create_synthetic_phase5_schema(runner, schema)
    try:
        dry = run(runner_base_command(schema, "fixture-job", "fixture-message", "fixture-pilot", checkpoint) + ["--dry-run", "--skip-cloud-control"], timeout=60)
        if dry.returncode != 0:
            raise RuntimeError(f"dry run failed: {redacted_failure(dry)}")
        dry_payload = json.loads(dry.stdout)
        runner.mark_local_processing(args)
        after_processing = runner.verify_local(args)
        restart = run(runner_base_command(schema, "fixture-job", "fixture-message", "fixture-pilot", checkpoint) + ["--dry-run", "--skip-cloud-control"], timeout=60)
        if restart.returncode != 0:
            raise RuntimeError(f"restart dry run failed: {redacted_failure(restart)}")
        restart_payload = json.loads(restart.stdout)
        rollback_args = runner_namespace(schema, "rollback-job", "rollback-message", "rollback-pilot")
        runner.rollback_local_lease(rollback_args, "synthetic native control rollback")
        rolled_back = runner.verify_local(rollback_args)
        return {
            "ok": True,
            "schema": schema,
            "schema_isolated": schema.startswith("reel_phase5c_runtime_probe_"),
            "dry_run_status": dry_payload.get("local", {}),
            "processing_status": {key: after_processing.get(key) for key in ("lease_status", "job_status")},
            "restart_status": restart_payload.get("local", {}),
            "rollback_status": rolled_back.get("lease_status"),
            "pg_secret": pg_secret_status(),
            "dropped": True,
        }
    finally:
        drop_synthetic_schema(runner, args)


def fake_worker_control_probe() -> dict[str, Any]:
    runner = load_runner()
    work = Path(tempfile.mkdtemp(prefix="phase5-fake-worker-", dir=str(WORK_ROOT if WORK_ROOT.exists() else Path("/tmp"))))
    token_file = work / "phase5-admin-token"
    token_file.write_text("synthetic-phase5-admin-token", encoding="utf-8")
    os.chmod(token_file, 0o600)
    expected = token_file.read_text(encoding="utf-8").strip()
    requests_seen: list[str] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802
            _body = self.rfile.read(int(self.headers.get("Content-Length", "0") or "0"))
            if self.headers.get("Authorization") != f"Bearer {expected}":
                self.send_response(401)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"ok":false,"error":"unauthorized"}')
                return
            requests_seen.append(self.path)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            if self.path.endswith("/start"):
                self.wfile.write(b'{"ok":true,"started":true,"token_expires_at":"2099-01-01T00:00:00.000Z"}')
            elif self.path.endswith("/finalize"):
                self.wfile.write(b'{"ok":true,"finalized":true}')
            else:
                self.wfile.write(b'{"ok":true,"aborted":true}')

        def log_message(self, _format: str, *_args: Any) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        args = runner_namespace("synthetic_schema", "fixture-job")
        args.worker_url = f"http://127.0.0.1:{server.server_port}"
        args.admin_token_file = str(token_file)
        token = runner.admin_token(args)
        checkpoint = {"idempotency_key": "fixture-idempotency", "callback_token_hash": "0" * 64}
        start = runner.cloud_start(args, token, checkpoint)
        finalize = runner.cloud_finalize(args, token, checkpoint)
        abort = runner.cloud_abort(args, token, checkpoint, "synthetic abort")
        missing_args = runner_namespace("synthetic_schema", "fixture-job")
        missing_args.admin_token_file = str(work / "missing-token")
        missing_failed = False
        try:
            runner.admin_token(missing_args)
        except SystemExit:
            missing_failed = True
        return {
            "ok": bool(start.get("ok") and finalize.get("ok") and abort.get("ok") and missing_failed),
            "requests_seen": sorted(requests_seen),
            "token_file_mode": oct(stat.S_IMODE(token_file.stat().st_mode)),
            "missing_token_failed_closed": missing_failed,
        }
    finally:
        server.shutdown()
        thread.join(timeout=5)


def control_fail_closed_probe() -> dict[str, Any]:
    runner = load_runner()
    schema = f"reel_phase5c_fail_closed_{os.getpid()}_{int(time.time())}"
    args = create_synthetic_phase5_schema(runner, schema)
    work = Path(tempfile.mkdtemp(prefix="phase5-control-fail-", dir=str(WORK_ROOT if WORK_ROOT.exists() else Path("/tmp"))))
    checkpoint = work / "checkpoint.json"
    missing_pg = run(
        runner_base_command(schema, "fixture-job", "fixture-message", "fixture-pilot", checkpoint)
        + ["--pg-password-file", str(work / "missing-pg"), "--dry-run", "--skip-cloud-control"],
        timeout=60,
    )
    token_file = work / "bad-token"
    token_file.write_text("incorrect-synthetic-token", encoding="utf-8")
    os.chmod(token_file, 0o600)

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802
            _body = self.rfile.read(int(self.headers.get("Content-Length", "0") or "0"))
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":false,"error":"unauthorized"}')

        def log_message(self, _format: str, *_args: Any) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        live_failure = run(
            runner_base_command(schema, "fixture-job", "fixture-message", "fixture-pilot", checkpoint)
            + [
                "--worker-url", f"http://127.0.0.1:{server.server_port}",
                "--admin-token-file", str(token_file),
                "--confirm-live-run", "RUN EXACT PHASE 5 LOCAL PILOT fixture-job",
            ],
            timeout=60,
        )
        checkpoint_stage = None
        if checkpoint.exists():
            parsed = json.loads(checkpoint.read_text(encoding="utf-8"))
            checkpoint_stage = parsed.get("stage")
        return {
            "ok": missing_pg.returncode != 0 and live_failure.returncode != 0 and checkpoint_stage != "processor_loaded",
            "missing_pg_failed_closed": missing_pg.returncode != 0,
            "bad_worker_token_failed_closed": live_failure.returncode != 0,
            "checkpoint_stage": checkpoint_stage,
            "processor_loaded": checkpoint_stage == "processor_loaded",
        }
    finally:
        server.shutdown()
        thread.join(timeout=5)
        drop_synthetic_schema(runner, args)


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
    sub.add_parser("native-control")
    sub.add_parser("fake-worker-control")
    sub.add_parser("control-fail-closed")
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
        elif args.command == "native-control":
            payload = native_control_probe()
        elif args.command == "fake-worker-control":
            payload = fake_worker_control_probe()
        elif args.command == "control-fail-closed":
            payload = control_fail_closed_probe()
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
