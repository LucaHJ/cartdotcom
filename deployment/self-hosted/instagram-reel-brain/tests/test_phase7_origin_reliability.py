"""Connected SQLite regressions: no GC-dependent handles; fail-closed health."""
import argparse
import gc
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("origin", Path(__file__).resolve().parents[1] / "scripts/phase7_origin.py")
origin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(origin)


class OriginReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        token = root / "token"
        token.write_text("synthetic-not-a-credential" * 3)
        token.chmod(0o600)
        self.state = origin.OriginState(argparse.Namespace(
            token_file=str(token), run_dir=str(root / "run"), object_root=str(root / "objects"),
            library_root=str(root / "library"), mirror_script="synthetic.py", schema="fixture",
            watermark="2026-08-25T13:30:07Z", mirror_run_dir=str(root / "mirror"),
            mirror_object_root=str(root / "objects"), mirror_token_file=str(token),
        ))

    def tearDown(self):
        gc.collect()
        self.tmp.cleanup()

    def receipt(self, key="fixture", completed=None, ok=True):
        with self.state._connect() as db:
            db.execute("INSERT INTO wake_receipts VALUES(?,?,?,?,?)", (key, "fixture", origin.utc_now(), completed, json.dumps({"ok": ok, "returncode": 0 if ok else 1})))

    def test_connections_close_on_commit_and_rollback_even_when_retained(self):
        with self.state._connect() as committed:
            committed.execute("INSERT INTO wake_receipts(wake_id,path,received_at) VALUES('commit','fixture','now')")
        with self.assertRaises(sqlite3.ProgrammingError):
            committed.execute("SELECT 1")
        with self.assertRaisesRegex(RuntimeError, "injected"):
            with self.state._connect() as rolled_back:
                rolled_back.execute("INSERT INTO wake_receipts(wake_id,path,received_at) VALUES('rollback','fixture','now')")
                raise RuntimeError("injected")
        with self.assertRaises(sqlite3.ProgrammingError):
            rolled_back.execute("SELECT 1")
        with self.state._connect() as db:
            self.assertEqual(db.execute("SELECT wake_id FROM wake_receipts").fetchall(), [("commit",)])

    def test_connection_closes_if_pragma_raises(self):
        from unittest.mock import MagicMock
        connection = MagicMock()
        connection.execute.side_effect = sqlite3.OperationalError("injected")
        with patch.object(origin.sqlite3, "connect", return_value=connection):
            with self.assertRaises(sqlite3.OperationalError):
                with self.state._connect():
                    pass
        connection.close.assert_called_once()

    @unittest.skipUnless(Path("/proc/self/fd").exists(), "Linux descriptor regression")
    def test_two_thousand_reads_do_not_leak_handles_without_gc(self):
        self.receipt(completed=origin.utc_now())
        before = len(os.listdir("/proc/self/fd"))
        gc.disable()
        try:
            for _ in range(1000):
                self.state.manifest()
                self.assertTrue(self.state.mirror_health()["ok"])
            after = len(os.listdir("/proc/self/fd"))
        finally:
            gc.enable()
        self.assertLessEqual(after, before + 2)

    def test_storage_errors_and_stale_success_are_not_healthy(self):
        with patch.object(self.state, "_connect", side_effect=sqlite3.OperationalError("private detail")):
            self.assertEqual(self.state.mirror_health()["mirror_state"], "storage_unavailable")
            self.assertNotIn("private detail", json.dumps(self.state.mirror_health()))
        self.receipt(completed="2026-01-01T00:00:00Z")
        self.assertFalse(self.state.mirror_health()["ok"])
        self.assertEqual(self.state.mirror_health()["mirror_state"], "stale")
        # Exact receipt remains a historical result, independently of freshness.
        self.assertTrue(self.state.mirror_health("fixture")["ok"])

    def test_drain_timeout_is_durable_and_never_signals_dispatch(self):
        self.receipt()
        with patch.object(origin.subprocess, "run", side_effect=subprocess.TimeoutExpired("fixture", 240)), patch.object(self.state, "signal_dispatchers") as signal:
            self.state._drain("fixture")
        signal.assert_not_called()
        health = self.state.mirror_health("fixture")
        self.assertFalse(health["ok"])
        self.assertEqual(health["last_returncode"], -1)

    @unittest.skipUnless(Path("/proc/self/fd").exists(), "Linux watchdog execution")
    def test_watchdog_restarts_only_repeated_transport_failure_and_releases_lock(self):
        root = Path(self.tmp.name) / "watchdog"
        (root / "scripts").mkdir(parents=True)
        run = root / "runs/phase7-origin"
        run.mkdir(parents=True)
        bin_dir = root / "bin"
        bin_dir.mkdir()
        fake_origin = root / "scripts/phase7_origin.py"
        fake_origin.write_text("import time\ntime.sleep(120)\n")
        fake_curl = bin_dir / "curl"
        fake_curl.write_text('#!/usr/bin/env python3\nimport os\nprint(os.environ.get("FAKE_HEALTH", ""))\n')
        fake_curl.chmod(0o700)
        child = subprocess.Popen(["python3", str(fake_origin), "--token-file", "/srv/cartdotcom/reel-brain-secrets/phase7-origin-token"])
        threading.Thread(target=child.wait, daemon=True).start()
        (run / "origin.pid").write_text(str(child.pid))
        watchdog = Path(__file__).resolve().parents[1] / "scripts/phase7_origin_watchdog.sh"
        env = {**os.environ, "REEL_ORIGIN_WATCHDOG_ROOT": str(root), "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"]}
        replacement = None
        try:
            # A data divergence is NOT a reason for restarting a healthy process.
            for _ in range(3):
                subprocess.run(["bash", str(watchdog)], env={**env, "FAKE_HEALTH": '{"ok":false,"service":"phase7-origin","mirror_state":"degraded"}'}, check=True, timeout=10)
            self.assertIsNone(child.poll())
            for _ in range(2):
                subprocess.run(["bash", str(watchdog)], env=env, check=True, timeout=10)
                self.assertIsNone(child.poll())
            subprocess.run(["bash", str(watchdog)], env=env, check=True, timeout=20)
            replacement = int((run / "origin.pid").read_text())
            self.assertNotEqual(replacement, child.pid)
            os.kill(replacement, 0)
            # If FD 9 leaked into the child, a subsequent watchdog could not acquire it.
            result = subprocess.run(["flock", "-n", str(run / "watchdog.lock"), "true"], check=False)
            self.assertEqual(result.returncode, 0)
        finally:
            if child.poll() is None:
                child.terminate()
            if replacement:
                os.kill(replacement, 15)


if __name__ == "__main__":
    unittest.main()
