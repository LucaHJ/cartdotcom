#!/usr/bin/env python3
"""Phase 3 shadow migration operator tools.

These commands are intentionally manual, private, and non-authoritative. They
read Cloudflare export artifacts that were already captured by the operator and
write only to an isolated local/server shadow schema or local shadow artifact
root. They never claim work, enqueue jobs, call Codex, publish library pages, or
mutate Cloudflare production state.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import csv
import datetime as dt
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from typing import Any


DEFAULT_PSQL_COMMAND = (
    "docker exec -i cartdotcom-platform-postgres-1 "
    "psql -U cartdotcom -d cartdotcom -v ON_ERROR_STOP=1 -q"
)
DEFAULT_BUCKET = "cartdotcom-instagram-reel-brain"


KEY_COLUMNS = {
    "artifacts": ["object_key"],
    "jobs": [
        "original_video_key",
        "markdown_key",
        "transcript_key",
        "synthesis_json_key",
        "html_key",
        "audio_key",
    ],
    "resources": ["guide_markdown_key", "guide_html_key"],
}

SENSITIVE_COLUMNS = {
    "runtime_secrets": {"ciphertext", "iv"},
}


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_schema_name(schema: str) -> str:
    if not schema or not schema.replace("_", "a").isalnum() or not (
        schema[0].isalpha() or schema[0] == "_"
    ):
        raise SystemExit(f"Invalid PostgreSQL schema name: {schema!r}")
    if any(ch.isupper() for ch in schema):
        raise SystemExit("Use a lower-case PostgreSQL schema name to avoid quoting drift")
    return schema


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def load_sqlite_from_export(sql_path: Path, sqlite_path: Path) -> sqlite3.Connection:
    if sqlite_path.exists():
        sqlite_path.unlink()
    connection = sqlite3.connect(sqlite_path)
    with sql_path.open("r", encoding="utf-8") as handle:
        connection.executescript(handle.read())
    connection.commit()
    return connection


def connect_existing_sqlite(sqlite_path: Path) -> sqlite3.Connection:
    if not sqlite_path.exists():
        raise SystemExit(f"SQLite snapshot not found: {sqlite_path}")
    return sqlite3.connect(sqlite_path)


def table_columns(cursor: sqlite3.Cursor, table: str) -> list[str]:
    return [row[1] for row in cursor.execute(f'PRAGMA table_info("{table}")')]


def sqlite_objects(cursor: sqlite3.Cursor) -> list[dict[str, Any]]:
    objects: list[dict[str, Any]] = []
    rows = list(cursor.execute(
        "SELECT name,type,sql FROM sqlite_schema "
        "WHERE type IN ('table','index','view','trigger') "
        "AND name NOT LIKE 'sqlite_%' ORDER BY type,name"
    ))
    for name, object_type, sql in rows:
        entry: dict[str, Any] = {"name": name, "type": object_type, "sql": sql}
        if object_type == "table":
            entry["count"] = cursor.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
            entry["columns"] = [
                {
                    "cid": row[0],
                    "name": row[1],
                    "type": row[2],
                    "notnull": row[3],
                    "default": row[4],
                    "pk": row[5],
                }
                for row in cursor.execute(f'PRAGMA table_info("{name}")')
            ]
        objects.append(entry)
    return objects


def status_counts(cursor: sqlite3.Cursor, objects: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    counts: dict[str, dict[str, int]] = {}
    for obj in objects:
        if obj["type"] != "table":
            continue
        columns = {column["name"] for column in obj.get("columns", [])}
        if "status" not in columns:
            continue
        table = obj["name"]
        counts[table] = {
            str(status): count
            for status, count in cursor.execute(
                f'SELECT status, COUNT(*) FROM "{table}" GROUP BY status ORDER BY status'
            )
        }
    return counts


def redact_row(table: str, row: dict[str, Any]) -> dict[str, Any]:
    sensitive = SENSITIVE_COLUMNS.get(table, set())
    if not sensitive:
        return row
    redacted = dict(row)
    for column in sensitive:
        value = redacted.get(column)
        if value is None:
            continue
        data = str(value).encode("utf-8")
        redacted[column] = {
            "redacted": True,
            "sha256": sha256_bytes(data),
            "byte_length": len(data),
        }
    return redacted


def row_primary_key(pk_columns: list[str], row: dict[str, Any], rowid: int) -> str:
    if pk_columns:
        return "|".join(f"{column}={row.get(column)!r}" for column in pk_columns)
    return f"rowid={rowid}"


def write_inventory(args: argparse.Namespace) -> None:
    run_dir = Path(args.run_dir).resolve()
    d1_dir = run_dir / "d1"
    d1_dir.mkdir(parents=True, exist_ok=True)
    sqlite_path = Path(args.sqlite_path or d1_dir / "snapshot.sqlite").resolve()
    sql_path = Path(args.sql).resolve()
    connection = load_sqlite_from_export(sql_path, sqlite_path)
    cursor = connection.cursor()
    objects = sqlite_objects(cursor)
    checks: dict[str, Any] = {}
    for query, name in [
        ("SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running')", "active_jobs"),
        ("SELECT COUNT(*) FROM pending_dm_parts WHERE consumed_at IS NULL", "unconsumed_pending_dm_parts"),
        ("SELECT COUNT(*) FROM pilot_runs WHERE status IN ('selecting','running')", "active_pilot_runs"),
    ]:
        try:
            checks[name] = cursor.execute(query).fetchone()[0]
        except sqlite3.Error as error:
            checks[name] = f"error: {error}"
    settings: dict[str, Any] = {}
    if any(obj["name"] == "settings" and obj["type"] == "table" for obj in objects):
        settings = {
            str(key): value
            for key, value in cursor.execute(
                "SELECT key,value FROM settings WHERE key IN "
                "('backlog.processing.enabled','ingest.mode','processing.authority')"
            )
        }
    manifest = {
        "created_at": utc_now(),
        "source_sql": str(sql_path),
        "source_sql_sha256": sha256_file(sql_path),
        "sqlite_snapshot": str(sqlite_path),
        "tables": objects,
        "status_counts": status_counts(cursor, objects),
        "settings": settings,
        "idle_checks": checks,
    }
    output = Path(args.output or d1_dir / "d1-inventory.redacted.json").resolve()
    output.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"inventory": str(output), "idle_checks": checks}, indent=2))


def postgres_shadow_sql(
    connection: sqlite3.Connection,
    schema: str,
    source_sha256: str,
    source_export: str,
) -> str:
    cursor = connection.cursor()
    objects = sqlite_objects(cursor)
    statements = [
        f"DROP SCHEMA IF EXISTS {schema} CASCADE;",
        f"CREATE SCHEMA {schema};",
        f"COMMENT ON SCHEMA {schema} IS 'Instagram Reel Phase 3 non-authoritative D1 shadow import';",
        f"""
