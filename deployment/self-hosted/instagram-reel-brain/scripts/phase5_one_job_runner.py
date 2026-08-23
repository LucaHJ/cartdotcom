#!/usr/bin/env python3
"""
One-shot Phase 5 local runner for a single explicitly fenced job.

This is deliberately not a general worker:
- exact pilot_key/job_id/source_message_id/lease_owner are required;
- cloud state changes go through the authenticated Worker exact-job control
  surface, not direct Wrangler/D1 mutation;
- local PostgreSQL lease transitions use guarded CTEs that insert events only
  when exactly one lease row transitions;
- a local 0600 checkpoint stores the callback token needed for crash/restart
  recovery and is written under an ignored run directory by default;
- the production processor is invoked only after both the Worker and local lease
  are in exact local-processing state.

Secrets are read only from existing local files/environment and are never
printed, placed in URLs, or written to Git.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import secrets
import shutil
import stat
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SCRIPT_PATH = Path(__file__).resolve()
SCRIPT_PARENTS = SCRIPT_PATH.parents
DEFAULT_MONOREPO_ROOT = SCRIPT_PARENTS[4] if len(SCRIPT_PARENTS) > 4 else SCRIPT_PATH.parent
MONOREPO_ROOT = Path(os.environ.get("REEL_MONOREPO_ROOT", DEFAULT_MONOREPO_ROOT))
SELF_HOSTED_ROOT = SCRIPT_PARENTS[1] if len(SCRIPT_PARENTS) > 1 else SCRIPT_PATH.parent
DEFAULT_PROCESSOR_CANDIDATES = (
    MONOREPO_ROOT / "deployment" / "instagram-reel-brain" / "container" / "app.py",
    SELF_HOSTED_ROOT / "phase5-runner" / "container" / "app.py",
)
WORKER_BASE_URL = "https://cartdotcom-instagram-reel-brain.lucajeannin.workers.dev"
DEFAULT_SCHEMA = "reel_phase4_shadow_20260821_014246"
DEFAULT_WORKER = "phase5-local-worker-1"
SERVER_RUN_ROOT = Path("/srv/cartdotcom/reel-brain-runs")
DEFAULT_CHECKPOINT_ROOT = Path(os.environ.get(
    "REEL_PHASE5_RUN_ROOT",
    str(SERVER_RUN_ROOT / "phase5-runner" if SERVER_RUN_ROOT.exists() else SELF_HOSTED_ROOT / "runs" / "phase5-runner"),
))

CLOUD_START_CONFIRMATION = "START EXACT PHASE 5 LOCAL PILOT JOB"
CLOUD_FINALIZE_CONFIRMATION = "FINALIZE EXACT PHASE 5 LOCAL PILOT JOB"
CLOUD_ABORT_CONFIRMATION = "ABORT EXACT PHASE 5 LOCAL PILOT JOB"
LOCAL_ROLLBACK_CONFIRMATION_PREFIX = "ROLL BACK EXACT PHASE 5 RUNNER "


def require_exact(value: str | None, name: str, max_length: int = 500) -> str:
    text = (value or "").strip()
    if not text or len(text) > max_length:
        raise SystemExit(f"{name} is required")
    return text


def sql_literal(value: str | None) -> str:
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def safe_schema(schema: str) -> str:
    text = require_exact(schema, "--schema", 120)
    if not text.replace("_", "").isalnum() or text[0].isdigit():
        raise SystemExit("--schema must be a safe PostgreSQL identifier")
    return text


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True, default=str), encoding="utf-8")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def checkpoint_path(args: argparse.Namespace) -> Path:
    if args.checkpoint_path:
        return Path(args.checkpoint_path)
    safe_name = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in f"{args.pilot_key}_{args.job_id}")
    return DEFAULT_CHECKPOINT_ROOT / f"{safe_name}.json"


def load_checkpoint(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise SystemExit(f"checkpoint is not valid JSON: {path}: {error}") from error
    if not isinstance(parsed, dict):
        raise SystemExit(f"checkpoint is not a JSON object: {path}")
    return parsed


def write_checkpoint(args: argparse.Namespace, path: Path, checkpoint: dict[str, Any], stage: str, **updates: Any) -> dict[str, Any]:
    checkpoint = {
        **checkpoint,
        "pilot_key": args.pilot_key,
        "job_id": args.job_id,
        "source_message_id": args.source_message_id,
        "lease_owner": args.lease_owner,
        "stage": stage,
        "updated_at": now_iso(),
        **updates,
    }
    atomic_write_json(path, checkpoint)
    return checkpoint


def private_file_summary(path: Path) -> dict[str, Any]:
    info = path.stat()
    return {
        "path": str(path),
        "mode": oct(stat.S_IMODE(info.st_mode)),
        "uid": info.st_uid,
        "gid": info.st_gid,
        "bytes": info.st_size,
    }


def read_secret_file(path: str | None, *, label: str = "secret file", require_private: bool = False) -> str:
    if not path:
        return ""
    secret_path = Path(path)
    if not secret_path.exists():
        raise SystemExit(f"{label} does not exist: {secret_path}")
    if require_private:
        mode = stat.S_IMODE(secret_path.stat().st_mode)
        if mode & 0o077:
            raise SystemExit(f"{label} permissions must not allow group/other access: {secret_path}")
    text = secret_path.read_text(encoding="utf-8").strip()
    if not text:
        raise SystemExit(f"{label} is empty: {secret_path}")
    return text


def admin_token(args: argparse.Namespace, *, required: bool = True) -> str:
    token = read_secret_file(args.admin_token_file, label="Worker admin token file", require_private=True)
    if not token and args.allow_admin_token_env:
        token = os.environ.get(args.admin_token_env, "").strip()
    if required and not token:
        legacy_hint = f" or --allow-admin-token-env ${args.admin_token_env}" if args.allow_admin_token_env else ""
        raise SystemExit(f"Worker admin token is required via --admin-token-file{legacy_hint}")
    return token


def post_admin_json(
    worker_url: str,
    path: str,
    token: str,
    payload: dict[str, Any],
    *,
    timeout: int = 90,
    allowed_statuses: tuple[int, ...] = (),
) -> dict[str, Any]:
    url = worker_url.rstrip("/") + path
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "curl/8.5.0 cartdotcom-phase5-control/1.0",
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            response_body = response.read().decode("utf-8", errors="replace")
            parsed = json.loads(response_body or "{}")
            if not isinstance(parsed, dict):
                raise RuntimeError("Worker control response was not a JSON object")
            parsed["_http_status"] = response.status
            return parsed
    except HTTPError as error:
        response_body = error.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(response_body or "{}")
        except json.JSONDecodeError:
            parsed = {"error": response_body[:500]}
        if error.code in allowed_statuses and isinstance(parsed, dict):
            parsed["_http_status"] = error.code
            return parsed
        raise RuntimeError(f"Worker control {path} failed with HTTP {error.code}: {json.dumps(parsed, sort_keys=True)}") from error
    except URLError as error:
        raise RuntimeError(f"Worker control {path} failed: {error.reason}") from error


def pg_mode(args: argparse.Namespace) -> str:
    requested = getattr(args, "pg_mode", "auto")
    if requested not in ("auto", "native", "legacy-ssh"):
        raise SystemExit("--pg-mode must be auto, native, or legacy-ssh")
    if requested != "auto":
        return requested
    password_file = getattr(args, "pg_password_file", "")
    if password_file and Path(password_file).exists():
        return "native"
    return "legacy-ssh"


def native_pg_connection(args: argparse.Namespace):
    try:
        import psycopg  # type: ignore[import-not-found]
    except ImportError as error:
        raise SystemExit("native PostgreSQL mode requires psycopg; install the phase5 runner image dependencies") from error
    if not args.pg_password_file:
        raise SystemExit("native PostgreSQL mode requires --pg-password-file")
    password = read_secret_file(args.pg_password_file, label="PostgreSQL password file", require_private=True)
    return psycopg.connect(
        host=args.pg_host,
        port=args.pg_port,
        dbname=args.pg_database,
        user=args.pg_user,
        password=password,
        connect_timeout=args.pg_connect_timeout,
    )


def native_psql_json(args: argparse.Namespace, _schema: str, sql: str) -> list[dict[str, Any]]:
    try:
        with native_pg_connection(args) as connection:
            with connection.cursor() as cursor:
                cursor.execute(sql)
                rows = cursor.fetchall()
    except SystemExit:
        raise
    except Exception as error:  # noqa: BLE001
        raise RuntimeError(f"native PostgreSQL query failed: {type(error).__name__}") from error
    parsed: list[dict[str, Any]] = []
    for row in rows:
        value = row[0] if isinstance(row, (tuple, list)) else row
        if isinstance(value, dict):
            parsed.append(value)
        elif isinstance(value, str):
            parsed.append(json.loads(value))
        else:
            raise RuntimeError(f"native PostgreSQL query returned unsupported JSON value: {type(value).__name__}")
    return parsed


def legacy_ssh_psql_json(args: argparse.Namespace, schema: str, sql: str) -> list[dict[str, Any]]:
    if shutil.which("ssh") is None and args.ssh_target not in ("", "local", "localhost"):
        raise SystemExit("legacy PostgreSQL mode requires ssh; use --pg-mode native inside the Ubuntu runner")
    if args.ssh_target in ("", "local", "localhost") and shutil.which("docker") is None:
        raise SystemExit("legacy local PostgreSQL mode requires docker; use --pg-mode native inside the Ubuntu runner")
    if args.ssh_target in ("", "local", "localhost") and shutil.which("docker") is not None:
        pass
    command = "docker exec -i cartdotcom-platform-postgres-1 psql -U cartdotcom -d cartdotcom -v ON_ERROR_STOP=1 -q -t -A"
    run_args = command.split() if args.ssh_target in ("", "local", "localhost") else ["ssh", args.ssh_target, command]
    result = subprocess.run(
        run_args,
        input=sql,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "psql failed").strip()[-2000:])
    rows = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def psql_json(args: argparse.Namespace, schema: str, sql: str) -> list[dict[str, Any]]:
    safe_schema(schema)
    mode = pg_mode(args)
    if mode == "native":
        return native_psql_json(args, schema, sql)
    return legacy_ssh_psql_json(args, schema, sql)


def verify_local(args: argparse.Namespace) -> dict[str, Any]:
    schema = safe_schema(args.schema)
    sql = f"""
      SELECT json_build_object(
        'pilot_key', l.pilot_key,
        'job_id', l.exact_job_id,
        'source_message_id', l.source_message_id,
        'lease_owner', l.lease_owner,
        'lease_status', l.status,
        'lease_expires_at', l.lease_expires_at,
        'job_status', j.status,
        'source_url', j.source_url,
        'instructions', j.instructions,
        'source_media_json', j.source_media_json,
        'html_key', j.html_key,
        'library_path', j.library_path,
        'completed_at', j.completed_at,
        'publication_artifacts', (
          SELECT count(*) FROM {schema}.artifacts a
          WHERE a.job_id=l.exact_job_id AND (a.object_key LIKE 'library/%' OR a.object_key LIKE 'reels/%/index.html')
        ),
        'completion_events', (
          SELECT count(*) FROM {schema}.job_events e
          WHERE e.job_id=l.exact_job_id AND e.stage IN ('complete','published','phase5_local_complete')
        )
      )
      FROM {schema}.phase5_pilot_leases l
      JOIN {schema}.jobs j ON j.id=l.exact_job_id
      WHERE l.pilot_key={sql_literal(args.pilot_key)}
        AND l.exact_job_id={sql_literal(args.job_id)}
        AND l.source_message_id={sql_literal(args.source_message_id)}
        AND l.lease_owner={sql_literal(args.lease_owner)};
    """
    rows = psql_json(args, schema, sql)
    if len(rows) != 1:
        raise SystemExit("exact local lease/job row was not found")
    row = rows[0]
    if row["lease_status"] in ("completed", "rolled_back"):
        return row
    startable = (
        row["lease_status"] in ("leased", "processing")
        and row["job_status"] in ("queued", "running")
        and not row.get("completed_at")
        and not row.get("html_key")
        and not row.get("library_path")
        and int(row.get("publication_artifacts") or 0) == 0
        and int(row.get("completion_events") or 0) == 0
    )
    forward_recoverable = (
        row["lease_status"] in ("leased", "processing")
        and (
            row["job_status"] == "complete"
            or row.get("completed_at")
            or row.get("html_key")
            or row.get("library_path")
            or int(row.get("publication_artifacts") or 0) > 0
            or int(row.get("completion_events") or 0) > 0
        )
    )
    if not (startable or forward_recoverable):
        raise SystemExit(f"local lease/job is not startable or recoverable: {json.dumps(row, sort_keys=True, default=str)}")
    return row


def guarded_local_transition(args: argparse.Namespace, *, to_status: str, from_statuses: tuple[str, ...], stage: str, detail: dict[str, Any]) -> None:
    schema = safe_schema(args.schema)
    status_list = ",".join(sql_literal(status) for status in from_statuses)
    safe_detail = json.dumps(detail, separators=(",", ":"))
    extra_timestamp = {
        "completed": "completed_at=now(),",
        "rolled_back": "rollback_at=now(),",
        "processing": "lease_heartbeat_at=now(),",
    }.get(to_status, "")
    sql = f"""
      WITH updated AS (
        UPDATE {schema}.phase5_pilot_leases
        SET status={sql_literal(to_status)},
            {extra_timestamp}
            updated_at=now()
        WHERE pilot_key={sql_literal(args.pilot_key)}
          AND exact_job_id={sql_literal(args.job_id)}
          AND source_message_id={sql_literal(args.source_message_id)}
          AND lease_owner={sql_literal(args.lease_owner)}
          AND status IN ({status_list})
        RETURNING pilot_key, exact_job_id
      ), inserted AS (
        INSERT INTO {schema}.phase5_pilot_events(pilot_key,job_id,stage,status,detail)
        SELECT pilot_key, exact_job_id, {sql_literal(stage)}, {sql_literal(to_status)}, {sql_literal(safe_detail)}::jsonb
        FROM updated
        RETURNING 1
      )
      SELECT json_build_object(
        'updated', (SELECT count(*) FROM updated),
        'inserted', (SELECT count(*) FROM inserted)
      );
    """
    rows = psql_json(args, schema, sql)
    if len(rows) != 1 or rows[0].get("updated") != 1 or rows[0].get("inserted") != 1:
        raise SystemExit(f"local lease transition to {to_status} failed closed: {json.dumps(rows, sort_keys=True)}")


def mark_local_processing(args: argparse.Namespace) -> None:
    guarded_local_transition(
        args,
        to_status="processing",
        from_statuses=("leased", "processing"),
        stage="processing",
        detail={"lease_owner": args.lease_owner, "runner": "phase5_one_job_runner"},
    )


def complete_local_lease(args: argparse.Namespace, result: dict[str, Any]) -> None:
    guarded_local_transition(
        args,
        to_status="completed",
        from_statuses=("processing",),
        stage="completed",
        detail={
            "resources": result.get("resources"),
            "frames": result.get("frames"),
            "carousel_items": result.get("carousel_items"),
            "shortcode": result.get("shortcode"),
        },
    )


def rollback_local_lease(args: argparse.Namespace, reason: str) -> None:
    guarded_local_transition(
        args,
        to_status="rolled_back",
        from_statuses=("leased", "processing"),
        stage="rolled_back",
        detail={"reason": reason, "runner": "phase5_one_job_runner"},
    )


def cloud_start(args: argparse.Namespace, token: str, checkpoint: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "pilot_key": args.pilot_key,
        "job_id": args.job_id,
        "source_message_id": args.source_message_id,
        "lease_owner": args.lease_owner,
        "idempotency_key": checkpoint["idempotency_key"],
        "token_minutes": args.token_minutes,
        "confirm_start": CLOUD_START_CONFIRMATION,
        "reason": "phase5b_exact_runner_start",
    }
    if checkpoint.get("callback_token_hash"):
        payload["callback_token_hash"] = checkpoint["callback_token_hash"]
    return post_admin_json(
        args.worker_url,
        "/api/admin/phase5/local-pilot/start",
        token,
        payload,
        allowed_statuses=(400, 409),
    )


def cloud_finalize(args: argparse.Namespace, token: str, checkpoint: dict[str, Any]) -> dict[str, Any]:
    return post_admin_json(
        args.worker_url,
        "/api/admin/phase5/local-pilot/finalize",
        token,
        {
            "pilot_key": args.pilot_key,
            "job_id": args.job_id,
            "source_message_id": args.source_message_id,
            "lease_owner": args.lease_owner,
            "idempotency_key": checkpoint["idempotency_key"],
            "confirm_finalize": CLOUD_FINALIZE_CONFIRMATION,
            "reason": "phase5b_exact_runner_finalize",
        },
    )


def cloud_abort(args: argparse.Namespace, token: str, checkpoint: dict[str, Any], reason: str) -> dict[str, Any]:
    return post_admin_json(
        args.worker_url,
        "/api/admin/phase5/local-pilot/abort",
        token,
        {
            "pilot_key": args.pilot_key,
            "job_id": args.job_id,
            "source_message_id": args.source_message_id,
            "lease_owner": args.lease_owner,
            "idempotency_key": checkpoint.get("idempotency_key") or f"rollback-{args.job_id}",
            "confirm_abort": CLOUD_ABORT_CONFIRMATION,
            "reason": reason,
        },
    )


def ensure_callback_token(args: argparse.Namespace, path: Path, checkpoint: dict[str, Any]) -> dict[str, Any]:
    if checkpoint.get("callback_token") and checkpoint.get("callback_token_hash") and checkpoint.get("idempotency_key"):
        return checkpoint
    callback_token = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(callback_token.encode("utf-8")).hexdigest()
    idempotency_key = f"{args.pilot_key}:{args.job_id}:runner-1"
    token_expires_at = (datetime.now(timezone.utc) + timedelta(minutes=max(5, min(args.token_minutes, 360)))).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return write_checkpoint(
        args,
        path,
        checkpoint,
        "callback_token_minted",
        callback_token=callback_token,
        callback_token_hash=token_hash,
        callback_token_expires_at=token_expires_at,
        idempotency_key=idempotency_key,
    )


def ensure_idempotency_key(args: argparse.Namespace, path: Path, checkpoint: dict[str, Any]) -> dict[str, Any]:
    if checkpoint.get("idempotency_key"):
        return checkpoint
    return write_checkpoint(
        args,
        path,
        checkpoint,
        "idempotency_key_minted",
        idempotency_key=f"{args.pilot_key}:{args.job_id}:runner-1",
    )


def load_processor_module():
    if os.environ.get("REEL_PHASE5_ROLE") == "control":
        raise SystemExit("phase5-control role cannot load the media/Codex processor")
    configured = os.environ.get("REEL_PHASE5_PROCESSOR_PATH", "").strip()
    candidates = (Path(configured),) if configured else DEFAULT_PROCESSOR_CANDIDATES
    processor_path = next((candidate for candidate in candidates if candidate.exists()), None)
    if not processor_path:
        raise SystemExit("production processor not found; set REEL_PHASE5_PROCESSOR_PATH or copy the cloud processor into phase5-runner/container/app.py")
    spec = importlib.util.spec_from_file_location("phase5_cloud_processor", processor_path)
    if not spec or not spec.loader:
        raise SystemExit("could not load production processor module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_codex_auth(path: Path) -> str:
    if not path.exists():
        raise SystemExit(f"Codex auth file not found at {path}")
    text = path.read_text(encoding="utf-8").strip()
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise SystemExit("Codex auth file is not a JSON object")
    return text


def sanitize_result(result: Any) -> dict[str, Any]:
    if not isinstance(result, dict):
        return {"result_type": type(result).__name__}
    return {
        "ok": result.get("ok"),
        "shortcode": result.get("shortcode"),
        "resources": result.get("resources"),
        "frames": result.get("frames"),
        "carousel_items": result.get("carousel_items"),
        "tokens": result.get("tokens") or result.get("token_accounting"),
    }


def run_rollback(args: argparse.Namespace) -> int:
    expected = f"{LOCAL_ROLLBACK_CONFIRMATION_PREFIX}{args.job_id}"
    if args.confirm_rollback != expected:
        raise SystemExit(f"--confirm-rollback must equal {expected}")
    path = checkpoint_path(args)
    checkpoint = load_checkpoint(path)
    if not checkpoint.get("idempotency_key"):
        checkpoint = write_checkpoint(args, path, checkpoint, "rollback_requested", idempotency_key=f"{args.pilot_key}:{args.job_id}:rollback-1")
    token = admin_token(args, required=True)
    response = cloud_abort(args, token, checkpoint, args.rollback_reason)
    local = verify_local(args)
    if local.get("lease_status") != "rolled_back":
        rollback_local_lease(args, args.rollback_reason)
    write_checkpoint(args, path, checkpoint, "rolled_back", cloud_abort=response)
    print(json.dumps({"ok": True, "rolled_back": True, "job_id": args.job_id, "pilot_key": args.pilot_key, "checkpoint": str(path)}, indent=2, sort_keys=True))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run exactly one Phase 5 local pilot job")
    parser.add_argument("--pilot-key", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--source-message-id", required=True)
    parser.add_argument("--lease-owner", default=DEFAULT_WORKER)
    parser.add_argument("--schema", default=DEFAULT_SCHEMA)
    parser.add_argument("--pg-mode", default=os.environ.get("REEL_PHASE5_PG_MODE", "auto"), choices=("auto", "native", "legacy-ssh"))
    parser.add_argument("--pg-host", default=os.environ.get("REEL_PHASE5_PGHOST", "cartdotcom-platform-postgres-1"))
    parser.add_argument("--pg-port", type=int, default=int(os.environ.get("REEL_PHASE5_PGPORT", "5432")))
    parser.add_argument("--pg-database", default=os.environ.get("REEL_PHASE5_PGDATABASE", "cartdotcom"))
    parser.add_argument("--pg-user", default=os.environ.get("REEL_PHASE5_PGUSER", "cartdotcom"))
    parser.add_argument("--pg-password-file", default=os.environ.get("REEL_PHASE5_PG_PASSWORD_FILE", ""))
    parser.add_argument("--pg-connect-timeout", type=int, default=int(os.environ.get("REEL_PHASE5_PG_CONNECT_TIMEOUT", "10")))
    parser.add_argument("--ssh-target", default=os.environ.get("REEL_PHASE2_PG_SSH_TARGET", "cartdotcom-server"), help="Legacy workstation mode only; not used by --pg-mode native")
    parser.add_argument("--worker-url", default=WORKER_BASE_URL)
    parser.add_argument("--admin-token-file", default=os.environ.get("REEL_PHASE5_ADMIN_TOKEN_FILE", ""))
    parser.add_argument("--admin-token-env", default="REEL_BRAIN_ADMIN_TOKEN")
    parser.add_argument("--allow-admin-token-env", action="store_true", help="legacy workstation mode only; Ubuntu runner should use --admin-token-file")
    parser.add_argument("--codex-auth-path", default=str(Path.home() / ".codex" / "auth.json"))
    parser.add_argument("--checkpoint-path", default="")
    parser.add_argument("--timeout-seconds", type=int, default=900)
    parser.add_argument("--token-minutes", type=int, default=240)
    parser.add_argument("--dry-run", action="store_true", help="verify local exact state without starting the job")
    parser.add_argument("--skip-cloud-control", action="store_true", help="dry-run only: do not require Worker admin credentials")
    parser.add_argument("--rollback-only", action="store_true", help="abort exact cloud/local pilot before publication and return job to cloud")
    parser.add_argument("--rollback-reason", default="phase5b_exact_runner_prepublication_rollback")
    parser.add_argument("--confirm-rollback", default="")
    parser.add_argument("--confirm-live-run", default="")
    args = parser.parse_args()

    args.pilot_key = require_exact(args.pilot_key, "--pilot-key", 120)
    args.job_id = require_exact(args.job_id, "--job-id", 120)
    args.source_message_id = require_exact(args.source_message_id, "--source-message-id")
    args.lease_owner = require_exact(args.lease_owner, "--lease-owner", 120)
    args.schema = safe_schema(args.schema)

    if args.skip_cloud_control and not args.dry_run:
        raise SystemExit("--skip-cloud-control is allowed only with --dry-run")
    if args.rollback_only:
        return run_rollback(args)

    local = verify_local(args)
    path = checkpoint_path(args)
    checkpoint = load_checkpoint(path)
    safe_summary = {
        "ok": True,
        "dry_run": bool(args.dry_run),
        "cloud_control": "skipped" if args.skip_cloud_control else "required_for_live_run",
        "job_id": args.job_id,
        "pilot_key": args.pilot_key,
        "checkpoint": str(path),
        "local": {key: local.get(key) for key in ("lease_status", "lease_owner", "lease_expires_at", "job_status")},
    }
    if args.dry_run:
        print(json.dumps(safe_summary, indent=2, sort_keys=True, default=str))
        return 0
    if local.get("lease_status") == "completed":
        write_checkpoint(args, path, checkpoint, "complete")
        print(json.dumps({"ok": True, "idempotent": True, "stage": "complete", "job_id": args.job_id, "pilot_key": args.pilot_key, "checkpoint": str(path)}, indent=2, sort_keys=True))
        return 0
    if local.get("lease_status") == "rolled_back":
        raise SystemExit("local lease is rolled_back; exact runner will not restart it")
    if checkpoint.get("stage") == "complete":
        print(json.dumps({"ok": True, "idempotent": True, "stage": "complete", "job_id": args.job_id, "pilot_key": args.pilot_key}, indent=2, sort_keys=True))
        return 0

    expected_confirmation = f"RUN EXACT PHASE 5 LOCAL PILOT {args.job_id}"
    if args.confirm_live_run != expected_confirmation:
        raise SystemExit(f"--confirm-live-run must equal {expected_confirmation}")

    token = admin_token(args, required=True)
    checkpoint = ensure_idempotency_key(args, path, checkpoint)
    start_response = cloud_start(args, token, checkpoint)
    if not start_response.get("ok") and (
        start_response.get("requires_callback_token")
        or start_response.get("recovery_status") == "callback_hash_required"
        or start_response.get("retryable_start")
    ):
        checkpoint = ensure_callback_token(args, path, checkpoint)
        start_response = cloud_start(args, token, checkpoint)
    if not start_response.get("ok"):
        raise RuntimeError(f"Worker start reconciliation failed: {json.dumps({k: v for k, v in start_response.items() if k != '_http_status'}, sort_keys=True)}")
    checkpoint = write_checkpoint(
        args,
        path,
        checkpoint,
        "cloud_started",
        cloud_start={
            "ok": bool(start_response.get("ok")),
            "started": bool(start_response.get("started")),
            "idempotent": bool(start_response.get("idempotent")),
            "processor_already_complete": bool(start_response.get("processor_already_complete")),
            "recovery_status": start_response.get("recovery_status"),
            "token_expires_at": start_response.get("token_expires_at"),
        },
    )

    if local.get("lease_status") != "processing":
        mark_local_processing(args)
    checkpoint = write_checkpoint(args, path, checkpoint, "local_processing")

    if start_response.get("processor_already_complete") and not checkpoint.get("processor_complete"):
        result_summary = {
            "ok": True,
            "recovered_after_cloud_completion": True,
            "recovery_status": start_response.get("recovery_status"),
            "shortcode": None,
            "resources": None,
            "frames": None,
            "carousel_items": None,
        }
        checkpoint = write_checkpoint(args, path, checkpoint, "processor_complete", processor_complete=True, processor_result=result_summary)
    elif checkpoint.get("processor_complete"):
        result_summary = checkpoint.get("processor_result") or {}
    else:
        processor = load_processor_module()
        checkpoint = write_checkpoint(args, path, checkpoint, "processor_loaded")
        payload = {
            "job_id": args.job_id,
            "source_url": local.get("source_url") or "",
            "callback_base_url": args.worker_url,
            "callback_token": checkpoint["callback_token"],
            "instructions": local.get("instructions") or "",
            "codex_auth_json": load_codex_auth(Path(args.codex_auth_path)),
            "instagram_cookies_json": "",
            "instagram_media_json": local.get("source_media_json") or "",
            "timeout_seconds": args.timeout_seconds,
        }
        checkpoint = write_checkpoint(args, path, checkpoint, "processor_started")
        result = processor.process(payload)
        result_summary = sanitize_result(result)
        checkpoint = write_checkpoint(args, path, checkpoint, "processor_complete", processor_complete=True, processor_result=result_summary)

    finalize_response = cloud_finalize(args, token, checkpoint)
    checkpoint = write_checkpoint(
        args,
        path,
        checkpoint,
        "cloud_finalized",
        cloud_finalize={"ok": bool(finalize_response.get("ok")), "finalized": bool(finalize_response.get("finalized")), "idempotent": bool(finalize_response.get("idempotent"))},
    )
    complete_local_lease(args, result_summary if isinstance(result_summary, dict) else {})
    write_checkpoint(args, path, checkpoint, "complete")
    print(json.dumps({"ok": True, "job_id": args.job_id, "pilot_key": args.pilot_key, "checkpoint": str(path), "result": result_summary}, indent=2, sort_keys=True, default=str))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit("interrupted")
