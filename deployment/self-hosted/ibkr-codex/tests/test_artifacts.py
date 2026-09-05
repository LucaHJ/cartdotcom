from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app import artifacts


def test_disposable_database_cannot_write_to_production_artifact_mount() -> None:
    isolated_test_settings = SimpleNamespace(
        pg_database="ibkr_queue_test_guard",
        artifact_root=Path("/data/artifacts"),
    )
    with patch.object(artifacts, "settings", isolated_test_settings):
        with pytest.raises(RuntimeError, match="forbidden"):
            artifacts._run_dir("synthetic-test-run")
