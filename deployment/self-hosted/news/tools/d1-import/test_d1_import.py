import importlib.util
from pathlib import Path
import tempfile
import unittest


MODULE_PATH = Path(__file__).with_name("d1_import.py")
SPEC = importlib.util.spec_from_file_location("d1_import", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class D1ImportTests(unittest.TestCase):
    def test_loads_export_and_counts_known_tables(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            export = root / "export.sql"
            export.write_text(
                "CREATE TABLE sources (id TEXT PRIMARY KEY, name TEXT);"
                "INSERT INTO sources VALUES ('one', 'Example');",
                encoding="utf-8",
            )
            connection = MODULE.load_export(export, root / "database.sqlite")
            self.assertEqual(MODULE.sqlite_tables(connection), {"sources"})
            self.assertEqual(MODULE.source_counts(connection, ["sources"]), {"sources": 1})
            connection.close()

    def test_empty_timestamp_is_normalized(self):
        self.assertIsNone(MODULE.normalize_value("", "timestamp with time zone"))
        self.assertEqual(MODULE.normalize_value("", "text"), "")


if __name__ == "__main__":
    unittest.main()
