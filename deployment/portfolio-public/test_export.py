import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('exporter', Path(__file__).with_name('export.py'))
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class PublicationTests(unittest.TestCase):
    def test_urls(self):
        for value in ['javascript:alert(1)', 'http://localhost/', 'http://127.0.0.1/a', 'http://10.0.0.1/', 'https://user:secret@example.com/a', 'https://service.internal/']:
            self.assertIsNone(exporter.public_url(value))
        self.assertEqual(exporter.public_url('https://example.com/a?token=secret#private'), 'https://example.com/a')

    def test_atomic_size_guard_preserves_last_good(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            exporter.publish('investment', {'runs': []}, root)
            original = (root / 'investment.json').read_bytes()
            with self.assertRaises(ValueError):
                exporter.publish('investment', {'text': 'x' * 2_000_001}, root)
            self.assertEqual((root / 'investment.json').read_bytes(), original)
            self.assertEqual(json.loads(original)['dataset'], 'investment')

    def test_fixed_investment_allowlist(self):
        with patch.object(exporter, 'rows', return_value=[]) as query:
            exporter.investment_data()
            sql = ' '.join(call.args[0] for call in query.call_args_list)
            self.assertNotIn('account_id', sql)
            self.assertNotIn('raw', sql)
            self.assertNotIn('SELECT *', sql)
            self.assertNotIn('thesis', sql)

    def test_nonfinite_numbers_are_missing(self):
        self.assertIsNone(exporter.number(float('nan')))
        self.assertIsNone(exporter.number(float('inf')))
        self.assertIsNone(exporter.number(True))
        self.assertEqual(exporter.number(0), 0)


if __name__ == '__main__':
    unittest.main()
