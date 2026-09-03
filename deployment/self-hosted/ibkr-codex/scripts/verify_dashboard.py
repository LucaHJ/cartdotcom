"""Read-only authenticated deployment smoke check; never prints credentials."""
import json
import httpx
from app.config import settings

headers = {"authorization": f"Bearer {settings.news_signal_token}"}
checks = []
for base in ("http://127.0.0.1:3000", settings.public_base_url):
    with httpx.Client(timeout=30, follow_redirects=True) as client:
        protected = client.get(base + "/api/status")
        assert protected.status_code == 401, (base, protected.status_code)
        if base == settings.public_base_url:
            # The Cloudflare login token and private-origin transport token
            # are intentionally distinct. Do not send the origin token here.
            html = client.get(base + "/")
            html.raise_for_status()
            assert "Queued paper trades" in html.text
            checks.append(dict(base=base, html_status=html.status_code, unauthenticated_status=protected.status_code))
            continue
        response = client.get(base + "/api/status", headers=headers)
        response.raise_for_status()
        data = response.json()
        assert data["paper_only"] and "execution_queue" in data
        html = client.get(base + "/", headers=headers)
        html.raise_for_status()
        assert "Queued paper trades" in html.text
        latest = data.get("latest_run")
        if latest:
            detail = client.get(base + "/api/runs/" + latest["id"], headers=headers)
            detail.raise_for_status()
            assert "execution" in detail.json()
        checks.append(dict(base=base, authenticated_status=response.status_code, unauthenticated_status=protected.status_code,
                           latest_run_status=latest["status"] if latest else None, queue_entries=len(data["execution_queue"])))
print(json.dumps(checks))
