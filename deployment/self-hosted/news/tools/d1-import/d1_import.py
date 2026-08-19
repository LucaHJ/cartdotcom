#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile


TABLE_ORDER = [
    "sources",
    "articles",
    "research_jobs",
    "research_results",
    "price_impacts",
    "prediction_outcomes",
    "source_checks",
    "article_corpus_objects",
    "source_hourly_metrics",
    "source_metric_state",
    "feed_ingestion_meta",
    "feed_source_state",
    "feed_item_ledger",
    "source_check_details",
    "prediction_outcome_scans",
    "prediction_daily_points",
    "prediction_daily_points_v2",
    "runtime_secrets",
    "model_experiments",
    "model_experiment_samples",
    "model_experiment_jobs",
    "model_experiment_prices",
    "simulation_state",
    "simulation_positions",
    "simulation_processed_results",
    "simulation_trades",
    "simulation_snapshots",
    "eod_simulation_state",
    "eod_simulation_positions",
    "eod_reports",
    "eod_simulation_trades",
    "eod_simulation_snapshots",
]

REPLACE_CONFIRMATION = "REPLACE_SELF_HOSTED_STAGING"


def parse_args():
    parser = argparse.ArgumentParser(description="Validate or import a Cloudflare D1 SQL export.")
    parser.add_argument("export", type=Path, help="D1 SQL export mounted inside the container")
    parser.add_argument("--mode", choices=("validate", "merge", "replace"), default="validate")
    parser.add_argument("--confirm-replace", default="")
    return parser.parse_args()


def load_export(export_path, sqlite_path):
    if not export_path.is_file():
        raise FileNotFoundError(f"D1 export does not exist: {export_path}")
    sqlite_cli = shutil.which("sqlite3")
    if sqlite_cli:
        with export_path.open("rb") as source, tempfile.TemporaryFile() as errors:
            process = subprocess.Popen(
                [sqlite_cli, str(sqlite_path)],
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=errors,
            )
            process.stdin.write(
                b"PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; "
                b"PRAGMA temp_store=MEMORY; BEGIN IMMEDIATE;\n"
            )
            shutil.copyfileobj(source, process.stdin, length=1024 * 1024)
            process.stdin.write(b"\nCOMMIT;\n")
            process.stdin.close()
            return_code = process.wait()
            if return_code != 0:
                errors.seek(0)
                message = errors.read().decode("utf-8", errors="replace").strip()
                raise RuntimeError(f"SQLite rejected the D1 export: {message}")
        return sqlite3.connect(sqlite_path)

    # Kept for small unit-test fixtures on systems without the SQLite CLI.
    connection = sqlite3.connect(sqlite_path)
    try:
        connection.executescript(export_path.read_text(encoding="utf-8"))
        connection.commit()
    except Exception:
        connection.close()
        raise
    return connection


def sqlite_tables(connection):
    rows = connection.execute(
        """
        SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name NOT LIKE '_cf_%'
          AND name != 'd1_migrations'
        ORDER BY name
        """
    ).fetchall()
    return {row[0] for row in rows}


def source_counts(connection, tables):
    return {
        table: connection.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
        for table in tables
    }


def postgres_connection():
    try:
        import psycopg
    except ImportError as error:
        raise RuntimeError("psycopg is required for merge and replace modes") from error

    password_file = Path(os.environ["PGPASSWORD_FILE"])
    return psycopg.connect(
        host=os.environ.get("PGHOST", "postgres"),
        port=int(os.environ.get("PGPORT", "5432")),
        dbname=os.environ.get("PGDATABASE", "cartdotcom"),
        user=os.environ.get("PGUSER", "cartdotcom"),
        password=password_file.read_text(encoding="utf-8").strip(),
    )


