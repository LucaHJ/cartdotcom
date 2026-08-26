import hashlib
import importlib.util
import json
import os
import tempfile
import threading
import unittest
import re
from argparse import Namespace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "phase4_shadow_mirror.py"
WATCHDOG_PATH = Path(__file__).resolve().parents[1] / "scripts" / "phase4_mirror_watchdog.sh"
spec = importlib.util.spec_from_file_location("phase4_shadow_mirror", MODULE_PATH)
mirror = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirror)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class FakeMirrorServer:
    def __init__(self, token: str, *, fail_table: str | None = None, corrupt_object: bool = False):
        self.token = token
        self.fail_table = fail_table
        self.corrupt_object = corrupt_object
        self.delta_requests = []
        self.object_requests = []
        self.artifact_body = b"phase4 artifact"
        self.artifact_sha = sha256(self.artifact_body)
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
                    owner.delta_requests.append({"table": table, "cursor": query.get("cursor")})
                    if table == owner.fail_table:
                        self._send(503, b'{"error":"synthetic outage"}')
                        return
                    rows = []
                    if table == "jobs" and not query.get("cursor"):
                        rows = [{
                            "id": "job-post-watermark",
                            "source_url": "https://www.instagram.com/reel/example/",
                            "canonical_url": "https://www.instagram.com/reel/example/",
                            "shortcode": "example",
                            "dedupe_key": "instagram:example",
                            "pilot_run_id": None,
                            "sender_id": "sender-1",
                            "source_message_id": "mid-1",
                            "source_media_json": "{}",
                            "instructions": None,
                            "title": "Post-watermark Reel",
                            "author_username": "tester",
                            "description": "Synthetic fixture",
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
                            "html_key": "library/reels/job-post-watermark/index.html",
                            "library_path": "reels/tester/example/index.html",
                            "markdown_key": None,
                            "transcript_key": None,
                            "synthesis_json_key": None,
                            "codex_input_tokens": 1,
                            "codex_cached_input_tokens": 0,
                            "codex_output_tokens": 1,
                            "codex_reasoning_output_tokens": 0,
                            "codex_total_tokens": 2,
                            "processing_seconds": 3,
                            "created_at": query["watermark"],
                            "started_at": query["watermark"],
                            "completed_at": query["watermark"],
                            "updated_at": query["watermark"],
                            "mirror_updated_at": query["watermark"],
                        }]
                    if table == "artifacts" and not query.get("cursor"):
                        rows = [{
                            "id": "artifact-1",
                            "job_id": "job-post-watermark",
                            "kind": "html",
                            "object_key": "library/reels/job-post-watermark/index.html",
                            "content_type": "text/html",
                            "byte_size": len(owner.artifact_body),
                            "sha256": owner.artifact_sha,
                            "created_at": query["watermark"],
                            "mirror_updated_at": query["watermark"],
                        }]
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
                    owner.object_requests.append(query["key"])
                    payload = b"bad bytes" if owner.corrupt_object else owner.artifact_body
                    self._send(200, payload, "text/html")
                    return
                self._send(404, b'{"error":"not found"}')

            def do_POST(self):
                self._send(405, b'{"error":"method not allowed"}')

        return Handler


