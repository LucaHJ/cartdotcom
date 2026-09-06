"""Install only this application's daily entry, preserving the user's other jobs."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent.parent
assert str(root) == '/srv/codex-lab/nba-curiosities'
result = subprocess.run(['crontab', '-l'], capture_output=True, text=True)
if result.returncode and 'no crontab' not in result.stderr.lower():
    raise RuntimeError(result.stderr)
begin, end = '# BEGIN NBA CURIOSITIES', '# END NBA CURIOSITIES'
lines, skipping = [], False
for line in result.stdout.splitlines():
    if line == begin:
        skipping = True
    elif line == end:
        skipping = False
    elif not skipping:
        lines.append(line)
assert not skipping, 'Unclosed existing NBA cron block'
lines.extend([begin, f'20 4 * * * /bin/sh {root}/pipeline/run-daily.sh >{root}/output/daily.log 2>&1', end])
subprocess.run(['crontab', '-'], input='\n'.join(lines)+'\n', text=True, check=True)
print('Installed NBA discovery at 04:20 UTC daily; other cron entries preserved.')
