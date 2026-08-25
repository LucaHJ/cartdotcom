#!/usr/bin/env python3
"""Phase 6 control-container adapter for authority and exact serial claims."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import stat
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

RUNNER_PATH = Path(os.environ.get("REEL_PHASE5_RUNNER_PATH", "/opt/reel/phase5_one_job_runner.py"))
TOKEN_PATH = Path(os.environ.get("REEL_PHASE5_ADMIN_TOKEN_FILE", "/run/control-secrets/phase5_admin_token"))
WORKER_URL = os.environ.get("REEL_PHASE6_WORKER_URL", "https://cartdotcom-instagram-reel-brain.lucajeannin.workers.dev")
DEFAULT_SCHEMA = os.environ.get("REEL_PHASE6_SCHEMA", "reel_phase4_shadow_20260821_014246")

CONFIRMATIONS = {
    "transition": "SET PHASE 6 AUTHORITY TRANSITION",
    "local": "SET PHASE 6 AUTHORITY SELF HOSTED",
    "cloud": "ROLL BACK PHASE 6 AUTHORITY TO CLOUD",
    "claim": "CLAIM EXACT PHASE 6 JOB",
    "release": "RELEASE EXACT PHASE 6 JOB",
}


def load_runner():
    spec = importlib.util.spec_from_file_location("phase6_legacy_runner", RUNNER_PATH)
    if not spec or not spec.loader:
        raise SystemExit("Phase 6 control could not load the exact runner helpers")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def token() -> str:
    if not TOKEN_PATH.exists() or not TOKEN_PATH.is_file():
        raise SystemExit("Phase 6 Worker control token file is unavailable")
    if stat.S_IMODE(TOKEN_PATH.stat().st_mode) & 0o077:
        raise SystemExit("Phase 6 Worker control token file must be mode 0600")
    value = TOKEN_PATH.read_text(encoding="utf-8").strip()
    if len(value) < 24:
        raise SystemExit("Phase 6 Worker control token file is invalid")
    return value


def worker_json(
    method: str,
    path: str,
    *,
    payload: dict[str, Any] | None = None,
    allowed_error_statuses: tuple[int, ...] = (),
) -> dict[str, Any]:
    body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = Request(
        f"{WORKER_URL.rstrip('/')}{path}",
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {token()}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "curl/8.5.0 cartdotcom-phase6-control/1.0",
        },
    )
    try:
        with urlopen(request, timeout=90) as response:
            parsed = json.loads(response.read().decode("utf-8", errors="replace") or "{}")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:8192]
        if error.code in allowed_error_statuses:
            try:
                parsed = json.loads(detail or "{}")
            except json.JSONDecodeError as decode_error:
                raise RuntimeError(f"Phase 6 Worker control returned invalid JSON with HTTP {error.code}") from decode_error
            if not isinstance(parsed, dict):
                raise RuntimeError(f"Phase 6 Worker control returned a non-object response with HTTP {error.code}")
            parsed["_http_status"] = error.code
            return parsed
        raise RuntimeError(f"Phase 6 Worker control returned HTTP {error.code}: {detail[:500]}") from error
    except URLError as error:
        raise RuntimeError(f"Phase 6 Worker control failed: {error.reason}") from error
    if not isinstance(parsed, dict):
        raise RuntimeError("Phase 6 Worker control returned a non-object response")
    return parsed


def pg_args(args: argparse.Namespace) -> argparse.Namespace:
    return argparse.Namespace(
        pg_mode="native",
        pg_host=os.environ.get("REEL_PHASE5_PGHOST", "cartdotcom-platform-postgres-1"),
        pg_port=int(os.environ.get("REEL_PHASE5_PGPORT", "5432")),
        pg_database=os.environ.get("REEL_PHASE5_PGDATABASE", "cartdotcom"),
        pg_user=os.environ.get("REEL_PHASE5_PGUSER", "cartdotcom"),
        pg_password_file=os.environ.get("REEL_PHASE5_PG_PASSWORD_FILE", "/run/control-secrets/postgres_password"),
        pg_connect_timeout=int(os.environ.get("REEL_PHASE5_PG_CONNECT_TIMEOUT", "10")),
        ssh_target="",
        schema=args.schema,
    )


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def local_job_ready(runner: Any, args: argparse.Namespace, job_id: str) -> bool:
    rows = runner.psql_json(pg_args(args), args.schema, f"SELECT json_build_object('count',count(*)) FROM {args.schema}.jobs WHERE id={sql_literal(job_id)};")
    return len(rows) == 1 and int(rows[0].get("count") or 0) == 1


def insert_local_lease(runner: Any, args: argparse.Namespace, candidate: dict[str, Any], fence: dict[str, Any]) -> dict[str, Any]:
    pilot_key = str(candidate["pilot_key"])
    job_id = str(candidate["job_id"])
    source_message_id = str(candidate["source_message_id"])
    lease_expiry = str(fence.get("local_lease_expires_at") or fence.get("expires_at") or "")
    overall_expiry = str(fence.get("expires_at") or lease_expiry)
    detail = json.dumps({"phase6": True, "generation": args.generation, "lease_owner": args.lease_owner}, separators=(",", ":"))
    rows = runner.psql_json(pg_args(args), args.schema, f"""
      WITH inserted AS (
        INSERT INTO {args.schema}.phase5_pilot_leases(
          pilot_key,exact_job_id,source_message_id,cloud_fence_key,status,lease_owner,
          lease_acquired_at,lease_heartbeat_at,lease_expires_at,expires_at,audit_json
        ) VALUES (
          {sql_literal(pilot_key)},{sql_literal(job_id)},{sql_literal(source_message_id)},
          {sql_literal(pilot_key)},'leased',{sql_literal(args.lease_owner)},now(),now(),
          {sql_literal(lease_expiry)}::timestamptz,{sql_literal(overall_expiry)}::timestamptz,{sql_literal(detail)}::jsonb
        ) ON CONFLICT (pilot_key) DO NOTHING RETURNING pilot_key,exact_job_id
      ), event_insert AS (
        INSERT INTO {args.schema}.phase5_pilot_events(pilot_key,job_id,stage,status,detail)
        SELECT pilot_key,exact_job_id,'phase6_claimed','leased',{sql_literal(detail)}::jsonb FROM inserted RETURNING 1
      )
      SELECT json_build_object(
        'inserted',(SELECT count(*) FROM inserted),
        'events',(SELECT count(*) FROM event_insert),
        'existing',(SELECT count(*) FROM {args.schema}.phase5_pilot_leases
          WHERE pilot_key={sql_literal(pilot_key)} AND exact_job_id={sql_literal(job_id)}
            AND source_message_id={sql_literal(source_message_id)} AND lease_owner={sql_literal(args.lease_owner)}
            AND status IN ('leased','processing','completed'))
      );
    """)
    inserted = int(rows[0].get("inserted") or 0) if len(rows) == 1 else 0
    events = int(rows[0].get("events") or 0) if len(rows) == 1 else 0
    existing = int(rows[0].get("existing") or 0) if len(rows) == 1 else 0
    if len(rows) != 1 or not ((inserted == 1 and events == 1) or existing == 1):
        raise RuntimeError(f"Phase 6 local exact lease insert failed closed: {json.dumps(rows, sort_keys=True)}")
    return rows[0]


def release_candidate(args: argparse.Namespace, candidate: dict[str, Any]) -> dict[str, Any]:
    return worker_json("POST", "/api/admin/phase6/release", payload={
        "expected_generation": args.generation,
        "confirmation": CONFIRMATIONS["release"],
        "pilot_key": candidate["pilot_key"],
        "job_id": candidate["job_id"],
        "source_message_id": candidate["source_message_id"],
        "lease_owner": args.lease_owner,
        "reason": "phase6_local_claim_compensation",
    })


def claim_next(args: argparse.Namespace) -> dict[str, Any]:
    runner = load_runner()
    next_response = worker_json("GET", f"/api/admin/phase6/next?{urlencode({'lease_owner': args.lease_owner})}")
    authority = next_response.get("authority") if isinstance(next_response.get("authority"), dict) else {}
    candidate = next_response.get("candidate")
    if not isinstance(candidate, dict):
        return {"ok": True, "idle": True, "authority": authority}
    generation = int(authority.get("generation", -1))
    if generation != args.generation:
        raise RuntimeError("Phase 6 candidate authority generation mismatch")
    if not local_job_ready(runner, args, str(candidate.get("job_id") or "")):
        return {"ok": True, "idle": True, "mirror_pending": True, "job_id": candidate.get("job_id"), "authority": authority}
    claim = worker_json("POST", "/api/admin/phase6/claim", payload={
        "expected_generation": args.generation,
        "confirmation": CONFIRMATIONS["claim"],
        "pilot_key": candidate["pilot_key"],
        "job_id": candidate["job_id"],
        "source_message_id": candidate["source_message_id"],
        "lease_owner": args.lease_owner,
        "lease_minutes": args.lease_minutes,
        "reason": "phase6_serial_dispatch",
    }, allowed_error_statuses=(409,))
    fence = claim.get("fence") if isinstance(claim.get("fence"), dict) else None
    recoverable_active = bool(
        claim.get("_http_status") == 409
        and fence
        and fence.get("pilot_key") == candidate["pilot_key"]
        and fence.get("job_id") == candidate["job_id"]
        and fence.get("source_message_id") == candidate["source_message_id"]
        and fence.get("status") == "local_processing"
        and fence.get("local_lease_owner") == args.lease_owner
        and str(candidate["pilot_key"]).startswith(f"phase6:{args.generation}:")
    )
    if not recoverable_active and (claim.get("ok") is not True or fence is None):
        raise RuntimeError(f"Phase 6 cloud exact claim failed: {json.dumps(claim, sort_keys=True)}")
    try:
        local = insert_local_lease(runner, args, candidate, fence or {})
    except Exception:
        if not recoverable_active:
            release_candidate(args, candidate)
        raise
    return {"ok": True, "idle": False, "candidate": candidate, "claim": {"claimed": claim.get("claimed"), "idempotent": claim.get("idempotent"), "recovered_active": recoverable_active}, "local": local, "authority": authority}


def update_local_authority(runner: Any, args: argparse.Namespace, response: dict[str, Any]) -> None:
    authority = response.get("authority") if isinstance(response.get("authority"), dict) else {}
    mode = str(authority.get("mode") or "")
    if mode not in ("cloud", "transition", "self_hosted"):
        raise RuntimeError("Phase 6 authority response is invalid")
    generation = int(authority.get("generation", -1))
    watermark = authority.get("cutover_watermark")
    dispatch = mode == "self_hosted"
    detail = json.dumps({"source": "phase6_worker_control", "mode": mode, "generation": generation}, separators=(",", ":"))
    runner.psql_json(pg_args(args), args.schema, f"""
      WITH previous AS (
        SELECT mode FROM {args.schema}.processing_authority WHERE authority_key='instagram-reel-brain'
      ), updated AS (
        UPDATE {args.schema}.processing_authority SET
          mode={sql_literal(mode)},dispatch_enabled={str(dispatch).lower()},codex_enabled={str(dispatch).lower()},
          outbound_enabled={str(dispatch).lower()},backlog_enabled=false,generation={generation},
          cutover_watermark={sql_literal(str(watermark))}::timestamptz,lease_owner={sql_literal(args.lease_owner)},
          updated_at=now(),audit_json={sql_literal(detail)}::jsonb
        WHERE authority_key='instagram-reel-brain' RETURNING 1
      ), event_insert AS (
        INSERT INTO {args.schema}.processing_authority_events(authority_key,generation,from_mode,to_mode,watermark,detail)
        SELECT 'instagram-reel-brain',{generation},COALESCE((SELECT mode FROM previous),'cloud'),{sql_literal(mode)},
          {sql_literal(str(watermark))}::timestamptz,{sql_literal(detail)}::jsonb FROM updated RETURNING 1
      ) SELECT json_build_object('updated',(SELECT count(*) FROM updated),'events',(SELECT count(*) FROM event_insert));
    """)


def authority_action(args: argparse.Namespace) -> dict[str, Any]:
    target = args.command.removeprefix("authority-")
    response = worker_json("POST", f"/api/admin/phase6/authority/{target}", payload={
        "expected_generation": args.generation,
        "confirmation": CONFIRMATIONS[target],
        "reason": args.reason or f"phase6_{target}_authority_action",
    })
    if response.get("ok") is not True:
        raise RuntimeError(f"Phase 6 authority action failed: {json.dumps(response, sort_keys=True)}")
    update_local_authority(load_runner(), args, response)
    return response


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 6 control-container adapter")
    parser.add_argument("command", choices=("state", "claim-next", "authority-transition", "authority-local", "authority-cloud"))
    parser.add_argument("--schema", default=DEFAULT_SCHEMA)
    parser.add_argument("--generation", type=int, required=True)
    parser.add_argument("--lease-owner", default="phase6-local-worker-1")
    parser.add_argument("--lease-minutes", type=int, default=60)
    parser.add_argument("--reason", default="")
    args = parser.parse_args()
    if not args.schema.replace("_", "").isalnum():
        raise SystemExit("invalid schema")
    if args.command == "state":
        payload = worker_json("GET", "/api/admin/phase6/authority")
    elif args.command == "claim-next":
        payload = claim_next(args)
    else:
        payload = authority_action(args)
    print(json.dumps(payload, indent=2, sort_keys=True, default=str))
    return 0 if payload.get("ok") is True else 1


if __name__ == "__main__":
    raise SystemExit(main())
