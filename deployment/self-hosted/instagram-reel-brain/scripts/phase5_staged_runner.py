#!/usr/bin/env python3
"""Staged Phase 5 exact-job runner commands for split control/compute containers.

This module is intentionally container-native and no-live by default. It is
called by the host-side one-shot orchestrator so control-plane secrets stay in
`phase5-control` and untrusted media/Codex work stays in `phase5-compute`.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import importlib.util
import json
import os
import secrets
import stat
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SCRIPT_PATH = Path(__file__).resolve()
LEGACY_RUNNER_PATH = SCRIPT_PATH.with_name("phase5_one_job_runner.py")
CHECKPOINT_VERSION = 2
COMPUTE_RESULT_VERSION = 1
DEFAULT_WORKER = "phase5-local-worker-1"
DEFAULT_SCHEMA = "reel_phase4_shadow_20260821_014246"
DEFAULT_CHECKPOINT_ROOT = Path(os.environ.get("REEL_PHASE5_CONTROL_ROOT", "/runs/control"))
DEFAULT_RESULT_ROOT = Path(os.environ.get("REEL_PHASE5_COMPUTE_ROOT", "/runs/compute"))
DEFAULT_PROCESSOR_PATH = Path(os.environ.get("REEL_PHASE5_PROCESSOR_PATH", "/opt/reel/processor/app.py"))
CONTROL_CONFIRMATION = "RUN EXACT PHASE 5 LOCAL PILOT"

STAGE_ORDER = {
    "new": 0,
    "checkpoint_created": 10,
    "callback_token_minted": 20,
    "cloud_started": 30,
    "local_processing": 40,
    "ready_for_compute": 50,
    "abort_required": 55,
    "compute_started": 60,
    "processor_complete": 70,
    "cloud_finalized": 80,
    "complete": 90,
    "rolled_back": 100,
}

RESULT_ALLOWED_KEYS = {
    "ok",
    "job_id",
    "shortcode",
    "frames",
    "carousel_items",
    "resources",
    "duplicate",
    "existing_job_id",
    "stopped_before_codex",
    "resumed_research",
    "archive_only",
    "recovered_after_cloud_completion",
    "recovery_status",
    "tokens",
    "timings",
}


def load_legacy():
    spec = importlib.util.spec_from_file_location("phase5_one_job_runner", LEGACY_RUNNER_PATH)
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not load legacy runner module at {LEGACY_RUNNER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


legacy = load_legacy()


def json_print(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, indent=2, sort_keys=True, default=str))


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now_utc().isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def require_exact(value: str | None, name: str, max_length: int = 500) -> str:
    return legacy.require_exact(value, name, max_length)


def safe_schema(schema: str) -> str:
    return legacy.safe_schema(schema)


def ensure_private_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)
    except OSError:
        pass


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    ensure_private_parent(path)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{secrets.token_hex(4)}.tmp")
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
    return DEFAULT_CHECKPOINT_ROOT / safe_name / "checkpoint.json"


def result_path(args: argparse.Namespace) -> Path:
    if args.result_path:
        return Path(args.result_path)
    safe_name = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in f"{args.pilot_key}_{args.job_id}")
    return DEFAULT_RESULT_ROOT / safe_name / "result.json"


def exact_binding(args: argparse.Namespace) -> dict[str, str]:
    return {
        "pilot_key": args.pilot_key,
        "job_id": args.job_id,
        "source_message_id": args.source_message_id,
        "lease_owner": args.lease_owner,
    }


def canonical_json(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def unsigned_checkpoint(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if key not in {"signature", "signature_alg"}}


def control_signing_key(args: argparse.Namespace) -> bytes:
    token = legacy.admin_token(args, required=True)
    return hmac.new(token.encode("utf-8"), b"cartdotcom-phase5-control-state-v1", hashlib.sha256).digest()


def sign_checkpoint(args: argparse.Namespace, payload: dict[str, Any]) -> dict[str, Any]:
    unsigned = unsigned_checkpoint(payload)
    signature = hmac.new(control_signing_key(args), canonical_json(unsigned), hashlib.sha256).hexdigest()
    return {**unsigned, "signature_alg": "hmac-sha256-v1", "signature": signature}


def verify_checkpoint_signature(args: argparse.Namespace, payload: dict[str, Any]) -> None:
    if payload.get("signature_alg") != "hmac-sha256-v1" or not isinstance(payload.get("signature"), str):
        raise SystemExit("control checkpoint signature is missing")
    expected = hmac.new(control_signing_key(args), canonical_json(unsigned_checkpoint(payload)), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(str(payload["signature"]), expected):
        raise SystemExit("control checkpoint signature mismatch")


def checkpoint_digest(payload: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(payload)).hexdigest()


def read_checkpoint(
    args: argparse.Namespace,
    *,
    allow_missing: bool = True,
    verify_signature: bool | None = None,
) -> dict[str, Any]:
    path = checkpoint_path(args)
    if not path.exists():
        if not allow_missing:
            raise SystemExit(f"checkpoint does not exist: {path}")
        return {
            "version": CHECKPOINT_VERSION,
            **exact_binding(args),
            "stage": "new",
            "stage_index": STAGE_ORDER["new"],
        }
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise SystemExit(f"checkpoint is not valid JSON: {path}: {error}") from error
    if not isinstance(parsed, dict):
        raise SystemExit("checkpoint is not a JSON object")
    if parsed.get("version") != CHECKPOINT_VERSION:
        raise SystemExit("checkpoint version mismatch")
    for key, expected in exact_binding(args).items():
        if parsed.get(key) != expected:
            raise SystemExit(f"checkpoint {key} mismatch")
    stage = str(parsed.get("stage") or "")
    if stage not in STAGE_ORDER or int(parsed.get("stage_index", -1)) != STAGE_ORDER[stage]:
        raise SystemExit("checkpoint stage is invalid")
    should_verify = os.environ.get("REEL_PHASE5_ROLE") == "control" if verify_signature is None else verify_signature
    if should_verify:
        verify_checkpoint_signature(args, parsed)
    return parsed


def write_checkpoint(args: argparse.Namespace, checkpoint: dict[str, Any], stage: str | None = None, **updates: Any) -> dict[str, Any]:
    if os.environ.get("REEL_PHASE5_ROLE") == "compute":
        raise SystemExit("compute role may not write control state")
    if stage is not None and stage not in STAGE_ORDER:
        raise SystemExit(f"unknown checkpoint stage: {stage}")
    current_stage = str(checkpoint.get("stage") or "new")
    next_stage = stage or current_stage
    if STAGE_ORDER[next_stage] < STAGE_ORDER.get(current_stage, -1):
        raise SystemExit(f"checkpoint stage regression refused: {current_stage} -> {next_stage}")
    payload = {
        **checkpoint,
        "version": CHECKPOINT_VERSION,
        **exact_binding(args),
        "stage": next_stage,
        "stage_index": STAGE_ORDER[next_stage],
        "updated_at": now_iso(),
        **updates,
    }
    signed = sign_checkpoint(args, payload)
    atomic_write_json(checkpoint_path(args), signed)
    return signed


def read_compute_result(args: argparse.Namespace, checkpoint: dict[str, Any], *, allow_missing: bool = False) -> dict[str, Any] | None:
    path = result_path(args)
    if not path.exists():
        if allow_missing:
            return None
        raise SystemExit("compute result does not exist")
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise SystemExit("compute result is not valid JSON") from error
    if not isinstance(document, dict) or document.get("version") != COMPUTE_RESULT_VERSION:
        raise SystemExit("compute result version mismatch")
    for key, expected in exact_binding(args).items():
        if document.get(key) != expected:
            raise SystemExit(f"compute result {key} mismatch")
    if document.get("control_state_sha256") != checkpoint_digest(checkpoint):
        raise SystemExit("compute result control-state digest mismatch")
    result = validate_processor_result(document.get("processor_result"), expected_job_id=args.job_id)
    return {**document, "processor_result": result}


def write_compute_result(args: argparse.Namespace, checkpoint: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    if os.environ.get("REEL_PHASE5_ROLE") == "control":
        raise SystemExit("control role may not write compute result")
    document = {
        "version": COMPUTE_RESULT_VERSION,
        **exact_binding(args),
        "control_state_sha256": checkpoint_digest(checkpoint),
        "processor_result": result,
        "completed_at": now_iso(),
    }
    atomic_write_json(result_path(args), document)
    return document


def ensure_callback_token(args: argparse.Namespace, checkpoint: dict[str, Any]) -> dict[str, Any]:
    if checkpoint.get("idempotency_key") and checkpoint.get("callback_token") and checkpoint.get("callback_token_hash"):
        return checkpoint
    callback_token = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(callback_token.encode("utf-8")).hexdigest()
    token_expires_at = (now_utc() + timedelta(minutes=max(5, min(int(args.token_minutes), 360)))).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return write_checkpoint(
        args,
        checkpoint,
        "callback_token_minted",
        idempotency_key=f"{args.pilot_key}:{args.job_id}:staged-runner-1",
        callback_token=callback_token,
        callback_token_hash=token_hash,
        callback_token_expires_at=token_expires_at,
    )


def safe_local_summary(local: dict[str, Any]) -> dict[str, Any]:
    return {
        key: local.get(key)
        for key in ("lease_status", "job_status", "lease_owner", "lease_expires_at", "source_url", "library_path", "html_key")
        if key in local
    }


def callback_window_valid(checkpoint: dict[str, Any], min_seconds: int) -> bool:
    expiry = parse_time(checkpoint.get("callback_token_expires_at"))
    return bool(expiry and expiry > now_utc() + timedelta(seconds=min_seconds))


def require_callback_window(checkpoint: dict[str, Any], min_seconds: int) -> None:
    if not callback_window_valid(checkpoint, min_seconds):
        raise SystemExit("callback authority is expired or below the minimum safe processing window")


def validate_worker_token(args: argparse.Namespace) -> str:
    return legacy.admin_token(args, required=True)


def control_start(args: argparse.Namespace) -> int:
    require_confirmation(args)
    checkpoint = read_checkpoint(args)
    current_stage = str(checkpoint.get("stage") or "new")
    if STAGE_ORDER[current_stage] >= STAGE_ORDER["cloud_finalized"]:
        local = legacy.verify_local(args)
        json_print({"ok": True, "idempotent": True, "stage": current_stage, "local": safe_local_summary(local)})
        return 0
    if current_stage == "ready_for_compute":
        compute = read_compute_result(args, checkpoint, allow_missing=True)
        if compute is not None:
            json_print({"ok": True, "idempotent": True, "stage": current_stage, "compute_result_available": True})
            return 0
    checkpoint = write_checkpoint(args, checkpoint, "checkpoint_created") if checkpoint.get("stage") == "new" else checkpoint
    checkpoint = ensure_callback_token(args, checkpoint)
    local = legacy.verify_local(args)
    token = validate_worker_token(args)
    start_response = legacy.cloud_start(args, token, checkpoint)
    if not start_response.get("ok"):
        raise RuntimeError(f"Worker start/reconcile failed: {redacted_response(start_response)}")
    effective_expiry = start_response.get("token_expires_at") or checkpoint.get("callback_token_expires_at")
    if effective_expiry:
        checkpoint["callback_token_expires_at"] = effective_expiry
    cloud_stage = "cloud_started" if STAGE_ORDER[str(checkpoint.get("stage") or "new")] < STAGE_ORDER["cloud_started"] else None
    checkpoint = write_checkpoint(
        args,
        checkpoint,
        cloud_stage,
        cloud_start=redacted_response(start_response),
        local=safe_local_summary(local),
        job={
            "source_url": local.get("source_url") or "",
            "instructions": local.get("instructions") or "",
            "source_media_json": local.get("source_media_json") or "",
        },
        worker_url=args.worker_url,
    )
    if start_response.get("processor_already_complete"):
        result = {
            "ok": True,
            "job_id": args.job_id,
            "recovered_after_cloud_completion": True,
            "recovery_status": start_response.get("recovery_status") or "processor_already_complete",
        }
        checkpoint = write_checkpoint(args, checkpoint, "processor_complete", processor_result=result)
        json_print({"ok": True, "stage": checkpoint["stage"], "processor_already_complete": True, "checkpoint": str(checkpoint_path(args))})
        return 0
    if not callback_window_valid(checkpoint, args.min_callback_seconds):
        checkpoint = write_checkpoint(args, checkpoint, "abort_required", abort_reason="insufficient_callback_authority")
        raise SystemExit("Worker returned insufficient callback authority; compute was not started")
    if local.get("lease_status") != "processing":
        legacy.mark_local_processing(args)
    ready_stage = "ready_for_compute" if STAGE_ORDER[str(checkpoint.get("stage") or "new")] < STAGE_ORDER["ready_for_compute"] else None
    checkpoint = write_checkpoint(args, checkpoint, ready_stage)
    if args.inject_fault == "after-cloud-start":
        raise SystemExit("synthetic fault after cloud start")
    json_print({"ok": True, "stage": checkpoint["stage"], "checkpoint": str(checkpoint_path(args))})
    return 0


def redacted_response(response: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in response.items()
        if key not in {"callback_token", "token", "Authorization"} and not str(key).lower().endswith("secret")
    }


def require_compute_boundary() -> None:
    if os.environ.get("REEL_PHASE5_ROLE") == "control":
        raise SystemExit("control role may not execute compute")
    forbidden_env = [key for key in os.environ if key.startswith("REEL_PHASE5_PG") or key.startswith("REEL_PHASE5_ADMIN_TOKEN")]
    if forbidden_env:
        raise SystemExit("compute environment contains control-plane variables")
    for path in (Path("/run/control-secrets/postgres_password"), Path("/run/control-secrets/phase5_admin_token"), Path("/run/secrets/postgres_password"), Path("/run/secrets/phase5_admin_token")):
        if path.exists():
            raise SystemExit("compute boundary can see a control secret path")


def post_json(url: str, token: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = Request(
        url,
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urlopen(request, timeout=90) as response:
            parsed = json.loads(response.read().decode("utf-8", errors="replace") or "{}")
            return parsed if isinstance(parsed, dict) else {"ok": False, "error": "non_object_response"}
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:300]
        raise RuntimeError(f"callback POST failed with HTTP {error.code}: {detail}") from error
    except URLError as error:
        raise RuntimeError(f"callback POST failed: {error.reason}") from error


def synthetic_processor(args: argparse.Namespace, checkpoint: dict[str, Any]) -> dict[str, Any]:
    complete_url = f"{str(checkpoint.get('worker_url') or args.worker_url).rstrip('/')}/internal/jobs/{args.job_id}/complete"
    result = {
        "ok": True,
        "job_id": args.job_id,
        "shortcode": "synthetic-stage",
        "frames": 1,
        "carousel_items": 0,
        "resources": 1,
        "resumed_research": True,
    }
    post_json(complete_url, str(checkpoint["callback_token"]), {"summary": "synthetic staged completion", "resources": [{"name": "Synthetic"}]})
    return result


def load_processor_module():
    if os.environ.get("REEL_PHASE5_ROLE") == "control":
        raise SystemExit("control role may not load the media/Codex processor")
    processor_path = Path(os.environ.get("REEL_PHASE5_PROCESSOR_PATH") or DEFAULT_PROCESSOR_PATH)
    if not processor_path.exists():
        raise SystemExit(f"processor not found: {processor_path}")
    spec = importlib.util.spec_from_file_location("phase5_cloud_processor", processor_path)
    if spec is None or spec.loader is None:
        raise SystemExit("could not load production processor module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_codex_auth(path: Path) -> str:
    if not path.exists():
        source = os.environ.get("CODEX_AUTH_SOURCE", "")
        if source:
            source_path = Path(source)
            if source_path.exists():
                return legacy.load_codex_auth(source_path)
    if os.environ.get("CODEX_FAKE_RESPONSE") == "1" and not path.exists():
        return json.dumps({"fixture_auth": True})
    return legacy.load_codex_auth(path)


def validate_processor_result(result: Any, *, expected_job_id: str) -> dict[str, Any]:
    if not isinstance(result, dict):
        raise SystemExit("processor result is not an object")
    extra = set(result) - RESULT_ALLOWED_KEYS - {"auth_json"}
    if extra:
        raise SystemExit(f"processor result contains unsupported keys: {sorted(extra)}")
    sanitized = {key: value for key, value in result.items() if key in RESULT_ALLOWED_KEYS}
    if sanitized.get("ok") is not True:
        raise SystemExit("processor result was not ok")
    for key in ("frames", "carousel_items", "resources"):
        if key in sanitized and sanitized[key] is not None:
            value = sanitized[key]
            if not isinstance(value, int) or value < 0 or value > 10000:
                raise SystemExit(f"processor result {key} is outside allowed bounds")
    for key in ("job_id", "shortcode", "existing_job_id", "recovery_status"):
        if key in sanitized and sanitized[key] is not None and (not isinstance(sanitized[key], str) or len(sanitized[key]) > 500):
            raise SystemExit(f"processor result {key} is invalid")
    if sanitized.get("job_id") not in (None, "", expected_job_id):
        raise SystemExit("processor result job_id mismatch")
    timings = sanitized.get("timings")
    if timings is not None:
        if not isinstance(timings, dict) or set(timings) - {
            "prefetch_hit", "download_seconds", "media_preparation_seconds", "codex_seconds", "completion_seconds", "total_seconds"
        }:
            raise SystemExit("processor result timings are invalid")
        if not isinstance(timings.get("prefetch_hit"), bool):
            raise SystemExit("processor result prefetch timing flag is invalid")
        for key, value in timings.items():
            if key != "prefetch_hit" and (not isinstance(value, (int, float)) or value < 0 or value > 7200):
                raise SystemExit(f"processor result timing {key} is outside allowed bounds")
    return sanitized


def compute_run(args: argparse.Namespace) -> int:
    require_compute_boundary()
    checkpoint = read_checkpoint(args, allow_missing=False, verify_signature=False)
    stage = str(checkpoint.get("stage"))
    if STAGE_ORDER[stage] >= STAGE_ORDER["processor_complete"]:
        json_print({"ok": True, "idempotent": True, "stage": stage, "checkpoint": str(checkpoint_path(args))})
        return 0
    if STAGE_ORDER[stage] < STAGE_ORDER["ready_for_compute"]:
        raise SystemExit(f"checkpoint is not ready for compute: {stage}")
    require_callback_window(checkpoint, args.min_callback_seconds)
    existing = read_compute_result(args, checkpoint, allow_missing=True)
    if existing is not None:
        json_print({"ok": True, "idempotent": True, "stage": "processor_complete", "result": existing["processor_result"]})
        return 0
    if args.inject_fault == "before-processor":
        raise SystemExit("synthetic fault before processor")
    if args.inject_fault == "attempt-control-state-write":
        checkpoint_path(args).write_text("tampered", encoding="utf-8")
        raise SystemExit("compute unexpectedly wrote control state")
    if args.synthetic_processor:
        result = synthetic_processor(args, checkpoint)
    else:
        module = load_processor_module()
        job = checkpoint.get("job") if isinstance(checkpoint.get("job"), dict) else {}
        payload = {
            "job_id": args.job_id,
            "source_url": str(job.get("source_url") or ""),
            "callback_base_url": str(checkpoint.get("worker_url") or args.worker_url),
            "callback_token": str(checkpoint["callback_token"]),
            "instructions": str(job.get("instructions") or ""),
            "codex_auth_json": load_codex_auth(Path(args.codex_auth_path)),
            "instagram_cookies_json": "",
            "instagram_media_json": str(job.get("source_media_json") or ""),
            "timeout_seconds": args.timeout_seconds,
            "prefetch_dir": args.prefetch_dir,
        }
        resume_artifacts = args.resume_artifacts_json or checkpoint.get("resume_artifacts")
        if resume_artifacts:
            rows = json.loads(resume_artifacts) if isinstance(resume_artifacts, str) else resume_artifacts
            payload["resume_research"] = True
            payload["resume_artifacts"] = rows
        result = module.process(payload)
    result_summary = validate_processor_result(result, expected_job_id=args.job_id)
    if args.inject_fault == "after-processor-before-checkpoint":
        raise SystemExit("synthetic fault after processor before checkpoint")
    write_compute_result(args, checkpoint, result_summary)
    json_print({"ok": True, "stage": "processor_complete", "checkpoint": str(checkpoint_path(args)), "result": result_summary})
    return 0


def control_finalize(args: argparse.Namespace) -> int:
    require_confirmation(args)
    checkpoint = read_checkpoint(args, allow_missing=False)
    local = legacy.verify_local(args)
    if local.get("lease_status") == "completed":
        checkpoint = write_checkpoint(args, checkpoint, "complete")
        json_print({"ok": True, "idempotent": True, "stage": "complete", "checkpoint": str(checkpoint_path(args))})
        return 0
    if STAGE_ORDER[str(checkpoint.get("stage"))] < STAGE_ORDER["processor_complete"]:
        compute = read_compute_result(args, checkpoint)
        result = compute["processor_result"]
        checkpoint = write_checkpoint(args, checkpoint, "processor_complete", processor_result=result)
    else:
        result = validate_processor_result(checkpoint.get("processor_result"), expected_job_id=args.job_id)
    token = validate_worker_token(args)
    finalize_response = legacy.cloud_finalize(args, token, checkpoint)
    checkpoint = write_checkpoint(args, checkpoint, "cloud_finalized", cloud_finalize=redacted_response(finalize_response))
    if args.inject_fault == "after-cloud-finalize-before-local-complete":
        raise SystemExit("synthetic fault after cloud finalize before local completion")
    legacy.complete_local_lease(args, result)
    checkpoint = write_checkpoint(args, checkpoint, "complete")
    json_print({"ok": True, "stage": checkpoint["stage"], "checkpoint": str(checkpoint_path(args))})
    return 0


def control_abort(args: argparse.Namespace) -> int:
    require_confirmation(args)
    checkpoint = read_checkpoint(args, allow_missing=False)
    if STAGE_ORDER[str(checkpoint.get("stage"))] >= STAGE_ORDER["processor_complete"]:
        raise SystemExit("pre-publication abort refused after processor completion")
    token = validate_worker_token(args)
    response = legacy.cloud_abort(args, token, checkpoint, args.rollback_reason)
    legacy.rollback_local_lease(args, args.rollback_reason)
    checkpoint = write_checkpoint(args, checkpoint, "rolled_back", cloud_abort=redacted_response(response), rollback_reason=args.rollback_reason)
    json_print({"ok": True, "stage": checkpoint["stage"], "checkpoint": str(checkpoint_path(args))})
    return 0


def sql_literal(value: str | None) -> str:
    return legacy.sql_literal(value)


def execute_native_sql(args: argparse.Namespace, sql: str, values: tuple[Any, ...] = ()) -> None:
    with legacy.native_pg_connection(args) as connection:
        with connection.cursor() as cursor:
            cursor.execute(sql, values)


def synthetic_schema_guard(schema: str) -> str:
    safe = safe_schema(schema)
    if not safe.startswith("reel_phase5c_staged_"):
        raise SystemExit("synthetic schema must start with reel_phase5c_staged_")
    return safe


def synthetic_init(args: argparse.Namespace) -> int:
    safe = synthetic_schema_guard(args.schema)
    execute_native_sql(args, f"DROP SCHEMA IF EXISTS {safe} CASCADE;")
    execute_native_sql(args, f"CREATE SCHEMA {safe};")
    execute_native_sql(args, f"""
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
    """)
    execute_native_sql(args, f"CREATE TABLE {safe}.artifacts (id bigserial PRIMARY KEY, job_id text NOT NULL, object_key text NOT NULL);")
    execute_native_sql(args, f"CREATE TABLE {safe}.job_events (id bigserial PRIMARY KEY, job_id text NOT NULL, stage text NOT NULL);")
    execute_native_sql(args, f"""
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
    """)
    execute_native_sql(args, f"""
      CREATE TABLE {safe}.phase5_pilot_events (
        id bigserial PRIMARY KEY,
        pilot_key text NOT NULL,
        job_id text NOT NULL,
        stage text NOT NULL,
        status text NOT NULL,
        detail jsonb,
        created_at timestamptz DEFAULT now()
      );
    """)
    execute_native_sql(
        args,
        f"""
        INSERT INTO {safe}.jobs(id,status,source_url,instructions,source_media_json)
        VALUES (%s,'queued','https://example.invalid/reel/synthetic','synthetic staged runner test','{{"fixture": true}}'::jsonb);
        """,
        (args.job_id,),
    )
    execute_native_sql(
        args,
        f"""
        INSERT INTO {safe}.phase5_pilot_leases(pilot_key, exact_job_id, source_message_id, lease_owner, status, lease_expires_at)
        VALUES (%s,%s,%s,%s,'leased',now() + interval '30 minutes');
        """,
        (args.pilot_key, args.job_id, args.source_message_id, args.lease_owner),
    )
    checkpoint = read_checkpoint(args)
    write_checkpoint(args, checkpoint, "checkpoint_created")
    json_print({"ok": True, "schema": safe, "checkpoint": str(checkpoint_path(args))})
    return 0


def synthetic_drop(args: argparse.Namespace) -> int:
    safe = synthetic_schema_guard(args.schema)
    execute_native_sql(args, f"DROP SCHEMA IF EXISTS {safe} CASCADE;")
    json_print({"ok": True, "dropped": safe})
    return 0


def status(args: argparse.Namespace) -> int:
    local = legacy.verify_local(args)
    checkpoint = read_checkpoint(args, allow_missing=True)
    json_print({"ok": True, "local": safe_local_summary(local), "checkpoint_stage": checkpoint.get("stage"), "checkpoint": str(checkpoint_path(args))})
    return 0


def require_confirmation(args: argparse.Namespace) -> None:
    expected = f"{CONTROL_CONFIRMATION} {args.job_id}"
    if args.confirm_live_run != expected:
        raise SystemExit(f"--confirm-live-run must equal {expected}")


def add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--pilot-key", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--source-message-id", required=True)
    parser.add_argument("--lease-owner", default=DEFAULT_WORKER)
    parser.add_argument("--schema", default=DEFAULT_SCHEMA)
    parser.add_argument("--checkpoint-path", default="")
    parser.add_argument("--result-path", default="")
    parser.add_argument("--worker-url", default=legacy.WORKER_BASE_URL)
    parser.add_argument("--confirm-live-run", default="")
    parser.add_argument("--token-minutes", type=int, default=240)
    parser.add_argument("--min-callback-seconds", type=int, default=300)
    parser.add_argument("--inject-fault", default="", choices=("", "after-cloud-start", "before-processor", "after-processor-before-checkpoint", "after-cloud-finalize-before-local-complete", "attempt-control-state-write"))
    parser.add_argument("--pg-mode", default=os.environ.get("REEL_PHASE5_PG_MODE", "auto"), choices=("auto", "native", "legacy-ssh"))
    parser.add_argument("--pg-host", default=os.environ.get("REEL_PHASE5_PGHOST", "cartdotcom-platform-postgres-1"))
    parser.add_argument("--pg-port", type=int, default=int(os.environ.get("REEL_PHASE5_PGPORT", "5432")))
    parser.add_argument("--pg-database", default=os.environ.get("REEL_PHASE5_PGDATABASE", "cartdotcom"))
    parser.add_argument("--pg-user", default=os.environ.get("REEL_PHASE5_PGUSER", "cartdotcom"))
    parser.add_argument("--pg-password-file", default=os.environ.get("REEL_PHASE5_PG_PASSWORD_FILE", ""))
    parser.add_argument("--pg-connect-timeout", type=int, default=int(os.environ.get("REEL_PHASE5_PG_CONNECT_TIMEOUT", "10")))
    parser.add_argument("--ssh-target", default=os.environ.get("REEL_PHASE2_PG_SSH_TARGET", "cartdotcom-server"))
    parser.add_argument("--admin-token-file", default=os.environ.get("REEL_PHASE5_ADMIN_TOKEN_FILE", ""))
    parser.add_argument("--admin-token-env", default="REEL_BRAIN_ADMIN_TOKEN")
    parser.add_argument("--allow-admin-token-env", action="store_true")
    parser.add_argument("--codex-auth-path", default=str(Path.home() / ".codex" / "auth.json"))
    parser.add_argument("--timeout-seconds", type=int, default=900)
    parser.add_argument("--rollback-reason", default="phase5c_staged_prepublication_abort")
    parser.add_argument("--resume-artifacts-json", default="")
    parser.add_argument("--prefetch-dir", default="")
    parser.add_argument("--synthetic-processor", action="store_true")


def normalize_args(args: argparse.Namespace) -> argparse.Namespace:
    args.pilot_key = require_exact(args.pilot_key, "--pilot-key", 120)
    args.job_id = require_exact(args.job_id, "--job-id", 120)
    args.source_message_id = require_exact(args.source_message_id, "--source-message-id")
    args.lease_owner = require_exact(args.lease_owner, "--lease-owner", 120)
    args.schema = safe_schema(args.schema)
    return args


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 5 staged exact-job runner")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("control-start", "compute-run", "control-finalize", "control-abort", "synthetic-init", "synthetic-drop", "status"):
        command = sub.add_parser(name)
        add_common(command)
    args = normalize_args(parser.parse_args())
    if args.command == "control-start":
        return control_start(args)
    if args.command == "compute-run":
        return compute_run(args)
    if args.command == "control-finalize":
        return control_finalize(args)
    if args.command == "control-abort":
        return control_abort(args)
    if args.command == "synthetic-init":
        return synthetic_init(args)
    if args.command == "synthetic-drop":
        return synthetic_drop(args)
    if args.command == "status":
        return status(args)
    raise SystemExit("unknown command")


if __name__ == "__main__":
    raise SystemExit(main())
