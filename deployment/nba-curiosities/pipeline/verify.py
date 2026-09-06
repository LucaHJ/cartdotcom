"""Read-only health verification of the two publishable artifacts."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
s = json.loads((root / 'output/snapshot.json').read_text())
d = json.loads((root / 'output/discoveries.json').read_text())
assert s['version'] == d['version'] == 1
assert s['source']['sha256'] == d['snapshotSha256']
assert s['generatedAt'] == d['generatedAt']
assert len(s['rows']) == s['audit']['aggregates']
assert all(row[4] >= 1 for row in s['rows'])
assert d['findings'] and all(0 <= p < len(s['players']) for f in d['findings'] for p in f['players'])
for name in ('snapshot.json', 'discoveries.json'):
    file = root / 'output' / name
    print(name, file.stat().st_size, 'bytes', hashlib.sha256(file.read_bytes()).hexdigest())
print('HEALTHY: snapshot and discoveries match. Refresh is manual; historical data does not expire.')
