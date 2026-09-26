"""Install only this application's export entry, preserving other cron jobs."""
import subprocess

MARKER = '# cartdotcom-portfolio-public-export'
result = subprocess.run(['crontab', '-l'], capture_output=True, text=True)
if result.returncode not in (0, 1):
    raise SystemExit('Unable to read existing crontab')
if result.returncode == 1 and 'no crontab' not in result.stderr.lower():
    raise SystemExit('Unexpected crontab error')
lines = [line for line in result.stdout.splitlines() if MARKER not in line]
lines.append('* * * * * /usr/bin/flock -n /srv/cartdotcom/portfolio-public/export.lock /usr/bin/python3 /srv/cartdotcom/portfolio-public/export.py 2>&1 | /usr/bin/logger -t portfolio-public-export ' + MARKER)
subprocess.run(['crontab', '-'], input='\n'.join(lines) + '\n', text=True, check=True)
print('Portfolio export cron installed; other entries preserved.')