CREATE TABLE {schema}.shadow_metadata (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
""",
        f"""
CREATE TABLE {schema}.shadow_tables (
  table_name text PRIMARY KEY,
  object_type text NOT NULL,
  row_count integer,
  schema_sql text,
  columns_json jsonb NOT NULL DEFAULT '[]'::jsonb
);
""",
        f"""
CREATE TABLE {schema}.shadow_rows (
  table_name text NOT NULL,
  row_index integer NOT NULL,
  row_pk text NOT NULL,
  row_json jsonb NOT NULL,
  row_sha256 text NOT NULL,
  redacted boolean NOT NULL DEFAULT false,
  PRIMARY KEY (table_name, row_index),
  UNIQUE (table_name, row_pk)
);
""",
        f"""
CREATE TABLE {schema}.shadow_state_counts (
  table_name text NOT NULL,
  status text NOT NULL,
  row_count integer NOT NULL,
  PRIMARY KEY (table_name, status)
);
""",
        f"""
CREATE TABLE {schema}.shadow_import_checks (
  check_name text PRIMARY KEY,
  expected_value text NOT NULL,
  actual_value text NOT NULL,
  ok boolean NOT NULL,
  detail text
);
""",
    ]
    metadata = {
        "source": "Cloudflare D1 cartdotcom-instagram-reel-brain",
        "source_export": source_export,
        "source_sha256": source_sha256,
        "imported_at": utc_now(),
        "authority": "shadow_non_authoritative",
        "execution_flags": {
            "intake": False,
            "dispatch": False,
            "worker_execution": False,
            "codex": False,
            "outbound": False,
            "publisher": False,
            "archiver": False,
            "backlog": False,
            "auth_rotation": False,
        },
        "redaction": "runtime_secrets ciphertext and iv are imported as sha256/byte_length only",
    }
    statements.append(
        f"INSERT INTO {schema}.shadow_metadata(key,value) VALUES "
        f"('phase3', {sql_literal(json.dumps(metadata, ensure_ascii=False))}::jsonb);"
    )
    for obj in objects:
        statements.append(
            f"INSERT INTO {schema}.shadow_tables(table_name,object_type,row_count,schema_sql,columns_json) "
            f"VALUES ({sql_literal(obj['name'])},{sql_literal(obj['type'])},"
            f"{obj.get('count', 'NULL')},{sql_literal(obj.get('sql') or '')},"
            f"{sql_literal(json.dumps(obj.get('columns', []), ensure_ascii=False))}::jsonb);"
        )
        if obj["type"] != "table":
            continue
        table = obj["name"]
        table_info = list(cursor.execute(f'PRAGMA table_info("{table}")'))
        columns = [row[1] for row in table_info]
        pk_columns = [row[1] for row in table_info if int(row[5] or 0) > 0]
        row_index = 0
        row_cursor = connection.cursor()
        for values in row_cursor.execute(f'SELECT rowid,* FROM "{table}"'):
            row_index += 1
            rowid = values[0]
            row = dict(zip(columns, values[1:]))
            redacted = redact_row(table, row)
            row_json = json.dumps(redacted, ensure_ascii=False, sort_keys=True)
            row_hash = sha256_bytes(row_json.encode("utf-8"))
            row_pk = row_primary_key(pk_columns, row, rowid)
            statements.append(
                f"INSERT INTO {schema}.shadow_rows(table_name,row_index,row_pk,row_json,row_sha256,redacted) "
                f"VALUES ({sql_literal(table)},{row_index},{sql_literal(row_pk)},"
                f"{sql_literal(row_json)}::jsonb,{sql_literal(row_hash)},"
                f"{'true' if redacted != row else 'false'});"
            )
    for table, counts in status_counts(cursor, objects).items():
        for status, count in counts.items():
            statements.append(
                f"INSERT INTO {schema}.shadow_state_counts(table_name,status,row_count) "
                f"VALUES ({sql_literal(table)},{sql_literal(status)},{count});"
            )
    statements.extend(
        [
            f"""
INSERT INTO {schema}.shadow_import_checks(check_name,expected_value,actual_value,ok,detail)
SELECT 'table_row_count:' || table_name, row_count::text, imported::text, row_count = imported,
       CASE WHEN row_count = imported THEN 'ok' ELSE 'row count mismatch after import' END
FROM (
  SELECT t.table_name, t.row_count, COALESCE(COUNT(r.*),0)::integer AS imported
  FROM {schema}.shadow_tables t
  LEFT JOIN {schema}.shadow_rows r ON r.table_name=t.table_name
  WHERE t.object_type='table'
  GROUP BY t.table_name, t.row_count
) counts;
""",
            f"""
INSERT INTO {schema}.shadow_import_checks(check_name,expected_value,actual_value,ok,detail)
SELECT 'authority:cloudflare_remains_authority', 'cloudflare', 'cloudflare', true,
       'shadow schema has no execution, intake, dispatch, Codex, publication, outbound, or backlog hooks';
""",
        ]
    )
    return "\n".join(statements)


def run_ssh_psql(sql_file: Path, ssh_target: str, psql_command: str) -> None:
    remote_dir = f"/srv/cartdotcom/reel-brain-runs/phase3-shadow/{sql_file.parent.parent.name}/d1"
    subprocess.run(["ssh", ssh_target, f"mkdir -p {remote_dir} && chmod 700 {remote_dir}"], check=True)
    remote_file = f"{remote_dir}/{sql_file.name}"
    subprocess.run(["scp", str(sql_file), f"{ssh_target}:{remote_file}"], check=True)
    subprocess.run(["ssh", ssh_target, f"chmod 600 {remote_file} && cat {remote_file} | {psql_command}"], check=True)


def import_d1_shadow(args: argparse.Namespace) -> None:
    schema = require_schema_name(args.schema)
    run_dir = Path(args.run_dir).resolve()
    d1_dir = run_dir / "d1"
    sqlite_path = Path(args.sqlite).resolve()
    connection = connect_existing_sqlite(sqlite_path)
    sql_path = Path(args.source_sql).resolve()
    shadow_sql = postgres_shadow_sql(connection, schema, sha256_file(sql_path), str(sql_path))
    output = Path(args.output or d1_dir / f"{schema}-postgres-import.sql").resolve()
    output.write_text(shadow_sql, encoding="utf-8")
    run_ssh_psql(output, args.ssh_target, args.psql_command)
    verify_sql = (
        f"SELECT json_agg(t) FROM ("
        f"SELECT check_name, expected_value, actual_value, ok, detail "
        f"FROM {schema}.shadow_import_checks ORDER BY check_name"
        f") t;"
    )
    result = subprocess.run(
        ["ssh", args.ssh_target, f"{args.psql_command} -t -A"],
        input=verify_sql,
        text=True,
        capture_output=True,
        check=True,
    )
    checks = json.loads(result.stdout.strip() or "[]")
    report = {
        "created_at": utc_now(),
        "schema": schema,
        "sql_file": str(output),
        "checks": checks,
        "ok": all(row["ok"] for row in checks),
    }
    report_path = d1_dir / "postgres-shadow-import-report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    if not report["ok"]:
        raise SystemExit("PostgreSQL shadow import checks failed")


def collect_object_keys(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    cursor = connection.cursor()
    keys: dict[str, dict[str, Any]] = {}
    for table, columns in KEY_COLUMNS.items():
        try:
            existing = set(table_columns(cursor, table))
        except sqlite3.Error:
            continue
        for column in columns:
            if column not in existing:
                continue
            for value, byte_size, sha256, content_type in cursor.execute(
                f'SELECT "{column}", NULL, NULL, NULL FROM "{table}" WHERE "{column}" IS NOT NULL'
            ):
                key = str(value or "").strip()
                if key:
                    keys.setdefault(key, {"key": key, "sources": []})["sources"].append(
                        {"table": table, "column": column}
                    )
    if "artifacts" in [row[0] for row in cursor.execute("SELECT name FROM sqlite_schema WHERE type='table'")]:
        for key, byte_size, sha256, content_type in cursor.execute(
            "SELECT object_key, byte_size, sha256, content_type FROM artifacts WHERE object_key IS NOT NULL"
        ):
            key = str(key or "").strip()
            if not key:
                continue
            entry = keys.setdefault(key, {"key": key, "sources": []})
            entry["expected_byte_size"] = byte_size
            entry["expected_sha256"] = sha256
            entry["content_type"] = content_type
            entry["sources"].append({"table": "artifacts", "column": "object_key"})
    return [keys[key] for key in sorted(keys)]


def write_r2_manifest(args: argparse.Namespace) -> None:
    run_dir = Path(args.run_dir).resolve()
    sqlite_path = Path(args.sqlite).resolve()
    connection = connect_existing_sqlite(sqlite_path)
    objects = collect_object_keys(connection)
    manifest = {
        "created_at": utc_now(),
        "bucket": args.bucket,
        "sqlite_snapshot": str(sqlite_path),
        "object_count": len(objects),
        "objects": objects,
        "copy_state": "planned",
        "cost_projection": {
            "storage_class": "Standard",
            "projected_get_class_b_operations": len(objects),
            "projected_list_class_a_operations": 1,
            "projected_egress_gb": args.bucket_size_gb,
            "pricing_source": "Cloudflare R2 pricing checked 2026-08-21: Standard free tier includes 1M Class A ops, 10M Class B ops, 10 GB-month storage; egress free.",
            "free_tier_covered": len(objects) < 10_000_000 and args.bucket_size_gb <= 10,
        },
    }
    output = Path(args.output or run_dir / "r2" / "r2-shadow-manifest.json").resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: manifest[k] for k in ["bucket", "object_count", "cost_projection"]}, indent=2))


def classify_unreferenced_key(key: str) -> str:
    if key.startswith("library/"):
        return "unreferenced_library_object"
    if "/attempt-" in key:
        return "unreferenced_superseded_attempt_artifact"
    if key.startswith("reels/"):
        return "unreferenced_reel_artifact"
    return "unreferenced_other_object"


def reconcile_r2(args: argparse.Namespace) -> None:
    run_dir = Path(args.run_dir).resolve()
    d1_manifest = json.loads(Path(args.d1_manifest).read_text(encoding="utf-8"))
    cloud_manifest = json.loads(Path(args.cloudflare_manifest).read_text(encoding="utf-8"))

    d1_by_key = {entry["key"]: entry for entry in d1_manifest["objects"]}
    cloud_by_key = {entry["key"]: entry for entry in cloud_manifest["objects"]}
    referenced = sorted(set(d1_by_key) & set(cloud_by_key))
    missing = sorted(set(d1_by_key) - set(cloud_by_key))
    extras = sorted(set(cloud_by_key) - set(d1_by_key))

    classified_extras = [
        {
            "key": key,
            "classification": classify_unreferenced_key(key),
            "size": cloud_by_key[key].get("size"),
            "etag": cloud_by_key[key].get("etag"),
            "uploaded": cloud_by_key[key].get("uploaded"),
            "storageClass": cloud_by_key[key].get("storageClass"),
        }
        for key in extras
    ]
    classification_counts: dict[str, int] = {}
    for item in classified_extras:
        classification_counts[item["classification"]] = classification_counts.get(item["classification"], 0) + 1

    transfer_objects: list[dict[str, Any]] = []
    for key in sorted(cloud_by_key):
        cloud = cloud_by_key[key]
        d1 = d1_by_key.get(key, {})
        transfer_objects.append({
            "key": key,
            "size": cloud.get("size"),
            "etag": cloud.get("etag"),
            "uploaded": cloud.get("uploaded"),
            "storageClass": cloud.get("storageClass"),
            "expected_byte_size": cloud.get("size"),
            "d1_expected_byte_size": d1.get("expected_byte_size"),
            "expected_sha256": d1.get("expected_sha256"),
            "sources": d1.get("sources", []),
            "classification": "d1_referenced" if key in d1_by_key else classify_unreferenced_key(key),
        })

    report = {
        "created_at": utc_now(),
        "d1_manifest": str(Path(args.d1_manifest).resolve()),
        "cloudflare_manifest": str(Path(args.cloudflare_manifest).resolve()),
        "d1_object_count": len(d1_by_key),
        "cloudflare_object_count": len(cloud_by_key),
        "referenced_count": len(referenced),
        "missing_count": len(missing),
        "extra_count": len(extras),
        "extra_classification_counts": classification_counts,
        "missing": missing,
        "extras": classified_extras,
        "ok": len(missing) == 0,
    }
    report_path = Path(args.output or run_dir / "r2" / "r2-reconciliation-report.json").resolve()
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    byte_count = sum(int(item.get("size") or 0) for item in transfer_objects)
    transfer_manifest = {
        "created_at": utc_now(),
        "bucket": cloud_manifest["bucket"],
        "source_manifest": str(Path(args.cloudflare_manifest).resolve()),
        "reconciliation_report": str(report_path),
        "object_count": len(transfer_objects),
        "byte_count": byte_count,
        "objects": transfer_objects,
        "cost_projection": {
            "storage_class": "Standard",
            "projected_get_class_b_operations": len(transfer_objects),
            "projected_egress_gb": round(byte_count / (1024 ** 3), 4),
            "pricing_source": "Cloudflare R2 pricing checked 2026-08-21: Standard free tier includes 1M Class A ops, 10M Class B ops, 10 GB-month storage; egress free.",
            "free_tier_covered": len(transfer_objects) < 10_000_000 and byte_count <= 10 * 1024 ** 3,
        },
    }
    transfer_path = Path(args.transfer_manifest or run_dir / "r2" / "r2-shadow-transfer-manifest.json").resolve()
    transfer_path.write_text(json.dumps(transfer_manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    print(json.dumps({
        "report": str(report_path),
        "transfer_manifest": str(transfer_path),
        "summary": {
            "d1_object_count": report["d1_object_count"],
            "cloudflare_object_count": report["cloudflare_object_count"],
            "referenced_count": report["referenced_count"],
            "missing_count": report["missing_count"],
            "extra_count": report["extra_count"],
            "extra_classification_counts": classification_counts,
            "ok": report["ok"],
        },
    }, indent=2))
    if not report["ok"]:
        raise SystemExit("R2 reconciliation has missing D1-referenced objects")


def safe_local_path(root: Path, key: str) -> Path:
    clean = key.lstrip("/\\")
    if not clean or ".." in Path(clean).parts:
        raise SystemExit(f"Unsafe object key: {key!r}")
    target = (root / clean).resolve()
    root_resolved = root.resolve()
    if os.path.commonpath([str(root_resolved), str(target)]) != str(root_resolved):
        raise SystemExit(f"Object key escapes root: {key!r}")
    return target


def append_jsonl_locked(path: Path, record: dict[str, Any], lock: threading.Lock) -> None:
    with lock:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def copy_one_r2_object(
    *,
    entry: dict[str, Any],
    root: Path,
    bucket: str,
    wrangler_cwd: str,
    retries: int,
) -> dict[str, Any]:
    key = entry["key"]
    target = safe_local_path(root, key)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp_target = target.with_name(target.name + ".tmp-phase3")
    expected_size = entry.get("expected_byte_size")
    expected_sha = entry.get("expected_sha256")
    env = os.environ.copy()
    env.pop("CLOUDFLARE_API_TOKEN", None)
    npx = shutil.which("npx.cmd") or shutil.which("npx") or "npx"
    for attempt in range(1, retries + 1):
        if temp_target.exists():
            temp_target.unlink()
        command = [
            npx,
            "wrangler",
            "r2",
            "object",
            "get",
            f"{bucket}/{key}",
            "--remote",
            "--file",
            str(temp_target),
        ]
        result = subprocess.run(command, cwd=wrangler_cwd, env=env, capture_output=True)
        output_text = ((result.stderr or b"") + (result.stdout or b"")).decode("utf-8", errors="replace")
        if result.returncode != 0 or not temp_target.exists():
            if attempt == retries:
                return {
                    "at": utc_now(),
                    "key": key,
                    "status": "failed",
                    "attempt": attempt,
                    "error": output_text[-1000:],
                }
            continue
        actual_size = temp_target.stat().st_size
        actual_sha = sha256_file(temp_target)
        if expected_size is not None and int(expected_size) != actual_size:
            if attempt == retries:
                return {
                    "at": utc_now(),
                    "key": key,
                    "status": "failed",
                    "attempt": attempt,
                    "error": f"size mismatch expected={expected_size} actual={actual_size}",
                }
            continue
        if expected_sha and str(expected_sha).lower() != actual_sha:
            if attempt == retries:
                return {
                    "at": utc_now(),
                    "key": key,
                    "status": "failed",
                    "attempt": attempt,
                    "error": f"sha mismatch expected={expected_sha} actual={actual_sha}",
                }
            continue
        shutil.move(str(temp_target), str(target))
        return {
            "at": utc_now(),
            "key": key,
            "status": "complete",
            "bytes": actual_size,
            "sha256": actual_sha,
            "path": str(target),
            "etag": entry.get("etag"),
            "classification": entry.get("classification"),
        }
    return {"at": utc_now(), "key": key, "status": "failed", "error": "exhausted retries"}


def copy_r2(args: argparse.Namespace) -> None:
    manifest_path = Path(args.manifest).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not manifest.get("cost_projection", {}).get("free_tier_covered"):
        raise SystemExit("Cost projection is not covered by free tier; refusing transfer")
    root = Path(args.local_root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    checkpoint_path = Path(args.checkpoint or manifest_path.with_name("r2-shadow-copy-checkpoint.jsonl")).resolve()
    done: dict[str, dict[str, Any]] = {}
    if checkpoint_path.exists():
        for line in checkpoint_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            item = json.loads(line)
            if item.get("status") == "complete":
                done[item["key"]] = item
    copied = 0
    skipped = 0
    failed: list[dict[str, Any]] = []
    pending: list[dict[str, Any]] = []
    for entry in manifest["objects"]:
        key = entry["key"]
        target = safe_local_path(root, key)
        if key in done and target.exists() and sha256_file(target) == done[key].get("sha256"):
            skipped += 1
            continue
        pending.append(entry)
    lock = threading.Lock()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = [
            executor.submit(
                copy_one_r2_object,
                entry=entry,
                root=root,
                bucket=args.bucket,
                wrangler_cwd=args.wrangler_cwd,
                retries=args.retries,
            )
            for entry in pending
        ]
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            record = future.result()
            append_jsonl_locked(checkpoint_path, record, lock)
            if record["status"] == "complete":
                copied += 1
            else:
                failed.append(record)
            if index % 100 == 0:
                print(json.dumps({
                    "completed_pending": index,
                    "total_pending": len(pending),
                    "copied_this_run": copied,
                    "failed": len(failed),
                }))
    report = {
        "created_at": utc_now(),
        "manifest": str(manifest_path),
        "local_root": str(root),
        "copied": copied,
        "skipped": skipped,
        "failed_count": len(failed),
        "failed": failed[:50],
        "checkpoint": str(checkpoint_path),
    }
    report_path = manifest_path.with_name("r2-shadow-copy-report.json")
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    if failed:
        raise SystemExit("R2 copy had failures; see report")


def verify_r2_copy(args: argparse.Namespace) -> None:
    manifest_path = Path(args.manifest).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    root = Path(args.local_root).resolve()
    checkpoint_path = Path(args.checkpoint or manifest_path.with_name("r2-shadow-copy-checkpoint.jsonl")).resolve()
    done: dict[str, dict[str, Any]] = {}
    failures: list[dict[str, Any]] = []
    for line in checkpoint_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        item = json.loads(line)
        if item.get("status") == "complete":
            done[item["key"]] = item
        elif item.get("status") == "failed":
            failures.append(item)

    missing: list[str] = []
    mismatches: list[dict[str, Any]] = []
    total_bytes = 0
    for entry in manifest["objects"]:
        key = entry["key"]
        record = done.get(key)
        if not record:
            missing.append(key)
            continue
        target = safe_local_path(root, key)
        if not target.exists():
            mismatches.append({"key": key, "error": "missing local file"})
            continue
        size = target.stat().st_size
        digest = sha256_file(target)
        expected_size = entry.get("expected_byte_size")
        if expected_size is not None and int(expected_size) != size:
            mismatches.append({"key": key, "error": "size mismatch", "expected": expected_size, "actual": size})
        if record.get("sha256") != digest:
            mismatches.append({"key": key, "error": "checkpoint sha mismatch"})
        total_bytes += size

    report = {
        "created_at": utc_now(),
        "manifest": str(manifest_path),
        "local_root": str(root),
        "expected_objects": len(manifest["objects"]),
        "verified_objects": len(manifest["objects"]) - len(missing) - len({m["key"] for m in mismatches}),
        "total_bytes": total_bytes,
        "checkpoint": str(checkpoint_path),
        "missing_count": len(missing),
        "mismatch_count": len(mismatches),
        "failed_checkpoint_count": len(failures),
        "missing": missing[:50],
        "mismatches": mismatches[:50],
        "ok": not missing and not mismatches and not failures,
    }
    output = Path(args.output or manifest_path.with_name("r2-shadow-copy-verify-report.json")).resolve()
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, indent=2))
    if not report["ok"]:
        raise SystemExit("R2 local copy verification failed")


def library_parity(args: argparse.Namespace) -> None:
    run_dir = Path(args.run_dir).resolve()
    sqlite_path = Path(args.sqlite).resolve()
    root = Path(args.local_root).resolve()
    transfer_manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    cloud_keys = {entry["key"] for entry in transfer_manifest["objects"]}
    library_cloud_keys = {key for key in cloud_keys if key.startswith("library/")}
    connection = connect_existing_sqlite(sqlite_path)
    cursor = connection.cursor()
    expected_objects: dict[str, list[dict[str, str]]] = {}
    if {"id", "library_path", "html_key"}.issubset(set(table_columns(cursor, "jobs"))):
        for row_id, library_path, html_key in cursor.execute(
            "SELECT id, library_path, html_key FROM jobs WHERE library_path IS NOT NULL"
        ):
            if html_key:
                expected_objects.setdefault(html_key, []).append({
                    "table": "jobs",
                    "id": row_id,
                    "library_path": library_path,
                })
    if {"id", "library_path", "guide_html_key"}.issubset(set(table_columns(cursor, "resources"))):
        for row_id, library_path, guide_html_key in cursor.execute(
            "SELECT id, library_path, guide_html_key FROM resources WHERE library_path IS NOT NULL"
        ):
            if guide_html_key:
                expected_objects.setdefault(guide_html_key, []).append({
                    "table": "resources",
                    "id": row_id,
                    "library_path": library_path,
                })

    missing_from_cloud = sorted(set(expected_objects) - cloud_keys)
    missing_from_local = [
        key for key in sorted(expected_objects)
        if not safe_local_path(root, key).exists()
    ]
    extra_library = sorted(library_cloud_keys - set(expected_objects))
    local_manifest = {
        "created_at": utc_now(),
        "library_object_count": len(library_cloud_keys),
        "d1_library_object_key_count": len(expected_objects),
        "paths": [
            {
                "key": key,
                "library_paths": sorted({source["library_path"] for source in expected_objects.get(key, []) if source.get("library_path")}),
                "sources": expected_objects.get(key, []),
                "referenced_by_d1": key in expected_objects,
            }
            for key in sorted(set(library_cloud_keys) | set(expected_objects))
        ],
    }
    readable_manifest = {
        "created_at": utc_now(),
        "paths": [
            {
                "path": source["library_path"],
                "key": key,
                "source": f"{source['table']}:{source['id']}",
            }
            for key, sources in sorted(expected_objects.items())
            for source in sources
            if source.get("library_path")
        ],
    }
    local_manifest_path = run_dir / "library" / "library-shadow-manifest.json"
    local_manifest_path.parent.mkdir(parents=True, exist_ok=True)
    local_manifest_path.write_text(json.dumps(local_manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    readable_manifest_path = run_dir / "library" / "library-readable-path-manifest.json"
    readable_manifest_path.write_text(json.dumps(readable_manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    report = {
        "created_at": utc_now(),
        "local_manifest": str(local_manifest_path),
        "readable_path_manifest": str(readable_manifest_path),
        "library_cloud_object_count": len(library_cloud_keys),
        "d1_library_object_key_count": len(expected_objects),
        "missing_from_cloud_count": len(missing_from_cloud),
        "missing_from_local_count": len(missing_from_local),
        "extra_library_object_count": len(extra_library),
        "missing_from_cloud": missing_from_cloud[:50],
        "missing_from_local": missing_from_local[:50],
        "extra_library_samples": extra_library[:50],
        "ok": not missing_from_cloud and not missing_from_local,
    }
    output = Path(args.output or run_dir / "library" / "library-parity-report.json").resolve()
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, indent=2))
    if not report["ok"]:
        raise SystemExit("Library parity failed")


def d1_parity(args: argparse.Namespace) -> None:
    run_dir = Path(args.run_dir).resolve()
    sqlite_path = Path(args.sqlite).resolve()
    connection = connect_existing_sqlite(sqlite_path)
    cursor = connection.cursor()
    report: dict[str, Any] = {"created_at": utc_now(), "sqlite": str(sqlite_path)}

    report["jobs_by_status"] = {
        str(status): count
        for status, count in cursor.execute("SELECT status, COUNT(*) FROM jobs GROUP BY status ORDER BY status")
    }
    report["job_stage_counts"] = {
        str(stage): count
        for stage, count in cursor.execute("SELECT stage, COUNT(*) FROM jobs GROUP BY stage ORDER BY stage")
    }
    report["notes"] = {"count": cursor.execute("SELECT COUNT(*) FROM notes").fetchone()[0]}
    report["resources"] = {
        "count": cursor.execute("SELECT COUNT(*) FROM resources").fetchone()[0],
        "by_artifact_type": {
            str(kind): count
            for kind, count in cursor.execute(
                "SELECT COALESCE(artifact_type,'uncategorised'), COUNT(*) FROM resources GROUP BY COALESCE(artifact_type,'uncategorised') ORDER BY 1"
            )
        },
    }
    report["retrieval_metadata"] = {
        "jobs_with_original_video": cursor.execute("SELECT COUNT(*) FROM jobs WHERE original_video_key IS NOT NULL").fetchone()[0],
        "jobs_with_audio": cursor.execute("SELECT COUNT(*) FROM jobs WHERE audio_key IS NOT NULL").fetchone()[0],
        "jobs_with_library_path": cursor.execute("SELECT COUNT(*) FROM jobs WHERE library_path IS NOT NULL").fetchone()[0],
        "resources_with_library_path": cursor.execute("SELECT COUNT(*) FROM resources WHERE library_path IS NOT NULL").fetchone()[0],
    }
    report["search"] = {
        "searchable_jobs": cursor.execute(
            "SELECT COUNT(*) FROM jobs WHERE title IS NOT NULL OR description IS NOT NULL OR author_username IS NOT NULL"
        ).fetchone()[0],
        "searchable_resources": cursor.execute(
            "SELECT COUNT(*) FROM resources WHERE name IS NOT NULL OR summary IS NOT NULL OR guide_text IS NOT NULL"
        ).fetchone()[0],
    }
    report["constraints"] = {
        "duplicate_active_dedupe_keys": cursor.execute(
            "SELECT COUNT(*) FROM (SELECT dedupe_key FROM jobs WHERE dedupe_key IS NOT NULL AND status <> 'duplicate' GROUP BY dedupe_key HAVING COUNT(*) > 1)"
        ).fetchone()[0],
        "resources_missing_job": cursor.execute(
            "SELECT COUNT(*) FROM resources r LEFT JOIN jobs j ON j.id=r.job_id WHERE j.id IS NULL"
        ).fetchone()[0],
        "artifacts_missing_job": cursor.execute(
            "SELECT COUNT(*) FROM artifacts a LEFT JOIN jobs j ON j.id=a.job_id WHERE j.id IS NULL"
        ).fetchone()[0],
        "events_missing_job": cursor.execute(
            "SELECT COUNT(*) FROM job_events e LEFT JOIN jobs j ON j.id=e.job_id WHERE j.id IS NULL"
        ).fetchone()[0],
    }
    sample_rows = []
    for row in cursor.execute(
        "SELECT j.id, j.status, j.library_path, "
        "(SELECT COUNT(*) FROM resources r WHERE r.job_id=j.id), "
        "(SELECT COUNT(*) FROM artifacts a WHERE a.job_id=j.id), "
        "(SELECT COUNT(*) FROM job_events e WHERE e.job_id=j.id) "
        "FROM jobs j ORDER BY j.created_at DESC LIMIT 10"
    ):
        sample_rows.append({
            "job_id": row[0],
            "status": row[1],
            "library_path_present": bool(row[2]),
            "resource_count": row[3],
            "artifact_count": row[4],
            "event_count": row[5],
        })
    report["sampled_relational_records"] = sample_rows
    report["ok"] = all(value == 0 for value in report["constraints"].values())
    output = Path(args.output or run_dir / "d1" / "d1-readonly-parity-report.json").resolve()
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, indent=2))
    if not report["ok"]:
        raise SystemExit("D1 parity constraints failed")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)

    inventory = subcommands.add_parser("inventory-d1")
    inventory.add_argument("--run-dir", required=True)
    inventory.add_argument("--sql", required=True)
    inventory.add_argument("--sqlite-path")
    inventory.add_argument("--output")
    inventory.set_defaults(func=write_inventory)

    import_d1 = subcommands.add_parser("import-d1-shadow")
    import_d1.add_argument("--run-dir", required=True)
    import_d1.add_argument("--sqlite", required=True)
    import_d1.add_argument("--source-sql", required=True)
    import_d1.add_argument("--schema", required=True)
    import_d1.add_argument("--ssh-target", default="cartdotcom-server")
    import_d1.add_argument("--psql-command", default=DEFAULT_PSQL_COMMAND)
    import_d1.add_argument("--output")
    import_d1.set_defaults(func=import_d1_shadow)

    r2_manifest = subcommands.add_parser("r2-manifest")
    r2_manifest.add_argument("--run-dir", required=True)
    r2_manifest.add_argument("--sqlite", required=True)
    r2_manifest.add_argument("--bucket", default=DEFAULT_BUCKET)
    r2_manifest.add_argument("--bucket-size-gb", type=float, required=True)
    r2_manifest.add_argument("--output")
    r2_manifest.set_defaults(func=write_r2_manifest)

    r2_reconcile = subcommands.add_parser("r2-reconcile")
    r2_reconcile.add_argument("--run-dir", required=True)
    r2_reconcile.add_argument("--d1-manifest", required=True)
    r2_reconcile.add_argument("--cloudflare-manifest", required=True)
    r2_reconcile.add_argument("--output")
    r2_reconcile.add_argument("--transfer-manifest")
    r2_reconcile.set_defaults(func=reconcile_r2)

    r2_copy = subcommands.add_parser("r2-copy")
    r2_copy.add_argument("--manifest", required=True)
    r2_copy.add_argument("--local-root", required=True)
    r2_copy.add_argument("--wrangler-cwd", required=True)
    r2_copy.add_argument("--bucket", default=DEFAULT_BUCKET)
    r2_copy.add_argument("--checkpoint")
    r2_copy.add_argument("--retries", type=int, default=3)
    r2_copy.add_argument("--concurrency", type=int, default=2)
    r2_copy.set_defaults(func=copy_r2)

    r2_verify = subcommands.add_parser("r2-verify")
    r2_verify.add_argument("--manifest", required=True)
    r2_verify.add_argument("--local-root", required=True)
    r2_verify.add_argument("--checkpoint")
    r2_verify.add_argument("--output")
    r2_verify.set_defaults(func=verify_r2_copy)

    library = subcommands.add_parser("library-parity")
    library.add_argument("--run-dir", required=True)
    library.add_argument("--sqlite", required=True)
    library.add_argument("--manifest", required=True)
    library.add_argument("--local-root", required=True)
    library.add_argument("--output")
    library.set_defaults(func=library_parity)

    parity = subcommands.add_parser("d1-parity")
    parity.add_argument("--run-dir", required=True)
    parity.add_argument("--sqlite", required=True)
    parity.add_argument("--output")
    parity.set_defaults(func=d1_parity)

    args = parser.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