def target_metadata(connection, table):
    columns = connection.execute(
        """
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        ORDER BY ordinal_position
        """,
        (table,),
    ).fetchall()
    keys = connection.execute(
        """
        SELECT key_column_usage.column_name
        FROM information_schema.table_constraints
        JOIN information_schema.key_column_usage
          ON table_constraints.constraint_name = key_column_usage.constraint_name
         AND table_constraints.table_schema = key_column_usage.table_schema
        WHERE table_constraints.table_schema = 'public'
          AND table_constraints.table_name = %s
          AND table_constraints.constraint_type = 'PRIMARY KEY'
        ORDER BY key_column_usage.ordinal_position
        """,
        (table,),
    ).fetchall()
    return {name: data_type for name, data_type in columns}, [row[0] for row in keys]


def normalize_value(value, data_type):
    if value == "" and data_type in ("timestamp with time zone", "timestamp without time zone", "date"):
        return None
    return value


def import_table(source, target, table):
    from psycopg import sql

    source_columns = [row[1] for row in source.execute(f'PRAGMA table_info("{table}")').fetchall()]
    target_columns, primary_key = target_metadata(target, table)
    columns = [column for column in source_columns if column in target_columns]
    if not columns:
        raise RuntimeError(f"No compatible columns found for {table}")
    if not primary_key:
        raise RuntimeError(f"No PostgreSQL primary key found for {table}")

    updates = [column for column in columns if column not in primary_key]
    conflict_action = sql.SQL("DO NOTHING")
    if updates:
        conflict_action = sql.SQL("DO UPDATE SET {updates}").format(
            updates=sql.SQL(", ").join(
                sql.SQL("{} = EXCLUDED.{}").format(sql.Identifier(column), sql.Identifier(column))
                for column in updates
            )
        )

    statement = sql.SQL(
        "INSERT INTO {table} ({columns}) VALUES ({values}) ON CONFLICT ({keys}) {action}"
    ).format(
        table=sql.Identifier(table),
        columns=sql.SQL(", ").join(map(sql.Identifier, columns)),
        values=sql.SQL(", ").join(sql.Placeholder() for _ in columns),
        keys=sql.SQL(", ").join(map(sql.Identifier, primary_key)),
        action=conflict_action,
    )

    cursor = source.execute(
        f'SELECT {", ".join(f"\"{column}\"" for column in columns)} FROM "{table}"'
    )
    imported = 0
    with target.cursor() as target_cursor:
        while True:
            rows = cursor.fetchmany(500)
            if not rows:
                break
            normalized = [
                tuple(normalize_value(value, target_columns[column]) for column, value in zip(columns, row))
                for row in rows
            ]
            target_cursor.executemany(statement, normalized)
            imported += len(normalized)
    return imported


def run():
    args = parse_args()
    if args.mode == "replace" and args.confirm_replace != REPLACE_CONFIRMATION:
        raise RuntimeError(f"Replace mode requires --confirm-replace {REPLACE_CONFIRMATION}")

    with tempfile.TemporaryDirectory(prefix="cartdotcom-d1-") as temporary_dir:
        sqlite_path = Path(temporary_dir) / "export.sqlite"
        source = load_export(args.export, sqlite_path)
        available = sqlite_tables(source)
        known = [table for table in TABLE_ORDER if table in available]
        unknown = sorted(available.difference(TABLE_ORDER))
        counts = source_counts(source, known)

        report = {
            "export": str(args.export),
            "mode": args.mode,
            "known_tables": counts,
            "unknown_tables": unknown,
        }
        if unknown:
            report["warning"] = "Unknown source tables will not be imported. Update the importer before cutover."

        if args.mode == "validate":
            print(json.dumps(report, indent=2, sort_keys=True))
            return 0

        target = postgres_connection()
        try:
            with target.transaction():
                if args.mode == "replace":
                    from psycopg import sql

                    target.execute(
                        sql.SQL("TRUNCATE TABLE {} CASCADE").format(
                            sql.SQL(", ").join(map(sql.Identifier, reversed(TABLE_ORDER)))
                        )
                    )
                imported = {}
                for table in known:
                    imported[table] = import_table(source, target, table)
            report["imported_rows"] = imported
        finally:
            target.close()
            source.close()

        print(json.dumps(report, indent=2, sort_keys=True))
        return 0


if __name__ == "__main__":
    try:
        sys.exit(run())
    except Exception as error:
        print(f"D1 import failed: {error}", file=sys.stderr)
        sys.exit(1)
