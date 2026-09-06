"""Upload the compact pair with a purpose-specific publisher token, not a Cloudflare API key."""
import hashlib
import json
from pathlib import Path
import urllib.request
import urllib.error

root=Path(__file__).resolve().parent.parent
s=json.loads((root/'output/snapshot.json').read_text())
c=json.loads((root/'output/discoveries.json').read_text())
assert s['generatedAt']==c['generatedAt'] and s['source']['sha256']==c['snapshotSha256']
body=json.dumps({'snapshot':s,'catalogue':c},separators=(',',':')).encode()
assert len(body)<=16*1024*1024,'Publication exceeds the storage budget'
sha=hashlib.sha256(body).hexdigest()
token=(root/'secrets/publish-token').read_text().strip()
request=urllib.request.Request('https://cartdotcom.com/backend/nba/_publish',data=body,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','X-Content-SHA256':sha,'User-Agent':'Cartdotcom-NBA-Publisher/2.0'},method='POST')
try:
    with urllib.request.urlopen(request,timeout=90) as response:
        result=json.load(response)
except urllib.error.HTTPError as error:
    raise RuntimeError(f'Publication HTTP {error.code}: {error.read(1000).decode(errors="replace")}') from None
assert result.get('ok') and result.get('sha256')==sha,'Publisher did not acknowledge this exact generation'
(root/'output/published.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result))
