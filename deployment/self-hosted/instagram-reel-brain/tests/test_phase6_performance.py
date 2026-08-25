import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "phase6_performance_report.py"


def load_module():
    spec = importlib.util.spec_from_file_location("phase6_performance_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Phase6PerformanceTests(unittest.TestCase):
    def test_summary_tracks_stages_handover_prefetch_and_overlap(self):
        module = load_module()
        rows = [
            {
                "dispatch_started_at": "2026-08-25T00:00:00Z",
                "recorded_at": "2026-08-25T00:02:00Z",
                "orchestration_seconds": 120,
                "queue_wait_seconds": 20,
                "control_handover_seconds": 10,
                "processor_timings": {"total_seconds": 110, "download_seconds": 5, "media_preparation_seconds": 10, "codex_seconds": 80, "completion_seconds": 15, "prefetch_hit": False},
            },
            {
                "dispatch_started_at": "2026-08-25T00:01:00Z",
                "recorded_at": "2026-08-25T00:03:00Z",
                "orchestration_seconds": 120,
                "queue_wait_seconds": 10,
                "control_handover_seconds": 10,
                "processor_timings": {"total_seconds": 110, "download_seconds": 3, "media_preparation_seconds": 8, "codex_seconds": 84, "completion_seconds": 15, "prefetch_hit": True},
            },
        ]
        summary = module.summarise(rows)
        self.assertEqual(summary["count"], 2)
        self.assertEqual(summary["average_download_seconds"], 4)
        self.assertEqual(summary["average_control_handover_seconds"], 10)
        self.assertEqual(summary["prefetch_hit_rate"], 0.5)
        self.assertEqual(summary["peak_overlap"], 2)

    def test_atomic_report_preserves_baseline_and_new_rows(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            log, marker, output = root / "performance.jsonl", root / "start.json", root / "latest.json"
            marker.write_text(json.dumps({"started_at": "2026-08-25T01:00:00Z"}), encoding="utf-8")
            row = lambda at, seconds: {"recorded_at": at, "orchestration_seconds": seconds, "processor_timings": {"total_seconds": seconds - 10}}
            log.write_text("\n".join(json.dumps(value) for value in [row("2026-08-25T00:05:00Z", 200), row("2026-08-25T01:05:00Z", 100)]), encoding="utf-8")
            with mock.patch("sys.argv", [str(SCRIPT), "--log", str(log), "--marker", str(marker), "--output", str(output)]):
                self.assertEqual(module.main(), 0)
            report = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(report["baseline"]["count"], 1)
            self.assertEqual(report["concurrency_two"]["count"], 1)


if __name__ == "__main__":
    unittest.main()
