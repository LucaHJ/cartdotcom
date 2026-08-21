#!/usr/bin/env python3
"""Phase 4 shadow-live mirror tools.

This script is intentionally read-only against Cloudflare and non-authoritative
locally. It pulls only records at or after an explicit Phase 4 watermark through
the dedicated mirror endpoint, writes typed rows into an isolated PostgreSQL
schema, and copies referenced R2 artifacts through GET-only object requests.

It never claims jobs, queues work, calls Codex, publishes library pages, sends
Instagram reactions/messages, rotates credentials, or mutates Cloudflare data.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_PSQL_COMMAND = (
    "docker exec -i cartdotcom-platform-postgres-1 "
    "psql -U cartdotcom -d cartdotcom -v ON_ERROR_STOP=1 -q"
)

DEFAULT_BASE_URL = "https://cartdotcom-instagram-reel-brain.lucajeannin.workers.dev"
MIRROR_TABLES = [
    "jobs",
    "job_events",
    "artifacts",
    "resources",
    "notes",
    "dm_commands",
    "outbound_events",
    "pending_dm_parts",
    "instagram_carousel_resolutions",
    "inbound_webhook_events",
]

TABLE_KEY_COLUMNS = {
    "jobs": "id",
    "job_events": "id",
    "artifacts": "id",
    "resources": "id",
    "notes": "id",
    "dm_commands": "id",
    "outbound_events": "id",
    "pending_dm_parts": "id",
    "instagram_carousel_resolutions": "source_message_id",
    "inbound_webhook_events": "source_message_id",
}

BOOL_COLUMNS = {
    "dm_commands": {"is_test"},
    "pending_dm_parts": {"is_test"},
    "inbound_webhook_events": {"has_share_attachment"},
}

JOB_COLUMNS = [
    "id", "source_url", "canonical_url", "shortcode", "dedupe_key", "pilot_run_id",
    "sender_id", "source_message_id", "source_media_json", "instructions", "title",
    "author_username", "description", "status", "stage", "attempts", "status_emoji",
    "error_code", "error_message", "original_video_key", "audio_key", "audio_title",
    "audio_artist", "audio_source_url", "audio_identification_method", "audio_confidence",
    "html_key", "library_path", "markdown_key", "transcript_key", "synthesis_json_key",
    "codex_input_tokens", "codex_cached_input_tokens", "codex_output_tokens",
    "codex_reasoning_output_tokens", "codex_total_tokens", "processing_seconds",
    "created_at", "started_at", "completed_at", "updated_at",
]


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def require_schema_name(schema: str) -> str:
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", schema or ""):
        raise SystemExit(f"Invalid PostgreSQL schema name: {schema!r}")
    return schema


def require_safe_object_key(key: str) -> str:
    if not key or key.startswith(("/", "\\")) or ".." in key.replace("\\", "/").split("/"):
        raise ValueError(f"Unsafe object key: {key!r}")
    return key.replace("\\", "/")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def row_sha256(row: dict[str, Any]) -> str:
    cleaned = {key: value for key, value in row.items() if key != "mirror_updated_at"}
    return sha256_bytes(stable_json(cleaned).encode("utf-8"))


def sql_literal(value: Any, *, boolean: bool = False, jsonb: bool = False) -> str:
    if value is None:
        return "NULL"
    if boolean:
        return "true" if value in (True, 1, "1", "true", "TRUE") else "false"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    if jsonb:
        text = stable_json(value)
        return "'" + text.replace("'", "''") + "'::jsonb"
    text = str(value)
    return "'" + text.replace("'", "''") + "'"


def insert_statement(schema: str, table: str, mapping: dict[str, str], conflict: str) -> str:
    columns = ", ".join(mapping.keys())
    values = ", ".join(mapping.values())
    return f"INSERT INTO {schema}.{table} ({columns}) VALUES ({values}) {conflict};"


def run_psql(sql: str, psql_command: str = DEFAULT_PSQL_COMMAND) -> None:
    result = subprocess.run(
        psql_command,
        input=sql,
        text=True,
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"psql failed: {result.stderr.strip()}")


def capture_psql(sql: str, psql_command: str = DEFAULT_PSQL_COMMAND) -> str:
    result = subprocess.run(
        psql_command,
        input=sql,
        text=True,
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"psql failed: {result.stderr.strip()}")
    return result.stdout.strip()


def operational_schema_sql(schema: str, migrations_dir: Path) -> str:
    require_schema_name(schema)
    statements = [f"CREATE SCHEMA IF NOT EXISTS {schema};"]
    for name in [
        "0001_phase1_inert_schema.sql",
        "0002_phase2_local_contracts.sql",
        "0003_phase3_cloud_schema_drift.sql",
        "0004_phase4_shadow_live_mirror.sql",
    ]:
        sql = (migrations_dir / name).read_text(encoding="utf-8").replace("reel_brain", schema)
        statements.append(sql)
    return "\n".join(statements)


def init_schema(args: argparse.Namespace) -> None:
    schema = require_schema_name(args.schema)
    migrations_dir = Path(args.migrations_dir).resolve()
    watermark = parse_watermark(args.watermark)
    run_dir = Path(args.run_dir).resolve()
    run_dir.mkdir(parents=True, exist_ok=True)
    sql = operational_schema_sql(schema, migrations_dir)
    sql += "\nBEGIN;\n"
    sql += insert_statement(schema, "phase4_mirror_metadata", {
        "key": sql_literal("phase4_start"),
        "value": sql_literal({
            "watermark": watermark,
            "created_at": utc_now(),
            "source": "phase4_shadow_live_mirror",
            "authority": "cloud_authoritative_local_read_only_shadow",
            "execution_disabled": True,
            "outbound_disabled": True,
            "backlog_disabled": True,
        }, jsonb=True),
    }, "ON CONFLICT (key) DO UPDATE SET value=excluded.value, updated_at=now()")
    sql += "\n"
    for table in MIRROR_TABLES:
        sql += insert_statement(schema, "phase4_mirror_cursors", {
            "table_name": sql_literal(table),
            "watermark": sql_literal(watermark),
            "cursor_token": "NULL",
        }, "ON CONFLICT (table_name) DO NOTHING")
        sql += "\n"
    sql += "COMMIT;\n"
    if args.output:
        Path(args.output).write_text(sql, encoding="utf-8")
    run_psql(sql, args.psql_command)
    (run_dir / "phase4-watermark.json").write_text(
        json.dumps({"schema": schema, "watermark": watermark, "created_at": utc_now()}, indent=2),
        encoding="utf-8",
    )
    print(json.dumps({"ok": True, "schema": schema, "watermark": watermark, "run_dir": str(run_dir)}, indent=2))


def parse_watermark(raw: str) -> str:
    value = str(raw or "").strip()
    if not value:
        raise SystemExit("watermark is required")
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    try:
        parsed = dt.datetime.fromisoformat(value)
    except ValueError as error:
        raise SystemExit(f"Invalid ISO watermark: {raw!r}") from error
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def read_token(token_file: Path) -> str:
    stat = token_file.stat()
    if os.name != "nt" and (stat.st_mode & 0o077):
        raise SystemExit(f"Token file permissions are too broad: {token_file}")
    token = token_file.read_text(encoding="utf-8").strip()
    if len(token) < 32:
        raise SystemExit("Mirror token is unexpectedly short")
    return token


def mirror_request(base_url: str, token: str, path: str, query: dict[str, str], *, timeout: int = 60) -> tuple[int, dict[str, str], bytes]:
    url = f"{base_url.rstrip('/')}{path}?{urllib.parse.urlencode(query)}"
    request = urllib.request.Request(
        url,
        method="GET",
        headers={"Authorization": f"Bearer {token}", "User-Agent": "phase4-shadow-mirror/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            headers = {key.lower(): value for key, value in response.headers.items()}
            return response.status, headers, response.read()
    except urllib.error.HTTPError as error:
        body = error.read()
        return error.code, {key.lower(): value for key, value in error.headers.items()}, body


def fetch_delta(base_url: str, token: str, watermark: str, table: str, cursor: str | None, limit: int) -> dict[str, Any]:
    query = {"watermark": watermark, "table": table, "limit": str(limit)}
    if cursor:
        query["cursor"] = cursor
    status, _headers, body = mirror_request(base_url, token, "/api/phase4/mirror/delta", query)
    if status != 200:
        raise RuntimeError(f"delta fetch failed for {table}: HTTP {status} {body[:160]!r}")
    payload = json.loads(body.decode("utf-8"))
    if not payload.get("ok") or payload.get("table") != table:
        raise RuntimeError(f"invalid delta payload for {table}")
    return payload


def local_object_path(root: Path, key: str) -> Path:
    safe_key = require_safe_object_key(key)
    root_resolved = root.resolve()
    target = (root_resolved / safe_key).resolve()
    if target != root_resolved and root_resolved not in target.parents:
        raise ValueError(f"Object path escapes root: {key!r}")
    return target


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=str(path.parent), delete=False) as handle:
        handle.write(data)
        temp_name = handle.name
    os.replace(temp_name, path)


def download_object(base_url: str, token: str, watermark: str, object_root: Path, key: str, expected_size: int | None, expected_sha256: str | None) -> dict[str, Any]:
    path = local_object_path(object_root, key)
    if path.exists():
        actual_size = path.stat().st_size
        actual_sha = sha256_file(path)
        if (expected_size is None or actual_size == expected_size) and (not expected_sha256 or actual_sha == expected_sha256):
            return {"object_key": key, "local_path": str(path), "actual_byte_size": actual_size, "actual_sha256": actual_sha, "verified": True, "detail": "already_present"}
    status, headers, body = mirror_request(base_url, token, "/api/phase4/mirror/object", {"watermark": watermark, "key": key}, timeout=180)
    if status != 200:
        raise RuntimeError(f"object fetch failed for {key}: HTTP {status} {body[:160]!r}")
    atomic_write(path, body)
    actual_size = path.stat().st_size
    actual_sha = sha256_file(path)
    verified = (expected_size is None or actual_size == expected_size) and (not expected_sha256 or actual_sha == expected_sha256)
    return {
        "object_key": key,
        "local_path": str(path),
        "actual_byte_size": actual_size,
        "actual_sha256": actual_sha,
        "content_type": headers.get("content-type"),
        "verified": verified,
        "detail": "ok" if verified else "size_or_sha_mismatch",
    }


def row_key(table: str, row: dict[str, Any]) -> str:
    key = row.get(TABLE_KEY_COLUMNS[table])
    if key is None:
        raise ValueError(f"missing source key for {table}")
    return str(key)


def upsert_typed_sql(schema: str, table: str, row: dict[str, Any]) -> str:
    if table == "jobs":
        mapping = {column: sql_literal(row.get(column), jsonb=column == "source_media_json") for column in JOB_COLUMNS}
        return insert_statement(schema, "jobs", mapping, "ON CONFLICT (id) DO UPDATE SET " + ", ".join(
            f"{column}=excluded.{column}" for column in JOB_COLUMNS if column != "id"
        ))
    if table == "artifacts":
        byte_size = row.get("byte_size")
        sha = row.get("sha256") or ""
        mapping = {
            "source_artifact_id": sql_literal(row.get("id")),
            "job_id": sql_literal(row.get("job_id")),
            "kind": sql_literal(row.get("kind")),
            "object_key": sql_literal(row.get("object_key")),
            "content_type": sql_literal(row.get("content_type") or "application/octet-stream"),
            "byte_length": sql_literal(byte_size or 0),
            "checksum_sha256": sql_literal(sha),
            "source_byte_size": sql_literal(byte_size),
            "source_sha256": sql_literal(sha or None),
            "created_at": sql_literal(row.get("created_at")),
        }
        return insert_statement(schema, "artifacts", mapping, "ON CONFLICT (object_key) DO UPDATE SET " + ", ".join(
            f"{column}=excluded.{column}" for column in mapping if column not in {"source_artifact_id", "object_key"}
        ))
    if table == "job_events":
        mapping = {column: sql_literal(row.get(column)) for column in ["id", "job_id", "stage", "status", "emoji", "detail", "created_at"]}
        return insert_statement(schema, "job_events", mapping, "ON CONFLICT (id) DO UPDATE SET " + ", ".join(
            f"{column}=excluded.{column}" for column in mapping if column != "id"
        ))
    if table == "instagram_carousel_resolutions":
        mapping = {
            "id": sql_literal(row.get("source_message_id")),
            "source_message_id": sql_literal(row.get("source_message_id")),
            "sender_id": sql_literal(row.get("sender_id")),
            "media_id": sql_literal(row.get("media_id")),
            "source_media_id": sql_literal(row.get("media_id")),
            "title": sql_literal(row.get("title")),
            "status": sql_literal(row.get("status")),
            "source_url": sql_literal(row.get("source_url")),
            "canonical_url": sql_literal(row.get("source_url")),
            "resolution_method": sql_literal(row.get("resolution_method")),
            "attempts": sql_literal(row.get("attempts") or 0),
            "error": sql_literal(row.get("error")),
            "error_message": sql_literal(row.get("error")),
            "created_at": sql_literal(row.get("created_at")),
            "updated_at": sql_literal(row.get("updated_at")),
            "completed_at": sql_literal(row.get("completed_at")),
        }
        return insert_statement(schema, "instagram_carousel_resolutions", mapping, "ON CONFLICT (source_message_id) DO UPDATE SET " + ", ".join(
            f"{column}=excluded.{column}" for column in mapping if column not in {"id", "source_message_id"}
        ))
    generic_columns = {
        "resources": ["id", "job_id", "name", "slug", "kind", "canonical_url", "summary", "why_useful", "guide_markdown_key", "evidence_json", "created_at", "guide_html_key", "library_path", "artifact_type", "canonical_key", "guide_text", "media_json"],
        "notes": ["id", "sender_id", "body", "source_message_id", "created_at"],
        "dm_commands": ["id", "sender_id", "source_message_id", "intent", "input_text", "normalized_query", "status", "result_job_id", "result_summary", "error", "is_test", "created_at", "completed_at"],
        "outbound_events": ["id", "recipient_id", "source_message_id", "job_id", "kind", "stage", "display_emoji", "reaction", "status", "http_status", "error", "created_at"],
        "pending_dm_parts": ["id", "sender_id", "source_message_id", "kind", "source_url", "instructions", "is_test", "consumed_at", "expires_at", "created_at"],
        "inbound_webhook_events": ["source_message_id", "sender_id", "has_share_attachment", "extracted_urls_json", "raw_json", "recovery_json", "recovered_url", "created_at", "updated_at"],
    }
    columns = generic_columns[table]
    mapping = {
        column: sql_literal(
            row.get(column),
            boolean=column in BOOL_COLUMNS.get(table, set()),
            jsonb=column in {"media_json"},
        )
        for column in columns
    }
    key_column = TABLE_KEY_COLUMNS[table]
    return insert_statement(schema, table, mapping, f"ON CONFLICT ({key_column}) DO UPDATE SET " + ", ".join(
        f"{column}=excluded.{column}" for column in columns if column != key_column
    ))


def receipt_sql(schema: str, table: str, row: dict[str, Any]) -> str:
    key = row_key(table, row)
    mirror_updated_at = row.get("mirror_updated_at") or row.get("updated_at") or row.get("created_at")
    payload_hash = row_sha256(row)
    return insert_statement(schema, "phase4_mirror_row_versions", {
        "table_name": sql_literal(table),
        "source_key": sql_literal(key),
        "mirror_updated_at": sql_literal(mirror_updated_at),
        "row_sha256": sql_literal(payload_hash),
        "row_json": sql_literal(row, jsonb=True),
    }, "ON CONFLICT (table_name, source_key, mirror_updated_at, row_sha256) DO UPDATE SET last_seen_at=now()")


def cursor_sql(schema: str, table: str, watermark: str, cursor: str | None, rows: list[dict[str, Any]]) -> str:
    last = rows[-1] if rows else {}
    last_time = last.get("mirror_updated_at") or None
    last_key = row_key(table, last) if last else None
    return (
        f"UPDATE {schema}.phase4_mirror_cursors SET "
        f"cursor_token={sql_literal(cursor)}, "
        f"last_mirror_updated_at=COALESCE({sql_literal(last_time)}, last_mirror_updated_at), "
        f"last_source_key=COALESCE({sql_literal(last_key)}, last_source_key), "
        f"rows_seen=rows_seen+{len(rows)}, last_poll_at=now(), updated_at=now() "
        f"WHERE table_name={sql_literal(table)} AND watermark={sql_literal(watermark)};"
    )


def object_keys_from_rows(rows_by_table: dict[str, list[dict[str, Any]]]) -> dict[str, dict[str, Any]]:
    objects: dict[str, dict[str, Any]] = {}
    for row in rows_by_table.get("artifacts", []):
        key = row.get("object_key")
        if key:
            objects[str(key)] = {"expected_byte_size": row.get("byte_size"), "expected_sha256": row.get("sha256")}
    for row in rows_by_table.get("jobs", []):
        for column in ["original_video_key", "audio_key", "markdown_key", "transcript_key", "synthesis_json_key", "html_key"]:
            key = row.get(column)
            if key:
                objects.setdefault(str(key), {"expected_byte_size": None, "expected_sha256": None})
    for row in rows_by_table.get("resources", []):
        key = row.get("guide_html_key")
        if key:
            objects.setdefault(str(key), {"expected_byte_size": None, "expected_sha256": None})
    return objects


def object_receipt_sql(schema: str, receipt: dict[str, Any], expected_size: int | None, expected_sha256: str | None) -> str:
    return insert_statement(schema, "phase4_mirror_object_receipts", {
        "object_key": sql_literal(receipt["object_key"]),
        "local_path": sql_literal(receipt["local_path"]),
        "expected_byte_size": sql_literal(expected_size),
        "actual_byte_size": sql_literal(receipt["actual_byte_size"]),
        "expected_sha256": sql_literal(expected_sha256),
        "actual_sha256": sql_literal(receipt["actual_sha256"]),
        "content_type": sql_literal(receipt.get("content_type")),
        "verified": sql_literal(receipt["verified"]),
        "detail": sql_literal(receipt.get("detail")),
    }, "ON CONFLICT (object_key) DO UPDATE SET local_path=excluded.local_path, expected_byte_size=excluded.expected_byte_size, actual_byte_size=excluded.actual_byte_size, expected_sha256=excluded.expected_sha256, actual_sha256=excluded.actual_sha256, content_type=excluded.content_type, downloaded_at=now(), verified=excluded.verified, detail=excluded.detail")


def mirror_once(args: argparse.Namespace) -> dict[str, Any]:
    schema = require_schema_name(args.schema)
    watermark = parse_watermark(args.watermark)
    token = read_token(Path(args.token_file).resolve())
    object_root = Path(args.object_root).resolve()
    run_dir = Path(args.run_dir).resolve()
    run_dir.mkdir(parents=True, exist_ok=True)
    object_root.mkdir(parents=True, exist_ok=True)
    rows_by_table: dict[str, list[dict[str, Any]]] = {}
    sql_parts = ["BEGIN;"]
    total_rows = 0
    for table in MIRROR_TABLES:
        state_path = run_dir / "cursors" / f"{table}.json"
        cursor = None
        if state_path.exists():
            cursor = json.loads(state_path.read_text(encoding="utf-8")).get("cursor")
        payload = fetch_delta(args.base_url, token, watermark, table, cursor, args.limit)
        rows = list(payload.get("rows") or [])
        rows_by_table[table] = rows
        for row in rows:
            sql_parts.append(receipt_sql(schema, table, row))
            sql_parts.append(upsert_typed_sql(schema, table, row))
        next_cursor = payload.get("next_cursor") or cursor
        sql_parts.append(cursor_sql(schema, table, watermark, next_cursor, rows))
        state_path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(state_path, json.dumps({"table": table, "cursor": next_cursor, "watermark": watermark, "updated_at": utc_now()}, indent=2).encode("utf-8"))
        total_rows += len(rows)
    object_count = 0
    for key, expected in sorted(object_keys_from_rows(rows_by_table).items()):
        receipt = download_object(args.base_url, token, watermark, object_root, key, expected.get("expected_byte_size"), expected.get("expected_sha256"))
        sql_parts.append(object_receipt_sql(schema, receipt, expected.get("expected_byte_size"), expected.get("expected_sha256")))
        object_count += 1
        if not receipt["verified"]:
            sql_parts.append(insert_statement(schema, "phase4_mirror_divergences", {
                "surface": sql_literal("object"),
                "object_key": sql_literal(key),
                "detail": sql_literal(receipt["detail"]),
                "expected_json": sql_literal(expected, jsonb=True),
                "actual_json": sql_literal(receipt, jsonb=True),
            }, ""))
    sql_parts.append("COMMIT;")
    run_psql("\n".join(sql_parts), args.psql_command)
    report = {
        "ok": True,
        "schema": schema,
        "watermark": watermark,
        "rows": total_rows,
        "objects_checked": object_count,
        "created_at": utc_now(),
    }
    atomic_write(run_dir / "last-poll.json", json.dumps(report, indent=2).encode("utf-8"))
    return report


def mirror_loop(args: argparse.Namespace) -> None:
    while True:
        try:
            report = mirror_once(args)
            print(json.dumps(report, sort_keys=True), flush=True)
        except Exception as error:  # noqa: BLE001 - operator evidence should capture exact failure
            print(json.dumps({"ok": False, "error": str(error), "created_at": utc_now()}, sort_keys=True), flush=True)
        time.sleep(args.interval_seconds)


def verify_no_mutation_surface(args: argparse.Namespace) -> None:
    source = Path(__file__).read_text(encoding="utf-8")
    forbidden = [
        "P" + "UT",
        "P" + "ATCH",
        "D" + "ELETE",
        "REEL" + "_QUEUE",
        "ADMIN" + "_TOKEN",
        "/api/" + "backlog",
        "/api/" + "intake",
    ]
    hits = [term for term in forbidden if term in source]
    if hits:
        raise SystemExit(f"Unexpected mutation/admin surface strings in mirror script: {hits}")
    if 'method="GET"' not in source:
        raise SystemExit("Mirror requests must be GET-only")
    if "/api/phase4/mirror/delta" not in source or "/api/phase4/mirror/object" not in source:
        raise SystemExit("Mirror script must use only the Phase 4 mirror endpoints")
    print(json.dumps({"ok": True, "checked": "phase4_shadow_mirror.py"}, indent=2))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--psql-command", default=DEFAULT_PSQL_COMMAND)
    subcommands = parser.add_subparsers(required=True)

    init = subcommands.add_parser("init-schema")
    init.add_argument("--schema", required=True)
    init.add_argument("--watermark", required=True)
    init.add_argument("--run-dir", required=True)
    init.add_argument("--migrations-dir", default=str(Path(__file__).resolve().parent.parent / "migrations"))
    init.add_argument("--output")
    init.set_defaults(func=init_schema)

    poll = subcommands.add_parser("poll-once")
    poll.add_argument("--schema", required=True)
    poll.add_argument("--watermark", required=True)
    poll.add_argument("--run-dir", required=True)
    poll.add_argument("--object-root", required=True)
    poll.add_argument("--token-file", required=True)
    poll.add_argument("--base-url", default=DEFAULT_BASE_URL)
    poll.add_argument("--limit", type=int, default=100)
    poll.set_defaults(func=lambda args: print(json.dumps(mirror_once(args), indent=2)))

    loop = subcommands.add_parser("loop")
    loop.add_argument("--schema", required=True)
    loop.add_argument("--watermark", required=True)
    loop.add_argument("--run-dir", required=True)
    loop.add_argument("--object-root", required=True)
    loop.add_argument("--token-file", required=True)
    loop.add_argument("--base-url", default=DEFAULT_BASE_URL)
    loop.add_argument("--limit", type=int, default=100)
    loop.add_argument("--interval-seconds", type=int, default=300)
    loop.set_defaults(func=mirror_loop)

    static = subcommands.add_parser("static-audit")
    static.set_defaults(func=verify_no_mutation_surface)

    args = parser.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
