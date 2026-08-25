import argparse
import importlib.util
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
CONTROL_PATH = ROOT / "scripts" / "phase6_dispatch_control.py"


def load_control():
    spec = importlib.util.spec_from_file_location("phase6_dispatch_control_test", CONTROL_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def args():
    return argparse.Namespace(
        schema="reel_phase4_shadow_test",
        generation=2,
        lease_owner="phase6-local-worker-1",
        lease_minutes=240,
    )


class FakeRunner:
    def __init__(self, rows):
        self.rows = rows

    def psql_json(self, *_args):
        return self.rows


class Phase6RuntimeTests(unittest.TestCase):
    def test_new_local_lease_accepts_insert_and_event_in_same_statement(self):
        module = load_control()
        candidate = {
            "pilot_key": "phase6:2:job-1",
            "job_id": "job-1",
            "source_message_id": "message-1",
        }
        fence = {
            "expires_at": "2026-08-25T12:00:00Z",
            "local_lease_expires_at": "2026-08-25T11:00:00Z",
        }
        result = module.insert_local_lease(FakeRunner([{"inserted": 1, "events": 1, "existing": 0}]), args(), candidate, fence)
        self.assertEqual(result["inserted"], 1)

    def test_local_processing_claim_conflict_is_reconciled_for_exact_owner(self):
        module = load_control()
        candidate = {
            "pilot_key": "phase6:2:job-1",
            "job_id": "job-1",
            "source_message_id": "message-1",
        }
        fence = {
            **candidate,
            "status": "local_processing",
            "local_lease_owner": "phase6-local-worker-1",
            "expires_at": "2026-08-25T12:00:00Z",
        }
        responses = [
            {"ok": True, "candidate": candidate, "authority": {"generation": 2}},
            {"ok": False, "_http_status": 409, "fence": fence},
        ]
        with mock.patch.object(module, "load_runner", return_value=object()), mock.patch.object(
            module, "local_job_ready", return_value=True
        ), mock.patch.object(module, "worker_json", side_effect=responses), mock.patch.object(
            module, "insert_local_lease", return_value={"existing": 1}
        ), mock.patch.object(module, "release_candidate") as release:
            result = module.claim_next(args())
        self.assertTrue(result["claim"]["recovered_active"])
        release.assert_not_called()

    def test_mismatched_processing_claim_conflict_fails_closed(self):
        module = load_control()
        candidate = {
            "pilot_key": "phase6:2:job-1",
            "job_id": "job-1",
            "source_message_id": "message-1",
        }
        responses = [
            {"ok": True, "candidate": candidate, "authority": {"generation": 2}},
            {
                "ok": False,
                "_http_status": 409,
                "fence": {**candidate, "status": "local_processing", "local_lease_owner": "other-owner"},
            },
        ]
        with mock.patch.object(module, "load_runner", return_value=object()), mock.patch.object(
            module, "local_job_ready", return_value=True
        ), mock.patch.object(module, "worker_json", side_effect=responses):
            with self.assertRaisesRegex(RuntimeError, "cloud exact claim failed"):
                module.claim_next(args())


if __name__ == "__main__":
    unittest.main()
