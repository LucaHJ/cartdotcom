import hashlib
import importlib.util
import json
import os
import tempfile
import threading
import time
import unittest
from argparse import Namespace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "phase4_shadow_mirror.py"
spec = importlib.util.spec_from_file_location("phase4_shadow_mirror", MODULE_PATH)
mirror = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirror)


SSH_TARGET = os.environ.get("REEL_PHASE4_PG_SSH_TARGET", "cartdotcom-server")
PSQL_COMMAND = (
    f'ssh {SSH_TARGET} "docker exec -i cartdotcom-platform-postgres-1 '
    'psql -U cartdotcom -d cartdotcom -v ON_ERROR_STOP=1 -q -t -A"'
)
WATERMARK = "2026-08-21T01:42:46Z"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class ProgrammableMirrorServer:
    def __init__(self, token: str, rows_by_table: dict[str, list[dict]], object_bodies: dict[str, bytes] | None = None):
        self.token = token
        self.rows_by_table = rows_by_table
        self.object_bodies = object_bodies or {}
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def base_url(self) -> str:
        host, port = self.server.server_address
        return f"http://{host}:{port}"

    def start(self):
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.thread.join(timeout=5)
        self.server.server_close()

    def _handler(self):
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                return

            def _send(self, status: int, payload: bytes, content_type: str = "application/json"):
                self.send_response(status)
                self.send_header("content-type", content_type)
                self.end_headers()
                self.wfile.write(payload)

            def do_GET(self):
                if self.headers.get("authorization") != f"Bearer {owner.token}":
                    self._send(401, b'{"error":"unauthorised"}')
                    return
                from urllib.parse import parse_qs, urlparse

                parsed = urlparse(self.path)
                query = {key: values[-1] for key, values in parse_qs(parsed.query).items()}
                if parsed.path == "/api/phase4/mirror/delta":
                    table = query["table"]
                    rows = [] if query.get("cursor") else list(owner.rows_by_table.get(table, []))
                    payload = {
                        "ok": True,
                        "table": table,
                        "watermark": query["watermark"],
                        "limit": int(query.get("limit", "100")),
                        "count": len(rows),
                        "rows": rows,
                        "next_cursor": f"cursor-{table}" if rows else query.get("cursor"),
                    }
                    self._send(200, json.dumps(payload).encode("utf-8"))
                    return
                if parsed.path == "/api/phase4/mirror/object":
                    key = query["key"]
                    body = owner.object_bodies.get(key)
                    if body is None:
                        self._send(404, b'{"error":"missing object"}')
                        return
                    self._send(200, body, "application/octet-stream")
                    return
                self._send(404, b'{"error":"not found"}')

        return Handler


def job_row(title: str, updated_at: str = WATERMARK) -> dict:
    return {
        "id": "phase4-connected-job",
        "source_url": "https://www.instagram.com/reel/phase4-connected/",
        "canonical_url": "https://www.instagram.com/reel/phase4-connected/",
        "shortcode": "phase4-connected",
        "dedupe_key": "instagram:phase4-connected",
        "pilot_run_id": None,
        "sender_id": "sender-connected",
        "source_message_id": "message-connected",
        "source_media_json": {},
        "instructions": None,
        "title": title,
        "author_username": "tester",
        "description": "Connected fixture",
        "status": "complete",
        "stage": "complete",
        "attempts": 1,
        "status_emoji": "✅",
        "error_code": None,
        "error_message": None,
        "original_video_key": None,
        "audio_key": None,
        "audio_title": None,
        "audio_artist": None,
        "audio_source_url": None,
        "audio_identification_method": None,
        "audio_confidence": None,
        "html_key": None,
        "library_path": "reels/tester/phase4-connected/index.html",
        "markdown_key": None,
        "transcript_key": None,
        "synthesis_json_key": None,
        "codex_input_tokens": 1,
        "codex_cached_input_tokens": 0,
        "codex_output_tokens": 1,
        "codex_reasoning_output_tokens": 0,
        "codex_total_tokens": 2,
        "processing_seconds": 3,
        "created_at": WATERMARK,
        "started_at": WATERMARK,
        "completed_at": WATERMARK,
        "updated_at": updated_at,
        "mirror_updated_at": updated_at,
    }


