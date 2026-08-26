import argparse
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
CONTROL_PATH = ROOT / "scripts" / "phase6_dispatch_control.py"
DISPATCHER_PATH = ROOT / "scripts" / "phase6_dispatcher.py"
ORCHESTRATOR_PATH = ROOT / "scripts" / "phase5_one_job_orchestrator.py"


def load_control():
    spec = importlib.util.spec_from_file_location("phase6_dispatch_control_test", CONTROL_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_dispatcher():
    spec = importlib.util.spec_from_file_location("phase6_dispatcher_test", DISPATCHER_PATH)
    module = importlib.util.module_from_spec(spec)
    with mock.patch.dict(sys.modules, {"fcntl": mock.MagicMock()}):
        spec.loader.exec_module(module)
    return module


def load_orchestrator():
    spec = importlib.util.spec_from_file_location("phase5_one_job_orchestrator_test", ORCHESTRATOR_PATH)
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
        self.queries = []

    def psql_json(self, *_args):
        self.queries.append(_args[-1])
        return self.rows


class Phase6RuntimeTests(unittest.TestCase):
    def test_restricted_audience_compute_failure_is_classified_explicitly(self):
        module = load_orchestrator()
        result = module.compute_failure_summary(RuntimeError(
            "yt-dlp exited 1: This content isn't available to everyone: It can't be seen by certain audiences."
        ))
        self.assertEqual(result["error_code"], "error_restricted")
        self.assertIn("certain audiences", result["error_message"])

    def test_prefetch_requires_exact_active_synthesis_and_distinct_queued_reel(self):
        module = load_dispatcher()
        response = {
            "ok": True,
            "active": {"job_id": "current", "job_status": "running", "job_stage": "synthesizing"},
            "candidate": {
                "job_id": "next", "job_status": "queued", "job_stage": "queued",
                "source_url": "https://www.instagram.com/reel/next/",
            },
        }
        self.assertEqual(module.eligible_prefetch(response, "current")["job_id"], "next")
        response["active"]["job_stage"] = "downloading"
        self.assertIsNone(module.eligible_prefetch(response, "current"))
        response["active"]["job_stage"] = "synthesizing"
        response["candidate"]["job_id"] = "current"
        self.assertIsNone(module.eligible_prefetch(response, "current"))

    def test_prefetch_global_slot_busy_skips_without_container(self):
        module = load_dispatcher()
        candidate = {"job_id": "job-2", "source_url": "https://www.instagram.com/reel/x/", "source_message_id": "m-2", "attempts": 0}
        with tempfile.TemporaryDirectory() as root, mock.patch.object(module.fcntl, "flock", side_effect=BlockingIOError), mock.patch.object(module.subprocess, "run") as run:
            result = module.prefetch(argparse.Namespace(project_dir=root), candidate)
        self.assertEqual(result["skipped"], "prefetch_slot_busy")
        run.assert_not_called()

    def test_created_at_is_utc_and_queue_wait_can_be_measured(self):
        module = load_dispatcher()
        value = module.parse_created_at("2026-08-25 10:00:00")
        self.assertEqual(value.isoformat(), "2026-08-25T10:00:00+00:00")

    def test_retry_attempt_uses_fresh_checkpoint_and_prefetch_paths(self):
        module = load_dispatcher()
        candidate = {
            "pilot_key": "phase6:2:job-1",
            "job_id": "job-1",
            "source_message_id": "message-1",
            "attempts": 1,
        }
        self.assertEqual(module.attempt_key(candidate), "attempt-2")
        self.assertTrue(module.prefetch_container_path(candidate).endswith("/job-1/attempt-2"))
        command = module.orchestrator_command(argparse.Namespace(
            project_dir="/srv/project",
            schema="shadow",
            admin_token_host_file="/secret",
            job_timeout=900,
            lease_owner="phase6-local-worker-1",
        ), candidate)
        self.assertEqual(command[command.index("--attempt-key") + 1], "attempt-2")

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

    def test_corrective_resynthesis_reopens_only_its_completed_exact_local_lease(self):
        module = load_control()
        candidate = {
            "pilot_key": "phase6:2:job-1",
            "job_id": "job-1",
            "source_message_id": "message-1",
            "corrective_resynthesis": 1,
        }
        fence = {
            "expires_at": "2026-08-26T12:00:00Z",
            "local_lease_expires_at": "2026-08-26T11:00:00Z",
        }
        runner = FakeRunner([{"inserted": 1, "events": 1, "existing": 1}])
        module.insert_local_lease(runner, args(), candidate, fence)
        self.assertIn("status IN ('rolled_back','completed')", runner.queries[0])
        self.assertIn("status IN ('leased','processing'))", runner.queries[0])

        ordinary = {**candidate, "corrective_resynthesis": 0}
        ordinary_runner = FakeRunner([{"inserted": 1, "events": 1, "existing": 1}])
        module.insert_local_lease(ordinary_runner, args(), ordinary, fence)
        self.assertIn("status IN ('rolled_back')", ordinary_runner.queries[0])
        self.assertNotIn("status IN ('rolled_back','completed')", ordinary_runner.queries[0])

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

    def test_aborted_compute_is_reconciled_to_terminal_failure(self):
        module = load_dispatcher()
        candidate = {
            "pilot_key": "phase6:2:job-1",
            "job_id": "job-1",
            "source_message_id": "message-1",
            "created_at": "2026-08-25 10:00:00",
        }
        runtime_args = argparse.Namespace(generation=2)
        with mock.patch.object(module, "control", side_effect=[
            {"ok": True, "idle": False, "candidate": candidate},
            {"ok": True, "failed": True, "stage": "error_restricted"},
        ]) as control_call, mock.patch.object(module, "orchestrate", return_value={
            "ok": True,
            "aborted_after_compute_failure": True,
            "compute_failure": {"error_code": "error_restricted", "error_message": "restricted audience"},
        }), mock.patch.object(module, "append_performance"):
            result = module.run_once(runtime_args, 7)
        self.assertEqual(result["stage"], "error_restricted")
        self.assertEqual(result["recovery"], "terminal_failure_after_prepublication_abort")
        self.assertEqual(control_call.call_args_list[1].args[1], "fail-job")



if __name__ == "__main__":
    unittest.main()