class Phase4ShadowMirrorTest(unittest.TestCase):
    def token_file(self, root: Path, token: str) -> Path:
        path = root / "phase4-token"
        path.write_text(token, encoding="utf-8")
        if os.name != "nt":
            path.chmod(0o600)
        return path

    def args(self, root: Path, server: FakeMirrorServer, token_path: Path) -> Namespace:
        return Namespace(
            schema="reel_phase4_shadow_test",
            watermark="2026-08-20T20:05:00Z",
            run_dir=str(root / "run"),
            object_root=str(root / "objects"),
            token_file=str(token_path),
            base_url=server.base_url,
            limit=100,
            psql_command="unused",
        )

    def patch_db(self, cursor_store: dict[str, str | None], sql_batches: list[str], *, fail_commit: bool = False):
        original_run_psql = mirror.run_psql
        original_capture_psql = mirror.capture_psql

        def fake_capture(sql, _cmd):
            if "phase4_mirror_cursors" not in sql:
                return "[]"
            return "\n".join(f"{table}|{cursor or ''}" for table, cursor in sorted(cursor_store.items()))

        def fake_run(sql, _cmd):
            sql_batches.append(sql)
            if fail_commit:
                raise RuntimeError("synthetic PostgreSQL commit failure")
            for cursor, table in re.findall(r"cursor_token='([^']*)'.*?WHERE table_name='([^']*)'", sql, flags=re.S):
                cursor_store[table] = cursor or None

        mirror.run_psql = fake_run
        mirror.capture_psql = fake_capture

        def restore():
            mirror.run_psql = original_run_psql
            mirror.capture_psql = original_capture_psql

        return restore

    def test_static_audit_and_schema_validation(self):
        mirror.verify_no_mutation_surface(Namespace())
        self.assertEqual(mirror.require_schema_name("reel_phase4_shadow_20260821"), "reel_phase4_shadow_20260821")
        with self.assertRaises(SystemExit):
            mirror.require_schema_name("bad-schema")

    def test_object_paths_are_confined(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertTrue(str(mirror.local_object_path(root, "library/example.html")).startswith(str(root.resolve())))
            with self.assertRaises(ValueError):
                mirror.local_object_path(root, "../escape")

    def test_poll_once_is_idempotent_and_restart_safe(self):
        token = "mirror-token-" + "x" * 40
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            token_path = self.token_file(root, token)
            server = FakeMirrorServer(token)
            server.start()
            sql_batches = []
            cursor_store = {table: None for table in mirror.MIRROR_TABLES}
            restore = self.patch_db(cursor_store, sql_batches)
            try:
                first = mirror.mirror_once(self.args(root, server, token_path))
                second = mirror.mirror_once(self.args(root, server, token_path))
                cursor_file = root / "run" / "cursors" / "jobs.json"
                self.assertEqual(json.loads(cursor_file.read_text(encoding="utf-8"))["cursor"], "cursor-jobs")
            finally:
                restore()
                server.close()
        self.assertEqual(first["rows"], 2)
        self.assertEqual(first["objects_checked"], 1)
        self.assertEqual(second["rows"], 0)
        self.assertIn("ON CONFLICT (id) DO UPDATE", sql_batches[0])
        self.assertIn("phase4_mirror_row_versions", sql_batches[0])
        self.assertIn("phase4_mirror_typed_hashes", sql_batches[0])
        self.assertTrue(any(request["cursor"] == "cursor-jobs" for request in server.delta_requests))

    def test_network_interruption_does_not_write_partial_batch(self):
        token = "mirror-token-" + "y" * 40
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            token_path = self.token_file(root, token)
            server = FakeMirrorServer(token, fail_table="resources")
            server.start()
            sql_batches = []
            cursor_store = {table: None for table in mirror.MIRROR_TABLES}
            restore = self.patch_db(cursor_store, sql_batches)
            try:
                with self.assertRaises(RuntimeError):
                    mirror.mirror_once(self.args(root, server, token_path))
            finally:
                restore()
                server.close()
        self.assertEqual(sql_batches, [])

    def test_postgresql_failure_does_not_advance_filesystem_cursor(self):
        token = "mirror-token-" + "f" * 40
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            token_path = self.token_file(root, token)
            server = FakeMirrorServer(token)
            server.start()
            sql_batches = []
            cursor_store = {table: None for table in mirror.MIRROR_TABLES}
            restore = self.patch_db(cursor_store, sql_batches, fail_commit=True)
            try:
                with self.assertRaises(RuntimeError):
                    mirror.mirror_once(self.args(root, server, token_path))
                self.assertFalse((root / "run" / "cursors" / "jobs.json").exists())
                self.assertIsNone(cursor_store["jobs"])
            finally:
                restore()
                server.close()

    def test_corrupt_object_is_preserved_as_divergence_not_false_success(self):
        token = "mirror-token-" + "z" * 40
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            token_path = self.token_file(root, token)
            server = FakeMirrorServer(token, corrupt_object=True)
            server.start()
            sql_batches = []
            cursor_store = {table: None for table in mirror.MIRROR_TABLES}
            restore = self.patch_db(cursor_store, sql_batches)
            try:
                with self.assertRaises(RuntimeError):
                    mirror.mirror_once(self.args(root, server, token_path))
                final_path = root / "objects" / "library" / "reels" / "job-post-watermark" / "index.html"
                self.assertFalse(final_path.exists())
                self.assertTrue(list((root / "objects" / ".quarantine").glob("*download-divergent*")))
                self.assertIsNone(cursor_store["jobs"])
            finally:
                restore()
                server.close()
        self.assertIn("phase4_mirror_divergences", sql_batches[0])
        self.assertIn("size_or_sha_mismatch", sql_batches[0])

    def test_existing_divergent_final_file_is_preserved_and_blocks_cursor(self):
        token = "mirror-token-" + "e" * 40
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            token_path = self.token_file(root, token)
            final_path = root / "objects" / "library" / "reels" / "job-post-watermark" / "index.html"
            final_path.parent.mkdir(parents=True, exist_ok=True)
            final_path.write_bytes(b"unexpected existing content")
            server = FakeMirrorServer(token)
            server.start()
            sql_batches = []
            cursor_store = {table: None for table in mirror.MIRROR_TABLES}
            restore = self.patch_db(cursor_store, sql_batches)
            try:
                with self.assertRaises(RuntimeError):
                    mirror.mirror_once(self.args(root, server, token_path))
                self.assertEqual(final_path.read_bytes(), b"unexpected existing content")
                self.assertTrue(list((root / "objects" / ".quarantine").glob("*existing-divergent*")))
                self.assertIsNone(cursor_store["jobs"])
            finally:
                restore()
                server.close()
        self.assertIn("existing_final_file_diverges", sql_batches[0])

    def test_row_conflict_guard_records_and_raises_before_overwrite(self):
        row = {"id": "job-1", "created_at": "2026-08-20T20:05:00Z", "updated_at": "2026-08-20T20:05:00Z", "mirror_updated_at": "2026-08-20T20:05:00Z"}
        sql = mirror.row_conflict_queries_sql("reel_phase4_shadow_test", "jobs", row)
        self.assertIn("phase4_mirror_row_versions", sql)
        self.assertIn("phase4_mirror_typed_hashes", sql)
        self.assertIn("local_typed_row_drift", sql)
        self.assertNotIn("RAISE EXCEPTION", sql)

    def test_resource_upsert_audits_and_replaces_a_newer_same_job_slug_source_id(self):
        row = {
            "id": "resource-new", "job_id": "job-1", "name": "Ocean's Eleven",
            "slug": "ocean-s-eleven", "created_at": "2026-08-26T06:21:26Z",
        }
        sql = mirror.upsert_typed_sql("reel_phase7_test", "resources", row)
        self.assertIn("phase7_mirror_row_replacements", sql)
        self.assertIn("newer_cloud_resource_replaced_same_job_slug", sql)
        self.assertIn("r.created_at <= '2026-08-26T06:21:26Z'::timestamptz", sql)
        self.assertIn("DELETE FROM reel_phase7_test.resources", sql)

        conflicts = mirror.row_conflict_queries_sql("reel_phase7_test", "resources", row)
        self.assertIn("semantic_key_newer_local_row", conflicts)
        self.assertIn("semantic_key_local_drift", conflicts)

    def test_complete_job_reset_to_queued_clears_resource_projection_with_audit(self):
        row = {
            "id": "job-1", "status": "queued", "stage": "queued",
            "synthesis_json_key": None, "updated_at": "2026-08-26T06:20:00Z",
            "mirror_updated_at": "2026-08-26T06:20:00Z",
        }
        sql = mirror.upsert_typed_sql("reel_phase7_test", "jobs", row)
        self.assertIn("cloud_job_reset_cleared_resources", sql)
        self.assertIn("job-reset:job-1:2026-08-26T06:20:00Z", sql)
        self.assertIn("j.status='complete'", sql)
        self.assertIn("DELETE FROM reel_phase7_test.resources", sql)

    def test_watchdog_validates_process_identity_not_only_pid_liveness(self):
        source = WATCHDOG_PATH.read_text(encoding="utf-8")
        self.assertIn("pid_matches_expected_mirror", source)
        self.assertIn("/proc/$pid/cmdline", source)
        self.assertIn("phase4_shadow_mirror.py loop", source)
        self.assertIn("--schema $EXPECTED_SCHEMA", source)
        self.assertIn("stale_or_unexpected_pid", source)
        self.assertNotRegex(source, r"kill -0 \"\\$\\(cat \"\\$PID_FILE\"\\)\" 2>/dev/null; then\\s*exit 0")


if __name__ == "__main__":
    unittest.main()
