#!/usr/bin/env python3
"""Private Phase 7 wake, local-object, and Reel Library origin.

The wake is only a latency hint. D1 remains the durable edge spool and the
Phase 4 cursor mirror remains the recovery path. Object and library writes are
verified before atomic placement. Archived objects are immutable; generated
library pages are mutable projections and are atomically replaced with an
audited previous/new digest pair.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import signal
import sqlite3
import stat
import subprocess
import tempfile
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qs, unquote, urlparse

MAX_JSON_BYTES = 16 * 1024
MAX_OBJECT_BYTES = 2 * 1024 * 1024 * 1024
MAX_LIBRARY_METADATA_BYTES = 8 * 1024


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def require_secret(path: Path) -> bytes:
    mode = stat.S_IMODE(path.stat().st_mode)
    if os.name != "nt" and mode & 0o077:
        raise SystemExit(f"Secret file must be mode 0600: {path}")
    value = path.read_bytes().strip()
    if len(value) < 32:
        raise SystemExit("Phase 7 origin token must contain at least 32 bytes")
    return value


def safe_relative(value: str) -> Path:
    decoded = unquote(value).replace("\\", "/").lstrip("/")
    parts = PurePosixPath(decoded).parts
    if not decoded or any(part in {"", ".", ".."} for part in parts):
        raise ValueError("invalid path")
    return Path(*parts)


def decode_library_metadata(value: str | None) -> dict[str, object] | None:
    if not value:
        return None
    try:
        padded = value + "=" * (-len(value) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("ascii"))
        if not raw or len(raw) > MAX_LIBRARY_METADATA_BYTES:
            raise ValueError("invalid metadata size")
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("invalid metadata shape")
        return payload
    except (UnicodeEncodeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("invalid library metadata") from error


class OriginState:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.token = require_secret(Path(args.token_file))
        self.run_dir = Path(args.run_dir).resolve()
        self.object_root = Path(args.object_root).resolve()
        self.library_root = Path(args.library_root).resolve()
        for path in (self.run_dir, self.object_root, self.library_root):
            path.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db_path = self.run_dir / "phase7-origin.sqlite3"
        self.work_lock = threading.Lock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path, timeout=30)
        connection.execute("PRAGMA journal_mode=WAL")
        return connection

    def _init_db(self) -> None:
        with self._connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS wake_receipts(
                  wake_id TEXT PRIMARY KEY, path TEXT NOT NULL, received_at TEXT NOT NULL,
                  completed_at TEXT, result_json TEXT
                );
                CREATE TABLE IF NOT EXISTS file_receipts(
                  kind TEXT NOT NULL, path TEXT NOT NULL, byte_size INTEGER NOT NULL,
                  sha256 TEXT NOT NULL, updated_at TEXT NOT NULL, metadata_json TEXT,
                  PRIMARY KEY(kind,path)
                );
                CREATE TABLE IF NOT EXISTS file_replacements(
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  kind TEXT NOT NULL, path TEXT NOT NULL,
                  previous_byte_size INTEGER NOT NULL, previous_sha256 TEXT NOT NULL,
                  replacement_byte_size INTEGER NOT NULL, replacement_sha256 TEXT NOT NULL,
                  replaced_at TEXT NOT NULL
                );
                """
            )
            columns = {row[1] for row in db.execute("PRAGMA table_info(file_receipts)")}
            if "metadata_json" not in columns:
                db.execute("ALTER TABLE file_receipts ADD COLUMN metadata_json TEXT")
        os.chmod(self.db_path, 0o600)

    def authorised(self, header: str | None) -> bool:
        if not header or not header.startswith("Bearer "):
            return False
        return hmac.compare_digest(header[7:].encode("utf-8"), self.token)

    def mirror_health(self, wake_id: str | None = None) -> dict[str, object]:
        if wake_id:
            with self._connect() as db:
                row = db.execute(
                    "SELECT wake_id,completed_at,result_json FROM wake_receipts WHERE wake_id=?",
                    (wake_id,),
                ).fetchone()
            if not row:
                return {"ok": False, "service": "phase7-origin", "mirror_state": "unknown_wake", "wake_id": wake_id}
            if not row[1]:
                return {"ok": False, "service": "phase7-origin", "mirror_state": "pending", "wake_id": wake_id}
            try:
                result = json.loads(row[2] or "{}")
            except (TypeError, json.JSONDecodeError):
                result = {}
            healthy = isinstance(result, dict) and result.get("ok") is True
            return {
                "ok": healthy,
                "service": "phase7-origin",
                "mirror_state": "healthy" if healthy else "degraded",
                "wake_id": wake_id,
                "last_completed_at": row[1],
                "last_returncode": result.get("returncode") if isinstance(result, dict) else None,
            }
        with self._connect() as db:
            rows = db.execute(
                "SELECT wake_id,completed_at,result_json FROM wake_receipts "
                "WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 20"
            ).fetchall()
        if not rows:
            return {"ok": True, "service": "phase7-origin", "mirror_state": "awaiting_first_drain", "consecutive_failures": 0}
        consecutive_failures = 0
        latest_result: dict[str, object] = {}
        for index, (_wake_id, _completed_at, raw_result) in enumerate(rows):
            try:
                parsed = json.loads(raw_result or "{}")
            except (TypeError, json.JSONDecodeError):
                parsed = {}
            if index == 0 and isinstance(parsed, dict):
                latest_result = parsed
            if not isinstance(parsed, dict) or parsed.get("ok") is not True:
                consecutive_failures += 1
            else:
                break
        healthy = latest_result.get("ok") is True
        return {
            "ok": healthy,
            "service": "phase7-origin",
            "mirror_state": "healthy" if healthy else "degraded",
            "consecutive_failures": consecutive_failures,
            "last_wake_id": rows[0][0],
            "last_completed_at": rows[0][1],
            "last_returncode": latest_result.get("returncode"),
        }

    def accept_wake(self, wake_id: str, path: str) -> bool:
        with self._connect() as db:
            changed = db.execute(
                "INSERT OR IGNORE INTO wake_receipts(wake_id,path,received_at) VALUES(?,?,?)",
                (wake_id, path[:500], utc_now()),
            ).rowcount
        if changed:
            threading.Thread(target=self._drain, args=(wake_id,), daemon=True).start()
        return bool(changed)

    def _drain(self, wake_id: str) -> None:
        with self.work_lock:
            command = [
                "python3", self.args.mirror_script, "poll-once",
                "--schema", self.args.schema,
                "--watermark", self.args.watermark,
                "--run-dir", self.args.mirror_run_dir,
                "--object-root", self.args.mirror_object_root,
                "--token-file", self.args.mirror_token_file,
                "--limit", "100",
            ]
            result = subprocess.run(command, text=True, encoding="utf-8", errors="replace", capture_output=True, timeout=240, check=False)
            outcome = {
                "ok": result.returncode == 0,
                "returncode": result.returncode,
                "finished_at": utc_now(),
                "output_tail": (result.stdout if result.returncode == 0 else result.stderr)[-1200:],
            }
            if result.returncode == 0:
                self.signal_dispatchers()
            with self._connect() as db:
                db.execute(
                    "UPDATE wake_receipts SET completed_at=?,result_json=? WHERE wake_id=?",
                    (utc_now(), json.dumps(outcome, separators=(",", ":")), wake_id),
                )

    def signal_dispatchers(self) -> int:
        count = 0
        for slot in (1, 2):
            pid_path = Path(self.args.dispatch_run_dir) / f"phase6-dispatcher-{slot}.pid"
            try:
                pid = int(pid_path.read_text(encoding="utf-8").strip())
                cmdline = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode("utf-8", "replace")
                if "phase6_dispatcher.py" not in cmdline or f"--slot {slot}" not in cmdline:
                    continue
                os.kill(pid, signal.SIGUSR1)
                count += 1
            except (FileNotFoundError, ValueError, ProcessLookupError, PermissionError):
                continue
        return count

    def put_file(
        self,
        kind: str,
        relative: Path,
        body,
        content_length: int,
        expected_sha: str | None,
        metadata: dict[str, object] | None = None,
    ) -> dict[str, object]:
        if content_length < 0 or content_length > MAX_OBJECT_BYTES:
            raise ValueError("invalid content length")
        root = self.object_root if kind == "object" else self.library_root
        target = (root / relative).resolve(strict=False)
        if target != root and root not in target.parents:
            raise ValueError("path escapes root")
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor, temp_name = tempfile.mkstemp(prefix=".phase7-", dir=target.parent)
        digest = hashlib.sha256()
        received = 0
        try:
            with os.fdopen(descriptor, "wb") as output:
                remaining = content_length
                while remaining:
                    chunk = body.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    received += len(chunk)
                    remaining -= len(chunk)
                    digest.update(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            actual_sha = digest.hexdigest()
            if received != content_length or (expected_sha and not hmac.compare_digest(actual_sha, expected_sha.lower())):
                quarantine = Path(temp_name).with_name(Path(temp_name).name + ".quarantine")
                os.replace(temp_name, quarantine)
                raise RuntimeError("size_or_checksum_mismatch")
            replaced = False
            previous_size = 0
            previous_sha = ""
            if target.exists():
                previous_size = target.stat().st_size
                existing_sha = hashlib.sha256(target.read_bytes()).hexdigest()
                previous_sha = existing_sha
                if previous_size != received or existing_sha != actual_sha:
                    if kind == "object":
                        quarantine = Path(temp_name).with_name(Path(temp_name).name + ".conflict")
                        os.replace(temp_name, quarantine)
                        raise FileExistsError("existing_file_divergence")
                    os.replace(temp_name, target)
                    os.chmod(target, 0o600)
                    replaced = True
                else:
                    os.unlink(temp_name)
            else:
                os.replace(temp_name, target)
                os.chmod(target, 0o600)
            with self._connect() as db:
                if replaced:
                    db.execute(
                        "INSERT INTO file_replacements(kind,path,previous_byte_size,previous_sha256,replacement_byte_size,replacement_sha256,replaced_at) "
                        "VALUES(?,?,?,?,?,?,?)",
                        (kind, relative.as_posix(), previous_size, previous_sha, received, actual_sha, utc_now()),
                    )
                db.execute(
                    "INSERT INTO file_receipts(kind,path,byte_size,sha256,updated_at,metadata_json) VALUES(?,?,?,?,?,?) "
                    "ON CONFLICT(kind,path) DO UPDATE SET byte_size=excluded.byte_size,sha256=excluded.sha256,"
                    "updated_at=excluded.updated_at,metadata_json=COALESCE(excluded.metadata_json,file_receipts.metadata_json)",
                    (kind, relative.as_posix(), received, actual_sha, utc_now(), json.dumps(metadata, separators=(",", ":")) if metadata else None),
                )
            return {"ok": True, "path": relative.as_posix(), "bytes": received, "sha256": actual_sha, "replaced": replaced}
        except Exception:
            if os.path.exists(temp_name):
                os.unlink(temp_name)
            raise

    def manifest(self) -> dict[str, object]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT path,byte_size,sha256,updated_at,metadata_json FROM file_receipts WHERE kind='library' ORDER BY path"
            ).fetchall()
        files = []
        for path, size, sha, updated, metadata_json in rows:
            try:
                metadata = json.loads(metadata_json) if metadata_json else {}
                if not isinstance(metadata, dict):
                    metadata = {}
            except json.JSONDecodeError:
                metadata = {}
            files.append({**metadata, "path": path, "bytes": size, "sha256": sha, "updated_at": updated})
        return {"generated_at": utc_now(), "file_count": len(files), "files": files}


