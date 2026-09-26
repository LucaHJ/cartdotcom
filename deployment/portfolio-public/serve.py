"""Private snapshot origin; deliberately has no database or Docker access."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path('/srv/cartdotcom/portfolio-public/data')
FILES = {f'/portfolio-public/{name}.json': ROOT / f'{name}.json' for name in ('investment', 'market', 'research')}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        target = FILES.get(urlsplit(self.path).path)
        if not target or '?' in self.path:
            self.send_error(404)
            return
        try:
            body = target.read_bytes()
        except OSError:
            self.send_error(503)
            return
        if len(body) > 2_000_000:
            self.send_error(503)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'public, max-age=30')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    do_HEAD = do_GET


if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', 3112), Handler).serve_forever()
