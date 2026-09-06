"""Stream the source archive on the local server; publish only compact aggregates.

No dependencies. Raw records stay in the input ZIP, identified by SHA-256.
Game IDs identify seasons, including the delayed 2020 playoffs.
"""
import argparse
import collections
import csv
import datetime as dt
import hashlib
import io
import json
import math
from pathlib import Path
import zipfile

SOURCE = 'https://www.kaggle.com/datasets/eoinamoore/historical-nba-data-and-player-box-scores'
METRICS = [('pts', 'points', 1950), ('reb', 'reboundsTotal', 1951),
           ('ast', 'assists', 1950), ('stl', 'steals', 1974),
           ('blk', 'blocks', 1974), ('three', 'threePointersMade', 1980)]
COLUMNS = ['player', 'season', 'type', 'age', 'games'] + [m[0] for m in METRICS]


def number(value):
    try:
        n = float(value)
        return n if math.isfinite(n) and n >= 0 else None
    except (ValueError, TypeError):
        return None


def minutes(value):
    if ':' in value:
        a, b = value.split(':', 1)
        return float(a) + float(b) / 60
    return number(value)


def season_type(game_id):
    gid = str(game_id).zfill(10)
    if len(gid) != 10 or not gid.isdigit() or gid[:3] not in ('002', '004'):
        return None
    start = int(gid[3:5])
    return (1900 if start >= 46 else 2000) + start + 1, (1 if gid[:3] == '004' else 0)


def age_on(birth, day):
    return day.year - birth.year - ((day.month, day.day) < (birth.month, birth.day))


def participation(row):
    m = minutes(row.get('numMinutes', ''))
    if m is not None and m > 0:
        return True
    if row.get('comment', '').strip():
        return False
    # Historical rows may lack minutes. A populated points cell is evidence of
    # a recorded appearance; an explicit zero-minute all-zero row is ambiguous.
    if m is None:
        return number(row.get('points')) is not None
    return any((number(row.get(field)) or 0) > 0 for field in
               ['points', 'assists', 'reboundsTotal', 'foulsPersonal', 'fieldGoalsAttempted', 'freeThrowsAttempted', 'turnovers', 'steals', 'blocks'])


def csv_rows(archive, name):
    return csv.DictReader(io.TextIOWrapper(archive.open(name), encoding='utf-8-sig'))


def write_json(path, data):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, separators=(',', ':'), ensure_ascii=False, allow_nan=False), encoding='utf-8')
    tmp.replace(path)


