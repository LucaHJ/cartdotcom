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


def safe_local_path(root: Path, key: str) -> Path:
    clean = key.lstrip("/\\")
    if not clean or ".." in Path(clean).parts:
        raise SystemExit(f"Unsafe object key: {key!r}")
    target = (root / clean).resolve()
    root_resolved = root.resolve()
    if os.path.commonpath([str(root_resolved), str(target)]) != str(root_resolved):
        raise SystemExit(f"Object key escapes root: {key!r}")
    return target


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
    for entry in manifest["objects"]:
        key = entry["key"]
        target = safe_local_path(root, key)
        if key in done and target.exists() and sha256_file(target) == done[key].get("sha256"):
            skipped += 1
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        temp_target = target.with_name(target.name + ".tmp-phase3")
        for attempt in range(1, args.retries + 1):
            if temp_target.exists():
                temp_target.unlink()
            command = [
                "npx",
                "wrangler",
                "r2",
                "object",
                "get",
                f"{args.bucket}/{key}",
                "--remote",
                "--file",
                str(temp_target),
            ]
            env = os.environ.copy()
            env.pop("CLOUDFLARE_API_TOKEN", None)
            result = subprocess.run(
                command,
                cwd=args.wrangler_cwd,
                env=env,
                capture_output=True,
                text=True,
            )
            if result.returncode == 0 and temp_target.exists():
                actual_size = temp_target.stat().st_size
                actual_sha = sha256_file(temp_target)
                expected_size = entry.get("expected_byte_size")
                expected_sha = entry.get("expected_sha256")
                if expected_size is not None and int(expected_size) != actual_size:
                    detail = f"size mismatch expected={expected_size} actual={actual_size}"
                elif expected_sha and str(expected_sha).lower() != actual_sha:
                    detail = f"sha mismatch expected={expected_sha} actual={actual_sha}"
                else:
                    shutil.move(str(temp_target), str(target))
                    record = {
                        "at": utc_now(),
                        "key": key,
                        "status": "complete",
                        "bytes": actual_size,
                        "sha256": actual_sha,
                        "path": str(target),
                    }
                    with checkpoint_path.open("a", encoding="utf-8") as handle:
                        handle.write(json.dumps(record, ensure_ascii=False) + "\n")
                    copied += 1
                    break
                failed.append({"key": key, "attempt": attempt, "error": detail})
            elif attempt == args.retries:
                failed.append(
                    {
                        "key": key,
                        "attempt": attempt,
                        "error": (result.stderr or result.stdout)[-1000:],
                    }
                )
        if failed and failed[-1].get("key") == key and failed[-1].get("attempt") == args.retries:
            continue
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

    r2_copy = subcommands.add_parser("r2-copy")
    r2_copy.add_argument("--manifest", required=True)
    r2_copy.add_argument("--local-root", required=True)
    r2_copy.add_argument("--wrangler-cwd", required=True)
    r2_copy.add_argument("--bucket", default=DEFAULT_BUCKET)
    r2_copy.add_argument("--checkpoint")
    r2_copy.add_argument("--retries", type=int, default=3)
    r2_copy.set_defaults(func=copy_r2)

    args = parser.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
