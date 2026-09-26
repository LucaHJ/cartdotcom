"""Publish bounded, allowlisted production records. No request can execute SQL."""
import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import subprocess
from urllib.parse import urlsplit, urlunsplit

ROOT = Path('/srv/cartdotcom/portfolio-public/data')
SCHEMA = 'reel_phase7_primary_20260825_133007'
HORIZONS = ('1h', '6h', '12h', '24h', '1d', '48h', '1w', '2w', '1m', '3m', '6m', '1y', '2y', '3y', '4y')


def query(sql, investment=False):
    container, user = ('ibkr-codex-paper-postgres-1', 'ibkr_codex') if investment else ('cartdotcom-platform-postgres-1', 'cartdotcom')
    command = ['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', user]
    # SQL is fixed source code, not caller input; fail closed on timeout or schema drift.
    statement = "BEGIN READ ONLY; SET LOCAL statement_timeout='8s'; " + sql + '; COMMIT;'
    result = subprocess.run(command, input=statement, text=True, capture_output=True, timeout=12, check=True)
    return json.loads(result.stdout.strip())


def rows(sql, investment=False):
    return query("SELECT COALESCE(json_agg(t), '[]'::json) FROM (" + sql + ') t', investment)


def public_url(value):
    try:
        url = urlsplit(value or '')
        host = (url.hostname or '').lower()
        if url.scheme not in ('http', 'https') or not host or url.username or url.password:
            return None
        if '.' not in host or host.endswith(('.local', '.internal', '.localhost')):
            return None
        import ipaddress
        try:
            ipaddress.ip_address(host)
            return None
        except ValueError:
            pass
        # Tracking, signed query strings and fragments are not public data fields.
        return urlunsplit((url.scheme, url.netloc, url.path, '', ''))
    except ValueError:
        return None


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def investment_data():
    return {
        'mode': 'paper',
        'runs': rows('SELECT scheduled_for, finished_at, status FROM research_runs ORDER BY scheduled_for DESC LIMIT 60', True),
        'decisions': rows('SELECT symbol, action, target_weight_pct, validation_status, created_at FROM decisions ORDER BY created_at DESC LIMIT 150', True),
        'executions': rows('SELECT symbol, side, price, executed_at FROM executions ORDER BY executed_at DESC LIMIT 100', True)
    }


def market_data():
    articles = rows("SELECT a.id, left(a.title, 350) AS title, a.url, s.name AS source, a.published_at, a.discovered_at FROM articles a JOIN sources s ON s.id=a.source_id ORDER BY a.discovered_at DESC LIMIT 150")
    # A separate recent priced cohort prevents today's unmatured articles hiding all observations.
    observed = rows("SELECT p.symbol, a.title, a.url, s.name AS source, a.published_at, p.baseline_price, p.baseline_at, p.updated_at, p.intervals_json FROM price_impacts p JOIN articles a ON a.id=p.article_id JOIN sources s ON s.id=a.source_id ORDER BY a.discovered_at DESC LIMIT 150")
    for item in articles:
        item.pop('id')
        item['url'] = public_url(item['url'])
    for item in observed:
        item['url'] = public_url(item['url'])
        intervals = json.loads(item.pop('intervals_json'))
        item['intervals'] = {key: {'at': value.get('at'), 'change_pct': number(value.get('change_pct'))}
                             for key, value in intervals.items() if key in HORIZONS and isinstance(value, dict)}
    return {'articles': articles, 'observations': observed}


def research_data():
    resources = rows(f"SELECT left(r.name, 250) AS name, r.kind, r.canonical_url AS url, left(r.summary, 2400) AS summary, left(r.why_useful, 1600) AS why_useful, r.created_at, j.canonical_url AS source_url FROM {SCHEMA}.resources r JOIN {SCHEMA}.jobs j ON j.id=r.job_id WHERE j.status='complete' ORDER BY r.created_at DESC LIMIT 250")
    for item in resources:
        item['url'] = public_url(item['url'])
        item['source_url'] = public_url(item['source_url'])
    return {'resources': resources}


def publish(name, data, destination=ROOT):
    payload = {'schema_version': 1, 'dataset': name, 'generated_at': datetime.now(timezone.utc).isoformat(), **data}
    encoded = json.dumps(payload, ensure_ascii=True, allow_nan=False).encode()
    if len(encoded) > 2_000_000:
        raise ValueError('Projection exceeds publication size limit')
    destination.mkdir(parents=True, exist_ok=True)
    staging = destination / (name + '.tmp')
    staging.write_bytes(encoded)
    staging.replace(destination / (name + '.json'))
    print(json.dumps({'dataset': name, 'bytes': len(encoded), 'generated_at': payload['generated_at']}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT)
    args = parser.parse_args()
    failed = False
    for name, build in [('investment', investment_data), ('market', market_data), ('research', research_data)]:
        try:
            publish(name, build(), args.output)
        except Exception as error:
            failed = True
            # Never send SQL output or private database errors to public files or logs.
            print(json.dumps({'dataset': name, 'error': type(error).__name__}))
    raise SystemExit(1 if failed else 0)