class Handler(BaseHTTPRequestHandler):
    server_version = "ReelPhase7Origin/1"

    @property
    def state(self) -> OriginState:
        return self.server.state  # type: ignore[attr-defined]

    def log_message(self, fmt: str, *args: object) -> None:
        print(json.dumps({"at": utc_now(), "remote": self.client_address[0], "message": fmt % args}), flush=True)

    def respond_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def require_auth(self) -> bool:
        if self.state.authorised(self.headers.get("Authorization")):
            return True
        self.respond_json(401, {"ok": False, "error": "unauthorised"})
        return False

    def request_content_length(self, default: int) -> int:
        # Some proxied requests preserve the field in raw_items() while the
        # Message mapping lookup returns no value. Match the field name
        # case-insensitively and reject malformed/duplicate lengths.
        values = [value for key, value in self.headers.raw_items() if key.lower() == "content-length"]
        if len(values) != 1:
            return default
        return int(values[0])

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/healthz":
            wake_id = (parse_qs(parsed.query).get("wake_id") or [None])[-1]
            health = self.state.mirror_health(wake_id)
            status = 200 if health["ok"] else 202 if health.get("mirror_state") == "pending" else 404 if health.get("mirror_state") == "unknown_wake" else 503
            self.respond_json(status, health)
            return
        if not self.require_auth():
            return
        if parsed.path == "/v1/library/manifest":
            self.respond_json(200, {"ok": True, **self.state.manifest()})
            return
        if parsed.path.startswith("/v1/library/file/"):
            try:
                relative = safe_relative(parsed.path.removeprefix("/v1/library/file/"))
                target = (self.state.library_root / relative).resolve(strict=True)
                if self.state.library_root not in target.parents or not target.is_file():
                    raise FileNotFoundError
                body = target.read_bytes()
                self.send_response(200)
                self.send_header("content-type", "text/html; charset=utf-8")
                self.send_header("x-phase7-source", "ubuntu")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (ValueError, FileNotFoundError):
                self.respond_json(404, {"ok": False, "error": "not_found"})
            return
        self.respond_json(404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if not self.require_auth():
            return
        if urlparse(self.path).path != "/v1/wake":
            self.respond_json(405, {"ok": False, "error": "method_not_allowed"})
            return
        length = self.request_content_length(0)
        if length < 2 or length > MAX_JSON_BYTES:
            self.respond_json(413, {"ok": False, "error": "invalid_body_size", "received_bytes": length})
            return
        try:
            payload = json.loads(self.rfile.read(length))
            wake_id = str(payload["wake_id"])
            path = str(payload.get("path") or "")
            if not wake_id or len(wake_id) > 200:
                raise ValueError
        except (KeyError, ValueError, json.JSONDecodeError, TypeError):
            self.respond_json(400, {"ok": False, "error": "invalid_wake"})
            return
        accepted = self.state.accept_wake(wake_id, path)
        self.respond_json(202, {"ok": True, "accepted": accepted, "duplicate": not accepted})

    def do_PUT(self) -> None:  # noqa: N802
        if not self.require_auth():
            return
        parsed = urlparse(self.path).path
        kind = "object" if parsed.startswith("/v1/object/") else "library" if parsed.startswith("/v1/library/file/") else ""
        if not kind:
            self.respond_json(405, {"ok": False, "error": "method_not_allowed"})
            return
        try:
            prefix = "/v1/object/" if kind == "object" else "/v1/library/file/"
            relative = safe_relative(parsed.removeprefix(prefix))
            length = self.request_content_length(-1)
            metadata = decode_library_metadata(self.headers.get("X-Phase7-Library-Metadata")) if kind == "library" else None
            result = self.state.put_file(kind, relative, self.rfile, length, self.headers.get("X-Content-Sha256"), metadata)
            self.respond_json(200, result)
        except FileExistsError as error:
            self.respond_json(409, {"ok": False, "error": str(error)})
        except RuntimeError as error:
            self.respond_json(422, {"ok": False, "error": str(error)})
        except (ValueError, OSError):
            self.respond_json(400, {"ok": False, "error": "invalid_request"})

    def do_DELETE(self) -> None:  # noqa: N802
        self.respond_json(405, {"ok": False, "error": "method_not_allowed"})


def main() -> int:
    parser = argparse.ArgumentParser(description="Private Instagram Reel Phase 7 origin")
    parser.add_argument("--bind", default="172.19.0.1")
    parser.add_argument("--port", type=int, default=3110)
    parser.add_argument("--token-file", required=True)
    parser.add_argument("--run-dir", default="/srv/cartdotcom/instagram-reel-brain/runs/phase7-origin")
    parser.add_argument("--object-root", default="/srv/cartdotcom/reel-brain-data/objects")
    parser.add_argument("--library-root", default="/srv/cartdotcom/reel-brain-data/library")
    parser.add_argument("--mirror-script", default="/srv/cartdotcom/instagram-reel-brain/scripts/phase4_shadow_mirror.py")
    parser.add_argument("--schema", default="reel_phase4_shadow_20260821_014246")
    parser.add_argument("--watermark", default="2026-08-21T01:42:46Z")
    parser.add_argument("--mirror-run-dir", default="/srv/cartdotcom/reel-brain-runs/phase4-shadow/2026-08-21_01-42-46")
    parser.add_argument("--mirror-object-root", default="/srv/cartdotcom/reel-brain-runs/phase4-shadow/2026-08-21_01-42-46/objects")
    parser.add_argument("--mirror-token-file", default="/srv/cartdotcom/reel-brain-secrets/phase4-mirror-token")
    parser.add_argument("--dispatch-run-dir", default="/srv/cartdotcom/instagram-reel-brain/runs")
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.bind, args.port), Handler)
    server.state = OriginState(args)  # type: ignore[attr-defined]
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