def build(archive_path, output, first=1950, last=2025):
    output.mkdir(parents=True, exist_ok=True)
    archive = zipfile.ZipFile(archive_path)
    bios = {}
    for p in csv_rows(archive, 'Players.csv'):
        birth = p['birthDate'][:10]
        try:
            birth = dt.date.fromisoformat(birth)
        except ValueError:
            birth = None
        bios[p['personId']] = (f"{p['firstName']} {p['lastName']}".strip(), birth)
    players, pindex, agg, seen, duplicates = [], {}, {}, set(), 0
    audit = collections.Counter()
    games, expected, points_by_game = {}, {}, collections.defaultdict(int)
    for game in csv_rows(archive, 'Games.csv'):
        st = season_type(game['gameId'])
        if st and first <= st[0] <= last and number(game.get('homeScore')) and number(game.get('awayScore')):
            expected[game['gameId']] = {'season': st[0], 'type': st[1], 'points': int(float(game['homeScore'])) + int(float(game['awayScore']))}
    for row in csv_rows(archive, 'PlayerStatistics.csv'):
        st = season_type(row['gameId'])
        if not st or not first <= st[0] <= last:
            continue
        if not participation(row):
            audit['nonAppearancesOrAmbiguousZeroMinutes'] += 1
            continue
        key = (row['gameId'], row['personId'])
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        day = dt.date.fromisoformat(row['gameDateTimeEst'][:10])
        pid = row['personId']
        name, birth = bios.get(pid, (f"{row['firstName']} {row['lastName']}".strip(), None))
        age = age_on(birth, day) if birth else None
        if age is not None and not 15 <= age <= 60:
            age = None
        if age is None:
            audit['appearancesMissingAge'] += 1
        if pid not in pindex:
            pindex[pid] = len(players)
            players.append([pid, name, birth.isoformat() if birth else None])
        k = (pindex[pid], st[0], st[1], age)
        if k not in agg:
            agg[k] = [0] + [0] * len(METRICS)
        values = agg[k]
        values[0] += 1
        for i, (_, field, earliest) in enumerate(METRICS, 1):
            n = number(row.get(field)) if st[0] >= earliest else None
            if n is None or values[i] is None:
                values[i] = None
            else:
                if not n.is_integer():
                    raise ValueError(f'Non-integer counting stat: {key} {field}={n}')
                values[i] += int(n)
        gid = row['gameId']
        games[gid] = [st[0], st[1], day.isoformat()]
        points_by_game[gid] += int(number(row.get('points')) or 0)
    coverage = []
    for year in range(first, last + 1):
        for typ in (0, 1):
            e = {gid: g for gid, g in expected.items() if g['season'] == year and g['type'] == typ}
            present = [gid for gid, g in games.items() if g[:2] == [year, typ]]
            matched = sum(points_by_game.get(gid) == g['points'] for gid, g in e.items())
            coverage.append({'season': year, 'type': typ, 'games': len(present), 'listedGames': len(e), 'scoreMatchedGames': matched})
    rows = [list(k) + v for k, v in sorted(agg.items(), key=lambda kv: (kv[0][1], kv[0][2], kv[0][0], kv[0][3] or 0))]
    with archive_path.open('rb') as f:
        sha = hashlib.file_digest(f, 'sha256').hexdigest()
    result = {
        'version': 1, 'generatedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
        'source': {'name': 'Eoin A. Moore · NBA box-score archive', 'url': SOURCE, 'sha256': sha,
                   'files': ['Players.csv', 'PlayerStatistics.csv', 'Games.csv'], 'upstream': 'NBA.com (via community archive)'},
        'firstSeason': first, 'lastSeason': last, 'lastGameDate': max(g[2] for g in games.values()),
        'ageDefinition': 'Completed years on each game date (US Eastern date in source). Birthday-crossing seasons are split by age.',
        'qualification': 'At least one recorded appearance. DNP entries are excluded. Explicit zero-minute, all-zero rows without participation evidence are excluded and counted in the audit.',
        'scope': 'NBA seasons ending 1950–2025; BAA, ABA, play-in, exhibitions and NBA Cup final excluded. Regular-season Cup games are included by NBA game ID.',
        'limitations': [
            'Historical archive coverage is uneven. Unique means unique in the selected dataset, not a certified all-time record.',
            'Missing metrics remain unknown; a group with any missing value cannot qualify for that metric.',
            'Rebounds before 1951, steals and blocks before 1974, and threes before 1980 are unavailable.',
            'Score agreement checks coverage against Games.csv from the same archive; it is not independent verification of every statistic.',
            'The per-run mode evaluates the portion of each season played inside the selected age bracket, not necessarily an entire playoff run.',
        ],
        'columns': COLUMNS, 'players': players, 'rows': rows, 'coverage': coverage,
        'audit': {**audit, 'duplicateRowsSkipped': duplicates, 'appearances': len(seen), 'games': len(games), 'aggregates': len(rows)},
    }
    write_json(output / 'snapshot.json', result)
    print(json.dumps({'players': len(players), 'rows': len(rows), 'audit': result['audit'], 'bytes': (output/'snapshot.json').stat().st_size}))


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--archive', required=True, type=Path)
    ap.add_argument('--output', required=True, type=Path)
    ap.add_argument('--first', type=int, default=1950)
    ap.add_argument('--last', type=int, default=2025)
    args = ap.parse_args()
    build(args.archive, args.output, args.first, args.last)