def artifact_row(content_type: str, updated_at: str = WATERMARK) -> tuple[dict, dict[str, bytes]]:
    body = b"connected artifact body"
    key = "phase4-connected/artifact.html"
    return {
        "id": "phase4-connected-artifact",
        "job_id": "phase4-connected-job",
        "kind": "html",
        "object_key": key,
        "content_type": content_type,
        "byte_size": len(body),
        "sha256": sha256(body),
        "created_at": WATERMARK,
        "mirror_updated_at": updated_at,
    }, {key: body}


def note_row(body: str, updated_at: str = WATERMARK) -> dict:
    return {
        "id": "phase4-connected-note",
        "sender_id": "sender-connected",
        "body": body,
        "source_message_id": "note-message-connected",
        "created_at": updated_at,
        "mirror_updated_at": updated_at,
    }


@unittest.skipIf(os.environ.get("REEL_PHASE4_SKIP_CONNECTED") == "1", "connected PostgreSQL tests explicitly skipped")
class Phase4ShadowMirrorConnectedTest(unittest.TestCase):
    def setUp(self):
        self.schema = f"reel_phase4_connected_{os.getpid()}_{int(time.time() * 1000)}".lower()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.token = "phase4-connected-token-" + "x" * 40
        self.token_path = self.root / "token"
        self.token_path.write_text(self.token, encoding="utf-8")
        if os.name != "nt":
            self.token_path.chmod(0o600)
        self.init_args = Namespace(
            schema=self.schema,
            migrations_dir=str(MODULE_PATH.resolve().parents[1] / "migrations"),
            watermark=WATERMARK,
            run_dir=str(self.root / "init-run"),
            output=None,
            psql_command=PSQL_COMMAND,
        )
        mirror.init_schema(self.init_args)

    def tearDown(self):
        try:
            mirror.run_psql(f"DROP SCHEMA IF EXISTS {self.schema} CASCADE;", PSQL_COMMAND)
        finally:
            self.temp.cleanup()

    def args(self, server: ProgrammableMirrorServer, run_name: str) -> Namespace:
        return Namespace(
            schema=self.schema,
            watermark=WATERMARK,
            run_dir=str(self.root / run_name),
            object_root=str(self.root / run_name / "objects"),
            token_file=str(self.token_path),
            base_url=server.base_url,
            limit=100,
            psql_command=PSQL_COMMAND,
        )

    def mirror_rows(self, rows_by_table: dict[str, list[dict]], run_name: str, object_bodies: dict[str, bytes] | None = None):
        server = ProgrammableMirrorServer(self.token, rows_by_table, object_bodies)
        server.start()
        try:
            return mirror.mirror_once(self.args(server, run_name))
        finally:
            server.close()

    def scalar(self, sql: str) -> str:
        output = mirror.capture_psql(sql, PSQL_COMMAND)
        return output.splitlines()[-1] if output.splitlines() else ""

    def reset_cursor(self, table: str) -> None:
        mirror.run_psql(
            f"UPDATE {self.schema}.phase4_mirror_cursors SET cursor_token=NULL, rows_seen=0 WHERE table_name={mirror.sql_literal(table)};",
            PSQL_COMMAND,
        )

    def divergence_count(self) -> int:
        return int(self.scalar(f"SELECT COUNT(*) FROM {self.schema}.phase4_mirror_divergences;"))

    def test_same_version_payload_conflict_persists_divergence_and_preserves_cursor_and_typed_row(self):
        self.mirror_rows({"jobs": [job_row("original title")]}, "first")
        self.reset_cursor("jobs")
        with self.assertRaisesRegex(RuntimeError, "same source version has different payload hash"):
            self.mirror_rows({"jobs": [job_row("changed same timestamp")]}, "conflict")

        self.assertEqual(self.divergence_count(), 1)
        self.assertEqual(self.scalar(f"SELECT title FROM {self.schema}.jobs WHERE id='phase4-connected-job';"), "original title")
        self.assertEqual(self.scalar(f"SELECT COALESCE(cursor_token,'') FROM {self.schema}.phase4_mirror_cursors WHERE table_name='jobs';"), "")
        self.assertFalse((self.root / "conflict" / "cursors" / "jobs.json").exists())

    def test_local_job_drift_is_durable_and_blocks_legitimate_newer_source_until_repaired(self):
        self.mirror_rows({"jobs": [job_row("original title")]}, "first")
        mirror.run_psql(f"UPDATE {self.schema}.jobs SET title='manual drift' WHERE id='phase4-connected-job';", PSQL_COMMAND)
        self.reset_cursor("jobs")
        with self.assertRaisesRegex(RuntimeError, "local typed row drift"):
            self.mirror_rows({"jobs": [job_row("cloud newer title", "2026-08-21T01:43:46Z")]}, "drift")

        self.assertEqual(self.divergence_count(), 1)
        self.assertEqual(self.scalar(f"SELECT title FROM {self.schema}.jobs WHERE id='phase4-connected-job';"), "manual drift")
        self.assertEqual(self.scalar(f"SELECT COALESCE(cursor_token,'') FROM {self.schema}.phase4_mirror_cursors WHERE table_name='jobs';"), "")

    def test_newer_cloud_source_updates_when_local_typed_row_matches_expected_snapshot(self):
        self.mirror_rows({"jobs": [job_row("original title")]}, "first")
        self.reset_cursor("jobs")
        self.mirror_rows({"jobs": [job_row("cloud newer title", "2026-08-21T01:43:46Z")]}, "newer")

        self.assertEqual(self.divergence_count(), 0)
        self.assertEqual(self.scalar(f"SELECT title FROM {self.schema}.jobs WHERE id='phase4-connected-job';"), "cloud newer title")
        typed_title = self.scalar(
            f"SELECT typed_row_json->>'title' FROM {self.schema}.phase4_mirror_typed_hashes WHERE table_name='jobs' AND source_key='phase4-connected-job';"
        )
        self.assertEqual(typed_title, "cloud newer title")

    def test_artifact_local_drift_is_detected_before_overwrite(self):
        artifact, objects = artifact_row("text/html")
        self.mirror_rows({"jobs": [job_row("original title")], "artifacts": [artifact]}, "first-artifact", objects)
        mirror.run_psql(f"UPDATE {self.schema}.artifacts SET content_type='text/plain' WHERE object_key='phase4-connected/artifact.html';", PSQL_COMMAND)
        self.reset_cursor("artifacts")
        newer_artifact, objects = artifact_row("application/xhtml+xml", "2026-08-21T01:43:46Z")
        with self.assertRaisesRegex(RuntimeError, "local typed row drift"):
            self.mirror_rows({"artifacts": [newer_artifact]}, "artifact-drift", objects)

        self.assertEqual(self.divergence_count(), 1)
        self.assertEqual(self.scalar(f"SELECT content_type FROM {self.schema}.artifacts WHERE object_key='phase4-connected/artifact.html';"), "text/plain")

    def test_generic_note_local_drift_is_detected_before_overwrite(self):
        self.mirror_rows({"notes": [note_row("original note")]}, "first-note")
        mirror.run_psql(f"UPDATE {self.schema}.notes SET body='manual note drift' WHERE id='phase4-connected-note';", PSQL_COMMAND)
        self.reset_cursor("notes")
        with self.assertRaisesRegex(RuntimeError, "local typed row drift"):
            self.mirror_rows({"notes": [note_row("cloud newer note", "2026-08-21T01:43:46Z")]}, "note-drift")

        self.assertEqual(self.divergence_count(), 1)
        self.assertEqual(self.scalar(f"SELECT body FROM {self.schema}.notes WHERE id='phase4-connected-note';"), "manual note drift")


if __name__ == "__main__":
    unittest.main()
